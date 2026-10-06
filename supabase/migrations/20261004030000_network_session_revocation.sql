-- Revoke only the validated caller's current native login, never another account.
-- Does not change account holds, security settings, usage or stored study work.
create function private.revoke_current_login(p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := private.account_id();
begin
  if actor is null then raise exception using errcode='42501',message='Sign-in required'; end if;
  delete from auth.refresh_tokens where session_id in
    (select id from auth.sessions where id=p_session and user_id=actor);
  delete from auth.sessions where id=p_session and user_id=actor;
  delete from private.verified_sessions where session_id=p_session and account_id=actor;
end
$$;
revoke all on function private.revoke_current_login(uuid) from public,anon,authenticated,service_role;
grant execute on function private.revoke_current_login(uuid) to scriblune_server;
