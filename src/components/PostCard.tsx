import Link from "next/link";
import { Avatar } from "@/components/ProfileCard";
import type { PostCard as Post, ShareableTrip } from "@/features/posts/service";
import { removePostAction, reportPostAction, sendPostAction } from "@/features/posts/actions";
import { MAX_POST_LENGTH, formatKm } from "@/features/posts/validation";

const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const day = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

/** Plain text only: React escapes the body, so a hostile post cannot inject markup. */
export function PostCard({ post, returnTo }: { post: Post; returnTo: string }) {
  const a = post.author;
  return (
    <li className="rounded-xl border border-line p-4" data-testid="post">
      <div className="flex items-start gap-3">
        {a ? <Avatar initials={a.initials} color={a.avatarColor} size={36} /> : <span className="h-9 w-9 shrink-0 rounded-full bg-sunken" aria-hidden="true" />}
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate">
            <strong>{a?.displayName ?? "A rider"}</strong>{" "}
            {a && (a.hasPublicProfile ? <Link href={`/rider/${a.handle}`} className="text-muted underline">@{a.handle}</Link> : <span className="text-muted">@{a.handle}</span>)}
          </p>
          <p className="text-xs text-muted">
            <time dateTime={post.createdAt}>{when(post.createdAt)}</time>
            {post.club ? <> · <Link href={`/clubs/${post.club.slug}`} className="underline">{post.club.name}</Link> (members only)</> : " · Community"}
          </p>
        </div>
      </div>

      {post.story && (
        <div className="mt-3 rounded-lg bg-sunken p-3" data-testid="ride-story">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Ride story</p>
          <p className="mt-1 break-words font-semibold">{post.story.title}</p>
          <p className="text-sm text-muted">
            {[post.story.distanceKm != null ? formatKm(post.story.distanceKm) : null, post.story.destination ? `to ${post.story.destination}` : null, `completed ${day(post.story.completedOn)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}
      {post.body && <p className="mt-3 whitespace-pre-line break-words leading-relaxed">{post.body}</p>}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {post.canRemove && (
          <form action={removePostAction}>
            <input type="hidden" name="id" value={post.id} /><input type="hidden" name="returnTo" value={returnTo} />
            <button className="rounded-lg border border-line-strong px-3 text-sm hover:bg-sunken" aria-label={post.mine ? "Delete your post" : "Remove this post from the club"}>{post.mine ? "Delete" : "Remove"}</button>
          </form>
        )}
        {!post.mine && (
          <details className="rounded-lg border border-line px-3">
            <summary className="tap cursor-pointer text-sm">Report</summary>
            <form action={reportPostAction} className="space-y-2 pb-3">
              <input type="hidden" name="id" value={post.id} /><input type="hidden" name="returnTo" value={returnTo} />
              <label className="block text-sm">Reason
                <select name="reason" required defaultValue="" className={input}>
                  <option value="" disabled>Choose a reason</option><option value="spam">Spam</option><option value="unsafe">Unsafe</option>
                  <option value="inappropriate">Inappropriate</option><option value="harassment">Harassment</option><option value="other">Something else</option>
                </select></label>
              <label className="block text-sm">Details (optional)<textarea name="note" rows={2} maxLength={500} className={input} /></label>
              <button className="rounded-lg bg-saffron px-4 font-semibold text-ink hover:bg-saffron-dark">Send report</button>
            </form>
          </details>
        )}
      </div>
    </li>
  );
}

/** `club` is a club slug for a members-only post, or omitted for the whole community. */
export function PostComposer({ club, clubName, trips, returnTo, hasProfile }: { club?: string; clubName?: string; trips: ShareableTrip[]; returnTo: string; hasProfile: boolean }) {
  if (!hasProfile) {
    return <p className="rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">Create a <Link href="/profile" className="font-semibold underline">rider profile</Link> to post. Other riders see your name and handle on posts. The profile can stay private.</p>;
  }
  const id = club ? `compose-${club}` : "compose";
  return (
    <form action={sendPostAction} className="rounded-xl border border-line p-4" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="font-semibold">{clubName ? `Post to ${clubName}` : "Share with the community"}</h2>
      <p className="mt-1 text-xs text-muted">{clubName ? "Only active members of this club can see it." : "Every signed-in rider can see it."} Do not post phone numbers, addresses or your live location.</p>
      <input type="hidden" name="returnTo" value={returnTo} />
      {club && <input type="hidden" name="club" value={club} />}
      <label className="mt-3 block text-sm font-medium">Your post
        <textarea name="body" rows={3} maxLength={MAX_POST_LENGTH} className={input} placeholder="A road report, a tip, a thank-you…" /></label>
      {trips.length > 0 && (
        <fieldset className="mt-3 space-y-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">Attach a completed ride (optional)</legend>
          <label className="block text-sm">Ride
            <select name="tripId" defaultValue="" className={input}>
              <option value="">No ride</option>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.title}{t.distanceKm != null ? ` · ${formatKm(t.distanceKm)}` : ""}</option>)}
            </select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeDestination" className="h-5 w-5" /> Show the destination</label>
          <p className="text-xs text-muted">Shared: title, distance and completion date. Never shared: costs, expenses, start point, route or bike.</p>
        </fieldset>
      )}
      <button className="mt-3 rounded-lg bg-saffron px-5 font-semibold text-ink hover:bg-saffron-dark">Post</button>
    </form>
  );
}

export const POST_NOTICES: Record<string, { text: string; ok: boolean }> = {
  posted: { text: "Posted.", ok: true }, post_removed: { text: "Post removed.", ok: true }, reported: { text: "Thanks. Your report was sent to our moderators.", ok: true },
  post_invalid: { text: "Write something to share (up to 1,000 characters).", ok: false }, report_failed: { text: "Choose a reason and try again.", ok: false },
  profile_required: { text: "Create a rider profile first.", ok: false }, trip_not_completed: { text: "Only a completed trip can be shared.", ok: false },
  post_rate_limit: { text: "You can send 20 posts a day. Try again tomorrow.", ok: false }, club_archived: { text: "This club has been archived.", ok: false },
  account_restricted: { text: "A moderator has restricted your account, so you cannot do this right now.", ok: false },
  not_found: { text: "That post, club or trip could not be found.", ok: false }, rate: { text: "Too many requests. Try again in a little while.", ok: false },
};
