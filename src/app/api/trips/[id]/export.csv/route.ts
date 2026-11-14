import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { paiseToRupeesString, toCsv } from "@/lib/csv";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "Trip not found");

  // RLS limits both queries to the caller's own rows.
  const { data: trip } = await auth.supabase.from("trips").select("id, title").eq("id", id).maybeSingle();
  if (!trip) return apiError(404, "NOT_FOUND", "Trip not found");

  const { data, error } = await auth.supabase
    .from("expenses")
    .select("spent_at, category, amount_paise, fuel_litres, odometer_km, notes")
    .eq("trip_id", id)
    .order("spent_at", { ascending: true })
    .limit(5000);
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not export expenses");

  const csv = toCsv(
    ["date", "category", "amount_inr", "fuel_litres", "odometer_km", "notes"],
    (data ?? []).map((e) => [e.spent_at, e.category, paiseToRupeesString(e.amount_paise), e.fuel_litres, e.odometer_km, e.notes]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trip-${id.slice(0, 8)}-expenses.csv"`,
      "cache-control": "no-store",
    },
  });
}
