import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { expenseSchema } from "@/lib/validation/trip";

async function tripId(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return z.uuid().safeParse(id).success ? id : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = await tripId(ctx);
  if (!id) return apiError(404, "NOT_FOUND", "Trip not found");

  const { data, error } = await auth.supabase
    .from("expenses")
    .select("*")
    .eq("trip_id", id)
    .order("spent_at", { ascending: false })
    .limit(500);
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not load expenses");

  const actual_total_paise = (data ?? []).reduce((s, e) => s + Number(e.amount_paise), 0);
  return NextResponse.json({ expenses: data, actual_total_paise });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const id = await tripId(ctx);
  if (!id) return apiError(404, "NOT_FOUND", "Trip not found");

  const parsed = expenseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid expense data");

  const insert = await auth.supabase
    .from("expenses")
    .insert({ ...parsed.data, trip_id: id, user_id: auth.user.id })
    .select()
    .single();

  if (insert.error) {
    if (insert.error.code === "23505") {
      // Retry with the same client_request_id: return the original row, create nothing new.
      const existing = await auth.supabase
        .from("expenses")
        .select("*")
        .eq("client_request_id", parsed.data.client_request_id)
        .eq("trip_id", id)
        .maybeSingle();
      if (existing.data) return NextResponse.json({ expense: existing.data }, { status: 200 });
    }
    if (insert.error.code === "23503") return apiError(404, "NOT_FOUND", "Trip not found");
    return apiError(500, "INTERNAL_ERROR", "Could not save expense");
  }
  return NextResponse.json({ expense: insert.data }, { status: 201 });
}
