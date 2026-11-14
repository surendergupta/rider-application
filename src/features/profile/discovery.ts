import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/db/admin";
import { INTERESTS, initialsOf, type AvatarColor } from "./validation";

export const DISCOVERY_PAGE_SIZE = 24;

/** The only fields discovery ever returns: a strict subset of the public profile. No id, email, motorcycle or statistics. */
export interface RiderCard {
  handle: string;
  displayName: string;
  initials: string;
  avatarColor: AvatarColor;
  location: string | null;
  bio: string | null;
  interests: { id: string; label: string }[];
}

const interestIds = INTERESTS.map((i) => i.id) as [string, ...string[]];
export const discoveryFilterSchema = z.object({
  q: z.string().default("").transform((s) => s.replace(/[^\p{L}\p{N}_ ]/gu, " ").replace(/\s{2,}/g, " ").trim()).pipe(z.string().max(40)).catch(""),
  state: z.string().default("").transform((s) => s.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s{2,}/g, " ").trim()).pipe(z.string().max(60)).catch(""),
  interest: z.enum(interestIds).or(z.literal("")).catch(""),
  page: z.coerce.number().int().min(1).max(50).catch(1),
});
export type DiscoveryFilters = z.infer<typeof discoveryFilterSchema>;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

/**
 * Riders who opted in to discovery (public AND discoverable). Signed-in callers only (enforced by the page),
 * paginated, excludes the caller, and excludes anyone blocked in either direction.
 */
export async function discoverRiders(viewerId: string, rawFilters: unknown): Promise<{ riders: RiderCard[]; page: number; hasMore: boolean }> {
  const f = discoveryFilterSchema.parse(rawFilters ?? {});
  const admin = createAdminClient();

  let q = admin.from("rider_profiles")
    .select("user_id, handle, display_name, bio, location_city, location_state, interests, avatar_color")
    .eq("discoverable", true).eq("is_public", true).neq("user_id", viewerId)
    .order("handle");
  if (f.q) q = q.or(`handle.ilike.%${likeEscape(f.q.replace(/ /g, ""))}%,display_name.ilike.%${likeEscape(f.q)}%`);
  if (f.state) q = q.ilike("location_state", `%${likeEscape(f.state)}%`);
  if (f.interest) q = q.contains("interests", [f.interest]);
  const from = (f.page - 1) * DISCOVERY_PAGE_SIZE;
  const { data } = await q.range(from, from + DISCOVERY_PAGE_SIZE);        // one extra row tells us whether there is a next page

  const { data: blocks } = await admin.from("profile_blocks").select("blocker_id, blocked_id").or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
  const hidden = new Set((blocks ?? []).flatMap((b) => [b.blocker_id as string, b.blocked_id as string]));

  const known = new Map<string, string>(INTERESTS.map((i) => [i.id, i.label]));
  const rows = (data ?? []).slice(0, DISCOVERY_PAGE_SIZE).filter((r) => !hidden.has(r.user_id as string));
  return {
    page: f.page,
    hasMore: (data ?? []).length > DISCOVERY_PAGE_SIZE,
    riders: rows.map((r) => ({
      handle: r.handle as string,
      displayName: r.display_name as string,
      initials: initialsOf(r.display_name as string),
      avatarColor: r.avatar_color as AvatarColor,
      location: [r.location_city, r.location_state].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") || null,
      bio: r.bio ? String(r.bio).slice(0, 140) : null,
      interests: ((r.interests as string[]) ?? []).filter((i) => known.has(i)).map((id) => ({ id, label: known.get(id)! })),
    })),
  };
}
