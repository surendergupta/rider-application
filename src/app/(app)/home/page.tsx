import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/db/server";
import { serviceDue } from "@/features/maintenance/due";
import { attentionCounts } from "@/features/rides/service";
import { clubAttentionCounts } from "@/features/clubs/service";
import { DOC_LABEL, describeStatus, documentStatus, todayInIndia, type DocType } from "@/features/garage/documents";

export const metadata = { title: "Home · India Long-Ride Planner" };

interface Alert {
  key: string;
  level: "urgent" | "soon";
  text: string;
  detail: string;
  href: string;
}

export default async function HomePage() {
  if (!supabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const today = todayInIndia();

  const { data: auth } = await supabase.auth.getUser();
  const rideCounts = auth.user ? await attentionCounts(supabase, auth.user.id) : { invitations: 0, requests: 0 };
  const clubCounts = auth.user ? await clubAttentionCounts(supabase, auth.user.id) : { invitations: 0, requests: 0 };
  const [{ data: bikes }, { data: schedules }, { data: docs }, { data: trips }] = await Promise.all([
    supabase.from("bikes").select("id, display_name, odometer_km").eq("is_archived", false).order("created_at"),
    supabase.from("service_schedules").select("bike_id, service_type, interval_km, last_service_km").eq("enabled", true),
    supabase.from("vehicle_documents").select("bike_id, doc_type, expires_on"),
    supabase.from("trips").select("id, title, origin_label, destination_label, status, travel_date")
      .neq("status", "archived").neq("status", "completed").order("created_at", { ascending: false }).limit(3),
  ]);

  const alerts: Alert[] = [];
  for (const b of bikes ?? []) {
    for (const s of (schedules ?? []).filter((x) => x.bike_id === b.id)) {
      const d = serviceDue(b.odometer_km, s.last_service_km, s.interval_km);
      if (d.state === "overdue" || d.state === "due_soon") {
        alerts.push({
          key: `s-${b.id}-${s.service_type}`,
          level: d.state === "overdue" ? "urgent" : "soon",
          text: `${b.display_name}: ${s.service_type} service ${d.state === "overdue" ? "overdue" : "due soon"}`,
          detail: d.remainingKm != null && d.remainingKm > 0 ? `${d.remainingKm} km left` : `${-(d.remainingKm ?? 0)} km over`,
          href: `/bikes/${b.id}`,
        });
      }
    }
    for (const d of (docs ?? []).filter((x) => x.bike_id === b.id)) {
      const st = documentStatus(d.expires_on, today);
      if (st.state !== "ok") {
        alerts.push({
          key: `d-${b.id}-${d.doc_type}`,
          level: st.state === "expired" ? "urgent" : "soon",
          text: `${b.display_name}: ${DOC_LABEL[d.doc_type as DocType]} ${st.state === "expired" ? "expired" : "expiring"}`,
          detail: describeStatus(st),
          href: `/bikes/${b.id}`,
        });
      }
    }
  }
  if (rideCounts.invitations > 0) {
    alerts.push({ key: "ride-invites", level: "soon", text: `You have ${rideCounts.invitations} ride invitation${rideCounts.invitations === 1 ? "" : "s"}`, detail: "Respond", href: "/rides" });
  }
  if (rideCounts.requests > 0) {
    alerts.push({ key: "ride-requests", level: "soon", text: `${rideCounts.requests} rider${rideCounts.requests === 1 ? "" : "s"} want${rideCounts.requests === 1 ? "s" : ""} to join your rides`, detail: "Review", href: "/rides" });
  }
  if (clubCounts.invitations > 0) {
    alerts.push({ key: "club-invites", level: "soon", text: `You have ${clubCounts.invitations} club invitation${clubCounts.invitations === 1 ? "" : "s"}`, detail: "Respond", href: "/clubs" });
  }
  if (clubCounts.requests > 0) {
    alerts.push({ key: "club-requests", level: "soon", text: `${clubCounts.requests} rider${clubCounts.requests === 1 ? "" : "s"} want${clubCounts.requests === 1 ? "s" : ""} to join your clubs`, detail: "Review", href: "/clubs" });
  }
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === "urgent" ? -1 : 1));
  const nextTrip = trips?.[0];

  return (
    <main className="px-5 py-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Your riding space</p>
      <h1 className="mt-1 text-2xl font-bold">Ready for your next ride?</h1>

      <section className="mt-6 rounded-2xl bg-road p-5 text-white">
        {nextTrip ? (
          <>
            <p className="text-xs text-white/60">Your next trip</p>
            <p className="mt-1 text-lg font-bold">{nextTrip.title}</p>
            <p className="text-sm text-white/70">{nextTrip.origin_label} → {nextTrip.destination_label} · {nextTrip.status}</p>
            <Link href={`/trips/${nextTrip.id}`} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-saffron px-5 text-sm font-semibold text-ink hover:bg-saffron-dark">
              Open trip
            </Link>
          </>
        ) : (
          <>
            <p className="font-semibold">Your next trip starts here</p>
            <p className="mt-1 text-sm text-white/70">Set a budget, check your fuel stops and get a checklist for the ride.</p>
            <Link href="/trips" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-saffron px-5 text-sm font-semibold text-ink hover:bg-saffron-dark">
              Plan a ride
            </Link>
          </>
        )}
      </section>

      <section className="mt-8" aria-labelledby="attention">
        <h2 id="attention" className="text-lg font-semibold">Needs attention</h2>
        {alerts.length === 0 && (!bikes || bikes.length === 0) ? (
          <p className="mt-2 text-sm text-muted">
            Add your motorcycle to your <Link href="/bikes" className="underline">garage</Link> to get service and document reminders.
          </p>
        ) : alerts.length === 0 ? (
          <p className="mt-2 rounded-lg bg-success-bg p-3 text-sm text-success-fg" data-testid="all-clear">
            All clear. No service, document or ride reminders right now.
          </p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="alerts">
            {alerts.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm hover:bg-sunken">
                  <span className="font-medium">{a.text}</span>
                  <span className={`shrink-0 rounded px-2 py-1 text-xs ${a.level === "urgent" ? "bg-danger-bg text-danger-fg" : "bg-warn-bg text-warn-fg"}`}>{a.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/profile" className="mt-8 flex min-h-11 items-center justify-between rounded-xl border border-line p-4 hover:bg-sunken">
        <span><span className="block font-semibold">Rider profile</span><span className="block text-xs text-muted">Optional public profile. Private until you turn it on.</span></span>
        <span aria-hidden="true">→</span>
      </Link>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <Link href="/bikes" className="rounded-xl border border-line p-4 hover:bg-sunken">
          <p className="font-semibold">Garage</p><p className="mt-1 text-xs text-muted">Service status and documents</p>
        </Link>
        <Link href="/trips" className="rounded-xl border border-line p-4 hover:bg-sunken">
          <p className="font-semibold">Trips</p><p className="mt-1 text-xs text-muted">Budgets, expenses, checklists</p>
        </Link>
        <Link href="/rides" className="rounded-xl border border-line p-4 hover:bg-sunken">
          <p className="font-semibold">Rides</p><p className="mt-1 text-xs text-muted">Group rides and finding riders</p>
        </Link>
        <Link href="/marketplace" className="rounded-xl border border-dashed border-line-strong p-4 hover:bg-sunken">
          <p className="font-semibold">Gear market <span className="ml-1 rounded-full bg-saffron px-2 py-0.5 text-[10px] font-bold text-ink">Soon</span></p>
          <p className="mt-1 text-xs text-muted">Pre-owned touring gear</p>
        </Link>
      </section>
    </main>
  );
}
