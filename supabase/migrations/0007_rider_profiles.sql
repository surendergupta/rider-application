-- Rider public profile (P0). Opt-in, privacy-first, separate from the private account.
--
-- Design rules:
--  * No public SELECT policy exists. Anonymous and other users cannot read or list this table through the
--    database API at all. Public pages read through the server with a fixed field whitelist, so profiles
--    cannot be enumerated by querying the REST interface.
--  * A profile is private until the owner turns it on (is_public defaults to false).
--  * Nothing here stores email, phone, address, registration number, VIN or live location.

create table public.rider_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
  bio text check (char_length(bio) <= 300),
  location_city text check (char_length(location_city) <= 60),    -- city and state only, never an address
  location_state text check (char_length(location_state) <= 60),
  interests text[] not null default '{}',
  avatar_color text not null default 'orange',                     -- initials badge; image upload needs moderation tooling first
  is_public boolean not null default false,                        -- opt-in
  show_motorcycle boolean not null default false,
  featured_bike_id uuid,
  show_stats boolean not null default false,
  handle_changed_at timestamptz,                                   -- null until the first change after creation
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rider_profiles_handle_key unique (handle),
  -- Stored lowercase, so uniqueness is case-insensitive: "Rider" and "rider" are the same handle.
  constraint rider_profiles_handle_format check (handle ~ '^[a-z0-9_]{3,20}$' and handle ~ '[a-z]'),
  constraint rider_profiles_handle_reserved check (handle <> all (array[
    'admin','administrator','root','support','help','staff','moderator','mod','official','system','api','www','app',
    'login','signup','home','trips','bikes','garage','map','account','profile','settings','pricing','terms','privacy',
    'community','marketplace','rider','riders','r','s','null','undefined','anonymous','me'])),
  constraint rider_profiles_interests_valid check (
    interests <@ array['adventure','touring','commuting','weekend','mountains','off_road','city']::text[]
    and cardinality(interests) <= 6),
  constraint rider_profiles_avatar_valid check (avatar_color in ('orange','teal','indigo','rose','emerald','slate')),
  -- The featured motorcycle must belong to the same user (composite key), exactly like trips and bikes.
  constraint rider_profiles_bike_fk foreign key (featured_bike_id, user_id)
    references public.bikes (id, user_id) on delete set null (featured_bike_id),
  constraint rider_profiles_bike_needed check (not show_motorcycle or featured_bike_id is not null)
);

create trigger trg_rider_profiles_updated before update on public.rider_profiles
  for each row execute function public.set_updated_at();

-- Handle changes are limited: one change per 30 days, so handles cannot be swapped to impersonate or evade blocks.
create or replace function public.enforce_handle_cooldown() returns trigger
language plpgsql as $fn$
begin
  if new.handle is distinct from old.handle then
    if old.handle_changed_at is not null and old.handle_changed_at > now() - interval '30 days' then
      raise exception 'handle_cooldown' using errcode = 'P0001';
    end if;
    new.handle_changed_at = now();
  else
    new.handle_changed_at = old.handle_changed_at;   -- a save that does not change the handle never resets the clock
  end if;
  return new;
end $fn$;
create trigger trg_rider_profiles_handle before update on public.rider_profiles
  for each row execute function public.enforce_handle_cooldown();

alter table public.rider_profiles enable row level security;
create policy rider_profiles_select on public.rider_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy rider_profiles_insert on public.rider_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy rider_profiles_update on public.rider_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy rider_profiles_delete on public.rider_profiles for delete to authenticated using (user_id = (select auth.uid()));

-- Blocks: only the blocker can see or change their own block list. The blocked person cannot see that they are blocked.
create table public.profile_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index idx_profile_blocks_blocked on public.profile_blocks (blocked_id);
alter table public.profile_blocks enable row level security;
create policy profile_blocks_select on public.profile_blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy profile_blocks_insert on public.profile_blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy profile_blocks_delete on public.profile_blocks for delete to authenticated using (blocker_id = (select auth.uid()));

-- Reports: a reporter can file and see their own reports only. Moderators read them through a separate admin role later.
create table public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  profile_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','impersonation','inappropriate','harassment','other')),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','under_review','actioned','dismissed')),
  created_at timestamptz not null default now(),
  check (reporter_id <> profile_user_id)
);
-- One open report per reporter per profile, so the report button cannot be used to spam a moderator queue.
create unique index uq_profile_reports_open on public.profile_reports (reporter_id, profile_user_id) where status = 'open';
create index idx_profile_reports_profile on public.profile_reports (profile_user_id, status);
alter table public.profile_reports enable row level security;
create policy profile_reports_select on public.profile_reports for select to authenticated using (reporter_id = (select auth.uid()));
create policy profile_reports_insert on public.profile_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open');

-- Aggregate ride statistics for a profile that chose to show them. Returns counts only: no places, dates or routes.
-- Callable by the server (service role) only, never by browsers.
create or replace function public.rider_stats(p_user uuid)
returns table (rides integer, km numeric, places integer)
language sql stable security definer set search_path = public as $fn$
  select count(*)::int,
         coalesce(sum(coalesce(t.actual_distance_km, e.distance_km)), 0)::numeric(12,1),
         count(distinct lower(btrim(t.destination_label)))::int
  from public.trips t
  left join lateral (
    select distance_km from public.trip_estimates where trip_id = t.id order by revision desc limit 1
  ) e on true
  where t.user_id = p_user and t.status = 'completed'
$fn$;
revoke all on function public.rider_stats(uuid) from public, anon, authenticated;
grant execute on function public.rider_stats(uuid) to service_role;
