-- Additive migration. Aborts on name conflicts; never replaces an existing application.
-- Apply only after inspecting the target schema. Applied to the supplied empty project after inspection.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'scriblune_server') then
    create role scriblune_server nologin noinherit;
  end if;
end $$;
grant usage on schema public, private to scriblune_server;
create function private.account_id() returns uuid language sql stable security invoker set search_path = '' as $$
  select nullif(current_setting('app.account_id', true), '')::uuid
$$;
revoke all on function private.account_id() from public;
grant execute on function private.account_id() to scriblune_server;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check(length(display_name) <= 100),
  adult_attested_at timestamptz not null,
  preferences_enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.tutoring_sessions (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(length(title) between 1 and 160), subject text not null default 'General',
  status text not null default 'draft' check(status in ('draft','submitted')),
  scene_revision integer not null default 0 check(scene_revision >= 0),
  work_revision integer not null default 0 check(work_revision >= 0),
  rubric_revision integer not null default 0,
  active_page_id uuid, viewport jsonb not null default '{}',
  summary jsonb not null default '{"version":1,"facts":[],"sources":[]}',
  feedback_submitted boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id, account_id)
);
create index tutoring_sessions_owner_idx on public.tutoring_sessions(account_id,updated_at desc);
create table public.documents (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  name text not null check(length(name) <= 255), role text not null check(role in ('assignment','student_work','rubric','reference','mixed','scratch')),
  mime text not null check(mime in ('application/pdf','image/png','image/jpeg','image/webp','application/x-scriblune-scratch')),
  storage_path text not null unique, byte_size bigint not null check(byte_size >= 0 and byte_size <= 20971520),
  status text not null default 'uploading' check(status in ('uploading','queued','processing','ready','failed')),
  error text, page_count integer not null default 0 check(page_count between 0 and 30),
  created_at timestamptz not null default now(), unique(id,session_id)
);
create table public.document_pages (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  document_id uuid not null, page_number integer not null check(page_number between 1 and 30),
  width double precision not null check(width > 0 and width <= 4000), height double precision not null check(height > 0 and height <= 12000),
  original_width double precision not null, original_height double precision not null,
  rotation integer not null default 0 check(rotation in (0,90,180,270)), crop jsonb,
  render_path text, text_content text not null default '', source_regions jsonb not null default '[]',
  extraction_method text not null default 'visual' check(extraction_method in ('text','visual','scratch')),
  inspected_at timestamptz, created_at timestamptz not null default now(),
  unique(id,session_id), unique(document_id,page_number),
  foreign key(document_id,session_id) references public.documents(id,session_id) on delete cascade
);
create table public.problem_regions (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  page_id uuid not null, label text not null, content text not null, region jsonb not null,
  source text not null check(source in ('text','visual','student')), confidence text not null default 'unconfirmed',
  unique(id,session_id), foreign key(page_id,session_id) references public.document_pages(id,session_id) on delete cascade
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  turn_id uuid not null, role text not null check(role in ('student','tutor','system')),
  content text not null check(length(content) <= 60000), references_json jsonb not null default '[]',
  status text not null default 'complete' check(status in ('complete','interrupted','failed')),
  created_at timestamptz not null default now(), unique(session_id,turn_id,role), unique(id,session_id)
);
create table public.tutor_turns (
  id uuid primary key, session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  status text not null check(status in ('running','complete','cancelled','failed')),
  base_scene_revision integer not null, base_work_revision integer not null,
  displayed_action_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(), finished_at timestamptz,
  unique(id,session_id)
);
create unique index one_active_turn_per_session on public.tutor_turns(session_id) where status='running';
create table public.annotation_objects (
  id uuid primary key, session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  page_id uuid not null, actor text not null check(actor in ('student','tutor','grading')),
  action_group_id uuid not null, revision integer not null, object jsonb not null, deleted boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,session_id), foreign key(page_id,session_id) references public.document_pages(id,session_id) on delete cascade
);
create table public.workspace_events (
  id uuid primary key, session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  sequence_number integer not null, action_group_id uuid not null, turn_id uuid,
  actor text not null check(actor in ('student','tutor','grading','system')), page_id uuid,
  event_type text not null, payload jsonb not null, created_at timestamptz not null default now(),
  unique(session_id,sequence_number), unique(id,session_id),
  foreign key(page_id,session_id) references public.document_pages(id,session_id) on delete cascade,
  foreign key(turn_id,session_id) references public.tutor_turns(id,session_id)
);
create table public.workspace_snapshots (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  scene_revision integer not null, work_revision integer not null, objects jsonb not null,
  created_at timestamptz not null default now(), unique(session_id,scene_revision)
);
create table public.learning_memories (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  problem_id uuid, kind text not null check(kind in ('preference','goal','ledger','fact','inference')),
  content jsonb not null, source_ids uuid[] not null default '{}', version integer not null default 1,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(problem_id,session_id) references public.problem_regions(id,session_id)
);
create table public.learning_preferences (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check(length(content) between 1 and 500), active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.rubrics (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  revision integer not null, title text not null, provisional boolean not null,
  criteria jsonb not null, scope_page_ids uuid[] not null, confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(), unique(id,session_id), unique(session_id,revision)
);
create table public.grading_reviews (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.tutoring_sessions(id) on delete cascade,
  work_revision integer not null, rubric_revision integer not null, rubric_id uuid not null,
  scope_page_ids uuid[] not null, result jsonb not null,
  readiness_status text not null check(readiness_status in ('ready','needs_work','uncertain')),
  challenge_of uuid, created_at timestamptz not null default now(), unique(id,session_id),
  foreign key(rubric_id,session_id) references public.rubrics(id,session_id),
  foreign key(challenge_of,session_id) references public.grading_reviews(id,session_id)
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(), session_id uuid not null unique references public.tutoring_sessions(id) on delete cascade,
  review_id uuid not null, work_revision integer not null, rubric_revision integer not null,
  scope_page_ids uuid[] not null, snapshot jsonb not null, created_at timestamptz not null default now(),
  unique(id,session_id), foreign key(review_id,session_id) references public.grading_reviews(id,session_id)
);
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, account_id uuid not null,
  document_id uuid not null, page_id uuid, kind text not null default 'ingest' check(kind in ('ingest','index')),
  status text not null default 'queued' check(status in ('queued','running','complete','failed')),
  progress integer not null default 0 check(progress between 0 and 100), attempts integer not null default 0,
  error text, locked_until timestamptz, created_at timestamptz not null default now(),
  foreign key(session_id,account_id) references public.tutoring_sessions(id,account_id) on delete cascade,
  foreign key(document_id,session_id) references public.documents(id,session_id) on delete cascade,
  foreign key(page_id,session_id) references public.document_pages(id,session_id) on delete cascade
);
create unique index one_ingestion_per_document on public.processing_jobs(document_id) where kind='ingest';
create unique index one_index_per_page on public.processing_jobs(page_id) where kind='index';
create table public.feedback_question_sets (
  session_id uuid primary key references public.tutoring_sessions(id) on delete cascade,
  questions jsonb not null, generator_version text not null, created_at timestamptz not null default now()
);
create table private.admin_memberships (
  account_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check(role in ('reviewer','admin')), created_at timestamptz not null default now()
);
create function private.is_admin() returns boolean language sql stable security invoker set search_path = '' as $$
 select exists(select 1 from private.admin_memberships where account_id = (select private.account_id()))
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to scriblune_server;
create table private.session_feedback (
  id uuid primary key default gen_random_uuid(), session_id uuid not null unique, account_id uuid not null,
  rating integer not null check(rating between 1 and 5), subject text not null,
  review_status text not null default 'new' check(review_status in ('new','reviewed','acted_upon')),
  severity text not null default 'untriaged' check(severity in ('untriaged','low','medium','high')),
  issue_category text not null default 'general', notes text not null default '' check(length(notes)<=4000),
  generator_version text not null, created_at timestamptz not null default now(), reviewed_at timestamptz,
  unique(id,account_id), foreign key(session_id,account_id) references public.tutoring_sessions(id,account_id) on delete cascade
);
create table private.feedback_answers (
  id uuid primary key default gen_random_uuid(), feedback_id uuid not null, account_id uuid not null,
  question_id text not null, question_wording text not null, options jsonb not null, answer text,
  elaboration text check(length(elaboration)<=2000), related_event_ids uuid[] not null,
  created_at timestamptz not null default now(), unique(feedback_id,question_id),
  foreign key(feedback_id,account_id) references private.session_feedback(id,account_id) on delete cascade
);
create table private.feedback_insights (
  id uuid primary key default gen_random_uuid(), feedback_id uuid not null, account_id uuid not null,
  tags text[] not null default '{}', analysis jsonb not null, created_at timestamptz not null default now(),
  foreign key(feedback_id,account_id) references private.session_feedback(id,account_id) on delete cascade
);
create table private.admin_audit_log (
  id uuid primary key default gen_random_uuid(), admin_id uuid not null,
  action text not null, target_id uuid, created_at timestamptz not null default now()
);
create table private.privacy_requests (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check(request_type in ('access','deletion','correction')),
  details text not null check(length(details)<=3000),
  status text not null default 'pending' check(status in ('pending','verified','completed','declined')),
  resolution text not null default '' check(length(resolution)<=3000),
  reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now()
);

-- The server connects with a dedicated role and sets app.account_id inside each transaction.
-- Browsers have read-only owned access; no model/tutor/review writes can originate in the Data API.
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profile_server on public.profiles to scriblune_server using (id=(select private.account_id())) with check (id=(select private.account_id()));
alter table public.tutoring_sessions enable row level security;
create policy session_read on public.tutoring_sessions for select to authenticated using(account_id=(select auth.uid()));
create policy session_server on public.tutoring_sessions to scriblune_server using(account_id=(select private.account_id())) with check(account_id=(select private.account_id()));
do $$ declare t text; begin
  foreach t in array array['documents','document_pages','problem_regions','messages','tutor_turns','annotation_objects','workspace_events','workspace_snapshots','learning_memories','rubrics','grading_reviews','submissions','feedback_question_sets'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owned_read on public.%I for select to authenticated using (exists(select 1 from public.tutoring_sessions s where s.id=session_id and s.account_id=(select auth.uid())))',t);
    execute format('create policy owned_server on public.%I to scriblune_server using (exists(select 1 from public.tutoring_sessions s where s.id=session_id and s.account_id=(select private.account_id()))) with check (exists(select 1 from public.tutoring_sessions s where s.id=session_id and s.account_id=(select private.account_id())))',t);
    execute format('create index on public.%I(session_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to scriblune_server',t);
  end loop;
end $$;
alter table public.processing_jobs enable row level security;
create policy jobs_read on public.processing_jobs for select to authenticated using(account_id=(select auth.uid()));
create policy jobs_server on public.processing_jobs to scriblune_server using(true) with check(true);
create index processing_jobs_claim_idx on public.processing_jobs(status,locked_until,created_at);
alter table public.learning_preferences enable row level security;
create policy preferences_read on public.learning_preferences for select to authenticated using(account_id=(select auth.uid()));
create policy preferences_server on public.learning_preferences to scriblune_server using(account_id=(select private.account_id())) with check(account_id=(select private.account_id()));
create index learning_preferences_owner_idx on public.learning_preferences(account_id);
revoke all on public.profiles,public.tutoring_sessions,public.processing_jobs,public.learning_preferences from public,anon,authenticated;
grant select on public.profiles,public.tutoring_sessions,public.processing_jobs,public.learning_preferences to authenticated;
grant select,insert,update,delete on public.profiles,public.tutoring_sessions,public.processing_jobs,public.learning_preferences to scriblune_server;
-- Immutable records and append-only event log, including for the application role.
revoke update,delete on public.workspace_events,public.workspace_snapshots,public.submissions,public.grading_reviews,public.rubrics from scriblune_server;

alter table private.admin_memberships enable row level security;
create policy own_membership on private.admin_memberships for select to scriblune_server using(account_id=(select private.account_id()));
grant select on private.admin_memberships to scriblune_server;
do $$ declare t text; begin
  foreach t in array array['session_feedback','feedback_answers','feedback_insights','privacy_requests'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('create policy server_insert on private.%I for insert to scriblune_server with check(account_id=(select private.account_id()))',t);
    execute format('create policy admin_read on private.%I for select to scriblune_server using((select private.is_admin()))',t);
    execute format('create policy admin_update on private.%I for update to scriblune_server using((select private.is_admin())) with check((select private.is_admin()))',t);
    execute format('create index on private.%I(account_id)',t);
    execute format('grant select,insert,update on private.%I to scriblune_server',t);
  end loop;
end $$;
alter table private.admin_audit_log enable row level security;
create policy audit_insert on private.admin_audit_log for insert to scriblune_server with check(admin_id=(select private.account_id()) and (select private.is_admin()));
create policy audit_read on private.admin_audit_log for select to scriblune_server using((select private.is_admin()));
grant select,insert on private.admin_audit_log to scriblune_server;
revoke all on all tables in schema private from public,anon,authenticated,service_role;
revoke all on all sequences in schema private from public,anon,authenticated,service_role;

-- Storage is reachable only via authenticated ownership-checked server proxy routes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('scriblune-private','scriblune-private',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='scriblune-private' and public) then
  raise exception 'Existing scriblune-private bucket is public; review it before applying this migration.';
 end if;
end $$;
-- No browser policies, no publication membership, no feedback Realtime channel.
-- Students synchronize from the durable, authenticated HTTP event log. Realtime is deliberately unnecessary.
commit;
