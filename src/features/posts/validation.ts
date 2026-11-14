import { z } from "zod";

const stripControls = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

/** Must match the limit in supabase/migrations/0011_community_posts.sql. */
export const MAX_POST_LENGTH = 1000;
export const POSTS_PER_DAY = 20;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Choose a valid trip.");

/** Body text: control characters removed, line breaks kept, trimmed. Empty is allowed only for a ride story (checked in the schema rules). */
const body = z.string().default("").transform((s) => stripControls(s).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
  .pipe(z.string().max(MAX_POST_LENGTH, `A post must be ${MAX_POST_LENGTH} characters or fewer.`));

export const postCreateSchema = z.object({
  body,
  tripId: z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable()).default(null),
  includeDestination: z.preprocess((v) => v === true || v === "on" || v === "yes", z.boolean()).default(false),
}).superRefine((p, ctx) => {
  if (!p.tripId && p.body === "") ctx.addIssue({ code: "custom", path: ["body"], message: "Write something to share." });
});
export type PostCreate = z.infer<typeof postCreateSchema>;

export const postReportSchema = z.object({
  reason: z.enum(["spam", "unsafe", "inappropriate", "harassment", "other"], "Choose a reason."),
  note: z.string().default("").transform((s) => stripControls(s).trim()).pipe(z.string().max(500, "Details must be 500 characters or fewer.")).transform((s) => (s === "" ? null : s)),
});

export const postIdSchema = uuid;

/** Only these places may be used as a "go back to" target after a post action (no open redirects). */
export function safeReturnPath(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return /^\/posts(\?[a-z0-9=&_-]*)?$/i.test(s) || /^\/clubs\/[a-z0-9_]{3,30}$/.test(s) ? s : "/posts";
}

/** Short database codes from post_create(), turned into plain messages. */
export const POST_ERRORS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: "That post, club or trip could not be found." },
  club_archived: { status: 409, message: "This club has been archived." },
  profile_required: { status: 403, message: "Create a rider profile first. Other riders see your name on posts." },
  trip_not_completed: { status: 409, message: "Only a completed trip can be shared." },
  body_required: { status: 422, message: "Write something to share." },
  body_too_long: { status: 422, message: `A post must be ${MAX_POST_LENGTH} characters or fewer.` },
  post_rate_limit: { status: 429, message: `You can send ${POSTS_PER_DAY} posts a day. Try again tomorrow.` },
  account_restricted: { status: 403, message: "A moderator has restricted your account, so you cannot do this right now." },
  auth_required: { status: 401, message: "Sign in required." },
};

export function mapPostError(message: string | undefined): { status: number; code: string; message: string } {
  const code = Object.keys(POST_ERRORS).find((k) => (message ?? "").includes(k));
  return code ? { code, ...POST_ERRORS[code] } : { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Try again." };
}

/** "1,240.5 km" style, without false precision. */
export function formatKm(km: number): string {
  return `${km.toLocaleString("en-IN", { maximumFractionDigits: 1 })} km`;
}
