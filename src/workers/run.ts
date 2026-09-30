import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, accountTx } from "../lib/server/db";
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function loop() {
  while (!stopped) {
    const job = await db().begin(async (tx) => {
      await tx`set local role scriblune_server`;
      const row = (
        await tx`select * from public.processing_jobs where (status='queued' or (status='running' and locked_until<now())) and attempts<3 order by (kind='ingest') desc,created_at for update skip locked limit 1`
      )[0];
      if (row)
        await tx`update public.processing_jobs set status='running',attempts=attempts+1,locked_until=now()+interval '4 minutes' where id=${row.id}`;
      return row;
    });
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
          stdio: "ignore",
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
  await db().end();
}
loop().catch(() => {
  process.stderr.write(
    "Worker cannot connect. Check database configuration.\n",
  );
  process.exitCode = 1;
});
