/** Offline owner inbox bridge. Reuses existing operator credentials; never ships them. */
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import postgres from "postgres";
import { z } from "zod";
import {
  operatorThread,
  pendingRequests,
  postOperatorReply,
} from "./owner-inbox-store";
const { values } = parseArgs({
  options: {
    action: { type: "string" },
    thread: { type: "string" },
    after: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const action = z
  .enum(["read", "thread", "reply"])
  .parse(values.action || "read");
function operatorConnection() {
  try {
    const env = {
      ...parseEnv(readFileSync(".env.local", "utf8")),
      ...parseEnv(readFileSync(".env.operator.local", "utf8")),
    };
    const expected = "tietqqrcafdmehjsuqks",
      url = z.string().min(1).parse(env.GOVERNANCE_DATABASE_URL),
      connection = new URL(url);
    if (
      new URL(z.string().parse(env.NEXT_PUBLIC_SUPABASE_URL)).hostname !==
        `${expected}.supabase.co` ||
      !(
        connection.username.endsWith(`.${expected}`) ||
        connection.hostname === `db.${expected}.supabase.co`
      )
    )
      throw new Error();
    return url;
  } catch {
    throw new Error(
      "The existing Scriblune operator configuration is missing or does not match the project.",
    );
  }
}
const sql = postgres(operatorConnection(), {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => {},
});
try {
  let input: unknown;
  if (action === "reply") {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 64000) throw new Error("Reply exceeds 64 KB.");
      chunks.push(buffer);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const result = await sql.begin(async (tx) => {
    if (action !== "reply") await tx`set transaction read only`;
    await tx`set local statement_timeout='10s'`;
    const [principal] = await tx`select current_user`;
    if (principal.current_user !== "postgres")
      throw new Error("Existing operator connection required.");
    if (action === "read") {
      const rows = await pendingRequests(tx);
      return {
        threads: rows.slice(0, 20),
        hasMore: rows.length > 20,
        readOnly: true,
      };
    }
    if (action === "thread")
      return operatorThread(
        tx,
        z.uuid().parse(values.thread),
        values.after || "0",
      );
    return postOperatorReply(tx, input, values["dry-run"]);
  });
  console.log(JSON.stringify(result));
} catch (error) {
  // Avoid printing database error objects, connection URLs, SQL, or credentials.
  console.error(
    error instanceof z.ZodError
      ? "Invalid owner inbox input."
      : "Owner inbox command failed; check input, access, and connectivity. No success was confirmed.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
