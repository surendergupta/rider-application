import { describe, expect, it } from "vitest";
import { LONG_DAY_KM, MAX_WAYPOINTS, compareWithBudget, mapsHandoffUrl, summarizeItinerary, type Stop } from "@/features/trips/itinerary";

let n = 0;
const stop = (day: number, place: string, legKm: number | null, sortOrder = n++): Stop => ({
  id: String(n++), day, sortOrder, place, type: "ride", legKm, note: null,
});

describe("itinerary summary", () => {
  it("groups by day in day order and sorts stops within a day", () => {
    const r = summarizeItinerary([stop(2, "Ajmer", 135, 0), stop(1, "Neemrana", 100, 1), stop(1, "Gurugram", 30, 0)]);
    expect(r.days.map((d) => d.day)).toEqual([1, 2]);
    expect(r.days[0].stops.map((s) => s.place)).toEqual(["Gurugram", "Neemrana"]);
  });
  it("totals distance per day and overall without float noise", () => {
    const r = summarizeItinerary([stop(1, "A", 0.1, 0), stop(1, "B", 0.2, 1), stop(2, "C", 135.5, 0)]);
    expect(r.days[0].totalKm).toBe(0.3);
    expect(r.totalKm).toBe(135.8);
    expect(r.stopCount).toBe(3);
  });
  it("counts stops with no distance so the total is not silently trusted", () => {
    const r = summarizeItinerary([stop(1, "A", 50, 0), stop(1, "B", null, 1)]);
    expect(r.days[0].missingKm).toBe(1);
    expect(r.days[0].totalKm).toBe(50);
  });
  it("flags long days above the threshold only", () => {
    const r = summarizeItinerary([stop(1, "A", LONG_DAY_KM, 0), stop(2, "B", LONG_DAY_KM + 1, 0)]);
    expect(r.days[0].longDay).toBe(false);
    expect(r.days[1].longDay).toBe(true);
  });
  it("handles an empty itinerary", () => {
    expect(summarizeItinerary([])).toEqual({ days: [], totalKm: 0, stopCount: 0 });
  });
});

describe("compare with budget distance", () => {
  it("treats small differences as a match", () => {
    expect(compareWithBudget(275, 270).state).toBe("match");
    expect(compareWithBudget(260, 270).state).toBe("match");
    expect(compareWithBudget(1030, 1000).state).toBe("match"); // 3% of 1000
  });
  it("reports over and under with the size of the gap", () => {
    expect(compareWithBudget(405, 270)).toEqual({ state: "over", diffKm: 135 });
    expect(compareWithBudget(900, 1000)).toEqual({ state: "under", diffKm: 100 });
  });
});

describe("navigation handoff link", () => {
  it("builds a directions URL with origin, destination and waypoints", () => {
    const { url, skipped } = mapsHandoffUrl({ origin: "Delhi", destination: "Jaipur", stops: [{ place: "Neemrana" }, { place: "Shahpura" }] });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("origin")).toBe("Delhi");
    expect(u.searchParams.get("destination")).toBe("Jaipur");
    expect(u.searchParams.get("waypoints")).toBe("Neemrana|Shahpura");
    expect(skipped).toBe(0);
  });
  it("omits waypoints when there are no stops", () => {
    expect(new URL(mapsHandoffUrl({ origin: "A", destination: "B", stops: [] }).url).searchParams.has("waypoints")).toBe(false);
  });
  it("encodes special characters and strips the waypoint separator from names", () => {
    const { url } = mapsHandoffUrl({ origin: "Delhi & NCR", destination: "Jaipur", stops: [{ place: "A|B\nC" }] });
    const u = new URL(url);
    expect(u.searchParams.get("origin")).toBe("Delhi & NCR");
    expect(u.searchParams.get("waypoints")).toBe("A B C");
  });
  it("caps waypoints and says how many were left out", () => {
    const stops = Array.from({ length: MAX_WAYPOINTS + 3 }, (_, i) => ({ place: `P${i}` }));
    const { url, skipped } = mapsHandoffUrl({ origin: "A", destination: "B", stops });
    expect(new URL(url).searchParams.get("waypoints")!.split("|")).toHaveLength(MAX_WAYPOINTS);
    expect(skipped).toBe(3);
  });
});
