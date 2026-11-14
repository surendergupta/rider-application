import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { createClient, supabaseConfigured } from "@/lib/db/server";

const FEATURES = [
  {
    title: "Budget that matches reality",
    body: "Riders guess their mileage and the budget is wrong. We work out your real km/l from your own fuel fills, then build the trip total from it.",
    icon: "M12 2v20M5 9l7-7 7 7M4 22h16",
  },
  {
    title: "Fuel-stop planner",
    body: "From your tank size and real mileage: range per tank and the distance markers where you should refuel, with a safety reserve.",
    icon: "M5 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18M5 12h10M15 8h2a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0 3 0V9l-3-3",
  },
  {
    title: "Ride readiness checklist",
    body: "Documents, safety gear, motorcycle, touring and essentials. It changes with your trip length, season and terrain. Mark each item Need it, Have it, Packed or N/A.",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  },
  {
    title: "Works without internet",
    body: "Save a free map of India to your phone and keep it when the signal drops. Reference only. Check routes and conditions before you ride.",
    icon: "M1 6l7-3 8 3 7-3v15l-7 3-8-3-7 3zM8 3v15M16 6v15",
  },
  {
    title: "Log every stop",
    body: "Fuel, toll, food, stay, parking. Add an expense in seconds. Retry-safe, so a bad signal never double-counts.",
    icon: "M3 7h18M3 12h18M3 17h12",
  },
  {
    title: "Share your ride",
    body: "One link to a clean summary card: route, distance, total and cost per km. Your expenses and notes stay private, and you can switch it off.",
    icon: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14",
  },
  {
    title: "Rider gear marketplace",
    body: "Buy and sell pre-owned touring gear with other riders. Used helmets and safety-critical gear will not be listed. Join the waitlist.",
    icon: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
    soon: true,
    href: "/marketplace",
  },
];

const STEPS = [
  ["1", "Add your bike", "Name, mileage and odometer. Takes under a minute."],
  ["2", "Plan the trip", "Route distance and costs become a saved budget you can revise."],
  ["3", "Ride and log", "Record expenses at your stops and watch the budget track."],
  ["4", "Look back", "Compare actual against estimate and plan the next ride better."],
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; error_code?: string }> }) {
  // Supabase sends people back to the site root with ?error=... when a link is bad; show them a fix, not the landing page.
  const sp = await searchParams;
  if (sp.error_code === "otp_expired" || sp.error === "access_denied") redirect("/login?error=expired");

  let signedIn = false;
  if (supabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  }
  const cta = signedIn ? { href: "/home", label: "Open your garage" } : { href: "/signup", label: "Explore Your Next Ride" };

  return (
    <div className="bg-canvas text-fg">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Link href="/" className="tap gap-2 font-bold text-white">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-saffron text-ink">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="5.5" cy="17" r="3" /><circle cx="18.5" cy="17" r="3" /><path d="M5.5 17 9 9h4l2 4h3.5M9 9 7.5 6H6" />
              </svg>
            </span>
            Long-Ride Planner
          </Link>
          <nav className="flex items-center gap-5 text-sm text-white/80">
            <a href="#features" className="hidden hover:text-white sm:inline">Features</a>
            <a href="#how" className="hidden hover:text-white sm:inline">How it works</a>
            <Link href="/pricing" className="hidden hover:text-white sm:inline">Pricing</Link>
            <ThemeToggle className="rounded-full" />
            <Link href={signedIn ? "/home" : "/login"} className="flex min-h-11 items-center rounded-full bg-white/10 px-4 font-medium text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20">
              {signedIn ? "Open app" : "Sign in"}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-road text-white">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-saffron/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-sky-500/20 blur-3xl" />
        <div className="pointer-events-none absolute right-[8%] top-[18%] h-56 w-56 rounded-full bg-gradient-to-br from-saffron/70 to-amber-300/20 blur-2xl" aria-hidden="true" />
        <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-64 w-full md:h-80" viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <path className="fill-white/[0.05]" d="M0 230 L90 170 L170 215 L260 140 L350 205 L440 120 L540 200 L640 150 L740 215 L830 130 L930 205 L1030 160 L1120 210 L1200 175 L1200 320 L0 320Z" />
          <path className="fill-white/[0.08]" d="M0 270 L110 215 L210 255 L330 190 L450 250 L560 200 L690 262 L800 205 L920 258 L1040 215 L1200 262 L1200 320 L0 320Z" />
          <path className="fill-black/40" d="M0 300 C200 270 420 310 640 285 S1000 265 1200 295 L1200 320 L0 320Z" />
          <path className="stroke-saffron/70" fill="none" strokeWidth="3" strokeDasharray="14 14" strokeLinecap="round" d="M-20 312 C180 280 330 306 520 292 S900 268 1220 300" />
        </svg>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-40 pt-32 md:grid-cols-2 md:pb-48 md:pt-40">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-saffron ring-1 ring-white/15">
              Your next adventure starts here
            </p>
            <h1 className="rise-2 mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Where to
              <span className="block text-saffron">next?</span>
            </h1>
            <p className="rise-3 mt-5 max-w-lg text-lg text-white/75">
              Plan epic rides and manage your motorcycle, with a rider community and a gear marketplace coming soon. Every ride. Every bike. One home.
            </p>
            <div className="rise-3 mt-8 flex flex-wrap items-center gap-4">
              <Link href={cta.href} className="rounded-full bg-saffron px-7 py-3.5 font-semibold text-ink shadow-lg shadow-saffron/30 transition hover:bg-saffron-dark">
                {cta.label}
              </Link>
              <a href="#how" className="tap font-medium text-white/80 underline-offset-4 hover:text-white hover:underline">See how it works →</a>
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-white/60">Ride more. Explore more.</p>
            <p className="mt-2 text-xs text-white/60">No bank linking. No live GPS tracking. Just your numbers.</p>
          </div>

          {/* Sample budget card */}
          <div className="rise-3 mx-auto w-full max-w-sm">
            <div className="rotate-1 rounded-3xl bg-surface p-6 text-fg shadow-2xl shadow-black/40 ring-1 ring-black/5 transition hover:rotate-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-subtle">Example trip</p>
                  <p className="text-lg font-bold">Delhi → Jaipur</p>
                </div>
                <span className="rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success-fg">Under budget</span>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Distance</dt><dd className="font-medium">270 km</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Fuel · 9 l @ ₹105</dt><dd className="font-medium">₹945</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Food + other</dt><dd className="font-medium">₹600</dd></div>
                <div className="flex justify-between border-t border-line pt-3 text-base"><dt className="font-semibold">Estimated total</dt><dd className="font-bold">₹1,545</dd></div>
              </dl>
              <div className="mt-5">
                <div className="flex justify-between text-xs text-muted"><span>Spent so far ₹1,420</span><span>92%</span></div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full w-[92%] rounded-full bg-gradient-to-r from-saffron to-amber-400" />
                </div>
                <p className="mt-2 text-xs text-subtle">Example figures only.</p>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* The four doors: two are live, two are coming soon and labelled as such */}
      <section aria-label="What you can do" className="mx-auto -mt-10 max-w-6xl px-5">
        <div className="relative z-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Plan a Ride", d: "Budgets, fuel stops and a checklist for your ride", href: "/trips", soon: false },
            { t: "My Garage", d: "Service reminders, documents and ownership", href: "/bikes", soon: false },
            { t: "Find Riders", d: "Discover riders and join group rides", href: "/rides", soon: false },
            { t: "Gear Marketplace", d: "Pre-owned touring gear", href: "/marketplace", soon: true },
          ].map((x) => (
            <Link key={x.t} href={signedIn ? x.href : x.soon ? x.href : "/signup"}
              className="relative rounded-2xl bg-surface p-5 shadow-lg shadow-black/10 ring-1 ring-line transition hover:-translate-y-1 hover:ring-saffron/50">
              {x.soon && <span className="absolute right-3 top-3 rounded-full bg-saffron px-2.5 py-0.5 text-[11px] font-bold text-ink">Coming soon</span>}
              <p className="text-lg font-bold">{x.t}</p>
              <p className="mt-1 text-sm text-muted">{x.d}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything a long ride needs. Nothing it doesn&apos;t.</h2>
          <p className="mt-3 text-muted">Simple tools that do one job well, so you spend the evening resting, not doing sums.</p>
        </div>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group relative rounded-2xl border border-line bg-surface p-6 transition hover:-translate-y-1 hover:border-saffron/40 hover:shadow-xl hover:shadow-saffron/10">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-saffron/10 text-link transition group-hover:bg-saffron group-hover:text-white">
                <Icon d={f.icon} />
              </span>
              <h3 className="mt-5 text-lg font-semibold">
                {f.soon ? <Link href={f.href ?? "/marketplace"} className="tap after:absolute after:inset-0">{f.title}</Link> : f.title}
              </h3>
              {f.soon && <span className="absolute right-4 top-4 rounded-full bg-saffron px-2.5 py-0.5 text-[11px] font-bold text-ink">Coming soon</span>}
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-sunken py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">From plan to finish line in four steps</h2>
          <ol className="mt-14 grid gap-8 md:grid-cols-4">
            {STEPS.map(([n, t, d]) => (
              <li key={n} className="relative">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-road text-lg font-bold text-saffron ring-1 ring-line">{n}</span>
                <h3 className="mt-4 text-lg font-semibold">{t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="relative overflow-hidden rounded-3xl bg-road px-6 py-14 text-center text-white sm:px-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-saffron/30 blur-3xl" />
          <h2 className="relative text-3xl font-bold sm:text-4xl">Your next long ride starts with a number.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-white/70">Create a free account, add your bike, and have a budget in a couple of minutes.</p>
          <Link href={cta.href} className="relative mt-8 inline-block rounded-full bg-saffron px-8 py-3.5 font-semibold text-ink transition hover:bg-saffron-dark">
            {cta.label}
          </Link>
        </div>
      </section>

      <footer className="border-t border-line py-8">
        <div className="mx-auto max-w-6xl px-5 text-xs leading-relaxed text-muted">
          <p>
            Route, toll, fuel and accommodation figures are estimates based on what you enter. Verify routes and local conditions independently before you ride. This is not navigation, legal or safety advice. Never use your phone while riding.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <span>© 2026 India Long-Ride Planner</span>
            <Link href="/terms" className="underline">Terms</Link>
            <Link href="/pricing" className="underline">Pricing</Link>
            <Link href="/marketplace" className="underline">Marketplace</Link>
            <Link href="/privacy" className="underline">Privacy</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
