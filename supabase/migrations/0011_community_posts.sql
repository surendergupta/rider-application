-- Community: posts and ride sharing.
--
-- Principles (same as rides and clubs):
--  * Browsers cannot insert posts directly. Creating a post goes through post_create(), which checks the rider profile,
--    club membership, a daily limit and (for a ride story) that the trip is the caller's own COMPLETED trip.
--  * A ride story is a SNAPSHOT: title, distance and completion date are copied into the post. There is no link back to the
--    private trip, so nothing else about the trip (costs, expenses, origin, route, bike) can ever be read through a post.
--    The destination is copied only when the rider ticks "include destination". The origin is never copied.
--  * A post is either community-wide (every signed-in rider who is not blocked) or club-only (active club members only).
--  * Posts are private-by-default at the product level: nothing is shared until the rider writes and sends a post.
--  * No edits (nothing to abuse after reports), no comments or likes in this phase. Authors and club managers may delete.

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,        -- null = community-wide
  kind text not null default 'post' check (kind in ('post','ride_story')),
  body text not null default '' check (char_length(body) <= 1000),
  trip_title text check (char_length(trip_title) <= 160),
  trip_distance_km numeric(10,1) check (trip_distance_km > 0),
  trip_completed_on date,
  trip_destination text check (char_length(trip_destination) <= 250),
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  constraint posts_story_shape check (
    (kind = 'ride_story' and trip_title is not null and trip_completed_on is not null)
    or (kind = 'post' and trip_title is null and trip_distance_km is null and trip_completed_on is null and trip_destination is null)
  ),
  constraint posts_not_empty check (kind = 'ride_story' or char_length(btrim(body)) >= 1)
);
create index idx_posts_community on public.posts (created_at desc) where club_id is null and status = 'active';
create index idx_posts_club on public.posts (club_id, created_at desc) where status = 'active';
create index idx_posts_author on public.posts (author_id, created_at desc);

create table public.post_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null check (reason in ('spam','unsafe','inappropriate','harassment','other')),
  note text check (char_length(note) <= 500),
  status text not null default 'open' check (status in ('open','under_review','actioned','dismissed')),
  created_at timestamptz not null default now()
);
create unique index uq_post_reports_open on public.post_reports (reporter_id, post_id) where status = 'open';

-- Helpers (security definer, so policies can use them without recursion) ----------------------------------------
create or replace function public.post_visible(p_post uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and exists (
    select 1 from public.posts p
    where p.id = p_post
      and p.status = 'active'
      and not public.blocked_between(p.author_id, p_uid)
      and (
        p.author_id = p_uid
        or p.club_id is null
        or (public.club_role(p.club_id, p_uid) is not null
            and exists (select 1 from public.clubs c where c.id = p.club_id and c.status = 'active'))
      )
  )
$fn$;

-- A club's owner and admins may remove posts in that club (the author may always remove their own).
create or replace function public.post_removable(p_post uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and exists (
    select 1 from public.posts p
    where p.id = p_post
      and (p.author_id = p_uid or (p.club_id is not null and coalesce(public.club_role(p.club_id, p_uid), '') in ('owner','admin')))
  )
$fn$;

-- Row-level security --------------------------------------------------------------------------------------------
alter table public.posts enable row level security;
alter table public.post_reports enable row level security;

-- There is NO insert or update policy: posts are created by post_create() and never edited.
create policy posts_select on public.posts for select to authenticated
  using (author_id = (select auth.uid()) or public.post_visible(id, (select auth.uid())));
create policy posts_delete on public.posts for delete to authenticated
  using (public.post_removable(id, (select auth.uid())));

create policy post_reports_insert on public.post_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open'
              and public.post_visible(post_id, (select auth.uid()))
              and not exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));
create policy post_reports_select on public.post_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- Creating a post -----------------------------------------------------------------------------------------------
create or replace function public.post_create(p_body text, p_club uuid, p_trip uuid, p_include_destination boolean default false) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  c public.clubs; t public.trips; v_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.rider_profiles where user_id = v_uid) then raise exception 'profile_required' using errcode = 'P0001'; end if;
  if char_length(v_body) > 1000 then raise exception 'body_too_long' using errcode = 'P0001'; end if;
  if p_trip is null and v_body = '' then raise exception 'body_required' using errcode = 'P0001'; end if;

  if p_club is not null then
    select * into c from public.clubs where id = p_club;
    if not found or public.club_role(p_club, v_uid) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
    if c.status <> 'active' then raise exception 'club_archived' using errcode = 'P0001'; end if;
  end if;

  if (select count(*) from public.posts where author_id = v_uid and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'post_rate_limit' using errcode = 'P0001';
  end if;

  if p_trip is null then
    insert into public.posts (author_id, club_id, kind, body) values (v_uid, p_club, 'post', v_body) returning id into v_id;
  else
    select * into t from public.trips where id = p_trip and user_id = v_uid;             -- the caller's own trip only
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if t.status <> 'completed' then raise exception 'trip_not_completed' using errcode = 'P0001'; end if;
    insert into public.posts (author_id, club_id, kind, body, trip_title, trip_distance_km, trip_completed_on, trip_destination)
    values (
      v_uid, p_club, 'ride_story', v_body, t.title,
      round(coalesce(t.actual_distance_km, t.route_distance_m / 1000.0), 1),
      (coalesce(t.completed_at, t.updated_at) at time zone 'Asia/Kolkata')::date,
      case when p_include_destination then t.destination_label end
    ) returning id into v_id;
  end if;
  return v_id;
end $fn$;

-- Grants --------------------------------------------------------------------------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array['post_visible(uuid,uuid)', 'post_removable(uuid,uuid)', 'post_create(text,uuid,uuid,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $grants$;
