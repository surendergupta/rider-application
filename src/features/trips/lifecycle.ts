export type TripStatus = "draft" | "active" | "completed" | "archived";

// Mirrors the DB trigger in supabase/migrations/0002_integrity.sql
const ALLOWED: Record<TripStatus, TripStatus[]> = {
  draft: ["active", "archived"],
  active: ["completed", "archived"],
  completed: ["archived", "active"], // re-open is explicit
  archived: ["draft", "completed"], // restore returns to a sensible prior state
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED[from].includes(to);
}
