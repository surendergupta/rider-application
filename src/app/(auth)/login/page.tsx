import Link from "next/link";
import { supabaseConfigured } from "@/lib/db/server";
import { AuthShell, authInput } from "@/components/AuthCard";
import { authenticate, resendConfirmation } from "../actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  const configured = supabaseConfigured();

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-fg">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to your trips and budgets.</p>

      {!configured && (
        <p role="alert" className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">
          Supabase is not configured. Copy .env.example to .env.local and fill in the keys.
        </p>
      )}
      {notice === "check-email" && (
        <p role="status" className="mt-4 rounded-lg bg-success-bg p-3 text-sm text-success-fg">
          Almost there. We sent a confirmation link to your email. Open it, then come back and sign in.
        </p>
      )}
      {notice === "deleted" && (
        <p role="status" className="mt-4 rounded-lg bg-success-bg p-3 text-sm text-success-fg">
          Your account and all its data have been deleted.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
          {error === "invalid"
            ? "Enter an email and a password of at least 8 characters."
            : error === "confirm" || error === "expired"
              ? "That confirmation link is invalid or has expired. Links work once, and a newer email replaces older ones. Request a new one below."
              : error === "rate"
                ? "Too many emails were requested. Wait a few minutes and try again."
                : "Could not sign you in. Check your details and try again."}
        </p>
      )}
      {(error === "confirm" || error === "expired" || notice === "check-email") && (
        <form action={resendConfirmation} className="mt-4 space-y-2 rounded-lg border border-line p-3">
          <label className="block text-sm font-medium text-fg">
            Send a new confirmation email to
            <input name="email" type="email" required autoComplete="email" className={authInput} />
          </label>
          <button className="w-full rounded-lg border border-line-strong py-2 text-sm font-medium text-fg hover:bg-sunken">
            Resend confirmation email
          </button>
          <p className="text-xs text-subtle">Use only the newest email. Older links stop working.</p>
        </form>
      )}

      <form action={authenticate} className="mt-6 space-y-4">
        <input type="hidden" name="mode" value="signin" />
        <label className="block text-sm font-medium text-fg">
          Email
          <input name="email" type="email" required autoComplete="email" className={authInput} />
        </label>
        <label className="block text-sm font-medium text-fg">
          Password
          <input name="password" type="password" required minLength={8} autoComplete="current-password" className={authInput} />
        </label>
        <button disabled={!configured}
          className="w-full rounded-lg bg-saffron py-3 font-semibold text-ink transition hover:bg-saffron-dark disabled:opacity-50">
          Sign in
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        New here? <Link href="/signup" className="font-semibold text-link underline">Create a free account</Link>
      </p>
    </AuthShell>
  );
}
