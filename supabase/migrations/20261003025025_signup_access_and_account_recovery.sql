-- Local-only until the access-control release is explicitly approved.
create function private.is_account_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_owner() or exists(select 1 from private.staff_assignments a join private.staff_roles r on r.key=a.role_key
 where a.account_id=private.account_id() and r.key='admin' and r.builtin)
$$;
revoke all on function private.is_account_admin() from public,anon,authenticated,service_role;
grant execute on function private.is_account_admin() to scriblune_server;

create table private.signup_settings (
 singleton boolean primary key default true check(singleton),
 mode text not null default 'open' check(mode in ('open','closed','waitlist')),
 revision integer not null default 0,
 updated_at timestamptz not null default now()
);
insert into private.signup_settings(singleton) values(true);
create table private.signup_waitlist (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email=lower(trim(email)) and length(email) between 3 and 254),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 revision integer not null default 0,
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 decided_by uuid references auth.users(id) on delete set null
);
create index signup_waitlist_page on private.signup_waitlist(status,created_at,id);
create table private.access_actions (
 id uuid primary key,
 actor_id uuid references auth.users(id) on delete set null,
 target_id uuid,
 kind text not null check(kind in ('signup_mode','waitlist_approve','waitlist_reject','password_recovery','revoke_sessions','reset_totp','reset_passkeys','reset_factors','request_deletion')),
 intent_hash text not null check(length(intent_hash)=64),
 reason text not null check(length(reason) between 8 and 500),
 result jsonb not null,
 created_at timestamptz not null default now()
);
create index access_actions_page on private.access_actions(created_at desc,id);
create index access_actions_target on private.access_actions(target_id,created_at desc);
create table private.account_access_holds (
 account_id uuid primary key references auth.users(id) on delete cascade,
 action_id uuid not null references private.access_actions(id),
 created_at timestamptz not null default now()
);
create table private.account_recovery_links (
 token_hash text primary key check(length(token_hash)=64),
 account_id uuid not null references auth.users(id) on delete cascade,
 action_id uuid not null unique references private.access_actions(id),
 email text not null,
 security_version integer not null,
 expires_at timestamptz not null,
 consumed_at timestamptz
);
create index account_recovery_links_account on private.account_recovery_links(account_id);
create table private.access_mail (
 id uuid primary key references private.access_actions(id),
 account_id uuid references auth.users(id) on delete set null,
 kind text not null,
 recipient text not null,
 payload text not null check(length(payload) between 10 and 12000),
 status text not null default 'pending' check(status in ('pending','sending','sent','blocked')),
 attempts integer not null default 0 check(attempts between 0 and 6),
 available_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 deadline timestamptz not null,
 first_attempt_at timestamptz,
 locked_until timestamptz,
 lease_token uuid,
 sent_at timestamptz,
 provider_id text,
 last_error_code text check(length(last_error_code)<=80)
);
create index access_mail_due on private.access_mail(available_at,created_at) where status in ('pending','sending');
alter table private.signup_settings enable row level security;
alter table private.signup_waitlist enable row level security;
alter table private.access_actions enable row level security;
alter table private.account_access_holds enable row level security;
alter table private.account_recovery_links enable row level security;
alter table private.access_mail enable row level security;
revoke all on private.signup_settings,private.signup_waitlist,private.access_actions,private.account_access_holds,private.account_recovery_links,private.access_mail from public,anon,authenticated,service_role;
grant select on private.signup_settings to scriblune_server;
grant update(mode,revision,updated_at) on private.signup_settings to scriblune_server;
create policy signup_mode_read on private.signup_settings for select to scriblune_server using(true);
create policy signup_mode_owner on private.signup_settings for update to scriblune_server using(private.is_owner()) with check(private.is_owner());
grant select,insert on private.signup_waitlist to scriblune_server;
grant update(status,revision,decided_at,decided_by) on private.signup_waitlist to scriblune_server;
create policy waitlist_read on private.signup_waitlist for select to scriblune_server using(private.account_id() is null or private.is_owner());
create policy waitlist_join on private.signup_waitlist for insert to scriblune_server with check(private.account_id() is null and status='pending' and revision=0 and decided_by is null and decided_at is null);
create policy waitlist_owner on private.signup_waitlist for update to scriblune_server using(private.is_owner()) with check(private.is_owner() and decided_by=private.account_id());
grant select,insert on private.access_actions to scriblune_server;
create policy access_audit_read on private.access_actions for select to scriblune_server using(private.is_account_admin());
create policy access_audit_write on private.access_actions for insert to scriblune_server with check(actor_id=private.account_id() and private.is_account_admin());
grant select on private.account_access_holds to scriblune_server;
create policy account_hold_read on private.account_access_holds for select to scriblune_server using(private.account_id() is null or account_id=private.account_id() or private.is_account_admin());
grant select,insert on private.account_recovery_links to scriblune_server;
grant update(consumed_at) on private.account_recovery_links to scriblune_server;
create policy recovery_link_read on private.account_recovery_links for select to scriblune_server using(private.account_id() is null or private.is_account_admin());
create policy recovery_link_insert on private.account_recovery_links for insert to scriblune_server with check(private.is_account_admin());
create policy recovery_link_consume on private.account_recovery_links for update to scriblune_server using(private.account_id() is null) with check(private.account_id() is null);
grant select,insert on private.access_mail to scriblune_server;
grant update(status,attempts,available_at,first_attempt_at,locked_until,lease_token,sent_at,provider_id,last_error_code) on private.access_mail to scriblune_server;
create policy access_mail_read on private.access_mail for select to scriblune_server using(private.account_id() is null or private.is_account_admin());
create policy access_mail_enqueue on private.access_mail for insert to scriblune_server with check(private.is_account_admin() and exists(select 1 from private.access_actions a where a.id=access_mail.id and a.actor_id=private.account_id()));
create policy access_mail_worker on private.access_mail for update to scriblune_server using(private.account_id() is null) with check(private.account_id() is null);

-- The trusted server checks a live session on every authenticated request.
-- Existing column grants expose no refresh token or authentication secret.
create policy scriblune_own_active_session on auth.sessions for select to scriblune_server using(user_id=private.account_id());
create view private.account_login_sessions with(security_invoker=true,security_barrier=true) as
 select id,user_id,not_after from auth.sessions where user_id=private.account_id();
revoke all on private.account_login_sessions from public,anon,authenticated,service_role;
grant select on private.account_login_sessions to scriblune_server;
-- Keep the existing console-only projection owner-only after the own-session
-- policy is added for normal account revocation checks.
create or replace view private.owner_login_sessions with(security_invoker=true,security_barrier=true) as
 select id,user_id,not_after from auth.sessions where private.is_owner();
alter table private.auth_challenges drop constraint auth_challenges_purpose_check;
alter table private.auth_challenges add constraint auth_challenges_purpose_check
 check(purpose in ('signup','login','recovery','enable','disable','totp_setup','passkey_setup','staff_action'));

-- Guard the underlying Auth writes, including direct Auth/API, admin-generated
-- links, OAuth, anonymous creation, and first verification of a pending signup.
-- This trigger must be owned by the migration operator, never by an app role.
create function private.enforce_signup_mode() returns trigger language plpgsql security definer set search_path='' as $$
declare mode_value text;
begin
 select mode into mode_value from private.signup_settings where singleton for share;
 if mode_value='open' then return new; end if;
 if mode_value='waitlist' and new.email is not null and exists(select 1 from private.signup_waitlist
   where email=lower(trim(new.email)) and status='approved') then return new; end if;
 raise exception using errcode='P0001',message='New account registration is not available for this address.';
end $$;
revoke all on function private.enforce_signup_mode() from public,anon,authenticated,service_role,scriblune_server;
create trigger scriblune_signup_insert before insert on auth.users for each row execute function private.enforce_signup_mode();
create trigger scriblune_signup_verify before update of email_confirmed_at on auth.users for each row
 when(old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function private.enforce_signup_mode();

-- A narrow, private definer function is required for cross-account factor and
-- Auth-session invalidation. It cannot execute arbitrary SQL or alter roles.
-- Every path checks the database-owned exact Admin role, protected targets,
-- a typed email confirmation, and the immutable idempotency intent.
create function private.manage_account(p_id uuid,p_target uuid,p_kind text,p_reason text,p_email text,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.account_id(); owner_actor boolean; target_email text; verified_at timestamptz;
 previous private.access_actions; result jsonb; version_value integer; deletion_id uuid;
begin
 if actor is null or not private.is_account_admin() then raise exception using errcode='42501',message='Administrator access required.'; end if;
 perform pg_advisory_xact_lock(hashtext(p_id::text));
 select * into previous from private.access_actions where id=p_id;
 if found then
  if previous.actor_id is distinct from actor or previous.intent_hash<>p_hash then raise exception using errcode='23505',message='Action ID already used.'; end if;
  return previous.result||jsonb_build_object('duplicate',true);
 end if;
 if p_target=actor or exists(select 1 from private.site_owners where account_id=p_target) then
  raise exception using errcode='42501',message='Self and owner accounts are protected. Use independent operator recovery.';
 end if;
 owner_actor:=private.is_owner();
 if not owner_actor and exists(select 1 from private.staff_assignments where account_id=p_target and role_key='admin') then
  raise exception using errcode='42501',message='Only an owner can recover another Administrator.';
 end if;
 if p_kind not in ('password_recovery','revoke_sessions','reset_totp','reset_passkeys','reset_factors','request_deletion') or length(p_reason) not between 8 and 500 or length(p_hash)<>64 then
  raise exception using errcode='22023',message='Invalid account action.';
 end if;
 select email,email_confirmed_at into target_email,verified_at from auth.users where id=p_target for update;
 if not found or target_email is null or lower(target_email)<>p_email then raise exception using errcode='22023',message='Account confirmation does not match.'; end if;
 if verified_at is null and p_kind in ('password_recovery','reset_totp','reset_passkeys','reset_factors') then
  raise exception using errcode='22023',message='Verified account email required for recovery.';
 end if;
 if exists(select 1 from private.account_access_holds where account_id=p_target) then
  raise exception using errcode='22023',message='This account is awaiting permanent deletion; use the operator workflow.';
 end if;
 insert into private.account_security(account_id) values(p_target) on conflict do nothing;
 select version into version_value from private.account_security where account_id=p_target for update;
 if p_kind<>'password_recovery' then
  update private.account_security set version=version+1,updated_at=now() where account_id=p_target returning version into version_value;
  delete from private.verified_sessions where account_id=p_target;
  delete from private.auth_challenges where account_id=p_target;
  delete from private.account_recovery_links where account_id=p_target;
  update private.access_mail set status='blocked',locked_until=null,lease_token=null,last_error_code='RECOVERY_REVOKED'
    where account_id=p_target and kind='password_recovery' and status in ('pending','sending');
  delete from auth.sessions where user_id=p_target;
  delete from auth.one_time_tokens where user_id=p_target;
  delete from auth.flow_state where user_id=p_target or linking_target_id=p_target;
  update auth.users set confirmation_token='',recovery_token='',reauthentication_token='',
    email_change_token_new='',email_change_token_current='',email_change='',email_change_confirm_status=0,
    phone_change_token='',phone_change='' where id=p_target;
 end if;
 if p_kind in ('reset_totp','reset_factors') then
  update private.account_security set totp_secret=null,totp_last_step=-1 where account_id=p_target;
 end if;
 if p_kind in ('reset_passkeys','reset_factors') then delete from private.account_passkeys where account_id=p_target; end if;
 if p_kind in ('reset_totp','reset_passkeys','reset_factors') then
  update private.account_security set email_two_step=true where account_id=p_target;
  delete from private.account_recovery_codes where account_id=p_target;
 end if;
 if p_kind='request_deletion' then
  select id into deletion_id from private.privacy_requests where account_id=p_target and request_type='deletion' and status in ('pending','verified') order by created_at limit 1 for update;
  if deletion_id is null then
   deletion_id:=gen_random_uuid();
   insert into private.privacy_requests(id,account_id,request_type,details,status,reviewed_by,reviewed_at)
    values(deletion_id,p_target,'deletion','Admin-confirmed deletion: '||p_reason,'verified',actor,now());
  else
   update private.privacy_requests set status='verified',reviewed_by=actor,reviewed_at=now() where id=deletion_id;
  end if;
 end if;
 result:=jsonb_build_object('id',p_id,'target_id',p_target,'email',target_email,'kind',p_kind,'security_version',version_value,'status',case when p_kind='request_deletion' then 'awaiting_operator' else 'completed' end,'privacy_request_id',deletion_id);
 insert into private.access_actions(id,actor_id,target_id,kind,intent_hash,reason,result) values(p_id,actor,p_target,p_kind,p_hash,p_reason,result);
 if p_kind='request_deletion' then insert into private.account_access_holds(account_id,action_id) values(p_target,p_id); end if;
 return result||jsonb_build_object('duplicate',false);
end $$;
revoke all on function private.manage_account(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.manage_account(uuid,uuid,text,text,text,text) to scriblune_server;

-- Return a bounded directory projection, never credential or token columns.
create function private.account_directory(p_search text,p_after uuid,p_limit integer)
returns table(id uuid,email text,email_verified boolean,created_at timestamptz,is_owner boolean,is_admin boolean,on_hold boolean,totp boolean,email_two_step boolean,passkeys integer,backup_codes integer)
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_account_admin() then raise exception using errcode='42501',message='Administrator access required.'; end if;
 if p_limit is null or p_search is null or p_limit not between 1 and 50 or length(p_search)>254 then raise exception using errcode='22023',message='Invalid directory page.'; end if;
 return query select u.id,u.email::text,u.email_confirmed_at is not null,u.created_at,
 exists(select 1 from private.site_owners o where o.account_id=u.id),
 exists(select 1 from private.staff_assignments a where a.account_id=u.id and a.role_key='admin'),
 exists(select 1 from private.account_access_holds h where h.account_id=u.id),
 coalesce(s.totp_secret is not null,false),coalesce(s.email_two_step,false),
 (select count(*)::integer from private.account_passkeys k where k.account_id=u.id),
 (select count(*)::integer from private.account_recovery_codes c where c.account_id=u.id)
 from auth.users u left join private.account_security s on s.account_id=u.id
 where (p_search='' or lower(u.email)=lower(p_search) or u.id::text=p_search) and (p_after is null or u.id>p_after)
 order by u.id limit p_limit;
end $$;
revoke all on function private.account_directory(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.account_directory(text,uuid,integer) to scriblune_server;
