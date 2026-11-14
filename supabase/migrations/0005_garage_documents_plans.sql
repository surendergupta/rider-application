-- V2.0: vehicle document expiry reminders, V2 plan names, community waitlist topic.

-- Only type, expiry date and a short note are stored: no document numbers and no files,
-- so there is nothing sensitive to leak (strategy: no exposure of private motorcycle documents).
create table public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bike_id uuid not null,
  doc_type text not null check (doc_type in ('insurance','puc','registration','other')),
  expires_on date not null,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bike_id, doc_type),
  foreign key (bike_id, user_id) references public.bikes(id, user_id) on delete cascade
);
create index idx_vehicle_documents_bike on public.vehicle_documents (bike_id, expires_on);
create trigger trg_vehicle_documents_updated before update on public.vehicle_documents
  for each row execute function public.set_updated_at();

alter table public.vehicle_documents enable row level security;
create policy vehicle_documents_select on public.vehicle_documents for select to authenticated using (user_id = (select auth.uid()));
create policy vehicle_documents_insert on public.vehicle_documents for insert to authenticated with check (user_id = (select auth.uid()));
create policy vehicle_documents_update on public.vehicle_documents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy vehicle_documents_delete on public.vehicle_documents for delete to authenticated using (user_id = (select auth.uid()));

-- Plan interest now matches the V2 plans.
alter table public.pro_interest drop constraint pro_interest_plan_check;
update public.pro_interest set plan = case plan when 'monthly' then 'pro_monthly' when 'yearly' then 'pro_yearly' else plan end;
alter table public.pro_interest add constraint pro_interest_plan_check
  check (plan in ('tour_pass','pro_monthly','pro_yearly','club_pro'));

-- Community is also "coming soon" with a waitlist.
alter table public.waitlist drop constraint waitlist_topic_check;
alter table public.waitlist add constraint waitlist_topic_check check (topic in ('marketplace','community'));
