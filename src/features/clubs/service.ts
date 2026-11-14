import "server-only";
import type { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import { normaliseHandle } from "@/features/profile/validation";
import { inviteSchema } from "@/features/rides/validation";
import { personsByUserId, type Person } from "@/features/rides/service";
import { clubCreateSchema, clubFilterSchema, clubReportSchema, clubUpdateSchema, mapClubError, normaliseSlug } from "./validation";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type Failure = { ok: false; status: number; code: string; message: string; field?: string };
export type Result<T = object> = ({ ok: true } & T) | Failure;
const fail = (status: number, code: string, message: string, field?: string): Failure => ({ ok: false, status, code, message, field });
const fromDbError = (message: string | undefined): Failure => { const m = mapClubError(message); return fail(m.status, m.code, m.message); };
const SLUG = /^[a-z0-9_]{3,30}$/;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

export interface ClubCard {
  slug: string; name: string; description: string | null; location: string | null; city: string | null; state: string | null;
  visibility: "public" | "private"; joinPolicy: "open" | "approval" | "invite"; memberLimit: number; members: number;
  status: "active" | "archived"; myStatus: string | null; myRole: string | null;
}

interface ClubRow {
  id: string; owner_id: string; slug: string; name: string; description: string | null; city: string | null; state: string | null;
  visibility: "public" | "private"; join_policy: "open" | "approval" | "invite"; member_limit: number; status: "active" | "archived";
}
const COLUMNS = "id, owner_id, slug, name, description, city, state, visibility, join_policy, member_limit, status";

/** Active-member counts per club. Aggregate only: no names are read here. */
async function memberCounts(clubIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (clubIds.length === 0) return out;
  const { data } = await createAdminClient().from("club_members").select("club_id").in("club_id", clubIds).eq("status", "active");
  for (const r of data ?? []) out.set(r.club_id as string, (out.get(r.club_id as string) ?? 0) + 1);
  return out;
}

async function toCards(supabase: Supa, viewerId: string, rows: ClubRow[]): Promise<ClubCard[]> {
  const ids = rows.map((r) => r.id);
  const [counts, mine] = await Promise.all([
    memberCounts(ids),
    ids.length ? supabase.from("club_members").select("club_id, status, role").eq("user_id", viewerId).in("club_id", ids) : Promise.resolve({ data: [] as { club_id: string; status: string; role: string }[] }),
  ]);
  const my = new Map((mine.data ?? []).map((m) => [m.club_id as string, m]));
  return rows.map((r) => {
    const m = my.get(r.id);
    return {
      slug: r.slug, name: r.name, description: r.description, location: [r.city, r.state].filter(Boolean).join(", ") || null, city: r.city, state: r.state,
      visibility: r.visibility, joinPolicy: r.join_policy, memberLimit: r.member_limit, members: counts.get(r.id) ?? 0, status: r.status,
      myStatus: m?.status ?? null, myRole: m?.status === "active" ? (m.role as string) : null,
    };
  });
}

// ---------- creating and editing ----------

export async function createClub(supabase: Supa, userId: string, raw: unknown): Promise<Result<{ slug: string }>> {
  const parsed = clubCreateSchema.safeParse(raw);
  if (!parsed.success) { const i = parsed.error.issues[0]; return fail(422, "VALIDATION_ERROR", i?.message ?? "Check the club details.", String(i?.path?.[0] ?? "")); }
  const { error } = await supabase.from("clubs").insert({ ...parsed.data, owner_id: userId });
  if (error?.code === "23505") return fail(409, "SLUG_TAKEN", "That club link is already taken. Try another.", "slug");
  if (error?.code === "42501") return fail(403, "profile_required", "Create a rider profile first. Other members see it.");
  if (error?.message?.includes("account_restricted")) return fail(403, "account_restricted", "A moderator has restricted your account, so you cannot do this right now.");
  if (error) return fail(500, "INTERNAL_ERROR", "Could not create the club.");
  return { ok: true, slug: parsed.data.slug };
}

export async function updateClub(supabase: Supa, userId: string, slug: string, raw: unknown): Promise<Result> {
  const s = normaliseSlug(slug);
  if (!SLUG.test(s)) return fail(404, "not_found", "Club not found");
  const parsed = clubUpdateSchema.safeParse(raw);
  if (!parsed.success) { const i = parsed.error.issues[0]; return fail(422, "VALIDATION_ERROR", i?.message ?? "Check the club details.", String(i?.path?.[0] ?? "")); }
  const { data, error } = await supabase.from("clubs").update(parsed.data).eq("slug", s).eq("owner_id", userId).select("id").maybeSingle();
  if (error) return error.code === "23514" ? fail(422, "VALIDATION_ERROR", "A private club is invite only.", "join_policy") : fromDbError(error.message);
  return data ? { ok: true } : fail(404, "not_found", "Club not found");
}

export async function archiveClub(supabase: Supa, userId: string, slug: string): Promise<Result> {
  const s = normaliseSlug(slug);
  if (!SLUG.test(s)) return fail(404, "not_found", "Club not found");
  const { data, error } = await supabase.from("clubs").update({ status: "archived" }).eq("slug", s).eq("owner_id", userId).select("id").maybeSingle();
  if (error) return fromDbError(error.message);
  return data ? { ok: true } : fail(404, "not_found", "Club not found");
}

// ---------- browsing ----------

export async function listPublicClubs(supabase: Supa, viewerId: string, rawFilters: unknown): Promise<ClubCard[]> {
  const f = clubFilterSchema.parse(rawFilters ?? {});
  let q = supabase.from("clubs").select(COLUMNS).eq("visibility", "public").eq("status", "active").order("name").limit(40);
  if (f.q) q = q.ilike("name", `%${likeEscape(f.q)}%`);
  if (f.state) q = q.ilike("state", `%${likeEscape(f.state)}%`);
  const { data } = await q;                                    // RLS also hides clubs by anyone who blocked, or was blocked by, the viewer
  return toCards(supabase, viewerId, (data ?? []) as ClubRow[]);
}

export interface ClubsDashboard {
  mine: ClubCard[];
  invitations: ClubCard[];
  pending: ClubCard[];
  requests: { clubSlug: string; clubName: string; person: Person }[];
}

export async function myClubsDashboard(supabase: Supa, viewerId: string): Promise<ClubsDashboard> {
  const { data: rows } = await supabase.from("club_members").select("club_id, status").eq("user_id", viewerId).in("status", ["active", "requested", "invited"]);
  const ids = [...new Set((rows ?? []).map((r) => r.club_id as string))];
  const { data: clubs } = ids.length ? await supabase.from("clubs").select(COLUMNS).in("id", ids).order("name") : { data: [] as ClubRow[] };
  const cards = await toCards(supabase, viewerId, (clubs ?? []) as ClubRow[]);
  const visibleCards = cards.filter((c) => c.status === "active" || c.myStatus === "active");

  // Join requests waiting on this rider as an owner or admin: shown by name and handle, never an id.
  const managed = ((clubs ?? []) as ClubRow[]).filter((c) => cards.find((x) => x.slug === c.slug)?.myRole && ["owner", "admin"].includes(cards.find((x) => x.slug === c.slug)!.myRole!) && c.status === "active");
  const requests: ClubsDashboard["requests"] = [];
  if (managed.length) {
    const { data: reqs } = await supabase.from("club_members").select("club_id, user_id").in("club_id", managed.map((m) => m.id)).eq("status", "requested");
    const people = await personsByUserId((reqs ?? []).map((r) => r.user_id as string));
    for (const r of reqs ?? []) {
      const person = people.get(r.user_id as string), club = managed.find((m) => m.id === r.club_id);
      if (person && club) requests.push({ clubSlug: club.slug, clubName: club.name, person });
    }
  }
  return {
    mine: visibleCards.filter((c) => c.myStatus === "active"),
    invitations: visibleCards.filter((c) => c.myStatus === "invited" && c.status === "active"),
    pending: visibleCards.filter((c) => c.myStatus === "requested" && c.status === "active"),
    requests,
  };
}

export interface ClubMember extends Person { role: string; status: string }

export interface ClubDetail {
  club: ClubCard & { id: string };
  isOwner: boolean;
  isManager: boolean;                 // owner or admin
  members: ClubMember[];              // empty unless the viewer is an active member
  requested: ClubMember[];            // managers only
  invited: ClubMember[];              // managers only
}

/** Returns null when the club does not exist or the viewer may not see it (the page shows a plain 404). */
export async function getClubDetail(supabase: Supa, viewerId: string, slugInput: string): Promise<ClubDetail | null> {
  const slug = normaliseSlug(slugInput);
  if (!SLUG.test(slug)) return null;
  const { data } = await supabase.from("clubs").select(COLUMNS).eq("slug", slug).maybeSingle();
  if (!data) return null;                                      // RLS: missing, private-to-you and blocked all look the same
  const row = data as ClubRow;
  const [card] = await toCards(supabase, viewerId, [row]);
  const isOwner = row.owner_id === viewerId;
  const isManager = card.myRole === "owner" || card.myRole === "admin";

  let members: ClubMember[] = [], requested: ClubMember[] = [], invited: ClubMember[] = [];
  if (card.myRole) {
    const { data: ms } = await supabase.from("club_members").select("user_id, role, status").eq("club_id", row.id);   // RLS decides which rows this viewer may read
    const people = await personsByUserId((ms ?? []).map((m) => m.user_id as string));
    const all = (ms ?? []).flatMap((m) => { const p = people.get(m.user_id as string); return p ? [{ ...p, role: m.role as string, status: m.status as string }] : []; });
    const rank = (r: string) => (r === "owner" ? 0 : r === "admin" ? 1 : 2);
    members = all.filter((m) => m.status === "active").sort((a, b) => rank(a.role) - rank(b.role) || a.displayName.localeCompare(b.displayName));
    if (isManager) { requested = all.filter((m) => m.status === "requested"); invited = all.filter((m) => m.status === "invited"); }
  }
  return { club: { ...card, id: row.id }, isOwner, isManager, members, requested, invited };
}

// ---------- membership (all rules live in the database functions) ----------

async function rpc(supabase: Supa, fn: string, args: Record<string, unknown>): Promise<Result<{ status: string }>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return fromDbError(error.message);
  return { ok: true, status: String(data) };
}

async function clubIdBySlug(supabase: Supa, slugInput: string): Promise<string | null> {
  const slug = normaliseSlug(slugInput);
  if (!SLUG.test(slug)) return null;
  const { data } = await supabase.from("clubs").select("id").eq("slug", slug).maybeSingle();     // RLS: only clubs this rider can see
  return (data?.id as string) ?? null;
}

const notFound = () => fail(404, "not_found", "That club or rider could not be found.");

export async function requestJoin(s: Supa, slug: string) { const id = await clubIdBySlug(s, slug); return id ? rpc(s, "club_request_join", { p_club: id }) : notFound(); }
export async function leaveClub(s: Supa, slug: string) { const id = await clubIdBySlug(s, slug); return id ? rpc(s, "club_leave", { p_club: id }) : notFound(); }
export async function respondToInvite(s: Supa, slug: string, accept: boolean) { const id = await clubIdBySlug(s, slug); return id ? rpc(s, "club_respond", { p_club: id, p_accept: accept }) : notFound(); }

export async function inviteMember(supabase: Supa, slug: string, rawHandle: unknown): Promise<Result<{ status: string }>> {
  const parsed = inviteSchema.safeParse({ handle: rawHandle });
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Enter a handle.", "handle");
  const id = await clubIdBySlug(supabase, slug);
  return id ? rpc(supabase, "club_invite", { p_club: id, p_handle: parsed.data.handle }) : notFound();
}

/** Managers act on a member named by handle. The server resolves the id; the browser never sees it. */
async function memberIdByHandle(supabase: Supa, clubId: string, handle: string): Promise<string | null> {
  const h = normaliseHandle(handle);
  if (!/^[a-z0-9_]{3,20}$/.test(h)) return null;
  const { data: prof } = await createAdminClient().from("rider_profiles").select("user_id").eq("handle", h).maybeSingle();
  if (!prof) return null;
  const { data } = await supabase.from("club_members").select("user_id").eq("club_id", clubId).eq("user_id", prof.user_id).maybeSingle();   // RLS: managers and members only
  return data ? (prof.user_id as string) : null;
}

async function withMember(supabase: Supa, slug: string, handle: string, fn: string, extra: Record<string, unknown>): Promise<Result<{ status: string }>> {
  const clubId = await clubIdBySlug(supabase, slug);
  if (!clubId) return notFound();
  const uid = await memberIdByHandle(supabase, clubId, handle);
  if (!uid) return notFound();
  return rpc(supabase, fn, { p_club: clubId, p_user: uid, ...extra });
}
export const decideRequest = (s: Supa, slug: string, handle: string, approve: boolean) => withMember(s, slug, handle, "club_decide", { p_approve: approve });
export const removeMember = (s: Supa, slug: string, handle: string) => withMember(s, slug, handle, "club_remove", {});
export const setMemberRole = (s: Supa, slug: string, handle: string, role: "admin" | "member") => withMember(s, slug, handle, "club_set_role", { p_role: role });

export async function reportClub(supabase: Supa, viewerId: string, slug: string, raw: unknown): Promise<Result<{ duplicate: boolean }>> {
  const parsed = clubReportSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Choose a reason.");
  const id = await clubIdBySlug(supabase, slug);
  if (!id) return notFound();
  const { error } = await supabase.from("club_reports").insert({ reporter_id: viewerId, club_id: id, reason: parsed.data.reason, note: parsed.data.note });
  if (error?.code === "23505") return { ok: true, duplicate: true };
  if (error?.code === "42501") return notFound();               // your own club, or one you cannot see
  if (error) return fail(500, "INTERNAL_ERROR", "Could not send the report.");
  return { ok: true, duplicate: false };
}

/** For Home: club invitations to answer and join requests to review. */
export async function clubAttentionCounts(supabase: Supa, viewerId: string): Promise<{ invitations: number; requests: number }> {
  const { data: mine } = await supabase.from("club_members").select("club_id, status, role").eq("user_id", viewerId).in("status", ["invited", "active"]);
  const invitedIds = (mine ?? []).filter((m) => m.status === "invited").map((m) => m.club_id as string);
  const managedIds = (mine ?? []).filter((m) => m.status === "active" && ["owner", "admin"].includes(m.role as string)).map((m) => m.club_id as string);
  let invitations = 0, requests = 0;
  if (invitedIds.length) { const { data } = await supabase.from("clubs").select("id").in("id", invitedIds).eq("status", "active"); invitations = data?.length ?? 0; }
  if (managedIds.length) { const { count } = await supabase.from("club_members").select("club_id", { count: "exact", head: true }).in("club_id", managedIds).eq("status", "requested"); requests = count ?? 0; }
  return { invitations, requests };
}
