# Free allowance associations and automatic limits

Status: release `20261004050757729` was deployed and verified on 2026-10-04 with web `FREE_TIER_GUARD_MODE=enforce` and `FREE_TIER_PROVISIONAL_MODE=enforce`, following explicit approval of the provisional rule below. The original high-confidence rule remains active. Both code defaults remain off; migration alone creates no decisions or backfill. No measured production false-positive rate or monetary savings is claimed.

## Behavior and limits

`observe` records first-party continuity and marks new Free usage as eligible for future sharing. `enforce` additionally shares the existing five included tutor credits and one new tutoring workspace per UTC day across Admin-confirmed associations and automatically confirmed high-confidence pairs. `observe` only records candidates/evidence and eligible usage; it never applies automatic decisions. Matches that meet the separate provisional rule below share Free limits pending Admin review; weaker matches remain review-only. Confidence is a conservative heuristic, not a calibrated probability score or proof of a physical computer/person. Abuse can continue below the threshold or before enough evidence exists.

The versioned `browser_switch_pair_v1` automatic rule requires **all** of the following:

- Two distinct first-party cookie continuities from two different recognized browser families; each continuity must consistently report a single family.
- For each continuity, at least three distinct verified native sign-ins per account on three UTC days, spanning at least 48 hours per account, and at least four alternating account transitions.
- For each continuity, matching daily coarse-network hashes on at least three days within the last seven days. No raw IP is retained, and network support alone never creates a pair.
- Neither continuity has evidence of a third account within its unexpired evidence. Both accounts are verified, at least 48 hours old, not privileged/suspended, and have no active paid subscription or owner grant at the decision point.
- Each account is otherwise unlinked and has exactly one mutually eligible partner. More than 25 candidates for either account blocks automatic evaluation. An existing confirmed group is never automatically extended or merged. An automatic group is therefore limited to two accounts.
- No dismissed correction: automatic decisions only promote candidate pairs; explicit dismissed/separated relationships remain excluded. Manual group review also checks corrections across every affected member.

The rationale is repeated authenticated switching across multiple continuities and time, with network evidence only as support. A cookie, browser family or IP by itself never qualifies. Browser families are self-reported and two identifiers do not prove two physical devices. A determined abuser can evade the rule or arrange matching behavior; shared families can still match incorrectly. Detection is not a substitute for support review. Admins can uphold or separate a match with fresh action-bound verification, and users can appeal without seeing anyone else's identity.

Each automatic decision writes one immutable audit event (`free_auto`, no human actor), the rule version and aggregate evidence in the same transaction as the pair change. Repeated evaluation cannot produce another decision for an already confirmed pair. Automatic evidence is evaluated under the same global Free lock as reservations, billing mutations, refunds and staff corrections. Observation/decision commits before a usage reservation begins, so a rejected charge cannot roll back the association or its audit.

The evidence is a server-issued encrypted HttpOnly host-only cookie with a fixed 30-day lifetime, distinct native authenticated sign-ins, and a coarse browser family. Only the existing authenticated Cloudflare-to-origin path may supply a network prefix; it is coarsened to IPv4 /24 or IPv6 /56 and HMACed with a daily context before storage. IP/network matches cannot create a candidate. An observation must correspond to a live verified native Auth session belonging to the account. Staff accounts are excluded from automatic observations. Up to eight accounts per browser identifier and twenty new observations per account/day bound shared-device noise and storage growth; repeated requests from one session cannot inflate evidence.

Cookie removal/expiry starts unrelated continuity. There is no localStorage respawn, cross-site tracking, canvas/audio/font fingerprint, hardware identifier or claim of reliable detection across cleared cookies, devices or browsers. A transferred cookie can produce a false candidate. Schools, families, NAT and VPN use require independent review; matches alone do not establish abuse.

## Accounting and correction

The existing ledger remains authoritative. Locks are always acquired in this order: the account's billing row, then one short shared-Free advisory transaction lock. Observation/automatic decisions/review take only the latter and never a billing lock. They read entitlement rows without locking; entitlement mutations themselves acquire the billing row then the shared Free lock, giving a consistent decision order. Reservations, entitlement reads and refunds use that same order. The shared group includes confirmed and provisional pairs. Automatic provisional assignments are limited to a unique unlinked pair; manual confirmation remains bounded to eight members. The review intent binds the complete affected membership snapshot, pair revision, typed target email, reason and action ID. A changed group requires fresh review.

Only new `free_eligible=true`, included, unrefunded rows count toward a shared Free allowance. Subscription and owner-granted plan use does not enter that total, including an owner-granted Free plan. Bonuses remain per account and are charged only after included credits are exhausted. A paid account retains its own included budget, regardless of the group's Free use. Moving back to Free preserves its own consumption and other members' eligible Free use. Nothing transfers study sessions, documents, account contents, purchased credits or subscription rights. Existing work remains accessible.

There is no historical backfill: old ledger entries cannot reliably distinguish Free use from paid use at the time of consumption. An observation phase before enforcement is recommended for staged rollouts to collect eligible usage and review candidate behavior. This approved release enabled enforcement with fresh evidence; it does not reconstruct historical consumption or bypass the multi-day automatic threshold. Repeated reference IDs never charge twice, including after a refund; duplicate refunds return at most one debit. Group counting derives from current ledger rows, so unlinking never moves or rewrites charges. Separating an account keeps its own use charged and records durable dismissed edges against all former group members to prevent indirect automatic re-linking. Reconsidering a dismissed correction is an independent operator procedure, not an automatic suggestion.

Admins see candidate counts, shared status, pending-review badges, evidence summaries and affected emails in the Accounts tab. The exact built-in Admin or Owner role is required. Self, Owner and peer-Admin protections remain. Staff confirmations, dismissals and separations are action-bound and audited; automatic decisions record their rule/evidence without claiming a human review. A user sees only their own shared status and review request; no associated identities or work. An appeal does not lift a quota automatically. Staff can uphold a confirmed association or separate the account with a reason. Open appeals attached to confirmed groups appear in the relevant account's association details.

## Retention and access

Raw IPs, full user agents, cookie values and native session IDs are not stored in these tables or returned to staff. Cookie/session/network hashes use separate HMAC domains under the existing web `AUTH_SECRET`; no new secret is needed. Browser observations expire within 30 days, supporting network hashes within seven days, stale candidate pairs after 30 days, and resolved appeals after 30 days. Expired evidence is excluded from decisions immediately. The existing supervised account-mail maintenance process runs cleanup at startup and hourly even when guard capture is off. Production activation requires that process enabled and healthy; monitor cleanup failures and service downtime. Confirmed/dismissed minimal relationships persist until review or account deletion, and decisions remain in the existing security audit, whose retention is unchanged. Deletion cascades account-specific evidence/relationships/appeals. Governed export includes only the person's own descriptive signals and relationship states, excluding shared identifiers and other identities.

New tables expose no direct privileges to browser roles, service_role, or scriblune_server. Narrow definer functions authorize the current account, exact staff role, or bounded maintenance operation; none expose arbitrary cross-account ledger/content access. The internal graph function is not callable by application roles.

## Validation and activation review

Synthetic PGlite tests cover automatic positive/negative thresholds, unique-partner ambiguity, crowded browsers, group growth prevention, preserved corrections, persisted audit on rejected charges, all migrations, role gates, forged session attribution, duplicate observations, IP-only non-linkage, paid/bonus preservation, shared caps, idempotency/refunds, midnight, stale membership, corrections, appeals and expiry.

Native PostgreSQL 17.11 tests now exercise ten concurrency cases on a disposable synthetic database through a private Unix socket, with no TCP listener or login service. Twenty-one backend connections were used; explicit lock barriers verified simultaneous waiters rather than relying on Promise scheduling. Tests cover shared credits/workspaces, repeated reservations/refunds, per-account bonuses, refunds racing replacement charges, confirmation and separation racing reservations, stale overlapping reviews, automatic decision idempotency, and billing-row/Free-lock ordering in both decision orders. Zero deadlocks occurred. Native tests found and fixed double JSON encoding in association membership and staff list flags; use the PostgreSQL driver's `tx.json` for those parameters. The cluster was stopped after testing.

The complete local suite passed 232 tests with 14 expected skips (the ten separately run native cases plus four live-environment gates); TypeScript passed. Live provider calls and real-account quota experiments are excluded. The opt-in native suite is `tests/integration/free-tier-postgres.test.ts`; it requires an empty database named `scriblune_guard_synthetic`, user `scriblune_test`, port number 55437, and a mode-0700 socket directory named `socket` under `/tmp/scriblune-guard-*`. Set `SCRIBLUNE_GUARD_TEST_SOCKET` only for this suite. It rejects remote databases and nonempty fixtures. Stop the disposable server after testing.

Apply the reviewed migration before activating code that references it. The migration alone collects no evidence and changes no allowance. Record the rollout mode explicitly: `off` disables capture and enforcement; `observe` collects bounded evidence and eligible ledger use without automatic linking/shared enforcement; `enforce` enables the selected high-confidence rule and reviewed shared limits. A deliberate observation period before enforcement avoids relying on incomplete historical usage and provides an opportunity to review false positives. Deploy consistent settings on every web instance during drained/maintenance operation; preserve worker secrets and notification settings. Public privacy disclosure, appeal handling, retention, and activation mode are part of the release review. Turning off capture/enforcement retains existing records while cleanup continues.

Production verification on 2026-10-04 confirmed release `20261004010751754`, image `sha256:fded667e8c5344fb07fea816e3374611bd7774b531707e7912e570077c4ebf28`, healthy web/worker containers, private API authentication, privacy disclosure, and the supervised cleanup process. Database catalog/ACL verification passed on PostgreSQL 17.6; the Supabase advisor connector lacked project access and was not treated as a passed check. Evidence and association tables were still empty at verification.

The staff MFA release `20261003230446581` remains the rollback baseline; its enrolled-method verification is preserved in the new release. Signup remains Open, revision 2. Only the web guard-mode flag changed; worker settings, edge, volumes, and all 17 prior images were retained. The VM had approximately 4.93 GB free after activation. Future rollouts must retain rollback images and data volumes and stop a compact native build before its 1 GiB reserve is exhausted. Image pruning and DNS changes require their own authorized scope.

## Provisional review protection (active)

Migration `20261004020000_provisional_free_allowance.sql` adds the distinct
`provisional` state and automatic `free_provisional` audit type. The migration
alone neither backfills matches nor changes current high-confidence decisions.
New provisional decisions require both `FREE_TIER_GUARD_MODE=enforce` and
`FREE_TIER_PROVISIONAL_MODE=enforce` on the web service. The second flag defaults
to `off`; the current production activation followed explicit approval of the threshold and effect below.

Rule `browser_switch_provisional_v1` requires two verified accounts at least
24 hours old, one fixed-lifetime browser continuity with a consistent recognized
browser family, at least two distinct verified native sign-ins per account on
at least two UTC days spanning at least 12 hours, at least three alternating
account transitions, and matching daily coarse-network evidence on two days.
Only unexpired observations from the last seven days qualify. A third account
on that browser within unexpired continuity evidence, multiple eligible partners,
more than 25 candidates on either side, existing groups, dismissed corrections,
staff/Owner status, access holds, active paid subscriptions, or active Owner plan
grants prevent automatic provisional assignment. Both accounts must be unlinked;
no provisional group expansion or transitive automatic merging occurs.

The effect is one combined daily Free allowance of five tutor credits and one
new workspace for the two accounts. Private content, purchased/bonus credits and
paid or granted entitlements stay separate. Earlier eligible daily charges count;
review does not refund or reset usage. The flag controls new assignments: turning
only the provisional flag off leaves existing assignments pending Admin review.
An Administrator confirms an association or lifts it with the reviewed separation
action. The immutable audit records the rule/evidence without claiming identity
certainty. Lifting resolves the appeal and stores a correction that prevents
immediate automatic relinking. The existing global guard `off` mode disables
shared enforcement while retaining records and cleanup.

This is a heuristic, not proof that accounts belong to one person. Two people
sharing a school or household computer can qualify incorrectly; new accounts and
cookie-clearing can evade it. Pending-review status, the actual shared budget,
uncertainty, and a review/appeal path are shown in staff and account interfaces.
An appeal does not automatically lift the restriction. Provisional relationships
persist until review or account deletion, like confirmed relationships; evidence
retention remains 30 days for continuity and seven days for supporting networks.
No raw IP, new identifier type, paid service, or model call is added.

The Accounts usage ring reuses the workspace popup. Its authenticated endpoint
requires the built-in Admin/Owner gate, scopes a read-only repeatable-read
transaction to the selected account, and projects only plan/allowance values.
Opening one popup fetches one account; closed account rows do not poll. Open
popups refresh at most every 60 seconds automatically, with explicit refresh and
retry. Viewing an unused account creates no billing row or privilege grant.

Native PostgreSQL 17.11 validation for this proposed release passed 16 cases with
21 backend connections and forced simultaneous lock waiters, including provisional
assignment/release/refund races and actual read-only snapshot checks. No deadlocks
occurred; the disposable cluster was stopped. Synthetic boundary and ACL tests
also cover the exact 12-hour threshold and restricted internal helpers. This
validation does not claim live false-positive rates or measured cost savings.

## Latest release verification

The combined candidate passed 344 regression tests and 40 desktop/phone browser
checks. Final native PostgreSQL 17.11 testing passed all 16 cases, using 21
connections across 27 forced overlaps with zero deadlocks. The synthetic cluster
was stopped. Native production build, TypeScript, migration history/ACLs, source
hashes, runtime flags and route protection passed. Live account/usage experiments
were excluded. The previous release and all prior images/volumes were retained.
