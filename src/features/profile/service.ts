import "server-only";
import type { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import { toPublicProfile, type PublicProfile } from "./public";
import { HANDLE_COOLDOWN_DAYS, normaliseHandle, profileInputSchema, reportSchema, type ProfileInput } from "./validation";

type Supa = Awaited<ReturnType<typeof createClient>>;

export type Failure = { ok: false; status: number; code: string; message: string; field?: string };
export type Ok<T = object> = { ok: true } & T;
export type Result<T = object> = Ok<T> | Failure;

const fail = (status: number, code: string, message: string, field?: string): Failure => ({ ok: false, status, code, message, field });

/** The owner's own full row (private view, includes the settings). Uses the session client, so RLS applies. */
export async function getOwnProfile(supabase: Supa, userId: string) {
  const { data } = await supabase.from("rider_profiles").select("*").eq("user_id", userId).maybeSingle();
  return data;
}

/** Motorcycles the owner could choose to feature. Private to the owner; only make and model ever become public. */
export async function listOwnBikes(supabase: Supa) {
  const { data } = await supabase.from("bikes").select("id, display_name, make, model").eq("is_archived", false).order("created_at");
  return data ?? [];
}

export async function saveProfile(supabase: Supa, userId: string, raw: unknown): Promise<Result> {
  const parsed = profileInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(422, "VALIDATION_ERROR", issue?.message ?? "Invalid profile", String(issue?.path?.[0] ?? ""));
  }
  const p: ProfileInput = parsed.data;

  // Explicit insert or update (not upsert): an upsert would let the insert path reset the handle-change clock.
  const write = async () => {
    const { data: existing } = await supabase.from("rider_profiles").select("user_id").eq("user_id", userId).maybeSingle();
    return existing
      ? supabase.from("rider_profiles").update(p).eq("user_id", userId)
      : supabase.from("rider_profiles").insert({ ...p, user_id: userId });
  };

  let { error } = await write();
  // A double submit can race the first insert: the second attempt then simply becomes an update.
  if (error?.code === "23505" && !error.message.includes("rider_profiles_handle_key")) ({ error } = await write());

  if (!error) return { ok: true };
  if (error.code === "23505") return fail(409, "HANDLE_TAKEN", "That handle is already taken. Try another.", "handle");
  if (error.message.includes("handle_cooldown")) {
    return fail(409, "HANDLE_COOLDOWN", `You can change your handle once every ${HANDLE_COOLDOWN_DAYS} days.`, "handle");
  }
  if (error.code === "23503") return fail(422, "VALIDATION_ERROR", "That motorcycle is not in your garage.", "featured_bike_id");
  if (error.code === "23514") return fail(422, "VALIDATION_ERROR", "Some profile details are not allowed. Check them and try again.");
  return fail(500, "INTERNAL_ERROR", "Could not save your profile");
}

/** Switch the profile to private. Everything is kept; it just stops being visible to others. */
export async function disableProfile(supabase: Supa, userId: string): Promise<Result> {
  const { error } = await supabase.from("rider_profiles").update({ is_public: false }).eq("user_id", userId);
  return error ? fail(500, "INTERNAL_ERROR", "Could not disable the profile") : { ok: true };
}

/** Remove the profile entirely. The handle becomes available again. */
export async function deleteProfile(supabase: Supa, userId: string): Promise<Result> {
  const { error } = await supabase.from("rider_profiles").delete().eq("user_id", userId);
  return error ? fail(500, "INTERNAL_ERROR", "Could not delete the profile") : { ok: true };
}

const HANDLE_SHAPE = /^[a-z0-9_]{3,20}$/;

/** Used by the edit form. Signed-in only and rate-limited by the caller. Reveals only whether a handle is taken, never who owns it. */
export async function isHandleAvailable(handleInput: string, forUserId: string): Promise<Result<{ available: boolean; handle: string }>> {
  const handle = normaliseHandle(handleInput);
  const check = profileInputSchema.shape.handle.safeParse(handle);
  if (!check.success) return fail(422, "VALIDATION_ERROR", check.error.issues[0]?.message ?? "Invalid handle", "handle");
  const { data } = await createAdminClient().from("rider_profiles").select("user_id").eq("handle", handle).maybeSingle();
  return { ok: true, handle, available: !data || data.user_id === forUserId };
}

interface Access {
  userId: string;                // the profile owner's id: used only inside the server, never sent to the browser
  row: Record<string, unknown>;
  isOwner: boolean;
  viewerHasBlocked: boolean;
}

/**
 * Single place that decides who may see a profile. Returns null (and the page shows a plain 404) when:
 * the handle does not exist, the profile is private or disabled (to anyone but the owner), or the owner has
 * blocked the viewer. The three cases are indistinguishable to the viewer, so profiles cannot be probed.
 */
async function resolveAccess(handleInput: string, viewerId: string | null): Promise<Access | null> {
  const handle = normaliseHandle(handleInput);
  if (!HANDLE_SHAPE.test(handle)) return null;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("rider_profiles")
    .select("user_id, handle, display_name, bio, location_city, location_state, interests, avatar_color, is_public, show_motorcycle, featured_bike_id, show_stats")
    .eq("handle", handle)
    .maybeSingle();
  if (!row) return null;

  const isOwner = viewerId !== null && viewerId === row.user_id;
  if (!isOwner && !row.is_public) return null;

  let viewerHasBlocked = false;
  if (viewerId && !isOwner) {
    const { data: blocks } = await admin
      .from("profile_blocks")
      .select("blocker_id, blocked_id")
      .or(`and(blocker_id.eq.${row.user_id},blocked_id.eq.${viewerId}),and(blocker_id.eq.${viewerId},blocked_id.eq.${row.user_id})`);
    if ((blocks ?? []).some((b) => b.blocker_id === row.user_id)) return null;     // the owner blocked the viewer
    viewerHasBlocked = (blocks ?? []).some((b) => b.blocker_id === viewerId);
  }
  return { userId: row.user_id as string, row, isOwner, viewerHasBlocked };
}

export type PublicView = {
  profile: PublicProfile;
  isOwner: boolean;
  isPublic: boolean;
  viewerHasBlocked: boolean;
};

export async function loadPublicProfile(handle: string, viewerId: string | null): Promise<PublicView | null> {
  const access = await resolveAccess(handle, viewerId);
  if (!access) return null;
  const { row, userId } = access;
  const admin = createAdminClient();

  let bike: { make: string | null; model: string | null } | null = null;
  if (row.show_motorcycle && row.featured_bike_id) {
    const { data } = await admin.from("bikes").select("make, model").eq("id", row.featured_bike_id as string).eq("user_id", userId).maybeSingle();
    bike = data ?? null;
  }
  let stats: { rides: number; km: number; places: number } | null = null;
  if (row.show_stats) {
    const { data } = await admin.rpc("rider_stats", { p_user: userId });
    const s = Array.isArray(data) ? data[0] : data;
    if (s) stats = { rides: Number(s.rides), km: Number(s.km), places: Number(s.places) };
  }

  return {
    profile: toPublicProfile({ row: row as never, bike, stats }),
    isOwner: access.isOwner,
    isPublic: Boolean(row.is_public),
    viewerHasBlocked: access.viewerHasBlocked,
  };
}

export async function reportRider(supabase: Supa, viewerId: string, handle: string, raw: unknown): Promise<Result<{ duplicate: boolean }>> {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid report");
  const access = await resolveAccess(handle, viewerId);
  if (!access) return fail(404, "NOT_FOUND", "Rider not found");
  if (access.isOwner) return fail(422, "CANNOT_TARGET_SELF", "You cannot report your own profile");

  const { error } = await supabase.from("profile_reports").insert({
    reporter_id: viewerId, profile_user_id: access.userId, reason: parsed.data.reason, note: parsed.data.note,
  });
  // The unique open-report index means a second report for the same profile is a harmless duplicate.
  if (error?.code === "23505") return { ok: true, duplicate: true };
  if (error) return fail(500, "INTERNAL_ERROR", "Could not send the report");
  return { ok: true, duplicate: false };
}

export async function blockRider(supabase: Supa, viewerId: string, handle: string): Promise<Result> {
  const access = await resolveAccess(handle, viewerId);
  if (!access) return fail(404, "NOT_FOUND", "Rider not found");
  if (access.isOwner) return fail(422, "CANNOT_TARGET_SELF", "You cannot block yourself");
  const { error } = await supabase.from("profile_blocks").insert({ blocker_id: viewerId, blocked_id: access.userId });
  if (error && error.code !== "23505") return fail(500, "INTERNAL_ERROR", "Could not block this rider");
  return { ok: true };
}

/** Unblocking works even if the other rider has since made their profile private. */
export async function unblockRider(supabase: Supa, viewerId: string, handle: string): Promise<Result> {
  const h = normaliseHandle(handle);
  if (!HANDLE_SHAPE.test(h)) return fail(404, "NOT_FOUND", "Rider not found");
  const { data: target } = await createAdminClient().from("rider_profiles").select("user_id").eq("handle", h).maybeSingle();
  if (!target) return fail(404, "NOT_FOUND", "Rider not found");
  const { error } = await supabase.from("profile_blocks").delete().eq("blocker_id", viewerId).eq("blocked_id", target.user_id);
  return error ? fail(500, "INTERNAL_ERROR", "Could not unblock this rider") : { ok: true };
}

/** The viewer's own block list, shown as handles. Riders who deleted their profile appear as unavailable. */
export async function listBlocked(supabase: Supa): Promise<{ handle: string | null; displayName: string | null }[]> {
  const { data: blocks } = await supabase.from("profile_blocks").select("blocked_id").order("created_at", { ascending: false });
  const ids = (blocks ?? []).map((b) => b.blocked_id as string);
  if (ids.length === 0) return [];
  const { data: rows } = await createAdminClient().from("rider_profiles").select("user_id, handle, display_name").in("user_id", ids);
  const byId = new Map((rows ?? []).map((r) => [r.user_id as string, r]));
  return ids.map((id) => ({ handle: (byId.get(id)?.handle as string) ?? null, displayName: (byId.get(id)?.display_name as string) ?? null }));
}
