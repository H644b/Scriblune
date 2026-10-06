import { readFile, writeFile, mkdtemp, cp, rm, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const root = process.cwd();
const local = existsSync(".env.local")
  ? parseEnv(await readFile(".env.local", "utf8"))
  : {};
const deploy = existsSync(".env.deploy.local")
  ? parseEnv(await readFile(".env.deploy.local", "utf8"))
  : {};
const config = { ...local, ...deploy, ...process.env };
const check = process.argv.includes("--check");
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "SUPABASE_SECRET_KEY",
  "OPENAI_API_KEY",
  "AI_TUTOR_MODEL",
  "AI_REVIEW_MODEL",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "AUTH_SECRET",
  "SUPPORT_EMAIL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRODUCT_ID",
  "STRIPE_PORTAL_CONFIGURATION_ID",
  "STRIPE_CHANGE_CONFIGURATIONS",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
];
const missing = required.filter((k) => !config[k]);
if (
  config.STRIPE_SECRET_KEY &&
  !config.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith(
    config.STRIPE_SECRET_KEY.startsWith("sk_live_") ? "pk_live_" : "pk_test_",
  )
)
  throw new Error(
    "Stripe secret and publishable keys must use the same payment mode.",
  );
if (
  !check &&
  config.STRIPE_SECRET_KEY &&
  config.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
) {
  await run(
    process.execPath,
    ["--import", "tsx", "scripts/configure-billing.ts", "--ensure"],
    {
      env: {
        ...process.env,
        ...config,
        BILLING_SITE_URL:
          config.APP_PUBLIC_URL ||
          config.NEXT_PUBLIC_SITE_URL ||
          "https://scriblune.com",
      },
    },
  );
  const refreshed = parseEnv(await readFile(".env.local", "utf8"));
  Object.assign(config, refreshed, deploy, process.env);
  for (const key of [
    "STRIPE_PRODUCT_ID",
    "STRIPE_PORTAL_CONFIGURATION_ID",
    "STRIPE_CHANGE_CONFIGURATIONS",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_WEBHOOK_ENDPOINT_ID",
    "STRIPE_CATALOG_MODE",
  ])
    if (refreshed[key]) config[key] = refreshed[key];
  missing.splice(0, missing.length, ...required.filter((k) => !config[k]));
}
if (missing.length)
  throw new Error(
    `Missing server configuration: ${missing.join(", ")}. Set it locally; never commit secrets.`,
  );
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: "inherit", ...options });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${code}).`)),
    );
  });
}
function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${command} failed (${code}).`)),
    );
  });
}
async function waitForHealth(url, headers = {}) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok && (await response.json()).ok === true) return true;
    } catch {
      // First-deployment certificates and domain routes can take a moment.
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return false;
}
await run("npm", ["run", "typecheck"]);
await run("npm", ["test"]);
if (check) {
  await run("npm", ["run", "build"]);
  await run("npx", ["wrangler", "deploy", "--dry-run"]);
  console.log(
    "Local production build and free Cloudflare Worker bundle verified. Remote deployment and email delivery are separate checks.",
  );
  process.exit(0);
}
for (const key of ["DEPLOY_HOST", "DEPLOY_DIR", "APP_ORIGIN", "APP_PUBLIC_URL"])
  if (!config[key] || config[key].includes("YOUR_"))
    throw new Error(
      `Set ${key} in .env.deploy.local. See docs/deployment.md. Your Oracle VM must be ready before publishing.`,
    );
if (
  !/^[a-zA-Z0-9_.@:-]+$/.test(config.DEPLOY_HOST) ||
  !/^\/[a-zA-Z0-9_./-]+$/.test(config.DEPLOY_DIR) ||
  config.DEPLOY_DIR.includes("..")
)
  throw new Error("Invalid SSH host or deployment directory.");
const origin = new URL(config.APP_ORIGIN),
  publicURL = new URL(config.APP_PUBLIC_URL);
if (
  [origin, publicURL].some(
    (u) =>
      u.protocol !== "https:" ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      u.username ||
      u.password,
  ) ||
  origin.host === publicURL.host
)
  throw new Error(
    "Set distinct HTTPS origins without paths for APP_ORIGIN and APP_PUBLIC_URL.",
  );
const keyArgs = config.DEPLOY_SSH_KEY ? ["-i", config.DEPLOY_SSH_KEY] : [];
const sshArgs = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  ...keyArgs,
  config.DEPLOY_HOST,
];
await run("ssh", [
  ...sshArgs,
  "docker version >/dev/null && docker compose version >/dev/null",
]);
if (!config.ORIGIN_AUTH_SECRET) {
  config.ORIGIN_AUTH_SECRET = randomBytes(32).toString("hex");
  await writeFile(
    ".env.deploy.local",
    (existsSync(".env.deploy.local")
      ? await readFile(".env.deploy.local", "utf8")
      : "") + `\nORIGIN_AUTH_SECRET=${config.ORIGIN_AUTH_SECRET}\n`,
    { mode: 0o600 },
  );
  await chmod(".env.deploy.local", 0o600);
}
const release = new Date().toISOString().replace(/[^0-9]/g, ""),
  directory = `${config.DEPLOY_DIR}/releases/${release}`;
const stage = await mkdtemp(join(tmpdir(), "scriblune-deploy-"));
await chmod(stage, 0o700);
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
// Provision a separate key on the VM itself. The private key never crosses SSH,
// enters a build context, or appears in an environment variable/browser bundle.
const consoleKeyDir = `${config.DEPLOY_DIR}/console`;
const consoleUser = await capture("ssh", [...sshArgs, "id -un"]);
if (!/^[a-z_][a-z0-9_-]*$/.test(consoleUser))
  throw new Error("Unexpected VM account name.");
const consolePublicKey = await capture("ssh", [
  ...sshArgs,
  `set -e
umask 077
mkdir -p ${quote(consoleKeyDir)} ~/.ssh
chmod 700 ${quote(consoleKeyDir)} ~/.ssh
if [ ! -f ${quote(consoleKeyDir + "/owner_ed25519")} ]; then
 ssh-keygen -q -t ed25519 -N '' -C scriblune-owner-console -f ${quote(consoleKeyDir + "/owner_ed25519")}
fi
chmod 600 ${quote(consoleKeyDir + "/owner_ed25519")}
subnet=$(docker network inspect scriblune_default --format '{{(index .IPAM.Config 0).Subnet}}' 2>/dev/null || true)
if [ -z "$subnet" ]; then docker network create --label com.docker.compose.project=scriblune --label com.docker.compose.network=default scriblune_default >/dev/null; subnet=$(docker network inspect scriblune_default --format '{{(index .IPAM.Config 0).Subnet}}'); fi
python3 - ${quote(consoleKeyDir)} "$subnet" <<'PY'
import pathlib, sys, ipaddress
key_dir = pathlib.Path(sys.argv[1])
subnet = str(ipaddress.ip_network(sys.argv[2]))
authorized = pathlib.Path.home() / '.ssh' / 'authorized_keys'
public = (key_dir / 'owner_ed25519.pub').read_text().strip()
lines = authorized.read_text().splitlines() if authorized.exists() else []
lines = [line for line in lines if not line.endswith(' scriblune-owner-console')]
lines.append('restrict,pty,from="' + subnet + '" ' + public)
authorized.write_text('\\n'.join(lines) + '\\n')
authorized.chmod(0o600)
PY
cat /etc/ssh/ssh_host_ed25519_key.pub`,
]);
const hostParts = consolePublicKey.split(/\s+/);
if (
  hostParts[0] !== "ssh-ed25519" ||
  !/^[A-Za-z0-9+/=]+$/.test(hostParts[1] || "")
)
  throw new Error("Could not read the trusted VM SSH host key.");
const { createHash } = await import("node:crypto");
const consoleFingerprint = createHash("sha256")
  .update(Buffer.from(hostParts[1], "base64"))
  .digest("hex");
const envFile = (values) =>
  Object.entries(values)
    .map(([k, v]) => {
      if (/[\r\n\0]/.test(v)) throw new Error(`${k} must be a single line`);
      return `${k}=${v}`;
    })
    .join("\n") + "\n";
try {
  for (const item of [
    "src",
    "public",
    "scripts",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "next-env.d.ts",
    "tsconfig.json",
    "Dockerfile",
    ".dockerignore",
  ])
    await cp(join(root, item), join(stage, item), { recursive: true });
  await cp("deploy/compose.yaml", join(stage, "compose.yaml"));
  await cp("deploy/Caddyfile", join(stage, "Caddyfile"));
  const web = Object.fromEntries(required.map((k) => [k, config[k]]));
  Object.assign(web, {
    NEXT_PUBLIC_SITE_URL: publicURL.origin,
    CLOUDFLARE_DEPLOYMENT: "true",
    ORIGIN_AUTH_SECRET: config.ORIGIN_AUTH_SECRET,
    CONSOLE_SSH_HOST: "host.docker.internal",
    CONSOLE_SSH_USER: consoleUser,
    CONSOLE_SSH_KEY_FILE: "/run/scriblune-console/owner_ed25519",
    CONSOLE_SSH_HOST_SHA256: consoleFingerprint,
  });
  const worker = Object.fromEntries(
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "DATABASE_URL",
      "SUPABASE_SECRET_KEY",
      "OPENAI_API_KEY",
      "AI_TUTOR_MODEL",
      "AI_REVIEW_MODEL",
    ].map((k) => [k, config[k]]),
  );
  await writeFile(join(stage, "runtime.web.env"), envFile(web), {
    mode: 0o600,
  });
  await writeFile(join(stage, "runtime.worker.env"), envFile(worker), {
    mode: 0o600,
  });
  await writeFile(
    join(stage, "runtime.edge.env"),
    envFile({
      ORIGIN_HOSTNAME: origin.hostname,
      ORIGIN_AUTH_SECRET: config.ORIGIN_AUTH_SECRET,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(stage, "compose.env"),
    envFile({
      RELEASE_TAG: release,
      CONSOLE_KEY_DIR: consoleKeyDir,
      NEXT_PUBLIC_SUPABASE_URL: web.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        web.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_SITE_URL: publicURL.origin,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
        web.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      SUPPORT_EMAIL: web.SUPPORT_EMAIL,
    }),
    { mode: 0o600 },
  );
  await run("ssh", [...sshArgs, `umask 077; mkdir -p ${quote(directory)}`]);
  await run("scp", [
    "-q",
    "-r",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    ...keyArgs,
    `${stage}/.`,
    `${config.DEPLOY_HOST}:${directory}/`,
  ]);
  const compose = "docker compose --env-file compose.env";
  await run("ssh", [
    ...sshArgs,
    `cd ${quote(directory)} && ${compose} build web`,
  ]);
  const activate = `set -e\ncd ${quote(directory)}\nif ! ${compose} up -d --wait --wait-timeout 180; then\n if [ -L ${quote(config.DEPLOY_DIR + "/current")} ]; then cd ${quote(config.DEPLOY_DIR + "/current")}; ${compose} up -d --wait; fi\n exit 1\nfi\nln -sfn ${quote(directory)} ${quote(config.DEPLOY_DIR + "/current")}`;
  await run("ssh", [...sshArgs, activate]);
  console.log("Checking origin HTTPS while its certificate becomes available…");
  const health = await waitForHealth(new URL("/api/health", origin), {
    "X-Scriblune-Origin": config.ORIGIN_AUTH_SECRET,
  });
  if (!health)
    throw new Error(
      "Origin HTTPS health check failed. Cloudflare has not been changed. Check DNS and the VM firewall.",
    );
  const secrets = join(stage, "worker-secrets.json");
  await writeFile(
    secrets,
    JSON.stringify({
      APP_ORIGIN: origin.origin,
      APP_PUBLIC_URL: publicURL.origin,
      ORIGIN_AUTH_SECRET: config.ORIGIN_AUTH_SECRET,
    }),
    { mode: 0o600 },
  );
  const args = ["wrangler", "deploy", "--secrets-file", secrets];
  if (!publicURL.hostname.endsWith(".workers.dev"))
    args.push("--domain", publicURL.hostname);
  await run("npx", args);
  console.log("Checking the public Cloudflare route…");
  const edge = await waitForHealth(new URL("/api/health", publicURL));
  if (!edge)
    throw new Error(
      "Origin is healthy but the public Worker health check failed. Check Worker routes/DNS.",
    );
  console.log(
    `Deployed ${publicURL.origin}. Native app and background worker run on the VM; the Cloudflare edge uses the Free plan.`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
