import Link from "next/link";

interface Props {
  title: string;
  lead: string;
  planned: string[];
  /** Optional amber policy box, e.g. what will not be allowed. */
  safety?: { heading: string; body: string };
  signedIn: boolean;
  joined: boolean;
  /** Server action that joins or leaves the waitlist; reads a hidden "join" field ("yes"/"no"). */
  action: (formData: FormData) => Promise<void>;
}

export function ComingSoon({ title, lead, planned, safety, signedIn, joined, action }: Props) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-road text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="tap font-bold">Long-Ride Planner</Link>
          <Link href={signedIn ? "/home" : "/login"} className="tap text-sm text-white/80 hover:text-white">{signedIn ? "Open app" : "Sign in"}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <span className="rounded-full bg-saffron px-3 py-1 text-xs font-bold text-ink">Coming soon</span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-lg text-muted">{lead}</p>

        <section className="mt-8 rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-line">
          <h2 className="font-semibold">What we plan to build</h2>
          <ul className="mt-3 space-y-2 text-sm text-fg">
            {planned.map((p) => <li key={p} className="flex gap-2"><span className="text-link" aria-hidden="true">○</span>{p}</li>)}
          </ul>
        </section>

        {safety && (
          <section className="mt-6 rounded-2xl border border-warn-fg/30 bg-warn-bg p-6">
            <h2 className="font-semibold text-warn-fg">{safety.heading}</h2>
            <p className="mt-2 text-sm text-warn-fg">{safety.body}</p>
          </section>
        )}

        <section className="mt-8">
          {signedIn ? (
            <form action={action}>
              <input type="hidden" name="join" value={joined ? "no" : "yes"} />
              <button className={`rounded-full px-7 py-3 font-semibold transition ${joined ? "border border-line-strong bg-surface hover:bg-sunken" : "bg-saffron text-ink hover:bg-saffron-dark"}`}>
                {joined ? "You are on the waitlist. Leave it" : "Join the waitlist"}
              </button>
              <p className="mt-2 text-xs text-muted" role="status">
                {joined ? "Thanks. We will use your account email only to tell you when it opens." : "One click. We use your account email only to tell you when it opens."}
              </p>
            </form>
          ) : (
            <Link href="/signup" className="inline-block rounded-full bg-saffron px-7 py-3 font-semibold text-ink transition hover:bg-saffron-dark">
              Create a free account to join the waitlist
            </Link>
          )}
        </section>
      </main>
    </div>
  );
}
