-- Integrity layer from docs/05 sections 3-4.

-- 1. Estimates are insert-only through a controlled function; no direct client writes.
revoke insert, update, delete on public.trip_estimates from authenticated;

-- SECURITY DEFINER bypasses RLS, so ownership is checked explicitly against auth.uid().
create or replace function public.create_trip_estimate(
  p_trip_id uuid,
  p_distance_km numeric, p_mileage_kmpl numeric, p_fuel_price integer,
  p_fuel_litres numeric, p_fuel_paise bigint,
  p_toll bigint, p_food bigint, p_stay bigint, p_other bigint,
  p_input_sources jsonb
) returns public.trip_estimates
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_rev integer;
  v_row public.trip_estimates;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Lock the trip row so concurrent calls get distinct, increasing revisions.
  perform 1 from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  select coalesce(max(revision), 0) + 1 into v_rev from public.trip_estimates where trip_id = p_trip_id;

  insert into public.trip_estimates (user_id, trip_id, revision, distance_km, mileage_kmpl,
    fuel_price_paise_per_litre, fuel_litres, fuel_paise, toll_paise, food_paise, stay_paise, other_paise, input_sources)
  values (v_uid, p_trip_id, v_rev, p_distance_km, p_mileage_kmpl, p_fuel_price,
    p_fuel_litres, p_fuel_paise, p_toll, p_food, p_stay, p_other, p_input_sources)
  returning * into v_row;
  return v_row;
end $fn$;

revoke all on function public.create_trip_estimate(uuid, numeric, numeric, integer, numeric, bigint, bigint, bigint, bigint, bigint, jsonb) from public, anon;
grant execute on function public.create_trip_estimate(uuid, numeric, numeric, integer, numeric, bigint, bigint, bigint, bigint, bigint, jsonb) to authenticated;

-- 2. Trip status state machine enforced at the DB layer (mirrors src/features/trips/lifecycle.ts).
create or replace function public.enforce_trip_status() returns trigger
language plpgsql as $fn$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('active','archived')) or
    (old.status = 'active' and new.status in ('completed','archived')) or
    (old.status = 'completed' and new.status in ('archived','active')) or
    (old.status = 'archived' and new.status in ('draft','completed'))
  ) then
    raise exception 'invalid trip status transition % -> %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'active' and new.started_at is null then new.started_at = now(); end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at = now(); end if;
  return new;
end $fn$;

create trigger trg_trips_status before update of status on public.trips
  for each row execute function public.enforce_trip_status();
