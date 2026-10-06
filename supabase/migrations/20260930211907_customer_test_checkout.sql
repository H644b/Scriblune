-- A persisted Owner control. Browser roles never access billing configuration.
create table private.billing_settings (
 id boolean primary key default true check(id),
 customer_test_checkout boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into private.billing_settings(id) values(true);
alter table private.billing_settings enable row level security;
revoke all on private.billing_settings from public,anon,authenticated;
grant select,update on private.billing_settings to scriblune_server;
create policy billing_settings_read on private.billing_settings for select to scriblune_server using(true);
create policy billing_settings_owner_update on private.billing_settings for update to scriblune_server
 using((select private.is_owner())) with check((select private.is_owner()));
