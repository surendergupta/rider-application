export type DocType = "insurance" | "puc" | "registration" | "other";
export type DocState = "expired" | "expiring" | "ok";

export const DOC_LABEL: Record<DocType, string> = {
  insurance: "Insurance",
  puc: "PUC certificate",
  registration: "Registration (RC)",
  other: "Other document",
};

/** Within this many days of expiry a document is flagged "expiring". */
export const EXPIRING_DAYS = 30;

/** Today's calendar date in India (UTC+5:30), as YYYY-MM-DD. Expiry dates are calendar dates, not instants. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const dayNumber = (isoDate: string) => Math.floor(Date.parse(isoDate + "T00:00:00Z") / 86_400_000);

/**
 * Days left until the document expires (0 = expires today, negative = already expired).
 * A document is still valid on its expiry date, so it is "expired" only from the next day.
 */
export function documentStatus(expiresOn: string, today: string): { state: DocState; daysLeft: number } {
  const daysLeft = dayNumber(expiresOn) - dayNumber(today);
  const state: DocState = daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_DAYS ? "expiring" : "ok";
  return { state, daysLeft };
}

export function describeStatus(s: { state: DocState; daysLeft: number }): string {
  if (s.state === "expired") return `Expired ${-s.daysLeft} day${s.daysLeft === -1 ? "" : "s"} ago`;
  if (s.daysLeft === 0) return "Expires today";
  return `Expires in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}`;
}
