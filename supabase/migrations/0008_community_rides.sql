-- Community Phase 1: rider discovery, group rides, invitations and participation.
--
-- Privacy and safety rules enforced HERE (not only in the interface):
--  * A rider appears in discovery only if they opted in (discoverable), which requires a public profile.
--  * A ride shows only a city/area publicly. The exact meeting point is visible to confirmed riders only.
--  * Participation changes go through functions that check capacity, approval, blocks and dates atomically.
--    Browsers cannot write participant rows directly.
--  * Blocked riders (either direction) cannot see each other's rides or join them.

-- 1. Discovery opt-in --------------------------------------------------------------------------
alter table public.rider_profiles add column discoverable boolean not null default false;
alter table public.rider_profiles add constraint rider_profiles_discoverable_needs_public
  check (not discoverable or is_public);

create or replace function public.clear_discoverable_when_private() returns trigger
language plpgsql as $fn$
begin
  if not new.is_public then new.discoverable := false; end if;
  return new;
end $fn$;
create trigger trg_rider_profiles_discoverable before insert or update on public.rider_profiles
  for each row execute function public.clear_discoverable_when_private();

-- 2. Tables ------------------------------------------------------------------------------------
create table public.rides (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 100),
  description text check (char_length(description) <= 1000),
  area_label text not null check (char_length(btrim(area_label)) between 2 and 100),     -- city or area only: public
  destination_label text check (char_length(destination_label) <= 100),
  starts_on date not null,
  start_time time,
  ends_on date,
  visibility text not null default 'public' check (visibility in ('public','invite_only')),
  requires_approval boolean not null default true,
  max_riders integer not null default 10 check (max_riders between 2 and 100),
  distance_km numeric(7,1) check (distance_km > 0 and distance_km <= 5000),
  status text not null default 'open' check (status in ('open','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index idx_rides_discover on public.rides (starts_on, status, visibility);
create index idx_rides_host on public.rides (host_id, starts_on);

-- Exact meeting point and host notes: confirmed riders and the host only.
create table public.ride_private (
  ride_id uuid primary key references public.rides(id) on delete cascade,
  meeting_point text check (char_length(meeting_point) <= 200),
  host_note text check (char_length(host_note) <= 500)
);

create table public.ride_participants (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('invited','requested','going','declined','removed','left')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ride_id, user_id)
);
create index idx_ride_participants_user on public.ride_participants (user_id, status);

create table public.ride_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  ride_id uuid not null references public.rides(id) on delete cascade,
  reason text not null check (reason in ('spam','unsafe','inappropriate','harassment','other')),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','under_review','actioned','dismissed')),
  created_at timestamptz not null default now()
);
create unique index uq_ride_reports_open on public.ride_reports (reporter_id, ride_id) where status = 'open';

create trigger trg_rides_updated before update on public.rides for each row execute function public.set_updated_at();
create trigger trg_ride_participants_updated before update on public.ride_participants for each row execute function public.set_updated_at();

-- 3. Helper functions (security definer so row-level policies can call them without recursion) -----
create or replace function public.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profile_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$fn$;

create or replace function public.is_ride_host(p_ride uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.rides where id = p_ride and host_id = p_uid)
$fn$;

create or replace function public.ride_member_status(p_ride uuid, p_uid uuid) returns text
language sql stable security definer set search_path = public as $fn$
  select status from public.ride_participants where ride_id = p_ride and user_id = p_uid
$fn$;

create or replace function public.ride_visible(p_ride uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and exists (
    select 1 from public.rides r
    where r.id = p_ride
      and not public.blocked_between(r.host_id, p_uid)
      and (
        r.host_id = p_uid
        or exists (select 1 from public.ride_participants p
                   where p.ride_id = r.id and p.user_id = p_uid and p.status in ('invited','requested','going','declined'))
        or (r.visibility = 'public' and r.status = 'open')
      )
  )
$fn$;

-- Number of confirmed riders (host included). Visible rides only.
create or replace function public.ride_going_count(p_ride uuid) returns integer
language sql stable security definer set search_path = public as $fn$
  select case when public.ride_visible(p_ride, auth.uid())
    then (select count(*)::int from public.ride_participants where ride_id = p_ride and status = 'going') end
$fn$;

-- 4. Triggers -----------------------------------------------------------------------------------
-- The host is always a confirmed rider on their own ride.
create or replace function public.ride_add_host() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.ride_participants (ride_id, user_id, status) values (new.id, new.host_id, 'going');
  return new;
end $fn$;
create trigger trg_rides_add_host after insert on public.rides for each row execute function public.ride_add_host();

create or replace function public.rides_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.host_id is distinct from old.host_id then raise exception 'host_immutable' using errcode = 'P0001'; end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'ride_cancelled' using errcode = 'P0001'; end if;
  if new.max_riders < (select count(*) from public.ride_participants where ride_id = old.id and status = 'going') then
    raise exception 'capacity_below_going' using errcode = 'P0001';
  end if;
  return new;
end $fn$;
create trigger trg_rides_guard before update on public.rides for each row execute function public.rides_guard();

-- Defence in depth: whatever writes a participant row, a ride can never exceed its capacity,
-- and the host can never be moved off their own ride.
create or replace function public.ride_participants_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_max integer; v_host uuid;
begin
  select max_riders, host_id into v_max, v_host from public.rides where id = new.ride_id;
  if new.user_id = v_host and new.status <> 'going' then raise exception 'host_must_go' using errcode = 'P0001'; end if;
  if new.status = 'going' and (tg_op = 'INSERT' or old.status is distinct from 'going') then
    if (select count(*) from public.ride_participants where ride_id = new.ride_id and status = 'going' and user_id <> new.user_id) >= v_max then
      raise exception 'ride_full' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $fn$;
create trigger trg_ride_participants_guard before insert or update on public.ride_participants
  for each row execute function public.ride_participants_guard();

-- 5. Row-level security -------------------------------------------------------------------------
alter table public.rides enable row level security;
alter table public.ride_private enable row level security;
alter table public.ride_participants enable row level security;
alter table public.ride_reports enable row level security;

create policy rides_select on public.rides for select to authenticated
  using (public.ride_visible(id, (select auth.uid())));
-- Hosting needs a rider profile: it is what other riders see next to the ride.
create policy rides_insert on public.rides for insert to authenticated
  with check (host_id = (select auth.uid()) and exists (select 1 from public.rider_profiles where user_id = (select auth.uid())));
create policy rides_update on public.rides for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));

create policy ride_private_select on public.ride_private for select to authenticated
  using (public.is_ride_host(ride_id, (select auth.uid())) or public.ride_member_status(ride_id, (select auth.uid())) = 'going');
create policy ride_private_insert on public.ride_private for insert to authenticated
  with check (public.is_ride_host(ride_id, (select auth.uid())));
create policy ride_private_update on public.ride_private for update to authenticated
  using (public.is_ride_host(ride_id, (select auth.uid()))) with check (public.is_ride_host(ride_id, (select auth.uid())));
create policy ride_private_delete on public.ride_private for delete to authenticated
  using (public.is_ride_host(ride_id, (select auth.uid())));

-- Participants can be READ by: the person themselves, the host, and other confirmed riders (who see confirmed riders only).
-- There is NO insert/update/delete policy: all changes go through the functions below.
create policy ride_participants_select on public.ride_participants for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_ride_host(ride_id, (select auth.uid()))
    or (status = 'going' and public.ride_member_status(ride_id, (select auth.uid())) = 'going')
  );

create policy ride_reports_insert on public.ride_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open'
              and public.ride_visible(ride_id, (select auth.uid())) and not public.is_ride_host(ride_id, (select auth.uid())));
create policy ride_reports_select on public.ride_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- 6. Participation functions ----------------------------------------------------------------------
-- Every function: requires sign-in, locks the ride row (so capacity checks cannot race), and raises a short code
-- that the application maps to a clear message.
create or replace function public.ride_request_join(p_ride uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r public.rides; cur text; nxt text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.rider_profiles where user_id = v_uid) then raise exception 'profile_required' using errcode = 'P0001'; end if;
  select * into r from public.rides where id = p_ride for update;
  if not found or not public.ride_visible(p_ride, v_uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.host_id = v_uid then raise exception 'is_host' using errcode = 'P0001'; end if;
  if r.status <> 'open' or r.starts_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'ride_closed' using errcode = 'P0001'; end if;
  select status into cur from public.ride_participants where ride_id = p_ride and user_id = v_uid;
  if cur = 'going' or cur = 'requested' then return cur; end if;
  if cur = 'removed' then raise exception 'removed' using errcode = 'P0001'; end if;
  if cur = 'invited' or not r.requires_approval then
    if (select count(*) from public.ride_participants where ride_id = p_ride and status = 'going') >= r.max_riders then
      raise exception 'ride_full' using errcode = 'P0001';
    end if;
    nxt := 'going';
  else
    nxt := 'requested';
  end if;
  insert into public.ride_participants (ride_id, user_id, status) values (p_ride, v_uid, nxt)
    on conflict (ride_id, user_id) do update set status = excluded.status;
  return nxt;
end $fn$;

create or replace function public.ride_invite(p_ride uuid, p_handle text) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r public.rides; v_target uuid; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into r from public.rides where id = p_ride for update;
  if not found or r.host_id <> v_uid then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'open' or r.starts_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'ride_closed' using errcode = 'P0001'; end if;
  -- Only public profiles can be invited by handle, and never across a block: otherwise it would reveal who exists.
  select user_id into v_target from public.rider_profiles where handle = lower(btrim(p_handle)) and is_public;
  if v_target is null or public.blocked_between(v_uid, v_target) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_target = v_uid then raise exception 'is_host' using errcode = 'P0001'; end if;
  select status into cur from public.ride_participants where ride_id = p_ride and user_id = v_target;
  if cur = 'going' then raise exception 'already_going' using errcode = 'P0001'; end if;
  if cur = 'invited' then return 'invited'; end if;
  if (select count(*) from public.ride_participants where ride_id = p_ride and status = 'invited') >= 100 then
    raise exception 'too_many_invites' using errcode = 'P0001';
  end if;
  if cur = 'requested' then   -- they already asked to join: inviting them is approval
    if (select count(*) from public.ride_participants where ride_id = p_ride and status = 'going') >= r.max_riders then
      raise exception 'ride_full' using errcode = 'P0001';
    end if;
    update public.ride_participants set status = 'going' where ride_id = p_ride and user_id = v_target;
    return 'going';
  end if;
  insert into public.ride_participants (ride_id, user_id, status) values (p_ride, v_target, 'invited')
    on conflict (ride_id, user_id) do update set status = 'invited';
  return 'invited';
end $fn$;

create or replace function public.ride_respond(p_ride uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r public.rides; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into r from public.rides where id = p_ride for update;
  select status into cur from public.ride_participants where ride_id = p_ride and user_id = v_uid;
  if not found or cur <> 'invited' or r.id is null or public.blocked_between(r.host_id, v_uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not p_accept then
    update public.ride_participants set status = 'declined' where ride_id = p_ride and user_id = v_uid;
    return 'declined';
  end if;
  if r.status <> 'open' or r.starts_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'ride_closed' using errcode = 'P0001'; end if;
  if (select count(*) from public.ride_participants where ride_id = p_ride and status = 'going') >= r.max_riders then
    raise exception 'ride_full' using errcode = 'P0001';
  end if;
  update public.ride_participants set status = 'going' where ride_id = p_ride and user_id = v_uid;
  return 'going';
end $fn$;

create or replace function public.ride_decide(p_ride uuid, p_user uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r public.rides; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into r from public.rides where id = p_ride for update;
  if not found or r.host_id <> v_uid then raise exception 'not_found' using errcode = 'P0002'; end if;
  select status into cur from public.ride_participants where ride_id = p_ride and user_id = p_user;
  if cur is distinct from 'requested' then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not p_approve then
    update public.ride_participants set status = 'declined' where ride_id = p_ride and user_id = p_user;
    return 'declined';
  end if;
  if r.status <> 'open' or r.starts_on < (now() at time zone 'Asia/Kolkata')::date then raise exception 'ride_closed' using errcode = 'P0001'; end if;
  if (select count(*) from public.ride_participants where ride_id = p_ride and status = 'going') >= r.max_riders then
    raise exception 'ride_full' using errcode = 'P0001';
  end if;
  update public.ride_participants set status = 'going' where ride_id = p_ride and user_id = p_user;
  return 'going';
end $fn$;

create or replace function public.ride_leave(p_ride uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r public.rides; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into r from public.rides where id = p_ride for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.host_id = v_uid then raise exception 'is_host' using errcode = 'P0001'; end if;   -- a host cancels instead
  select status into cur from public.ride_participants where ride_id = p_ride and user_id = v_uid;
  if cur is null or cur not in ('going','requested','invited') then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.ride_participants set status = 'left' where ride_id = p_ride and user_id = v_uid;
  return 'left';
end $fn$;

create or replace function public.ride_remove(p_ride uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r public.rides; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into r from public.rides where id = p_ride for update;
  if not found or r.host_id <> v_uid then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_user = v_uid then raise exception 'is_host' using errcode = 'P0001'; end if;
  select status into cur from public.ride_participants where ride_id = p_ride and user_id = p_user;
  if cur is null or cur not in ('going','requested','invited','declined') then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.ride_participants set status = 'removed' where ride_id = p_ride and user_id = p_user;
  return 'removed';
end $fn$;

-- 7. Grants: browsers (signed in) may call these; anonymous may not -------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'blocked_between(uuid,uuid)', 'is_ride_host(uuid,uuid)', 'ride_member_status(uuid,uuid)', 'ride_visible(uuid,uuid)',
    'ride_going_count(uuid)', 'ride_request_join(uuid)', 'ride_invite(uuid,text)', 'ride_respond(uuid,boolean)',
    'ride_decide(uuid,uuid,boolean)', 'ride_leave(uuid)', 'ride_remove(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $grants$;
