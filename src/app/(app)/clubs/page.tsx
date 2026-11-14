import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { Avatar } from "@/components/ProfileCard";
import { decideRequest, listPublicClubs, myClubsDashboard, respondToInvite, type ClubCard } from "@/features/clubs/service";
import { JOIN_POLICY_LABEL, clubFilterSchema } from "@/features/clubs/validation";

export const metadata = { title: "Clubs · India Long-Ride Planner" };
export const dynamic = "force-dynamic";

async function respondAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  if (!rateLimit(`club-act:${user.id}`, 60, 60_000).allowed) redirect("/clubs?notice=rate");
  const r = await respondToInvite(supabase, String(formData.get("slug")), formData.get("accept") === "yes");
  revalidatePath("/clubs");
  redirect(`/clubs?notice=${r.ok ? (r.status === "active" ? "joined" : "declined") : r.code}`);
}

async function decideAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  if (!rateLimit(`club-act:${user.id}`, 60, 60_000).allowed) redirect("/clubs?notice=rate");
  const r = await decideRequest(supabase, String(formData.get("slug")), String(formData.get("handle")), formData.get("approve") === "yes");
  revalidatePath("/clubs");
  redirect(`/clubs?notice=${r.ok ? (r.status === "active" ? "approved" : "declined") : r.code}`);
}

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  joined: { text: "You joined the club.", ok: true }, declined: { text: "Done.", ok: true }, approved: { text: "Member approved.", ok: true },
  club_full: { text: "This club is full.", ok: false }, club_archived: { text: "This club has been archived.", ok: false },
  not_found: { text: "That club or rider could not be found.", ok: false }, rate: { text: "Too many requests. Try again in a little while.", ok: false },
};

function ClubRow({ c }: { c: ClubCard }) {
  return (
    <li>
      <Link href={`/clubs/${c.slug}`} className="block rounded-xl border border-line p-4 transition hover:bg-sunken">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words font-semibold">{c.name}</h3>
          <span className="shrink-0 rounded-full bg-sunken px-2.5 py-0.5 text-xs text-muted">{c.visibility === "private" ? "Private" : JOIN_POLICY_LABEL[c.joinPolicy]}</span>
        </div>
        {c.location && <p className="mt-1 text-sm text-muted">{c.location}</p>}
        {c.description && <p className="mt-2 break-words text-sm">{c.description.length > 140 ? c.description.slice(0, 140) + "…" : c.description}</p>}
        <p className="mt-2 text-xs text-muted">{c.members} of {c.memberLimit} members</p>
        {c.myStatus && <p className="mt-1 text-xs font-semibold text-link">{c.myRole === "owner" ? "You own this club" : c.myRole === "admin" ? "You are an admin" : c.myStatus === "active" ? "You are a member" : c.myStatus === "requested" ? "Request sent" : c.myStatus === "invited" ? "You are invited" : ""}</p>}
      </Link>
    </li>
  );
}

export default async function ClubsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, user } = await requireSession();
  const sp = await searchParams;
  const filters = clubFilterSchema.parse({ q: sp.q ?? "", state: sp.state ?? "" });
  const [dash, found, { data: profile }] = await Promise.all([
    myClubsDashboard(supabase, user.id),
    listPublicClubs(supabase, user.id, filters),
    supabase.from("rider_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const notice = sp.notice ? NOTICES[sp.notice] : undefined;
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const mineSlugs = new Set(dash.mine.map((m) => m.slug));
  const others = found.filter((c) => !mineSlugs.has(c.slug));

  return (
    <main className="px-5 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clubs</h1>
          <p className="mt-1 text-sm text-muted">Riding clubs you can join or start. <Link href="/rides" className="underline">Rides</Link> · <Link href="/riders" className="underline">Find riders</Link></p>
        </div>
        <Link href={profile ? "/clubs/new" : "/profile"} className="tap shrink-0 rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Start a club</Link>
      </div>
      {!profile && (
        <p className="mt-4 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">
          Create a <Link href="/profile" className="font-semibold underline">rider profile</Link> to join or start a club. Members see each other&apos;s name and handle. The profile can stay private.
        </p>
      )}
      {notice && <p role="status" className={`mt-4 rounded-lg p-3 text-sm ${notice.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{notice.text}</p>}

      {dash.invitations.length > 0 && (
        <section className="mt-8" aria-labelledby="cinv">
          <h2 id="cinv" className="text-lg font-semibold">Invitations ({dash.invitations.length})</h2>
          <ul className="mt-3 space-y-3">
            {dash.invitations.map((c) => (
              <li key={c.slug} className="rounded-xl border border-saffron/50 p-4">
                <Link href={`/clubs/${c.slug}`} className="tap font-semibold underline">{c.name}</Link>
                <p className="text-sm text-muted">{c.location ?? "No location"} · {c.members} of {c.memberLimit} members</p>
                <form action={respondAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="slug" value={c.slug} />
                  <button name="accept" value="yes" className="rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Accept</button>
                  <button name="accept" value="no" className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Decline</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dash.requests.length > 0 && (
        <section className="mt-8" aria-labelledby="creq">
          <h2 id="creq" className="text-lg font-semibold">Requests to review ({dash.requests.length})</h2>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {dash.requests.map((q) => (
              <li key={`${q.clubSlug}-${q.person.handle}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar initials={q.person.initials} color={q.person.avatarColor} size={36} />
                  <span className="min-w-0 text-sm"><strong className="block truncate">{q.person.displayName}</strong><span className="text-muted">@{q.person.handle} · {q.clubName}</span></span>
                </span>
                <form action={decideAction} className="flex gap-2">
                  <input type="hidden" name="slug" value={q.clubSlug} /><input type="hidden" name="handle" value={q.person.handle} />
                  <button name="approve" value="yes" aria-label={`Approve ${q.person.displayName} for ${q.clubName}`} className="rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Approve</button>
                  <button name="approve" value="no" aria-label={`Decline ${q.person.displayName} for ${q.clubName}`} className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Decline</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dash.mine.length > 0 && (<section className="mt-8"><h2 className="text-lg font-semibold">Your clubs</h2><ul className="mt-3 space-y-3">{dash.mine.map((c) => <ClubRow key={c.slug} c={c} />)}</ul></section>)}
      {dash.pending.length > 0 && (<section className="mt-8"><h2 className="text-lg font-semibold">Requests you sent</h2><ul className="mt-3 space-y-3">{dash.pending.map((c) => <ClubRow key={c.slug} c={c} />)}</ul></section>)}

      <section className="mt-10" aria-labelledby="cfind">
        <h2 id="cfind" className="text-lg font-semibold">Find clubs</h2>
        <form method="get" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
          <label className="block text-sm">Club name<input name="q" defaultValue={filters.q} maxLength={40} className={input} /></label>
          <label className="block text-sm">State<input name="state" defaultValue={filters.state} maxLength={60} className={input} /></label>
          <button className="col-span-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Search clubs</button>
        </form>
        {others.length === 0 ? <p className="mt-4 text-sm text-muted">No public clubs match yet. Start one for your riding group.</p>
          : <ul className="mt-4 space-y-3">{others.map((c) => <ClubRow key={c.slug} c={c} />)}</ul>}
      </section>
    </main>
  );
}
