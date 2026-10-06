-- Checkout availability is independent of the Stripe credential environment.
alter table private.billing_settings add column checkout_access text not null default 'staff'
 check(checkout_access in ('off','staff','customers'));
update private.billing_settings set checkout_access=case when customer_test_checkout then 'customers' else 'staff' end;
comment on column private.billing_settings.customer_test_checkout is 'Legacy switch retained for rollback compatibility; use checkout_access.';
