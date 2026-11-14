-- Multi-day itinerary: ordered stops grouped by day. Owner-only via RLS and a composite FK to the trip.
create table public.trip_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null,
  day_number integer not null check (day_number between 1 and 60),
  sort_order integer not null default 0,
  place text not null check (char_length(trim(place)) between 1 and 200),
  stop_type text not null default 'ride' check (stop_type in ('ride','fuel','food','stay','sight','other')),
  leg_km numeric(7,1) check (leg_km >= 0 and leg_km <= 3000),   -- distance from the previous stop, entered by the rider
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  foreign key (trip_id, user_id) references public.trips(id, user_id) on delete cascade
);
create index idx_trip_stops_trip on public.trip_stops (trip_id, day_number, sort_order);

alter table public.trip_stops enable row level security;
create policy trip_stops_select on public.trip_stops for select to authenticated using (user_id = (select auth.uid()));
create policy trip_stops_insert on public.trip_stops for insert to authenticated with check (user_id = (select auth.uid()));
create policy trip_stops_update on public.trip_stops for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy trip_stops_delete on public.trip_stops for delete to authenticated using (user_id = (select auth.uid()));
