import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/db/admin";
import { costPerKmPaise, formatInr } from "@/lib/money/estimate";

// Shared pages must not be indexed or cached: the owner can turn the link off at any time.
export const metadata: Metadata = {
  title: "Trip summary · India Long-Ride Planner",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function SharedTrip({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();

  // Service role bypasses RLS, so we select ONLY the fields that are safe to show publicly.
  const admin = createAdminClient();
  const { data: trip } = await admin
    .from("trips")
    .select("id, title, origin_label, destination_label, status")
    .eq("share_token", token)
    .neq("status", "archived")
    .maybeSingle();
  if (!trip) notFound();

  const [{ data: est }, { data: spent }] = await Promise.all([
    admin.from("trip_estimates").select("distance_km, total_paise, fuel_litres").eq("trip_id", trip.id).order("revision", { ascending: false }).limit(1),
    admin.from("expenses").select("amount_paise").eq("trip_id", trip.id),
  ]);
  const distanceKm = est?.[0] ? Number(est[0].distance_km) : 0;
  const total = (spent ?? []).reduce((s, e) => s + Number(e.amount_paise), 0);
  const perKm = costPerKmPaise(total, distanceKm);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-road px-4 py-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-saffron/25 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl bg-surface p-7 text-fg shadow-2xl shadow-black/40">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Ride summary</p>
          <h1 className="mt-1 text-2xl font-extrabold">{trip.title}</h1>
          <p className="mt-1 text-muted">{trip.origin_label} → {trip.destination_label}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-muted">Distance</dt><dd className="text-xl font-bold">{distanceKm ? `${distanceKm} km` : "—"}</dd></div>
            <div><dt className="text-xs text-muted">Total spent</dt><dd className="text-xl font-bold">{formatInr(total)}</dd></div>
            <div><dt className="text-xs text-muted">Cost per km</dt><dd className="text-xl font-bold">{perKm == null ? "N/A" : formatInr(perKm)}</dd></div>
            <div><dt className="text-xs text-muted">Status</dt><dd className="text-xl font-bold capitalize">{trip.status}</dd></div>
          </dl>
        </div>
        <Link href="/signup" className="mt-6 block rounded-full bg-saffron py-3 text-center font-semibold text-ink transition hover:bg-saffron-dark">
          Plan your own ride, free
        </Link>
        <p className="mt-3 text-center text-xs text-white/50">Figures are entered by the rider and are not verified.</p>
      </div>
    </main>
  );
}
