import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { failureResponse, limited } from "@/features/profile/http";
import { reportRider } from "@/features/profile/service";

/** Report a public profile. Only profiles the reporter can actually see can be reported. */
export async function POST(request: Request, ctx: { params: Promise<{ handle: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const tooMany = limited(`profile-report:${auth.user.id}`, 5, 60 * 60_000);
  if (tooMany) return tooMany;

  const { handle } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") return apiError(422, "VALIDATION_ERROR", "Send a JSON object");
  const result = await reportRider(auth.supabase, auth.user.id, handle, body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ reported: true, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
}
