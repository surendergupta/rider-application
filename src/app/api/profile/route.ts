import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { failureResponse, limited } from "@/features/profile/http";
import { deleteProfile, getOwnProfile, saveProfile } from "@/features/profile/service";

/** The signed-in rider's own profile (private view, including settings). */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ profile: await getOwnProfile(auth.supabase, auth.user.id) });
}

/** Create or update the signed-in rider's profile. The owner always comes from the session, never from the body. */
export async function PUT(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const tooMany = limited(`profile-save:${auth.user.id}`, 20, 60_000);
  if (tooMany) return tooMany;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) return apiError(422, "VALIDATION_ERROR", "Send a JSON object");
  const result = await saveProfile(auth.supabase, auth.user.id, body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ profile: await getOwnProfile(auth.supabase, auth.user.id) });
}

/** Remove the profile entirely; the handle becomes available again. */
export async function DELETE() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const result = await deleteProfile(auth.supabase, auth.user.id);
  return result.ok ? NextResponse.json({ deleted: true }) : failureResponse(result);
}
