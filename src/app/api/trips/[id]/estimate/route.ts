import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { computeEstimate } from "@/lib/money/estimate";
import { estimateSchema } from "@/lib/validation/trip";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "Trip not found");

  const parsed = estimateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid estimate inputs");
  const i = parsed.data;

  // Derived server-side; the client never supplies fuel_paise / total.
  const est = computeEstimate({
    distanceKm: i.distance_km,
    plannedMileageKmPerLitre: i.mileage_kmpl,
    petrolPricePaisePerLitre: i.fuel_price_paise_per_litre,
    tollPaise: i.toll_paise,
    foodPaise: i.food_paise,
    stayPaise: i.stay_paise,
    otherPaise: i.other_paise,
  });

  const { data, error } = await auth.supabase.rpc("create_trip_estimate", {
    p_trip_id: id,
    p_distance_km: i.distance_km,
    p_mileage_kmpl: i.mileage_kmpl,
    p_fuel_price: i.fuel_price_paise_per_litre,
    p_fuel_litres: est.fuelLitres,
    p_fuel_paise: est.fuelPaise,
    p_toll: i.toll_paise,
    p_food: i.food_paise,
    p_stay: i.stay_paise,
    p_other: i.other_paise,
    p_input_sources: i.input_sources,
  });
  if (error) {
    if (error.code === "P0002") return apiError(404, "NOT_FOUND", "Trip not found");
    return apiError(500, "INTERNAL_ERROR", "Could not save estimate");
  }
  return NextResponse.json({ estimate: data }, { status: 201 });
}
