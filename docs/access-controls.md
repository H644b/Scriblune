# Signups, waitlist, and account recovery

Release `20261004050757729` was deployed and verified on 2026-10-04 after explicit approval, including the Accounts limits popup and exact-Owner confirmation actions. Signup remained open at revision 4. Existing account email delivery configuration was preserved; release checks sent no test mail and performed no real account actions.

## Signup modes

The owner has a **Signups & waitlist** tab at `/admin?tab=waitlist`:

- **Open:** normal password signup and one-time email verification.
- **Closed:** no new account creation or first verification of an unfinished signup. Existing verified accounts retain sign-in and recovery.
- **Waitlist:** an email-only request is saved once per normalized address. The success popup appears after commit. No password is stored and no Auth account is created by joining. The owner can approve or reject a pending request; each decision queues one Resend email in the same transaction.

Approval records an admission decision, not an authenticated session. The email links to `/?signup=approved`, where the applicant chooses a password and uses the existing email-verification flow. The server rechecks approval regardless of client form state. Closed mode temporarily pauses approved invitations too; reopening or returning to waitlist mode preserves prior approvals. Repeated submissions do not reset a decision or send additional mail.

The migration defaults to `open`, matching the current application behavior. There are checks in the application and private triggers on `auth.users` insertion and first email confirmation. The database guard covers direct Auth requests, admin-generated signup links, OAuth, and anonymous account creation rather than relying on one UI endpoint. Existing verified-user updates do not run the confirmation guard. Mode changes and waitlist submissions are serialized, and the trigger locks the settings row for the Auth write.

Only the owner can read the waitlist, make decisions, or change mode. Lists use bounded keyset pages of 25, with revision checks to reject stale decisions. Normal staff permissions or an editable role display name cannot grant these rights.

## Account management

The **Accounts** tab at `/admin?tab=accounts` requires the database-owned built-in `admin` role or owner membership. It supports exact-email/UUID lookup and pages of 25 accounts. Responses contain account identifiers, verification/method summaries, and audit outcomes, never passwords, factor secrets, tokens, or recovery URLs.

For an Administrator who is not an Owner, each action requires a support reason, typed target email, the staff member's current password, and an enrolled-method verification proof bound to the actor, current session, security version, and exact action intent. The separately reviewed Owner confirmation exception is described below. The signed-in actor must already satisfy their existing second-factor gate. The challenge is one-use and expires after ten minutes. Successful replay of the same immutable request ID returns its saved result; changing a reused ID is rejected. Proofs cannot be reused across accounts or changed actions. A failed/ambiguous client reply can be checked using the same action ID without repeating effects.

Actions are deliberately scoped:

- **Password recovery:** send an opaque one-use link expiring in 30 minutes. Only a digest is indexed in the recovery table; the mail payload is encrypted. The URL secret is in a fragment, removed from the address bar, and is consumed only after an explicit POST. Link recovery uses Supabase's existing recovery verification and preserves app-only second-factor requirements. Staff never sees or chooses a password. A link consumed during a provider failure must be replaced by a new explicitly requested action.
- **Sign out all devices:** revoke native Auth sessions (and cascading refresh tokens), Auth one-time tokens, pending Auth flows, application challenges, verified sessions, and staff recovery links. Existing JWTs fail the live session check on protected application requests. Saved study data and enrolled methods remain.
- **Reset authenticator / passkeys / both:** remove only the selected app methods, invalidate backup codes and the same outstanding sessions/tokens, and enable verified-email two-step recovery. This requires an already verified account email. It does not modify the account email or password.
- **Suspend and request permanent deletion:** suspend application access, stop taking new document jobs for the account, revoke sessions/tokens, and create one verified privacy-deletion request. This is **not immediate erasure or billing cancellation**. The existing `scripts/privacy-admin.ts` maintenance workflow must complete Stripe cleanup, Storage removal, and Auth/data deletion. The confirmation, success notice, pending account card, and audit state explicitly say billing is not cancelled and erasure awaits an operator. The UI returns the request ID and `awaiting_operator` status. Owners can open `/admin?tab=privacy` directly from Accounts; the existing Privacy requests tab and `scripts/privacy-admin.ts` remain available. No web button marks a deletion completed. Already-running document jobs are not interrupted by this request. Data and billing mappings remain until that workflow succeeds. Only an operator may review/cancel the hold; do not silently clear it on a web rollback.

There is no bulk operation or unspecified “reset account” wipe. Self actions and every owner account are protected; an owner must use an independent operator for recovery. Admins cannot act on another Admin; the owner may, after the applicable confirmation described here. Roles, memberships, and owner status cannot be changed by these endpoints.

Audit rows are immutable to the application role and survive target account deletion. Each includes actor, target, explicit kind, reason, intent digest, timestamp, and outcome. They never include supplied passwords, verification codes, recovery secrets, or factor secrets.

## Mail delivery

`private.access_mail` is a durable encrypted outbox, separate from the existing owner-note relay. A stable `access/<action UUID>` Resend key and frozen payload survive retries and ambiguous provider responses. A 90-second lease prevents simultaneous claims. Six bounded attempts stop before the 24-hour Resend deduplication window; recovery notices stop at link expiry. Exhausted/expired jobs remain visibly `blocked`, not falsely marked delivered. Recovery revocation also blocks pending recovery notices. The dispatcher rechecks account email before sending account notices. Provider acceptance is recorded as `sent`; this does not claim inbox delivery.

The access-mail dispatcher runs inside the existing **web container**, enabled only by `ACCOUNT_EMAILS_ENABLED=true` in `runtime.web.env`. The web service already has its required `AUTH_SECRET`, database, Supabase, Resend and site URL settings. No new credential is generated and no `AUTH_SECRET` is added to the document/owner-notification worker. Opaque recovery tokens are issued and redeemed by the web app; the dispatcher only decrypts the committed message and sends it.

`scripts/start-web.mjs` supervises the unchanged Next standalone server and one mail child. Unexpected exit or startup failure of either stops its sibling and exits unsuccessfully so the existing Docker restart policy restarts the web service. SIGTERM/SIGINT stop new mail claims, interrupt idle polling, and let an in-flight delivery record its result before closing its dedicated one-connection pool. The supervisor bounds shutdown at 195 seconds, below Compose's 210-second grace. If forcibly interrupted, the outbox lease expires and the next process retries the same frozen payload/idempotency key. Auth/email calls have 15-second timeouts; dispatcher database transactions have statement/lock timeouts. This dispatcher does not depend on requests, build hooks, or development hot reload. `npm start` uses the supervisor; `npm run dev` intentionally does not send queued access mail.

The mail child receives an explicit environment allowlist: existing mail/Auth/database settings plus basic runtime variables. AI, Stripe, SSH-console and owner-notification settings are excluded. Document-processing children continue stripping both mail-enable flags, Resend credentials and `AUTH_SECRET`. These are environment boundaries, not claims of separate OS security isolation. Idle polling backs off to 15 seconds and transient loop failures to 30 seconds. No model calls are used.

Recipient categories: action-confirmation codes go directly from the web app to the acting verified staff account; owner decisions go to the waitlist's submitted address (not yet email-verified); targeted recovery/security/deletion-request notices go to the current matching account address, checked again at delivery. Password and factor recovery require verified email. Revocation/deletion notices can address an unverified account. No join-confirmation email or bulk mailing is added. Existing owner-note notifications remain in their original worker and are unchanged.

## Migration and activation review

Migration: `20261003025025_signup_access_and_account_recovery.sql`, generated with the installed Supabase CLI. It creates private settings, waitlist, actions, holds, recovery links, and mail tables; adds RLS/column grants; adds the exact-role helper and three narrow private definer functions; installs the two signup triggers; and permits the trusted app role to check its own live Auth session. Browser and service roles receive no table/function access. `SECURITY DEFINER` is used only for the Auth signup guard, bounded directory, and targeted recovery function, with empty `search_path`, fixed queries, explicit actor/target checks, and execution revoked from public/browser/service roles.

Before production activation:

1. Obtain approval for this exact security/access-control release, the migration, and the new web-side account/waitlist email purposes. Enable only the web dispatcher flag; no worker secret expansion is needed. Approval to build locally is not activation approval.
2. Re-read the active release, source/image hashes, runtime configuration, disk reserve, migration history, and health. Preserve current owner-note delivery settings and all rollback images; stop on unexplained drift. The last inspected release was `20261003020618693` with about 1.01 GB free, so a normal full Docker rebuild may need a reviewed space plan.
3. Confirm the inspected Auth schema still has the session FK cascade, native token/flow columns, and operator trigger/update permissions. Apply the migration once inside a transaction using the existing operator connection, checking RLS, grants, exact function signatures, trigger definitions, and unchanged owners/roles afterward. Do not switch signup mode while applying it.
4. Build the verified source, preserving existing dependency versions. Copy the current runtime settings and explicitly set `ACCOUNT_EMAILS_ENABLED=true` in **web only** under that approval. Use the image's new `scripts/start-web.mjs` entrypoint. Keep the worker command and environment unchanged: no `AUTH_SECRET`, no account-mail flag. Do not rotate keys, create roles/accounts, or change paid plans. The generic deployment script does not currently preserve the separately activated owner-notification settings, so do not use it for this release. Use the reviewed configuration-preserving procedure: snapshot current runtime files privately; copy them to the new release; change only the approved web flag; compare worker configuration before/after internally and require exact equality. Specifically preserve `OWNER_REQUEST_EMAILS_ENABLED=true`, existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, database and Supabase settings. Never print their values. Copy the revised Dockerfile and both supervisor scripts into the build; retain the current Compose restart policy, `init: true`, and 210-second grace. A failed comparison blocks activation.
5. Activate web and worker together. Check health, source/image identity, private route behavior, and content-free dispatcher and owner-notification logs; verify that a failed mail child cannot leave an apparently healthy web-only service. An authenticated release smoke test that actually switches signup mode, sends mail, or changes a real account requires a separately identified action and approval; do not perform one automatically.

Rollback must account for schema and policy, not just the image: older app code does not enforce `account_access_holds` or live-session checks everywhere. If any hold/action has been used, keep the new security gate while correcting the UI or use maintenance; reverting to the old image alone could restore suspended access. The signup triggers remain effective even with the old image. Do not drop records, reopen registration, or clear holds to make a rollback pass.

## Validation scope

Isolated PGlite tests apply the complete migration history to fake Auth/storage schemas and synthetic accounts. Tests mock email/Auth calls and disable remote tests. They cover role and target checks, database signup guards, pagination, code binding, replay, factor scope, live-session revocation, deletion queue semantics, recovery expiry, mail retry identity, and private ACLs. Native schema compatibility is checked with metadata-only reads, not live account mutations. Browser fixtures exercise real React components with synthetic endpoints. A local production build separately validates Next.js compilation. Lifecycle tests cover sibling termination, crash/start failure, bounded graceful shutdown, idle wake-up, in-flight completion, retry backoff, credential allowlisting, and disabled/misconfigured startup. Outbox tests retain crash-lease recovery, encrypted payload and stable idempotency checks.

References: [Supabase Auth data management](https://supabase.com/docs/guides/auth/managing-user-data), [session revocation](https://supabase.com/docs/guides/auth/sessions), [recovery link API](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), and [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Enrolled methods for action confirmation

Non-Owner staff actions still require a fresh password, current live session, current security version, exact authorization, and one expiring proof bound to the reviewed intent. They now use the existing enrolled-factor verifier: authenticator TOTP, passkey/security key with required user verification, enabled email two-step, and remaining one-use backup codes. If no factor is enrolled, verified email retains the previous confirmation fallback. App/passkey-only accounts do not acquire an email bypass. Available methods are loaded from enrollment, never supplied by the browser.

Changing methods preserves the original ten-minute expiry and failed-attempt count and replaces the current challenge. TOTP steps, passkey counters and backup codes remain replay protected; a signed assertion must match the action's challenge, RP and origin. Cancellation invalidates only that action's challenge. Restarting requires the password again and preserves the reviewed action ID for safe delivery retries. Revoked staff access, sessions, altered intent or security-version changes invalidate confirmation. Completed exact action replays return the saved audit result without executing twice. These changes are local until separately approved for release.

## Owner confirmation exception (local, not activated)

The Owner explicitly approved replacing repeated action reauthentication with an
Are you sure / Confirm dialog, including password recovery, authenticator/passkey
resets, and suspension/deletion requests, after being told the active-session risk.
The server derives exact Owner membership; the browser cannot claim that status.
Normal verified sign-in, native session validity, existing MFA verification and
expiry/revocation, same-origin checks, protected-target rules, current security
version, immutable audit, action identity/idempotency, and six-new-actions/hour
rate limits remain enforced. No MFA enrollment, session lifetime, or privilege is
created or extended. Non-Owner Admins retain password plus enrolled-factor step-up.

The dialog shows the action and target and requires an explicit Confirm. It does
not ask the Owner to type a password, code, reason, or email again. The selected
email still binds the immutable server-validated intent; the audit reason records
`Owner confirmed: <action title>.` Cancel/Escape execute no action. Ambiguous
responses retry the same intent UUID; reusing that UUID for changed input fails.

This exception covers signup-mode changes, waitlist approval/rejection, password
recovery, sign-out-all-devices, authenticator reset, passkey reset, both-factor
reset, suspension/deletion request, and Free association confirm/dismiss/separate.
Existing billing/staff-management flows that did not use this action-step-up
dialog are unchanged. An active valid Owner session can perform these sensitive
actions without another factor prompt; ordinary session protection is therefore
the remaining authentication boundary. Protected Owner/self targets still require
the independent operator path.

Synthetic tests cover Owner versus Admin/ordinary accounts, forged role fields,
missing confirmation, wrong origin, expired/revoked sessions and normal MFA,
changed security versions, removed ownership, protected targets, rate limits,
exact replay and changed-intent rejection. Browser fixtures separately verify
Owner confirmation/cancellation and the retained Admin two-step flow. No real
recovery, factor reset, deletion, or mail sending is used for validation.
