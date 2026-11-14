import Link from "next/link";
import { requireSession } from "@/lib/auth-page";
import { PostCard, PostComposer, POST_NOTICES } from "@/components/PostCard";
import { listPosts, shareableTrips, type FeedScope } from "@/features/posts/service";

export const metadata = { title: "Community posts · India Long-Ride Planner" };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "community", label: "Community" },
  { id: "clubs", label: "My clubs" },
  { id: "mine", label: "My posts" },
] as const;

export default async function PostsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, user } = await requireSession();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "community";
  const scope: FeedScope = { kind: tab };
  const [feed, trips, { data: profile }] = await Promise.all([
    listPosts(supabase, user.id, scope, sp.before),
    shareableTrips(supabase),
    supabase.from("rider_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  const notice = sp.notice ? POST_NOTICES[sp.notice] : undefined;
  const returnTo = tab === "community" ? "/posts" : `/posts?tab=${tab}`;

  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">Community posts</h1>
      <p className="mt-1 text-sm text-muted">Road reports, tips and completed rides from riders. <Link href="/clubs" className="underline">Clubs</Link> · <Link href="/rides" className="underline">Group rides</Link></p>
      {notice && <p role="status" className={`mt-4 rounded-lg p-3 text-sm ${notice.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{notice.text}</p>}

      <div className="mt-5"><PostComposer trips={trips} returnTo={returnTo} hasProfile={Boolean(profile)} /></div>

      <nav aria-label="Post lists" className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.id} href={t.id === "community" ? "/posts" : `/posts?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}
            className={`tap rounded-full border px-4 text-sm ${t.id === tab ? "border-saffron bg-saffron font-semibold text-ink" : "border-line-strong hover:bg-sunken"}`}>{t.label}</Link>
        ))}
      </nav>

      {feed.posts.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{tab === "clubs" ? "No club posts yet. Posts from clubs you belong to show up here." : tab === "mine" ? "You have not posted yet." : "No posts yet. Be the first to share a road report or a finished ride."}</p>
      ) : (
        <ul className="mt-4 space-y-3">{feed.posts.map((p) => <PostCard key={p.id} post={p} returnTo={returnTo} />)}</ul>
      )}
      {feed.nextBefore && (
        <p className="mt-4"><Link href={`/posts?${tab !== "community" ? `tab=${tab}&` : ""}before=${encodeURIComponent(feed.nextBefore)}`} className="tap rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken">Older posts</Link></p>
      )}
      <p className="mt-8 text-xs text-muted">Posts are not verified. Be kind, never share another rider&apos;s details, and never use your phone while riding.</p>
    </main>
  );
}
