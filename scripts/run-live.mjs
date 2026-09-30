import { spawn } from "node:child_process";
if (
  !process.env.OPENAI_API_KEY ||
  !process.env.AI_TUTOR_MODEL ||
  !process.env.AI_REVIEW_MODEL
) {
  console.error(
    "Configure OPENAI_API_KEY, AI_TUTOR_MODEL, and AI_REVIEW_MODEL first.",
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/integration/database.test.ts",
    "-t",
    "live model",
  ],
  { stdio: "inherit", env: { ...process.env, RUN_LIVE_AI: "1" } },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
