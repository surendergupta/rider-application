import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/db/server";
import { tripCreateSchema } from "@/lib/validation/trip";

async function createTrip(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const parsed = tripCreateSchema.safeParse({
    bike_id: formData.get("bike_id"),
    title: formData.get("title"),
    origin_label: formData.get("origin_label"),
    destination_label: formData.get("destination_label"),
    travel_date: formData.get("travel_date") || null,
    trip_days: formData.get("trip_days") ? Number(formData.get("trip_days")) : null,
    terrain: formData.get("terrain") || null,
    season: formData.get("season") || null,
  });
  if (!parsed.success) redirect("/trips?error=invalid");

  const { data, error } = await supabase
    .from("trips")
    .insert({ ...parsed.data, user_id: auth.user.id })
    .select("id")
    .single();
  if (error || !data) redirect("/trips?error=failed");
  redirect(`/trips/${data.id}`);
}

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ error?: string; show?: string }> }) {
  if (!supabaseConfigured()) redirect("/login");
  const { error, show } = await searchParams;
  const archived = show === "archived";
  const supabase = await createClient();
  const base = supabase.from("trips").select("id, title, origin_label, destination_label, status, travel_date");
  const [{ data: trips }, { data: bikes }] = await Promise.all([
    (archived ? base.eq("status", "archived") : base.neq("status", "archived"))
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("bikes").select("id, display_name").eq("is_archived", false),
  ]);

  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{archived ? "Archived trips" : "Your trips"}</h1>
        <Link href={archived ? "/trips" : "/trips?show=archived"} className="tap text-sm underline">
          {archived ? "Back to active" : "Show archived"}
        </Link>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">Could not create the trip. Check the details.</p>}

      <ul className="mt-6 space-y-3">
        {trips?.length === 0 && <li className="text-muted">{archived ? "No archived trips." : "No trips yet."}</li>}
        {trips?.map((t) => (
          <li key={t.id}>
            <Link href={`/trips/${t.id}`} className="block rounded border border-line p-3 hover:bg-sunken">
              <div className="font-medium">{t.title}</div>
              <div className="text-sm text-muted">
                {t.origin_label} → {t.destination_label} · {t.status}
                {t.travel_date && ` · ${t.travel_date}`}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-semibold">Plan a trip</h2>
      {bikes?.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Add a bike first on the <Link href="/bikes" className="underline">Bikes</Link> page.</p>
      ) : (
        <form action={createTrip} className="mt-3 space-y-3">
          <label className="block text-sm">Bike
            <select name="bike_id" required className={input}>
              {bikes?.map((b) => <option key={b.id} value={b.id}>{b.display_name}</option>)}
            </select>
          </label>
          <label className="block text-sm">Trip name
            <input name="title" required maxLength={160} className={input} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">From
              <input name="origin_label" required maxLength={250} className={input} />
            </label>
            <label className="block text-sm">To
              <input name="destination_label" required maxLength={250} className={input} />
            </label>
          </div>
          <label className="block text-sm">Travel date (optional)
            <input name="travel_date" type="date" className={input} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">Days
              <input name="trip_days" type="number" min="1" max="60" className={input} />
            </label>
            <label className="block text-sm">Terrain
              <select name="terrain" defaultValue="" className={input}>
                <option value="">Not sure</option><option value="plains">Plains</option><option value="hills">Hills</option>
                <option value="mountains">Mountains</option><option value="desert">Desert</option>
              </select>
            </label>
            <label className="block text-sm">Season
              <select name="season" defaultValue="" className={input}>
                <option value="">Not sure</option><option value="summer">Summer</option><option value="monsoon">Monsoon</option><option value="winter">Winter</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">Used to suggest the right gear checklist for your ride.</p>
          <button className="rounded-lg bg-saffron px-5 py-2.5 font-semibold text-ink transition hover:bg-saffron-dark">Create trip</button>
        </form>
      )}
    </main>
  );
}
