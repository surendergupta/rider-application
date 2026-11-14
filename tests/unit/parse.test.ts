import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "@/lib/money/parse";

describe("rupeesToPaise", () => {
  it("parses whole and decimal rupees exactly", () => {
    expect(rupeesToPaise("105")).toBe(10500);
    expect(rupeesToPaise("1,245.5")).toBe(124550);
    expect(rupeesToPaise("0.07")).toBe(7);
    expect(rupeesToPaise("19.99")).toBe(1999);
  });
  it("rejects junk, negatives and >2 decimals", () => {
    for (const bad of ["", "abc", "-5", "1.234", null]) expect(rupeesToPaise(bad)).toBeNull();
  });
});
