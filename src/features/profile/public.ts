import { AVATAR_COLORS, INTERESTS, initialsOf, type AvatarColor } from "./validation";

/**
 * The ONLY shape that ever leaves the server for a public profile page.
 * It is built field by field from a whitelist below, never by spreading a database row, so a column added to
 * the table later (or an extra field a query returns by mistake) cannot leak. It deliberately has no user id,
 * email, phone, address, registration number, VIN, document, exact location or ride history.
 */
export interface PublicProfile {
  handle: string;
  displayName: string;
  initials: string;
  avatarColor: AvatarColor;
  bio: string | null;
  location: string | null;
  interests: { id: string; label: string }[];
  motorcycle: string | null;
  stats: { rides: number; km: number; places: number } | null;
}

export interface ProfileSourceRow {
  handle: string;
  display_name: string;
  bio: string | null;
  location_city: string | null;
  location_state: string | null;
  interests: string[] | null;
  avatar_color: string;
  show_motorcycle: boolean;
  show_stats: boolean;
}

export function toPublicProfile(input: {
  row: ProfileSourceRow;
  bike?: { make?: string | null; model?: string | null } | null;
  stats?: { rides: number; km: number; places: number } | null;
}): PublicProfile {
  const { row } = input;
  const known = new Map<string, string>(INTERESTS.map((i) => [i.id, i.label]));
  const avatarColor = (row.avatar_color in AVATAR_COLORS ? row.avatar_color : "slate") as AvatarColor;

  // Motorcycle: make and model only, and only if the rider explicitly chose to show it.
  let motorcycle: string | null = null;
  if (row.show_motorcycle && input.bike) {
    const text = [input.bike.make, input.bike.model].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
    motorcycle = text || null;
  }

  return {
    handle: row.handle,
    displayName: row.display_name,
    initials: initialsOf(row.display_name),
    avatarColor,
    bio: row.bio,
    location: [row.location_city, row.location_state].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") || null,
    interests: (row.interests ?? []).filter((i) => known.has(i)).map((id) => ({ id, label: known.get(id)! })),
    motorcycle,
    // Ride statistics only with explicit permission.
    stats: row.show_stats && input.stats ? { rides: input.stats.rides, km: input.stats.km, places: input.stats.places } : null,
  };
}

/** Whole kilometres with Indian digit grouping: 4250 -> "4,250". */
export function formatKm(km: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(km));
}

/** Shareable URL path for a handle. */
export const profilePath = (handle: string) => `/rider/${handle}`;
