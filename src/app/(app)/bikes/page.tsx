import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, supabaseConfigured } from "@/lib/db/server";
import { bikeCreateSchema } from "@/lib/validation/bike";

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));

async function addBike(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const parsed = bikeCreateSchema.safeParse({
    display_name: formData.get("display_name"),
    make: formData.get("make") ?? "",
    model: formData.get("model") ?? "",
    mileage_kmpl: num(formData.get("mileage_kmpl")),
    tank_litres: num(formData.get("tank_litres")),
    odometer_km: num(formData.get("odometer_km")),
  });
  if (!parsed.success) redirect("/bikes?error=invalid");

  const { error } = await supabase.from("bikes").insert({
    ...parsed.data,
    user_id: auth.user.id,
    odometer_updated_at: parsed.data.odometer_km != null ? new Date().toISOString() : null,
  });
  if (error) redirect("/bikes?error=failed");
  revalidatePath("/bikes");
}

async function archiveBike(formData: FormData) {
  "use server";
  const supabase = await createClient();
  await supabase.from("bikes").update({ is_archived: true }).eq("id", String(formData.get("id")));
  revalidatePath("/bikes");
}

export default async function BikesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!supabaseConfigured()) redirect("/login");
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: bikes } = await supabase
    .from("bikes")
    .select("id, display_name, make, model, mileage_kmpl, odometer_km")
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-bold">Your garage</h1>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-fg">
          Could not save the bike. Check the values and try again.
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {bikes?.length === 0 && <li className="text-muted">No bikes yet. Add your first one below.</li>}
        {bikes?.map((b) => (
          <li key={b.id} className="flex items-center justify-between rounded border border-line p-3">
            <div>
              <Link href={`/bikes/${b.id}`} className="tap font-medium underline">{b.display_name}</Link>
              <div className="text-sm text-muted">
                {[b.make, b.model].filter(Boolean).join(" ")}
                {b.mileage_kmpl != null && ` · ${b.mileage_kmpl} km/l`}
                {b.odometer_km != null && ` · ${b.odometer_km} km`}
              </div>
            </div>
            <form action={archiveBike}>
              <input type="hidden" name="id" value={b.id} />
              <button className="text-sm text-muted underline">Archive</button>
            </form>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-semibold">Add a bike</h2>
      <form action={addBike} className="mt-3 space-y-3">
        <label className="block text-sm">Name
          <input name="display_name" required maxLength={100} className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Make
            <input name="make" maxLength={100} className={input} />
          </label>
          <label className="block text-sm">Model
            <input name="model" maxLength={100} className={input} />
          </label>
          <label className="block text-sm">Real-world mileage (km/l)
            <input name="mileage_kmpl" type="number" step="0.01" min="0.01" max="200" className={input} />
          </label>
          <label className="block text-sm">Tank size (litres)
            <input name="tank_litres" type="number" step="0.1" min="0.1" max="100" className={input} />
          </label>
          <label className="block text-sm">Odometer (km)
            <input name="odometer_km" type="number" step="1" min="0" className={input} />
          </label>
        </div>
        <button className="rounded-lg bg-saffron px-5 py-2.5 font-semibold text-ink transition hover:bg-saffron-dark">Add bike</button>
      </form>
    </main>
  );
}
