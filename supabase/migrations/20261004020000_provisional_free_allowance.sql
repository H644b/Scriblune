-- Proposed local-only release. No existing matches are backfilled or relabeled.
-- The existing app role and table/RLS grants remain unchanged. New helpers are
-- internal only. Creation needs the transaction flag set by the reviewed app;
-- migration alone leaves the current high-confidence behavior unchanged.
alter table private.free_guard_pairs drop constraint free_guard_pairs_state_check;
alter table private.free_guard_pairs add constraint free_guard_pairs_state_check
 check(state in ('candidate','provisional','confirmed','dismissed'));
alter table private.access_actions drop constraint access_actions_kind_check;
alter table private.access_actions add constraint access_actions_kind_check
 check(kind in ('signup_mode','waitlist_approve','waitlist_reject','password_recovery','revoke_sessions','reset_totp','reset_passkeys','reset_factors','request_deletion','free_auto','free_provisional','free_confirm','free_dismiss','free_separate'));


create or replace function private.free_guard_members(p_account uuid) returns table(account_id uuid)
language sql stable security definer set search_path='' as $$
 with recursive members(id) as (
 select p_account union
 select case when p.account_a=m.id then p.account_b else p.account_a end
 from members m join private.free_guard_pairs p on (p.account_a=m.id or p.account_b=m.id) and p.state in ('confirmed','provisional')
 ) select id from members
$$;

-- Uncertain association: one repeated browser continuity, not IP/family alone.
-- Only 7-day unexpired evidence; both accounts must switch on that continuity
-- across 2 UTC days, >=12 hours, with daily network support on both days.
create function private.free_guard_provisional_evidence(p_a uuid,p_b uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with recent as (
  select *,lag(account_id) over(partition by device_hash order by created_at,session_hash) as previous_account
  from private.free_guard_observations
  where account_id in(p_a,p_b) and expires_at>now() and created_at>now()-interval '7 days'
 ), supported_days as (
  select x.device_hash,count(distinct (x.created_at at time zone 'UTC')::date) as days
  from recent x join recent y on x.device_hash=y.device_hash
   and x.account_id=p_a and y.account_id=p_b
   and x.network_hash is not null and x.network_hash=y.network_hash
   and (x.created_at at time zone 'UTC')::date=(y.created_at at time zone 'UTC')::date
  group by x.device_hash
 ), continuity as (
  select device_hash,min(browser) as family,count(distinct browser) as families,
   count(distinct session_hash) filter(where account_id=p_a) as a_sessions,
   count(distinct session_hash) filter(where account_id=p_b) as b_sessions,
   count(distinct (created_at at time zone 'UTC')::date) filter(where account_id=p_a) as a_days,
   count(distinct (created_at at time zone 'UTC')::date) filter(where account_id=p_b) as b_days,
   max(created_at) filter(where account_id=p_a)-min(created_at) filter(where account_id=p_a) as a_span,
   max(created_at) filter(where account_id=p_b)-min(created_at) filter(where account_id=p_b) as b_span,
   count(*) filter(where previous_account is not null and previous_account<>account_id) as switches
  from recent group by device_hash
 ), qualified as (
  select c.*,d.days as network_days from continuity c join supported_days d using(device_hash)
  where c.families=1 and c.family in('chromium','firefox','safari')
   and c.a_sessions>=2 and c.b_sessions>=2 and c.a_days>=2 and c.b_days>=2
   and c.a_span>=interval '12 hours' and c.b_span>=interval '12 hours'
   and c.switches>=3 and d.days>=2
   and not exists(select 1 from private.free_guard_observations o
    where o.device_hash=c.device_hash and o.expires_at>now() and o.account_id not in(p_a,p_b))
 ) select jsonb_build_object('eligible',count(*)>=1,'qualifying_continuities',count(*),
  'verified_signins_per_account',coalesce(min(least(a_sessions,b_sessions)),0),
  'days_per_account',coalesce(min(least(a_days,b_days)),0),
  'span_hours_per_account',coalesce(min(extract(epoch from least(a_span,b_span))/3600),0),
  'switches',coalesce(min(switches),0),'network_days',coalesce(min(network_days),0),
  'rule','browser_switch_provisional_v1') from qualified
$$;
revoke all on function private.free_guard_provisional_evidence(uuid,uuid) from public,anon,authenticated,service_role,scriblune_server;


create function private.free_guard_provisional_eligible(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select count(*) from auth.users where id in(p_a,p_b) and email_confirmed_at is not null and created_at<=now()-interval '24 hours')=2
 and not exists(select 1 from private.site_owners where account_id in(p_a,p_b))
 and not exists(select 1 from private.staff_assignments where account_id in(p_a,p_b))
 and not exists(select 1 from private.account_access_holds where account_id in(p_a,p_b))
 and not exists(select 1 from private.billing_grants where account_id in(p_a,p_b) and (expires_at is null or expires_at>now()))
 and not exists(select 1 from private.billing_accounts where account_id in(p_a,p_b) and subscription_status='active' and paid_until>now())
 and (select count(*) from private.free_guard_members(p_a))=1 and (select count(*) from private.free_guard_members(p_b))=1
 and coalesce((private.free_guard_provisional_evidence(p_a,p_b)->>'eligible')::boolean,false)
$$;
revoke all on function private.free_guard_provisional_eligible(uuid,uuid) from public,anon,authenticated,service_role,scriblune_server;

create function private.free_guard_try_provisional(p_account uuid) returns void
language plpgsql security definer set search_path='' as $$
 declare candidate_ids uuid[]; edge private.free_guard_pairs; other uuid; alternatives integer; decision_id uuid; result jsonb;
 begin
 perform private.free_guard_lock();
 -- Do not choose an arbitrary target from a crowded/ambiguous candidate set.
 if (select count(*) from private.free_guard_pairs where state='candidate' and (account_a=p_account or account_b=p_account))>25 then return; end if;
 select array_agg(id) into candidate_ids from (
 select id from private.free_guard_pairs where state='candidate' and (account_a=p_account or account_b=p_account)
 and private.free_guard_provisional_eligible(account_a,account_b) limit 2) q;
 if coalesce(array_length(candidate_ids,1),0)<>1 then return; end if;
 select * into edge from private.free_guard_pairs where id=candidate_ids[1] for update;
 other:=case when edge.account_a=p_account then edge.account_b else edge.account_a end;
 if (select count(*) from private.free_guard_pairs where state='candidate' and (account_a=other or account_b=other))>25 then return; end if;
 select count(*) into alternatives from (select id from private.free_guard_pairs where state='candidate' and (account_a=other or account_b=other) and private.free_guard_provisional_eligible(account_a,account_b) limit 2) q;
 if alternatives<>1 then return; end if;
 decision_id:=gen_random_uuid();
 result:=jsonb_build_object('status','provisionally_restricted','pair_id',edge.id,'affected_accounts',jsonb_build_array(edge.account_a,edge.account_b),'evidence',private.free_guard_provisional_evidence(edge.account_a,edge.account_b));
 update private.free_guard_pairs set state='provisional',decision_source='automatic',revision=revision+1 where id=edge.id;
 insert into private.access_actions(id,actor_id,target_id,kind,intent_hash,reason,result)
 values(decision_id,null,p_account,'free_provisional',encode(sha256(convert_to(result::text,'UTF8')),'hex'),'Provisional browser_switch_provisional_v1 heuristic; uncertain unique pair, pending Admin review; may be different people.',result);
 end
$$;
revoke all on function private.free_guard_try_provisional(uuid) from public,anon,authenticated,service_role,scriblune_server;

create or replace function private.free_guard_observe(p_device text,p_session uuid,p_session_hash text,p_browser text,p_network text,p_expires timestamptz,p_auto boolean default false)
returns void language plpgsql security definer set search_path='' as $$
 declare actor uuid:=private.account_id(); inserted integer;
 begin
 if actor is null or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=actor and u.email_confirmed_at is not null and s.id=p_session and (s.not_after is null or s.not_after>now()))
 or exists(select 1 from private.account_access_holds where account_id=actor) then raise exception using errcode='42501',message='Live verified sign-in required'; end if;
 perform private.free_guard_lock();
 if exists(select 1 from private.site_owners where account_id=actor) or exists(select 1 from private.staff_assignments where account_id=actor) then return; end if;
 if p_expires<=now() or p_expires>now()+interval '30 days' then raise exception using errcode='22023',message='Invalid continuity expiry'; end if;
 -- Bound shared-device noise, row growth, and accidental/hostile associations.
 if (select count(distinct account_id) from private.free_guard_observations where device_hash=p_device and expires_at>now())>=8 and not exists(select 1 from private.free_guard_observations where device_hash=p_device and account_id=actor and expires_at>now()) then return; end if;
 if (select count(*) from private.free_guard_observations where account_id=actor and created_at>now()-interval '1 day')>=20 then return; end if;
 insert into private.free_guard_observations(device_hash,account_id,session_hash,browser,network_hash,expires_at)
 values(p_device,actor,p_session_hash,p_browser,p_network,p_expires) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then
 if p_auto then perform private.free_guard_try_auto(actor); if current_setting('app.free_guard_provisional',true)='enforce' then perform private.free_guard_try_provisional(actor); end if; end if;
 return; end if;
 insert into private.free_guard_pairs(account_a,account_b)
 select distinct least(actor,o.account_id),greatest(actor,o.account_id) from private.free_guard_observations o
 where o.device_hash=p_device and o.account_id<>actor and o.expires_at>now()
 and not exists(select 1 from private.site_owners where account_id=o.account_id)
 and not exists(select 1 from private.staff_assignments where account_id=o.account_id)
 on conflict(account_a,account_b) do update set last_seen=now() where free_guard_pairs.state='candidate';
 if p_auto then perform private.free_guard_try_auto(actor); if current_setting('app.free_guard_provisional',true)='enforce' then perform private.free_guard_try_provisional(actor); end if; end if;
 end
$$;

create or replace function private.free_guard_usage() returns jsonb language plpgsql security definer set search_path='' as $$
 declare actor uuid:=private.account_id(); result jsonb;
 begin
 perform private.free_guard_lock();
 select jsonb_build_object('shared',(select count(*)>1 from private.free_guard_members(actor)),
 'provisional',exists(select 1 from private.free_guard_pairs p where p.state='provisional' and p.account_a in(select account_id from private.free_guard_members(actor))),
 'prompts',count(*) filter(where l.kind='prompt'),'sessions',count(*) filter(where l.kind='session')) into result
 from private.usage_ledger l join private.free_guard_members(actor) m using(account_id)
 where l.day=(now() at time zone 'UTC')::date and l.free_eligible and not l.refunded;
 return result;
 end
$$;

create or replace function private.free_guard_status(p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
 declare actor uuid:=private.account_id();
 begin
 if actor is null then raise exception using errcode='42501',message='Sign-in required'; end if;
 if p_reason is not null then
 if (select count(*) from private.free_guard_members(actor))<2 then raise exception using errcode='22023',message='No shared allowance is assigned'; end if;
 if length(trim(p_reason)) not between 8 and 1000 then raise exception using errcode='22023',message='Explain the correction request'; end if;
 insert into private.free_guard_appeals(account_id,reason) values(actor,trim(p_reason)) on conflict(account_id) do update set reason=excluded.reason,status='open',created_at=now(),resolved_at=null where free_guard_appeals.status='resolved' and free_guard_appeals.resolved_at<now()-interval '1 day';
 end if;
 return jsonb_build_object('shared',(select count(*)>1 from private.free_guard_members(actor)), 'basis',case when exists(select 1 from private.free_guard_pairs p where p.state='provisional' and p.account_a in(select account_id from private.free_guard_members(actor))) then 'provisional' when exists(select 1 from private.free_guard_pairs where state='confirmed' and decision_source='automatic' and (account_a=actor or account_b=actor)) then 'automatic' else 'reviewed' end, 'appeal',(select jsonb_build_object('status',status,'created_at',created_at) from private.free_guard_appeals where account_id=actor));
 end
$$;

create or replace function private.free_guard_directory(p_account uuid) returns jsonb language plpgsql security definer set search_path='' as $$
 declare result jsonb;
 begin
 if not private.is_account_admin() then raise exception using errcode='42501',message='Administrator access required'; end if;
 select coalesce(jsonb_agg(q.data),'[]'::jsonb) into result from (
 select jsonb_build_object('id',p.id,'state',p.state,'revision',p.revision,'account_a',p.account_a,'account_b',p.account_b,
 'decision_source',p.decision_source,'automatic_evidence',private.free_guard_high_confidence(p.account_a,p.account_b),'provisional_evidence',private.free_guard_provisional_evidence(p.account_a,p.account_b),'email_a',a.email,'email_b',b.email,'first_seen',p.first_seen,'last_seen',p.last_seen,
 'evidence',(select jsonb_build_object('devices',count(distinct x.device_hash),'sessions_a',count(distinct x.session_hash),'sessions_b',count(distinct y.session_hash),'days',count(distinct (x.created_at at time zone 'UTC')::date),'browser_match',coalesce(bool_or(x.browser=y.browser and x.browser<>'other'),false),'network_match',coalesce(bool_or(x.network_hash=y.network_hash and x.network_hash is not null and x.created_at>now()-interval '7 days' and y.created_at>now()-interval '7 days'),false)) from private.free_guard_observations x join private.free_guard_observations y on x.device_hash=y.device_hash where x.account_id=p.account_a and y.account_id=p.account_b and x.expires_at>now() and y.expires_at>now()),
 'members',(select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email) order by u.id) from auth.users u where u.id in(select account_id from private.free_guard_members(p.account_a) union select account_id from private.free_guard_members(p.account_b))),
 'appeals',(select coalesce(jsonb_agg(jsonb_build_object('account_id',r.account_id,'reason',r.reason,'created_at',r.created_at)),'[]'::jsonb) from private.free_guard_appeals r where r.status='open' and r.account_id in(select account_id from private.free_guard_members(p.account_a) union select account_id from private.free_guard_members(p.account_b)))) as data
 from private.free_guard_pairs p join auth.users a on a.id=p.account_a join auth.users b on b.id=p.account_b
 where (p.account_a=p_account or p.account_b=p_account) and (p.state<>'candidate' or p.last_seen>now()-interval '30 days')
 order by p.last_seen desc,p.id limit 25
 ) q;
 return result;
 end
$$;

create or replace function private.free_guard_review(p_id uuid,p_pair uuid,p_target uuid,p_revision integer,p_members uuid[],p_kind text,p_reason text,p_email text,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
 declare actor uuid:=private.account_id(); edge private.free_guard_pairs; members uuid[]; old_members uuid[]; previous private.access_actions; result jsonb;
 begin
 if actor is null or not private.is_account_admin() then raise exception using errcode='42501',message='Administrator access required'; end if;
 perform private.free_guard_lock();
 select * into previous from private.access_actions where id=p_id;
 if found then
 if previous.actor_id<>actor or previous.intent_hash<>p_hash then raise exception using errcode='23505',message='Action ID conflict'; end if;
 return previous.result||'{"duplicate":true}'::jsonb;
 end if;
 select * into edge from private.free_guard_pairs where id=p_pair for update;
 if not found or edge.revision<>p_revision or p_target not in(edge.account_a,edge.account_b) or p_kind not in('free_confirm','free_dismiss','free_separate') or length(trim(p_reason)) not between 8 and 500 then raise exception using errcode='22023',message='Refresh this association'; end if;
 select array_agg(id order by id) into members from(select account_id id from private.free_guard_members(edge.account_a) union select account_id from private.free_guard_members(edge.account_b)) q;
 if members is distinct from p_members or array_length(members,1)>8 then raise exception using errcode='22023',message='Association membership changed'; end if;
 if actor=any(members) or exists(select 1 from private.site_owners where account_id=any(members)) or (not private.is_owner() and exists(select 1 from private.staff_assignments where account_id=any(members) and role_key='admin')) then raise exception using errcode='42501',message='Protected account'; end if;
 if not exists(select 1 from auth.users where id=p_target and lower(email)=p_email and email_confirmed_at is not null) then raise exception using errcode='22023',message='Verify the target email'; end if;
 if p_kind='free_confirm' then
 if edge.state not in ('candidate','provisional','confirmed') or exists(select 1 from private.free_guard_pairs where state='dismissed' and account_a=any(members) and account_b=any(members)) then raise exception using errcode='22023',message='A correction prevents this association'; end if;
 update private.free_guard_pairs set state='confirmed',decision_source='staff',revision=revision+1 where id=p_pair;
 elsif p_kind='free_dismiss' then
 if edge.state<>'candidate' then raise exception using errcode='22023',message='Only candidates may be dismissed'; end if;
 update private.free_guard_pairs set state='dismissed',decision_source='staff',revision=revision+1 where id=p_pair;
 else
 select array_agg(account_id) into old_members from private.free_guard_members(p_target);
 if array_length(old_members,1)<2 then raise exception using errcode='22023',message='Account is already separate'; end if;
 -- Preserve corrections against indirect future merges, not just the selected edge.
 insert into private.free_guard_pairs(account_a,account_b,state,decision_source,revision)
 select least(p_target,m),greatest(p_target,m),'dismissed','staff',1 from unnest(old_members) m where m<>p_target
 on conflict(account_a,account_b) do update set state='dismissed',decision_source='staff',revision=free_guard_pairs.revision+1;
 end if;
 update private.free_guard_appeals set status='resolved',resolved_at=now() where account_id=p_target and status='open';
 result=jsonb_build_object('status',case p_kind when 'free_confirm' then 'confirmed' when 'free_dismiss' then 'dismissed' else 'separated' end,'pair_id',p_pair,'affected_accounts',members);
 insert into private.access_actions(id,actor_id,target_id,kind,intent_hash,reason,result) values(p_id,actor,p_target,p_kind,p_hash,p_reason,result);
 return result;
 end
$$;

create or replace function private.free_guard_account_flags(p_accounts uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
 begin
 if not private.is_account_admin() then raise exception using errcode='42501',message='Administrator access required'; end if;
 if coalesce(array_length(p_accounts,1),0)>25 then raise exception using errcode='22023',message='Too many accounts'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'candidates',(select count(*) from private.free_guard_pairs p where (p.account_a=a.id or p.account_b=a.id) and p.state='candidate' and p.last_seen>now()-interval '30 days'), 'shared',(select count(*)>1 from private.free_guard_members(a.id)), 'provisional',exists(select 1 from private.free_guard_pairs p where p.state='provisional' and p.account_a in(select account_id from private.free_guard_members(a.id))), 'appeal',exists(select 1 from private.free_guard_appeals where account_id=a.id and status='open'))),'[]'::jsonb) from unnest(p_accounts) a(id));
 end
$$;
