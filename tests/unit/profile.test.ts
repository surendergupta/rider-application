import { describe, expect, it } from "vitest";
import {
  AVATAR_COLORS, INTERESTS, RESERVED_HANDLES, canChangeHandle, initialsOf, normaliseHandle, profileInputSchema, reportSchema,
} from "@/features/profile/validation";
import { formatKm, profilePath, toPublicProfile, type ProfileSourceRow } from "@/features/profile/public";

const valid = {
  handle: "adventure_rider", display_name: "Adventure Rider", bio: "Exploring India.", location_city: "Delhi", location_state: "Delhi",
  interests: ["adventure", "mountains"], avatar_color: "orange", is_public: true, show_motorcycle: false, featured_bike_id: null, show_stats: false,
};
const parse = (o: object) => profileInputSchema.safeParse({ ...valid, ...o });
const bad = (o: object) => expect(parse(o).success).toBe(false);

describe("handle rules", () => {
  it("normalises case, whitespace and a leading @", () => {
    expect(normaliseHandle("  @Rider_One ")).toBe("rider_one");
    expect(parse({ handle: "@ADVENTURE_Rider" }).data?.handle).toBe("adventure_rider");
  });
  it("accepts 3 to 20 letters, digits and underscores", () => {
    for (const h of ["abc", "a_b", "rider99", "a".repeat(20)]) expect(parse({ handle: h }).success, h).toBe(true);
  });
  it("rejects too short, too long, spaces, symbols, dots, unicode look-alikes", () => {
    for (const h of ["ab", "a".repeat(21), "has space", "dot.name", "dash-name", "emoji😀x", "rіder" /* Cyrillic і */, "<script>", ""]) bad({ handle: h });
  });
  it("needs at least one letter, so numeric handles cannot imitate ids", () => {
    bad({ handle: "12345" });
    bad({ handle: "___" });
  });
  it("rejects every reserved handle in any case", () => {
    for (const h of RESERVED_HANDLES) {
      if (/^[a-z0-9_]{3,20}$/.test(h) && /[a-z]/.test(h)) { bad({ handle: h }); bad({ handle: h.toUpperCase() }); }
    }
  });
});

describe("profile fields", () => {
  it("accepts a normal profile", () => {
    expect(parse({}).success).toBe(true);
  });
  it("bio: 300 ok, 301 rejected, blank becomes null", () => {
    expect(parse({ bio: "x".repeat(300) }).success).toBe(true);
    bad({ bio: "x".repeat(301) });
    expect(parse({ bio: "   " }).data?.bio).toBeNull();
  });
  it("display name: required, max 50, control characters removed, spaces collapsed", () => {
    bad({ display_name: "" }); bad({ display_name: "   " }); bad({ display_name: "x".repeat(51) });
    expect(parse({ display_name: "Anil\u0000  Kumar\n" }).data?.display_name).toBe("Anil Kumar");
  });
  it("location is city and state only, each at most 60 characters", () => {
    bad({ location_city: "x".repeat(61) }); bad({ location_state: "x".repeat(61) });
    expect(parse({ location_city: "", location_state: "" }).data?.location_city).toBeNull();
  });
  it("interests must come from the list, max 6, duplicates removed", () => {
    bad({ interests: ["hacking"] });
    bad({ interests: INTERESTS.map((i) => i.id) }); // 7 > 6
    expect(parse({ interests: ["adventure", "adventure", "city"] }).data?.interests).toEqual(["adventure", "city"]);
  });
  it("avatar colour must be one of the palette", () => {
    bad({ avatar_color: "#ff0000" });
    for (const c of Object.keys(AVATAR_COLORS)) expect(parse({ avatar_color: c }).success).toBe(true);
  });
  it("showing the motorcycle requires choosing one", () => {
    bad({ show_motorcycle: true, featured_bike_id: null });
    expect(parse({ show_motorcycle: true, featured_bike_id: "b757dd6a-e3b2-46bc-b0c3-e0dbde68d3d8" }).success).toBe(true);
    bad({ featured_bike_id: "not-a-uuid" });
  });
  it("ignores unknown fields such as a caller-supplied user_id or email", () => {
    const r = parse({ user_id: "evil", email: "a@b.c" });
    expect(r.success).toBe(true);
    expect(Object.keys(r.data!)).not.toContain("user_id");
    expect(Object.keys(r.data!)).not.toContain("email");
  });
  it("defaults are private: nothing is shown unless the rider turns it on", () => {
    // the schema itself requires explicit booleans, so a missing flag is a validation error, never a silent 'public'
    bad({ is_public: undefined }); bad({ show_stats: undefined }); bad({ show_motorcycle: undefined });
  });
});

describe("report input", () => {
  it("needs a known reason; note optional and capped", () => {
    expect(reportSchema.safeParse({ reason: "spam" }).success).toBe(true);
    expect(reportSchema.safeParse({ reason: "boring" }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: "spam", note: "x".repeat(501) }).success).toBe(false);
    expect(reportSchema.parse({ reason: "other", note: "  " }).note).toBeNull();
  });
});

describe("handle change limit", () => {
  const now = new Date("2026-12-31T00:00:00Z");
  it("first change after creation is free", () => {
    expect(canChangeHandle(null, now).allowed).toBe(true);
  });
  it("blocks a second change inside 30 days and says when it opens", () => {
    const r = canChangeHandle("2026-12-15T00:00:00Z", now);
    expect(r.allowed).toBe(false);
    expect(r.nextAllowedAt?.toISOString()).toBe("2027-01-14T00:00:00.000Z");
  });
  it("allows it again after 30 days", () => {
    expect(canChangeHandle("2026-11-30T00:00:00Z", now).allowed).toBe(true);
    expect(canChangeHandle("2026-12-01T00:00:00Z", now).allowed).toBe(true);
    expect(canChangeHandle("2026-12-02T00:00:00Z", now).allowed).toBe(false);
  });
});

const row: ProfileSourceRow = {
  handle: "adventure_rider", display_name: "Adventure Rider", bio: "Exploring India.", location_city: "Delhi", location_state: "Delhi",
  interests: ["adventure", "mountains", "bogus"], avatar_color: "orange", show_motorcycle: false, show_stats: false,
};

describe("public profile whitelist (privacy)", () => {
  it("exposes exactly the whitelisted keys and nothing else", () => {
    const p = toPublicProfile({ row });
    expect(Object.keys(p).sort()).toEqual(["avatarColor", "bio", "displayName", "handle", "initials", "interests", "location", "motorcycle", "stats"]);
  });
  it("never leaks private columns even when the source row contains them", () => {
    const dirty = {
      ...row, user_id: "11111111-1111-1111-1111-111111111111", email: "rider@example.com", phone: "+91 98xxxxxx", home_address: "12 Street",
      registration_number: "DL1SAB1234", vin: "VIN123", odometer_km: 17500, is_public: true, featured_bike_id: "x", handle_changed_at: "2026-01-01",
    } as ProfileSourceRow;
    const json = JSON.stringify(toPublicProfile({ row: dirty, bike: { make: "Royal Enfield", model: "Himalayan" }, stats: { rides: 1, km: 2, places: 3 } }));
    for (const secret of ["11111111", "rider@example.com", "+91", "12 Street", "DL1SAB1234", "VIN123", "17500", "featured_bike_id", "handle_changed_at"]) {
      expect(json, secret).not.toContain(secret);
    }
  });
  it("motorcycle shows only when chosen, and only make and model", () => {
    const bike = { make: "Royal Enfield", model: "Himalayan 411", display_name: "Rahul's bike", odometer_km: 9999 } as { make: string; model: string };
    expect(toPublicProfile({ row, bike }).motorcycle).toBeNull();
    const shown = toPublicProfile({ row: { ...row, show_motorcycle: true }, bike });
    expect(shown.motorcycle).toBe("Royal Enfield Himalayan 411");
    expect(JSON.stringify(shown)).not.toContain("Rahul");
    expect(JSON.stringify(shown)).not.toContain("9999");
  });
  it("a chosen motorcycle with no make or model shows nothing rather than an empty label", () => {
    expect(toPublicProfile({ row: { ...row, show_motorcycle: true }, bike: { make: null, model: "  " } }).motorcycle).toBeNull();
  });
  it("ride statistics only with explicit permission", () => {
    const stats = { rides: 12, km: 4250, places: 8 };
    expect(toPublicProfile({ row, stats }).stats).toBeNull();
    expect(toPublicProfile({ row: { ...row, show_stats: true }, stats }).stats).toEqual(stats);
    expect(toPublicProfile({ row: { ...row, show_stats: true } }).stats).toBeNull();
  });
  it("location is just city and state, joined cleanly", () => {
    expect(toPublicProfile({ row }).location).toBe("Delhi, Delhi");
    expect(toPublicProfile({ row: { ...row, location_state: null } }).location).toBe("Delhi");
    expect(toPublicProfile({ row: { ...row, location_city: null, location_state: null } }).location).toBeNull();
  });
  it("drops unknown interests and falls back safely on an unknown avatar colour", () => {
    const p = toPublicProfile({ row: { ...row, avatar_color: "neon" } });
    expect(p.interests.map((i) => i.id)).toEqual(["adventure", "mountains"]);
    expect(p.avatarColor).toBe("slate");
  });
  it("a hostile bio stays plain text in the data (the page escapes it on render)", () => {
    const p = toPublicProfile({ row: { ...row, bio: "<script>alert(1)</script>" } });
    expect(p.bio).toBe("<script>alert(1)</script>");
  });
});

describe("small helpers", () => {
  it("initials", () => {
    expect(initialsOf("Adventure Rider")).toBe("AR");
    expect(initialsOf("anil")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("anil kumar sharma")).toBe("AK");
  });
  it("kilometres use Indian grouping", () => {
    expect(formatKm(4250)).toBe("4,250");
    expect(formatKm(125000.4)).toBe("1,25,000");
  });
  it("profile URL path", () => {
    expect(profilePath("abc_rider")).toBe("/rider/abc_rider");
  });
});

describe("avatar colours", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  it("keeps white initials at 4.5:1 or better on every badge colour", () => {
    for (const [name, hex] of Object.entries(AVATAR_COLORS)) {
      expect(1.05 / (lum(hex) + 0.05), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
