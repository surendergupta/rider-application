import { describe, expect, it } from "vitest";
import { RESERVED_CLUB_SLUGS, clubCreateSchema, clubFilterSchema, clubReportSchema, clubUpdateSchema, mapClubError, normaliseSlug } from "@/features/clubs/validation";

const valid = {
  name: "Delhi Touring Riders", slug: "delhi_tourers", description: "Weekend and long-distance touring.", city: "Delhi", state: "Delhi",
  visibility: "public", join_policy: "approval", member_limit: 50,
};
const create = (o: object) => clubCreateSchema.safeParse({ ...valid, ...o });
const update = (o: object) => clubUpdateSchema.safeParse({ ...valid, ...o });
const bad = (o: object, field?: string) => {
  const r = create(o);
  expect(r.success, JSON.stringify(o)).toBe(false);
  if (field && !r.success) expect(r.error.issues.map((i) => i.path[0])).toContain(field);
};

describe("club link (slug)", () => {
  it("normalises case, whitespace and a leading @", () => {
    expect(normaliseSlug("  @Delhi_Riders ")).toBe("delhi_riders");
    expect(create({ slug: "DELHI_Tourers" }).data?.slug).toBe("delhi_tourers");
  });
  it("accepts 3 to 30 letters, digits and underscores", () => {
    for (const s of ["abc", "a_b", "club99", "a".repeat(30)]) expect(create({ slug: s }).success, s).toBe(true);
  });
  it("rejects too short, too long, spaces, symbols, unicode look-alikes", () => {
    for (const s of ["ab", "a".repeat(31), "has space", "dot.name", "dash-name", "emoji😀x", "clսb" /* Armenian u */, "<script>", ""]) bad({ slug: s }, "slug");
  });
  it("needs a letter; reserved words (including route names) are refused in any case", () => {
    bad({ slug: "123456" }, "slug"); bad({ slug: "___" }, "slug");
    for (const r of RESERVED_CLUB_SLUGS) if (r.length >= 3) { bad({ slug: r }, "slug"); bad({ slug: r.toUpperCase() }, "slug"); }
  });
  it("is required when creating but not when editing (the link never changes)", () => {
    bad({ slug: undefined }, "slug");
    expect(update({ slug: undefined }).success).toBe(true);
  });
});

describe("club details", () => {
  it("accepts a normal club", () => {
    expect(create({}).success).toBe(true);
  });
  it("name 3 to 60, control characters removed", () => {
    bad({ name: "ab" }, "name"); bad({ name: "x".repeat(61) }, "name"); bad({ name: "   " }, "name");
    expect(create({ name: "Hill\u0000  Riders\n" }).data?.name).toBe("Hill Riders");
  });
  it("description 500, blank becomes null; city and state 60", () => {
    expect(create({ description: "x".repeat(500) }).success).toBe(true);
    bad({ description: "x".repeat(501) }, "description"); bad({ city: "x".repeat(61) }, "city"); bad({ state: "x".repeat(61) }, "state");
    expect(create({ description: "  ", city: "", state: "" }).data).toMatchObject({ description: null, city: null, state: null });
  });
  it("member limit is a whole number 2 to 1000", () => {
    for (const n of [1, 1001, 2.5, 0, -1]) bad({ member_limit: n }, "member_limit");
    for (const n of [2, 1000]) expect(create({ member_limit: n }).success).toBe(true);
  });
  it("visibility and join policy must be known values", () => {
    bad({ visibility: "secret" }, "visibility"); bad({ join_policy: "free" }, "join_policy");
  });
  it("a private club must be invite only", () => {
    bad({ visibility: "private", join_policy: "open" }, "join_policy");
    bad({ visibility: "private", join_policy: "approval" }, "join_policy");
    expect(create({ visibility: "private", join_policy: "invite" }).success).toBe(true);
    expect(update({ visibility: "private", join_policy: "open" }).success).toBe(false);
  });
  it("ignores unknown fields such as a caller-supplied owner_id or status", () => {
    const r = create({ owner_id: "evil", status: "archived", id: "x" });
    expect(r.success).toBe(true);
    for (const k of ["owner_id", "status", "id"]) expect(Object.keys(r.data!)).not.toContain(k);
  });
});

describe("report input and filters", () => {
  it("report: known reason, note capped", () => {
    expect(clubReportSchema.safeParse({ reason: "spam" }).success).toBe(true);
    expect(clubReportSchema.safeParse({ reason: "boring" }).success).toBe(false);
    expect(clubReportSchema.safeParse({ reason: "spam", note: "x".repeat(501) }).success).toBe(false);
  });
  it("filters sanitise hostile text instead of failing", () => {
    expect(clubFilterSchema.parse({ q: "%_,();--", state: "<b>" })).toEqual({ q: "_", state: "b" });
    expect(clubFilterSchema.parse({ q: "x".repeat(100) }).q).toBe("");
    expect(clubFilterSchema.parse({})).toEqual({ q: "", state: "" });
  });
});

describe("database error messages", () => {
  it("maps known codes to plain messages and statuses", () => {
    expect(mapClubError("club_full")).toMatchObject({ status: 409, code: "club_full" });
    expect(mapClubError("x: invite_only")).toMatchObject({ status: 403, code: "invite_only" });
    expect(mapClubError("not_allowed")).toMatchObject({ status: 403 });
  });
  it("never leaks raw database text", () => {
    const e = mapClubError('duplicate key value violates unique constraint "secret_table_pkey"');
    expect(e).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(e.message).not.toContain("secret_table");
  });
});
