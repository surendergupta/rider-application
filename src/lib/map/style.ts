import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export const FONT_STACKS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];

/**
 * Glyph ranges installed by scripts/get-offline-map.ps1: Latin, Cyrillic, Arabic, Devanagari and the other
 * Indic scripts (code points 0-4095), punctuation/symbols, and presentation forms. Keep the two lists in sync.
 */
export const GLYPH_RANGES: string[] = [
  ...Array.from({ length: 16 }, (_, i) => `${i * 256}-${i * 256 + 255}`),
  "8192-8447", "8448-8703", "64256-64511", "65024-65279", "65280-65535",
];

/**
 * Builds a MapLibre style for a Protomaps basemap whose tiles come from the `pmtiles://` source.
 * Labels need glyph (font) files; when they are not installed we leave labels out
 * rather than letting every label request fail.
 */
export function buildStyle(opts: { tilesUrl: string; attribution: string; withLabels: boolean }): StyleSpecification {
  const all = layers("protomaps", namedFlavor("light"), { lang: "en" });
  const usable = opts.withLabels ? all : all.filter((l) => l.type !== "symbol");
  return {
    version: 8,
    glyphs: "/map/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: { type: "vector", url: opts.tilesUrl, attribution: opts.attribution },
    },
    layers: usable,
  };
}
