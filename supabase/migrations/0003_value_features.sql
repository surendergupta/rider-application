-- Fuel-stop planning, ride checklist, shareable trip links, Pro-interest capture.

-- Tank size (litres) lets us compute range per tank.
alter table public.bikes
  add column tank_litres numeric(5,2) check (tank_litres > 0 and tank_litres <= 100);

-- Opt-in public summary link. null = private (the default).
alter table public.trips add column share_token uuid unique;

create table public.trip_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null,
  category text not null check (category in ('documents','bike','tools','gear','personal')),
  label text not null check (char_length(label) between 1 and 200),
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (trip_id, label),
  foreign key (trip_id, user_id) references public.trips(id, user_id) on delete cascade
);
create index idx_checklist_trip on public.trip_checklist_items (trip_id, sort_order);

-- Early-access interest in a paid plan. One row per user; no payment data.
create table public.pro_interest (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly','yearly')),
  created_at timestamptz not null default now()
);

do $rls$
declare t text;
begin
  foreach t in array array['trip_checklist_items','pro_interest'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$I_select on public.%1$I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy %1$I_insert on public.%1$I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$I_update on public.%1$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy %1$I_delete on public.%1$I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $rls$;
