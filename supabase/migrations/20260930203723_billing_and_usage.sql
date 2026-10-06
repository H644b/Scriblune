-- Billing is private server data. Browser roles cannot read or mutate it.
create table private.billing_accounts (
 account_id uuid primary key references auth.users(id) on delete cascade,
 customer_id text unique,
 subscription_id text unique,
 subscription_plan text not null default 'free' check(subscription_plan in ('free','plus','focus','flex')),
 flex_credits integer not null default 30 check(flex_credits between 30 and 200 and flex_credits%10=0),
 subscription_status text not null default 'none',
 paid_until timestamptz,
 cancel_at_period_end boolean not null default false,
 checkout_id text,
 checkout_key uuid,
 checkout_plan text,
 checkout_credits integer,
 bonus_credits integer not null default 0 check(bonus_credits between 0 and 1000000),
 synced_at timestamptz,
 created_at timestamptz not null default now()
);
create table private.billing_grants (
 account_id uuid primary key references auth.users(id) on delete cascade,
 plan text not null check(plan in ('free','plus','focus','flex')),
 flex_credits integer not null default 30 check(flex_credits between 30 and 200 and flex_credits%10=0),
 expires_at timestamptz,
 granted_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index billing_grants_actor on private.billing_grants(granted_by);
create table private.usage_ledger (
 account_id uuid not null references auth.users(id) on delete cascade,
 reference_id uuid not null,
 kind text not null check(kind in ('session','prompt')),
 day date not null default (now() at time zone 'UTC')::date,
 source text not null check(source in ('included','bonus')),
 refunded boolean not null default false,
 created_at timestamptz not null default now(),
 primary key(account_id,kind,reference_id)
);
create index usage_ledger_daily on private.usage_ledger(account_id,day,kind) where not refunded;
create table private.billing_events (
 id text primary key,
 account_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index billing_events_account on private.billing_events(account_id);
create table private.billing_grant_requests (
 id uuid primary key,
 account_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index billing_grant_requests_account on private.billing_grant_requests(account_id);
create index billing_grant_requests_actor on private.billing_grant_requests(actor_id);

do $$ declare t text; begin
 foreach t in array array['billing_accounts','usage_ledger','billing_events'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on private.%I to scriblune_server',t);
  execute format('create policy billing_account_scope on private.%I to scriblune_server using(account_id=(select private.account_id()) or (select private.is_owner())) with check(account_id=(select private.account_id()) or (select private.is_owner()))',t);
 end loop;
end $$;
alter table private.billing_grants enable row level security;
alter table private.billing_grant_requests enable row level security;
revoke all on private.billing_grants,private.billing_grant_requests from public,anon,authenticated;
grant select,insert,update,delete on private.billing_grants to scriblune_server;
grant select,insert on private.billing_grant_requests to scriblune_server;
create policy grants_read on private.billing_grants for select to scriblune_server using(account_id=(select private.account_id()) or (select private.is_owner()));
create policy grants_insert on private.billing_grants for insert to scriblune_server with check((select private.is_owner()) and granted_by=(select private.account_id()));
create policy grants_update on private.billing_grants for update to scriblune_server using((select private.is_owner())) with check((select private.is_owner()) and granted_by=(select private.account_id()));
create policy grants_delete on private.billing_grants for delete to scriblune_server using((select private.is_owner()));
create policy grant_requests_owner on private.billing_grant_requests to scriblune_server using((select private.is_owner())) with check((select private.is_owner()) and actor_id=(select private.account_id()));
