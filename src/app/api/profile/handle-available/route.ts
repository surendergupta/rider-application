import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { failureResponse, limited } from "@/features/profile/http";
import { isHandleAvailable } from "@/features/profile/service";

/** Is a handle free? Signed-in only and rate-limited, because it reveals which handles are taken (never by whom). */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const tooMany = limited(`handle-check:${auth.user.id}`, 30, 60_000);
  if (tooMany) return tooMany;

  const handle = new URL(request.url).searchParams.get("handle") ?? "";
  const result = await isHandleAvailable(handle, auth.user.id);
  return result.ok ? NextResponse.json({ handle: result.handle, available: result.available }) : failureResponse(result);
}
