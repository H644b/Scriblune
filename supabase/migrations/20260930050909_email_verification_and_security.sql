begin;

-- Retain historical attestations without requiring or collecting new ones.
alter table public.profiles alter column adult_attested_at drop not null;

create table private.account_security (
  account_id uuid primary key references auth.users(id) on delete cascade,
  email_two_step boolean not null default false,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);
create table private.verified_sessions (
  session_id uuid primary key,
  account_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  security_version integer not null,
  expires_at timestamptz not null default now() + interval '30 days'
);
create index verified_sessions_account_idx on private.verified_sessions(account_id);
create index verified_sessions_expiry_idx on private.verified_sessions(expires_at);
create table private.auth_challenges (
  id uuid primary key,
  account_id uuid references auth.users(id) on delete cascade,
  email text not null,
  purpose text not null check (purpose in ('signup','login','recovery','enable','disable')),
  code_hash text not null,
  payload text not null,
  attempts smallint not null default 0 check (attempts between 0 and 6),
  consumed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index auth_challenges_account_idx on private.auth_challenges(account_id);
create index auth_challenges_expiry_idx on private.auth_challenges(expires_at);
create table private.auth_rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
create index auth_rate_limits_expiry_idx on private.auth_rate_limits(expires_at);

alter table private.account_security enable row level security;
alter table private.verified_sessions enable row level security;
alter table private.auth_challenges enable row level security;
alter table private.auth_rate_limits enable row level security;
create policy security_owner on private.account_security to scriblune_server
  using (account_id=(select private.account_id())) with check (account_id=(select private.account_id()));
create policy verified_owner on private.verified_sessions to scriblune_server
  using (account_id=(select private.account_id())) with check (account_id=(select private.account_id()));
-- Pre-authentication endpoints access these only through the trusted server login.
create policy challenge_server on private.auth_challenges to scriblune_server using (true) with check (true);
create policy rate_server on private.auth_rate_limits to scriblune_server using (true) with check (true);
revoke all on private.account_security,private.verified_sessions,private.auth_challenges,private.auth_rate_limits from public,anon,authenticated,service_role;
grant select,insert,update,delete on private.account_security,private.verified_sessions,private.auth_challenges,private.auth_rate_limits to scriblune_server;

-- All application reads already use ownership-checked HTTP routes. Remove the
-- alternate Data API path so a password-only Supabase token cannot bypass the
-- application's email second step. Existing owner RLS policies stay in place.
revoke all on public.profiles,public.tutoring_sessions,public.documents,public.document_pages,
  public.problem_regions,public.messages,public.tutor_turns,public.annotation_objects,
  public.workspace_events,public.workspace_snapshots,public.learning_memories,public.rubrics,
  public.grading_reviews,public.submissions,public.feedback_question_sets,public.processing_jobs,
  public.learning_preferences from public,anon,authenticated;
commit;
