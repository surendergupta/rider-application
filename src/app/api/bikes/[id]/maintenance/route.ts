import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { maintenanceSchema } from "@/lib/validation/maintenance";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "Bike not found");

  const { data, error } = await auth.supabase
    .from("maintenance_records")
    .select("*")
    .eq("bike_id", id)
    .order("service_date", { ascending: false })
    .limit(200);
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not load records");
  return NextResponse.json({ records: data });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "Bike not found");

  const parsed = maintenanceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid service record");

  const { data, error } = await auth.supabase
    .from("maintenance_records")
    .insert({ ...parsed.data, bike_id: id, user_id: auth.user.id })
    .select()
    .single();
  if (error) {
    if (error.code === "23503") return apiError(404, "NOT_FOUND", "Bike not found");
    return apiError(500, "INTERNAL_ERROR", "Could not save record");
  }
  return NextResponse.json({ record: data }, { status: 201 });
}
