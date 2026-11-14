// Map page test. Two modes:
//  - Map data NOT installed (no public/map/india.pmtiles): checks the page loads cleanly and explains how to install.
//  - Map data installed: checks the map renders, saves for offline use, then goes OFFLINE, reloads and checks it still renders.
// Usage: npm run test:e2e:map  (app must be running)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../helpers/env.mjs";

const env = loadEnv();
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3626}`;
const hasData = fs.existsSync(path.resolve("public/map/india.pmtiles"));
const exe = [process.env.E2E_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"]
  .filter(Boolean).find((p) => fs.existsSync(p));
if (!exe) { console.error("No Chrome/Edge found. Set E2E_BROWSER."); process.exit(2); }

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const email = `map-${Date.now()}@example.com`, password = "Map-test-pass-123";
const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error(error.message); process.exit(2); }

// --use-angle=swiftshader gives headless Chrome/Edge a software WebGL so MapLibre can draw.
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const steps = []; const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let goneOffline = false;
const badResp = [];
const failedReq = [];
page.on("response", (r) => { if (r.status() >= 400 && !goneOffline) badResp.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
page.on("requestfailed", (r) => failedReq.push(`${r.url().replace(BASE, "")} (${r.failure()?.errorText})`));
page.on("console", (m) => m.type() === "error" && !goneOffline && errors.push("console: " + m.text().slice(0, 140)));
const step = async (name, fn) => {
  try { await fn(); steps.push({ step: name, result: "PASS" }); }
  catch (e) { steps.push({ step: name, result: "FAIL: " + e.message.split("\n")[0].slice(0, 110) }); throw e; }
};
const mapSource = () => page.getByTestId("map").getAttribute("data-source");

let failed = false;
try {
  await step("sign in and open Map", async () => {
    await page.goto(BASE + "/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL("**/home");
    await page.goto(BASE + "/map"); await page.waitForURL("**/map");
    await page.getByTestId("map").waitFor();
  });
  await step("service worker registers", async () => {
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length > 0);
    await page.evaluate(() => navigator.serviceWorker.ready);
  });

  if (!hasData) {
    await step("shows 'not installed' guidance (no data yet)", async () => {
      await page.getByText("Map data is not installed yet").waitFor();
      if ((await mapSource()) !== "missing") throw new Error("source should be missing");
    });
  } else {
    await step("map renders from the server", async () => {
      await page.waitForFunction(() => document.querySelector('[data-testid="map"]')?.getAttribute("data-source") === "server");
      await page.locator("canvas.maplibregl-canvas").waitFor();
    });
    await step("save for offline use", async () => {
      await page.getByRole("button", { name: "Save map for offline use" }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="map"]')?.getAttribute("data-source") === "offline", null, { timeout: 300000 });
    });
    await step("OFFLINE: reload still shows the map from the saved copy", async () => {
      // Poll for real: waitForFunction does not reliably await an async predicate.
      let cached = false;
      for (let i = 0; i < 60 && !cached; i++) {
        cached = await page.evaluate(async () => Boolean(await caches.match("/map", { ignoreVary: true })));
        if (!cached) await page.waitForTimeout(1000);
      }
      if (!cached) throw new Error("/map was never cached");
      const haveFonts = fs.existsSync(path.resolve("public/map/fonts/Noto Sans Regular/0-255.pbf"));
      if (haveFonts) {
        let fontCached = false;
        for (let i = 0; i < 30 && !fontCached; i++) {
          fontCached = await page.evaluate(async () => Boolean(await caches.match("/map/fonts/Noto%20Sans%20Regular/0-255.pbf", { ignoreVary: true })));
          if (!fontCached) await page.waitForTimeout(1000);
        }
        if (!fontCached) throw new Error("label font was not cached for offline use");
      }
      goneOffline = true;
      await context.setOffline(true);
      await page.reload(); await page.locator("canvas.maplibregl-canvas").waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="map"]')?.getAttribute("data-source") === "offline");
      await page.getByText("Offline", { exact: true }).waitFor();
      await page.waitForTimeout(1500);
      const painted = await page.evaluate(() => {
        const c = document.querySelector("canvas.maplibregl-canvas");
        const gl = c.getContext("webgl2") || c.getContext("webgl"); if (!gl) return null;
        return true;
      });
      if (!painted) throw new Error("no WebGL context");
      await context.setOffline(false);
      goneOffline = false;
    });
  }
  await step("no unexpected errors while online", async () => {
    // Missing glyph ranges only affect rare scripts: report them, do not fail on them.
    const missingGlyphs = [...new Set(badResp.filter((r) => r.includes(".pbf")))];
    if (missingGlyphs.length) console.log(`WARNING: ${missingGlyphs.length} label glyph range(s) not installed. Re-run scripts/get-offline-map.ps1 (it skips files you already have).`);
    const other = badResp.filter((r) => !r.includes(".pbf"));
    if (other.length) throw new Error("HTTP error: " + other[0]);
    const real = errors.filter((e) => !e.includes("Failed to load resource"));
    if (real.length) throw new Error(real[0]);
  });
} catch { failed = true; }
finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
  await admin.auth.admin.deleteUser(u.user.id).catch(() => {});
  console.table(steps);
  if (failed) { console.log("failed requests:", [...new Set(failedReq)].slice(0, 12)); console.log("HTTP errors while online:", [...new Set(badResp)]); console.log("page errors:", [...new Set(errors)].slice(0, 6)); }
  console.log(failed ? "MAP E2E FAILED" : "MAP E2E PASSED", hasData ? "(with map data)" : "(map data not installed: offline path NOT exercised)");
  process.exit(failed ? 1 : 0);
}
