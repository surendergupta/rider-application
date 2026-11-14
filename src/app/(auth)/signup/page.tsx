import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/db/server";
import { AuthShell, authInput } from "@/components/AuthCard";
import { authenticate } from "../actions";

export const metadata = { title: "Create account · India Long-Ride Planner" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const configured = supabaseConfigured();

  // Already signed in: no need to sign up again.
  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/home");
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-fg">Create your free account</h1>
      <p className="mt-1 text-sm text-muted">Plan your next long ride in a couple of minutes.</p>

      {!configured && (
        <p role="alert" className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">
          Supabase is not configured. Copy .env.example to .env.local and fill in the keys.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
          {error === "invalid"
            ? "Enter an email and a password of at least 8 characters."
            : "Could not create the account. If you already have one, sign in instead."}
        </p>
      )}

      <form action={authenticate} className="mt-6 space-y-4">
        <input type="hidden" name="mode" value="signup" />
        <label className="block text-sm font-medium text-fg">
          Email
          <input name="email" type="email" required autoComplete="email" className={authInput} />
        </label>
        <label className="block text-sm font-medium text-fg">
          Password
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className={authInput} />
          <span className="mt-1 block text-xs font-normal text-subtle">At least 8 characters.</span>
        </label>
        <button disabled={!configured}
          className="w-full rounded-lg bg-saffron py-3 font-semibold text-ink transition hover:bg-saffron-dark disabled:opacity-50">
          Create account
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="font-semibold text-link underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
