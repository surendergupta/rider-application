import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return apiError(404, "NOT_FOUND", "Expense not found");

  // RLS restricts deletion to the owner's rows; someone else's id matches nothing.
  const { data, error } = await auth.supabase.from("expenses").delete().eq("id", id).select("id");
  if (error) return apiError(500, "INTERNAL_ERROR", "Could not delete expense");
  if (!data || data.length === 0) return apiError(404, "NOT_FOUND", "Expense not found");
  return NextResponse.json({ deleted: true });
}
