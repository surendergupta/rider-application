-- Baseline schema from docs/05-BACKEND-SCHEMA.md (review before production use).
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $fn$ begin new.updated_at = now(); return new; end $fn$;

create table public.bikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 100),
  make text check (char_length(make) <= 100),
  model text check (char_length(model) <= 100),
  fuel_type text not null default 'petrol' check (fuel_type = 'petrol'),
  mileage_kmpl numeric(7,2) check (mileage_kmpl > 0 and mileage_kmpl <= 200),
  odometer_km integer check (odometer_km >= 0),
  odometer_updated_at timestamptz,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  origin_label text not null check (char_length(trim(origin_label)) between 1 and 250),
  destination_label text not null check (char_length(trim(destination_label)) between 1 and 250),
  origin_lat numeric(9,6) check (origin_lat between -90 and 90),
  origin_lon numeric(9,6) check (origin_lon between -180 and 180),
  destination_lat numeric(9,6) check (destination_lat between -90 and 90),
  destination_lon numeric(9,6) check (destination_lon between -180 and 180),
  waypoints jsonb not null default '[]'::jsonb,
  travel_date date,
  status text not null default 'draft' check (status in ('draft','active','completed','archived')),
  route_distance_m integer check (route_distance_m > 0),
  route_duration_s integer check (route_duration_s >= 0),
  route_provider text,
  route_source_kind text check (route_source_kind in ('provider','manual')),
  route_external_id text,
  route_geometry jsonb,
  route_generated_at timestamptz,
  actual_distance_km numeric(10,2) check (actual_distance_km > 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (bike_id, user_id) references public.bikes(id, user_id)
);

create table public.trip_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null,
  revision integer not null check (revision > 0),
  distance_km numeric(10,2) not null check (distance_km > 0),
  mileage_kmpl numeric(7,2) not null check (mileage_kmpl > 0),
  fuel_price_paise_per_litre integer not null check (fuel_price_paise_per_litre >= 0),
  fuel_litres numeric(12,3) not null check (fuel_litres >= 0),
  fuel_paise bigint not null check (fuel_paise >= 0),
  toll_paise bigint not null default 0 check (toll_paise >= 0),
  food_paise bigint not null default 0 check (food_paise >= 0),
  stay_paise bigint not null default 0 check (stay_paise >= 0),
  other_paise bigint not null default 0 check (other_paise >= 0),
  total_paise bigint generated always as
    (fuel_paise + toll_paise + food_paise + stay_paise + other_paise) stored,
  input_sources jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique (trip_id, revision),
  foreign key (trip_id, user_id) references public.trips(id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null,
  category text not null check (category in ('fuel','toll','food','stay','maintenance','parking','other')),
  amount_paise bigint not null check (amount_paise > 0),
  spent_at timestamptz not null default now(),
  notes text check (char_length(notes) <= 1000),
  fuel_litres numeric(10,3) check (fuel_litres > 0),
  fuel_price_paise_per_litre integer check (fuel_price_paise_per_litre > 0),
  odometer_km integer check (odometer_km >= 0),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id),
  foreign key (trip_id, user_id) references public.trips(id, user_id),
  check (category = 'fuel' or (fuel_litres is null and fuel_price_paise_per_litre is null))
);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null,
  service_type text not null check (service_type in ('oil','chain','tyre','brake','general','other')),
  service_date date not null,
  odometer_km integer check (odometer_km >= 0),
  cost_paise bigint not null default 0 check (cost_paise >= 0),
  next_due_km integer check (next_due_km >= 0),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bike_id, user_id) references public.bikes(id, user_id)
);

create table public.service_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null,
  service_type text not null check (service_type in ('oil','chain','tyre','brake','general','other')),
  interval_km integer not null check (interval_km between 1 and 100000),
  last_service_km integer check (last_service_km >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bike_id, service_type),
  foreign key (bike_id, user_id) references public.bikes(id, user_id)
);

create index idx_bikes_user on public.bikes (user_id, created_at desc);
create index idx_trips_user_status on public.trips (user_id, status, created_at desc);
create index idx_estimates_trip_revision on public.trip_estimates (trip_id, revision desc);
create index idx_expenses_trip_time on public.expenses (trip_id, spent_at desc);
create index idx_maintenance_bike_date on public.maintenance_records (bike_id, service_date desc);
create index idx_service_schedule_bike on public.service_schedules (bike_id);

-- updated_at triggers on mutable tables only (estimates are immutable)
create trigger trg_bikes_updated before update on public.bikes for each row execute function public.set_updated_at();
create trigger trg_trips_updated before update on public.trips for each row execute function public.set_updated_at();
create trigger trg_expenses_updated before update on public.expenses for each row execute function public.set_updated_at();
create trigger trg_maint_updated before update on public.maintenance_records for each row execute function public.set_updated_at();
create trigger trg_sched_updated before update on public.service_schedules for each row execute function public.set_updated_at();

-- RLS: owner-only, four operations, on all six tables
do $rls$
declare t text;
begin
  foreach t in array array['bikes','trips','trip_estimates','expenses','maintenance_records','service_schedules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$I_select on public.%1$I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy %1$I_insert on public.%1$I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$I_update on public.%1$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$I_delete on public.%1$I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $rls$;

-- TODO (docs/05 section 3): make trip_estimates insert-only via RPC and enforce trip status transitions at the DB layer.
