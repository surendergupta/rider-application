import { z } from "zod";

const stripControls = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id.");

export const REPORT_KINDS = ["post", "ride", "club", "profile"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const MOD_ACTIONS = ["start_review", "dismiss", "remove", "restrict"] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];

/** Must match mod_act() in supabase/migrations/0013_moderation.sql. */
export const REASON_MIN = 3;
export const REASON_MAX = 300;
export const RESTRICT_DAYS = [7, 30, 90] as const;

const reason = z.string().default("").transform((s) => stripControls(s).replace(/\s+/g, " ").trim());

export const modActionSchema = z.object({
  kind: z.enum(REPORT_KINDS, "Unknown report type."),
  reportId: uuid,
  action: z.enum(MOD_ACTIONS, "Unknown action."),
  reason,
  /** "" or "forever" = until a moderator lifts it. */
  days: z.preprocess((v) => (v === "" || v == null || v === "forever" ? null : Number(v)), z.number().int().min(1).max(365).nullable()).default(null),
}).superRefine((a, ctx) => {
  if (a.action !== "start_review" && (a.reason.length < REASON_MIN || a.reason.length > REASON_MAX)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters. It is saved in the audit log.` });
  }
});

export const liftSchema = z.object({ userId: uuid, reason: reason.pipe(z.string().min(REASON_MIN, `Give a reason of at least ${REASON_MIN} characters.`).max(REASON_MAX, `The reason must be ${REASON_MAX} characters or fewer.`)) });

export const TABS = ["open", "closed", "restrictions", "audit"] as const;
export type Tab = (typeof TABS)[number];
export const parseTab = (v: unknown): Tab => TABS.find((t) => t === v) ?? "open";

export const KIND_LABEL: Record<ReportKind, string> = { post: "Post", ride: "Group ride", club: "Club", profile: "Rider profile" };
export const REMOVE_LABEL: Record<ReportKind, string> = { post: "Remove post", ride: "Cancel ride", club: "Archive club", profile: "Make profile private" };

/** Short database codes from the moderator functions, turned into plain messages. */
export const MOD_ERRORS: Record<string, { status: number; message: string }> = {
  not_moderator: { status: 404, message: "Not found." },
  reason_required: { status: 422, message: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.` },
  already_closed: { status: 409, message: "Another moderator already closed this report." },
  not_found: { status: 404, message: "That report could not be found." },
  self_target: { status: 403, message: "You cannot act on a report about your own content. Ask another moderator." },
  cannot_restrict: { status: 403, message: "That account cannot be restricted." },
  bad_days: { status: 422, message: "Choose how long the restriction lasts." },
  bad_kind: { status: 422, message: "Unknown report type." },
  bad_action: { status: 422, message: "Unknown action." },
  bad_scope: { status: 422, message: "Unknown list." },
};

export function mapModError(message: string | undefined): { status: number; code: string; message: string } {
  const code = Object.keys(MOD_ERRORS).find((k) => (message ?? "").includes(k));
  return code ? { code, ...MOD_ERRORS[code] } : { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Try again." };
}

export const MOD_NOTICES: Record<string, { ok: boolean; text: string }> = {
  under_review: { ok: true, text: "Marked as under review." },
  dismissed: { ok: true, text: "Report dismissed." },
  actioned: { ok: true, text: "Done. The content was taken down and the action is in the audit log." },
  lifted: { ok: true, text: "Restriction lifted." },
  invalid: { ok: false, text: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters. It is saved in the audit log.` },
  rate: { ok: false, text: "Too many actions in a short time. Wait a moment." },
  ...Object.fromEntries(Object.entries(MOD_ERRORS).filter(([k]) => k !== "not_moderator").map(([k, v]) => [k, { ok: false, text: v.message }])),
};
