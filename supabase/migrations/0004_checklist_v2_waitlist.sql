-- Checklist v2: per-item status, five categories, trip profile for personalised suggestions; waitlist.

-- Trip profile (all optional) drives which checklist items are suggested.
alter table public.trips
  add column trip_days integer check (trip_days between 1 and 60),
  add column terrain text check (terrain in ('plains','hills','mountains','desert')),
  add column season text check (season in ('summer','monsoon','winter'));

-- Categories: documents, safety, motorcycle, touring, essentials.
alter table public.trip_checklist_items drop constraint trip_checklist_items_category_check;
update public.trip_checklist_items set category = case category
  when 'gear' then 'safety' when 'bike' then 'motorcycle' when 'tools' then 'touring' when 'personal' then 'essentials'
  else category end;
alter table public.trip_checklist_items
  add constraint trip_checklist_items_category_check
  check (category in ('documents','safety','motorcycle','touring','essentials'));

-- Status replaces the done flag: needed -> owned -> packed, or not_applicable.
alter table public.trip_checklist_items
  add column status text not null default 'needed'
  check (status in ('needed','owned','packed','not_applicable'));
update public.trip_checklist_items set status = 'packed' where done;
alter table public.trip_checklist_items drop column done;

-- Interest in upcoming features. One row per user per topic; no payment or contact data beyond the account.
create table public.waitlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (topic in ('marketplace')),
  created_at timestamptz not null default now(),
  primary key (user_id, topic)
);
alter table public.waitlist enable row level security;
create policy waitlist_select on public.waitlist for select to authenticated using (user_id = (select auth.uid()));
create policy waitlist_insert on public.waitlist for insert to authenticated with check (user_id = (select auth.uid()));
create policy waitlist_delete on public.waitlist for delete to authenticated using (user_id = (select auth.uid()));
