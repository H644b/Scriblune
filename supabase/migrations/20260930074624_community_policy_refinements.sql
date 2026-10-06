-- One SELECT policy per table avoids redundant RLS evaluation.
drop policy categories_mod on private.forum_categories;
drop policy bans_mod on private.forum_bans;
do $$ declare t text; begin
 foreach t in array array['forum_categories','forum_bans'] loop
  execute format('create policy moderator_insert on private.%I for insert to scriblune_server with check((select private.has_permission(''forum.moderate'')))',t);
  execute format('create policy moderator_update on private.%I for update to scriblune_server using((select private.has_permission(''forum.moderate''))) with check((select private.has_permission(''forum.moderate'')))',t);
  execute format('create policy moderator_delete on private.%I for delete to scriblune_server using((select private.has_permission(''forum.moderate'')))',t);
 end loop;
end $$;
-- Keep the protected-owner check on both insert and update.
alter policy moderator_insert on private.forum_bans with check((select private.has_permission('forum.moderate')) and not exists(select 1 from private.site_owners where account_id=forum_bans.account_id));
alter policy moderator_update on private.forum_bans with check((select private.has_permission('forum.moderate')) and not exists(select 1 from private.site_owners where account_id=forum_bans.account_id));
alter table private.forum_attachments add column deleted_at timestamptz;
drop policy attachments_read on private.forum_attachments;
drop policy attachments_cleanup_read on private.forum_attachments;
create policy attachments_read on private.forum_attachments for select to scriblune_server using(
 owner_id=(select private.account_id()) or (select private.has_permission('forum.moderate'))
 or ((select private.account_id()) is null and post_id is null and created_at<now()-interval '1 day')
 or (deleted_at is null and exists(select 1 from private.forum_posts p join private.forum_threads t on t.id=p.thread_id where p.id=post_id and p.deleted_at is null and t.deleted_at is null))
);
drop policy attachments_update on private.forum_attachments;
create policy attachments_update on private.forum_attachments for update to scriblune_server using(
 (owner_id=(select private.account_id()) and (select private.forum_can_post())) or (select private.has_permission('forum.moderate'))
) with check(
 (owner_id=(select private.account_id()) and (post_id is null or exists(select 1 from private.forum_posts p where p.id=post_id and p.author_id=(select private.account_id())))) or (select private.has_permission('forum.moderate'))
);
grant update(deleted_at) on private.forum_attachments to scriblune_server;
create function private.guard_forum_attachment_update() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'scriblune_server' then return new; end if;
 if new.post_id is distinct from old.post_id and (old.post_id is not null or old.owner_id is distinct from private.account_id() or old.created_at<now()-interval '1 day' or old.deleted_at is not null) then
  raise exception 'Attachment cannot be reassigned' using errcode='42501';
 end if;
 if old.deleted_at is not null and new.deleted_at is null and not private.has_permission('forum.moderate') then
  raise exception 'Moderator permission required to restore' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_forum_attachment_update() from public;
grant execute on function private.guard_forum_attachment_update() to scriblune_server;
create trigger guard_forum_attachment_update before update on private.forum_attachments for each row execute function private.guard_forum_attachment_update();
