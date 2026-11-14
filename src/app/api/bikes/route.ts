import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { bikeCreateSchema } from "@/lib/validation/bike";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase
    .from("bikes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not load bikes");
  return NextResponse.json({ bikes: data });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = bikeCreateSchema.safeParse(body);
  if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid bike data");

  // user_id comes from the verified session, never from the request body
  const { data, error } = await auth.supabase
    .from("bikes")
    .insert({
      ...parsed.data,
      user_id: auth.user.id,
      odometer_updated_at: parsed.data.odometer_km != null ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not create bike");
  return NextResponse.json({ bike: data }, { status: 201 });
}
