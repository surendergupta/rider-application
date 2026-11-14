import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { bikeUpdateSchema } from "@/lib/validation/bike";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "Bike not found");

  const body = await request.json().catch(() => null);
  const parsed = bikeUpdateSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return apiError(422, "VALIDATION_ERROR", "Invalid bike data");
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.odometer_km != null) update.odometer_updated_at = new Date().toISOString();

  // RLS also restricts this to the caller's rows; an unowned id simply matches nothing
  const { data, error } = await auth.supabase
    .from("bikes")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not update bike");
  if (!data) return apiError(404, "NOT_FOUND", "Bike not found");
  return NextResponse.json({ bike: data });
}
