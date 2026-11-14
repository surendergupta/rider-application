import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { tripCreateSchema } from "@/lib/validation/trip";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not load trips");
  return NextResponse.json({ trips: data });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const parsed = tripCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid trip data");

  // The composite FK (bike_id, user_id) rejects a bike owned by someone else.
  const { data, error } = await auth.supabase
    .from("trips")
    .insert({ ...parsed.data, user_id: auth.user.id })
    .select()
    .single();
  if (error) {
    if (error.code === "23503") return apiError(404, "NOT_FOUND", "Bike not found");
    return apiError(500, "INTERNAL_ERROR", "Could not create trip");
  }
  return NextResponse.json({ trip: data }, { status: 201 });
}
