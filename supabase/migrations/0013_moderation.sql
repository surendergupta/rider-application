-- Moderation: report queue, takedown, account restriction and an audit log (docs/08 sections 3 and 3b).
--
-- Principles:
--  * Moderators are a separate role: a row in public.moderators. Nobody can add themselves; rows are added with SQL
--    (see scripts/add-moderator.mjs). Browsers have no policy to read or write that table.
--  * Browsers cannot change a report's status or take content down directly. Every moderator action is a security
--    definer function that checks is_moderator(auth.uid()), changes the target, closes the related reports and writes
--    ONE audit event in the same transaction. An action without an audit event cannot happen.
--  * A moderator cannot act on a report about their own content, and cannot restrict another moderator.
--  * A restricted account cannot create posts, rides or clubs. This is enforced by database triggers, so it also covers
--    post_create() and any other writer.

create table public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.moderators enable row level security;     -- no policy: not readable or writable from browsers

create or replace function public.is_moderator(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and exists (select 1 from public.moderators where user_id = p_uid)
$fn$;

-- The only moderator check riders can call: it answers for the caller and cannot be used to look up anyone else.
create or replace function public.i_am_moderator() returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_moderator(auth.uid())
$fn$;

-- Reports get a reviewer and a review time -------------------------------------------------------------------------
alter table public.profile_reports add column reviewed_by uuid references auth.users(id) on delete set null, add column reviewed_at timestamptz;
alter table public.ride_reports    add column reviewed_by uuid references auth.users(id) on delete set null, add column reviewed_at timestamptz;
alter table public.club_reports    add column reviewed_by uuid references auth.users(id) on delete set null, add column reviewed_at timestamptz;
alter table public.post_reports    add column reviewed_by uuid references auth.users(id) on delete set null, add column reviewed_at timestamptz;

-- Account restrictions ----------------------------------------------------------------------------------------------
create table public.account_restrictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  restricted_until timestamptz,                                   -- null = until a moderator lifts it
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.account_restrictions enable row level security;
-- A rider can see their own restriction (so the app can say why); nothing else, and nobody can write.
create policy account_restrictions_select on public.account_restrictions for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_restricted(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and exists (
    select 1 from public.account_restrictions where user_id = p_uid and (restricted_until is null or restricted_until > now()))
$fn$;

create or replace function public.restriction_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if public.is_restricted((to_jsonb(new) ->> tg_argv[0])::uuid) then raise exception 'account_restricted' using errcode = 'P0001'; end if;
  return new;
end $fn$;
create trigger trg_posts_restriction before insert on public.posts for each row execute function public.restriction_guard('author_id');
create trigger trg_rides_restriction before insert on public.rides for each row execute function public.restriction_guard('host_id');
create trigger trg_clubs_restriction before insert on public.clubs for each row execute function public.restriction_guard('owner_id');

-- Audit log ---------------------------------------------------------------------------------------------------------
create table public.moderation_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('start_review','dismiss','remove','restrict','lift_restriction')),
  target_kind text check (target_kind in ('post','ride','club','profile','account')),
  target_id uuid,                                                  -- post / ride / club id, or the user id for profile and account
  report_id uuid,
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_moderation_audit_created on public.moderation_audit (created_at desc);
alter table public.moderation_audit enable row level security;
create policy moderation_audit_select on public.moderation_audit for select to authenticated
  using (public.i_am_moderator());
-- No insert, update or delete policy: only the functions below write, and nothing edits history.

-- Helpers -----------------------------------------------------------------------------------------------------------
create or replace function public.mod_require() returns uuid
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not public.is_moderator(auth.uid()) then raise exception 'not_moderator' using errcode = '42501'; end if;
  return auth.uid();
end $fn$;

-- The account that owns the reported thing.
create or replace function public.mod_target_owner(p_kind text, p_target uuid) returns uuid
language sql stable security definer set search_path = public as $fn$
  select case p_kind
    when 'post'    then (select author_id from public.posts where id = p_target)
    when 'ride'    then (select host_id from public.rides where id = p_target)
    when 'club'    then (select owner_id from public.clubs where id = p_target)
    when 'profile' then (select user_id from public.rider_profiles where user_id = p_target)
  end
$fn$;

-- The report queue --------------------------------------------------------------------------------------------------
-- p_scope: 'open' (open + under review, oldest first) or 'closed' (actioned + dismissed, newest first).
-- Several reports about the same thing are shown as one row with a count.
create or replace function public.mod_queue(p_scope text default 'open', p_limit integer default 50)
returns table (kind text, target_id uuid, report_id uuid, report_count integer, reasons text[], note text, status text,
               first_reported_at timestamptz, summary text, target_state text, owner_id uuid, owner_restricted boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  perform public.mod_require();
  if p_scope not in ('open','closed') then raise exception 'bad_scope' using errcode = 'P0001'; end if;
  return query
  with r as (
    select 'post'::text k, post_id t, id, reason, note n, status s, created_at c from public.post_reports
    union all select 'ride', ride_id, id, reason, note, status, created_at from public.ride_reports
    union all select 'club', club_id, id, reason, note, status, created_at from public.club_reports
    union all select 'profile', profile_user_id, id, reason, note, status, created_at from public.profile_reports
  ), f as (
    select * from r where (p_scope = 'open' and s in ('open','under_review')) or (p_scope = 'closed' and s in ('actioned','dismissed'))
  ), g as (
    select k, t,
           (array_agg(id order by c))[1] rid,
           count(*)::int cnt,
           array_agg(distinct reason order by reason) rs,
           (array_agg(n order by c) filter (where n is not null))[1] nt,
           case when bool_or(s = 'under_review') then 'under_review' else min(s) end st,
           min(c) first_c
    from f group by k, t
  )
  select g.k, g.t, g.rid, g.cnt, g.rs, g.nt, g.st, g.first_c,
         case g.k
           when 'post'    then (select coalesce(nullif(left(p.body, 200), ''), p.trip_title) from public.posts p where p.id = g.t)
           when 'ride'    then (select x.title from public.rides x where x.id = g.t)
           when 'club'    then (select x.name from public.clubs x where x.id = g.t)
           when 'profile' then (select x.display_name || ' (@' || x.handle || ')' from public.rider_profiles x where x.user_id = g.t)
         end,
         case g.k
           when 'post'    then (select p.status from public.posts p where p.id = g.t)
           when 'ride'    then (select x.status from public.rides x where x.id = g.t)
           when 'club'    then (select x.status from public.clubs x where x.id = g.t)
           when 'profile' then (select case when x.is_public then 'public' else 'private' end from public.rider_profiles x where x.user_id = g.t)
         end,
         public.mod_target_owner(g.k, g.t),
         public.is_restricted(public.mod_target_owner(g.k, g.t))
  from g
  order by case when p_scope = 'open' then extract(epoch from g.first_c) else -extract(epoch from g.first_c) end
  limit v_limit;
end $fn$;

-- Acting on a report ------------------------------------------------------------------------------------------------
-- p_action: start_review | dismiss | remove | restrict.
--   remove   takes the content down (post removed, ride cancelled, club archived, profile made private).
--   restrict does everything remove does AND restricts the owner's account for p_days days (null = until lifted).
-- Every open or under-review report about the same target is closed together, so duplicates leave the queue.
create or replace function public.mod_act(p_kind text, p_report uuid, p_action text, p_reason text, p_days integer default null) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_mod uuid := public.mod_require();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_target uuid; v_owner uuid; v_status text; v_until timestamptz; v_closed integer;
begin
  if p_kind not in ('post','ride','club','profile') then raise exception 'bad_kind' using errcode = 'P0001'; end if;
  if p_action not in ('start_review','dismiss','remove','restrict') then raise exception 'bad_action' using errcode = 'P0001'; end if;
  if p_action <> 'start_review' and (v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300) then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if p_action = 'restrict' and p_days is not null and (p_days < 1 or p_days > 365) then raise exception 'bad_days' using errcode = 'P0001'; end if;

  execute format('select %s, status from public.%I where id = $1 for update',
    case p_kind when 'post' then 'post_id' when 'ride' then 'ride_id' when 'club' then 'club_id' else 'profile_user_id' end,
    p_kind || '_reports') into v_target, v_status using p_report;
  if v_target is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_status in ('actioned','dismissed') then raise exception 'already_closed' using errcode = 'P0001'; end if;

  v_owner := public.mod_target_owner(p_kind, v_target);
  if v_owner = v_mod then raise exception 'self_target' using errcode = 'P0001'; end if;
  if p_action = 'restrict' and (v_owner is null or public.is_moderator(v_owner)) then raise exception 'cannot_restrict' using errcode = 'P0001'; end if;

  if p_action in ('remove','restrict') then
    if p_kind = 'post' then update public.posts set status = 'removed' where id = v_target;
    elsif p_kind = 'ride' then update public.rides set status = 'cancelled' where id = v_target;
    elsif p_kind = 'club' then update public.clubs set status = 'archived' where id = v_target;
    else update public.rider_profiles set is_public = false where user_id = v_target;
    end if;
  end if;

  if p_action = 'restrict' then
    v_until := case when p_days is null then null else now() + make_interval(days => p_days) end;
    insert into public.account_restrictions (user_id, reason, restricted_until, created_by) values (v_owner, v_reason, v_until, v_mod)
    on conflict (user_id) do update set reason = excluded.reason, restricted_until = excluded.restricted_until, created_by = excluded.created_by, created_at = now();
  end if;

  -- Close every open report about this target (start_review moves them to under_review instead).
  execute format('update public.%I set status = $1, reviewed_by = $2, reviewed_at = now() where %s = $3 and status in (''open'',''under_review'')',
    p_kind || '_reports',
    case p_kind when 'post' then 'post_id' when 'ride' then 'ride_id' when 'club' then 'club_id' else 'profile_user_id' end)
    using case p_action when 'start_review' then 'under_review' when 'dismiss' then 'dismissed' else 'actioned' end, v_mod, v_target;
  get diagnostics v_closed = row_count;

  insert into public.moderation_audit (actor_id, action, target_kind, target_id, report_id, reason, detail)
  values (v_mod, p_action, p_kind, v_target, p_report, v_reason,
          jsonb_build_object('reports', v_closed, 'owner_id', v_owner, 'days', p_days));
  return case p_action when 'start_review' then 'under_review' when 'dismiss' then 'dismissed' else 'actioned' end;
end $fn$;

-- Lifting a restriction ---------------------------------------------------------------------------------------------
create or replace function public.mod_lift_restriction(p_user uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_mod uuid := public.mod_require(); v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  delete from public.account_restrictions where user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.moderation_audit (actor_id, action, target_kind, target_id, reason) values (v_mod, 'lift_restriction', 'account', p_user, v_reason);
  return 'lifted';
end $fn$;

-- Current restrictions, for the moderator screen.
create or replace function public.mod_restrictions() returns table (user_id uuid, reason text, restricted_until timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.mod_require();
  return query select r.user_id, r.reason, r.restricted_until, r.created_at from public.account_restrictions r
    where r.restricted_until is null or r.restricted_until > now() order by r.created_at desc limit 100;
end $fn$;

-- Grants ------------------------------------------------------------------------------------------------------------
-- Internal helpers take any user id, so riders must not be able to call them (they would reveal moderators or restrictions).
-- They still run when the moderator functions and triggers call them, because those are security definer.
revoke all on function public.is_moderator(uuid), public.is_restricted(uuid), public.mod_require(),
  public.mod_target_owner(text,uuid), public.restriction_guard() from public, anon, authenticated;
grant execute on function public.is_moderator(uuid), public.is_restricted(uuid), public.mod_target_owner(text,uuid) to service_role;

do $grants$
declare f text;
begin
  foreach f in array array[
    'i_am_moderator()', 'mod_queue(text,integer)', 'mod_act(text,uuid,text,text,integer)',
    'mod_lift_restriction(uuid,text)', 'mod_restrictions()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $grants$;
