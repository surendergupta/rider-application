export type DueState = "ok" | "due_soon" | "overdue" | "unknown";

export interface DueResult {
  state: DueState;
  dueAtKm: number | null;
  remainingKm: number | null;
}

/** Remaining km at/below this (but > 0) counts as "due soon". */
export const DUE_SOON_KM = 500;

export function serviceDue(
  currentOdometerKm: number | null,
  lastServiceKm: number | null,
  intervalKm: number,
): DueResult {
  if (currentOdometerKm == null || lastServiceKm == null || intervalKm <= 0) {
    return { state: "unknown", dueAtKm: null, remainingKm: null };
  }
  const dueAtKm = lastServiceKm + intervalKm;
  const remainingKm = dueAtKm - currentOdometerKm;
  const state: DueState = remainingKm <= 0 ? "overdue" : remainingKm <= DUE_SOON_KM ? "due_soon" : "ok";
  return { state, dueAtKm, remainingKm };
}
