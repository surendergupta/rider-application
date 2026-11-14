import { describe, expect, it } from "vitest";
import {
  MAX_RIDE_DAYS, addDays, inviteSchema, mapRideError, rideFilterSchema, rideInputSchema, rideReportSchema, rideState, whenRange,
} from "@/features/rides/validation";

const TODAY = "2026-12-01";
const valid = {
  title: "Delhi to Jaipur weekend", description: "Easy pace, two fuel stops.", area_label: "Delhi", destination_label: "Jaipur",
  starts_on: "2026-12-05", start_time: "06:30", ends_on: "2026-12-06", visibility: "public", requires_approval: true,
  max_riders: 8, distance_km: 270, meeting_point: "Petrol pump, Sector 9", host_note: "Bring cash for tolls",
};
const schema = rideInputSchema(TODAY);
const parse = (o: object) => schema.safeParse({ ...valid, ...o });
const bad = (o: object, field?: string) => {
  const r = parse(o);
  expect(r.success, JSON.stringify(o)).toBe(false);
  if (field && !r.success) expect(r.error.issues.map((i) => i.path[0])).toContain(field);
};

describe("ride input", () => {
  it("accepts a normal ride", () => {
    expect(parse({}).success).toBe(true);
  });
  it("title: 3 to 100 characters, control characters removed", () => {
    bad({ title: "ab" }, "title"); bad({ title: "x".repeat(101) }, "title"); bad({ title: "   " }, "title");
    expect(parse({ title: "Hill\u0000  ride\n" }).data?.title).toBe("Hill ride");
  });
  it("area (public) is required; exact meeting point is optional and separate", () => {
    bad({ area_label: "" }, "area_label"); bad({ area_label: "x" }, "area_label");
    expect(parse({ meeting_point: "" }).data?.meeting_point).toBeNull();
    bad({ meeting_point: "x".repeat(201) }, "meeting_point");
  });
  it("blank optional fields become null", () => {
    const d = parse({ description: "  ", destination_label: "", start_time: "", ends_on: "", host_note: " " }).data!;
    expect([d.description, d.destination_label, d.start_time, d.ends_on, d.host_note]).toEqual([null, null, null, null, null]);
  });
  it("description 1000, note 500, destination 100", () => {
    expect(parse({ description: "x".repeat(1000) }).success).toBe(true);
    bad({ description: "x".repeat(1001) }, "description"); bad({ host_note: "x".repeat(501) }, "host_note"); bad({ destination_label: "x".repeat(101) }, "destination_label");
  });
  it("dates: not in the past, end not before start, at most 30 days", () => {
    bad({ starts_on: "2026-11-30" }, "starts_on");
    expect(parse({ starts_on: TODAY, ends_on: "" }).success).toBe(true);   // today is allowed
    bad({ ends_on: "2026-12-04" }, "ends_on");
    expect(parse({ starts_on: "2026-12-05", ends_on: addDays("2026-12-05", MAX_RIDE_DAYS) }).success).toBe(true);
    bad({ starts_on: "2026-12-05", ends_on: addDays("2026-12-05", MAX_RIDE_DAYS + 1) }, "ends_on");
    bad({ starts_on: "not a date" }, "starts_on");
  });
  it("start time must be a real 24-hour time", () => {
    for (const t of ["25:00", "6:30", "12:60", "noon"]) bad({ start_time: t }, "start_time");
    expect(parse({ start_time: "23:59" }).success).toBe(true);
  });
  it("riders: whole number 2 to 100", () => {
    for (const n of [1, 101, 2.5, 0, -3]) bad({ max_riders: n }, "max_riders");
    for (const n of [2, 100]) expect(parse({ max_riders: n }).success).toBe(true);
  });
  it("distance: positive, at most 5000, or none", () => {
    bad({ distance_km: 0 }, "distance_km"); bad({ distance_km: 5001 }, "distance_km");
    expect(parse({ distance_km: null }).success).toBe(true);
  });
  it("visibility must be known; approval must be explicit", () => {
    bad({ visibility: "secret" }, "visibility");
    bad({ requires_approval: undefined }, "requires_approval");
  });
  it("ignores unknown fields such as a caller-supplied host_id or status", () => {
    const r = parse({ host_id: "evil", status: "cancelled", id: "x" });
    expect(r.success).toBe(true);
    for (const k of ["host_id", "status", "id"]) expect(Object.keys(r.data!)).not.toContain(k);
  });
});

describe("date helper", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("invite input", () => {
  it("normalises @ and case; rejects junk", () => {
    expect(inviteSchema.parse({ handle: " @Rider_One " }).handle).toBe("rider_one");
    for (const h of ["ab", "has space", "x".repeat(21), "", "dot.name"]) expect(inviteSchema.safeParse({ handle: h }).success, h).toBe(false);
  });
});

describe("report input", () => {
  it("known reason; note capped", () => {
    expect(rideReportSchema.safeParse({ reason: "unsafe" }).success).toBe(true);
    expect(rideReportSchema.safeParse({ reason: "boring" }).success).toBe(false);
    expect(rideReportSchema.safeParse({ reason: "spam", note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("filters", () => {
  it("bad filter values fall back to safe defaults instead of failing", () => {
    expect(rideFilterSchema.parse({ when: "someday", open: "yes", area: "x".repeat(200) })).toEqual({ area: "", when: "all", open: "" });
    expect(rideFilterSchema.parse({})).toEqual({ area: "", when: "all", open: "" });
    expect(rideFilterSchema.parse({ area: "  Delhi  ", when: "week", open: "1" })).toEqual({ area: "Delhi", when: "week", open: "1" });
  });
  it("date ranges", () => {
    expect(whenRange("week", TODAY)).toEqual({ from: TODAY, to: "2026-12-08" });
    expect(whenRange("month", TODAY)).toEqual({ from: TODAY, to: "2027-01-01" });
    expect(whenRange("all", TODAY)).toEqual({ from: TODAY, to: null });
  });
});

describe("ride state", () => {
  const r = { status: "open", starts_on: "2026-12-05", ends_on: null as string | null };
  it("open, full, cancelled and past", () => {
    expect(rideState(r, 3, 8, TODAY)).toBe("open");
    expect(rideState(r, 8, 8, TODAY)).toBe("full");
    expect(rideState({ ...r, status: "cancelled" }, 1, 8, TODAY)).toBe("cancelled");
    expect(rideState({ ...r, starts_on: "2026-11-20" }, 1, 8, TODAY)).toBe("past");
  });
  it("a multi-day ride is not past until its last day has gone", () => {
    expect(rideState({ ...r, starts_on: "2026-11-30", ends_on: "2026-12-01" }, 1, 8, TODAY)).toBe("open");
    expect(rideState({ ...r, starts_on: "2026-11-29", ends_on: "2026-11-30" }, 1, 8, TODAY)).toBe("past");
  });
  it("cancelled wins over everything", () => {
    expect(rideState({ ...r, status: "cancelled", starts_on: "2020-01-01" }, 8, 8, TODAY)).toBe("cancelled");
  });
});

describe("database error messages", () => {
  it("maps known codes to plain messages and statuses", () => {
    expect(mapRideError("ride_full")).toMatchObject({ status: 409, code: "ride_full" });
    expect(mapRideError("some prefix: profile_required")).toMatchObject({ status: 403, code: "profile_required" });
    expect(mapRideError("not_found")).toMatchObject({ status: 404 });
  });
  it("never leaks raw database text for unknown errors", () => {
    const e = mapRideError('duplicate key value violates unique constraint "secret_table_pkey"');
    expect(e).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(e.message).not.toContain("secret_table");
  });
});
