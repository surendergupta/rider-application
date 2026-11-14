import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { RideCardView } from "@/components/RideCard";
import { Avatar } from "@/components/ProfileCard";
import { decideRequest, listDiscoverRides, myRidesDashboard, respondToInvite } from "@/features/rides/service";
import { rideFilterSchema } from "@/features/rides/validation";

export const metadata = { title: "Rides · India Long-Ride Planner" };

async function respondAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  if (!rateLimit(`ride-act:${user.id}`, 60, 60_000).allowed) redirect("/rides?notice=rate");
  const r = await respondToInvite(supabase, String(formData.get("ride_id")), formData.get("accept") === "yes");
  revalidatePath("/rides");
  redirect(`/rides?notice=${r.ok ? (r.status === "going" ? "joined" : "declined") : r.code}`);
}

async function decideAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  if (!rateLimit(`ride-act:${user.id}`, 60, 60_000).allowed) redirect("/rides?notice=rate");
  const r = await decideRequest(supabase, String(formData.get("ride_id")), String(formData.get("handle")), formData.get("approve") === "yes");
  revalidatePath("/rides");
  redirect(`/rides?notice=${r.ok ? (r.status === "going" ? "approved" : "declined") : r.code}`);
}

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  joined: { text: "You are going. Check the ride for the meeting point.", ok: true },
  declined: { text: "Done.", ok: true },
  approved: { text: "Rider approved. They can now see the meeting point.", ok: true },
  ride_full: { text: "This ride is full.", ok: false },
  ride_closed: { text: "This ride is no longer open.", ok: false },
  not_found: { text: "That ride or rider could not be found.", ok: false },
  rate: { text: "Too many requests. Try again in a little while.", ok: false },
  cancelled: { text: "Ride cancelled. Riders can still see that it was cancelled.", ok: true },
};

export default async function RidesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, user } = await requireSession();
  const sp = await searchParams;
  const filters = rideFilterSchema.parse({ area: sp.area ?? "", when: sp.when, open: sp.open ?? "" });
  const [dash, discover, { data: profile }] = await Promise.all([
    myRidesDashboard(supabase, user.id),
    listDiscoverRides(supabase, user.id, filters),
    supabase.from("rider_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const empty = dash.hosting.length + dash.going.length + dash.pending.length + dash.invitations.length === 0;

  return (
    <main className="px-5 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rides</h1>
          <p className="mt-1 text-sm text-muted">Group rides with other riders. Meet in a public place and ride within your ability.</p>
        </div>
        <Link href={profile ? "/rides/new" : "/profile"} className="tap shrink-0 rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">
          Host a ride
        </Link>
      </div>
      {!profile && (
        <p className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">
          Create a <Link href="/profile" className="font-semibold underline">rider profile</Link> to host or join rides. Other riders see your name and handle on the ride. The profile can stay private.
        </p>
      )}
      {notice && <p role="status" className={`mt-4 rounded-lg p-3 text-sm ${notice.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{notice.text}</p>}

      {dash.invitations.length > 0 && (
        <section className="mt-8" aria-labelledby="inv">
          <h2 id="inv" className="text-lg font-semibold">Invitations ({dash.invitations.length})</h2>
          <ul className="mt-3 space-y-3">
            {dash.invitations.map((r) => (
              <li key={r.id} className="rounded-xl border border-saffron/50 p-4">
                <Link href={`/rides/${r.id}`} className="tap font-semibold underline">{r.title}</Link>
                <p className="text-sm text-muted">{r.area} · {r.going} of {r.maxRiders} riders{r.host ? ` · from ${r.host.displayName}` : ""}</p>
                <form action={respondAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="ride_id" value={r.id} />
                  <button name="accept" value="yes" className="rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Accept</button>
                  <button name="accept" value="no" className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Decline</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dash.requests.length > 0 && (
        <section className="mt-8" aria-labelledby="req">
          <h2 id="req" className="text-lg font-semibold">Requests to review ({dash.requests.length})</h2>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {dash.requests.map((q) => (
              <li key={`${q.rideId}-${q.person.handle}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar initials={q.person.initials} color={q.person.avatarColor} size={36} />
                  <span className="min-w-0 text-sm"><strong className="block truncate">{q.person.displayName}</strong><span className="text-muted">@{q.person.handle} · {q.rideTitle}</span></span>
                </span>
                <form action={decideAction} className="flex gap-2">
                  <input type="hidden" name="ride_id" value={q.rideId} /><input type="hidden" name="handle" value={q.person.handle} />
                  <button name="approve" value="yes" aria-label={`Approve ${q.person.displayName}`} className="rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Approve</button>
                  <button name="approve" value="no" aria-label={`Decline ${q.person.displayName}`} className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Decline</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {[["Rides you are hosting", dash.hosting], ["Rides you are going on", dash.going], ["Requests you sent", dash.pending]].map(([title, list]) => {
        const rides = list as typeof dash.hosting;
        return rides.length > 0 && (
          <section key={title as string} className="mt-8">
            <h2 className="text-lg font-semibold">{title as string}</h2>
            <ul className="mt-3 space-y-3">{rides.map((r) => <RideCardView key={r.id} ride={r} />)}</ul>
          </section>
        );
      })}
      {empty && dash.requests.length === 0 && <p className="mt-8 rounded-lg bg-sunken p-4 text-sm text-muted">You have no upcoming rides yet. Find one below, or host your own.</p>}

      <section className="mt-10" aria-labelledby="find">
        <h2 id="find" className="text-lg font-semibold">Find rides</h2>
        <form method="get" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
          <label className="col-span-2 block text-sm">City or area
            <input name="area" defaultValue={filters.area} maxLength={60} placeholder="For example Delhi" className={input} />
          </label>
          <label className="block text-sm">When
            <select name="when" defaultValue={filters.when} className={input}>
              <option value="all">Any time</option><option value="week">Next 7 days</option><option value="month">Next month</option>
            </select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="open" value="1" defaultChecked={filters.open === "1"} className="h-4 w-4 accent-[var(--accent)]" /> Only rides with space
          </label>
          <button className="col-span-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Search rides</button>
        </form>
        {discover.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No upcoming public rides match. Try a wider search, or host one.</p>
        ) : (
          <ul className="mt-4 space-y-3">{discover.map((r) => <RideCardView key={r.id} ride={r} />)}</ul>
        )}
        <p className="mt-6 text-sm"><Link href="/riders" className="tap font-semibold text-link underline">Find riders</Link> to invite on your rides, or join a <Link href="/clubs" className="tap font-semibold text-link underline">riding club</Link>.</p>
      </section>
    </main>
  );
}
