# Setup and operations

## Supabase

Target project: `tietqqrcafdmehjsuqks`. The publishable URL/key are in `.env.example`. The MCP connector denied project access. An authorized operator database connection was then supplied; the empty application schemas were inspected and the migrations were applied through the Supabase CLI. Application and community tables have RLS; browser Data API grants remain revoked. The restricted application login and private bucket were verified. Database advisors reported no warning/error issues.

1. Connect an authorized account and inspect the existing `public`, `private`, `auth`, and `storage` schemas. Preserve existing data. If names conflict, adapt the new migration after inspecting their definitions; do not reset the project or overwrite unrelated tables.
2. Review the migrations in `supabase/migrations/`, including `20260930050909_email_verification_and_security.sql`. The email-security migration adds server-only code challenges, session grants and rate limits, and revokes direct browser Data API access to application tables. The initial migration adds the application tables, composite owner/session relationships, RLS, protected server role, private feedback policies, immutable event/review/submission grants, and private bucket. It intentionally fails on conflicting existing tables or a preexisting public bucket of the same name.
3. Apply the reviewed migration using Supabase CLI `supabase db push --linked` after `supabase link --project-ref tietqqrcafdmehjsuqks`, or the authorized migration API. Inspect the migration list first. Never run `db reset` against this project.
4. Using an operator connection, create a dedicated application LOGIN with `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, and `NOCREATEROLE`, then grant it `scriblune_server`. Generate and store the password securely. Do not put a password in source code or shell history. `DATABASE_URL` must use that login, not `postgres`. It must be able to set its role locally; application queries run under the restricted role.
5. Keep `private` outside exposed Data API schemas. Leave feedback tables out of all Realtime publications. Never add browser bucket policies or mark the private bucket public.
6. Configure verified-email authentication and real email delivery. Set the site URL and allow `/auth/callback` on the exact development and production origins. Configure password-reset redirects. Do not enable unconfigured social providers; the app displays none.
7. Add `SUPABASE_SECRET_KEY` only to the server/worker secret environment. It is used for private Storage and server-side auth administration, including generating verification codes. Private tables use the restricted database connection.
8. The verified owner opens `/admin` → **Staff & roles** to assign roles by account email, revoke staff, create custom roles, and edit capabilities. Built-ins are reviewer, administrator, moderator, and tester; people can hold several roles. Owner identity is provisioned by an operator in `private.site_owners`, never by profile metadata or a public API. Existing legacy memberships were migrated; do not add new rows to `private.admin_memberships`.

The global job claimant deliberately sees the processing queue under the server role. Each processor then scopes work to the account and owned session; this privilege belongs only to the trusted worker/server connection.

## AI and launch settings

Set `OPENAI_API_KEY`, `AI_TUTOR_MODEL`, and `AI_REVIEW_MODEL`. Use a model with image input, strict function calls, and structured output. No model is configured by default. Run `npm run setup:check -- --live` and `npm run test:live`. Model-list access alone does not prove tutoring quality.

Set `NEXT_PUBLIC_SITE_URL` to the exact public origin and configure `SUPPORT_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `AUTH_SECRET`. Signup requires email verification. Supporting children requires the operator to establish applicable consent, provider agreements, retention, and support procedures; educator suitability approval does not itself establish those workflows.

Limits: 20 MB per upload, 30 pages per PDF, 24 million input pixels, 10 documents per session, 5,000 annotation objects, 30 review/export pages, 12 model tool rounds, 170-second tutor deadline, 180-second conversion deadline, and plan-specific daily session/prompt allowances. Size/page constants live in `ingestion/validation.ts`; do not change only the UI or bucket limit. The server enforces the daily allowances in `src/lib/plans.ts` using a private, account-locked usage ledger; the reset boundary is midnight UTC.

## Deploy with a Cloudflare Free edge

Follow [deployment.md](deployment.md). `npm run deploy` runs checks, builds a native Docker image on the Oracle VM, starts the web/worker/Caddy services, verifies origin HTTPS, and publishes the streaming Cloudflare Worker. `.env.deploy.local` supplies VM access and the two HTTPS domains. This requires no paid Cloudflare runtime features. Native conversion and the persistent worker run on the VM, not inside Workers.

The Dockerfile supplies one runtime image for both services. Only public variables enter the build; server secrets are injected through private runtime files. `.env.operator.local` is excluded. Containers restart after a process failure or host reboot. Verify the first deployed Linux image, DNS/TLS, and email delivery before opening access.

- Web: internal port 3000, `node server.js`; Caddy streams SSE and does not expose this port publicly.
- Worker: `node --import tsx src/workers/run.ts`; isolated children have a 512 MB JS heap and 180-second deadline. Both app and worker containers have 2 GB memory limits.
- Database: TLS session/transaction pooler supporting transactions and `SET LOCAL ROLE`; prepared statements disabled; up to eight connections per process.
- Storage: private Supabase bucket. The VM needs outbound HTTPS to Supabase, OpenAI and Resend.
- Health: public `/api/health` reveals only liveness. The worker's private timestamp confirms database polling. `npm run setup:check -- --live` performs privileged configuration checks locally.

Monitor sanitized request failures, worker queue age/failures, model error rates, and storage/database health. Do not record document text, model context, feedback bodies, tokens, or database URLs in telemetry. Conversion jobs have a lease and limited retry attempts; users can explicitly retry failed files. Polling and persisted events recover saved work after transient interruptions.

## Governed privacy requests

Users request access, correction, or deletion in `/account`. Privacy administrators use `/admin?tab=privacy` → Privacy requests to verify identity/scope and record a decision. The inbox shows recent request counts, status/type filters, account/request/detail search, and a separate review pane. Open requests appear first by default; closed decisions remain available through the filters. Review notes require at least ten characters, and unsuccessful saves preserve the draft. Counts and filters apply to the latest 200 requests returned by the existing endpoint. Verification is a staff process, not just possession of a session URL. Never mark a request fulfilled before completing it.

The normal app database role cannot delete immutable records or read arbitrary account feedback. Fulfillment uses a separate **offline operator-only** `GOVERNANCE_DATABASE_URL` in `.env.operator.local`, which must never be available to the web or document worker. It needs protected-table read access for access requests; Supabase Auth deletion performs account cascades. Preserve audit logs according to the operator's policy.

Pause web traffic and workers during fulfillment so no new uploads or jobs race deletion. Then, in a secured operator shell with environment secrets loaded:

```sh
GOVERNANCE_MAINTENANCE=true npm run privacy:admin -- --action export --request-id REQUEST_UUID --admin-id ADMIN_UUID --confirm ACCOUNT_UUID --output /secure/new-account-export
GOVERNANCE_MAINTENANCE=true npm run privacy:admin -- --action delete --request-id REQUEST_UUID --admin-id ADMIN_UUID --confirm ACCOUNT_UUID
```

Commands require an existing verified request of the matching type and protected `admin` membership. Exports create a new directory with 0700 permissions and files with 0600 permissions. They include original/rendered files and governed account data, including feedback, which ordinary student exports never contain. Deliver only through an identity-verified secure channel, record fulfillment, and remove the local package. The governance command does not email these exports; authentication emails are sent separately through Resend.

Deletion recursively removes the account's storage prefix, then deletes the auth account so owned records cascade, and records an audit event. If storage fails, the account remains pending; if auth deletion fails after storage removal, inspect and retry. The account does not disappear merely because a queue status changed. No automatic backup or provider-side erasure claim is made; fulfill those obligations through the corresponding providers. Correction requests require documented operator review and an audited outcome rather than unreviewed rewriting of submitted work.

## Community and testing

The `/forum` community is publicly readable. Participation requires a verified login, a unique username, and no active forum suspension. Staff badges are chosen per post: gray Owner with key, blue Mod with hammer, otherwise purple Staff with hardhat. Profile images default to a gray silhouette. Public response DTOs exclude email, raw account records, private sessions, reports, and audit logs.

`private.staff_roles` and `private.staff_assignments` hold server-enforced capabilities. Only an operator can change `private.site_owners`; the app has SELECT only. Owner controls prevent accidental loss of owner access. Revocation takes effect on the next request. Forum moderator access does not imply feedback or privacy access.

Community images and PDFs use the separate private `scriblune-community` bucket. Uploads are bounded, validated by bytes, and linked to a post only by their uploader. Images are re-encoded without metadata; PDFs download as attachments with sandbox and nosniff headers. Pending attachments expire after one day and are cleaned hourly by the persistent worker. Removed threads, replies and attachments disappear from public delivery, while moderators can inspect and restore them. Removal is not a database erasure; governed deletion additionally removes media and authored content, while audit metadata may remain.

The test lab creates real scratch sessions with optional algebra/writing fixtures. A tester can finish an owned session without a review. This stores an immutable `private.test_completions` snapshot, marks the session and feedback `is_test`, and never invents a readiness review or normal submission. Default feedback reports exclude tests; staff can explicitly filter to test feedback. Continued drafts preserve their test label. Ordinary submission gates remain unchanged.

Run `RUN_COMMUNITY_TESTS=1 TEST_BASE_URL=https://scriblune.com node --env-file=.env.local --env-file=.env.operator.local --import tsx tests/live/community-flow.ts` for real community acceptance. It creates temporary accounts, exercises UI and APIs, and cleans its own records/uploads. It makes no AI calls. A local production build must use the same `NEXT_PUBLIC_SITE_URL` as its test origin, because Next.js embeds this value at build time.

## Owner VM console

Open **Feedback & staff → VM console** (`/admin?tab=console`) and select **Connect to VM**. This is an interactive SSH PTY on the Oracle host as `opc`, including its existing sudo access. Keyboard input, pasted text, Ctrl+C, Tab completion, terminal resizing, and interactive programs work through the same HTTPS origin. Copy selection is explicit; remote clipboard escape sequences are blocked. Changing staff tabs, navigating away, or selecting Disconnect closes the shell. Use a separate SSH client for recovery if the app itself is down.

Only `private.site_owners` grants access. No staff role, editable metadata, or custom permission can grant a shell. Every input/read/resize/close request verifies the signed-in account, configured email 2FA, protected Owner membership, and an active matching `auth.sessions` row through `private.owner_login_sessions`. This view uses `security_invoker` and preserves underlying column permissions and RLS without requiring access to the hosted auth namespace. Terminals are also bound to the originating login. SQL grants only `id`, `user_id`, and `not_after`, with an Owner-only own-row policy; no refresh tokens or other auth fields are exposed. The server repeats the session check after long polling and every 15 seconds for open shells.

There is one terminal per Owner, a 10-minute input-idle timeout, a one-hour maximum, and a 60-second grace period after a disconnected browser. Deployments/restarts close active terminals. Unacknowledged output is held in bounded process memory with SSH backpressure; it is never persisted. Connection openings and closings go to `private.staff_audit`; automatic close events are best effort if the database is unavailable or ownership has already been revoked. Opening a shell requires a successful audit write. The VM shell can still use its ordinary history; Scriblune does not record commands or output in application logs or the database.

`npm run deploy` provisions a dedicated Ed25519 key under `DEPLOY_DIR/console`, mode 0600, and mounts that directory read-only into the web container only. Its authorized-key entry accepts connections from the app's Docker subnet and disables forwarding, agent forwarding, X11, and user SSH startup scripts while allowing a PTY. The key never enters an image, local deployment staging, Worker settings, or a browser. The VM host fingerprint comes from the existing strictly verified deployment SSH connection. The current VM and the web image use UID 1000; preserve this file ownership when changing the deployment account.

To revoke the console independently of deployment access, remove the `scriblune-owner-console` entry from the VM's `~/.ssh/authorized_keys`, then restart the web container to close existing shells. For rotation, remove the dedicated key pair from `DEPLOY_DIR/console` and redeploy; deployment replaces that reserved authorized-key entry. Keep the original operator deployment key separate. No new public port or paid Cloudflare service is needed.

Run `RUN_CONSOLE_TESTS=1 TEST_BASE_URL=https://scriblune.com node --env-file=.env.local --env-file=.env.operator.local --import tsx tests/live/console-flow.ts` to exercise the deployed terminal using temporary accounts and harmless commands. It cleans its accounts and temporary Owner grant.

## Measuring AI usage

Each completed, failed, or incomplete provider response emits an `ai_usage` JSON line to server stdout. Operations distinguish tutor rounds, source-linked ledger updates, visual indexing, formal reviews, and rubric extraction. Worker stdout forwards indexing records. Fields include the provider's response/model IDs, tutor turn ID and round where available, input/cached-input/cache-write/output/reasoning/total tokens. No prompts, document content, images, or account IDs are logged. Sum all operations when investigating API balance; a tutor message can use multiple model rounds plus a ledger call. A dropped connection can end before usage arrives, so these logs are diagnostic, not a complete billing ledger. Missing usage is `null`, never assumed free.

Model payloads preserve full source text, recent conversation, retrieved older messages, memory, source regions, selection, IDs, and high-detail rendered annotations. Dense path/fill geometry is projected to bounds and counts for model text only; saved/editable ink is unchanged. Small primitives, annotation text, and graph expressions stay verbatim. Within a turn, byte-identical inspection images reference an earlier image; changed images are still included. Stable document context precedes changing scene state, and tutor requests use a session-specific prompt cache key. Cache hits depend on the provider and must be checked in the reported usage. See [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

The tutor and review models, 6,000/6,500 output-token ceilings, and source-linked ledger frequency remain unchanged. Cancelling or disconnecting the response stream aborts the provider request and follow-up ledger; already completed provider work can still be billed. Exact student excerpts and saved conversation remain available if the optional ledger is interrupted.

Cost follow-ups: the ledger uses the tutor model after every successful turn; all-page text and retained inspection images still grow with session size; formal review/rubric extraction have no response cache; provider requests allow one SDK retry on transient failures. Measure operation-level usage before routing models, changing retry policy, or introducing retrieval/compaction that needs tutoring-quality evaluation.
