import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/db/server";
import { formatInr } from "@/lib/money/estimate";
import { rupeesToPaise } from "@/lib/money/parse";
import { serviceDue, type DueState } from "@/features/maintenance/due";
import { SERVICE_TYPES, maintenanceSchema, scheduleSchema } from "@/lib/validation/maintenance";
import { bikeUpdateSchema } from "@/lib/validation/bike";
import { DOC_LABEL, describeStatus, documentStatus, todayInIndia, type DocType } from "@/features/garage/documents";

const intOrNull = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));

async function addRecord(formData: FormData) {
  "use server";
  const id = String(formData.get("bike_id"));
  const back = `/bikes/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const cost = formData.get("cost") === "" ? 0 : rupeesToPaise(formData.get("cost"));
  const parsed = maintenanceSchema.safeParse({
    service_type: formData.get("service_type"),
    service_date: formData.get("service_date"),
    odometer_km: intOrNull(formData.get("odometer_km")),
    cost_paise: cost,
    next_due_km: intOrNull(formData.get("next_due_km")),
    notes: String(formData.get("notes") ?? "") || null,
  });
  if (!z.uuid().safeParse(id).success || !parsed.success) redirect(`${back}?error=record`);

  const { error } = await supabase
    .from("maintenance_records")
    .insert({ ...parsed.data, bike_id: id, user_id: auth.user.id });
  if (error) redirect(`${back}?error=record`);

  // Keep the schedule and bike odometer in step with the new record (never move them backwards).
  const odo = parsed.data.odometer_km;
  if (odo != null) {
    const { data: sched } = await supabase.from("service_schedules").select("id, last_service_km")
      .eq("bike_id", id).eq("service_type", parsed.data.service_type).maybeSingle();
    if (sched && (sched.last_service_km ?? -1) < odo) {
      await supabase.from("service_schedules").update({ last_service_km: odo }).eq("id", sched.id);
    }
    const { data: bike } = await supabase.from("bikes").select("odometer_km").eq("id", id).maybeSingle();
    if (bike && (bike.odometer_km ?? -1) < odo) {
      await supabase.from("bikes").update({ odometer_km: odo, odometer_updated_at: new Date().toISOString() }).eq("id", id);
    }
  }
  revalidatePath(back);
}

async function saveSchedule(formData: FormData) {
  "use server";
  const id = String(formData.get("bike_id"));
  const back = `/bikes/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const parsed = scheduleSchema.safeParse({
    service_type: formData.get("service_type"),
    interval_km: intOrNull(formData.get("interval_km")),
    last_service_km: intOrNull(formData.get("last_service_km")),
  });
  if (!z.uuid().safeParse(id).success || !parsed.success) redirect(`${back}?error=schedule`);

  const { error } = await supabase
    .from("service_schedules")
    .upsert({ ...parsed.data, bike_id: id, user_id: auth.user.id, enabled: true }, { onConflict: "bike_id,service_type" });
  if (error) redirect(`${back}?error=schedule`);
  revalidatePath(back);
}

async function updateBikeDetails(formData: FormData) {
  "use server";
  const id = String(formData.get("bike_id"));
  const back = `/bikes/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const parsed = bikeUpdateSchema.safeParse({
    mileage_kmpl: intOrNull(formData.get("mileage_kmpl")),
    tank_litres: intOrNull(formData.get("tank_litres")),
  });
  if (!z.uuid().safeParse(id).success || !parsed.success) redirect(`${back}?error=details`);
  const { error } = await supabase.from("bikes").update(parsed.data).eq("id", id);
  if (error) redirect(`${back}?error=details`);
  revalidatePath(back);
}

async function saveDocument(formData: FormData) {
  "use server";
  const id = String(formData.get("bike_id"));
  const back = `/bikes/${id}`;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const parsed = z.object({
    doc_type: z.enum(["insurance", "puc", "registration", "other"]),
    expires_on: z.iso.date(),
    note: z.string().trim().max(200).nullable(),
  }).safeParse({
    doc_type: formData.get("doc_type"),
    expires_on: formData.get("expires_on"),
    note: String(formData.get("note") ?? "") || null,
  });
  if (!z.uuid().safeParse(id).success || !parsed.success) redirect(`${back}?error=document`);
  // One row per document type per bike: saving again updates the expiry (e.g. after renewal).
  const { error } = await supabase
    .from("vehicle_documents")
    .upsert({ ...parsed.data, bike_id: id, user_id: auth.user.id }, { onConflict: "bike_id,doc_type" });
  if (error) redirect(`${back}?error=document`);
  revalidatePath(back);
}

async function deleteDocument(formData: FormData) {
  "use server";
  const id = String(formData.get("bike_id"));
  const docId = String(formData.get("doc_id"));
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(docId).success) redirect("/bikes");
  const supabase = await createClient();
  await supabase.from("vehicle_documents").delete().eq("id", docId).eq("bike_id", id);
  revalidatePath(`/bikes/${id}`);
}

const BADGE: Record<DueState, { text: string; cls: string }> = {
  ok: { text: "OK", cls: "bg-success-bg text-success-fg" },
  due_soon: { text: "Due soon", cls: "bg-warn-bg text-warn-fg" },
  overdue: { text: "Overdue", cls: "bg-danger-bg text-danger-fg" },
  unknown: { text: "Add last service km", cls: "bg-sunken text-fg" },
};

export default async function BikePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: bike } = await supabase.from("bikes").select("*").eq("id", id).maybeSingle();
  if (!bike) notFound();

  const [{ data: records }, { data: schedules }] = await Promise.all([
    supabase.from("maintenance_records").select("*").eq("bike_id", id).order("service_date", { ascending: false }).limit(200),
    supabase.from("service_schedules").select("*").eq("bike_id", id).eq("enabled", true).order("service_type"),
  ]);
  const { data: documents } = await supabase.from("vehicle_documents").select("*").eq("bike_id", id).order("expires_on");
  const today = todayInIndia();

  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const typeSelect = (
    <select name="service_type" className={input}>
      {SERVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <Link href="/bikes" className="tap text-sm underline">← Bikes</Link>
      <h1 className="mt-3 text-2xl font-bold">{bike.display_name}</h1>
      <p className="text-sm text-muted">
        {bike.odometer_km != null ? `Odometer ${bike.odometer_km} km` : "No odometer reading yet"}
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">Could not save. Check the values and try again.</p>}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Documents and expiry</h2>
        <p className="mt-1 text-xs text-muted">
          Track when insurance, PUC and registration expire. We store only the type, date and a short note. No document numbers or files.
        </p>
        <ul className="mt-3 space-y-2">
          {documents?.length === 0 && <li className="text-sm text-muted">No documents tracked yet.</li>}
          {documents?.map((d) => {
            const st = documentStatus(d.expires_on, today);
            const cls = st.state === "expired" ? "bg-danger-bg text-danger-fg" : st.state === "expiring" ? "bg-warn-bg text-warn-fg" : "bg-success-bg text-success-fg";
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{DOC_LABEL[d.doc_type as DocType]}</div>
                  <div className="text-muted">{d.expires_on}{d.note ? ` · ${d.note}` : ""}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`rounded px-2 py-1 text-xs ${cls}`}>{describeStatus(st)}</span>
                  <form action={deleteDocument}>
                    <input type="hidden" name="bike_id" value={id} />
                    <input type="hidden" name="doc_id" value={d.id} />
                    <button className="text-xs text-danger-fg underline" aria-label={`Remove ${DOC_LABEL[d.doc_type as DocType]}`}>Remove</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        <form action={saveDocument} className="mt-4 space-y-3">
          <input type="hidden" name="bike_id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Document
              <select name="doc_type" className={input}>
                {(Object.keys(DOC_LABEL) as DocType[]).map((t) => <option key={t} value={t}>{DOC_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="block text-sm">Expires on
              <input name="expires_on" type="date" required className={input} />
            </label>
          </div>
          <label className="block text-sm">Note (optional)
            <input name="note" maxLength={200} className={input} />
          </label>
          <button className="rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-sunken">Save document</button>
          <p className="text-xs text-subtle">Saving a type again updates its expiry, for example after a renewal.</p>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Bike details</h2>
        <form action={updateBikeDetails} className="mt-3 space-y-3">
          <input type="hidden" name="bike_id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Mileage (km/l)
              <input name="mileage_kmpl" type="number" step="0.01" min="0.01" max="200" defaultValue={bike.mileage_kmpl ?? ""} className={input} />
            </label>
            <label className="block text-sm">Tank size (litres)
              <input name="tank_litres" type="number" step="0.1" min="0.1" max="100" defaultValue={bike.tank_litres ?? ""} className={input} />
            </label>
          </div>
          <button className="rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-sunken">Save details</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Service due</h2>
        <p className="mt-1 text-xs text-muted">
          Reminders are guidance based on the intervals you set. Follow your bike&apos;s manual and check it before long rides.
        </p>
        <ul className="mt-3 space-y-2">
          {schedules?.length === 0 && <li className="text-sm text-muted">No intervals set yet.</li>}
          {schedules?.map((s) => {
            const d = serviceDue(bike.odometer_km, s.last_service_km, s.interval_km);
            const b = BADGE[d.state];
            return (
              <li key={s.id} className="flex items-center justify-between rounded border border-line p-3 text-sm">
                <div>
                  <div className="font-medium">{s.service_type} · every {s.interval_km} km</div>
                  <div className="text-muted">
                    {d.dueAtKm != null && d.remainingKm != null
                      ? d.remainingKm > 0 ? `Due at ${d.dueAtKm} km (${d.remainingKm} km left)` : `Was due at ${d.dueAtKm} km (${-d.remainingKm} km over)`
                      : "Needs odometer and last service km"}
                  </div>
                </div>
                <span className={`rounded px-2 py-1 text-xs ${b.cls}`}>{b.text}</span>
              </li>
            );
          })}
        </ul>
        <form action={saveSchedule} className="mt-4 space-y-3">
          <input type="hidden" name="bike_id" value={id} />
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">Type{typeSelect}</label>
            <label className="block text-sm">Every (km)
              <input name="interval_km" type="number" min="1" max="100000" required className={input} />
            </label>
            <label className="block text-sm">Last done at (km)
              <input name="last_service_km" type="number" min="0" className={input} />
            </label>
          </div>
          <button className="rounded border border-line-strong px-4 py-2 text-sm">Save interval</button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Service history</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {records?.length === 0 && <li className="py-2 text-muted">No records yet.</li>}
          {records?.map((r) => (
            <li key={r.id} className="flex justify-between py-2">
              <span>
                {r.service_date} · {r.service_type}
                {r.odometer_km != null && ` · ${r.odometer_km} km`}
                {r.notes && ` · ${r.notes}`}
              </span>
              <span>{formatInr(Number(r.cost_paise))}</span>
            </li>
          ))}
        </ul>
        <form action={addRecord} className="mt-4 space-y-3">
          <input type="hidden" name="bike_id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Type{typeSelect}</label>
            <label className="block text-sm">Date
              <input name="service_date" type="date" required className={input} />
            </label>
            <label className="block text-sm">Odometer (km)
              <input name="odometer_km" type="number" min="0" className={input} />
            </label>
            <label className="block text-sm">Cost (₹)
              <input name="cost" inputMode="decimal" className={input} />
            </label>
            <label className="block text-sm">Next due at (km)
              <input name="next_due_km" type="number" min="0" className={input} />
            </label>
            <label className="block text-sm">Note
              <input name="notes" maxLength={1000} className={input} />
            </label>
          </div>
          <button className="rounded-lg bg-saffron px-5 py-2.5 font-semibold text-ink transition hover:bg-saffron-dark">Add record</button>
        </form>
      </section>
    </main>
  );
}
