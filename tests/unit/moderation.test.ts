import { describe, expect, it } from "vitest";
import { MOD_NOTICES, REASON_MAX, liftSchema, mapModError, modActionSchema, parseTab } from "@/features/moderation/validation";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const base = { kind: "post", reportId: ID, action: "remove", reason: "Scam link", days: "" };

describe("modActionSchema", () => {
  it("accepts a takedown with a reason and tidies whitespace and control characters", () => {
    const r = modActionSchema.parse({ ...base, reason: "  Scam \n  link\u0007  " });
    expect(r.reason).toBe("Scam link");
    expect(r.days).toBeNull();
  });
  it("needs a reason of 3 to 300 characters to dismiss, remove or restrict", () => {
    for (const action of ["dismiss", "remove", "restrict"]) {
      expect(modActionSchema.safeParse({ ...base, action, reason: "" }).success).toBe(false);
      expect(modActionSchema.safeParse({ ...base, action, reason: "  ab " }).success).toBe(false);
      expect(modActionSchema.safeParse({ ...base, action, reason: "x".repeat(REASON_MAX + 1) }).success).toBe(false);
      expect(modActionSchema.safeParse({ ...base, action, reason: "x".repeat(REASON_MAX) }).success).toBe(true);
    }
  });
  it("lets start_review go ahead without a reason", () => {
    expect(modActionSchema.safeParse({ ...base, action: "start_review", reason: "" }).success).toBe(true);
  });
  it("rejects unknown kinds, actions and ids", () => {
    expect(modActionSchema.safeParse({ ...base, kind: "user" }).success).toBe(false);
    expect(modActionSchema.safeParse({ ...base, action: "ban" }).success).toBe(false);
    expect(modActionSchema.safeParse({ ...base, reportId: "not-a-uuid" }).success).toBe(false);
  });
  it("reads the restriction length: a number of days, or blank/'forever' for until lifted", () => {
    expect(modActionSchema.parse({ ...base, action: "restrict", days: "30" }).days).toBe(30);
    expect(modActionSchema.parse({ ...base, action: "restrict", days: "forever" }).days).toBeNull();
    expect(modActionSchema.safeParse({ ...base, action: "restrict", days: "0" }).success).toBe(false);
    expect(modActionSchema.safeParse({ ...base, action: "restrict", days: "366" }).success).toBe(false);
    expect(modActionSchema.safeParse({ ...base, action: "restrict", days: "abc" }).success).toBe(false);
  });
});

describe("liftSchema", () => {
  it("needs a user id and a reason", () => {
    expect(liftSchema.safeParse({ userId: ID, reason: "Appeal accepted" }).success).toBe(true);
    expect(liftSchema.safeParse({ userId: ID, reason: "" }).success).toBe(false);
    expect(liftSchema.safeParse({ userId: "x", reason: "Appeal accepted" }).success).toBe(false);
  });
});

describe("parseTab and error mapping", () => {
  it("falls back to the open queue for anything unknown", () => {
    expect(parseTab("audit")).toBe("audit");
    expect(parseTab("restrictions")).toBe("restrictions");
    expect(parseTab("<script>")).toBe("open");
    expect(parseTab(undefined)).toBe("open");
  });
  it("turns database codes into plain messages and hides internals", () => {
    expect(mapModError("self_target").status).toBe(403);
    expect(mapModError("already_closed").code).toBe("already_closed");
    expect(mapModError("relation \"x\" does not exist")).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
  it("every error code has a notice, except not_moderator which must look like a missing page", () => {
    for (const code of ["self_target", "already_closed", "reason_required", "cannot_restrict"]) expect(MOD_NOTICES[code]?.ok).toBe(false);
    expect(MOD_NOTICES.not_moderator).toBeUndefined();
    expect(MOD_NOTICES.actioned.ok).toBe(true);
  });
});
