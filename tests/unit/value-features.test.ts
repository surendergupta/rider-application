import { describe, expect, it } from "vitest";
import { realMileage } from "@/features/bikes/mileage";
import { fuelPlan } from "@/features/trips/fuel-plan";
import { buildChecklist, checklistProgress, gearStillNeeded, isReady } from "@/features/trips/checklist";

describe("real mileage", () => {
  it("computes km per litre from consecutive fills", () => {
    const r = realMileage([
      { odometerKm: 1000, litres: 12 },
      { odometerKm: 1300, litres: 10 },
      { odometerKm: 1580, litres: 10 },
    ]);
    expect(r?.kmPerLitre).toBe(29);
    expect(r?.fills).toBe(3);
    expect(r?.distanceKm).toBe(580);
  });
  it("needs at least two fills", () => {
    expect(realMileage([])).toBeNull();
    expect(realMileage([{ odometerKm: 1000, litres: 10 }])).toBeNull();
  });
  it("ignores fills given out of order and skips impossible pairs", () => {
    const r = realMileage([
      { odometerKm: 1580, litres: 10 },
      { odometerKm: 1000, litres: 12 },
      { odometerKm: 1300, litres: 10 },
      { odometerKm: 1300, litres: 5 },
    ]);
    expect(r?.kmPerLitre).toBe(29);
  });
  it("refuses an implausible result instead of showing a wrong number", () => {
    expect(realMileage([{ odometerKm: 0, litres: 1 }, { odometerKm: 5000, litres: 1 }])).toBeNull();
  });
});

describe("fuel plan", () => {
  it("600 km, 30 km/l, 12 l tank: 360 km range, 288 km safe, stops at 288 and 576", () => {
    const p = fuelPlan({ distanceKm: 600, mileageKmpl: 30, tankLitres: 12 })!;
    expect(p.rangeKm).toBe(360);
    expect(p.safeRangeKm).toBe(288);
    expect(p.stopAtKm).toEqual([288, 576]);
    expect(p.stops).toBe(2);
    expect(p.litresNeeded).toBe(20);
  });
  it("needs no stop when the trip fits in one safe range", () => {
    expect(fuelPlan({ distanceKm: 270, mileageKmpl: 30, tankLitres: 15 })!.stops).toBe(0);
  });
  it("never lists a stop at or beyond the destination", () => {
    expect(fuelPlan({ distanceKm: 288, mileageKmpl: 30, tankLitres: 12 })!.stopAtKm).toEqual([]);
  });
  it("warns that markers are not pump locations", () => {
    expect(fuelPlan({ distanceKm: 600, mileageKmpl: 30, tankLitres: 12 })!.warnings.join(" ")).toMatch(/not pump locations/);
  });
  it("rejects invalid input", () => {
    expect(fuelPlan({ distanceKm: 0, mileageKmpl: 30, tankLitres: 12 })).toBeNull();
    expect(fuelPlan({ distanceKm: 100, mileageKmpl: 0, tankLitres: 12 })).toBeNull();
    expect(fuelPlan({ distanceKm: 100, mileageKmpl: 30, tankLitres: 0 })).toBeNull();
  });
});

const labels = (p = {}) => buildChecklist(p).map((i) => i.label);
const has = (p: object, text: string) => labels(p).some((l) => l.includes(text));

describe("personalised checklist", () => {
  it("core list has all five categories and unique labels (DB enforces unique per trip)", () => {
    const list = buildChecklist();
    expect(new Set(list.map((i) => i.category))).toEqual(new Set(["documents", "safety", "motorcycle", "touring", "essentials"]));
    for (const p of [{}, { days: 5, terrain: "mountains", season: "winter" }, { days: 1, terrain: "desert", season: "summer" }]) {
      const l = labels(p as object);
      expect(new Set(l).size).toBe(l.length);
    }
  });
  it("is stable: same profile gives the same list and sort order", () => {
    const a = buildChecklist({ days: 3, terrain: "hills" }), b = buildChecklist({ days: 3, terrain: "hills" });
    expect(a).toEqual(b);
    expect(a.map((i) => i.sortOrder)).toEqual(a.map((_, i) => i));
  });
  it("adds terrain-specific items", () => {
    expect(has({ terrain: "mountains" }, "Permits")).toBe(true);
    expect(has({ terrain: "mountains" }, "altitude")).toBe(true);
    expect(has({ terrain: "desert" }, "Air filter")).toBe(true);
    expect(has({ terrain: "plains" }, "Permits")).toBe(false);
  });
  it("adds season-specific items", () => {
    expect(has({ season: "monsoon" }, "Raincoat")).toBe(true);
    expect(has({ season: "winter" }, "Thermal")).toBe(true);
    expect(has({ season: "summer" }, "Sunscreen")).toBe(true);
    expect(has({ season: "summer" }, "Raincoat")).toBe(false);
  });
  it("adds trip-length items only for longer trips", () => {
    expect(has({ days: 1 }, "Stay booked")).toBe(false);
    expect(has({ days: 2 }, "Stay booked")).toBe(true);
    expect(has({ days: 2 }, "Bungee")).toBe(false);
    expect(has({ days: 4 }, "Bungee")).toBe(true);
  });
  it("an unset profile never triggers conditional items", () => {
    expect(has({}, "Raincoat")).toBe(false);
    expect(has({}, "Permits")).toBe(false);
    expect(has({}, "Stay booked")).toBe(false);
  });
  it("a longer, harder trip has more items than the core list", () => {
    expect(buildChecklist({ days: 6, terrain: "mountains", season: "winter" }).length).toBeGreaterThan(buildChecklist().length);
  });
});

describe("checklist status", () => {
  it("packed and N/A count as ready; owned and needed do not", () => {
    expect(isReady("packed")).toBe(true);
    expect(isReady("not_applicable")).toBe(true);
    expect(isReady("owned")).toBe(false);
    expect(isReady("needed")).toBe(false);
  });
  it("progress counts ready items and items still needed", () => {
    const p = checklistProgress([{ status: "packed" }, { status: "owned" }, { status: "needed" }, { status: "not_applicable" }]);
    expect(p).toEqual({ ready: 2, total: 4, percent: 50, stillNeeded: 1 });
    expect(checklistProgress([]).percent).toBe(0);
  });
  it("lists only safety gear that is still needed (feeds the marketplace waitlist prompt)", () => {
    const need = gearStillNeeded([
      { label: "Riding gloves", status: "needed" },
      { label: "Riding boots", status: "owned" },
      { label: "Driving licence", status: "needed" },
    ]);
    expect(need).toEqual(["Riding gloves"]);
  });
});
