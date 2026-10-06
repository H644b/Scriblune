-- The console checks revocation on every request, beyond JWT expiry. No token
-- values or other auth-session columns are readable by the application role.
grant usage on schema auth to scriblune_server;
grant select (id,user_id,not_after) on auth.sessions to scriblune_server;
create policy scriblune_owner_console_session on auth.sessions
  for select to scriblune_server using (
    user_id=(select private.account_id()) and (select private.is_owner())
  );
