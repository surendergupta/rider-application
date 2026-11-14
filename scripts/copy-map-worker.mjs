// Copies MapLibre's web-worker script to a fixed public path.
// Why: the worker's own file is not visible to the page's resource list, so the offline cache could never
// include it when it came from a hashed bundle chunk. A fixed URL lets the service worker cache it.
// Runs automatically on install, dev and build.
import fs from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const destDir = path.resolve("public/map/vendor");
if (!fs.existsSync(src)) {
  console.warn("copy-map-worker: maplibre-gl not installed yet, skipping");
  process.exit(0);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, "maplibre-gl-worker.mjs"));
console.log("copy-map-worker: copied worker to public/map/vendor/");
