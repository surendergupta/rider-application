"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { FileSource, PMTiles, Protocol } from "pmtiles";
import { FONT_STACKS, GLYPH_RANGES, buildStyle } from "@/lib/map/style";
import {
  deleteStoredMap, downloadWithProgress, formatBytes, getStoredMap, putStoredMap,
} from "@/lib/map/offline-store";

const FILE_NAME = "india.pmtiles";
const REMOTE_PATH = `/map/${FILE_NAME}`;
const OFFLINE_KEY = FILE_NAME;
const WORKER_URL = "/map/vendor/maplibre-gl-worker.mjs";
// OpenStreetMap data is ODbL: attribution is required. Protomaps builds are derived from OSM.
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a>';

type Source = "offline" | "server" | "missing";

export default function OfflineMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const protocolRef = useRef<Protocol | null>(null);
  const [source, setSource] = useState<Source | "loading">("loading");
  const [saved, setSaved] = useState<{ bytes: number; at: number } | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Registers the service worker so this page and its code also load with no internet.
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const runRef = useRef(0);

  const start = useCallback(async () => {
    // Each call gets a ticket; if another start() or an unmount happens while we await, we stop.
    const run = ++runRef.current;
    const stale = () => run !== runRef.current;
    setError(null);
    mapRef.current?.remove();
    mapRef.current = null;

    // Fixed worker URL (see scripts/copy-map-worker.mjs) so the offline cache can hold it.
    maplibregl.setWorkerUrl(WORKER_URL);

    if (!protocolRef.current) {
      protocolRef.current = new Protocol();
      maplibregl.addProtocol("pmtiles", protocolRef.current.tile);
    }
    const protocol = protocolRef.current;

    let tilesUrl: string;
    let chosen: Source;
    const stored = await getStoredMap(OFFLINE_KEY).catch(() => undefined);
    if (stale()) return;
    if (stored) {
      // The protocol keeps the first archive registered under a name, so each saved copy gets a unique one.
      const name = `india-${stored.savedAt}.pmtiles`;
      protocol.add(new PMTiles(new FileSource(new File([stored.blob], name))));
      tilesUrl = `pmtiles://${name}`;
      chosen = "offline";
      setSaved({ bytes: stored.bytes, at: stored.savedAt });
    } else {
      setSaved(null);
      const head = await fetch(REMOTE_PATH, { method: "HEAD" }).catch(() => null);
      if (stale()) return;
      if (!head || !head.ok) { setSource("missing"); return; }
      tilesUrl = `pmtiles://${location.origin}${REMOTE_PATH}`;
      chosen = "server";
    }

    const hasFonts = await fetch("/map/fonts/Noto%20Sans%20Regular/0-255.pbf", { method: "HEAD" })
      .then((r) => r.ok).catch(() => false);

    if (stale() || !container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: buildStyle({ tilesUrl, attribution: ATTRIBUTION, withLabels: hasFonts }),
      center: [78.9, 22.5], // India
      zoom: 4,
      minZoom: 3,
      maxBounds: [[60, 2], [105, 40]],
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("error", (e) => {
      const msg = String(e?.error?.message ?? "");
      if (msg && !/AbortError|Failed to fetch/i.test(msg)) setMessage(msg.slice(0, 120));
    });
    mapRef.current = map;
    setSource(chosen);

    // Once the map has drawn, give the service worker the files this page loaded so a reload works offline.
    let warmed = false;
    const warm = async () => {
      if (warmed || !("serviceWorker" in navigator)) return;
      warmed = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        // Resource timing only keeps ~250 entries and silently drops the rest, so also read the page's own tags.
        const fromTiming = performance.getEntriesByType("resource").map((r) => r.name);
        const fromDom = Array.from(document.querySelectorAll<HTMLElement>("script[src], link[rel~='stylesheet'][href], link[rel~='preload'][href]"))
          .map((el) => (el as HTMLScriptElement).src || (el as HTMLLinkElement).href);
        // The page caches its own HTML (it holds no personal data). Same cache the worker reads from.
        const res = await fetch("/map", { credentials: "same-origin" });
        // The saved HTML also points at script/style files this page never loaded itself (e.g. preloads),
        // so read them out of the HTML: otherwise the offline copy would reference files that are not cached.
        let fromHtml: string[] = [];
        if (res.ok && !res.redirected) {
          const html = await res.clone().text();
          fromHtml = [...html.matchAll(/\/_next\/static\/[^"'\\\s<>)]+/g)].map((m) => m[0]);
          await (await caches.open("lrp-shell-v3")).put(`${location.origin}/map`, res);
        }
        const urls = [...new Set([...fromTiming, ...fromDom, ...fromHtml])]
          .filter((n) => { const u = new URL(n, location.origin); return u.origin === location.origin && (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/map/fonts/")); });
        // Label fonts are fetched by the map's background worker, which the page cannot observe, so list them here.
        // Files that were never installed simply fail to cache and are skipped by the worker.
        const fonts = FONT_STACKS.flatMap((f) => GLYPH_RANGES.map((r) => `/map/fonts/${encodeURIComponent(f)}/${r}.pbf`));
        reg.active?.postMessage({ type: "cache", urls: [...urls, ...fonts, WORKER_URL] });
      } catch { /* offline shell is best-effort */ }
    };
    map.once("idle", warm);
    window.setTimeout(() => { if (!stale()) void warm(); }, 4000); // fallback if `idle` never fires
  }, []);

  useEffect(() => {
    void start();
    return () => { runRef.current++; mapRef.current?.remove(); mapRef.current = null; };
  }, [start]);

  async function saveOffline() {
    setError(null);
    setProgress({ loaded: 0, total: 0 });
    try {
      const blob = await downloadWithProgress(REMOTE_PATH, (loaded, total) => setProgress({ loaded, total }));
      await putStoredMap(OFFLINE_KEY, { blob, savedAt: Date.now(), bytes: blob.size });
      setProgress(null);
      await start();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function removeOffline() {
    await deleteStoredMap(OFFLINE_KEY);
    await start();
  }

  const pct = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : null;

  return (
    <div>
      <div className="relative">
        <div ref={container} data-testid="map" data-source={source}
          className="h-[60vh] min-h-[320px] w-full overflow-hidden rounded-xl bg-sunken" />
        {source === "missing" && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/90 p-6 text-center text-sm text-fg">
            <div>
              <p className="font-semibold">Map data is not installed yet</p>
              <p className="mt-2">
                Run <code className="rounded bg-sunken px-1">scripts/get-offline-map.ps1</code> once to fetch the free OpenStreetMap
                data for India into <code className="rounded bg-sunken px-1">public/map/</code>, then reload this page.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${online ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg"}`}>
          {online ? "Online" : "Offline"}
        </span>
        {source === "offline" && saved && (
          <span className="text-muted">
            Using saved map ({formatBytes(saved.bytes)}, saved {new Date(saved.at).toLocaleDateString("en-IN")}). Works with no internet.
          </span>
        )}
        {source === "server" && <span className="text-muted">Loading from the server. Save it to use offline.</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {source === "server" && !progress && (
          <button onClick={saveOffline} className="rounded-lg bg-saffron px-4 py-2 text-sm font-semibold text-ink transition hover:bg-saffron-dark">
            Save map for offline use
          </button>
        )}
        {source === "offline" && (
          <button onClick={removeOffline} className="rounded-lg border border-line-strong px-4 py-2 text-sm text-fg hover:bg-sunken">
            Remove saved map
          </button>
        )}
      </div>

      {progress && (
        <div className="mt-3" role="status">
          <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-saffron transition-all" style={{ width: `${pct ?? 5}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            Saving… {formatBytes(progress.loaded)}{progress.total ? ` of ${formatBytes(progress.total)}` : ""}
          </p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
      {message && <p className="mt-2 text-xs text-subtle">Map note: {message}</p>}
    </div>
  );
}
