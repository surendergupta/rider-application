import Link from "next/link";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { Avatar } from "@/components/ProfileCard";
import { discoverRiders, discoveryFilterSchema } from "@/features/profile/discovery";
import { INTERESTS } from "@/features/profile/validation";

export const metadata = { title: "Find riders · India Long-Ride Planner" };
export const dynamic = "force-dynamic";

export default async function RidersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, user } = await requireSession();
  const sp = await searchParams;
  const filters = discoveryFilterSchema.parse({ q: sp.q ?? "", state: sp.state ?? "", interest: sp.interest ?? "", page: sp.page ?? 1 });
  const { data: mine } = await supabase.from("rider_profiles").select("is_public, discoverable").eq("user_id", user.id).maybeSingle();

  // Signed-in riders only, rate limited, so the directory cannot be bulk-scraped.
  const allowed = rateLimit(`riders-search:${user.id}`, 30, 60_000).allowed;
  const { riders, page, hasMore } = allowed ? await discoverRiders(user.id, filters) : { riders: [], page: 1, hasMore: false };
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const qs = (p: number) => { const u = new URLSearchParams(); if (filters.q) u.set("q", filters.q); if (filters.state) u.set("state", filters.state); if (filters.interest) u.set("interest", filters.interest); u.set("page", String(p)); return `/riders?${u}`; };

  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">Find riders</h1>
      <p className="mt-1 text-sm text-muted">Riders who chose to be listed. Only what they made public is shown.</p>

      {!mine?.discoverable && (
        <p className="mt-4 rounded-lg bg-sunken p-3 text-sm text-muted">
          You are not listed here. To let other riders find you, make your <Link href="/profile" className="font-semibold text-link underline">profile</Link> Public and turn on rider discovery.
        </p>
      )}

      <form method="get" className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
        <label className="col-span-2 block text-sm">Name or handle
          <input name="q" defaultValue={filters.q} maxLength={40} className={input} />
        </label>
        <label className="block text-sm">State
          <input name="state" defaultValue={filters.state} maxLength={60} className={input} />
        </label>
        <label className="block text-sm">Interest
          <select name="interest" defaultValue={filters.interest} className={input}>
            <option value="">Any</option>{INTERESTS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </label>
        <button className="col-span-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Search riders</button>
      </form>

      {!allowed && <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">Too many searches. Try again in a minute.</p>}
      {allowed && riders.length === 0 && <p className="mt-6 text-sm text-muted">No riders match yet. As more riders turn on discovery, they will appear here.</p>}

      <ul className="mt-5 space-y-3">
        {riders.map((r) => (
          <li key={r.handle}>
            <Link href={`/rider/${r.handle}`} className="block rounded-xl border border-line p-4 transition hover:bg-sunken">
              <span className="flex items-center gap-3">
                <Avatar initials={r.initials} color={r.avatarColor} size={44} />
                <span className="min-w-0">
                  <strong className="block truncate">{r.displayName}</strong>
                  <span className="text-sm text-muted">@{r.handle}{r.location ? ` · ${r.location}` : ""}</span>
                </span>
              </span>
              {r.bio && <p className="mt-2 break-words text-sm">{r.bio}</p>}
              {r.interests.length > 0 && (
                <span className="mt-2 flex flex-wrap gap-1.5">{r.interests.map((i) => <span key={i.id} className="rounded-full bg-sunken px-2.5 py-0.5 text-xs">{i.label}</span>)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {(page > 1 || hasMore) && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="tap underline">← Previous</Link> : <span />}
          {hasMore && <Link href={qs(page + 1)} className="tap underline">Next →</Link>}
        </nav>
      )}
    </main>
  );
}
