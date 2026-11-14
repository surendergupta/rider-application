import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth-page";
import { isModerator, listAudit, listQueue, listRestrictions, type AuditEvent, type QueueItem, type Restriction } from "@/features/moderation/service";
import { liftRestrictionAction, moderateAction } from "@/features/moderation/actions";
import { KIND_LABEL, MOD_NOTICES, REASON_MAX, REASON_MIN, REMOVE_LABEL, RESTRICT_DAYS, parseTab, type Tab } from "@/features/moderation/validation";

export const metadata = { title: "Moderation · India Long-Ride Planner", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TAB_LABEL: Record<Tab, string> = { open: "Open reports", closed: "Closed", restrictions: "Restrictions", audit: "Audit log" };
const when = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
const who = (p: { displayName: string; handle: string } | null) => (p ? `${p.displayName} (@${p.handle})` : "a rider");
const ACTION_TEXT: Record<string, string> = { start_review: "started a review", dismiss: "dismissed reports", remove: "took content down", restrict: "took content down and restricted the account", lift_restriction: "lifted a restriction" };

export default async function ModerationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requireSession();
  if (!(await isModerator(supabase))) notFound();             // riders get the same page as a missing one
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const notice = sp.notice ? MOD_NOTICES[sp.notice] : undefined;

  const [queue, restrictions, audit] = await Promise.all([
    tab === "open" || tab === "closed" ? listQueue(supabase, tab) : Promise.resolve<QueueItem[]>([]),
    tab === "restrictions" ? listRestrictions(supabase) : Promise.resolve<Restriction[]>([]),
    tab === "audit" ? listAudit(supabase) : Promise.resolve<AuditEvent[]>([]),
  ]);

  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">Moderation</h1>
      <p className="mt-1 text-sm text-muted">Reports on posts, group rides, clubs and rider profiles. Every action needs a reason and is saved in the audit log. Aim to review each report within 24 hours.</p>
      {notice && <p role="status" className={`mt-4 rounded-lg p-3 text-sm ${notice.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg"}`}>{notice.text}</p>}

      <nav aria-label="Moderation lists" className="mt-5 flex flex-wrap gap-2">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <Link key={t} href={t === "open" ? "/moderation" : `/moderation?tab=${t}`} aria-current={t === tab ? "page" : undefined}
            className={`tap rounded-full border px-4 text-sm ${t === tab ? "border-saffron bg-saffron font-semibold text-ink" : "border-line-strong hover:bg-sunken"}`}>{TAB_LABEL[t]}</Link>
        ))}
      </nav>

      {(tab === "open" || tab === "closed") && (
        queue.length === 0 ? <p className="mt-6 text-sm text-muted">{tab === "open" ? "No open reports. All clear." : "Nothing closed yet."}</p> : (
          <ul className="mt-4 space-y-3">{queue.map((i) => <QueueCard key={`${i.kind}-${i.targetId}`} item={i} tab={tab} />)}</ul>
        )
      )}

      {tab === "restrictions" && (
        restrictions.length === 0 ? <p className="mt-6 text-sm text-muted">No restricted accounts.</p> : (
          <ul className="mt-4 space-y-3">
            {restrictions.map((r) => (
              <li key={r.userId} className="rounded-xl border border-line p-4 text-sm" data-testid="restriction">
                <p><strong>{who(r.person)}</strong></p>
                <p className="text-muted">{r.until ? `Until ${when(r.until)}` : "Until a moderator lifts it"} · since {when(r.since)}</p>
                <p className="mt-1 break-words">Reason: {r.reason}</p>
                <form action={liftRestrictionAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="userId" value={r.userId} />
                  <label className="min-w-0 flex-1 text-sm"><span className="font-medium">Reason for lifting</span>
                    <input name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} className={input} /></label>
                  <button className="tap rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken">Lift restriction</button>
                </form>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "audit" && (
        audit.length === 0 ? <p className="mt-6 text-sm text-muted">No moderator actions yet.</p> : (
          <ol className="mt-4 space-y-2">
            {audit.map((e) => (
              <li key={e.id} className="rounded-lg border border-line p-3 text-sm" data-testid="audit-event">
                <p><strong>{who(e.actor)}</strong> {ACTION_TEXT[e.action] ?? e.action}{e.targetKind ? <> on a <span className="font-medium">{e.targetKind}</span></> : null}{e.owner ? <> by {who(e.owner)}</> : null}
                  {e.action === "restrict" ? (e.days ? ` for ${e.days} days` : " until lifted") : ""}{e.reports ? ` · ${e.reports} report${e.reports === 1 ? "" : "s"}` : ""}</p>
                {e.reason && <p className="break-words text-muted">Reason: {e.reason}</p>}
                <p className="text-xs text-muted"><time dateTime={e.createdAt}>{when(e.createdAt)}</time></p>
              </li>
            ))}
          </ol>
        )
      )}
    </main>
  );
}

function QueueCard({ item: i, tab }: { item: QueueItem; tab: Tab }) {
  const closed = i.status === "actioned" || i.status === "dismissed";
  const label = `${KIND_LABEL[i.kind]} “${i.summary.slice(0, 40)}”`;
  return (
    <li className="rounded-xl border border-line p-4" data-testid="report">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-sunken px-2 py-1 font-semibold">{KIND_LABEL[i.kind]}</span>
        <span className="rounded-full border border-line-strong px-2 py-1">{i.status === "under_review" ? "Under review" : i.status === "open" ? "Open" : i.status === "actioned" ? "Actioned" : "Dismissed"}</span>
        {i.targetState && <span className="text-muted">Now: {i.targetState}</span>}
        {i.ownerRestricted && <span className="rounded-full bg-danger-bg px-2 py-1 text-danger-fg">Owner restricted</span>}
      </div>
      <p className="mt-2 whitespace-pre-line break-words font-medium">{i.summary}</p>
      <p className="mt-1 text-sm text-muted">
        {i.reportCount === 1 ? "1 report" : `${i.reportCount} reports`}: {i.reasons.join(", ")} · first {when(i.firstReportedAt)}{i.owner ? <> · by {who(i.owner)}</> : null}
      </p>
      {i.note && <p className="mt-1 break-words text-sm">Reporter note: “{i.note}”</p>}

      {!closed && (
        <div className="mt-3 space-y-2">
          {i.status === "open" && (
            <form action={moderateAction}>
              <Hidden i={i} tab={tab} action="start_review" />
              <button className="tap rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken" aria-label={`Start review of ${label}`}>Start review</button>
            </form>
          )}
          <Decision i={i} tab={tab} action="dismiss" summary="Dismiss: no violation" button="Dismiss reports" label={label} />
          <Decision i={i} tab={tab} action="remove" summary={`${REMOVE_LABEL[i.kind]}`} button={REMOVE_LABEL[i.kind]} label={label} />
          <Decision i={i} tab={tab} action="restrict" summary={`${REMOVE_LABEL[i.kind]} and restrict the account`} button="Take down and restrict" label={label} days />
        </div>
      )}
    </li>
  );
}

function Hidden({ i, tab, action }: { i: QueueItem; tab: Tab; action: string }) {
  return (<>
    <input type="hidden" name="kind" value={i.kind} /><input type="hidden" name="reportId" value={i.reportId} />
    <input type="hidden" name="action" value={action} /><input type="hidden" name="tab" value={tab} />
  </>);
}

function Decision({ i, tab, action, summary, button, label, days }: { i: QueueItem; tab: Tab; action: string; summary: string; button: string; label: string; days?: boolean }) {
  return (
    <details className="rounded-lg border border-line">
      <summary className="tap cursor-pointer px-3 text-sm font-medium">{summary}</summary>
      <form action={moderateAction} className="space-y-2 p-3 pt-0">
        <Hidden i={i} tab={tab} action={action} />
        {days && (
          <label className="block text-sm"><span className="font-medium">Restriction</span>
            <select name="days" defaultValue="7" className={input}>
              {RESTRICT_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
              <option value="forever">Until a moderator lifts it</option>
            </select>
            <span className="mt-1 block text-xs text-muted">A restricted rider cannot post, host rides or create clubs.</span>
          </label>
        )}
        <label className="block text-sm"><span className="font-medium">Reason (saved in the audit log)</span>
          <textarea name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={2} className={input} /></label>
        <button className="tap rounded-lg bg-saffron px-4 text-sm font-semibold text-ink hover:brightness-95" aria-label={`${button}: ${label}`}>{button}</button>
      </form>
    </details>
  );
}
