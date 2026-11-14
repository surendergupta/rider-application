import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ProfileCard } from "@/components/ProfileCard";
import { createClient, supabaseConfigured } from "@/lib/db/server";
import { rateLimit } from "@/lib/rate-limit";
import { blockRider, loadPublicProfile, reportRider, unblockRider } from "@/features/profile/service";
import { profilePath } from "@/features/profile/public";

// Generic title and no indexing: the page title must not reveal anything for private or missing profiles,
// and rider profiles stay out of search engines until the rider community has proper moderation.
export const metadata: Metadata = { title: "Rider profile · India Long-Ride Planner", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function viewerId(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function act(handle: string, kind: "report" | "block" | "unblock", formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const back = profilePath(handle);
  const limit = kind === "report" ? rateLimit(`profile-report:${data.user.id}`, 5, 60 * 60_000) : rateLimit(`profile-block:${data.user.id}`, 30, 60_000);
  if (!limit.allowed) redirect(`${back}?notice=rate`);

  if (kind === "report") {
    const r = await reportRider(supabase, data.user.id, handle, { reason: formData.get("reason"), note: formData.get("note") ?? "" });
    redirect(`${back}?notice=${r.ok ? "reported" : "report-failed"}`);
  }
  const r = kind === "block" ? await blockRider(supabase, data.user.id, handle) : await unblockRider(supabase, data.user.id, handle);
  redirect(`${back}?notice=${r.ok ? (kind === "block" ? "blocked" : "unblocked") : "failed"}`);
}

async function reportAction(formData: FormData) { "use server"; await act(String(formData.get("handle")), "report", formData); }
async function blockAction(formData: FormData) { "use server"; await act(String(formData.get("handle")), "block", formData); }
async function unblockAction(formData: FormData) { "use server"; await act(String(formData.get("handle")), "unblock", formData); }

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  reported: { text: "Thanks. Your report was sent to our moderators.", ok: true },
  "report-failed": { text: "Could not send the report. Choose a reason and try again.", ok: false },
  blocked: { text: "Rider blocked. They can no longer view your profile.", ok: true },
  unblocked: { text: "Rider unblocked.", ok: true },
  failed: { text: "That did not work. Try again.", ok: false },
  rate: { text: "Too many requests. Try again in a little while.", ok: false },
};

export default async function RiderPage({
  params, searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { handle } = await params;
  const { notice } = await searchParams;
  const viewer = await viewerId();

  // Missing, private, disabled, and "blocked you" all look identical: a plain 404.
  const view = supabaseConfigured() ? await loadPublicProfile(handle, viewer) : null;
  if (!view) notFound();

  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const shareUrl = `${proto}://${host}${profilePath(view.profile.handle)}`;
  const n = notice ? NOTICES[notice] : undefined;
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-road text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <Link href="/" className="tap font-bold">Long-Ride Planner</Link>
          <Link href={viewer ? "/home" : "/login"} className="tap text-sm text-white/80 hover:text-white">{viewer ? "Open app" : "Sign in"}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        {n && <p role="status" className={`mb-4 rounded-lg p-3 text-sm ${n.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{n.text}</p>}

        {view.isOwner && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${view.isPublic ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg"}`} data-testid="owner-banner">
            {view.isPublic
              ? "This is how other riders see your profile."
              : "Private preview. Only you can see this page. Turn on Public in your profile settings to share it."}
            {" "}<Link href="/profile" className="tap font-semibold underline">Edit rider profile</Link>
          </div>
        )}

        <ProfileCard profile={view.profile} />

        {view.isOwner ? (
          view.isPublic && (
            <p className="mt-4 break-all text-sm text-muted">Share this profile: <span className="select-all font-medium text-fg" data-testid="share-url">{shareUrl}</span></p>
          )
        ) : viewer ? (
          <section className="mt-6 space-y-4" aria-label="Safety controls">
            {view.viewerHasBlocked ? (
              <form action={unblockAction}>
                <input type="hidden" name="handle" value={view.profile.handle} />
                <p className="text-sm text-muted">You blocked this rider. They cannot see your profile.</p>
                <button className="mt-2 rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Unblock</button>
              </form>
            ) : (
              <form action={blockAction}>
                <input type="hidden" name="handle" value={view.profile.handle} />
                <button className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Block this rider</button>
              </form>
            )}
            <details className="rounded-lg border border-line p-3">
              <summary className="tap cursor-pointer text-sm font-medium">Report this profile</summary>
              <form action={reportAction} className="mt-3 space-y-3">
                <input type="hidden" name="handle" value={view.profile.handle} />
                <label className="block text-sm">Reason
                  <select name="reason" required defaultValue="" className={input}>
                    <option value="" disabled>Choose a reason</option>
                    <option value="spam">Spam</option><option value="impersonation">Impersonation</option>
                    <option value="inappropriate">Inappropriate content</option><option value="harassment">Harassment</option>
                    <option value="other">Something else</option>
                  </select>
                </label>
                <label className="block text-sm">Details (optional)
                  <textarea name="note" maxLength={500} rows={3} className={input} />
                </label>
                <button className="rounded-lg bg-saffron px-5 font-semibold text-ink hover:bg-saffron-dark">Send report</button>
              </form>
            </details>
          </section>
        ) : (
          <p className="mt-6 text-sm text-muted"><Link href="/login" className="font-semibold text-link underline">Sign in</Link> to report or block a profile.</p>
        )}
      </main>
    </div>
  );
}
