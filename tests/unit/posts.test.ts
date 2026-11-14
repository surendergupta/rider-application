import { describe, expect, it } from "vitest";
import { MAX_POST_LENGTH, formatKm, mapPostError, postCreateSchema, postIdSchema, postReportSchema, safeReturnPath } from "@/features/posts/validation";

const TRIP = "123e4567-e89b-42d3-a456-426614174000";

describe("postCreateSchema", () => {
  it("accepts a plain post and trims it", () => {
    const r = postCreateSchema.parse({ body: "  Road to Manali is clear  " });
    expect(r.body).toBe("Road to Manali is clear");
    expect(r.tripId).toBeNull();
    expect(r.includeDestination).toBe(false);
  });
  it("rejects an empty or whitespace-only post with no ride attached", () => {
    expect(postCreateSchema.safeParse({ body: "" }).success).toBe(false);
    expect(postCreateSchema.safeParse({ body: " \n\t " }).success).toBe(false);
    expect(postCreateSchema.safeParse({}).success).toBe(false);
  });
  it("allows a ride story with no text", () => {
    const r = postCreateSchema.parse({ body: "", tripId: TRIP });
    expect(r.tripId).toBe(TRIP);
  });
  it("treats an empty trip choice from a form as no trip", () => {
    expect(postCreateSchema.parse({ body: "hi", tripId: "" }).tripId).toBeNull();
  });
  it("rejects a trip id that is not a UUID", () => {
    expect(postCreateSchema.safeParse({ body: "hi", tripId: "1; drop table trips" }).success).toBe(false);
  });
  it("enforces the length limit exactly", () => {
    expect(postCreateSchema.safeParse({ body: "x".repeat(MAX_POST_LENGTH) }).success).toBe(true);
    const over = postCreateSchema.safeParse({ body: "x".repeat(MAX_POST_LENGTH + 1) });
    expect(over.success).toBe(false);
  });
  it("strips control characters but keeps line breaks, and caps blank lines", () => {
    const r = postCreateSchema.parse({ body: "a\u0000b\u0007c\r\nline2\n\n\n\nline3" });
    expect(r.body).toBe("abc\nline2\n\nline3");
  });
  it("reads the destination checkbox from a form value", () => {
    expect(postCreateSchema.parse({ body: "x", includeDestination: "on" }).includeDestination).toBe(true);
    expect(postCreateSchema.parse({ body: "x", includeDestination: "" }).includeDestination).toBe(false);
    expect(postCreateSchema.parse({ body: "x", includeDestination: "false" }).includeDestination).toBe(false);
  });
  it("keeps markup as inert text (it is escaped when rendered, never interpreted)", () => {
    expect(postCreateSchema.parse({ body: "<script>alert(1)</script>" }).body).toBe("<script>alert(1)</script>");
  });
});

describe("postReportSchema", () => {
  it("needs a known reason", () => {
    expect(postReportSchema.safeParse({ reason: "spam" }).success).toBe(true);
    expect(postReportSchema.safeParse({ reason: "because" }).success).toBe(false);
    expect(postReportSchema.safeParse({}).success).toBe(false);
  });
  it("turns a blank note into null and limits it to 500 characters", () => {
    expect(postReportSchema.parse({ reason: "spam", note: "  " }).note).toBeNull();
    expect(postReportSchema.safeParse({ reason: "spam", note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("postIdSchema", () => {
  it("accepts UUIDs only", () => {
    expect(postIdSchema.safeParse(TRIP).success).toBe(true);
    expect(postIdSchema.safeParse("not-an-id").success).toBe(false);
    expect(postIdSchema.safeParse(null).success).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("allows the feed, its tabs and a club page", () => {
    expect(safeReturnPath("/posts")).toBe("/posts");
    expect(safeReturnPath("/posts?tab=mine")).toBe("/posts?tab=mine");
    expect(safeReturnPath("/clubs/delhi_riders")).toBe("/clubs/delhi_riders");
  });
  it("never redirects anywhere else", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/account", "/posts/../account", "/clubs/ab", "/clubs/a b", "javascript:alert(1)", "", null, undefined, 5]) {
      expect(safeReturnPath(bad)).toBe("/posts");
    }
  });
});

describe("mapPostError", () => {
  it("maps database codes to plain messages", () => {
    expect(mapPostError("post_rate_limit").status).toBe(429);
    expect(mapPostError("error: profile_required").code).toBe("profile_required");
    expect(mapPostError("trip_not_completed").status).toBe(409);
  });
  it("hides unknown errors behind a generic message", () => {
    const e = mapPostError("relation \"posts\" does not exist");
    expect(e).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(e.message).not.toContain("relation");
  });
});

describe("formatKm", () => {
  it("formats with Indian grouping and at most one decimal", () => {
    expect(formatKm(1234.56)).toBe("1,234.6 km");
    expect(formatKm(600)).toBe("600 km");
    expect(formatKm(123456)).toBe("1,23,456 km");
  });
});
