/** Offline operator command. Never import this privileged connection into the app. */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
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
async function paths(prefix: string): Promise<string[]> {
  const result: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error)
      throw new Error("Storage listing failed. Nothing was marked complete.");
    for (const file of data || []) {
      const path = `${prefix}/${file.name}`;
      if (!file.id) result.push(...(await paths(path)));
      else result.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return result;
}
try {
  const member = (
    await sql`select role from private.admin_memberships where account_id=${adminId}`
  )[0];
  if (member?.role !== "admin")
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
  if (action === "delete") {
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await bucket.remove(files.slice(i, i + 100));
      if (error)
        throw new Error(
          "Storage removal incomplete; rerun after resolving the error.",
        );
    }
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
    ])
      bundle[`private.${table}`] =
        await sql`select * from private.${sql(table)} where account_id=${account}`;
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
