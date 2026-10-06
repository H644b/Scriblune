import { runAccessMail } from "../lib/server/access-mail-dispatcher";
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
runAccessMail(shutdown.signal)
  .catch(() => {
    process.stderr.write("access_mail_dispatcher: stopped unexpectedly.\n");
    process.exitCode = 1;
  })
  .finally(() => {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  });
