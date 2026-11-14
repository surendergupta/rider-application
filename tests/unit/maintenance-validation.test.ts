import { describe, expect, it } from "vitest";
import { maintenanceSchema, scheduleSchema } from "@/lib/validation/maintenance";

describe("maintenance validation", () => {
  it("accepts a record and defaults cost to 0", () => {
    const r = maintenanceSchema.parse({ service_type: "oil", service_date: "2026-12-06" });
    expect(r.cost_paise).toBe(0);
  });
  it("rejects bad type, bad date, fractional paise", () => {
    expect(maintenanceSchema.safeParse({ service_type: "wash", service_date: "2026-12-06" }).success).toBe(false);
    expect(maintenanceSchema.safeParse({ service_type: "oil", service_date: "06/12/2026" }).success).toBe(false);
    expect(maintenanceSchema.safeParse({ service_type: "oil", service_date: "2026-12-06", cost_paise: 10.5 }).success).toBe(false);
  });
  it("schedule needs interval 1..100000", () => {
    expect(scheduleSchema.safeParse({ service_type: "chain", interval_km: 0 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ service_type: "chain", interval_km: 500 }).success).toBe(true);
  });
});
