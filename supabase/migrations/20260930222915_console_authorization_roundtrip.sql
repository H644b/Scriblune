begin;
-- The restricted login already has permission to SET ROLE scriblune_server.
-- This invoker function performs the same transaction-local role/context setup
-- inside one network request. It never assumes the migration owner's rights.
create function private.console_access(p_account uuid, p_login uuid, p_email text)
returns table(is_owner boolean, active boolean, verified boolean)
language plpgsql security invoker volatile set search_path = '' as $$
begin
  set local role scriblune_server;
  perform set_config('app.account_id',p_account::text,true);
  return query select
    exists(select 1 from private.site_owners where account_id=p_account),
    exists(select 1 from private.owner_login_sessions where id=p_login and user_id=p_account and (not_after is null or not_after>now())),
    not exists(select 1 from private.account_security s where s.account_id=p_account
      and (s.email_two_step or s.totp_secret is not null or exists(select 1 from private.account_passkeys where account_id=s.account_id))
      and not exists(select 1 from private.verified_sessions v where v.session_id=p_login and v.account_id=s.account_id and v.email=p_email and v.security_version=s.version and v.expires_at>now()));
end;
$$;
revoke all on function private.console_access(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.console_access(uuid,uuid,text) to scriblune_server;
-- The deployed application's non-inheriting login can invoke only this helper
-- without first setting a role; other private table privileges stay unchanged.
do $$ begin
  if exists(select 1 from pg_roles where rolname='scriblune_app') then
    grant usage on schema private to scriblune_app;
    grant execute on function private.console_access(uuid,uuid,text) to scriblune_app;
  end if;
end $$;
commit;
