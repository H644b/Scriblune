# Cloudflare Free edge + native Oracle VM

`npm run deploy` builds and starts the native app and persistent document worker on a Linux VM, verifies its HTTPS health, then publishes the small Cloudflare Worker. No paid Cloudflare Containers, Durable Objects, Browser Rendering, or OpenNext runtime is required. PDF.js, sharp, native canvas, Postgres connections, and long-running jobs remain in Node.

## One-time setup

1. Create an **Always Free eligible A1 Flex** Arm VM in your Oracle home region, using Ubuntu or Oracle Linux 9. Stay within the account's free compute and boot-volume allocation. The Scriblune VM uses 1 OCPU and 6 GB memory; E5 Flex is not a replacement within this free setup. Keep your SSH key locally. Account verification, available capacity, and the VM itself must be supplied by the operator.
2. Install Docker Engine and the Compose plugin using the [Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/) or the [RHEL-compatible packages](https://docs.docker.com/engine/install/rhel/) on Oracle Linux 9. Verify the published repository signing-key fingerprint before importing it. Compose 2.30 or later is required for raw environment files. The SSH user must be able to run `docker` without an interactive sudo prompt. Docker must start on boot. The Caddyfile bind mount has a private SELinux label for Oracle Linux.
3. Allow inbound TCP 80 and 443 in both the Oracle security list/network security group and the VM firewall. Restrict SSH to your administration network. Do not expose container port 3000 or Postgres.
4. In Cloudflare DNS, create a **DNS-only** A record `origin.scriblune.com` pointing to the VM's public IP. Caddy obtains and renews its HTTPS certificate. Ordinary requests to this origin are denied; the edge supplies a separate origin secret.
5. Copy `.env.deploy.example` to `.env.deploy.local` and fill in `DEPLOY_HOST`, `DEPLOY_DIR`, and optionally `DEPLOY_SSH_KEY`. Keep `APP_ORIGIN=https://origin.scriblune.com` and `APP_PUBLIC_URL=https://scriblune.com`, or supply your actual distinct HTTPS domains. Confirm the VM's SSH host-key fingerprint through Oracle before adding it to your local known hosts. Deployment uses strict host-key checking.
6. Keep the application settings in `.env.local`. Required: the public Supabase URL/key, restricted `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, both AI model IDs, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AUTH_SECRET`, and `SUPPORT_EMAIL`. The configured sender is `Scriblune <verify@mail.scriblune.com>`. Keep `AUTH_SECRET` stable across releases. Never deploy `.env.operator.local` or an operator database login.
7. Apply every reviewed Supabase migration; the email-security migration must be present. Keep email confirmation enabled. Set Supabase's site URL to the public origin and allow its `/auth/callback`. Log into the intended Cloudflare account with `npx wrangler login`; `scriblune.com` must be in that account. Review an existing domain route before replacing it.

```sh
npm run deploy:check   # Typecheck, offline tests, production build, Worker dry run
npm run deploy        # Deploy the VM services, then the Cloudflare Free Worker
```

The deployment script generates and preserves `ORIGIN_AUTH_SECRET` in the ignored deployment settings. It copies an explicit source allowlist and separate runtime environment files over SSH. Only public build variables enter the image. The background worker receives only its database, storage, and AI settings. The Cloudflare Worker receives only the origin/public URLs and origin secret. The privileged governance connection stays local.

The Owner's browser console uses a separate VM-generated SSH key, mounted read-only only into the web container, with its source restricted to the Docker subnet. Deployment pins the VM's Ed25519 host key from the already trusted operator SSH connection. Apply both the `owner_console_session_check` and `owner_console_session_view` migrations before deploying this feature. See [console operations and key rotation](operations.md#owner-vm-console). The console uses authenticated bounded HTTPS long polling through the Free Worker; SSH and its PTYs remain on the VM.

The remote release lives under `DEPLOY_DIR/releases/TIMESTAMP`; `DEPLOY_DIR/current` points to the active release. Containers have memory limits, rotated logs, health checks, and restart policies. The app and worker share one native image built on the VM's architecture. Caddy streams SSE without response buffering. Deployment waits for healthy containers and restores the prior Compose release if service activation fails. Single-VM updates can briefly interrupt requests; saved work and jobs remain in Supabase.

## Verify after the first deployment

- Check `/api/health` through the public domain; direct origin access without its secret must return 403.
- Sign up with a real mailbox, enter its code, enable email two-step in Account settings, sign out, and verify that the next login requires a new code.
- Upload the fixture PDF and screenshot, wait for the native worker, request a written explanation, stop/reload, and export a PDF. Test the exact deployed Linux image; the local macOS build does not prove Linux native-library compatibility.
- On the VM, run `docker compose --env-file compose.env ps` from `DEPLOY_DIR/current`. Inspect sanitized logs and processing failures. Do not print runtime environment files into logs or support messages.
- Retain a known-good release for rollback. To restore it, run Compose `up -d --wait` from its release directory and update the `current` symlink. Review and prune old images/releases periodically; runtime files contain secrets and must retain private permissions.

## Free-tier limits and availability

This preserves the processing architecture, but it is not equivalent to a paid hosting availability guarantee. Oracle's current Always Free allocation includes 2 Arm OCPUs and 12 GB memory; capacity is not guaranteed and idle VMs can be reclaimed. Cloudflare Workers Free has a 100,000-request daily limit and a 10 ms CPU allowance per invocation. The proxy streams requests and does no conversion or AI computation. Static asset requests and polling still count toward usage. See [Oracle's Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Supabase, Resend, and OpenAI have their own quotas and charges; free hosting does not make AI calls free. Configure budgets and monitor usage. Establish backups, recovery, retention, support ownership, and any required guardian/school consent procedures before inviting children. Educator suitability approval and email verification do not implement those procedures.

## Deployed September 30, 2026

[Scriblune](https://scriblune.com) is live. The privacy inbox refresh deployed with native release `20260930121743061` and Cloudflare Worker version `8b8cadba-ede2-463c-9d54-6551fc54289e` using `npm run deploy`. The VM runs Oracle Linux 9.8 on A1 Flex, 1 OCPU / 6 GB RAM. Docker starts on boot; web and worker health checks pass. Runtime secret files have mode 0600. Oracle ingress and the host firewall allow TCP 80/443; the origin has a valid certificate and returns 403 without the edge secret. Public HTTP redirects to HTTPS, and session cookies use Secure on the public domain.

The complete public-domain acceptance journey passed with the local worker stopped: native PDF and screenshot ingestion, authenticated workspace, streamed AI drawing, persistence, rubric review, submission, PDF/recap export, and cross-account/private-feedback access controls. Public signup sent a verification email through Resend's test inbox, set a Secure HttpOnly challenge cookie, and denied unverified access. Synthetic accounts and files were removed. Personal mailbox placement remains a separate check.

The first publication encountered a stale macOS NXDOMAIN cache. Tests used the current public DNS answer while retaining the real hostname and normal TLS certificate validation; Brave also opened the HTTPS site normally. If a fresh domain still appears unresolved locally, verify public DNS and allow the local negative cache to expire. Deployment does not disable TLS validation.

## Billing release preparation (September 30, 2026)

Monthly plans, the credit ring, signed-in homepage avatars, Owner grants, and Off / Staff only / Customers checkout access deployed in native release `20260930213012046`, Cloudflare version `d90d2494-64d5-46fc-ac16-4b08ce929384`. All seven public-domain billing journeys passed, including a real Stripe test-card confirmation and Stripe’s actual signed webhook delivery through Cloudflare. Synthetic accounts and provider customers were removed.

The Owner subsequently requested final release copy and will supply live keys and redeploy personally. That final revision is prepared locally: test/no-charge notices are removed; the production build, mobile checkout preview, and 86 unit/integration tests pass. The database migration preventing test subscriptions from becoming live entitlements is applied. `npm run deploy` now provisions or verifies the matching Stripe catalog and webhook before deployment. Replace both Stripe keys in `.env.local`; retain the generated `STRIPE_CATALOG_MODE` marker so deployment detects the transition. The earlier test keys remain privately backed up in ignored `.env.stripe-test.local`. Checkout access is currently Customers; the Owner can change it in Feedback & staff → Plans & credits. Real charging and live Stripe-account readiness have not been tested because no live keys were supplied. See [billing operations](billing.md).

Authenticator apps and passkeys use the existing `AUTH_SECRET` and private database. Keep `AUTH_SECRET` stable: changing it without migrating encrypted TOTP seeds prevents those authenticators from working. `NEXT_PUBLIC_SITE_URL` must be the exact HTTPS public origin for passkeys; deployments already derive it from `APP_PUBLIC_URL`. Passkeys enrolled on localhost do not work on the production domain. The migrations `20260930220310_authenticator_and_passkey_security.sql` and `20260930222915_console_authorization_roundtrip.sql` have been applied to the configured project; a new project must apply all migrations before this release starts. No additional paid service is required.

The console helper grants its invocation to the configured `scriblune_app` login. If a new installation uses a differently named non-inheriting login, grant that login USAGE on `private` and EXECUTE on `private.console_access(uuid,uuid,text)`; it must already be a member allowed to SET ROLE `scriblune_server`. Do not grant this helper to browser roles or change it to SECURITY DEFINER.
