import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { db } from "../src/lib/server/db";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "DATABASE_URL",
  "SUPABASE_SECRET_KEY",
  "OPENAI_API_KEY",
  "AI_TUTOR_MODEL",
  "AI_REVIEW_MODEL",
];
let failed = false;
for (const name of required) {
  const present = Boolean(process.env[name]);
  console.log(`${present ? "OK" : "MISSING"} ${name}`);
  if (!present) failed = true;
}
console.log(
  `Adult pilot: ${process.env.ALLOW_ADULT_PILOT === "true" ? "enabled" : "closed"}`,
);
console.log(
  `Support contact: ${process.env.SUPPORT_EMAIL ? "configured" : "not configured"}`,
);
if (process.argv.includes("--live")) {
  if (process.env.DATABASE_URL) {
    try {
      const sql = db();
      const [identity] =
        await sql`select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
      if (
        identity.rolsuper ||
        identity.rolbypassrls ||
        identity.name === "postgres"
      )
        throw new Error("Use a restricted application login.");
      await sql.begin(async (tx) => {
        await tx`set local role scriblune_server`;
        await tx`select id from public.tutoring_sessions limit 0`;
        await tx`select id from private.session_feedback limit 0`;
        const [grants] =
          await tx`select has_table_privilege(current_user,'public.submissions','UPDATE,DELETE') as mutable`;
        if (grants.mutable) throw new Error("Immutable privileges failed.");
      });
      console.log("OK restricted database connection and migrated schema");
    } catch {
      failed = true;
      console.log(
        "FAILED database access, migration, or least-privilege validation",
      );
    } finally {
      await db().end();
    }
  }
  if (process.env.SUPABASE_SECRET_KEY) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY,
        { auth: { persistSession: false } },
      );
      const { data, error } =
        await supabase.storage.getBucket("scriblune-private");
      if (error || !data || data.public) throw new Error("Storage");
      console.log("OK private storage bucket");
    } catch {
      failed = true;
      console.log("FAILED private storage bucket check");
    }
  }
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 15000,
    });
    for (const name of ["AI_TUTOR_MODEL", "AI_REVIEW_MODEL"]) {
      if (!process.env[name]) continue;
      try {
        await client.models.retrieve(process.env[name]!);
        console.log(
          `OK ${name} accessible (multimodal/tool correctness still requires evaluation)`,
        );
      } catch {
        failed = true;
        console.log(`FAILED ${name} access`);
      }
    }
  }
}
process.exitCode = failed ? 1 : 0;
