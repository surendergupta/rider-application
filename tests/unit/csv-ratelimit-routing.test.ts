import { beforeEach, describe, expect, it } from "vitest";
import { csvCell, paiseToRupeesString, toCsv } from "@/lib/csv";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { createOsrmAdapter } from "@/lib/routing/osrm";
import { RoutingUnavailableError } from "@/lib/routing/adapter";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
  });
  it("neutralises formula injection", () => {
    for (const bad of ["=SUM(A1)", "+1", "-1", "@cmd"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(csvCell("normal")).toBe("normal");
  });
  it("renders null as empty and builds rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
  it("formats paise exactly", () => {
    expect(paiseToRupeesString(124550)).toBe("1245.50");
    expect(paiseToRupeesString("7")).toBe("0.07");
    expect(paiseToRupeesString(0)).toBe("0.00");
  });
});

describe("rate limit", () => {
  beforeEach(() => resetRateLimits());
  it("blocks after the limit and resets after the window", () => {
    const t = 1_000_000;
    expect(rateLimit("k", 2, 1000, t).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000, t).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000, t).allowed).toBe(false);
    expect(rateLimit("other", 2, 1000, t).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000, t + 1001).allowed).toBe(true);
  });
});

const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const pts = { origin: { lat: 28.6139, lon: 77.209 }, destination: { lat: 26.9124, lon: 75.7873 }, waypoints: [] };

describe("osrm adapter", () => {
  it("maps routes and labels them general road routing", async () => {
    const a = createOsrmAdapter("http://x/", ok({ code: "Ok", routes: [{ distance: 270400.4, duration: 18000 }] }));
    const [r] = await a.getRoutes(pts);
    expect(r.distanceM).toBe(270400);
    expect(r.sourceKind).toBe("provider");
    expect(r.motorcycleSpecific).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/not motorcycle-certified/);
  });
  it("puts lon,lat order in the URL", async () => {
    let seen = "";
    const f = (async (u: string) => { seen = u; return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 1, duration: 1 }] })); }) as unknown as typeof fetch;
    await createOsrmAdapter("http://x", f).getRoutes(pts);
    expect(seen).toContain("77.209,28.6139;75.7873,26.9124");
  });
  it("throws RoutingUnavailableError on provider error, empty result or network failure", async () => {
    await expect(createOsrmAdapter("http://x", ok({}, 500)).getRoutes(pts)).rejects.toBeInstanceOf(RoutingUnavailableError);
    await expect(createOsrmAdapter("http://x", ok({ code: "NoRoute", routes: [] })).getRoutes(pts)).rejects.toBeInstanceOf(RoutingUnavailableError);
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    await expect(createOsrmAdapter("http://x", boom).getRoutes(pts)).rejects.toBeInstanceOf(RoutingUnavailableError);
  });
});
