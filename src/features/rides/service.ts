import "server-only";
import { z } from "zod";
import type { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import { todayInIndia } from "@/features/garage/documents";
import { initialsOf, normaliseHandle, type AvatarColor } from "@/features/profile/validation";
import {
  inviteSchema, mapRideError, rideFilterSchema, rideInputSchema, rideReportSchema, rideState, whenRange, type RideState,
} from "./validation";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type Failure = { ok: false; status: number; code: string; message: string; field?: string };
export type Result<T = object> = ({ ok: true } & T) | Failure;
const fail = (status: number, code: string, message: string, field?: string): Failure => ({ ok: false, status, code, message, field });
const fromDbError = (message: string | undefined): Failure => { const m = mapRideError(message); return fail(m.status, m.code, m.message); };
const isUuid = (s: string) => z.uuid().safeParse(s).success;

/** What the interface may show about another rider on a ride. Never an id, email or anything private. */
export interface Person {
  handle: string;
  displayName: string;
  initials: string;
  avatarColor: AvatarColor;
  hasPublicProfile: boolean;
}

export async function personsByUserId(userIds: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  if (userIds.length === 0) return out;
  const { data } = await createAdminClient().from("rider_profiles").select("user_id, handle, display_name, avatar_color, is_public").in("user_id", [...new Set(userIds)]);
  for (const r of data ?? []) {
    out.set(r.user_id as string, {
      handle: r.handle as string, displayName: r.display_name as string, initials: initialsOf(r.display_name as string),
      avatarColor: r.avatar_color as AvatarColor, hasPublicProfile: Boolean(r.is_public),
    });
  }
  return out;
}

/** Escapes LIKE wildcards so a search for "100%" means the text, not a pattern. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

export interface RideCard {
  id: string; title: string; area: string; destination: string | null; startsOn: string; startTime: string | null; endsOn: string | null;
  maxRiders: number; going: number; distanceKm: number | null; requiresApproval: boolean; visibility: "public" | "invite_only";
  state: RideState; host: Person | null; myStatus: string | null;
}

interface RideRow {
  id: string; host_id: string; title: string; area_label: string; destination_label: string | null; starts_on: string; start_time: string | null;
  ends_on: string | null; max_riders: number; distance_km: number | string | null; requires_approval: boolean; visibility: "public" | "invite_only"; status: string;
}
const RIDE_COLUMNS = "id, host_id, title, area_label, destination_label, starts_on, start_time, ends_on, max_riders, distance_km, requires_approval, visibility, status";

/** Confirmed-rider counts per ride. Aggregate only: names are never read here. */
async function goingCounts(rideIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (rideIds.length === 0) return out;
  const { data } = await createAdminClient().from("ride_participants").select("ride_id").in("ride_id", rideIds).eq("status", "going");
  for (const r of data ?? []) out.set(r.ride_id as string, (out.get(r.ride_id as string) ?? 0) + 1);
  return out;
}

async function toCards(supabase: Supa, viewerId: string, rows: RideRow[]): Promise<RideCard[]> {
  const ids = rows.map((r) => r.id);
  const [counts, hosts, mine] = await Promise.all([
    goingCounts(ids),
    personsByUserId(rows.map((r) => r.host_id)),
    ids.length ? supabase.from("ride_participants").select("ride_id, status").eq("user_id", viewerId).in("ride_id", ids) : Promise.resolve({ data: [] as { ride_id: string; status: string }[] }),
  ]);
  const myStatus = new Map((mine.data ?? []).map((m) => [m.ride_id as string, m.status as string]));
  const today = todayInIndia();
  return rows.map((r) => {
    const going = counts.get(r.id) ?? 0;
    return {
      id: r.id, title: r.title, area: r.area_label, destination: r.destination_label, startsOn: r.starts_on, startTime: r.start_time?.slice(0, 5) ?? null,
      endsOn: r.ends_on, maxRiders: r.max_riders, going, distanceKm: r.distance_km == null ? null : Number(r.distance_km),
      requiresApproval: r.requires_approval, visibility: r.visibility, state: rideState(r, going, r.max_riders, today),
      host: hosts.get(r.host_id) ?? null, myStatus: r.host_id === viewerId ? "host" : myStatus.get(r.id) ?? null,
    };
  });
}

// ---------- creating and editing ----------

export async function createRide(supabase: Supa, userId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = rideInputSchema().safeParse(raw);
  if (!parsed.success) { const i = parsed.error.issues[0]; return fail(422, "VALIDATION_ERROR", i?.message ?? "Check the ride details.", String(i?.path?.[0] ?? "")); }
  const { meeting_point, host_note, ...ride } = parsed.data;

  const { data, error } = await supabase.from("rides").insert({ ...ride, host_id: userId }).select("id").single();
  // The insert policy requires a rider profile: other riders see it next to the ride.
  if (error?.code === "42501") return fail(403, "profile_required", "Create a rider profile first. Other riders see it next to your ride.");
  if (error?.message?.includes("account_restricted")) return fail(403, "account_restricted", "A moderator has restricted your account, so you cannot do this right now.");
  if (error || !data) return fail(500, "INTERNAL_ERROR", "Could not create the ride.");

  if (meeting_point || host_note) {
    const { error: e2 } = await supabase.from("ride_private").insert({ ride_id: data.id, meeting_point, host_note });
    if (e2) return fail(500, "INTERNAL_ERROR", "The ride was created, but the meeting details were not saved. Open the ride and edit it to add them.");
  }
  return { ok: true, id: data.id };
}

export async function updateRide(supabase: Supa, userId: string, rideId: string, raw: unknown): Promise<Result> {
  if (!isUuid(rideId)) return fail(404, "not_found", "Ride not found");
  const parsed = rideInputSchema().safeParse(raw);
  if (!parsed.success) { const i = parsed.error.issues[0]; return fail(422, "VALIDATION_ERROR", i?.message ?? "Check the ride details.", String(i?.path?.[0] ?? "")); }
  const { meeting_point, host_note, ...ride } = parsed.data;

  // RLS only lets the host update; a stranger's id simply matches nothing.
  const { data, error } = await supabase.from("rides").update(ride).eq("id", rideId).eq("host_id", userId).select("id").maybeSingle();
  if (error) return fromDbError(error.message);
  if (!data) return fail(404, "not_found", "Ride not found");

  if (meeting_point || host_note) {
    const { error: e2 } = await supabase.from("ride_private").upsert({ ride_id: rideId, meeting_point, host_note }, { onConflict: "ride_id" });
    if (e2) return fail(500, "INTERNAL_ERROR", "Could not save the meeting details.");
  } else {
    await supabase.from("ride_private").delete().eq("ride_id", rideId);
  }
  return { ok: true };
}

export async function cancelRide(supabase: Supa, userId: string, rideId: string): Promise<Result> {
  if (!isUuid(rideId)) return fail(404, "not_found", "Ride not found");
  const { data, error } = await supabase.from("rides").update({ status: "cancelled" }).eq("id", rideId).eq("host_id", userId).select("id").maybeSingle();
  if (error) return fromDbError(error.message);
  return data ? { ok: true } : fail(404, "not_found", "Ride not found");
}

// ---------- browsing ----------

export async function listDiscoverRides(supabase: Supa, viewerId: string, rawFilters: unknown): Promise<RideCard[]> {
  const f = rideFilterSchema.parse(rawFilters ?? {});
  const { from, to } = whenRange(f.when, todayInIndia());
  let q = supabase.from("rides").select(RIDE_COLUMNS).eq("visibility", "public").eq("status", "open").gte("starts_on", from).neq("host_id", viewerId)
    .order("starts_on").order("start_time", { nullsFirst: false }).limit(40);
  if (to) q = q.lte("starts_on", to);
  if (f.area) q = q.ilike("area_label", `%${likeEscape(f.area)}%`);
  const { data } = await q;                       // RLS also removes rides by anyone who has blocked, or been blocked by, the viewer
  const cards = await toCards(supabase, viewerId, (data ?? []) as RideRow[]);
  return f.open ? cards.filter((c) => c.state === "open") : cards;
}

export interface Dashboard {
  hosting: RideCard[];
  going: RideCard[];
  pending: RideCard[];
  invitations: RideCard[];
  requests: { rideId: string; rideTitle: string; person: Person }[];
}

export async function myRidesDashboard(supabase: Supa, viewerId: string): Promise<Dashboard> {
  const today = todayInIndia();
  const { data: mine } = await supabase.from("ride_participants").select("ride_id, status").eq("user_id", viewerId).in("status", ["going", "requested", "invited"]);
  const ids = [...new Set((mine ?? []).map((m) => m.ride_id as string))];
  const { data: rows } = ids.length
    ? await supabase.from("rides").select(RIDE_COLUMNS).in("id", ids).order("starts_on")
    : { data: [] as RideRow[] };
  const cards = await toCards(supabase, viewerId, ((rows ?? []) as RideRow[]).filter((r) => (r.ends_on ?? r.starts_on) >= today));
  const hosting = cards.filter((c) => c.myStatus === "host");
  const by = (s: string) => cards.filter((c) => c.myStatus === s && c.state !== "cancelled");

  // Requests waiting for the host's decision: shown with the rider's name and handle, never an id.
  const hostedIds = hosting.filter((h) => h.state !== "cancelled").map((h) => h.id);
  const requests: Dashboard["requests"] = [];
  if (hostedIds.length) {
    const { data: reqs } = await supabase.from("ride_participants").select("ride_id, user_id").in("ride_id", hostedIds).eq("status", "requested");
    const people = await personsByUserId((reqs ?? []).map((r) => r.user_id as string));
    for (const r of reqs ?? []) {
      const person = people.get(r.user_id as string);
      const ride = hosting.find((h) => h.id === r.ride_id);
      if (person && ride) requests.push({ rideId: ride.id, rideTitle: ride.title, person });
    }
  }
  return { hosting: hosting.filter((h) => h.state !== "cancelled"), going: by("going"), pending: by("requested"), invitations: by("invited"), requests };
}

export interface Participant extends Person { status: string; isHost: boolean }

export interface RideDetail {
  ride: RideCard & { description: string | null };
  isHost: boolean;
  myStatus: string | null;
  meetingPoint: string | null;
  hostNote: string | null;
  participants: Participant[];       // empty unless the viewer is the host or a confirmed rider
}

/** Everything the page needs, shaped for this viewer. Returns null when the ride does not exist or the viewer may not see it. */
export async function getRideDetail(supabase: Supa, viewerId: string, rideId: string): Promise<RideDetail | null> {
  if (!isUuid(rideId)) return null;
  const { data } = await supabase.from("rides").select(RIDE_COLUMNS + ", description").eq("id", rideId).maybeSingle();
  if (!data) return null;                                      // RLS: missing, hidden, cancelled-for-strangers and blocked look the same
  const row = data as unknown as RideRow & { description: string | null };
  const [card] = await toCards(supabase, viewerId, [row]);
  const isHost = row.host_id === viewerId;
  const myStatus = card.myStatus;

  let meetingPoint: string | null = null, hostNote: string | null = null;
  const { data: priv } = await supabase.from("ride_private").select("meeting_point, host_note").eq("ride_id", rideId).maybeSingle();   // RLS: host and confirmed riders only
  if (priv) { meetingPoint = priv.meeting_point ?? null; hostNote = priv.host_note ?? null; }

  let participants: Participant[] = [];
  if (isHost || myStatus === "going") {
    const { data: ps } = await supabase.from("ride_participants").select("user_id, status").eq("ride_id", rideId);
    const people = await personsByUserId((ps ?? []).map((p) => p.user_id as string));
    participants = (ps ?? []).flatMap((p) => {
      const person = people.get(p.user_id as string);
      return person ? [{ ...person, status: p.status as string, isHost: p.user_id === row.host_id }] : [];
    }).sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.displayName.localeCompare(b.displayName));
  }
  return { ride: { ...card, description: row.description }, isHost, myStatus, meetingPoint, hostNote, participants };
}

// ---------- participation (all rules live in the database functions) ----------

async function rpc(supabase: Supa, fn: string, args: Record<string, unknown>): Promise<Result<{ status: string }>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return fromDbError(error.message);
  return { ok: true, status: String(data) };
}

export const requestJoin = (s: Supa, rideId: string) => (isUuid(rideId) ? rpc(s, "ride_request_join", { p_ride: rideId }) : Promise.resolve(fail(404, "not_found", "Ride not found")));
export const leaveRide = (s: Supa, rideId: string) => (isUuid(rideId) ? rpc(s, "ride_leave", { p_ride: rideId }) : Promise.resolve(fail(404, "not_found", "Ride not found")));
export const respondToInvite = (s: Supa, rideId: string, accept: boolean) => (isUuid(rideId) ? rpc(s, "ride_respond", { p_ride: rideId, p_accept: accept }) : Promise.resolve(fail(404, "not_found", "Ride not found")));

export async function inviteRider(supabase: Supa, rideId: string, rawHandle: unknown): Promise<Result<{ status: string }>> {
  if (!isUuid(rideId)) return fail(404, "not_found", "Ride not found");
  const parsed = inviteSchema.safeParse({ handle: rawHandle });
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Enter a handle.", "handle");
  return rpc(supabase, "ride_invite", { p_ride: rideId, p_handle: parsed.data.handle });
}

/** The host decides on, or removes, a rider named by handle. The server resolves the id; the browser never sees it. */
async function participantIdByHandle(supabase: Supa, rideId: string, handle: string): Promise<string | null> {
  const h = normaliseHandle(handle);
  if (!/^[a-z0-9_]{3,20}$/.test(h)) return null;
  const { data: prof } = await createAdminClient().from("rider_profiles").select("user_id").eq("handle", h).maybeSingle();
  if (!prof) return null;
  const { data } = await supabase.from("ride_participants").select("user_id").eq("ride_id", rideId).eq("user_id", prof.user_id).maybeSingle();   // RLS: only a host can see this row
  return data ? (prof.user_id as string) : null;
}

export async function decideRequest(supabase: Supa, rideId: string, handle: string, approve: boolean): Promise<Result<{ status: string }>> {
  if (!isUuid(rideId)) return fail(404, "not_found", "Ride not found");
  const uid = await participantIdByHandle(supabase, rideId, handle);
  if (!uid) return fail(404, "not_found", "That ride or rider could not be found.");
  return rpc(supabase, "ride_decide", { p_ride: rideId, p_user: uid, p_approve: approve });
}

export async function removeRider(supabase: Supa, rideId: string, handle: string): Promise<Result<{ status: string }>> {
  if (!isUuid(rideId)) return fail(404, "not_found", "Ride not found");
  const uid = await participantIdByHandle(supabase, rideId, handle);
  if (!uid) return fail(404, "not_found", "That ride or rider could not be found.");
  return rpc(supabase, "ride_remove", { p_ride: rideId, p_user: uid });
}

export async function reportRide(supabase: Supa, viewerId: string, rideId: string, raw: unknown): Promise<Result<{ duplicate: boolean }>> {
  if (!isUuid(rideId)) return fail(404, "not_found", "Ride not found");
  const parsed = rideReportSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Choose a reason.");
  const { error } = await supabase.from("ride_reports").insert({ reporter_id: viewerId, ride_id: rideId, reason: parsed.data.reason, note: parsed.data.note });
  if (error?.code === "23505") return { ok: true, duplicate: true };
  if (error?.code === "42501") return fail(404, "not_found", "That ride could not be found.");    // hidden rides and your own rides cannot be reported
  if (error) return fail(500, "INTERNAL_ERROR", "Could not send the report.");
  return { ok: true, duplicate: false };
}

/** Counts for the Home dashboard: invitations to answer and requests to review. */
export async function attentionCounts(supabase: Supa, viewerId: string): Promise<{ invitations: number; requests: number }> {
  const today = todayInIndia();
  const { data: inv } = await supabase.from("ride_participants").select("ride_id").eq("user_id", viewerId).eq("status", "invited");
  const invIds = (inv ?? []).map((i) => i.ride_id as string);
  let invitations = 0;
  if (invIds.length) {
    const { data: r } = await supabase.from("rides").select("id").in("id", invIds).eq("status", "open").gte("starts_on", today);
    invitations = r?.length ?? 0;
  }
  const { data: hosted } = await supabase.from("rides").select("id").eq("host_id", viewerId).eq("status", "open").gte("starts_on", today);
  const hostedIds = (hosted ?? []).map((h) => h.id as string);
  let requests = 0;
  if (hostedIds.length) {
    const { count } = await supabase.from("ride_participants").select("ride_id", { count: "exact", head: true }).in("ride_id", hostedIds).eq("status", "requested");
    requests = count ?? 0;
  }
  return { invitations, requests };
}
