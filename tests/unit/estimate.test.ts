import { describe, expect, it } from "vitest";
import { computeEstimate, costPerKmPaise } from "@/lib/money/estimate";

const base = { tollPaise: 0, foodPaise: 0, stayPaise: 0, otherPaise: 0 };

describe("golden estimate cases", () => {
  it("600 km / 30 kmpl @ Rs100 = 20 l, Rs2,000", () => {
    const e = computeEstimate({ ...base, distanceKm: 600, plannedMileageKmPerLitre: 30, petrolPricePaisePerLitre: 10000 });
    expect(e.fuelLitres).toBe(20);
    expect(e.fuelPaise).toBe(200000);
  });
  it("270 km / 30 kmpl @ Rs105 = 9 l, Rs945", () => {
    const e = computeEstimate({ ...base, distanceKm: 270, plannedMileageKmPerLitre: 30, petrolPricePaisePerLitre: 10500 });
    expect(e.fuelLitres).toBe(9);
    expect(e.fuelPaise).toBe(94500);
  });
  it("adding Rs500 food + Rs100 other = Rs1,545", () => {
    const e = computeEstimate({ ...base, distanceKm: 270, plannedMileageKmPerLitre: 30, petrolPricePaisePerLitre: 10500, foodPaise: 50000, otherPaise: 10000 });
    expect(e.totalPaise).toBe(154500);
  });
  it("rejects zero mileage", () => {
    expect(() => computeEstimate({ ...base, distanceKm: 100, plannedMileageKmPerLitre: 0, petrolPricePaisePerLitre: 10000 })).toThrow();
  });
  it("cost/km is N/A for zero distance", () => {
    expect(costPerKmPaise(1000, 0)).toBeNull();
  });
});
