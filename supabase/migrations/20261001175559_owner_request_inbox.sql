-- An append-only owner/Codex conversation. No new login, secret, public RPC,
-- SECURITY DEFINER function, or executable job is introduced.
create table private.owner_requests (
 id uuid primary key,
 created_by uuid not null references auth.users(id) on delete restrict,
 title text not null check(length(btrim(title)) between 1 and 160),
 status text not null default 'open' check(status in ('open','in_progress','needs_owner','done')),
 reviewed_through bigint not null default 0 check(reviewed_through >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index owner_requests_created on private.owner_requests(created_at desc,id desc);
create index owner_requests_creator on private.owner_requests(created_by);
create table private.owner_request_messages (
 id uuid primary key,
 seq bigint generated always as identity unique,
 thread_id uuid not null references private.owner_requests(id) on delete restrict,
 author_kind text not null check(author_kind in ('owner','codex')),
 author_account_id uuid references auth.users(id) on delete restrict,
 body text not null check(length(btrim(body)) between 1 and 10000),
 acknowledged_through bigint,
 status_after text not null check(status_after in ('open','in_progress','needs_owner','done')),
 created_at timestamptz not null default now(),
 check((author_kind='owner' and author_account_id is not null and acknowledged_through is null) or (author_kind='codex' and author_account_id is null and acknowledged_through is not null and acknowledged_through>0))
);
create index owner_messages_thread_seq on private.owner_request_messages(thread_id,seq);
create index owner_messages_author on private.owner_request_messages(author_account_id) where author_account_id is not null;
create table private.owner_request_reads (
 thread_id uuid not null references private.owner_requests(id) on delete restrict,
 account_id uuid not null references auth.users(id) on delete restrict,
 last_read_seq bigint not null default 0 check(last_read_seq >= 0),
 primary key(thread_id,account_id)
);
create index owner_reads_account on private.owner_request_reads(account_id);
alter table private.owner_requests enable row level security;
alter table private.owner_request_messages enable row level security;
alter table private.owner_request_reads enable row level security;
revoke all on private.owner_requests,private.owner_request_messages,private.owner_request_reads from public,anon,authenticated,service_role;
revoke all on sequence private.owner_request_messages_seq_seq from public,anon,authenticated,service_role;
grant select on private.owner_requests,private.owner_request_messages,private.owner_request_reads to scriblune_server;
grant insert(id,created_by,title) on private.owner_requests to scriblune_server;
grant update(status,updated_at) on private.owner_requests to scriblune_server;
grant insert(id,thread_id,author_kind,author_account_id,body,status_after) on private.owner_request_messages to scriblune_server;
grant insert,update(last_read_seq) on private.owner_request_reads to scriblune_server;
grant usage on sequence private.owner_request_messages_seq_seq to scriblune_server;
create policy owner_requests_read on private.owner_requests for select to scriblune_server using((select private.is_owner()));
create policy owner_requests_create on private.owner_requests for insert to scriblune_server with check((select private.is_owner()) and created_by=(select private.account_id()) and status='open' and reviewed_through=0);
create policy owner_requests_update on private.owner_requests for update to scriblune_server using((select private.is_owner())) with check((select private.is_owner()));
create policy owner_messages_read on private.owner_request_messages for select to scriblune_server using((select private.is_owner()));
create policy owner_messages_create on private.owner_request_messages for insert to scriblune_server with check((select private.is_owner()) and author_kind='owner' and author_account_id=(select private.account_id()));
create policy owner_reads_read on private.owner_request_reads for select to scriblune_server using((select private.is_owner()) and account_id=(select private.account_id()));
create policy owner_reads_create on private.owner_request_reads for insert to scriblune_server with check((select private.is_owner()) and account_id=(select private.account_id()));
create policy owner_reads_update on private.owner_request_reads for update to scriblune_server using((select private.is_owner()) and account_id=(select private.account_id())) with check((select private.is_owner()) and account_id=(select private.account_id()));
