import { z } from "zod";
import { normaliseHandle } from "@/features/profile/validation";

const stripControls = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
const cleanLine = (s: string) => stripControls(s).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/** Must match the CHECK constraint in supabase/migrations/0010_clubs.sql (these would collide with routes or look official). */
export const RESERVED_CLUB_SLUGS: readonly string[] = ["new", "edit", "mine", "admin", "support", "help", "api", "clubs", "club", "official", "riders", "rides"];

export const normaliseSlug = normaliseHandle;      // same rules as rider handles: lowercase, no leading @

function optionalLine(max: number, label: string) {
  return z.string().default("").transform(cleanLine).pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`)).transform((s) => (s === "" ? null : s));
}

export const slugSchema = z.string().transform(normaliseSlug).pipe(
  z.string()
    .regex(/^[a-z0-9_]{3,30}$/, "The club link must be 3 to 30 characters: letters, numbers and underscores.")
    .refine((s) => /[a-z]/.test(s), "The club link must contain at least one letter.")
    .refine((s) => !RESERVED_CLUB_SLUGS.includes(s), "That link is reserved. Choose another."),
);

const base = z.object({
  name: z.string().transform(cleanLine).pipe(z.string().min(3, "Give the club a name of at least 3 characters.").max(60, "Club name must be 60 characters or fewer.")),
  description: z.string().default("").transform((s) => stripControls(s).replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(500, "Description must be 500 characters or fewer.")).transform((s) => (s === "" ? null : s)),
  city: optionalLine(60, "City"),
  state: optionalLine(60, "State"),
  visibility: z.enum(["public", "private"], "Choose who can see this club."),
  join_policy: z.enum(["open", "approval", "invite"], "Choose how riders join."),
  member_limit: z.number("Enter a member limit.").int("The limit must be a whole number.").min(2, "A club needs room for at least 2 members.").max(1000, "Up to 1,000 members."),
});

const rules = (c: { visibility: string; join_policy: string }, ctx: z.RefinementCtx) => {
  if (c.visibility === "private" && c.join_policy !== "invite") {
    ctx.addIssue({ code: "custom", path: ["join_policy"], message: "A private club is invite only." });
  }
};

/** Creating a club also needs a link (slug); editing never changes it, so shared links keep working. */
export const clubCreateSchema = base.extend({ slug: slugSchema }).superRefine(rules);
export const clubUpdateSchema = base.superRefine(rules);
export type ClubCreate = z.infer<typeof clubCreateSchema>;

export const clubReportSchema = z.object({
  reason: z.enum(["spam", "unsafe", "inappropriate", "harassment", "other"], "Choose a reason."),
  note: z.string().default("").transform((s) => stripControls(s).trim()).pipe(z.string().max(500, "Details must be 500 characters or fewer.")).transform((s) => (s === "" ? null : s)),
});

export const clubFilterSchema = z.object({
  q: z.string().default("").transform((s) => s.replace(/[^\p{L}\p{N}_ ]/gu, " ").replace(/\s{2,}/g, " ").trim()).pipe(z.string().max(40)).catch(""),
  state: z.string().default("").transform((s) => s.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s{2,}/g, " ").trim()).pipe(z.string().max(60)).catch(""),
});

export const JOIN_POLICY_LABEL: Record<string, string> = { open: "Anyone can join", approval: "Join by approval", invite: "Invite only" };

/** Short database codes from the membership functions, turned into plain messages. */
export const CLUB_ERRORS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: "That club or rider could not be found." },
  club_full: { status: 409, message: "This club is full." },
  club_archived: { status: 409, message: "This club has been archived." },
  profile_required: { status: 403, message: "Create a rider profile first. Other members see it." },
  is_owner: { status: 422, message: "That is the club owner." },
  removed: { status: 403, message: "You were removed from this club." },
  already_member: { status: 409, message: "That rider is already a member." },
  too_many_invites: { status: 409, message: "This club has too many pending invitations." },
  invite_only: { status: 403, message: "This club is invite only." },
  not_allowed: { status: 403, message: "Only the owner can do that." },
  limit_below_members: { status: 409, message: "The limit cannot be lower than the current members." },
  auth_required: { status: 401, message: "Sign in required." },
};

export function mapClubError(message: string | undefined): { status: number; code: string; message: string } {
  const code = Object.keys(CLUB_ERRORS).find((k) => (message ?? "").includes(k));
  return code ? { code, ...CLUB_ERRORS[code] } : { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Try again." };
}
