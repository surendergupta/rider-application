import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/db/server";
import { computeEstimate, costPerKmPaise, formatInr } from "@/lib/money/estimate";
import { rupeesToPaise } from "@/lib/money/parse";
import { canTransition, type TripStatus } from "@/features/trips/lifecycle";
import { expenseSchema } from "@/lib/validation/trip";
import { fuelPlan } from "@/features/trips/fuel-plan";
import { MAX_WAYPOINTS, STOP_LABEL, compareWithBudget, mapsHandoffUrl, summarizeItinerary, type Stop, type StopType } from "@/features/trips/itinerary";
import { realMileage } from "@/features/bikes/mileage";
import {
  CATEGORY_LABEL, CATEGORY_ORDER, STATUS_LABEL, buildChecklist, checklistProgress, gearStillNeeded,
  type ChecklistStatus, type Season, type Terrain,
} from "@/features/trips/checklist";

const CATEGORIES = ["fuel", "toll", "food", "stay", "maintenance", "parking", "other"] as const;

async function saveEstimate(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const back = `/trips/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const distance = Number(formData.get("distance_km"));
  const mileage = Number(formData.get("mileage_kmpl"));
  const price = rupeesToPaise(formData.get("fuel_price"));
  const amounts = ["toll", "food", "stay", "other"].map((k) =>
    formData.get(k) === "" ? 0 : rupeesToPaise(formData.get(k)),
  );
  if (!z.uuid().safeParse(id).success || !(distance > 0) || !(mileage > 0) || price == null || amounts.includes(null)) {
    redirect(`${back}?error=estimate`);
  }
  const [toll, food, stay, other] = amounts as number[];
  const est = computeEstimate({
    distanceKm: distance, plannedMileageKmPerLitre: mileage, petrolPricePaisePerLitre: price,
    tollPaise: toll, foodPaise: food, stayPaise: stay, otherPaise: other,
  });
  const { error } = await supabase.rpc("create_trip_estimate", {
    p_trip_id: id, p_distance_km: distance, p_mileage_kmpl: mileage, p_fuel_price: price,
    p_fuel_litres: est.fuelLitres, p_fuel_paise: est.fuelPaise,
    p_toll: toll, p_food: food, p_stay: stay, p_other: other,
    p_input_sources: { fuel: "user", distance: "manual" },
  });
  if (error) redirect(`${back}?error=estimate`);
  revalidatePath(back);
}

async function addExpense(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const back = `/trips/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const category = String(formData.get("category"));
  const litres = formData.get("fuel_litres");
  const parsed = expenseSchema.safeParse({
    category,
    amount_paise: rupeesToPaise(formData.get("amount")),
    notes: String(formData.get("notes") ?? "") || null,
    fuel_litres: category === "fuel" && litres ? Number(litres) : null,
    odometer_km: formData.get("odometer_km") ? Number(formData.get("odometer_km")) : null,
    // the form carries a request id generated at render, so a double submit is idempotent
    client_request_id: formData.get("client_request_id"),
  });
  if (!parsed.success) redirect(`${back}?error=expense`);

  const { error } = await supabase
    .from("expenses")
    .insert({ ...parsed.data, trip_id: id, user_id: auth.user.id });
  // 23505 = same client_request_id already saved: treat as success
  if (error && error.code !== "23505") redirect(`${back}?error=expense`);
  revalidatePath(back);
}

async function changeStatus(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const to = String(formData.get("to")) as TripStatus;
  const supabase = await createClient();
  const { data: trip } = await supabase.from("trips").select("status").eq("id", id).maybeSingle();
  if (!trip || !canTransition(trip.status as TripStatus, to)) redirect(`/trips/${id}?error=status`);
  const { error } = await supabase.from("trips").update({ status: to }).eq("id", id);
  if (error) redirect(`/trips/${id}?error=status`);
  revalidatePath(`/trips/${id}`);
}

async function deleteExpense(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const expenseId = String(formData.get("expense_id"));
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(expenseId).success) redirect(`/trips/${id}?error=expense`);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  // RLS limits this to the owner's rows; trip_id in the filter keeps it scoped to this trip.
  await supabase.from("expenses").delete().eq("id", expenseId).eq("trip_id", id);
  revalidatePath(`/trips/${id}`);
}

async function saveProfile(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  if (!z.uuid().safeParse(id).success) redirect("/trips");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const parsed = z.object({
    trip_days: z.number().int().min(1).max(60).nullable(),
    terrain: z.enum(["plains", "hills", "mountains", "desert"]).nullable(),
    season: z.enum(["summer", "monsoon", "winter"]).nullable(),
  }).safeParse({
    trip_days: formData.get("trip_days") ? Number(formData.get("trip_days")) : null,
    terrain: formData.get("terrain") || null,
    season: formData.get("season") || null,
  });
  if (!parsed.success) redirect(`/trips/${id}?error=profile`);
  await supabase.from("trips").update(parsed.data).eq("id", id);
  revalidatePath(`/trips/${id}`);
}

/** Creates the suggested checklist, or adds items newly suggested after the trip profile changed. Existing items and statuses are kept. */
async function addStop(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const back = `/trips/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const parsed = z.object({
    day_number: z.number().int().min(1).max(60),
    place: z.string().trim().min(1).max(200),
    stop_type: z.enum(["ride", "fuel", "food", "stay", "sight", "other"]),
    leg_km: z.number().min(0).max(3000).nullable(),
    note: z.string().trim().max(300).nullable(),
  }).safeParse({
    day_number: Number(formData.get("day_number")),
    place: formData.get("place"),
    stop_type: formData.get("stop_type"),
    leg_km: formData.get("leg_km") ? Number(formData.get("leg_km")) : null,
    note: String(formData.get("note") ?? "") || null,
  });
  if (!z.uuid().safeParse(id).success || !parsed.success) redirect(`${back}?error=stop`);
  // Append to the end of that day.
  const { data: last } = await supabase.from("trip_stops").select("sort_order")
    .eq("trip_id", id).eq("day_number", parsed.data.day_number).order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase.from("trip_stops").insert({
    ...parsed.data, trip_id: id, user_id: auth.user.id, sort_order: (last?.[0]?.sort_order ?? -1) + 1,
  });
  if (error) redirect(`${back}?error=stop`);
  revalidatePath(back);
}

async function deleteStop(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const stopId = String(formData.get("stop_id"));
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(stopId).success) redirect("/trips");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await supabase.from("trip_stops").delete().eq("id", stopId).eq("trip_id", id);
  revalidatePath(`/trips/${id}`);
}

async function addChecklist(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  if (!z.uuid().safeParse(id).success) redirect("/trips");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: t } = await supabase.from("trips").select("trip_days, terrain, season").eq("id", id).maybeSingle();
  if (!t) redirect("/trips");
  const items = buildChecklist({ days: t.trip_days, terrain: t.terrain as Terrain | null, season: t.season as Season | null });
  // Unique (trip_id, label): pressing twice cannot duplicate, and existing statuses are never overwritten.
  await supabase.from("trip_checklist_items").upsert(
    items.map((it) => ({ user_id: auth.user.id, trip_id: id, category: it.category, label: it.label, sort_order: it.sortOrder })),
    { onConflict: "trip_id,label", ignoreDuplicates: true },
  );
  revalidatePath(`/trips/${id}`);
}

async function setChecklistStatus(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  const itemId = String(formData.get("item_id"));
  const status = z.enum(["needed", "owned", "packed", "not_applicable"]).safeParse(formData.get("status"));
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(itemId).success || !status.success) redirect("/trips");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await supabase.from("trip_checklist_items").update({ status: status.data }).eq("id", itemId).eq("trip_id", id);
  revalidatePath(`/trips/${id}`);
}

async function setSharing(formData: FormData) {
  "use server";
  const id = String(formData.get("trip_id"));
  if (!z.uuid().safeParse(id).success) redirect("/trips");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const on = formData.get("share") === "on";
  await supabase.from("trips").update({ share_token: on ? crypto.randomUUID() : null }).eq("id", id);
  revalidatePath(`/trips/${id}`);
}

const ERRORS: Record<string, string> = {
  estimate: "Could not save the budget. Check distance, mileage and amounts.",
  expense: "Could not save the expense. Enter an amount greater than zero.",
  status: "That status change is not allowed.",
  profile: "Could not save the ride details. Days must be 1 to 60.",
  stop: "Could not save the stop. Give it a place name and a day from 1 to 60.",
};

export default async function TripPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: trip } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
  if (!trip) notFound();

  const [{ data: estimates }, { data: expenses }, { data: bike }, { data: checklist }, { data: bikeTrips }] = await Promise.all([
    supabase.from("trip_estimates").select("*").eq("trip_id", id).order("revision", { ascending: false }).limit(1),
    supabase.from("expenses").select("*").eq("trip_id", id).order("spent_at", { ascending: false }).limit(500),
    supabase.from("bikes").select("mileage_kmpl, tank_litres").eq("id", trip.bike_id).maybeSingle(),
    supabase.from("trip_checklist_items").select("*").eq("trip_id", id).order("sort_order"),
    supabase.from("trips").select("id").eq("bike_id", trip.bike_id),
  ]);
  // Real mileage uses every fuel fill (with odometer) on this bike, across all its trips.
  const { data: fills } = await supabase
    .from("expenses")
    .select("odometer_km, fuel_litres")
    .eq("category", "fuel")
    .in("trip_id", (bikeTrips ?? []).map((t) => t.id))
    .not("odometer_km", "is", null)
    .not("fuel_litres", "is", null);
  const real = realMileage((fills ?? []).map((f) => ({ odometerKm: Number(f.odometer_km), litres: Number(f.fuel_litres) })));
  const { data: stopRows } = await supabase.from("trip_stops").select("*").eq("trip_id", id).order("day_number").order("sort_order");
  const stops: Stop[] = (stopRows ?? []).map((r) => ({
    id: r.id, day: r.day_number, sortOrder: r.sort_order, place: r.place,
    type: r.stop_type as StopType, legKm: r.leg_km == null ? null : Number(r.leg_km), note: r.note,
  }));
  const itinerary = summarizeItinerary(stops);
  const estimate = estimates?.[0];
  const actual = (expenses ?? []).reduce((s, e) => s + Number(e.amount_paise), 0);
  const variance = estimate ? actual - Number(estimate.total_paise) : null;
  const distanceKm = estimate ? Number(estimate.distance_km) : trip.route_distance_m ? trip.route_distance_m / 1000 : 0;
  const status = trip.status as TripStatus;
  const next = (["active", "completed", "archived"] as TripStatus[]).filter((s) => canTransition(status, s));
  const requestId = crypto.randomUUID();
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Link href="/trips" className="tap text-sm underline">← Trips</Link>
      <h1 className="mt-3 text-2xl font-bold">{trip.title}</h1>
      <p className="text-sm text-muted">{trip.origin_label} → {trip.destination_label} · {status}</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{ERRORS[error] ?? "Something went wrong."}</p>}

      <div className="mt-4 flex gap-2">
        {next.map((s) => (
          <form key={s} action={changeStatus}>
            <input type="hidden" name="trip_id" value={id} />
            <input type="hidden" name="to" value={s} />
            <button className="rounded border border-line-strong px-3 py-1 text-sm">Mark {s}</button>
          </form>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Budget (estimate)</h2>
        {estimate ? (
          <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <dt>Distance</dt><dd>{Number(estimate.distance_km)} km (revision {estimate.revision})</dd>
            <dt>Fuel</dt><dd>{Number(estimate.fuel_litres)} l · {formatInr(Number(estimate.fuel_paise))}</dd>
            <dt>Toll / Food / Stay / Other</dt>
            <dd>{[estimate.toll_paise, estimate.food_paise, estimate.stay_paise, estimate.other_paise].map((p) => formatInr(Number(p))).join(" / ")}</dd>
            <dt className="font-medium">Estimated total</dt><dd className="font-medium">{formatInr(Number(estimate.total_paise))}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">No budget yet. Enter your numbers below.</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Estimates use the distance, mileage and prices you enter. Verify route, tolls and fuel prices yourself before you ride.
        </p>
        <form action={saveEstimate} className="mt-3 space-y-3">
          <input type="hidden" name="trip_id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Distance (km)
              <input name="distance_km" type="number" step="0.1" min="0.1" required defaultValue={distanceKm || ""} className={input} />
            </label>
            <label className="block text-sm">Mileage (km/l)
              <input name="mileage_kmpl" type="number" step="0.01" min="0.01" required defaultValue={estimate ? Number(estimate.mileage_kmpl) : real?.kmPerLitre ?? bike?.mileage_kmpl ?? ""} className={input} />
            </label>
            <label className="block text-sm">Petrol price (₹/l)
              <input name="fuel_price" inputMode="decimal" required defaultValue={estimate ? Number(estimate.fuel_price_paise_per_litre) / 100 : ""} className={input} />
            </label>
            <label className="block text-sm">Toll (₹)
              <input name="toll" inputMode="decimal" defaultValue={estimate ? Number(estimate.toll_paise) / 100 : ""} className={input} />
            </label>
            <label className="block text-sm">Food (₹)
              <input name="food" inputMode="decimal" defaultValue={estimate ? Number(estimate.food_paise) / 100 : ""} className={input} />
            </label>
            <label className="block text-sm">Stay (₹)
              <input name="stay" inputMode="decimal" defaultValue={estimate ? Number(estimate.stay_paise) / 100 : ""} className={input} />
            </label>
            <label className="block text-sm">Other (₹)
              <input name="other" inputMode="decimal" defaultValue={estimate ? Number(estimate.other_paise) / 100 : ""} className={input} />
            </label>
          </div>
          <button className="rounded-lg bg-saffron px-5 py-2.5 font-semibold text-ink transition hover:bg-saffron-dark">{estimate ? "Save new revision" : "Save budget"}</button>
        </form>
        {real ? (
          <p className="mt-3 rounded-lg bg-success-bg p-3 text-sm text-success-fg">
            <strong>Your real mileage: {real.kmPerLitre} km/l</strong> from {real.fills} fuel fills over {Math.round(real.distanceKm)} km
            {bike?.mileage_kmpl != null && Number(bike.mileage_kmpl) !== real.kmPerLitre && <> (you set {Number(bike.mileage_kmpl)} km/l for this bike)</>}.
            {!estimate && " The form above starts from it."} Assumes you fill the tank each time.
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted">
            Log fuel fills with litres and odometer and we will work out your real mileage, so budgets stop being guesses.
          </p>
        )}
      </section>

      {estimate && (() => {
        const plan = bike?.tank_litres ? fuelPlan({ distanceKm: Number(estimate.distance_km), mileageKmpl: Number(estimate.mileage_kmpl), tankLitres: Number(bike.tank_litres) }) : null;
        return (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Fuel stops</h2>
            {plan ? (
              <>
                <p className="mt-2 text-sm text-fg">
                  Full-tank range about <strong>{plan.rangeKm} km</strong>. Plan to refuel by <strong>{plan.safeRangeKm} km</strong> (keeps a 20% reserve).
                  {plan.stops === 0
                    ? " This trip fits in one tank."
                    : <> You need <strong>{plan.stops} refuel{plan.stops > 1 ? "s" : ""}</strong>, by km {plan.stopAtKm.join(", ")}.</>}
                  {" "}About {plan.litresNeeded} l in total.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                  {plan.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Add your bike&apos;s tank size on the <Link href={`/bikes/${trip.bike_id}`} className="underline">bike page</Link> to see range and refuel points.
              </p>
            )}
          </section>
        );
      })()}

      <section className="mt-10" aria-labelledby="itinerary">
        <div className="flex items-center justify-between gap-3">
          <h2 id="itinerary" className="text-lg font-semibold">Itinerary</h2>
          {stops.length > 0 && <span className="text-sm text-muted">{itinerary.days.length} day{itinerary.days.length === 1 ? "" : "s"} · {itinerary.totalKm} km</span>}
        </div>
        {stops.length === 0 && <p className="mt-2 text-sm text-muted">Plan your days and stops: where you ride, refuel, eat and sleep.</p>}

        {(() => {
          if (!estimate || stops.length === 0) return null;
          const m = compareWithBudget(itinerary.totalKm, Number(estimate.distance_km));
          if (m.state === "match") return null;
          return (
            <p className="mt-3 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg" data-testid="itinerary-mismatch">
              Your itinerary adds up to {itinerary.totalKm} km, {m.diffKm} km {m.state === "over" ? "more" : "less"} than the {Number(estimate.distance_km)} km your budget uses.
              Save a new budget revision if the itinerary is right.
            </p>
          );
        })()}

        {itinerary.days.map((d) => (
          <div key={d.day} className="mt-4">
            <h3 className="flex items-baseline justify-between text-sm font-semibold text-fg">
              <span>Day {d.day}</span>
              <span className="font-normal text-muted">{d.totalKm} km{d.missingKm > 0 ? ` (${d.missingKm} stop${d.missingKm === 1 ? "" : "s"} without distance)` : ""}</span>
            </h3>
            {d.longDay && (
              <p className="mt-1 text-xs text-warn-fg">A long riding day. Plan rest breaks and finish before dark.</p>
            )}
            <ol className="mt-1 divide-y divide-line">
              {d.stops.map((st) => (
                <li key={st.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{st.place}</span>
                    <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">{STOP_LABEL[st.type]}</span>
                    <div className="text-xs text-muted">{st.legKm != null ? `${st.legKm} km from previous` : "distance not set"}{st.note ? ` · ${st.note}` : ""}</div>
                  </div>
                  <form action={deleteStop}>
                    <input type="hidden" name="trip_id" value={id} />
                    <input type="hidden" name="stop_id" value={st.id} />
                    <button className="text-xs text-danger-fg underline" aria-label={`Remove stop ${st.place}`}>Remove</button>
                  </form>
                </li>
              ))}
            </ol>
          </div>
        ))}

        <form action={addStop} className="mt-4 space-y-3 rounded-lg border border-line p-3">
          <input type="hidden" name="trip_id" value={id} />
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-xs">Day
              <input name="day_number" type="number" min="1" max="60" required defaultValue={itinerary.days.at(-1)?.day ?? 1} className={input} />
            </label>
            <label className="col-span-2 block text-xs">Place
              <input name="place" required maxLength={200} className={input} />
            </label>
            <label className="block text-xs">Stop type
              <select name="stop_type" defaultValue="ride" className={input}>
                {(Object.keys(STOP_LABEL) as StopType[]).map((t) => <option key={t} value={t}>{STOP_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="block text-xs">Km from previous stop
              <input name="leg_km" type="number" step="0.1" min="0" max="3000" className={input} />
            </label>
            <label className="block text-xs">Stop note
              <input name="note" maxLength={300} className={input} />
            </label>
          </div>
          <button className="rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:bg-sunken">Add stop</button>
        </form>

        {stops.length > 0 && (() => {
          const h = mapsHandoffUrl({ origin: trip.origin_label, destination: trip.destination_label, stops });
          return (
            <div className="mt-4">
              <a href={h.url} target="_blank" rel="noopener noreferrer" data-testid="maps-link"
                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong">
                Open route in Google Maps
              </a>
              <p className="mt-2 text-xs text-muted">
                Opens your route in a navigation app for turn-by-turn directions. It uses the place names you typed, so check the result matches what you meant.
                {h.skipped > 0 && ` ${h.skipped} stop${h.skipped === 1 ? " was" : "s were"} left out because the link supports ${MAX_WAYPOINTS} waypoints.`}
              </p>
            </div>
          );
        })()}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Actual vs estimate</h2>
        <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
          <dt>Spent so far</dt><dd>{formatInr(actual)}</dd>
          <dt>Estimated</dt><dd>{estimate ? formatInr(Number(estimate.total_paise)) : "—"}</dd>
          <dt>Difference</dt>
          <dd>{variance == null ? "—" : `${variance > 0 ? "Over by " : "Under by "}${formatInr(Math.abs(variance))}`}</dd>
          <dt>Cost per km</dt>
          <dd>{(() => { const c = costPerKmPaise(actual, distanceKm); return c == null ? "N/A" : formatInr(c); })()}</dd>
        </dl>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Expenses</h2>
          {expenses && expenses.length > 0 && (
            <a href={`/api/trips/${id}/export.csv`} className="tap text-sm underline">Download CSV</a>
          )}
        </div>
        <ul className="mt-2 divide-y divide-line text-sm">
          {expenses?.length === 0 && <li className="py-2 text-muted">Nothing logged yet.</li>}
          {expenses?.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{e.category}{e.notes ? ` · ${e.notes}` : ""}</span>
              <span>{formatInr(Number(e.amount_paise))}</span>
              {(status === "active" || status === "draft") && (
                <form action={deleteExpense}>
                  <input type="hidden" name="trip_id" value={id} />
                  <input type="hidden" name="expense_id" value={e.id} />
                  <button className="text-xs text-danger-fg underline" aria-label={`Delete ${e.category} expense`}>Delete</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {(status === "active" || status === "draft") && (
          <form action={addExpense} className="mt-4 space-y-3">
            <input type="hidden" name="trip_id" value={id} />
            <input type="hidden" name="client_request_id" value={requestId} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Category
                <select name="category" className={input}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block text-sm">Amount (₹)
                <input name="amount" inputMode="decimal" required className={input} />
              </label>
              <label className="block text-sm">Odometer (km)
                <input name="odometer_km" type="number" min="0" className={input} />
              </label>
              <label className="block text-sm">Litres (fuel only)
                <input name="fuel_litres" type="number" step="0.001" min="0.001" className={input} />
              </label>
              <label className="block text-sm">Note
                <input name="notes" maxLength={1000} className={input} />
              </label>
            </div>
            <button className="rounded-lg bg-saffron px-5 py-2.5 font-semibold text-ink transition hover:bg-saffron-dark">Add expense</button>
            <p className="text-xs text-muted">Log expenses when you have stopped. Do not use your phone while riding.</p>
          </form>
        )}
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ride readiness</h2>
          {checklist && checklist.length > 0 && (
            <span className="text-sm text-muted">{checklistProgress(checklist as { status: ChecklistStatus }[]).ready}/{checklist.length} ready</span>
          )}
        </div>

        <form action={saveProfile} className="mt-3 rounded-lg border border-line p-3">
          <input type="hidden" name="trip_id" value={id} />
          <p className="text-xs text-muted">Your suggested checklist changes with the ride. Tell us about it:</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <label className="block text-xs">Days
              <input name="trip_days" type="number" min="1" max="60" defaultValue={trip.trip_days ?? ""} className={input} />
            </label>
            <label className="block text-xs">Terrain
              <select name="terrain" defaultValue={trip.terrain ?? ""} className={input}>
                <option value="">Not sure</option><option value="plains">Plains</option><option value="hills">Hills</option>
                <option value="mountains">Mountains</option><option value="desert">Desert</option>
              </select>
            </label>
            <label className="block text-xs">Season
              <select name="season" defaultValue={trip.season ?? ""} className={input}>
                <option value="">Not sure</option><option value="summer">Summer</option><option value="monsoon">Monsoon</option><option value="winter">Winter</option>
              </select>
            </label>
          </div>
          <button className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-xs hover:bg-sunken">Save ride details</button>
        </form>

        <form action={addChecklist} className="mt-3">
          <input type="hidden" name="trip_id" value={id} />
          {!checklist || checklist.length === 0 ? (
            <>
              <p className="text-sm text-muted">A pre-ride checklist for India: documents, safety gear, motorcycle, touring and essentials.</p>
              <button className="mt-3 rounded-lg bg-saffron px-4 py-2 text-sm font-semibold text-ink hover:bg-saffron-dark">Add ride checklist</button>
            </>
          ) : (
            <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs hover:bg-sunken">Update suggestions for these ride details</button>
          )}
        </form>

        {checklist && checklist.length > 0 && (() => {
          const typed = checklist as { id: string; category: string; label: string; status: ChecklistStatus }[];
          const prog = checklistProgress(typed);
          const missingGear = gearStillNeeded(typed);
          return (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <div className="h-full rounded-full bg-saffron" style={{ width: `${prog.percent}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {prog.stillNeeded} item{prog.stillNeeded === 1 ? "" : "s"} still needed. Packed and N/A count as ready.
              </p>
              {missingGear.length > 0 && (
                <p className="mt-3 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg" data-testid="gear-prompt">
                  You still need {missingGear.length} piece{missingGear.length === 1 ? "" : "s"} of riding gear ({missingGear.slice(0, 3).join(", ")}{missingGear.length > 3 ? "..." : ""}).{" "}
                  <Link href="/marketplace" className="font-semibold underline">Rider-to-rider gear marketplace: coming soon</Link>.
                </p>
              )}
              {CATEGORY_ORDER.map((cat) => {
                const items = typed.filter((i) => i.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="mt-5">
                    <h3 className="text-sm font-semibold text-fg">{CATEGORY_LABEL[cat]}</h3>
                    <ul className="mt-1 divide-y divide-line">
                      {items.map((it) => (
                        <li key={it.id} className="py-2">
                          <p className={`text-sm ${it.status === "packed" || it.status === "not_applicable" ? "text-subtle line-through" : ""}`}>{it.label}</p>
                          <form action={setChecklistStatus} className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Status for ${it.label}`}>
                            <input type="hidden" name="trip_id" value={id} />
                            <input type="hidden" name="item_id" value={it.id} />
                            {(Object.keys(STATUS_LABEL) as ChecklistStatus[]).map((st) => (
                              <button key={st} name="status" value={st} aria-pressed={it.status === st} aria-label={`${it.label}: ${STATUS_LABEL[st]}`}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition ${it.status === st ? "bg-accent text-on-accent" : "bg-sunken text-muted hover:bg-line"}`}>
                                {STATUS_LABEL[st]}
                              </button>
                            ))}
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </>
          );
        })()}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Share this trip</h2>
        <p className="mt-1 text-sm text-muted">
          Create a public link to a summary card: title, route, distance, total cost and cost per km. Nobody can see your expenses, notes or dates. You can turn it off any time.
        </p>
        <form action={setSharing} className="mt-3">
          <input type="hidden" name="trip_id" value={id} />
          {trip.share_token ? (
            <>
              <input type="hidden" name="share" value="off" />
              <p className="break-all rounded-lg bg-sunken p-3 text-sm" data-testid="share-link">/s/{trip.share_token}</p>
              <button className="mt-3 rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-sunken">Stop sharing</button>
            </>
          ) : (
            <>
              <input type="hidden" name="share" value="on" />
              <button className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium hover:bg-sunken">Create share link</button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
