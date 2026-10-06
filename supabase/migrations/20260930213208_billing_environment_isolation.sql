-- Existing provider records were created with test credentials. Never interpret
-- those subscriptions as real payments after switching to live keys.
alter table private.billing_accounts
 add column stripe_livemode boolean not null default false,
 add column test_billing_archive jsonb;
