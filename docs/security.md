# Security and privacy boundaries

## Enforced controls

- Every private endpoint independently validates the authenticated Supabase user and owned session. Server checks do not rely on middleware, robot directives, client state, or obscure UUIDs.
- Signup requires a one-time email code. Optional email, authenticator-app, and passkey second-factor grants are bound to the Supabase session ID, account, email and current security-settings version. Settings changes require an already verified session and the current password; enrollment also proves the new method. Other verified sessions are invalidated on changes.
- Codes expire after 10 minutes, allow six guesses, and are HMAC-hashed. Pending login tokens are encrypted with AES-GCM. HttpOnly challenge cookies and database-backed per-email/IP limits protect the flow. Expired challenges are cleaned by the persistent worker. Email-based recovery is available, but an account with authenticator/passkey factors and no email factor must also complete a configured second factor before resetting its password. Email two-step relies on security of the same mailbox and is not phishing-resistant MFA.
- Authenticator seeds use AES-256-GCM with account-bound context. Six-digit, 30-second TOTP codes allow one neighboring time window; accepted counters cannot be reused. Passkeys use SimpleWebAuthn with exact configured origin/RP ID, user verification required, expiring single-use challenges, and stored signature counters. Backup codes are account-bound HMAC hashes, shown once and consumed atomically. Method switches preserve challenge expiry and attempt count; account-level limits also cover new challenges. These are application second-factor checks, not Supabase AAL2 claims.
- Cookies use Supabase SSR session handling. Mutations validate their origin and bounded strict schemas. Private responses are `no-store` and `noindex`; file responses require the same ownership check.
- Browser database roles have no direct access to application tables. Reads and writes use authenticated app routes, preventing a password-only Supabase token from bypassing optional two-factor verification. Composite foreign keys prevent cross-session page/document/review references.
- A restricted server role is scoped to `app.account_id` in each transaction. Application code never reuses a session-level account setting. Immutable records revoke update/delete even from that role.
- Private feedback schemas revoke access from PUBLIC, anon, authenticated, and service_role. RLS additionally limits inserts to the submitter and reads/updates to protected staff membership. The secret Storage key is not used to bypass private-table access.
- Staff feedback reads and changes are audited. User-editable metadata has no relationship to membership. Privacy fulfillment requires role `admin`, a verified request, and a separate offline operator connection.
- The feedback author receives only acknowledgment. Question endpoints stop returning even the question set after feedback is received. Saved answers are absent from ordinary history, search, tutor context, exports, events, and Realtime.
- No Realtime publication/channel is used. Durable, authenticated HTTP and SSE provide synchronization; forged broadcasts have no authority.
- Originals never change. Uploads have signature/size/page/pixel/time limits; active formats are rejected. PDF scripts/macros are not executed. Rendering runs in a child process under a bounded worker.
- Model tool schemas are allowlisted and additionally checked for ownership, page bounds, object revisions, actor permissions, current work revision, and active turn. Mathematical input is parsed without eval.
- Model review output cannot directly approve submission. The server validates evidence/scope and derives readiness; the final transaction matches immutable review/rubric/work revisions. No `approved=true` input exists.
- Secret values and private content are excluded from logs and errors. The setup checker reports presence and validation outcomes only.
- The VM console is limited to protected site Owners and bound to one authenticated login. Opening the terminal checks the verified Supabase user. Subsequent operations use signature-verified JWT claims and one database call for current ownership, live auth-session state, and the current second-factor grant. Output authorizes after waiting and before returning any bytes; a server sweep also closes revoked sessions. The database helper is SECURITY INVOKER, performs transaction-local role/account setup, and is inaccessible to browser roles; no permission result is cached. It uses a dedicated, source-restricted SSH key, verifies the host key, forbids user-selected hosts, limits session lifetime and buffers, and records lifecycle metadata only. The browser receives neither SSH credentials nor forwarding access. This Owner capability is a real administrative shell on the production VM, including the VM user's existing sudo privileges.

## Boundaries that still need deployment verification

Automated tests execute the exact SQL migration on PGlite with minimal Supabase auth/storage schema fixtures. That validates PostgreSQL grants/RLS and service logic, not an existing project's Data API settings, JWT delivery, Storage gateway, network, or email configuration. The provided project now passed the real two-account acceptance flow (including private file and feedback denials), and CLI advisors found no warning/error issues. Recheck these settings on every new deployment; the tests do not prove all possible attack paths.

The `DATABASE_URL` login must not be superuser, bypass-RLS, a table owner, or the migration operator. Its ability to set account context is a trusted-server responsibility; never expose arbitrary SQL endpoints. The global processing queue privilege is only for the worker.

The browser page is an SVG editor, so mathematical canvas text supports Unicode symbols rather than arbitrary TeX layout; chat uses KaTeX with raw HTML disabled. Content Security Policy permits Next's inline bootstrap scripts and styles; it blocks objects, framing, and external scripts. Consider nonce-based CSP hardening with your actual host rather than adding permissive third-party script origins.

Output from a model can be well-formed and still educationally wrong. The live algebra test checks a small representative case; it is not evidence of general mathematical or subject expertise. Review is an AI readiness check, not an instructor's grade. Prompt-injection authority is constrained in server code; prompt instructions alone cannot guarantee semantic resistance across all assignments.

## Retention and privacy operations

Saved work and feedback are retained until a governed request is fulfilled. There is no automatic saved-work expiration or implemented guardian-consent system. Authentication challenges and expired rate limits are cleaned separately. Publish and operationalize a retention schedule, support owner, backup deletion policy, and provider processing policy before launch.

The sample uses localStorage for sample content. Private drawing recovery is opt-in and tab-scoped sessionStorage, cleared after acknowledgment or sign-out. It stores only pending actions, not originals. Browsers necessarily see answers while users type/send them. Post-submission retrieval is the protected boundary.

See `operations.md` for verification, access packages, correction decisions, and deletion. Governed access exports can contain private feedback when an authorized privacy administrator fulfills an appropriate request; normal student exports cannot. No privacy claim is used to prevent legitimate requests.

## Additional hardening before scale

Add deployment-level request throttling and resource quotas, review worker crash/lease metrics, exercise large PDFs on the target machine, verify backup recovery, conduct a live two-account penetration test, expand accessibility testing with assistive technologies, and evaluate handwriting and subject-specific tutoring with human review. No certification is claimed.
