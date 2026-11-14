import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, supabaseConfigured } from "@/lib/db/server";

export const metadata: Metadata = { title: "Pricing · India Long-Ride Planner" };
export const dynamic = "force-dynamic";

const PLANS = ["tour_pass", "pro_monthly", "pro_yearly", "club_pro"] as const;
type Plan = (typeof PLANS)[number];

async function joinEarlyAccess(formData: FormData) {
  "use server";
  const plan = String(formData.get("plan")) as Plan;
  if (!PLANS.includes(plan)) redirect("/pricing");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/signup");
  // One row per user: choosing again just changes the plan. No payment details are collected.
  await supabase.from("pro_interest").upsert({ user_id: data.user.id, plan }, { onConflict: "user_id" });
  revalidatePath("/pricing");
}

const FREE = [
  "Garage: multiple bikes, service log and reminders",
  "Insurance and PUC expiry reminders",
  "Trip budgets with your real mileage from fuel fills",
  "Fuel-stop planner and ride readiness checklist",
  "Expense log, actual vs estimate, CSV export",
  "Offline map of India and shareable trip summary",
];

interface Card {
  id: string;
  name: string;
  price: string;
  unit: string;
  blurb: string;
  features: string[];
  buttons: { plan: Plan; label: string }[];
}

const PAID: Card[] = [
  {
    id: "tour", name: "Tour Pass", price: "₹149", unit: "per trip",
    blurb: "For one big tour.",
    features: ["Advanced itinerary with daily stops", "Group budget tools", "Detailed trip report export"],
    buttons: [{ plan: "tour_pass", label: "₹149 per trip" }],
  },
  {
    id: "pro", name: "Rider Pro", price: "₹199", unit: "per month",
    blurb: "For riders who tour often. Yearly plan being tested.",
    features: ["Advanced trip tools across rides", "Ownership cost analysis", "Premium exports", "Enhanced route planning"],
    buttons: [{ plan: "pro_monthly", label: "₹199 / month" }, { plan: "pro_yearly", label: "₹1,499 / year" }],
  },
  {
    id: "club", name: "Club Pro", price: "₹499", unit: "per club / month",
    blurb: "For ride organisers. Pilot.",
    features: ["Club dashboard and member management", "Ride scheduling and RSVPs", "Shared trip reporting"],
    buttons: [{ plan: "club_pro", label: "₹499 / club / month" }],
  },
];

export default async function Pricing() {
  let signedIn = false, chosen: string | null = null;
  if (supabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      signedIn = true;
      const { data: row } = await supabase.from("pro_interest").select("plan").maybeSingle();
      chosen = row?.plan ?? null;
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-road text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="tap font-bold">Long-Ride Planner</Link>
          <Link href={signedIn ? "/home" : "/login"} className="tap text-sm text-white/80 hover:text-white">{signedIn ? "Open app" : "Sign in"}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">A free rider account that stays useful</h1>
          <p className="mt-3 text-muted">
            Your garage, service reminders, budgets and checklists are free, and will stay free. Paid plans are for the heavy lifting:
            complex tours, organised groups and ownership analysis. They are not on sale yet. Tell us which you would choose and we will build for the people who ask.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-4">
          <section className="rounded-3xl bg-surface p-6 shadow-sm ring-1 ring-line">
            <h2 className="text-lg font-bold">Free Rider</h2>
            <p className="mt-1 text-3xl font-extrabold">₹0</p>
            <p className="text-sm text-muted">Available now. Free forever.</p>
            <ul className="mt-5 space-y-2 text-sm">
              {FREE.map((f) => <li key={f} className="flex gap-2"><span className="text-success-fg" aria-hidden="true">✓</span>{f}</li>)}
            </ul>
            <Link href={signedIn ? "/home" : "/signup"} className="mt-6 block rounded-full border border-line-strong py-3 text-center font-semibold hover:bg-sunken">
              {signedIn ? "Open your garage" : "Start free"}
            </Link>
          </section>

          {PAID.map((c) => (
            <section key={c.id} className={`relative rounded-3xl p-6 shadow-sm ${c.id === "pro" ? "bg-road text-white shadow-xl" : "bg-surface ring-1 ring-line"}`}>
              <span className="absolute right-4 top-4 rounded-full bg-saffron px-2.5 py-0.5 text-[11px] font-bold text-ink">Early access</span>
              <h2 className="text-lg font-bold">{c.name}</h2>
              <p className="mt-1 text-3xl font-extrabold">{c.price}<span className={`text-sm font-medium ${c.id === "pro" ? "text-white/60" : "text-muted"}`}> {c.unit}</span></p>
              <p className={`text-sm ${c.id === "pro" ? "text-white/60" : "text-muted"}`}>{c.blurb}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {c.features.map((f) => (
                  <li key={f} className="flex gap-2"><span className="text-saffron" aria-hidden="true">○</span>{f} <span className={c.id === "pro" ? "text-white/40" : "text-subtle"}>(coming)</span></li>
                ))}
              </ul>
              {signedIn ? (
                <form action={joinEarlyAccess} className="mt-6 space-y-2">
                  {c.buttons.map((b) => (
                    <button key={b.plan} name="plan" value={b.plan}
                      className={`w-full rounded-full py-2.5 text-sm font-semibold transition ${chosen === b.plan ? "bg-saffron text-ink" : c.id === "pro" ? "bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20" : "border border-line-strong hover:bg-sunken"}`}>
                      {chosen === b.plan ? "✓ " : ""}{b.label}
                    </button>
                  ))}
                </form>
              ) : (
                <Link href="/signup" className="mt-6 block rounded-full bg-saffron py-2.5 text-center text-sm font-semibold text-ink hover:bg-saffron-dark">
                  Create an account to join early access
                </Link>
              )}
            </section>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted" role="status">
          {signedIn ? (chosen ? "You are on the early-access list. You can change your pick any time." : "Pick the plan you would choose. No payment is taken.") : ""}
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-muted">
          No card or payment details are collected here. These are proposed validation prices, not final; taxes, fees and subscription terms will be set before anything is sold. Marketplace listings are planned to be free with no commission.
        </p>
      </main>
    </div>
  );
}
