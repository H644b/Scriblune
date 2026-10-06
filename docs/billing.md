# Plans, credits, and Stripe

Scriblune uses monthly USD subscriptions and daily allowances. Prices are defined in `src/lib/plans.ts`; no amount or Stripe price ID supplied by a browser is accepted.

| Plan     | Monthly price | Tutor prompts / credits each day | New sessions each day |
| -------- | ------------- | -------------------------------- | --------------------- |
| Free     | $0            | 5                                | 1                     |
| Plus     | $5            | 10                               | 3                     |
| Focus    | $10           | 20                               | 6                     |
| Flexible | $18–$120      | 30–200, in steps of 10           | 9–60, in steps of 3   |

Flexible costs $0.60 per included daily credit per month. Focus costs $0.50, so Focus remains the best paid value for both prompts and sessions. Flexible always has greater capacity and a higher price.

## What is counted

One accepted tutor prompt reserves one credit for the explanation and its tools. Daily credits are used first; Owner-granted bonus credits cover additional prompts and carry over. New sessions have a separate daily limit; returning to saved sessions is free. Continuing a submitted assignment as a new draft counts as a new session. Authorized test fixtures do not consume the new-session allowance, but their AI prompts still consume credits. Drawing, saved work, the forum, reviews, and exports do not consume tutor credits.

Daily allowances reset at midnight UTC; the usage popover shows the corresponding local time. Included credits do not roll over. Existing saved work is preserved when an account downgrades or runs out. Failed tutor requests and interrupted requests that produced no text or drawings are refunded once. A stopped response that produced output remains charged. Abandoned running turns are recovered/refunded when the session's next prompt starts.

Private `billing_accounts` rows serialize reservations across all sessions for an account. The private `usage_ledger` records a unique reference per session/turn; retries cannot debit the same reference twice. A failed transaction rolls back the debit. Plan changes keep the day's usage rather than resetting it. The server, never the ring or browser state, authorizes usage.

## Owner controls

Feedback & staff → Plans & credits allows the protected Owner to find a verified member by email, grant a plan (7/30/90/365 days or until removed), remove a grant, or add bonus credits. A reason is required and the action is audited. A grant takes priority over a paid subscription; it does not charge or cancel it. Removing or expiring a grant restores the underlying active subscription, otherwise Free. Bonus credits do not add new-session slots. Moderators, reviewers, administrators, and testers cannot use these controls. Owner status comes from `private.site_owners`, not user metadata or assignable permissions.

## Payment flow

- `/plans`: comparison, daily usage, flexible slider, plan changes, and billing management.
- `/checkout`: Scriblune's own checkout page, using Stripe's Payment Element through Checkout Sessions (`ui_mode: elements`). Card numbers and CVC go directly to Stripe.
- `/checkout/complete`: validates current Stripe state on the server. A success redirect alone never grants access.
- `/api/billing/webhook`: verifies the raw request signature and environment, deduplicates event IDs, locks the account, and retrieves current Stripe state before applying it. Old event snapshots cannot restore a canceled plan or supersede a newer subscription. The customer, account, checkout attempt, item count, quantity, product, monthly interval, currency, amount, and price lookup key are checked.
- Manage billing opens Stripe's portal for payment methods, invoices, and cancellation. Plan changes start on Scriblune's comparison page and open Stripe's confirmation flow, which shows proration and handles additional authentication/payment failures before applying changes. Separate configurations allow one selected monthly price per flow.

Only an active subscription within its paid period grants paid limits. Past-due, unpaid, canceled, incomplete, or expired subscriptions fall back to Free (unless a grant applies). Cancellation at period end retains the paid allowance until that time. Webhooks keep renewals/status current; authenticated usage reads reconcile with Stripe after five minutes as a fallback. New checkout attempts are serialized and reuse open sessions; another active subscription is not created accidentally.

Governed account deletion expires open checkouts and deletes the Stripe customer before deleting the account mapping, canceling remaining subscriptions. Provider billing-record retention is separate from Scriblune's database. The private operator export includes account billing, grants, and usage, without card data.

## Configuration

Use matching Stripe secret and publishable keys in `.env.local`. Run:

```
BILLING_SITE_URL=https://scriblune.com node --env-file=.env.local --import tsx scripts/configure-billing.ts
```

This provisions the application product, 20 monthly prices, billing portal configurations, and the signed webhook endpoint. It saves the resulting settings to the ignored local environment without printing credentials. Reruns reuse the catalog. Set `BILLING_SITE_URL` to the public deployment origin, not the native origin. Deployment forwards Stripe secrets only to the web server; the Cloudflare proxy and document worker do not receive them. Only the publishable key is a public build argument.

The supplied account keys remain **test mode**. In **Feedback & staff → Plans & credits**, the Owner sets **Checkout access** to **Off**, **Staff only**, or **Customers**, then saves. Off blocks starting checkouts and plan-change flows for everyone, including the Owner. Staff only permits the Owner and every staff role. Customers permits any verified signed-in member. Existing billing management and cancellation remain available in every mode. Current plan allowances are not revoked by this setting. Access is persisted in private `billing_settings.checkout_access`, restricted to Owner writes, and audited. It applies independently of Stripe key mode.

Scriblune uses the final release presentation, monthly authorization, and subscription confirmation with no public test banners or no-charge notices. The retained test credentials still cannot process real cards. Stripe can display its own provider indicators. Existing test keys are retained only in ignored `.env.local` and backed up in private `.env.stripe-test.local` for operator use.

### Releasing with live payments

1. In `.env.local`, replace **both** `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` with matching live keys from the same activated Stripe account. Do not change `STRIPE_CATALOG_MODE` by hand.
2. Run `npm run deploy`. The deployment now runs billing configuration first. When the saved catalog mode differs from the keys, it provisions a separate matching product, 20 prices, portal configurations, and webhook, then saves their IDs/signing secret locally and deploys the matching publishable key. A setup failure stops deployment. An unchanged complete catalog is verified and reused.
3. In Feedback & staff → Plans & credits, choose Customers and save when ready to open checkout. Off and Staff only remain available. Existing subscription management/cancellation remains accessible.

Each provider mapping records its Stripe environment. Test subscriptions never confer paid access under live credentials. Starting the first live checkout archives the old test customer/checkout/subscription IDs and starts fresh live billing while preserving Owner grants, bonus credits, and daily usage. Live mappings cannot be overwritten using test credentials. The privacy operator removes both current and archived provider customers, using the retained test-key file for archived records. No real charge is made as part of automated acceptance testing.

## Verification

`npm test` covers all fixed/flexible allowances, concurrency and idempotency, bonus use/refunds, UTC reset, grant/subscription expiry, plan priority, RLS, owner-only access, signed/tampered webhooks, and stale-event replay.

The opt-in provider/browser acceptance test uses only synthetic Supabase accounts and Stripe test payments, removes accounts/customers/avatars afterward, and captures desktop/mobile views:

```
RUN_BILLING_TESTS=1 node --env-file=.env.local --env-file=.env.operator.local --import tsx tests/live/billing-flow.ts
```

Set `BILLING_TEST_URL=https://scriblune.com` to verify a deployed test-mode build. Run Supabase advisors after migrations. No live card or real-user payment is used by these tests.

Reviewed Free allowance associations are described in [free-tier-guard.md](free-tier-guard.md). They are off by default. Admin-confirmed associations and conservative automatic pairs in enforcement mode share eligible Free included credits and new-workspace creation; paid allowances, owner grants, bonus credits and saved work remain per account. No historical usage is reclassified.
