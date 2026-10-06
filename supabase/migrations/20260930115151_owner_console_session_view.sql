-- Supabase owns the auth namespace and may not delegate its USAGE grant.
-- An invoker view resolves the table at creation but still enforces the calling
-- server role's column grants and Owner-only RLS. No definer rights are used.
create view private.owner_login_sessions
with (security_invoker=true, security_barrier=true) as
select id,user_id,not_after from auth.sessions;
revoke all on private.owner_login_sessions from public,anon,authenticated,service_role;
grant select on private.owner_login_sessions to scriblune_server;
