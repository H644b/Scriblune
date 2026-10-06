/** Offline operator command. Never import this privileged connection into the app. */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { z } from "zod";
import Stripe from "stripe";
const { values } = parseArgs({
  options: {
    "request-id": { type: "string" },
    "admin-id": { type: "string" },
    confirm: { type: "string" },
    action: { type: "string" },
    output: { type: "string" },
  },
});
const requestId = z.uuid().parse(values["request-id"]),
  adminId = z.uuid().parse(values["admin-id"]);
const action = z.enum(["export", "delete"]).parse(values.action);
if (!process.env.GOVERNANCE_DATABASE_URL || !process.env.SUPABASE_SECRET_KEY)
  throw new Error(
    "Configure operator-only GOVERNANCE_DATABASE_URL and SUPABASE_SECRET_KEY.",
  );
if (process.env.GOVERNANCE_MAINTENANCE !== "true")
  throw new Error(
    "Pause web traffic and workers, then set GOVERNANCE_MAINTENANCE=true.",
  );
const sql = postgres(process.env.GOVERNANCE_DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: process.env.GOVERNANCE_DATABASE_URL.includes("localhost")
    ? false
    : "require",
  onnotice: () => {},
});
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const bucket = supabase.storage.from("scriblune-private");
async function paths(prefix: string, targetBucket = bucket): Promise<string[]> {
  const result: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await targetBucket.list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error)
      throw new Error("Storage listing failed. Nothing was marked complete.");
    for (const file of data || []) {
      const path = `${prefix}/${file.name}`;
      if (!file.id) result.push(...(await paths(path, targetBucket)));
      else result.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return result;
}
try {
  const [member] =
    await sql`select exists(select 1 from private.site_owners where account_id=${adminId}) or exists(select 1 from private.staff_assignments a join private.staff_roles r on r.key=a.role_key where a.account_id=${adminId} and 'privacy.manage'=any(r.permissions)) as allowed`;
  if (!member?.allowed)
    throw new Error(
      "A protected privacy administrator membership is required.",
    );
  const request = (
    await sql`select * from private.privacy_requests where id=${requestId}`
  )[0];
  if (!request || request.status !== "verified")
    throw new Error("A verified, open privacy request is required.");
  if (values.confirm !== request.account_id)
    throw new Error("--confirm must exactly match the verified account UUID.");
  if (request.request_type !== (action === "delete" ? "deletion" : "access"))
    throw new Error("The command must match the verified request type.");
  if (request.account_id === adminId)
    throw new Error(
      "A different privacy administrator must fulfill their own request.",
    );
  const account = request.account_id as string;
  await sql`insert into private.admin_audit_log(admin_id,action,target_id) values(${adminId},${`privacy_${action}_started`},${requestId})`;
  const files = await paths(account);
  const community = supabase.storage.from("scriblune-community");
  const communityFiles = [
    ...(await paths(`avatars/${account}`, community)),
    ...(await paths(`attachments/${account}`, community)),
  ];
  if (action === "delete") {
    if (
      (
        await sql`select account_id from private.site_owners where account_id=${account}`
      ).length
    )
      throw new Error(
        "A site owner must transfer ownership through an operator before account deletion.",
      );

    const billing = (
      await sql`select customer_id,checkout_id,stripe_livemode,test_billing_archive from private.billing_accounts where account_id=${account}`
    )[0];
    const archivedEnv = await readFile(".env.stripe-test.local", "utf8")
      .then(parseEnv)
      .catch(() => ({}) as Record<string, string>);
    const providers = [
      billing,
      billing?.test_billing_archive
        ? { ...billing.test_billing_archive, stripe_livemode: false }
        : null,
    ].filter((b) => b?.customer_id);
    for (const provider of providers) {
      const key = provider.stripe_livemode
        ? process.env.STRIPE_SECRET_KEY
        : process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
          ? process.env.STRIPE_SECRET_KEY
          : archivedEnv.STRIPE_TEST_SECRET_KEY;
      if (!key || key.startsWith("sk_live_") !== provider.stripe_livemode)
        throw new Error(
          "Configure the matching Stripe credentials before deleting this billing account, including archived test credentials when needed.",
        );
      const stripe = new Stripe(key);
      if (provider.checkout_id) {
        const checkout = await stripe.checkout.sessions.retrieve(
          provider.checkout_id,
        );
        if (checkout.status === "open")
          await stripe.checkout.sessions.expire(checkout.id);
      }
      // Delete the provider customer before erasing our mapping. This cancels
      // every remaining subscription and prevents post-deletion renewal.
      await stripe.customers.del(provider.customer_id);
    }
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await bucket.remove(files.slice(i, i + 100));
      if (error)
        throw new Error(
          "Storage removal incomplete; rerun after resolving the error.",
        );
    }
    for (let i = 0; i < communityFiles.length; i += 100) {
      const { error } = await community.remove(
        communityFiles.slice(i, i + 100),
      );
      if (error)
        throw new Error(
          "Storage removal incomplete; retry after resolving the error.",
        );
    }
    await sql.begin(async (tx) => {
      await tx`delete from private.forum_attachments where owner_id=${account}`;
      await tx`update private.forum_threads set deleted_at=now() where author_id=${account}`;
      await tx`update private.forum_posts set body='[Removed by account deletion]',deleted_at=now() where author_id=${account}`;
      await tx`update private.forum_audit set detail='{}' where target_id in (select id from private.forum_posts where author_id=${account})`;
    });
    const { error } = await supabase.auth.admin.deleteUser(account);
    if (error)
      throw new Error(
        "Account removal was not confirmed; inspect the account before retrying.",
      );
    // Auth deletion cascades session data, preferences, private feedback, and this request.
    await sql`insert into private.admin_audit_log(admin_id,action,target_id) values(${adminId},'privacy_deletion_completed',${requestId})`;
    console.log(
      "Verified deletion completed. The audit trail is retained; provider backups follow their configured retention.",
    );
  } else {
    if (!values.output)
      throw new Error("--output must be a new protected directory.");
    const directory = resolve(values.output);
    await mkdir(directory, { mode: 0o700 });
    await mkdir(resolve(directory, "files"), { mode: 0o700 });
    const bundle: Record<string, unknown> = {
      request_id: requestId,
      exported_at: new Date().toISOString(),
    };
    for (const table of [
      "profiles",
      "tutoring_sessions",
      "learning_preferences",
    ])
      bundle[table] =
        await sql`select * from public.${sql(table)} where ${sql(table === "profiles" ? "id" : "account_id")}=${account}`;
    for (const table of [
      "documents",
      "document_pages",
      "problem_regions",
      "messages",
      "tutor_turns",
      "annotation_objects",
      "workspace_events",
      "workspace_snapshots",
      "learning_memories",
      "rubrics",
      "grading_reviews",
      "submissions",
      "feedback_question_sets",
    ])
      bundle[table] =
        await sql`select * from public.${sql(table)} where session_id in(select id from public.tutoring_sessions where account_id=${account})`;
    for (const table of [
      "session_feedback",
      "feedback_answers",
      "feedback_insights",
      "privacy_requests",
      "practice_quizzes",
    ])
      bundle[`private.${table}`] =
        await sql`select * from private.${sql(table)} where account_id=${account}`;
    for (const table of [
      "community_profiles",
      "staff_assignments",
      "test_completions",
      "billing_accounts",
      "billing_grants",
      "usage_ledger",
    ])
      bundle[`private.${table}`] =
        await sql`select * from private.${sql(table)} where account_id=${account}`;
    if (
      (
        await sql`select to_regclass('private.free_guard_observations') is not null as available`
      )[0].available
    ) {
      // Own signals only; shared identifiers and other accounts' identities are excluded.
      bundle["private.free_guard_observations"] =
        await sql`select browser,created_at,expires_at from private.free_guard_observations where account_id=${account}`;
      bundle["private.free_guard_associations"] =
        await sql`select state,first_seen,last_seen from private.free_guard_pairs where account_a=${account} or account_b=${account}`;
      bundle["private.free_guard_appeals"] =
        await sql`select reason,status,created_at,resolved_at from private.free_guard_appeals where account_id=${account}`;
    }
    for (const table of ["forum_threads", "forum_posts"])
      bundle[`private.${table}`] =
        await sql`select * from private.${sql(table)} where author_id=${account}`;
    bundle["private.forum_attachments"] =
      await sql`select * from private.forum_attachments where owner_id=${account}`;
    const manifest = [];
    for (let i = 0; i < files.length; i++) {
      const { data, error } = await bucket.download(files[i]);
      if (error || !data)
        throw new Error(
          "Export incomplete. Private output directory must be reviewed or securely removed.",
        );
      const name = `asset-${i + 1}`;
      await writeFile(
        resolve(directory, "files", name),
        new Uint8Array(await data.arrayBuffer()),
        { mode: 0o600, flag: "wx" },
      );
      manifest.push({ name, storage_path: files[i], mime: data.type });
    }
    for (let i = 0; i < communityFiles.length; i++) {
      const { data, error } = await community.download(communityFiles[i]);
      if (error || !data)
        throw new Error(
          "Export incomplete. Community files could not be downloaded.",
        );
      const name = `community-asset-${i + 1}`;
      await writeFile(
        resolve(directory, "files", name),
        new Uint8Array(await data.arrayBuffer()),
        { mode: 0o600, flag: "wx" },
      );
      manifest.push({ name, storage_path: communityFiles[i], mime: data.type });
    }
    bundle.assets = manifest;
    await writeFile(
      resolve(directory, "account.json"),
      JSON.stringify(bundle, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    await sql`insert into private.admin_audit_log(admin_id,action,target_id) values(${adminId},'privacy_access_package_created',${requestId})`;
    console.log(
      "Private access package created. Deliver only through a verified secure channel, then record fulfillment in the staff queue and remove the local package.",
    );
  }
} catch (e) {
  console.error(
    e instanceof Error &&
      /^(Configure|Pause|A |The |--|Storage|Account|Export|A different)/.test(
        e.message,
      )
      ? e.message
      : "Governance command failed. Inspect configuration and request state without exposing secrets.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
