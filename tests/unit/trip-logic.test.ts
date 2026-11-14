import { describe, expect, it } from "vitest";
import { canTransition } from "@/features/trips/lifecycle";
import { serviceDue } from "@/features/maintenance/due";
import { manualRoute } from "@/lib/routing/adapter";
import { estimateSchema, expenseSchema, tripCreateSchema } from "@/lib/validation/trip";

const uuid = "b757dd6a-e3b2-46bc-b0c3-e0dbde68d3d8";

describe("trip lifecycle", () => {
  it("allows the normal flow", () => {
    expect(canTransition("draft", "active")).toBe(true);
    expect(canTransition("active", "completed")).toBe(true);
  });
  it("blocks skipping states", () => {
    expect(canTransition("draft", "completed")).toBe(false);
    expect(canTransition("completed", "draft")).toBe(false);
  });
});

describe("service due", () => {
  it("overdue, due soon, ok, unknown", () => {
    expect(serviceDue(22000, 17000, 5000).state).toBe("overdue");
    expect(serviceDue(21600, 17000, 5000).state).toBe("due_soon");
    expect(serviceDue(18000, 17000, 5000).state).toBe("ok");
    expect(serviceDue(null, 17000, 5000).state).toBe("unknown");
  });
});

describe("manual route", () => {
  it("is labeled manual and converts to metres", () => {
    const r = manualRoute(270);
    expect(r.sourceKind).toBe("manual");
    expect(r.distanceM).toBe(270000);
  });
  it("rejects zero distance", () => {
    expect(() => manualRoute(0)).toThrow();
  });
});

describe("request validation", () => {
  it("estimate defaults optional amounts to 0 and rejects fractional paise", () => {
    const ok = estimateSchema.parse({ distance_km: 270, mileage_kmpl: 30, fuel_price_paise_per_litre: 10500 });
    expect(ok.toll_paise).toBe(0);
    expect(estimateSchema.safeParse({ distance_km: 270, mileage_kmpl: 30, fuel_price_paise_per_litre: 105.5 }).success).toBe(false);
    expect(estimateSchema.safeParse({ distance_km: 270, mileage_kmpl: 0, fuel_price_paise_per_litre: 10500 }).success).toBe(false);
  });
  it("expense needs positive amount and a request id; fuel fields only for fuel", () => {
    expect(expenseSchema.safeParse({ category: "food", amount_paise: 0, client_request_id: uuid }).success).toBe(false);
    expect(expenseSchema.safeParse({ category: "food", amount_paise: 100, client_request_id: "x" }).success).toBe(false);
    expect(expenseSchema.safeParse({ category: "food", amount_paise: 100, fuel_litres: 2, client_request_id: uuid }).success).toBe(false);
    expect(expenseSchema.safeParse({ category: "fuel", amount_paise: 112000, fuel_litres: 10.5, client_request_id: uuid }).success).toBe(true);
  });
  it("trip create requires a uuid bike", () => {
    expect(tripCreateSchema.safeParse({ bike_id: "nope", title: "t", origin_label: "a", destination_label: "b" }).success).toBe(false);
  });
});
