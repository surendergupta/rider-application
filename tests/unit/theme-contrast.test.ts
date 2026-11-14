import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Reads the real tokens from the stylesheet, so the test can never drift from what ships.
const css = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  expect(start, `block ${selector} not found`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const THEMES = { dark: block(":root"), light: block(':root[data-theme="light"]') };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [text token, background token, minimum ratio]. 4.5 is WCAG AA for normal text, 3 for large text and UI shapes.
const PAIRS: [string, string, number][] = [
  ["fg", "canvas", 7], ["fg", "surface", 7], ["fg", "sunken", 7],
  ["muted", "canvas", 4.5], ["muted", "surface", 4.5], ["muted", "sunken", 4.5],
  ["subtle", "canvas", 4.5], ["subtle", "surface", 4.5], ["subtle", "sunken", 4.5],
  ["link", "canvas", 4.5], ["link", "surface", 4.5],
  ["on-accent", "accent", 4.5], ["on-accent", "accent-strong", 4.5],
  ["success-fg", "success-bg", 4.5], ["warn-fg", "warn-bg", 4.5], ["danger-fg", "danger-bg", 4.5],
  ["success-fg", "surface", 4.5], ["warn-fg", "surface", 4.5], ["danger-fg", "surface", 4.5],
  // Control borders (inputs, secondary buttons) must be clearly visible: WCAG 1.4.11 asks for 3:1.
  ["line-strong", "surface", 3], ["line-strong", "sunken", 3],
];

// Orange is only ever a FILL behind dark text (buttons, selected pills) or a decorative bar, never body text:
// text links use the separate `link` token. On white it is ~2.8:1, so this UI-shape check applies to dark only.
const DARK_ONLY: [string, string, number][] = [["accent", "surface", 3], ["accent", "canvas", 3]];

describe("theme tokens", () => {
  it("dark and light define exactly the same tokens", () => {
    expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort());
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    describe(`${theme} theme contrast`, () => {
      for (const [fg, bg, min] of PAIRS) {
        it(`${fg} on ${bg} is at least ${min}:1`, () => {
          expect(tokens[fg], `missing token ${fg}`).toBeDefined();
          expect(tokens[bg], `missing token ${bg}`).toBeDefined();
          const ratio = contrast(tokens[fg], tokens[bg]);
          expect(ratio, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }

  it("orange accent is a visible shape against dark surfaces", () => {
    for (const [fg, bg, min] of DARK_ONLY) expect(contrast(THEMES.dark[fg], THEMES.dark[bg])).toBeGreaterThanOrEqual(min);
  });

  it("white text on the header/hero background stays readable in both themes", () => {
    for (const tokens of Object.values(THEMES)) expect(contrast("#ffffff", tokens.road)).toBeGreaterThanOrEqual(7);
  });

  it("no colour token is named like a Tailwind size or alignment word (e.g. `base` once turned `text-base` into a colour)", () => {
    const clash = new Set(["base", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "left", "right", "center", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty", "clip", "ellipsis", "inherit", "current", "transparent"]);
    for (const tokens of Object.values(THEMES)) for (const name of Object.keys(tokens)) expect(clash.has(name), `token "${name}" collides with a Tailwind utility`).toBe(false);
  });

  it("matches the design brief's dark palette", () => {
    expect(THEMES.dark.canvas.toLowerCase()).toBe("#12161b");
    expect(THEMES.dark.surface.toLowerCase()).toBe("#242b33");
    expect(THEMES.dark.accent.toLowerCase()).toBe("#f97316");
    expect(THEMES.dark.fg.toLowerCase()).toBe("#f3f5f7");
  });
});
