-- Community: riding clubs and memberships.
--
-- Same principles as rides: membership changes go through database functions that check capacity, roles,
-- approval and blocks atomically; browsers cannot write membership rows directly; reads use row-level security.
--  * A PUBLIC club is visible to every signed-in rider; a PRIVATE club is visible only to its members and invitees.
--  * Private clubs are always invite-only.
--  * Only city and state are stored for a club. No addresses.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null check (char_length(btrim(name)) between 3 and 60),
  description text check (char_length(description) <= 500),
  city text check (char_length(city) <= 60),
  state text check (char_length(state) <= 60),
  visibility text not null default 'public' check (visibility in ('public','private')),
  join_policy text not null default 'approval' check (join_policy in ('open','approval','invite')),
  member_limit integer not null default 100 check (member_limit between 2 and 1000),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clubs_slug_key unique (slug),
  constraint clubs_slug_format check (slug ~ '^[a-z0-9_]{3,30}$' and slug ~ '[a-z]'),
  constraint clubs_slug_reserved check (slug <> all (array['new','edit','mine','admin','support','help','api','clubs','club','official','riders','rides'])),
  constraint clubs_private_is_invite_only check (visibility = 'public' or join_policy = 'invite')
);
create index idx_clubs_discover on public.clubs (status, visibility, state);
create index idx_clubs_owner on public.clubs (owner_id);

create table public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  status text not null check (status in ('invited','requested','active','declined','removed','left')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index idx_club_members_user on public.club_members (user_id, status);

create table public.club_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  reason text not null check (reason in ('spam','unsafe','inappropriate','harassment','other')),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','under_review','actioned','dismissed')),
  created_at timestamptz not null default now()
);
create unique index uq_club_reports_open on public.club_reports (reporter_id, club_id) where status = 'open';

create trigger trg_clubs_updated before update on public.clubs for each row execute function public.set_updated_at();
create trigger trg_club_members_updated before update on public.club_members for each row execute function public.set_updated_at();

-- Helpers (security definer, so policies can use them without recursion) -----------------------------------------
create or replace function public.club_member_status(p_club uuid, p_uid uuid) returns text
language sql stable security definer set search_path = public as $fn$
  select status from public.club_members where club_id = p_club and user_id = p_uid
$fn$;

-- The member's role, but only while they are an ACTIVE member (invitees and applicants have no role yet).
create or replace function public.club_role(p_club uuid, p_uid uuid) returns text
language sql stable security definer set search_path = public as $fn$
  select role from public.club_members where club_id = p_club and user_id = p_uid and status = 'active'
$fn$;

create or replace function public.club_visible(p_club uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and exists (
    select 1 from public.clubs c
    where c.id = p_club
      and not public.blocked_between(c.owner_id, p_uid)
      and (
        c.owner_id = p_uid
        or exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = p_uid and m.status in ('invited','requested','active','declined'))
        or (c.visibility = 'public' and c.status = 'active')
      )
  )
$fn$;

-- Number of active members. Visible clubs only.
create or replace function public.club_member_count(p_club uuid) returns integer
language sql stable security definer set search_path = public as $fn$
  select case when public.club_visible(p_club, auth.uid())
    then (select count(*)::int from public.club_members where club_id = p_club and status = 'active') end
$fn$;

-- Triggers ------------------------------------------------------------------------------------------------------
create or replace function public.club_add_owner() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.club_members (club_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active');
  return new;
end $fn$;
create trigger trg_clubs_add_owner after insert on public.clubs for each row execute function public.club_add_owner();

create or replace function public.clubs_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.owner_id is distinct from old.owner_id then raise exception 'owner_immutable' using errcode = 'P0001'; end if;
  if old.status = 'archived' and new.status <> 'archived' then raise exception 'club_archived' using errcode = 'P0001'; end if;
  if new.member_limit < (select count(*) from public.club_members where club_id = old.id and status = 'active') then
    raise exception 'limit_below_members' using errcode = 'P0001';
  end if;
  return new;
end $fn$;
create trigger trg_clubs_guard before update on public.clubs for each row execute function public.clubs_guard();

-- Defence in depth for membership rows, whichever code writes them.
create or replace function public.club_members_guard() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_limit integer; v_owner uuid;
begin
  select member_limit, owner_id into v_limit, v_owner from public.clubs where id = new.club_id;
  if (new.role = 'owner') <> (new.user_id = v_owner) then raise exception 'owner_role_mismatch' using errcode = 'P0001'; end if;
  if new.user_id = v_owner and new.status <> 'active' then raise exception 'owner_must_stay' using errcode = 'P0001'; end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if (select count(*) from public.club_members where club_id = new.club_id and status = 'active' and user_id <> new.user_id) >= v_limit then
      raise exception 'club_full' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $fn$;
create trigger trg_club_members_guard before insert or update on public.club_members for each row execute function public.club_members_guard();

-- Row-level security ----------------------------------------------------------------------------------------------
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_reports enable row level security;

create policy clubs_select on public.clubs for select to authenticated
  using (owner_id = (select auth.uid()) or public.club_visible(id, (select auth.uid())));
create policy clubs_insert on public.clubs for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.rider_profiles where user_id = (select auth.uid())));
create policy clubs_update on public.clubs for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Membership rows can be READ by: the person themselves, the club's owner and admins, and other active members
-- (who see active members only). There is NO insert/update/delete policy: all changes go through the functions below.
create policy club_members_select on public.club_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.club_role(club_id, (select auth.uid())) in ('owner','admin')
    or (status = 'active' and public.club_role(club_id, (select auth.uid())) is not null)
  );

create policy club_reports_insert on public.club_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open'
              and public.club_visible(club_id, (select auth.uid()))
              and coalesce(public.club_role(club_id, (select auth.uid())), '') <> 'owner');
create policy club_reports_select on public.club_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- Membership functions ----------------------------------------------------------------------------------------------
create or replace function public.club_request_join(p_club uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; cur text; nxt text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.rider_profiles where user_id = v_uid) then raise exception 'profile_required' using errcode = 'P0001'; end if;
  select * into c from public.clubs where id = p_club for update;
  if not found or not public.club_visible(p_club, v_uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.owner_id = v_uid then raise exception 'is_owner' using errcode = 'P0001'; end if;
  if c.status <> 'active' then raise exception 'club_archived' using errcode = 'P0001'; end if;
  select status into cur from public.club_members where club_id = p_club and user_id = v_uid;
  if cur = 'active' or cur = 'requested' then return cur; end if;
  if cur = 'removed' then raise exception 'removed' using errcode = 'P0001'; end if;
  if cur = 'invited' or c.join_policy = 'open' then
    if (select count(*) from public.club_members where club_id = p_club and status = 'active') >= c.member_limit then raise exception 'club_full' using errcode = 'P0001'; end if;
    nxt := 'active';
  elsif c.join_policy = 'approval' then
    nxt := 'requested';
  else
    raise exception 'invite_only' using errcode = 'P0001';
  end if;
  insert into public.club_members (club_id, user_id, role, status) values (p_club, v_uid, 'member', nxt)
    on conflict (club_id, user_id) do update set status = excluded.status, role = 'member';
  return nxt;
end $fn$;

create or replace function public.club_invite(p_club uuid, p_handle text) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; v_target uuid; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into c from public.clubs where id = p_club for update;
  if not found or coalesce(public.club_role(p_club, v_uid), '') not in ('owner','admin') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'active' then raise exception 'club_archived' using errcode = 'P0001'; end if;
  select user_id into v_target from public.rider_profiles where handle = lower(btrim(p_handle)) and is_public;
  if v_target is null or public.blocked_between(v_uid, v_target) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select status into cur from public.club_members where club_id = p_club and user_id = v_target;
  if cur = 'active' then raise exception 'already_member' using errcode = 'P0001'; end if;
  if cur = 'invited' then return 'invited'; end if;
  if (select count(*) from public.club_members where club_id = p_club and status = 'invited') >= 200 then raise exception 'too_many_invites' using errcode = 'P0001'; end if;
  if cur = 'requested' then   -- they already asked: inviting them is approval
    if (select count(*) from public.club_members where club_id = p_club and status = 'active') >= c.member_limit then raise exception 'club_full' using errcode = 'P0001'; end if;
    update public.club_members set status = 'active' where club_id = p_club and user_id = v_target;
    return 'active';
  end if;
  insert into public.club_members (club_id, user_id, role, status) values (p_club, v_target, 'member', 'invited')
    on conflict (club_id, user_id) do update set status = 'invited', role = 'member';
  return 'invited';
end $fn$;

create or replace function public.club_respond(p_club uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into c from public.clubs where id = p_club for update;
  select status into cur from public.club_members where club_id = p_club and user_id = v_uid;
  if not found or cur <> 'invited' or c.id is null or public.blocked_between(c.owner_id, v_uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not p_accept then
    update public.club_members set status = 'declined' where club_id = p_club and user_id = v_uid;
    return 'declined';
  end if;
  if c.status <> 'active' then raise exception 'club_archived' using errcode = 'P0001'; end if;
  if (select count(*) from public.club_members where club_id = p_club and status = 'active') >= c.member_limit then raise exception 'club_full' using errcode = 'P0001'; end if;
  update public.club_members set status = 'active' where club_id = p_club and user_id = v_uid;
  return 'active';
end $fn$;

create or replace function public.club_decide(p_club uuid, p_user uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into c from public.clubs where id = p_club for update;
  if not found or coalesce(public.club_role(p_club, v_uid), '') not in ('owner','admin') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select status into cur from public.club_members where club_id = p_club and user_id = p_user;
  if cur is distinct from 'requested' then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not p_approve then
    update public.club_members set status = 'declined' where club_id = p_club and user_id = p_user;
    return 'declined';
  end if;
  if c.status <> 'active' then raise exception 'club_archived' using errcode = 'P0001'; end if;
  if (select count(*) from public.club_members where club_id = p_club and status = 'active') >= c.member_limit then raise exception 'club_full' using errcode = 'P0001'; end if;
  update public.club_members set status = 'active' where club_id = p_club and user_id = p_user;
  return 'active';
end $fn$;

create or replace function public.club_leave(p_club uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into c from public.clubs where id = p_club for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.owner_id = v_uid then raise exception 'is_owner' using errcode = 'P0001'; end if;   -- an owner archives the club instead
  select status into cur from public.club_members where club_id = p_club and user_id = v_uid;
  if cur is null or cur not in ('active','requested','invited') then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.club_members set status = 'left', role = 'member' where club_id = p_club and user_id = v_uid;
  return 'left';
end $fn$;

-- Owners and admins remove members; only the owner removes admins; nobody removes the owner.
create or replace function public.club_remove(p_club uuid, p_user uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; my_role text; cur text; target_role text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into c from public.clubs where id = p_club for update;
  my_role := public.club_role(p_club, v_uid);
  if not found or coalesce(my_role, '') not in ('owner','admin') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_user = c.owner_id then raise exception 'is_owner' using errcode = 'P0001'; end if;
  select status, role into cur, target_role from public.club_members where club_id = p_club and user_id = p_user;
  if cur is null or cur not in ('active','requested','invited','declined') then raise exception 'not_found' using errcode = 'P0002'; end if;
  if target_role = 'admin' and my_role <> 'owner' then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  update public.club_members set status = 'removed', role = 'member' where club_id = p_club and user_id = p_user;
  return 'removed';
end $fn$;

create or replace function public.club_set_role(p_club uuid, p_user uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); c public.clubs; cur text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if p_role not in ('admin','member') then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into c from public.clubs where id = p_club for update;
  if not found or c.owner_id <> v_uid then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_user = c.owner_id then raise exception 'is_owner' using errcode = 'P0001'; end if;
  select status into cur from public.club_members where club_id = p_club and user_id = p_user;
  if cur is distinct from 'active' then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.club_members set role = p_role where club_id = p_club and user_id = p_user;
  return p_role;
end $fn$;

-- Grants: signed-in browsers and the server may call these; anonymous may not ----------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'club_member_status(uuid,uuid)', 'club_role(uuid,uuid)', 'club_visible(uuid,uuid)', 'club_member_count(uuid)',
    'club_request_join(uuid)', 'club_invite(uuid,text)', 'club_respond(uuid,boolean)', 'club_decide(uuid,uuid,boolean)',
    'club_leave(uuid)', 'club_remove(uuid,uuid)', 'club_set_role(uuid,uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $grants$;
