-- Fix for 0013: in mod_queue() the output column names (note, status, ...) clashed with column names inside the query.
-- '#variable_conflict use_column' makes a bare name mean the table column.
create or replace function public.mod_queue(p_scope text default 'open', p_limit integer default 50)
returns table (kind text, target_id uuid, report_id uuid, report_count integer, reasons text[], note text, status text,
               first_reported_at timestamptz, summary text, target_state text, owner_id uuid, owner_restricted boolean)
language plpgsql stable security definer set search_path = public as $fn$
#variable_conflict use_column
declare v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  perform public.mod_require();
  if p_scope not in ('open','closed') then raise exception 'bad_scope' using errcode = 'P0001'; end if;
  return query
  with r as (
    select 'post'::text k, post_id t, id, reason, note n, status s, created_at c from public.post_reports
    union all select 'ride', ride_id, id, reason, note, status, created_at from public.ride_reports
    union all select 'club', club_id, id, reason, note, status, created_at from public.club_reports
    union all select 'profile', profile_user_id, id, reason, note, status, created_at from public.profile_reports
  ), f as (
    select * from r where (p_scope = 'open' and s in ('open','under_review')) or (p_scope = 'closed' and s in ('actioned','dismissed'))
  ), g as (
    select k, t,
           (array_agg(id order by c))[1] rid,
           count(*)::int cnt,
           array_agg(distinct reason order by reason) rs,
           (array_agg(n order by c) filter (where n is not null))[1] nt,
           case when bool_or(s = 'under_review') then 'under_review' else min(s) end st,
           min(c) first_c
    from f group by k, t
  )
  select g.k, g.t, g.rid, g.cnt, g.rs, g.nt, g.st, g.first_c,
         case g.k
           when 'post'    then (select coalesce(nullif(left(p.body, 200), ''), p.trip_title) from public.posts p where p.id = g.t)
           when 'ride'    then (select x.title from public.rides x where x.id = g.t)
           when 'club'    then (select x.name from public.clubs x where x.id = g.t)
           when 'profile' then (select x.display_name || ' (@' || x.handle || ')' from public.rider_profiles x where x.user_id = g.t)
         end,
         case g.k
           when 'post'    then (select p.status from public.posts p where p.id = g.t)
           when 'ride'    then (select x.status from public.rides x where x.id = g.t)
           when 'club'    then (select x.status from public.clubs x where x.id = g.t)
           when 'profile' then (select case when x.is_public then 'public' else 'private' end from public.rider_profiles x where x.user_id = g.t)
         end,
         public.mod_target_owner(g.k, g.t),
         public.is_restricted(public.mod_target_owner(g.k, g.t))
  from g
  order by case when p_scope = 'open' then extract(epoch from g.first_c) else -extract(epoch from g.first_c) end
  limit v_limit;
end $fn$;
