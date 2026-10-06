import { spawn } from "node:child_process";

/** The mail child stays inside the web container and receives only its needs. */
export function accessMailEnvironment(environment) {
  return Object.fromEntries(
    [
      "PATH",
      "TMPDIR",
      "TZ",
      "NODE_ENV",
      "AUTH_SECRET",
      "DATABASE_URL",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
      "ACCOUNT_EMAILS_ENABLED",
    ]
      .filter((key) => environment[key] !== undefined)
      .map((key) => [key, environment[key]]),
  );
}

/** One child failing is a failed web service, so Docker restarts both. */
export function superviseWeb(
  commands,
  {
    spawnChild = spawn,
    signals = process,
    finish = /** @type {(code: number) => void} */ (
      (code) => process.exit(code)
    ),
    graceMs = 195_000,
    log = (message) => process.stderr.write(message + "\n"),
  } = {},
) {
  const children = new Set();
  let stopping = false,
    finished = false,
    exitCode = 0,
    timer;
  function complete() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signals.off("SIGTERM", terminate);
    signals.off("SIGINT", interrupt);
    finish(exitCode);
  }
  function stop(signal, failed = false) {
    if (failed) exitCode = 1;
    if (stopping) return;
    stopping = true;
    if (!children.size) return complete();
    timer = setTimeout(() => {
      exitCode = 1;
      for (const child of children) child.kill("SIGKILL");
      complete();
    }, graceMs);
    for (const child of children) child.kill(signal);
  }
  function terminate() {
    stop("SIGTERM");
  }
  function interrupt() {
    stop("SIGINT");
  }
  signals.on("SIGTERM", terminate);
  signals.on("SIGINT", interrupt);
  for (const command of commands) {
    if (stopping) break;
    try {
      const child = spawnChild(process.execPath, command.args, {
        cwd: command.cwd,
        env: command.env,
        stdio: "inherit",
      });
      children.add(child);
      child.once("error", () => {
        log(`web_runtime: ${command.name} could not start.`);
        stop("SIGTERM", true);
      });
      child.once("close", () => {
        children.delete(child);
        if (!stopping) {
          log(`web_runtime: ${command.name} exited unexpectedly.`);
          stop("SIGTERM", true);
        } else if (!children.size) complete();
      });
    } catch {
      log(`web_runtime: ${command.name} could not start.`);
      stop("SIGTERM", true);
    }
  }
  return { stop: terminate };
}
