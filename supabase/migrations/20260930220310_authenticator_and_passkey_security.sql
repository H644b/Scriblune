begin;
alter table private.account_security
  add column totp_secret text,
  add column totp_last_step bigint not null default -1;
alter table private.auth_challenges drop constraint auth_challenges_purpose_check;
alter table private.auth_challenges add constraint auth_challenges_purpose_check
  check (purpose in ('signup','login','recovery','enable','disable','totp_setup','passkey_setup'));
create table private.account_passkeys (
  id text primary key,
  account_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  public_key text not null,
  counter bigint not null check (counter >= 0),
  transports jsonb not null default '[]',
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index account_passkeys_account_idx on private.account_passkeys(account_id);
create table private.account_recovery_codes (
  account_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  primary key (account_id,code_hash)
);
alter table private.account_passkeys enable row level security;
alter table private.account_recovery_codes enable row level security;
create policy passkey_owner on private.account_passkeys to scriblune_server
  using(account_id=(select private.account_id())) with check(account_id=(select private.account_id()));
create policy recovery_code_owner on private.account_recovery_codes to scriblune_server
  using(account_id=(select private.account_id())) with check(account_id=(select private.account_id()));
revoke all on private.account_passkeys,private.account_recovery_codes from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.account_passkeys,private.account_recovery_codes to scriblune_server;
commit;
