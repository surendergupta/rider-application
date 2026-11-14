-- Fix: a host must be able to read back the ride they just inserted (INSERT ... RETURNING).
-- The previous policy looked the ride up through a helper function, which runs on a snapshot taken before the
-- insert and therefore cannot see the new row. Checking host_id on the row itself needs no lookup.
drop policy rides_select on public.rides;
create policy rides_select on public.rides for select to authenticated
  using (host_id = (select auth.uid()) or public.ride_visible(id, (select auth.uid())));
