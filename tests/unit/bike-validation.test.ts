import { describe, expect, it } from "vitest";
import { bikeCreateSchema, bikeUpdateSchema } from "@/lib/validation/bike";

describe("bike validation", () => {
  it("accepts a minimal bike", () => {
    expect(bikeCreateSchema.safeParse({ display_name: "Himalayan" }).success).toBe(true);
  });
  it("rejects blank name, zero mileage, negative odometer", () => {
    expect(bikeCreateSchema.safeParse({ display_name: "  " }).success).toBe(false);
    expect(bikeCreateSchema.safeParse({ display_name: "A", mileage_kmpl: 0 }).success).toBe(false);
    expect(bikeCreateSchema.safeParse({ display_name: "A", odometer_km: -1 }).success).toBe(false);
  });
  it("ignores a caller-supplied user_id", () => {
    const r = bikeCreateSchema.parse({ display_name: "A", user_id: "evil" });
    expect("user_id" in r).toBe(false);
  });
  it("allows archiving via update", () => {
    expect(bikeUpdateSchema.safeParse({ is_archived: true }).success).toBe(true);
  });
});
