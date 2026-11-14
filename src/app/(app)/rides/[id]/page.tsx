import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { Avatar } from "@/components/ProfileCard";
import { formatRideDate } from "@/components/RideCard";
import {
  cancelRide, decideRequest, getRideDetail, inviteRider, leaveRide, removeRider, reportRide, requestJoin, respondToInvite,
} from "@/features/rides/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ride · India Long-Ride Planner" };

type Kind = "join" | "leave" | "respond" | "invite" | "decide" | "remove" | "cancel" | "report";

async function run(kind: Kind, formData: FormData) {
  const { supabase, user } = await requireSession();
  const id = String(formData.get("ride_id"));
  const back = `/rides/${id}`;
  const limits: Record<Kind, [number, number]> = { join: [30, 60_000], leave: [30, 60_000], respond: [30, 60_000], invite: [30, 60_000], decide: [60, 60_000], remove: [60, 60_000], cancel: [10, 60_000], report: [5, 3_600_000] };
  const [n, w] = limits[kind];
  if (!rateLimit(`ride-${kind}:${user.id}`, n, w).allowed) redirect(`${back}?notice=rate`);

  let code: string;
  if (kind === "join") { const r = await requestJoin(supabase, id); code = r.ok ? (r.status === "going" ? "joined" : "requested") : r.code; }
  else if (kind === "leave") { const r = await leaveRide(supabase, id); code = r.ok ? "left" : r.code; }
  else if (kind === "respond") { const r = await respondToInvite(supabase, id, formData.get("accept") === "yes"); code = r.ok ? (r.status === "going" ? "joined" : "declined") : r.code; }
  else if (kind === "invite") { const r = await inviteRider(supabase, id, formData.get("handle")); code = r.ok ? (r.status === "going" ? "approved" : "invited") : r.code === "VALIDATION_ERROR" ? "bad_handle" : r.code; }
  else if (kind === "decide") { const r = await decideRequest(supabase, id, String(formData.get("handle")), formData.get("approve") === "yes"); code = r.ok ? (r.status === "going" ? "approved" : "declined") : r.code; }
  else if (kind === "remove") { const r = await removeRider(supabase, id, String(formData.get("handle"))); code = r.ok ? "removed" : r.code; }
  else if (kind === "cancel") { const r = await cancelRide(supabase, user.id, id); code = r.ok ? "cancelled" : r.code; }
  else { const r = await reportRide(supabase, user.id, id, { reason: formData.get("reason"), note: formData.get("note") ?? "" }); code = r.ok ? "reported" : r.code === "VALIDATION_ERROR" ? "report_failed" : r.code; }
  revalidatePath(back); revalidatePath("/rides");
  redirect(`${back}?notice=${code}`);
}
const joinAction = async (f: FormData) => { "use server"; await run("join", f); };
const leaveAction = async (f: FormData) => { "use server"; await run("leave", f); };
const respondAction = async (f: FormData) => { "use server"; await run("respond", f); };
const inviteAction = async (f: FormData) => { "use server"; await run("invite", f); };
const decideAction = async (f: FormData) => { "use server"; await run("decide", f); };
const removeAction = async (f: FormData) => { "use server"; await run("remove", f); };
const cancelAction = async (f: FormData) => { "use server"; await run("cancel", f); };
const reportAction = async (f: FormData) => { "use server"; await run("report", f); };

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  created: { text: "Ride created. Invite riders below, or share it with the riders you know.", ok: true },
  saved: { text: "Ride saved.", ok: true },
  joined: { text: "You are going. The meeting point is shown below.", ok: true },
  requested: { text: "Request sent. The host will review it.", ok: true },
  left: { text: "You are no longer part of this ride.", ok: true },
  declined: { text: "Done.", ok: true },
  invited: { text: "Invitation sent.", ok: true },
  approved: { text: "Rider confirmed.", ok: true },
  removed: { text: "Rider removed.", ok: true },
  cancelled: { text: "Ride cancelled.", ok: true },
  reported: { text: "Thanks. Your report was sent to our moderators.", ok: true },
  report_failed: { text: "Choose a reason and try again.", ok: false },
  bad_handle: { text: "Enter a rider's handle, like @rider_name.", ok: false },
  ride_full: { text: "This ride is full.", ok: false },
  ride_closed: { text: "This ride is no longer open.", ok: false },
  profile_required: { text: "Create a rider profile first. Other riders see it next to your ride.", ok: false },
  removed_you: { text: "The host has removed you from this ride.", ok: false },
  already_going: { text: "That rider is already going.", ok: false },
  too_many_invites: { text: "This ride has too many pending invitations.", ok: false },
  not_found: { text: "That rider could not be found, or cannot be invited.", ok: false },
  rate: { text: "Too many requests. Try again in a little while.", ok: false },
};
const STATUS_LABEL: Record<string, string> = { going: "Going", requested: "Asked to join", invited: "Invited", declined: "Declined", removed: "Removed", left: "Left" };

export default async function RidePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { supabase, user } = await requireSession();
  const { id } = await params;
  const { notice } = await searchParams;
  const detail = await getRideDetail(supabase, user.id, id);
  if (!detail) notFound();                                          // missing, hidden, cancelled-for-strangers and blocked all look the same

  const { ride, isHost, myStatus } = detail;
  const open = ride.state === "open" || ride.state === "full";
  const n = notice ? NOTICES[notice === "removed" && !isHost ? "removed_you" : notice] : undefined;
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const going = detail.participants.filter((p) => p.status === "going");
  const requested = detail.participants.filter((p) => p.status === "requested");
  const invited = detail.participants.filter((p) => p.status === "invited");
  const hidden = <input type="hidden" name="ride_id" value={ride.id} />;

  return (
    <main className="px-5 py-8">
      <Link href="/rides" className="tap text-sm underline">← Rides</Link>
      {n && <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${n.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{n.text}</p>}
      {ride.state === "cancelled" && <p className="mt-3 rounded-lg bg-danger-bg p-3 text-sm font-semibold text-danger-fg" data-testid="cancelled-banner">This ride was cancelled by the host.</p>}

      <h1 className="mt-3 break-words text-2xl font-bold">{ride.title}</h1>
      <p className="mt-1 text-muted">{ride.area}{ride.destination ? ` → ${ride.destination}` : ""}{ride.distanceKm != null ? ` · ${ride.distanceKm} km` : ""}</p>
      <p className="mt-1 font-medium">{formatRideDate(ride.startsOn, ride.endsOn, ride.startTime)}</p>
      <p className="mt-1 text-sm text-muted" data-testid="rider-count">
        {ride.going} of {ride.maxRiders} riders confirmed · {ride.visibility === "invite_only" ? "Invite only" : ride.requiresApproval ? "Host approves each rider" : "Anyone can join"}
      </p>
      {ride.host && (
        <p className="mt-3 flex items-center gap-2 text-sm">
          <Avatar initials={ride.host.initials} color={ride.host.avatarColor} size={32} />
          <span>Hosted by <strong>{ride.host.displayName}</strong> <span className="text-muted">@{ride.host.handle}</span></span>
        </p>
      )}
      {ride.description && <p className="mt-4 whitespace-pre-line break-words leading-relaxed">{ride.description}</p>}

      {(detail.meetingPoint || detail.hostNote) && (
        <section className="mt-5 rounded-xl border border-line p-4" aria-labelledby="meet" data-testid="private-details">
          <h2 id="meet" className="font-semibold">For confirmed riders</h2>
          {detail.meetingPoint && <p className="mt-2 text-sm"><span className="text-muted">Meeting point: </span><strong>{detail.meetingPoint}</strong></p>}
          {detail.hostNote && <p className="mt-2 whitespace-pre-line text-sm"><span className="text-muted">Note from the host: </span>{detail.hostNote}</p>}
        </section>
      )}
      {!isHost && myStatus !== "going" && open && (
        <p className="mt-5 rounded-lg bg-sunken p-3 text-sm text-muted">The exact meeting point is shared with riders the host confirms.</p>
      )}

      {/* What this viewer can do */}
      {!isHost && open && (
        <section className="mt-6" aria-label="Your place on this ride">
          {myStatus === "going" && (
            <form action={leaveAction}>{hidden}<p className="text-sm font-semibold text-success-fg">You are going.</p>
              <button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Leave this ride</button></form>
          )}
          {myStatus === "requested" && (
            <form action={leaveAction}>{hidden}<p className="text-sm text-muted">Your request is waiting for the host.</p>
              <button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Withdraw request</button></form>
          )}
          {myStatus === "invited" && (
            <form action={respondAction} className="flex flex-wrap items-center gap-2">{hidden}<p className="w-full text-sm font-semibold">The host invited you.</p>
              <button name="accept" value="yes" className="rounded-lg bg-saffron px-5 font-semibold text-ink hover:bg-saffron-dark">Accept</button>
              <button name="accept" value="no" className="rounded-lg border border-line-strong px-5 font-medium hover:bg-sunken">Decline</button></form>
          )}
          {(myStatus === null || myStatus === "declined" || myStatus === "left") && ride.visibility === "public" && ride.state === "open" && (
            <form action={joinAction}>{hidden}
              <button className="rounded-lg bg-saffron px-6 font-semibold text-ink hover:bg-saffron-dark">{ride.requiresApproval ? "Ask to join" : "Join this ride"}</button>
              <p className="mt-2 text-xs text-muted">Your display name and @handle will be visible to riders on this ride. You need a rider profile; it can stay private.</p></form>
          )}
          {ride.state === "full" && myStatus !== "going" && myStatus !== "invited" && <p className="text-sm font-semibold text-warn-fg">This ride is full.</p>}
          {myStatus === "removed" && <p className="text-sm text-danger-fg">The host has removed you from this ride.</p>}
        </section>
      )}

      {/* Host controls */}
      {isHost && (
        <section className="mt-6 space-y-6" aria-label="Host controls">
          {open && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/rides/${ride.id}/edit`} className="tap rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Edit ride</Link>
              <form action={cancelAction}>{hidden}<button className="rounded-lg border border-danger-fg/40 px-4 text-sm font-medium text-danger-fg hover:bg-danger-bg">Cancel ride</button></form>
            </div>
          )}
          {open && (
            <form action={inviteAction} className="rounded-xl border border-line p-3">
              {hidden}
              <label className="block text-sm font-medium">Invite a rider by handle
                <input name="handle" required placeholder="@rider_name" autoCapitalize="none" autoComplete="off" spellCheck={false} className={input} aria-describedby="inv-help" />
              </label>
              <p id="inv-help" className="mt-1 text-xs text-muted">Only riders with a public profile can be invited. <Link href="/riders" className="underline">Find riders</Link></p>
              <button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Send invitation</button>
            </form>
          )}
          {requested.length > 0 && (
            <div><h2 className="font-semibold">Requests ({requested.length})</h2>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {requested.map((p) => (
                  <li key={p.handle} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <PersonLine p={p} />
                    <form action={decideAction} className="flex gap-2">{hidden}<input type="hidden" name="handle" value={p.handle} />
                      <button name="approve" value="yes" aria-label={`Approve ${p.displayName}`} className="rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:bg-saffron-dark">Approve</button>
                      <button name="approve" value="no" aria-label={`Decline ${p.displayName}`} className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Decline</button></form>
                  </li>))}
              </ul></div>
          )}
          {invited.length > 0 && (
            <div><h2 className="font-semibold">Invited ({invited.length})</h2>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {invited.map((p) => (
                  <li key={p.handle} className="flex items-center justify-between gap-3 p-3"><PersonLine p={p} />
                    <form action={removeAction}>{hidden}<input type="hidden" name="handle" value={p.handle} />
                      <button aria-label={`Withdraw invitation for ${p.displayName}`} className="rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken">Withdraw</button></form></li>))}
              </ul></div>
          )}
        </section>
      )}

      {/* Confirmed riders are visible to the host and to other confirmed riders only */}
      {(isHost || myStatus === "going") && going.length > 0 && (
        <section className="mt-8" aria-labelledby="who">
          <h2 id="who" className="font-semibold">Who is going ({going.length})</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {going.map((p) => (
              <li key={p.handle} className="flex items-center justify-between gap-3 p-3">
                <PersonLine p={p} badge={p.isHost ? "Host" : undefined} />
                {isHost && !p.isHost && open && (
                  <form action={removeAction}>{hidden}<input type="hidden" name="handle" value={p.handle} />
                    <button aria-label={`Remove ${p.displayName} from the ride`} className="rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken">Remove</button></form>
                )}
              </li>))}
          </ul>
        </section>
      )}

      {!isHost && (
        <details className="mt-8 rounded-lg border border-line p-3">
          <summary className="tap cursor-pointer text-sm font-medium">Report this ride</summary>
          <form action={reportAction} className="mt-3 space-y-3">{hidden}
            <label className="block text-sm">Reason
              <select name="reason" required defaultValue="" className={input}>
                <option value="" disabled>Choose a reason</option><option value="unsafe">Unsafe</option><option value="spam">Spam</option>
                <option value="inappropriate">Inappropriate</option><option value="harassment">Harassment</option><option value="other">Something else</option>
              </select></label>
            <label className="block text-sm">Details (optional)<textarea name="note" rows={3} maxLength={500} className={input} /></label>
            <button className="rounded-lg bg-saffron px-5 font-semibold text-ink hover:bg-saffron-dark">Send report</button>
          </form>
        </details>
      )}
      <p className="mt-8 text-xs text-muted">Group rides carry real risk. Meet in a public place, check who you are riding with, ride within your ability and never use your phone while riding. We do not verify riders.</p>
    </main>
  );
}

function PersonLine({ p, badge }: { p: { displayName: string; handle: string; initials: string; avatarColor: Parameters<typeof Avatar>[0]["color"]; hasPublicProfile: boolean; status?: string }; badge?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar initials={p.initials} color={p.avatarColor} size={36} />
      <span className="min-w-0 text-sm">
        <strong className="block truncate">{p.displayName}{badge ? <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">{badge}</span> : null}</strong>
        {p.hasPublicProfile
          ? <Link href={`/rider/${p.handle}`} className="text-muted underline">@{p.handle}</Link>
          : <span className="text-muted">@{p.handle}</span>}
        {p.status && p.status !== "going" && <span className="ml-2 text-xs text-muted">{STATUS_LABEL[p.status] ?? p.status}</span>}
      </span>
    </span>
  );
}
