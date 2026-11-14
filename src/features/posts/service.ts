import "server-only";
import type { createClient } from "@/lib/db/server";
import { personsByUserId, type Person } from "@/features/rides/service";
import { mapPostError, postCreateSchema, postIdSchema, postReportSchema } from "./validation";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type Failure = { ok: false; status: number; code: string; message: string; field?: string };
export type Result<T = object> = ({ ok: true } & T) | Failure;
const fail = (status: number, code: string, message: string, field?: string): Failure => ({ ok: false, status, code, message, field });
const fromDbError = (message: string | undefined): Failure => { const m = mapPostError(message); return fail(m.status, m.code, m.message); };
const SLUG = /^[a-z0-9_]{3,30}$/;
const PAGE = 20;

export interface PostCard {
  id: string;
  author: Person | null;
  body: string;
  createdAt: string;
  story: { title: string; distanceKm: number | null; completedOn: string; destination: string | null } | null;
  club: { slug: string; name: string } | null;
  mine: boolean;
  canRemove: boolean;       // the author, or a manager of the club the post is in
}

interface PostRow {
  id: string; author_id: string; club_id: string | null; kind: "post" | "ride_story"; body: string; created_at: string;
  trip_title: string | null; trip_distance_km: string | number | null; trip_completed_on: string | null; trip_destination: string | null;
}
const COLUMNS = "id, author_id, club_id, kind, body, created_at, trip_title, trip_distance_km, trip_completed_on, trip_destination";

async function toCards(supabase: Supa, viewerId: string, rows: PostRow[]): Promise<PostCard[]> {
  const clubIds = [...new Set(rows.map((r) => r.club_id).filter((x): x is string => !!x))];
  const [people, clubs, roles] = await Promise.all([
    personsByUserId(rows.map((r) => r.author_id)),
    clubIds.length ? supabase.from("clubs").select("id, slug, name").in("id", clubIds) : Promise.resolve({ data: [] as { id: string; slug: string; name: string }[] }),
    clubIds.length ? supabase.from("club_members").select("club_id, role").eq("user_id", viewerId).eq("status", "active").in("club_id", clubIds) : Promise.resolve({ data: [] as { club_id: string; role: string }[] }),
  ]);
  const clubById = new Map((clubs.data ?? []).map((c) => [c.id as string, c]));
  const managed = new Set((roles.data ?? []).filter((r) => r.role === "owner" || r.role === "admin").map((r) => r.club_id as string));
  return rows.map((r) => {
    const club = r.club_id ? clubById.get(r.club_id) : null;
    const mine = r.author_id === viewerId;
    return {
      id: r.id, author: people.get(r.author_id) ?? null, body: r.body, createdAt: r.created_at,
      story: r.kind === "ride_story" && r.trip_title && r.trip_completed_on
        ? { title: r.trip_title, distanceKm: r.trip_distance_km == null ? null : Number(r.trip_distance_km), completedOn: r.trip_completed_on, destination: r.trip_destination }
        : null,
      club: club ? { slug: club.slug as string, name: club.name as string } : null,
      mine, canRemove: mine || (r.club_id !== null && managed.has(r.club_id)),
    };
  });
}

// ---------- creating ----------

export async function createPost(supabase: Supa, clubSlug: string | null, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = postCreateSchema.safeParse(raw);
  if (!parsed.success) { const i = parsed.error.issues[0]; return fail(422, "VALIDATION_ERROR", i?.message ?? "Check your post.", String(i?.path?.[0] ?? "")); }

  let clubId: string | null = null;
  if (clubSlug) {
    if (!SLUG.test(clubSlug)) return fail(404, "not_found", "That post, club or trip could not be found.");
    const { data } = await supabase.from("clubs").select("id").eq("slug", clubSlug).maybeSingle();       // RLS: clubs this rider can see
    if (!data) return fail(404, "not_found", "That post, club or trip could not be found.");
    clubId = data.id as string;
  }
  const { data, error } = await supabase.rpc("post_create", {
    p_body: parsed.data.body, p_club: clubId, p_trip: parsed.data.tripId, p_include_destination: parsed.data.includeDestination,
  });
  if (error) return fromDbError(error.message);
  return { ok: true, id: String(data) };
}

// ---------- reading ----------

export type FeedScope = { kind: "community" } | { kind: "clubs" } | { kind: "club"; slug: string } | { kind: "mine" };

export interface Feed { posts: PostCard[]; nextBefore: string | null }

/** Newest first. Row-level security decides what this rider may see; the scope only narrows it. */
export async function listPosts(supabase: Supa, viewerId: string, scope: FeedScope, before?: string | null): Promise<Feed> {
  let q = supabase.from("posts").select(COLUMNS).eq("status", "active").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE + 1);
  if (scope.kind === "community") q = q.is("club_id", null);
  else if (scope.kind === "clubs") q = q.not("club_id", "is", null);
  else if (scope.kind === "mine") q = q.eq("author_id", viewerId);
  else {
    if (!SLUG.test(scope.slug)) return { posts: [], nextBefore: null };
    const { data: club } = await supabase.from("clubs").select("id").eq("slug", scope.slug).maybeSingle();
    if (!club) return { posts: [], nextBefore: null };
    q = q.eq("club_id", club.id as string);
  }
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt("created_at", before);
  const { data } = await q;
  const rows = (data ?? []) as PostRow[];
  const page = rows.slice(0, PAGE);
  return { posts: await toCards(supabase, viewerId, page), nextBefore: rows.length > PAGE ? page[page.length - 1].created_at : null };
}

export interface ShareableTrip { id: string; title: string; distanceKm: number | null; completedOn: string | null }

/** Completed trips the rider could share as a ride story. */
export async function shareableTrips(supabase: Supa): Promise<ShareableTrip[]> {
  const { data } = await supabase.from("trips").select("id, title, actual_distance_km, route_distance_m, completed_at")
    .eq("status", "completed").order("completed_at", { ascending: false, nullsFirst: false }).limit(20);
  return (data ?? []).map((t) => ({
    id: t.id as string, title: t.title as string,
    distanceKm: t.actual_distance_km != null ? Number(t.actual_distance_km) : t.route_distance_m != null ? Math.round(Number(t.route_distance_m) / 100) / 10 : null,
    completedOn: t.completed_at ? String(t.completed_at).slice(0, 10) : null,
  }));
}

// ---------- removing and reporting ----------

export async function deletePost(supabase: Supa, rawId: unknown): Promise<Result> {
  const id = postIdSchema.safeParse(rawId);
  if (!id.success) return fail(404, "not_found", "That post could not be found.");
  const { data, error } = await supabase.from("posts").delete().eq("id", id.data).select("id");     // RLS: the author, or a manager of the club
  if (error) return fromDbError(error.message);
  return data && data.length > 0 ? { ok: true } : fail(404, "not_found", "That post could not be found.");
}

export async function reportPost(supabase: Supa, viewerId: string, rawId: unknown, raw: unknown): Promise<Result<{ duplicate: boolean }>> {
  const parsed = postReportSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Choose a reason.");
  const id = postIdSchema.safeParse(rawId);
  if (!id.success) return fail(404, "not_found", "That post could not be found.");
  const { error } = await supabase.from("post_reports").insert({ reporter_id: viewerId, post_id: id.data, reason: parsed.data.reason, note: parsed.data.note });
  if (error?.code === "23505") return { ok: true, duplicate: true };
  if (error?.code === "42501" || error?.code === "23503") return fail(404, "not_found", "That post could not be found.");   // your own post, or one you cannot see
  if (error) return fail(500, "INTERNAL_ERROR", "Could not send the report.");
  return { ok: true, duplicate: false };
}
