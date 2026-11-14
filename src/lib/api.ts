import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "@/lib/db/server";

/** Error envelope from docs/05 section 6: { error: { code, message, request_id } } */
export function apiError(status: number, code: string, message: string, field?: string) {
  return NextResponse.json(
    { error: { code, message, request_id: crypto.randomUUID(), ...(field ? { field } : {}) } },
    { status },
  );
}

/** Returns the authenticated session client + user, or an error response. */
export async function requireUser() {
  if (!supabaseConfigured()) {
    return { error: apiError(503, "INTERNAL_ERROR", "Backend is not configured") } as const;
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: apiError(401, "AUTH_REQUIRED", "Sign in required") } as const;
  return { supabase, user: data.user } as const;
}
