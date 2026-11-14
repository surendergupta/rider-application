import "server-only";
import type { createClient } from "@/lib/db/server";
import { personsByUserId, type Person } from "@/features/rides/service";
import { liftSchema, mapModError, modActionSchema, type ReportKind } from "./validation";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type Failure = { ok: false; status: number; code: string; message: string };
export type Result<T = object> = ({ ok: true } & T) | Failure;
const fail = (status: number, code: string, message: string): Failure => ({ ok: false, status, code, message });
const fromDbError = (message: string | undefined): Failure => { const m = mapModError(message); return fail(m.status, m.code, m.message); };

/** True for moderators only. Everyone else (and anonymous visitors) gets false and must be shown a plain "not found". */
export async function isModerator(supabase: Supa): Promise<boolean> {
  const { data } = await supabase.rpc("i_am_moderator");
  return data === true;
}

export interface QueueItem {
  kind: ReportKind;
  targetId: string;
  reportId: string;
  reportCount: number;
  reasons: string[];
  note: string | null;
  status: "open" | "under_review" | "actioned" | "dismissed";
  firstReportedAt: string;
  summary: string;
  targetState: string | null;
  owner: Person | null;
  ownerId: string | null;
  ownerRestricted: boolean;
}

interface QueueRow {
  kind: ReportKind; target_id: string; report_id: string; report_count: number; reasons: string[]; note: string | null;
  status: QueueItem["status"]; first_reported_at: string; summary: string | null; target_state: string | null; owner_id: string | null; owner_restricted: boolean | null;
}

export async function listQueue(supabase: Supa, scope: "open" | "closed"): Promise<QueueItem[]> {
  const { data } = await supabase.rpc("mod_queue", { p_scope: scope, p_limit: 50 });
  const rows = (data ?? []) as QueueRow[];
  const people = await personsByUserId(rows.map((r) => r.owner_id).filter((x): x is string => !!x));
  return rows.map((r) => ({
    kind: r.kind, targetId: r.target_id, reportId: r.report_id, reportCount: r.report_count, reasons: r.reasons, note: r.note, status: r.status,
    firstReportedAt: r.first_reported_at, summary: r.summary ?? "(already deleted)", targetState: r.target_state,
    owner: r.owner_id ? people.get(r.owner_id) ?? null : null, ownerId: r.owner_id, ownerRestricted: Boolean(r.owner_restricted),
  }));
}

export async function actOnReport(supabase: Supa, raw: unknown): Promise<Result<{ outcome: string }>> {
  const parsed = modActionSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the form.");
  const a = parsed.data;
  const { data, error } = await supabase.rpc("mod_act", {
    p_kind: a.kind, p_report: a.reportId, p_action: a.action, p_reason: a.reason === "" ? null : a.reason, p_days: a.action === "restrict" ? a.days : null,
  });
  if (error) return fromDbError(error.message);
  return { ok: true, outcome: String(data) };
}

export interface Restriction { userId: string; person: Person | null; reason: string; until: string | null; since: string }

export async function listRestrictions(supabase: Supa): Promise<Restriction[]> {
  const { data } = await supabase.rpc("mod_restrictions");
  const rows = (data ?? []) as { user_id: string; reason: string; restricted_until: string | null; created_at: string }[];
  const people = await personsByUserId(rows.map((r) => r.user_id));
  return rows.map((r) => ({ userId: r.user_id, person: people.get(r.user_id) ?? null, reason: r.reason, until: r.restricted_until, since: r.created_at }));
}

export async function liftRestriction(supabase: Supa, raw: unknown): Promise<Result> {
  const parsed = liftSchema.safeParse(raw);
  if (!parsed.success) return fail(422, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the form.");
  const { error } = await supabase.rpc("mod_lift_restriction", { p_user: parsed.data.userId, p_reason: parsed.data.reason });
  return error ? fromDbError(error.message) : { ok: true };
}

export interface AuditEvent {
  id: string; action: string; targetKind: string | null; targetId: string | null; reason: string | null; createdAt: string;
  actor: Person | null; owner: Person | null; days: number | null; reports: number | null;
}

export async function listAudit(supabase: Supa): Promise<AuditEvent[]> {
  const { data } = await supabase.from("moderation_audit").select("id, actor_id, action, target_kind, target_id, reason, detail, created_at")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);       // RLS: moderators only
  const rows = data ?? [];
  const ids = rows.flatMap((r) => [r.actor_id as string | null, (r.detail as { owner_id?: string } | null)?.owner_id ?? null, r.target_kind === "account" ? (r.target_id as string) : null]);
  const people = await personsByUserId(ids.filter((x): x is string => !!x));
  return rows.map((r) => {
    const d = (r.detail ?? {}) as { owner_id?: string; days?: number | null; reports?: number };
    const ownerId = r.target_kind === "account" ? (r.target_id as string) : d.owner_id ?? null;
    return {
      id: r.id as string, action: r.action as string, targetKind: r.target_kind as string | null, targetId: r.target_id as string | null,
      reason: r.reason as string | null, createdAt: r.created_at as string, actor: r.actor_id ? people.get(r.actor_id as string) ?? null : null,
      owner: ownerId ? people.get(ownerId) ?? null : null, days: d.days ?? null, reports: d.reports ?? null,
    };
  });
}

/** For the posts screen: a rider told why they cannot post. Null when they are not restricted. */
export async function myRestriction(supabase: Supa, userId: string): Promise<{ reason: string; until: string | null } | null> {
  const { data } = await supabase.from("account_restrictions").select("reason, restricted_until").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const until = data.restricted_until as string | null;
  if (until && Date.parse(until) <= Date.now()) return null;
  return { reason: data.reason as string, until };
}
