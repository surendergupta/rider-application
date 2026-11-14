import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { failureResponse, limited } from "@/features/profile/http";
import { blockRider, unblockRider } from "@/features/profile/service";

export async function POST(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const tooMany = limited(`profile-block:${auth.user.id}`, 30, 60_000);
  if (tooMany) return tooMany;
  const { handle } = await ctx.params;
  const result = await blockRider(auth.supabase, auth.user.id, handle);
  return result.ok ? NextResponse.json({ blocked: true }, { status: 201 }) : failureResponse(result);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const tooMany = limited(`profile-block:${auth.user.id}`, 30, 60_000);
  if (tooMany) return tooMany;
  const { handle } = await ctx.params;
  const result = await unblockRider(auth.supabase, auth.user.id, handle);
  return result.ok ? NextResponse.json({ blocked: false }) : failureResponse(result);
}
