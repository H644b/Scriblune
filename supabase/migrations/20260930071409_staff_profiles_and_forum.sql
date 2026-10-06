-- Staff permissions are database-owned, never auth user_metadata. Owners are
-- provisioned by an operator after verifying the account; the app cannot add one.
create table private.site_owners (
 account_id uuid primary key references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create table private.staff_roles (
 key text primary key check(key ~ '^[a-z][a-z0-9_]{1,29}$'),
 name text not null check(length(name) between 2 and 40),
 permissions text[] not null default '{}',
 builtin boolean not null default false,
 constraint valid_permissions check(permissions <@ array['feedback.read','feedback.triage','privacy.manage','forum.moderate','testing.tools']::text[]),
 constraint triage_requires_read check(not ('feedback.triage'=any(permissions)) or 'feedback.read'=any(permissions))
);
insert into private.staff_roles(key,name,permissions,builtin) values
 ('admin','Administrator',array['feedback.read','feedback.triage','privacy.manage'],true),
 ('reviewer','Feedback reviewer',array['feedback.read','feedback.triage'],true),
 ('moderator','Moderator',array['forum.moderate'],true),
 ('tester','Tester',array['testing.tools'],true);
create table private.staff_assignments (
 account_id uuid not null references auth.users(id) on delete cascade,
 role_key text not null references private.staff_roles(key) on delete cascade,
 assigned_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key(account_id,role_key)
);
create index staff_assignments_role on private.staff_assignments(role_key);
insert into private.staff_assignments(account_id,role_key) select account_id,role from private.admin_memberships;

alter table private.site_owners enable row level security;
alter table private.staff_roles enable row level security;
alter table private.staff_assignments enable row level security;
-- Readable only by the trusted server, including for public badge calculation.
create policy owner_server_read on private.site_owners for select to scriblune_server using(true);
create policy roles_server_read on private.staff_roles for select to scriblune_server using(true);
create policy assignments_server_read on private.staff_assignments for select to scriblune_server using(true);
grant select on private.site_owners to scriblune_server;
grant select,insert,update,delete on private.staff_roles,private.staff_assignments to scriblune_server;
create function private.is_owner() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.site_owners where account_id=(select private.account_id()))
$$;
create function private.has_permission(capability text) returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_owner() or exists(select 1 from private.staff_assignments a join private.staff_roles r on r.key=a.role_key where a.account_id=(select private.account_id()) and capability=any(r.permissions))
$$;
revoke all on function private.is_owner(),private.has_permission(text) from public;
grant execute on function private.is_owner(),private.has_permission(text) to scriblune_server;
create policy roles_owner_insert on private.staff_roles for insert to scriblune_server with check((select private.is_owner()) and not builtin);
create policy roles_owner_update on private.staff_roles for update to scriblune_server using((select private.is_owner())) with check((select private.is_owner()));
create policy roles_owner_delete on private.staff_roles for delete to scriblune_server using((select private.is_owner()) and not builtin);
create policy assignments_owner_insert on private.staff_assignments for insert to scriblune_server with check((select private.is_owner()));
create policy assignments_owner_delete on private.staff_assignments for delete to scriblune_server using((select private.is_owner()));
revoke update on private.staff_roles from scriblune_server;
grant update(name,permissions) on private.staff_roles to scriblune_server;
create or replace function private.is_admin() returns boolean language sql stable security invoker set search_path='' as $$ select private.has_permission('feedback.read') $$;
do $$ declare t text; begin
 foreach t in array array['session_feedback','feedback_answers','feedback_insights'] loop
  execute format('drop policy admin_update on private.%I',t);
  execute format('create policy admin_update on private.%I for update to scriblune_server using((select private.has_permission(''feedback.triage''))) with check((select private.has_permission(''feedback.triage'')))',t);
 end loop;
end $$;
drop policy admin_read on private.privacy_requests;
drop policy admin_update on private.privacy_requests;
create policy admin_read on private.privacy_requests for select to scriblune_server using((select private.has_permission('privacy.manage')));
create policy admin_update on private.privacy_requests for update to scriblune_server using((select private.has_permission('privacy.manage'))) with check((select private.has_permission('privacy.manage')));
drop policy audit_insert on private.admin_audit_log;
create policy audit_insert on private.admin_audit_log for insert to scriblune_server with check(admin_id=(select private.account_id()) and ((select private.is_admin()) or (select private.has_permission('privacy.manage'))));

create table private.staff_audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid references auth.users(id) on delete set null,
 action text not null,
 target_id uuid,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
alter table private.staff_audit enable row level security;
create policy staff_audit_read on private.staff_audit for select to scriblune_server using((select private.is_owner()));
create policy staff_audit_insert on private.staff_audit for insert to scriblune_server with check(actor_id=(select private.account_id()) and ((select private.is_owner()) or (select private.has_permission('testing.tools'))));
grant select,insert on private.staff_audit to scriblune_server;
create index staff_audit_time on private.staff_audit(created_at desc);

create table private.community_profiles (
 account_id uuid primary key references auth.users(id) on delete cascade,
 username text unique check(username ~ '^[a-z0-9_]{3,24}$'),
 avatar_path text,
 updated_at timestamptz not null default now()
);
create table private.forum_categories (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check(length(name) between 2 and 50),
 description text not null default '' check(length(description)<=300),
 position integer not null default 0,
 archived boolean not null default false
);
insert into private.forum_categories(name,description,position) values
 ('Study together','Questions, explanations, and ideas that help everyone learn.',0),
 ('Scriblune help','Get help using your study desk and share useful tips.',1),
 ('Ideas & feedback','Suggest improvements and discuss the Scriblune experience.',2),
 ('Off topic','A friendly place to meet the community.',3);
create table private.forum_bans (
 account_id uuid primary key references auth.users(id) on delete cascade,
 reason text not null check(length(reason) between 3 and 1000),
 expires_at timestamptz,
 moderator_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create function private.forum_can_post() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.community_profiles where account_id=(select private.account_id()) and username is not null)
 and not exists(select 1 from private.forum_bans where account_id=(select private.account_id()) and (expires_at is null or expires_at>now()))
$$;
revoke all on function private.forum_can_post() from public;
grant execute on function private.forum_can_post() to scriblune_server;
create table private.forum_threads (
 id uuid primary key default gen_random_uuid(),
 category_id uuid not null references private.forum_categories(id),
 author_id uuid references auth.users(id) on delete set null,
 title text not null check(length(title) between 5 and 160),
 pinned boolean not null default false,
 locked boolean not null default false,
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 bumped_at timestamptz not null default now()
);
create table private.forum_posts (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references private.forum_threads(id) on delete cascade,
 author_id uuid references auth.users(id) on delete set null,
 body text not null check(length(body) between 1 and 20000),
 is_root boolean not null default false,
 reply_to uuid,
 show_badge boolean not null default false,
 revision integer not null default 1,
 deleted_at timestamptz,
 edited_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,thread_id),
 foreign key(reply_to,thread_id) references private.forum_posts(id,thread_id)
);
create unique index forum_one_root on private.forum_posts(thread_id) where is_root;
create index forum_threads_activity on private.forum_threads(pinned desc,bumped_at desc) where deleted_at is null;
create index forum_threads_category on private.forum_threads(category_id,bumped_at desc);
create index forum_threads_author on private.forum_threads(author_id);
create index forum_posts_thread on private.forum_posts(thread_id,created_at);
create index forum_posts_author on private.forum_posts(author_id);
create index forum_posts_reply on private.forum_posts(reply_to,thread_id);
create index forum_threads_search on private.forum_threads using gin(to_tsvector('english',title));
create index forum_posts_search on private.forum_posts using gin(to_tsvector('english',body));
create table private.forum_attachments (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid references auth.users(id) on delete set null,
 post_id uuid references private.forum_posts(id) on delete cascade,
 path text not null unique,
 name text not null check(length(name)<=150),
 mime text not null check(mime in ('image/webp','application/pdf')),
 bytes integer not null check(bytes>0 and bytes<=10485760),
 created_at timestamptz not null default now()
);
create index forum_attachments_post on private.forum_attachments(post_id);
create index forum_attachments_owner on private.forum_attachments(owner_id,created_at);
create table private.forum_reactions (
 post_id uuid not null references private.forum_posts(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 primary key(post_id,account_id)
);
create table private.forum_bookmarks (
 thread_id uuid not null references private.forum_threads(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(thread_id,account_id)
);
create index forum_bookmarks_account on private.forum_bookmarks(account_id);
create table private.forum_reports (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references private.forum_posts(id) on delete cascade,
 reporter_id uuid references auth.users(id) on delete set null,
 reason text not null check(length(reason) between 3 and 1000),
 status text not null default 'open' check(status in ('open','resolved','dismissed')),
 resolution text not null default '' check(length(resolution)<=1000),
 resolved_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(post_id,reporter_id)
);
create index forum_reports_queue on private.forum_reports(status,created_at);
create table private.forum_audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid references auth.users(id) on delete set null,
 action text not null,
 target_id uuid,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index forum_audit_time on private.forum_audit(created_at desc);

-- All community tables live outside the Data API. Even the server is constrained
-- by RLS. Public HTTP responses use an explicit field allowlist, never select *.
do $$ declare t text; begin
 foreach t in array array['community_profiles','forum_categories','forum_bans','forum_threads','forum_posts','forum_attachments','forum_reactions','forum_bookmarks','forum_reports','forum_audit'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
grant select,insert,update on private.community_profiles to scriblune_server;
create policy profile_read on private.community_profiles for select to scriblune_server using(true);
create policy profile_insert on private.community_profiles for insert to scriblune_server with check(account_id=(select private.account_id()));
create policy profile_update on private.community_profiles for update to scriblune_server using(account_id=(select private.account_id())) with check(account_id=(select private.account_id()));
grant select,insert,update,delete on private.forum_categories,private.forum_bans to scriblune_server;
create policy categories_read on private.forum_categories for select to scriblune_server using(true);
create policy categories_mod on private.forum_categories for all to scriblune_server using((select private.has_permission('forum.moderate'))) with check((select private.has_permission('forum.moderate')));
create policy bans_read on private.forum_bans for select to scriblune_server using(true);
create policy bans_mod on private.forum_bans for all to scriblune_server using((select private.has_permission('forum.moderate'))) with check((select private.has_permission('forum.moderate')) and not exists(select 1 from private.site_owners where account_id=forum_bans.account_id));
grant select,insert,update on private.forum_threads,private.forum_posts,private.forum_attachments to scriblune_server;
create policy threads_read on private.forum_threads for select to scriblune_server using(deleted_at is null or author_id=(select private.account_id()) or (select private.has_permission('forum.moderate')));
create policy threads_insert on private.forum_threads for insert to scriblune_server with check(author_id=(select private.account_id()) and (select private.forum_can_post()) and not pinned and not locked and deleted_at is null);
create policy threads_update on private.forum_threads for update to scriblune_server using((select private.forum_can_post()) or (select private.has_permission('forum.moderate'))) with check((select private.forum_can_post()) or (select private.has_permission('forum.moderate')));
create policy posts_read on private.forum_posts for select to scriblune_server using(exists(select 1 from private.forum_threads t where t.id=thread_id));
create policy posts_insert on private.forum_posts for insert to scriblune_server with check(author_id=(select private.account_id()) and (select private.forum_can_post()) and exists(select 1 from private.forum_threads t where t.id=thread_id and t.deleted_at is null and (not t.locked or (select private.has_permission('forum.moderate')))));
create policy posts_update on private.forum_posts for update to scriblune_server using((author_id=(select private.account_id()) and (select private.forum_can_post()) and exists(select 1 from private.forum_threads t where t.id=thread_id and not t.locked and t.deleted_at is null)) or (select private.has_permission('forum.moderate'))) with check(author_id=(select private.account_id()) or (select private.has_permission('forum.moderate')));
create policy attachments_read on private.forum_attachments for select to scriblune_server using(owner_id=(select private.account_id()) or (select private.has_permission('forum.moderate')) or exists(select 1 from private.forum_posts p join private.forum_threads t on t.id=p.thread_id where p.id=post_id and p.deleted_at is null and t.deleted_at is null));
create policy attachments_insert on private.forum_attachments for insert to scriblune_server with check(owner_id=(select private.account_id()) and post_id is null and (select private.forum_can_post()));
create policy attachments_update on private.forum_attachments for update to scriblune_server using(owner_id=(select private.account_id()) and post_id is null and (select private.forum_can_post())) with check(owner_id=(select private.account_id()) and exists(select 1 from private.forum_posts p where p.id=post_id and p.author_id=(select private.account_id())));
grant delete on private.forum_attachments to scriblune_server;
create policy attachments_cleanup_read on private.forum_attachments for select to scriblune_server using((select private.account_id()) is null and post_id is null and created_at<now()-interval '1 day');
create policy attachments_cleanup_delete on private.forum_attachments for delete to scriblune_server using((select private.account_id()) is null and post_id is null and created_at<now()-interval '1 day');
grant select,insert,delete on private.forum_reactions,private.forum_bookmarks to scriblune_server;
create policy reactions_read on private.forum_reactions for select to scriblune_server using(exists(select 1 from private.forum_posts where id=post_id));
create policy reactions_insert on private.forum_reactions for insert to scriblune_server with check(account_id=(select private.account_id()) and (select private.forum_can_post()) and exists(select 1 from private.forum_posts where id=post_id and deleted_at is null));
create policy reactions_delete on private.forum_reactions for delete to scriblune_server using(account_id=(select private.account_id()));
create policy bookmarks_read on private.forum_bookmarks for select to scriblune_server using(account_id=(select private.account_id()));
create policy bookmarks_insert on private.forum_bookmarks for insert to scriblune_server with check(account_id=(select private.account_id()) and (select private.forum_can_post()) and exists(select 1 from private.forum_threads where id=thread_id));
create policy bookmarks_delete on private.forum_bookmarks for delete to scriblune_server using(account_id=(select private.account_id()));
grant select,insert,update on private.forum_reports to scriblune_server;
create policy reports_read on private.forum_reports for select to scriblune_server using((select private.has_permission('forum.moderate')) or reporter_id=(select private.account_id()));
create policy reports_insert on private.forum_reports for insert to scriblune_server with check(reporter_id=(select private.account_id()) and (select private.forum_can_post()) and status='open' and exists(select 1 from private.forum_posts where id=post_id));
create policy reports_update on private.forum_reports for update to scriblune_server using((select private.has_permission('forum.moderate'))) with check((select private.has_permission('forum.moderate')));
grant select,insert on private.forum_audit to scriblune_server;
create policy forum_audit_read on private.forum_audit for select to scriblune_server using((select private.has_permission('forum.moderate')));
create policy forum_audit_insert on private.forum_audit for insert to scriblune_server with check(actor_id=(select private.account_id()) and (select private.has_permission('forum.moderate')));

-- Identity columns cannot be reassigned, even by a moderator.
revoke update on private.forum_threads,private.forum_posts,private.forum_attachments,private.community_profiles from scriblune_server;
grant update(category_id,title,pinned,locked,deleted_at,updated_at,bumped_at) on private.forum_threads to scriblune_server;
grant update(body,show_badge,revision,deleted_at,edited_by,updated_at) on private.forum_posts to scriblune_server;
grant update(post_id) on private.forum_attachments to scriblune_server;
grant update(username,avatar_path,updated_at) on private.community_profiles to scriblune_server;

-- Replies may bump another member's thread without granting editorial access.
create function private.guard_forum_thread_update() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user <> 'scriblune_server' then return new; end if;
 if not private.has_permission('forum.moderate') then
  if old.locked or old.deleted_at is not null or new.locked<>old.locked or new.pinned<>old.pinned or new.category_id<>old.category_id then
   raise exception 'Moderator permission required' using errcode='42501';
  end if;
  if (new.title<>old.title or new.deleted_at is distinct from old.deleted_at) and old.author_id is distinct from private.account_id() then
   raise exception 'Author permission required' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_forum_thread_update() from public;
grant execute on function private.guard_forum_thread_update() to scriblune_server;
create trigger guard_forum_thread_update before update on private.forum_threads for each row execute function private.guard_forum_thread_update();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('scriblune-community','scriblune-community',false,10485760,array['image/webp','application/pdf']);
alter table public.tutoring_sessions add column is_test boolean not null default false;
alter table private.session_feedback add column is_test boolean not null default false;
create table private.test_completions (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null unique references public.tutoring_sessions(id) on delete cascade,
 account_id uuid not null references auth.users(id) on delete cascade,
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table private.test_completions enable row level security;
create policy test_read on private.test_completions for select to scriblune_server using(account_id=(select private.account_id()));
create policy test_insert on private.test_completions for insert to scriblune_server with check(account_id=(select private.account_id()) and (select private.has_permission('testing.tools')) and exists(select 1 from public.tutoring_sessions where id=session_id and account_id=(select private.account_id()) and is_test));
grant select,insert on private.test_completions to scriblune_server;
revoke all on private.site_owners,private.staff_roles,private.staff_assignments,private.staff_audit,private.test_completions from public,anon,authenticated,service_role;
