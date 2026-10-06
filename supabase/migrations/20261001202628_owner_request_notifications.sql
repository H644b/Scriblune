-- Durable metadata-only mail notices; no public RPC, trigger, or new credential.
create table private.owner_request_notifications (
 message_id uuid primary key references private.owner_request_messages(id) on delete restrict,
 thread_id uuid not null references private.owner_requests(id) on delete restrict,
 account_id uuid not null references auth.users(id) on delete restrict,
 message_seq bigint not null check(message_seq>0),
 recipient text not null check(length(recipient) between 3 and 320),
 sender text not null check(length(sender) between 3 and 320),
 site_origin text not null check(length(site_origin) between 1 and 300),
 status text not null default 'pending' check(status in ('pending','sending','sent','blocked')),
 attempts integer not null default 0 check(attempts between 0 and 6),
 available_at timestamptz not null default now(),
 first_attempt_at timestamptz,
 locked_until timestamptz,
 lease_token uuid,
 sent_at timestamptz,
 provider_id text,
 last_error_code text check(length(last_error_code)<=80),
 created_at timestamptz not null default now()
);
create index owner_notifications_due on private.owner_request_notifications(available_at,created_at) where status in ('pending','sending');
create index owner_notifications_account on private.owner_request_notifications(account_id);
create index owner_notifications_thread on private.owner_request_notifications(thread_id);
alter table private.owner_request_notifications enable row level security;
revoke all on private.owner_request_notifications from public,anon,authenticated,service_role;
grant select on private.owner_request_notifications to scriblune_server;
grant insert(message_id,thread_id,account_id,message_seq,recipient,sender,site_origin) on private.owner_request_notifications to scriblune_server;
grant update(status,attempts,available_at,first_attempt_at,locked_until,lease_token,sent_at,provider_id,last_error_code) on private.owner_request_notifications to scriblune_server;
-- The trusted background worker uses no account context. Ordinary account
-- transactions cannot read another account's notices or change delivery state.
create policy owner_notifications_read on private.owner_request_notifications for select to scriblune_server
 using((select private.account_id()) is null or ((select private.is_owner()) and account_id=(select private.account_id())));
create policy owner_notifications_enqueue on private.owner_request_notifications for insert to scriblune_server
 with check((select private.is_owner()) and account_id=(select private.account_id()) and exists(
  select 1 from private.owner_request_messages m
  where m.id=owner_request_notifications.message_id and m.thread_id=owner_request_notifications.thread_id
   and m.seq=owner_request_notifications.message_seq and m.author_kind='owner'
   and m.author_account_id=owner_request_notifications.account_id));
create policy owner_notifications_delivery on private.owner_request_notifications for update to scriblune_server
 using((select private.account_id()) is null) with check((select private.account_id()) is null);
