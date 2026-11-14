export type StopType = "ride" | "fuel" | "food" | "stay" | "sight" | "other";

export const STOP_LABEL: Record<StopType, string> = {
  ride: "Ride",
  fuel: "Fuel",
  food: "Food",
  stay: "Stay",
  sight: "Sightseeing",
  other: "Other",
};

export interface Stop {
  id: string;
  day: number;
  sortOrder: number;
  place: string;
  type: StopType;
  legKm: number | null;
  note: string | null;
}

export interface DayPlan {
  day: number;
  stops: Stop[];
  totalKm: number;
  /** Stops on this day with no distance entered, so totalKm may undercount. */
  missingKm: number;
  longDay: boolean;
}

/** A prompt, not a rule: days above this many km are flagged so the rider plans rest and daylight. */
export const LONG_DAY_KM = 400;

/** Groups stops by day (in order) and totals the distance the rider entered. */
export function summarizeItinerary(stops: Stop[]): { days: DayPlan[]; totalKm: number; stopCount: number } {
  const byDay = new Map<number, Stop[]>();
  for (const s of stops) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  const days: DayPlan[] = [...byDay.keys()].sort((a, b) => a - b).map((day) => {
    const list = (byDay.get(day) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const totalKm = Math.round(list.reduce((sum, s) => sum + (s.legKm ?? 0), 0) * 10) / 10;
    return { day, stops: list, totalKm, missingKm: list.filter((s) => s.legKm == null).length, longDay: totalKm > LONG_DAY_KM };
  });
  const totalKm = Math.round(days.reduce((sum, d) => sum + d.totalKm, 0) * 10) / 10;
  return { days, totalKm, stopCount: stops.length };
}

export type BudgetMatch = { state: "match" | "over" | "under"; diffKm: number };

/**
 * Compares the itinerary's distance with the distance the budget was built on.
 * Small differences are normal, so anything within max(10 km, 5%) counts as a match.
 */
export function compareWithBudget(itineraryKm: number, budgetKm: number): BudgetMatch {
  const diff = Math.round((itineraryKm - budgetKm) * 10) / 10;
  const tolerance = Math.max(10, budgetKm * 0.05);
  if (Math.abs(diff) <= tolerance) return { state: "match", diffKm: diff };
  return { state: diff > 0 ? "over" : "under", diffKm: Math.abs(diff) };
}

/** Google Maps directions URL allows a limited number of waypoints. */
export const MAX_WAYPOINTS = 9;

const clean = (s: string) => s.replace(/[|\r\n]+/g, " ").trim();

/**
 * Opens the route in an established navigation app instead of building our own turn-by-turn navigation.
 * Uses place names the rider typed; it is a plain link, no API key, nothing is sent until the rider taps it.
 * Returns the URL and how many stops had to be left out because of the waypoint limit.
 */
export function mapsHandoffUrl(input: { origin: string; destination: string; stops: { place: string }[] }): { url: string; skipped: number } {
  const places = input.stops.map((s) => clean(s.place)).filter(Boolean);
  const used = places.slice(0, MAX_WAYPOINTS);
  const params = new URLSearchParams({
    api: "1",
    origin: clean(input.origin),
    destination: clean(input.destination),
    travelmode: "driving",
  });
  if (used.length > 0) params.set("waypoints", used.join("|"));
  return { url: `https://www.google.com/maps/dir/?${params.toString()}`, skipped: places.length - used.length };
}
