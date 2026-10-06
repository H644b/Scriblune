import { writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, accountTx } from "../lib/server/db";
import { communityStorage } from "../lib/server/community-media";
import {
  runOwnerNotifications,
  processorEnvironment,
} from "./owner-notifications";
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function loop() {
  let cleanedAt = 0;
  while (!stopped) {
    const job = await db().begin(async (tx) => {
      await tx`set local role scriblune_server`;
      if (Date.now() - cleanedAt > 3_600_000) {
        await tx`delete from private.auth_challenges where expires_at<now()-interval '1 day'`;
        await tx`delete from private.auth_rate_limits where expires_at<now()-interval '1 day'`;
        const abandoned =
          await tx`select id,path from private.forum_attachments where post_id is null and created_at<now()-interval '1 day' limit 100`;
        if (abandoned.length) {
          const { error } = await communityStorage().remove(
            abandoned.map((a) => a.path),
          );
          if (!error)
            await tx`delete from private.forum_attachments where id=any(${abandoned.map((a) => a.id)}::uuid[]) and post_id is null`;
        }
        cleanedAt = Date.now();
      }
      const row = (
        await tx`select * from public.processing_jobs where (status='queued' or (status='running' and locked_until<now())) and attempts<3 and not exists(select 1 from private.account_access_holds h where h.account_id=processing_jobs.account_id) order by (kind='ingest') desc,created_at for update skip locked limit 1`
      )[0];
      if (row)
        await tx`update public.processing_jobs set status='running',attempts=attempts+1,locked_until=now()+interval '4 minutes' where id=${row.id}`;
      return row;
    });
    if (process.env.NODE_ENV === "production")
      await writeFile("/tmp/scriblune-worker-health", "ok");
    if (!job) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    await new Promise<void>((resolve) => {
      const child = fork(
        fileURLToPath(new URL("./processor.ts", import.meta.url)),
        [job.id, job.account_id],
        {
          execArgv: ["--import", "tsx", "--max-old-space-size=512"],
          env: processorEnvironment(),
          // Forward content-free ai_usage records from indexing subprocesses.
          stdio: ["ignore", "inherit", "ignore", "ipc"],
        },
      );
      const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
      child.on("exit", async (code) => {
        clearTimeout(timer);
        if (code !== 0)
          await accountTx(job.account_id, async (tx) => {
            await tx`update public.processing_jobs set status='failed',error='Processing timed out or exceeded its limits. Original file preserved.',locked_until=null where id=${job.id} and status='running'`;
            if (job.kind === "ingest")
              await tx`update public.documents set status='failed',error='Processing did not complete. Original file preserved.' where id=${job.document_id} and status='processing'`;
          }).catch(() => {});
        resolve();
      });
    });
  }
}
async function run() {
  const notifications = runOwnerNotifications(() => stopped).catch(() => {
    process.stderr.write(
      "owner_notification_worker: unavailable; delivery remains queued.\n",
    );
  });
  try {
    await loop();
  } finally {
    stopped = true;
    await notifications;
    await db().end();
  }
}
run().catch(async () => {
  process.stderr.write(
    "Worker cannot connect. Check database configuration.\n",
  );
  await db()
    .end({ timeout: 5 })
    .catch(() => {});
  process.exitCode = 1;
});
