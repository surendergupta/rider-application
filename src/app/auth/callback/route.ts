import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";

// Email-confirmation landing: exchanges the one-time code for a session.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // Always redirect to a fixed internal path, never to a caller-supplied URL.
    if (!error) return NextResponse.redirect(`${origin}/home`);
  }
  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
