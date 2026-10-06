# VPN connection policy

Release `20261004050757729` was deployed and verified on 2026-10-04 with web `VPN_CHECK_MODE=enforce`, following explicit release approval. The user selected Proxycheck Free, confirmed Address Logging was disabled, and installed the private key through hidden terminal input. The release preserved that key on the VM with mode 0600 and excluded it from the worker and mail child. Every app lookup sends `tag=0`.
`VPN_CHECK_MODE=off` is the default. Missing credentials or an unavailable
classifier produce an unknown result; ordinary authentication, MFA, account
holds, plan requirements, and usage limits still apply.

## Classification and application behavior

The server accepts the current IP only from the existing authenticated Cloudflare
edge (`X-Scriblune-Origin` plus `X-Scriblune-Client-IP`). It normalizes IPv4 and
IPv6, including mapped IPv4, and rejects local addresses and forwarded-header
lists. Client flags, ASN, geography, hosting, shared networks, and general
anonymous/proxy categories never supply a VPN verdict.

A block requires the exact address's `detections.vpn === true`, integer
`detections.confidence` from 90 through 100, and a non-null valid UTC
`detections.last_seen` no more than 48 hours old and not in the future.
Delisted or uncertain observations remain unknown. These are conservative product
thresholds, not a measured false-positive rate or an identity claim.

Checks run before application login/verification/recovery side effects and in
protected server gates, including ongoing Owner console operations. A confirmed
block returns HTTP 403 / `VPN_BLOCKED`, revokes only the caller's validated current
native login and refresh tokens, clears the application's second-factor grant,
and attempts local Supabase sign-out. Other devices, other accounts, security
settings, account contents, paid entitlements, and usage records are unchanged.
The additive migration is `20261004030000_network_session_revocation.sql`.
Its function is executable only by the application role and is scoped to the
validated account. Apply it before enabling the policy.

A confirmed API denial hides private UI and clears its query cache. The workspace
persists recoverable ink, pauses its save queue, and aborts its active chat stream.
Visible protected pages check at most once per minute, including focus/online
and visibility events; hidden tabs do not poll, requests do not overlap, and an
off response stops further polling for that page lifetime. The popup and public
`/network-access` page explain mistakes, delays, support, and manual rechecking.
An unknown recheck never claims that a VPN was definitely disconnected. Sign-out,
challenge cancellation, and explanation navigation remain available.

This is application access enforcement: it does not reconfigure Supabase's public
Auth endpoint or detect every VPN. Provider observation lag, its service cache,
our verdict cache, suspended tabs, and requests already in progress can delay
blocking. Client cancellation is best effort; previously started bounded work
may finish. Revocation-service failure still denies the current request, but
cannot promise global native-session invalidation during an Auth/DB outage.
Cleanup waiting is capped at two seconds so a stalled service does not prevent
the browser from receiving the confirmed denial; scoped cleanup may finish later.
Households, schools, privacy relays, and reassigned IPs can be misclassified;
contact support and use the provider's correction process rather than treating a
result as proof of abuse. Unknown results, quota exhaustion, and provider outages
fail open only for this classifier.

## Bounded external use and privacy

The fixed HTTPS v3 endpoint receives a single IP in a form POST, a server-only
key, `tag=0`, and pinned version `24-June-2026`. No account identifiers, emails,
browser identifiers, or lesson content are included. No redirects or retries.
Lookup plus budget-reservation waiting is capped at two seconds; an expired
reservation wait cannot start a late lookup. Responses are capped at 64 KiB.
There are at most four concurrent lookups per web process and 2,000 cached keyed
hashes. Same-IP requests coalesce. Allowed/blocked verdicts are usable for at most
five minutes, clipped at the observation's 48-hour boundary; unknowns last one
minute. Expired entries are reclaimed on subsequent lookups. Provider failures
pause new lookups for one minute, while an uncertain individual IP does not pause
unrelated checks. Outcome-only logs contain no addresses, accounts, response
payloads, credentials, or provider error text.

An atomic reservation in the existing private rate-limit table caps this app at
1,000 attempted IP lookups per provider day across processes and restarts. The
counter uses the documented fixed UTC-07 reset boundary; expiry includes a one-hour
margin, and each day gets a separate key. Timeouts still consume a reservation
conservatively. Other applications sharing the key can exhaust the provider's
allowance sooner. The integration does not buy capacity or request burst tokens.

For one continuously active unchanged IP in one warm process, a five-minute cache
allows at most 12 fresh lookups per hour; same-IP requests inside a cache window
add none. This is a code-derived bound, not observed billing savings. Restarts,
multiple processes, cache eviction, changing addresses, or unknown verdicts can
raise demand, while the shared daily cap remains. There is no live billing data.

Proxycheck documents 1,000 daily queries on the registered free plan and one query
per submitted IP. Its v3 API specifies the detection fields, POST format, version
selection, and per-request logging suppression. Its own adaptive service cache
can last up to ten minutes. Sources: [API documentation](https://proxycheck.io/api/),
[official v3 example](https://github.com/proxycheck/proxycheck-php), and
[Free plan and reset boundary](https://proxycheck.io/pricing/).

The provider says `tag=0` suppresses address logging and post-query testing while
retaining query/result counts. Dashboard Address Logging can also be disabled.
This does not remove its independently collected detection database or justify a
zero-retention claim about every service layer. Source:
[provider processing and logging policy](https://proxycheck.io/gdpr/).

## Setup handoff and release gates

The account and secure credential handoff are complete. The user approved this bundled release after the key was verified as installed and checks were still off. Do not paste a key into chat, source control, client code, or `NEXT_PUBLIC_*` configuration. For future setup or replacement, the user's own browser/operator should:

1. Register or select the Free account without adding payment or upgrading.
2. Disable Address Logging in Settings, leave custom response rules off, and keep
   any public/CORS key out of this server integration.
3. Securely install the private `PROXYCHECK_API_KEY` into the web runtime using the
   existing secret configuration process; keep it out of document processors.
4. After separate release approval, apply the additive migration, deploy the
   tested build, and set `VPN_CHECK_MODE=enforce` with existing authenticated edge
   and account-security configuration intact. Confirm behavior with approved
   controlled accounts/network checks, without logging raw IPs or keys.

Setting `VPN_CHECK_MODE=off` stops new classification/revocation. Previously
revoked native sessions still require sign-in; rollback must never recreate them
or reset usage. The four features and VPN activation received explicit bundled release approval; provider-service permission alone would not authorize future deployments.

## Verification

Synthetic tests cover trusted-edge input, IPv4/IPv6 normalization, threshold and
age boundaries, caching/coalescing/eviction, address changes, timeouts, response
limits, exhausted quota, and outcome-only logging. Database tests apply all
migrations and verify role privileges, current-login scoping, refresh-token
removal, stale-JWT rejection by the live-session gate, retained work/usage, and
shared budget reservations. Route tests cover login, recovery, callback,
logout/cancel, same-origin enforcement, and MFA retention. Desktop/phone browser
fixtures cover the popup, recovery storage, retry semantics, no redirect loop,
polling bounds, hidden tabs, disabled mode, and classifier outages. All provider
responses and accounts in these tests are synthetic. After deployment, two anonymous checks from the deployment VM through the normal public edge both returned `allowed`, with one classifier event; the repeated request used the warm cache. The missing-Origin check returned 403. This confirms an accepted live provider response and normal route behavior, not VPN detection accuracy. No artificial VPN address or real account revocation was tested. Real-inbox delivery remains unverified.
