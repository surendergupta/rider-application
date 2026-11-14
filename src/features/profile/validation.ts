import { z } from "zod";

/** Must match the CHECK constraint in supabase/migrations/0007_rider_profiles.sql. */
export const RESERVED_HANDLES: readonly string[] = [
  "admin", "administrator", "root", "support", "help", "staff", "moderator", "mod", "official", "system", "api", "www", "app",
  "login", "signup", "home", "trips", "bikes", "garage", "map", "account", "profile", "settings", "pricing", "terms", "privacy",
  "community", "marketplace", "rider", "riders", "r", "s", "null", "undefined", "anonymous", "me",
];

export const INTERESTS = [
  { id: "adventure", label: "Adventure" },
  { id: "touring", label: "Long touring" },
  { id: "commuting", label: "Commuting" },
  { id: "weekend", label: "Weekend rides" },
  { id: "mountains", label: "Mountains" },
  { id: "off_road", label: "Off-road" },
  { id: "city", label: "City riding" },
] as const;
export type InterestId = (typeof INTERESTS)[number]["id"];
export const MAX_INTERESTS = 6;

/**
 * Avatar is a coloured initials badge (no image upload until moderation tooling exists, see docs/08).
 * Every colour keeps white text at 4.5:1 or better (enforced by a unit test).
 */
export const AVATAR_COLORS = {
  orange: "#c2410c",
  teal: "#0f766e",
  indigo: "#4338ca",
  rose: "#be123c",
  emerald: "#047857",
  slate: "#334155",
} as const;
export type AvatarColor = keyof typeof AVATAR_COLORS;

export const HANDLE_COOLDOWN_DAYS = 30;

/** "@Rider_One " -> "rider_one" */
export function normaliseHandle(input: unknown): string {
  return String(input ?? "").trim().replace(/^@+/, "").toLowerCase();
}

// Control characters (except newline/tab in the bio) never belong in a name or bio.
const stripControls = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
const cleanLine = (s: string) => stripControls(s).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

const handleSchema = z
  .string()
  .transform(normaliseHandle)
  .pipe(
    z.string()
      .regex(/^[a-z0-9_]{3,20}$/, "Handle must be 3 to 20 characters: letters, numbers and underscores.")
      .refine((h) => /[a-z]/.test(h), "Handle must contain at least one letter.")
      .refine((h) => !RESERVED_HANDLES.includes(h), "That handle is reserved. Choose another."),
  );

function optionalLine(max: number, label: string) {
  return z
    .string()
    .default("")
    .transform(cleanLine)
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`))
    .transform((s) => (s === "" ? null : s));
}

export const profileInputSchema = z
  .object({
    handle: handleSchema,
    display_name: z
      .string()
      .transform(cleanLine)
      .pipe(z.string().min(1, "Enter a display name.").max(50, "Display name must be 50 characters or fewer.")),
    bio: z
      .string()
      .default("")
      .transform((s) => stripControls(s).replace(/\r\n/g, "\n").trim())
      .pipe(z.string().max(300, "Bio must be 300 characters or fewer."))
      .transform((s) => (s === "" ? null : s)),
    location_city: optionalLine(60, "City"),
    location_state: optionalLine(60, "State"),
    interests: z
      .array(z.enum(INTERESTS.map((i) => i.id) as [InterestId, ...InterestId[]], "Pick interests from the list."))
      .max(MAX_INTERESTS, `Pick up to ${MAX_INTERESTS} interests.`)
      .transform((a) => [...new Set(a)]),
    avatar_color: z.enum(Object.keys(AVATAR_COLORS) as [AvatarColor, ...AvatarColor[]], "Pick an avatar colour from the list."),
    is_public: z.boolean(),
    show_motorcycle: z.boolean(),
    featured_bike_id: z.uuid().nullable(),
    show_stats: z.boolean(),
    // Listed in rider discovery. Needs a public profile: the database forces it off for private ones.
    discoverable: z.boolean().default(false),
  })
  .refine((p) => !p.show_motorcycle || p.featured_bike_id !== null, {
    message: "Choose which motorcycle to show, or turn the motorcycle off.",
    path: ["featured_bike_id"],
  });

export type ProfileInput = z.infer<typeof profileInputSchema>;

export const reportSchema = z.object({
  reason: z.enum(["spam", "impersonation", "inappropriate", "harassment", "other"], "Choose a reason."),
  note: z
    .string()
    .default("")
    .transform((s) => stripControls(s).trim())
    .pipe(z.string().max(500, "Note must be 500 characters or fewer."))
    .transform((s) => (s === "" ? null : s)),
});

/** First free change after creation, then one change per HANDLE_COOLDOWN_DAYS (the database enforces this too). */
export function canChangeHandle(changedAt: string | null, now: Date = new Date(), days = HANDLE_COOLDOWN_DAYS): { allowed: boolean; nextAllowedAt: Date | null } {
  if (!changedAt) return { allowed: true, nextAllowedAt: null };
  const next = new Date(new Date(changedAt).getTime() + days * 86_400_000);
  return next.getTime() > now.getTime() ? { allowed: false, nextAllowedAt: next } : { allowed: true, nextAllowedAt: null };
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase();
}
