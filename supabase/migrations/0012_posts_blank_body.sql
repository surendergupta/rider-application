-- btrim() strips spaces only, so a body made of newlines or tabs counted as "not empty".
-- Trim all whitespace characters in post_create() and in the table constraint.
alter table public.posts drop constraint posts_not_empty;
alter table public.posts add constraint posts_not_empty check (kind = 'ride_story' or char_length(btrim(body, E' \t\r\n')) >= 1);

create or replace function public.post_create(p_body text, p_club uuid, p_trip uuid, p_include_destination boolean default false) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
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
    select * into t from public.trips where id = p_trip and user_id = v_uid;
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
