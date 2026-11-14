"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";

/**
 * Where confirmation links should send people back to. Set NEXT_PUBLIC_SITE_URL in production;
 * in development it falls back to the address the request came in on.
 */
async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Sends the confirmation email again (for expired or replaced links). */
export async function resendConfirmation(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=expired");
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await siteUrl()}/auth/callback` },
  });
  // Same message either way, so this form cannot be used to discover which emails have accounts.
  redirect(error?.status === 429 ? "/login?error=rate" : "/login?notice=check-email");
}

/** Shared by /login and /signup. `mode` is "signin" or "signup". */
export async function authenticate(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const mode = String(formData.get("mode")) === "signup" ? "signup" : "signin";
  const page = mode === "signup" ? "/signup" : "/login";
  if (!email || password.length < 8) redirect(`${page}?error=invalid`);

  const supabase = await createClient();

  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${await siteUrl()}/auth/callback` },
    });
    if (error) redirect("/signup?error=failed");
    // No session means the project requires email confirmation first.
    redirect(data.session ? "/home" : "/login?notice=check-email");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=failed");
  redirect("/home");
}
