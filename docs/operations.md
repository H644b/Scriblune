# Setup and operations

## Supabase

Target project: `tietqqrcafdmehjsuqks`. The publishable URL/key are in `.env.example`. The MCP connector denied project access. An authorized operator database connection was then supplied; the empty application schemas were inspected and the migration was applied through the Supabase CLI. All 17 public and 6 private application tables have RLS. The restricted application login and private bucket were verified. Database advisors reported no warning/error issues.

1. Connect an authorized account and inspect the existing `public`, `private`, `auth`, and `storage` schemas. Preserve existing data. If names conflict, adapt the new migration after inspecting their definitions; do not reset the project or overwrite unrelated tables.
2. Review `supabase/migrations/20260930031826_scriblune_initial.sql`. It adds the application tables, composite owner/session relationships, RLS, protected server role, private feedback policies, immutable event/review/submission grants, and private bucket. It intentionally fails on conflicting existing tables or a preexisting public bucket of the same name.
3. Apply the reviewed migration using Supabase CLI `supabase db push --linked` after `supabase link --project-ref tietqqrcafdmehjsuqks`, or the authorized migration API. Inspect the migration list first. Never run `db reset` against this project.
4. Using an operator connection, create a dedicated application LOGIN with `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, and `NOCREATEROLE`, then grant it `scriblune_server`. Generate and store the password securely. Do not put a password in source code or shell history. `DATABASE_URL` must use that login, not `postgres`. It must be able to set its role locally; application queries run under the restricted role.
5. Keep `private` outside exposed Data API schemas. Leave feedback tables out of all Realtime publications. Never add browser bucket policies or mark the private bucket public.
6. Configure verified-email authentication and real email delivery. Set the site URL and allow `/auth/callback` on the exact development and production origins. Configure password-reset redirects. Do not enable unconfigured social providers; the app displays none.
7. Add `SUPABASE_SECRET_KEY` only to the server/worker secret environment. It is used for private Storage and auth administration in the offline governance command, not private-table Data API reads.
8. Add staff through a trusted operator connection: insert a verified account UUID into `private.admin_memberships` with role `reviewer` or `admin`. A reviewer can triage feedback; only `admin` can manage privacy requests. Profile metadata never grants membership.

The global job claimant deliberately sees the processing queue under the server role. Each processor then scopes work to the account and owned session; this privilege belongs only to the trusted worker/server connection.

## AI and launch settings

Set `OPENAI_API_KEY`, `AI_TUTOR_MODEL`, and `AI_REVIEW_MODEL`. Use a model with image input, strict function calls, and structured output. No model is configured by default. Run `npm run setup:check -- --live` and `npm run test:live`. Model-list access alone does not prove tutoring quality.

Set `NEXT_PUBLIC_SITE_URL` to the exact public origin. Set `SUPPORT_EMAIL`. Review the published privacy/terms copy and choose an operational retention schedule, responsible support owner, deletion/backup process, and provider agreements before setting `ALLOW_ADULT_PILOT=true`. The app checks adult attestation and confirmed email before creating real sessions. Supporting minors requires a separately designed guardian-consent workflow.

Limits: 20 MB per upload, 30 pages per PDF, 24 million input pixels, 10 documents per session, 5,000 annotation objects, 30 review/export pages, 8 model tool rounds, 170-second tutor deadline, 180-second conversion deadline, and a default 100 daily turns per account. Size/page constants live in `ingestion/validation.ts`; do not change only the UI or bucket limit. `AI_DAILY_TURN_LIMIT` controls turn quotas.

## Deploy as Node services

Use a full Node host with a separate long-running worker, TLS Postgres connectivity, native sharp/canvas dependencies, and enough memory for bounded rendering. The static/Sites edge runtime is unsuitable for this direct database connection and isolated Node conversion worker. The Supabase backend is configured and verified, but no public web/worker deployment has been made.

The Dockerfile supplies `web` and `worker` targets. Build public variables into the web image; inject server secrets at runtime through the host's secret manager. Never copy `.env.local` into an image.

- Web: port 3000, run `node server.js`; reverse proxy must support streaming and a request timeout above 180 seconds. Disable proxy buffering for SSE. Permit upload bodies slightly larger than 20 MB.
- Worker: `npm run worker`; allow at least 1 GB memory and writable temporary memory. Each conversion child is limited to 512 MB JS heap and 180 seconds. Native allocations need host/container memory limits too.
- Database: TLS connection or session/transaction pooler supporting transactions and `SET LOCAL ROLE`. Prepared statements are disabled. Each process opens at most eight connections.
- Storage: private Supabase bucket. The Node host needs outbound HTTPS to Supabase and OpenAI.
- Static assets/fonts: served locally. No user-document analytics or external tracking is included.

Build/test the exact image on the deployment platform; local macOS builds do not validate Linux native binaries. The checked-in Dockerfile has not been deployed. `npm run build` prepares a runnable standalone directory and `npm start` serves it. A health check can use `/`; for readiness use the private operational setup command, not a public endpoint exposing configuration details.

Monitor sanitized request failures, worker queue age/failures, model error rates, and storage/database health. Do not record document text, model context, feedback bodies, tokens, or database URLs in telemetry. Conversion jobs have a lease and limited retry attempts; users can explicitly retry failed files. Polling and persisted events recover saved work after transient interruptions.

## Governed privacy requests

Users request access, correction, or deletion in `/account`. Privacy administrators use `/admin` → Privacy request queue to verify identity/scope and record a decision. Verification is a staff process, not just possession of a session URL. Never mark a request fulfilled before completing it.

The normal app database role cannot delete immutable records or read arbitrary account feedback. Fulfillment uses a separate **offline operator-only** `GOVERNANCE_DATABASE_URL` in `.env.operator.local`, which must never be available to the web or document worker. It needs protected-table read access for access requests; Supabase Auth deletion performs account cascades. Preserve audit logs according to the operator's policy.

Pause web traffic and workers during fulfillment so no new uploads or jobs race deletion. Then, in a secured operator shell with environment secrets loaded:

```sh
GOVERNANCE_MAINTENANCE=true npm run privacy:admin -- --action export --request-id REQUEST_UUID --admin-id ADMIN_UUID --confirm ACCOUNT_UUID --output /secure/new-account-export
GOVERNANCE_MAINTENANCE=true npm run privacy:admin -- --action delete --request-id REQUEST_UUID --admin-id ADMIN_UUID --confirm ACCOUNT_UUID
```

Commands require an existing verified request of the matching type and protected `admin` membership. Exports create a new directory with 0700 permissions and files with 0600 permissions. They include original/rendered files and governed account data, including feedback, which ordinary student exports never contain. Deliver only through an identity-verified secure channel, record fulfillment, and remove the local package. No email is sent by the app.

Deletion recursively removes the account's storage prefix, then deletes the auth account so owned records cascade, and records an audit event. If storage fails, the account remains pending; if auth deletion fails after storage removal, inspect and retry. The account does not disappear merely because a queue status changed. No automatic backup or provider-side erasure claim is made; fulfill those obligations through the corresponding providers. Correction requests require documented operator review and an audited outcome rather than unreviewed rewriting of submitted work.
