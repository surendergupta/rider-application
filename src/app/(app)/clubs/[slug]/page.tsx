import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { Avatar } from "@/components/ProfileCard";
import {
  archiveClub, decideRequest, getClubDetail, inviteMember, leaveClub, removeMember, reportClub, requestJoin, respondToInvite, setMemberRole,
  type ClubMember,
} from "@/features/clubs/service";
import { JOIN_POLICY_LABEL } from "@/features/clubs/validation";
import { PostCard, PostComposer, POST_NOTICES } from "@/components/PostCard";
import { listPosts, shareableTrips } from "@/features/posts/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Club · India Long-Ride Planner" };

type Kind = "join" | "leave" | "respond" | "invite" | "decide" | "remove" | "role" | "archive" | "report";

async function run(kind: Kind, formData: FormData) {
  const { supabase, user } = await requireSession();
  const slug = String(formData.get("slug"));
  const back = `/clubs/${slug}`;
  const limits: Record<Kind, [number, number]> = { join: [30, 60_000], leave: [30, 60_000], respond: [30, 60_000], invite: [30, 60_000], decide: [60, 60_000], remove: [60, 60_000], role: [30, 60_000], archive: [5, 60_000], report: [5, 3_600_000] };
  const [n, w] = limits[kind];
  if (!rateLimit(`club-${kind}:${user.id}`, n, w).allowed) redirect(`${back}?notice=rate`);
  const handle = String(formData.get("handle") ?? "");

  let code: string;
  if (kind === "join") { const r = await requestJoin(supabase, slug); code = r.ok ? (r.status === "active" ? "joined" : "requested") : r.code; }
  else if (kind === "leave") { const r = await leaveClub(supabase, slug); code = r.ok ? "left" : r.code; }
  else if (kind === "respond") { const r = await respondToInvite(supabase, slug, formData.get("accept") === "yes"); code = r.ok ? (r.status === "active" ? "joined" : "declined") : r.code; }
  else if (kind === "invite") { const r = await inviteMember(supabase, slug, formData.get("handle")); code = r.ok ? (r.status === "active" ? "approved" : "invited") : r.code === "VALIDATION_ERROR" ? "bad_handle" : r.code; }
  else if (kind === "decide") { const r = await decideRequest(supabase, slug, handle, formData.get("approve") === "yes"); code = r.ok ? (r.status === "active" ? "approved" : "declined") : r.code; }
  else if (kind === "remove") { const r = await removeMember(supabase, slug, handle); code = r.ok ? "removed" : r.code; }
  else if (kind === "role") { const r = await setMemberRole(supabase, slug, handle, formData.get("role") === "admin" ? "admin" : "member"); code = r.ok ? (r.status === "admin" ? "promoted" : "demoted") : r.code; }
  else if (kind === "archive") { const r = await archiveClub(supabase, user.id, slug); code = r.ok ? "archived" : r.code; }
  else { const r = await reportClub(supabase, user.id, slug, { reason: formData.get("reason"), note: formData.get("note") ?? "" }); code = r.ok ? "reported" : r.code === "VALIDATION_ERROR" ? "report_failed" : r.code; }
  revalidatePath(back); revalidatePath("/clubs");
  redirect(`${back}?notice=${code}`);
}
const joinAction = async (f: FormData) => { "use server"; await run("join", f); };
const leaveAction = async (f: FormData) => { "use server"; await run("leave", f); };
const respondAction = async (f: FormData) => { "use server"; await run("respond", f); };
const inviteAction = async (f: FormData) => { "use server"; await run("invite", f); };
const decideAction = async (f: FormData) => { "use server"; await run("decide", f); };
const removeAction = async (f: FormData) => { "use server"; await run("remove", f); };
const roleAction = async (f: FormData) => { "use server"; await run("role", f); };
const archiveAction = async (f: FormData) => { "use server"; await run("archive", f); };
const reportAction = async (f: FormData) => { "use server"; await run("report", f); };

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  created: { text: "Club created. Invite riders below.", ok: true }, saved: { text: "Club saved.", ok: true },
  joined: { text: "You joined the club.", ok: true }, requested: { text: "Request sent. A club admin will review it.", ok: true },
  left: { text: "You left the club.", ok: true }, declined: { text: "Done.", ok: true }, invited: { text: "Invitation sent.", ok: true },
  approved: { text: "Member added.", ok: true }, removed: { text: "Member removed.", ok: true }, promoted: { text: "Member is now an admin.", ok: true },
  demoted: { text: "Admin role removed.", ok: true }, archived: { text: "Club archived.", ok: true }, reported: { text: "Thanks. Your report was sent to our moderators.", ok: true },
  report_failed: { text: "Choose a reason and try again.", ok: false }, bad_handle: { text: "Enter a rider's handle, like @rider_name.", ok: false },
  club_full: { text: "This club is full.", ok: false }, club_archived: { text: "This club has been archived.", ok: false },
  profile_required: { text: "Create a rider profile first. Other members see it.", ok: false }, invite_only: { text: "This club is invite only.", ok: false },
  already_member: { text: "That rider is already a member.", ok: false }, too_many_invites: { text: "This club has too many pending invitations.", ok: false },
  not_allowed: { text: "Only the owner can do that.", ok: false }, not_found: { text: "That rider could not be found, or cannot be invited.", ok: false },
  rate: { text: "Too many requests. Try again in a little while.", ok: false },
};

export default async function ClubPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { supabase, user } = await requireSession();
  const { slug } = await params;
  const { notice } = await searchParams;
  const detail = await getClubDetail(supabase, user.id, slug);
  if (!detail) notFound();                                         // missing, private, and blocked all look the same

  const { club, isOwner, isManager } = detail;
  const my = club.myStatus;
  const archived = club.status === "archived";
  const n = notice ? (POST_NOTICES[notice] && !NOTICES[notice] ? POST_NOTICES[notice] : NOTICES[notice === "removed" && !isManager ? "club_archived" : notice]) : undefined;
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const hidden = <input type="hidden" name="slug" value={club.slug} />;
  const full = club.members >= club.memberLimit;
  const isMember = my === "active";
  const [feed, trips] = isMember ? await Promise.all([listPosts(supabase, user.id, { kind: "club", slug: club.slug }), shareableTrips(supabase)]) : [null, []];

  return (
    <main className="px-5 py-8">
      <Link href="/clubs" className="tap text-sm underline">← Clubs</Link>
      {n && <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${n.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{n.text}</p>}
      {archived && <p className="mt-3 rounded-lg bg-danger-bg p-3 text-sm font-semibold text-danger-fg" data-testid="archived-banner">This club has been archived.</p>}

      <h1 className="mt-3 break-words text-2xl font-bold">{club.name}</h1>
      <p className="mt-1 text-sm text-muted">{club.location ? `${club.location} · ` : ""}{club.visibility === "private" ? "Private club" : JOIN_POLICY_LABEL[club.joinPolicy]}</p>
      <p className="mt-1 text-sm text-muted" data-testid="member-count">{club.members} of {club.memberLimit} members</p>
      {club.description && <p className="mt-4 whitespace-pre-line break-words leading-relaxed">{club.description}</p>}

      {!isOwner && !archived && (
        <section className="mt-6" aria-label="Your membership">
          {my === "active" && <form action={leaveAction}>{hidden}<p className="text-sm font-semibold text-success-fg">You are a member.</p><button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Leave club</button></form>}
          {my === "requested" && <form action={leaveAction}>{hidden}<p className="text-sm text-muted">Your request is waiting for a club admin.</p><button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Withdraw request</button></form>}
          {my === "invited" && (
            <form action={respondAction} className="flex flex-wrap items-center gap-2">{hidden}<p className="w-full text-sm font-semibold">You are invited to join.</p>
              <button name="accept" value="yes" className="rounded-lg bg-saffron px-5 font-semibold text-ink hover:bg-saffron-dark">Accept</button>
              <button name="accept" value="no" className="rounded-lg border border-line-strong px-5 font-medium hover:bg-sunken">Decline</button></form>
          )}
          {(my === null || my === "declined" || my === "left") && club.visibility === "public" && club.joinPolicy !== "invite" && (
            full ? <p className="text-sm font-semibold text-warn-fg">This club is full.</p> : (
              <form action={joinAction}>{hidden}
                <button className="rounded-lg bg-saffron px-6 font-semibold text-ink hover:bg-saffron-dark">{club.joinPolicy === "open" ? "Join this club" : "Ask to join"}</button>
                <p className="mt-2 text-xs text-muted">Members see your display name and @handle. You need a rider profile; it can stay private.</p></form>
            )
          )}
          {(my === null || my === "declined" || my === "left") && club.joinPolicy === "invite" && <p className="text-sm text-muted">This club is invite only.</p>}
          {my === "removed" && <p className="text-sm text-danger-fg">You were removed from this club.</p>}
        </section>
      )}

      {isManager && !archived && (
        <section className="mt-6 space-y-6" aria-label="Club admin">
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/clubs/${club.slug}/edit`} className="tap rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Edit club</Link>
              <form action={archiveAction}>{hidden}<button className="rounded-lg border border-danger-fg/40 px-4 text-sm font-medium text-danger-fg hover:bg-danger-bg">Archive club</button></form>
            </div>
          )}
          <form action={inviteAction} className="rounded-xl border border-line p-3">{hidden}
            <label className="block text-sm font-medium">Invite a rider by handle
              <input name="handle" required placeholder="@rider_name" autoCapitalize="none" autoComplete="off" spellCheck={false} className={input} aria-describedby="cinv-help" /></label>
            <p id="cinv-help" className="mt-1 text-xs text-muted">Only riders with a public profile can be invited. <Link href="/riders" className="underline">Find riders</Link></p>
            <button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Send invitation</button>
          </form>
          {detail.requested.length > 0 && (
            <div><h2 className="font-semibold">Requests ({detail.requested.length})</h2>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {detail.requested.map((p) => (
                  <li key={p.handle} className="flex flex-wrap items-center justify-between gap-3 p-3"><Person p={p} />
                    <form action={decideAction} className="flex gap-2">{hidden}<input type="hidden" name="handle" value={p.handle} />
                      <button name="approve" value="yes" aria-label={`Approve ${p.displayName}`} className="rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Approve</button>
                      <button name="approve" value="no" aria-label={`Decline ${p.displayName}`} className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Decline</button></form></li>))}
              </ul></div>
          )}
          {detail.invited.length > 0 && (
            <div><h2 className="font-semibold">Invited ({detail.invited.length})</h2>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {detail.invited.map((p) => (
                  <li key={p.handle} className="flex items-center justify-between gap-3 p-3"><Person p={p} />
                    <form action={removeAction}>{hidden}<input type="hidden" name="handle" value={p.handle} />
                      <button aria-label={`Withdraw invitation for ${p.displayName}`} className="rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken">Withdraw</button></form></li>))}
              </ul></div>
          )}
        </section>
      )}

      {detail.members.length > 0 && (
        <section className="mt-8" aria-labelledby="mem">
          <h2 id="mem" className="font-semibold">Members ({detail.members.length})</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {detail.members.map((m) => (
              <li key={m.handle} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <Person p={m} badge={m.role === "owner" ? "Owner" : m.role === "admin" ? "Admin" : undefined} />
                {isManager && !archived && m.role !== "owner" && (
                  <span className="flex gap-2">
                    {isOwner && (
                      <form action={roleAction}>{hidden}<input type="hidden" name="handle" value={m.handle} /><input type="hidden" name="role" value={m.role === "admin" ? "member" : "admin"} />
                        <button aria-label={`${m.role === "admin" ? "Remove admin role from" : "Make admin"} ${m.displayName}`} className="rounded-lg border border-line-strong px-3 text-sm hover:bg-sunken">{m.role === "admin" ? "Remove admin" : "Make admin"}</button></form>
                    )}
                    {(isOwner || m.role !== "admin") && (
                      <form action={removeAction}>{hidden}<input type="hidden" name="handle" value={m.handle} />
                        <button aria-label={`Remove ${m.displayName} from the club`} className="rounded-lg border border-line-strong px-3 text-sm hover:bg-sunken">Remove</button></form>
                    )}
                  </span>
                )}
              </li>))}
          </ul>
        </section>
      )}

      {isMember && !archived && feed && (
        <section className="mt-8" aria-labelledby="cposts">
          <h2 id="cposts" className="font-semibold">Club posts</h2>
          <div className="mt-3"><PostComposer club={club.slug} clubName={club.name} trips={trips} returnTo={`/clubs/${club.slug}`} hasProfile /></div>
          {feed.posts.length === 0 ? <p className="mt-4 text-sm text-muted">No posts yet.</p> : <ul className="mt-4 space-y-3">{feed.posts.map((p) => <PostCard key={p.id} post={p} returnTo={`/clubs/${club.slug}`} />)}</ul>}
          {feed.nextBefore && <p className="mt-3 text-sm text-muted">Showing the latest {feed.posts.length} posts.</p>}
        </section>
      )}

      {!isOwner && (
        <details className="mt-8 rounded-lg border border-line p-3">
          <summary className="tap cursor-pointer text-sm font-medium">Report this club</summary>
          <form action={reportAction} className="mt-3 space-y-3">{hidden}
            <label className="block text-sm">Reason
              <select name="reason" required defaultValue="" className={input}>
                <option value="" disabled>Choose a reason</option><option value="spam">Spam</option><option value="unsafe">Unsafe</option>
                <option value="inappropriate">Inappropriate</option><option value="harassment">Harassment</option><option value="other">Something else</option>
              </select></label>
            <label className="block text-sm">Details (optional)<textarea name="note" rows={3} maxLength={500} className={input} /></label>
            <button className="rounded-lg bg-saffron px-5 font-semibold text-ink hover:bg-saffron-dark">Send report</button>
          </form>
        </details>
      )}
      <p className="mt-8 text-xs text-muted">We do not verify clubs or riders. Meet in public places, ride within your ability and never use your phone while riding.</p>
    </main>
  );
}

function Person({ p, badge }: { p: ClubMember; badge?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar initials={p.initials} color={p.avatarColor} size={36} />
      <span className="min-w-0 text-sm">
        <strong className="block truncate">{p.displayName}{badge ? <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">{badge}</span> : null}</strong>
        {p.hasPublicProfile ? <Link href={`/rider/${p.handle}`} className="text-muted underline">@{p.handle}</Link> : <span className="text-muted">@{p.handle}</span>}
      </span>
    </span>
  );
}
