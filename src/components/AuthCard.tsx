import Link from "next/link";

export const authInput =
  "mt-1.5 w-full rounded-lg border border-line-strong p-3 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

/** Shared dark-background shell for the login and sign-up pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-road px-4 py-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-saffron/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-sky-500/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 font-bold text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-saffron text-ink" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5.5" cy="17" r="3" /><circle cx="18.5" cy="17" r="3" /><path d="M5.5 17 9 9h4l2 4h3.5M9 9 7.5 6H6" />
            </svg>
          </span>
          Long-Ride Planner
        </Link>
        <div className="rounded-3xl bg-surface p-7 shadow-2xl shadow-black/40">{children}</div>
        <p className="mt-5 text-center text-xs text-white/50">
          Your trips and expenses are private to your account. By continuing you agree to the{" "}
          <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}
