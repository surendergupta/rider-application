// Rider public profile: privacy boundaries, enumeration resistance, concurrency, report/block enforcement,
// hostile input, accessibility (axe, light and dark) and mobile touch targets. Real users, real browser, phone viewport.
// Usage: start the app, then `npm run test:e2e:profile`  (E2E_BASE_URL / PORT to point at another server).
// Creates throwaway users and always deletes them (their profiles, blocks and reports cascade away).
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../helpers/env.mjs";

const env = loadEnv();
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3626}`;
const exe = [process.env.E2E_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"]
  .filter(Boolean).find((p) => fs.existsSync(p));
if (!exe) { console.error("No Chrome/Edge found. Set E2E_BROWSER."); process.exit(2); }
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) { console.log("SKIPPED: Supabase env not set"); process.exit(0); }
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const run = Date.now().toString(36).slice(-6);
const password = "Prof-test-pass-123";
const users = [];
const browser = await chromium.launch({ executablePath: exe, headless: true });
const contexts = [];

async function newUser(tag) {
  const email = `prof-${tag}-${run}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("create user: " + error.message);
  const u = { id: data.user.id, email, tag };
  users.push(u);
  return u;
}
async function login(u) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.goto(BASE + "/login");
  await page.getByLabel("Email").fill(u.email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL("**/home");
  return { context, page, req: context.request, user: u };
}
async function anon() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  return { context, page, req: context.request };
}

const steps = [];
fs.mkdirSync("test-results", { recursive: true });
const progressFile = "test-results/profile-e2e-progress.log";
fs.writeFileSync(progressFile, `# profile e2e started ${new Date().toISOString()}\n`);
const record = (line) => { console.log(line); fs.appendFileSync(progressFile, line + "\n"); };   // written immediately, survives a hard stop
const step = async (name, fn) => {
  try { await fn(); steps.push({ step: name, result: "PASS" }); record(`PASS  ${name}`); }
  catch (e) {
    const msg = e.message.split("\n")[0].slice(0, 150);
    steps.push({ step: name, result: "FAIL: " + msg }); record(`FAIL  ${name} :: ${msg}`); throw e;
  }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const put = (s, data) => s.req.put(BASE + "/api/profile", { data });
const err = async (r) => (await r.json()).error ?? {};

const bodyText = (p) => p.locator("body").innerText();
const smallTargets = (p) => p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]):not(.sr-only), select, textarea")) {
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.tagName === "A" && el.closest("p, li > span, td")) continue;
    // A radio or checkbox is activated by its whole label row, so the label is the touch target, not the 16px square.
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const label = el.closest("label");
      if (label) r = label.getBoundingClientRect();
    }
    if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 28)}" ${Math.round(r.height)}px`);
  }
  return out;
});
async function axeScan(p, label) {
  const bad = [];
  for (const theme of ["dark", "light"]) {
    await p.evaluate((t) => { localStorage.setItem("lrp-theme", t); }, theme);
    await p.reload(); await p.waitForLoadState("networkidle");
    await p.addScriptTag({ path: axePath });
    const res = await p.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    for (const v of res.violations) if (["serious", "critical"].includes(v.impact)) bad.push(`${label} [${theme}] ${v.id} (${v.impact}): ${v.nodes[0]?.target?.join(" ")}`);
  }
  await p.evaluate(() => localStorage.removeItem("lrp-theme"));
  return bad;
}

let failed = false;
try {
  const A = await newUser("a"), B = await newUser("b"), V = await newUser("v");
  const handleA = `ra${run}`, handleB = `rb${run}`;

  // seed private data that must NEVER appear on a public page
  const { data: bikeA } = await admin.from("bikes").insert({ user_id: A.id, display_name: "SECRET-NAME-RAHUL", make: "Royal Enfield", model: "Himalayan 411", odometer_km: 99999 }).select().single();
  const { data: bikeB } = await admin.from("bikes").insert({ user_id: B.id, display_name: "B-bike", make: "KTM", model: "390" }).select().single();
  const { data: trip } = await admin.from("trips").insert({ user_id: A.id, bike_id: bikeA.id, title: "SECRET-TRIP-TITLE", origin_label: "SECRET-ORIGIN", destination_label: "Jaipur" }).select().single();
  await admin.from("trip_estimates").insert({ user_id: A.id, trip_id: trip.id, revision: 1, distance_km: 270, mileage_kmpl: 30, fuel_price_paise_per_litre: 10500, fuel_litres: 9, fuel_paise: 94500 });
  await admin.from("trips").update({ status: "active" }).eq("id", trip.id);
  await admin.from("trips").update({ status: "completed" }).eq("id", trip.id);

  const a = await login(A);
  const visitor = await anon();

  await step("profile page needs sign-in; a new rider starts with no profile", async () => {
    await visitor.page.goto(BASE + "/profile"); await visitor.page.waitForURL("**/login");
    await a.page.goto(BASE + "/profile");
    await a.page.getByText("You have not created a rider profile yet").waitFor();
  });

  await step("create a profile: it is PRIVATE by default, with a preview", async () => {
    const p = a.page;
    await p.getByLabel("Handle").fill("@" + handleA.toUpperCase());       // @ and capitals are normalised
    await p.getByLabel("Display name").fill("Adventure Rider");
    await p.getByLabel(/Bio/).fill("Exploring India, one road at a time.");
    await p.locator('input[name="location_city"]').fill("Delhi"); await p.locator('input[name="location_state"]').fill("Delhi");
    await p.locator('input[name="interests"][value="adventure"]').check({ force: true });
    await p.locator('input[name="interests"][value="mountains"]').check({ force: true });
    must(await p.locator('input[name="is_public"][value="false"]').isChecked(), "Private must be the default");
    await p.getByRole("button", { name: "Create profile" }).click();
    await p.getByText("Profile saved.").waitFor();
    await p.getByTestId("visibility-chip").filter({ hasText: "Private" }).waitFor();
    const t = await bodyText(p);
    must(t.includes("Adventure Rider") && t.includes(`@${handleA}`), "preview missing name or normalised handle");
    must(t.includes("Delhi, Delhi") && t.includes("Mountains"), "preview missing location or interests");
  });

  await step("private profile is invisible to everyone but the owner, and looks exactly like a missing one", async () => {
    const ghost = `nobody${run}`;
    const seen = async (s, h) => { const r = await s.page.goto(BASE + "/rider/" + h); return { status: r.status(), text: (await bodyText(s.page)).replace(/\s+/g, " ") }; };
    const b = await login(B);
    const priv = await seen(visitor, handleA), missing = await seen(visitor, ghost);
    must(priv.status === 404 && missing.status === 404, `anonymous: private=${priv.status} missing=${missing.status}`);
    must(priv.text === missing.text, "private and missing profiles must be indistinguishable");
    const privB = await seen(b, handleA);
    must(privB.status === 404 && privB.text === missing.text, "another signed-in rider must get the same 404");
    must(!priv.text.includes("Adventure Rider"), "private profile leaked its name");
    const own = await a.page.goto(BASE + "/rider/" + handleA);
    must(own.status() === 200, "owner must see their private preview");
    await a.page.getByTestId("owner-banner").filter({ hasText: "Private preview" }).waitFor();
    await b.context.close();
  });

  const publicPage = async () => { const r = await visitor.page.goto(BASE + "/rider/" + handleA); return { status: r.status(), text: await bodyText(visitor.page), html: await visitor.page.content() }; };
  const savePublic = async (opts) => {
    await a.page.goto(BASE + "/profile");
    for (const [name, on] of Object.entries(opts.checks ?? {})) {
      const el = a.page.locator(`input[name="${name}"]`);
      if (on) await el.check({ force: true }); else await el.uncheck({ force: true });
    }
    if (opts.public !== undefined) await a.page.locator(`input[name="is_public"][value="${opts.public}"]`).check();
    if (opts.bike !== undefined) await a.page.locator('select[name="featured_bike_id"]').selectOption(opts.bike);
    if (opts.bio !== undefined) await a.page.getByLabel(/Bio/).fill(opts.bio);
    if (opts.name !== undefined) await a.page.getByLabel("Display name").fill(opts.name);
    await a.page.getByRole("button", { name: "Save profile" }).click();
    await a.page.getByText("Profile saved.").waitFor();
  };

  await step("publish: only the chosen details are public; nothing private leaks", async () => {
    await savePublic({ public: "true" });
    const { status, text, html } = await publicPage();
    must(status === 200, "public profile should load for anyone with the link");
    for (const want of ["Adventure Rider", `@${handleA}`, "Delhi, Delhi", "Adventure", "Mountains", "Exploring India"]) must(text.includes(want), "missing: " + want);
    const secrets = [A.email, A.email.split("@")[0], A.id, "SECRET-NAME-RAHUL", "SECRET-TRIP-TITLE", "SECRET-ORIGIN", "99999", "Royal Enfield", "Himalayan", "KTM", "Rides a", "KM ridden"];
    for (const s of secrets) must(!text.includes(s) && !html.includes(s), "LEAK on a public page: " + s);
    must(/<meta name="robots" content="noindex, nofollow"/.test(html), "public profile must not be indexed");
  });

  await step("motorcycle appears only when chosen, and only as make and model", async () => {
    await savePublic({ checks: { show_motorcycle: true }, bike: bikeA.id });
    const { text, html } = await publicPage();
    must(text.includes("Royal Enfield Himalayan 411"), "chosen motorcycle missing");
    for (const s of ["SECRET-NAME-RAHUL", "99999", A.id]) must(!text.includes(s) && !html.includes(s), "LEAK with motorcycle on: " + s);
    await savePublic({ checks: { show_motorcycle: false } });
    must(!(await publicPage()).text.includes("Royal Enfield"), "motorcycle must disappear when switched off");
  });

  await step("ride statistics appear only with explicit permission, as totals only", async () => {
    await savePublic({ checks: { show_stats: true } });
    const { text, html } = await publicPage();
    must(/Rides\s*1|1\s*Rides/i.test(text.replace(/\n/g, " ")) || (text.includes("Rides") && text.includes("270") && text.includes("Places")), "stats missing: " + text.slice(0, 200));
    must(text.includes("270"), "kilometres missing");
    for (const s of ["Jaipur", "SECRET-ORIGIN", "SECRET-TRIP-TITLE"]) must(!text.includes(s) && !html.includes(s), "stats exposed a route detail: " + s);
    await savePublic({ checks: { show_stats: false } });
    must(!(await publicPage()).text.includes("KM ridden"), "stats must disappear when switched off");
  });

  await step("hostile bio and name are shown as plain text, never executed", async () => {
    const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
    await savePublic({ bio: evil, name: "<b>Bold</b> Rider" });
    const { text } = await publicPage();
    must(text.includes("<script>") && text.includes("<b>Bold</b>"), "markup should be displayed literally as text");
    must((await visitor.page.evaluate(() => window.__xss)) === undefined, "script from a bio ran");
    must((await visitor.page.locator("article h1 b").count()) === 0 && (await visitor.page.locator("article img").count()) === 0, "markup was rendered as elements");
    await savePublic({ bio: "Exploring India, one road at a time.", name: "Adventure Rider" });
  });

  await step("server-side validation rejects bad input (no crashes, no partial writes)", async () => {
    const v = await login(V);
    const ok = { handle: `rv${run}`, display_name: "V", bio: "", location_city: "", location_state: "", interests: [], avatar_color: "orange", is_public: false, show_motorcycle: false, featured_bike_id: null, show_stats: false };
    const cases = [
      ["bio over 300", { bio: "x".repeat(301) }, "bio"], ["handle too short", { handle: "ab" }, "handle"], ["reserved handle", { handle: "admin" }, "handle"],
      ["reserved handle in capitals", { handle: "@ADMIN" }, "handle"], ["handle with space", { handle: "has space" }, "handle"],
      ["unknown interest", { interests: ["hacking"] }, "interests"], ["unknown avatar colour", { avatar_color: "#fff" }, "avatar_color"],
      ["blank display name", { display_name: "  " }, "display_name"], ["motorcycle on, none chosen", { show_motorcycle: true }, "featured_bike_id"],
      ["someone else's motorcycle", { show_motorcycle: true, featured_bike_id: bikeB.id }, null],
    ];
    for (const [label, patch, field] of cases) {
      const r = await put(v, { ...ok, ...patch });
      must(r.status() === 422, `${label}: expected 422, got ${r.status()}`);
      const e = await err(r); must(e.code === "VALIDATION_ERROR" && e.request_id, `${label}: wrong error shape`);
      if (field) must(e.field === field, `${label}: expected field ${field}, got ${e.field}`);
    }
    must((await v.req.put(BASE + "/api/profile", { data: "[1,2]", headers: { "content-type": "application/json" } })).status() === 422, "an array body must be rejected");
    must((await anon().then((x) => x.req.put(BASE + "/api/profile", { data: ok }))).status() === 401, "signed-out save must be 401");
    const { data: none } = await admin.from("rider_profiles").select("user_id").eq("user_id", V.id);
    must(none.length === 0, "a rejected request must not write anything");
    // a caller-supplied owner id is ignored: the profile always belongs to the signed-in user
    const r = await put(v, { ...ok, user_id: B.id });
    must(r.status() === 200, "valid save failed: " + r.status());
    const { data: rows } = await admin.from("rider_profiles").select("user_id").eq("handle", ok.handle);
    must(rows.length === 1 && rows[0].user_id === V.id, "profile was written for the wrong user");
    const { data: bProfile } = await admin.from("rider_profiles").select("user_id").eq("user_id", B.id);
    must(bProfile.length === 0, "caller-supplied user_id must not create a profile for someone else");
    await v.context.close();
  });

  await step("the database cannot be listed or scraped through its public REST interface", async () => {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rider_profiles?select=handle,display_name&is_public=eq.true`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } });
    const body = await r.text();
    must(!body.includes(handleA) && !body.includes("Adventure Rider"), "public REST access exposed profile rows: " + body.slice(0, 120));
    const rpc = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/rider_stats`, {
      method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ p_user: A.id }) });
    must(rpc.status >= 400, "rider_stats must not be callable with the public key");
  });

  await step("handle uniqueness: taken, case-insensitive, availability check, and no probing without sign-in", async () => {
    const b = await login(B);
    const base = { display_name: "B", bio: "", location_city: "", location_state: "", interests: [], avatar_color: "teal", is_public: false, show_motorcycle: false, featured_bike_id: null, show_stats: false };
    for (const h of [handleA, "@" + handleA, handleA.toUpperCase()]) {
      const r = await put(b, { ...base, handle: h });
      must(r.status() === 409 && (await err(r)).code === "HANDLE_TAKEN", `taking "${h}" should be 409 HANDLE_TAKEN, got ${r.status()}`);
    }
    const q = (s, h) => s.req.get(`${BASE}/api/profile/handle-available?handle=${encodeURIComponent(h)}`);
    const taken = await (await q(b, handleA)).json(), free = await (await q(b, `free${run}`)).json(), own = await (await q(a, handleA)).json();
    must(taken.available === false && free.available === true && own.available === true, "availability wrong: " + JSON.stringify({ taken, free, own }));
    must(JSON.stringify(taken).includes(A.id) === false && Object.keys(taken).sort().join() === "available,handle", "availability must not reveal who owns a handle");
    must((await q(visitor, handleA)).status() === 401, "availability check must require sign-in");
    must((await q(b, "admin")).status() === 422, "reserved handle should be 422");
    await b.context.close();
  });

  await step("handle changes are limited to once per 30 days, and the old handle stops working", async () => {
    const newHandle = `ra2${run}`;
    const prof = (await (await a.req.get(BASE + "/api/profile")).json()).profile;
    const body = { handle: newHandle, display_name: prof.display_name, bio: prof.bio ?? "", location_city: prof.location_city ?? "", location_state: prof.location_state ?? "",
      interests: prof.interests, avatar_color: prof.avatar_color, is_public: true, show_motorcycle: false, featured_bike_id: null, show_stats: false };
    must((await put(a, body)).status() === 200, "the first handle change should be allowed");
    const second = await put(a, { ...body, handle: `ra3${run}` });
    must(second.status() === 409 && (await err(second)).code === "HANDLE_COOLDOWN", "a second change inside 30 days must be 409 HANDLE_COOLDOWN, got " + second.status());
    await a.page.goto(BASE + "/profile");
    await a.page.getByText("You can change your handle again on").waitFor();
    must(await a.page.getByLabel("Handle").evaluate((el) => el.readOnly), "handle field should be read-only during the cooldown");
    must((await visitor.page.goto(BASE + "/rider/" + handleA)).status() === 404, "the old handle must stop resolving");
    must((await visitor.page.goto(BASE + "/rider/" + newHandle)).status() === 200, "the new handle must work");
    // saving other fields during the cooldown must still work and must not reset the clock
    const same = await put(a, { ...body, bio: "Updated bio" });
    must(same.status() === 200, "saving other fields during the cooldown must work");
    handleA2 = newHandle;
  });
  var handleA2;

  await step("concurrent handle claims: exactly one winner every time", async () => {
    for (let round = 0; round < 4; round++) {
      const [x, y] = await Promise.all([newUser(`x${round}`), newUser(`y${round}`)]);
      const [sx, sy] = await Promise.all([login(x), login(y)]);
      const handle = `race${round}${run}`;
      const body = { handle, display_name: "Racer", bio: "", location_city: "", location_state: "", interests: [], avatar_color: "slate", is_public: false, show_motorcycle: false, featured_bike_id: null, show_stats: false };
      const [rx, ry] = await Promise.all([put(sx, body), put(sy, body)]);
      const codes = [rx.status(), ry.status()].sort();
      must(codes[0] === 200 && codes[1] === 409, `round ${round}: expected one 200 and one 409, got ${codes}`);
      const { data } = await admin.from("rider_profiles").select("user_id").eq("handle", handle);
      must(data.length === 1, `round ${round}: handle exists ${data.length} times`);
      await sx.context.close(); await sy.context.close();
    }
  });

  await step("report and block are enforced by the APIs", async () => {
    const b = await login(B);
    const baseB = { handle: handleB, display_name: "Bee Rider", bio: "", location_city: "", location_state: "", interests: [], avatar_color: "indigo", is_public: true, show_motorcycle: false, featured_bike_id: null, show_stats: false };
    must((await put(b, baseB)).status() === 200, "B profile");
    // The report limit (5 per hour per account) counts every call, so the report-behaviour cases use their own reporter
    // and B keeps its budget for the blocking and rate-limit checks below.
    const R = await newUser("r"); const r = await login(R);
    const rep = (s, h, data) => s.req.post(`${BASE}/api/riders/${h}/report`, { data });
    const blk = (s, h) => s.req.post(`${BASE}/api/riders/${h}/block`);
    const unb = (s, h) => s.req.delete(`${BASE}/api/riders/${h}/block`);

    must((await rep(visitor, handleA2, { reason: "spam" })).status() === 401, "report needs sign-in");
    must((await blk(visitor, handleA2)).status() === 401, "block needs sign-in");
    const first = await rep(r, handleA2, { reason: "spam", note: "looks fake" });
    must(first.status() === 201, "report should be accepted, got " + first.status());
    const dup = await rep(r, handleA2, { reason: "harassment" });
    must(dup.status() === 200 && (await dup.json()).duplicate === true, "a second open report is a harmless duplicate");
    must((await rep(r, handleA2, { reason: "boring" })).status() === 422, "unknown reason must be 422");
    must((await rep(a, handleA2, { reason: "spam" })).status() === 422, "reporting yourself must be 422");
    must((await blk(a, handleA2)).status() === 422, "blocking yourself must be 422");
    // reporting a handle that does not exist behaves exactly like reporting a private one
    const { data: pc } = await admin.auth.admin.createUser({ email: `prof-c-${run}@example.com`, password, email_confirm: true }); users.push({ id: pc.user.id });
    await admin.from("rider_profiles").insert({ user_id: pc.user.id, handle: `priv${run}`, display_name: "Private C", is_public: false });
    const rPriv = await rep(r, `priv${run}`, { reason: "spam" }), rMiss = await rep(r, `ghost${run}`, { reason: "spam" });
    must(rPriv.status() === 404 && rMiss.status() === 404 && (await err(rPriv)).code === "NOT_FOUND" && (await err(rMiss)).code === "NOT_FOUND", "private and missing must both be 404 NOT_FOUND");
    const { data: reports } = await admin.from("profile_reports").select("reporter_id, profile_user_id, status").eq("reporter_id", R.id);
    must(reports.length === 1 && reports[0].profile_user_id === A.id && reports[0].status === "open", "exactly one open report should exist");

    // blocking: A blocks B, so B can no longer see A, report A or block A; A can still see B and unblock
    must((await blk(a, handleB)).status() === 201 && (await blk(a, handleB)).status() === 201, "blocking is idempotent");
    must((await b.page.goto(BASE + "/rider/" + handleA2)).status() === 404, "a blocked rider must get a plain 404 for the blocker's profile");
    must((await rep(b, handleA2, { reason: "spam" })).status() === 404, "a blocked rider cannot report the blocker (cannot even see them)");
    must((await blk(b, handleA2)).status() === 404, "a blocked rider cannot block the blocker either");
    await a.page.goto(BASE + "/rider/" + handleB);
    await a.page.getByRole("button", { name: "Unblock" }).waitFor();
    await a.page.goto(BASE + "/profile");
    await a.page.getByText(`@${handleB}`).waitFor();
    must((await unb(a, handleB)).status() === 200, "unblock should work");
    must((await b.page.goto(BASE + "/rider/" + handleA2)).status() === 200, "after unblocking, the profile is visible again");

    // UI: the controls appear for signed-in visitors only, never on your own profile
    await b.page.getByRole("button", { name: "Block this rider" }).waitFor();
    await b.page.getByText("Report this profile").waitFor();
    await a.page.goto(BASE + "/rider/" + handleA2);
    must((await a.page.getByRole("button", { name: "Block this rider" }).count()) === 0, "no block control on your own profile");
    await visitor.page.goto(BASE + "/rider/" + handleA2);
    await visitor.page.getByText("to report or block a profile").waitFor();
    // report spam is rate limited
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await rep(b, handleA2, { reason: "spam" })).status());
    must(codes.includes(429), "report spam must eventually be rate limited: " + codes);
    await b.context.close(); await r.context.close();
  });

  await step("disable, delete, and the freed handle", async () => {
    await a.page.goto(BASE + "/profile");
    await a.page.getByRole("button", { name: "Disable profile (make it private)" }).click();
    await a.page.getByText("Your profile is now private").waitFor();
    must((await visitor.page.goto(BASE + "/rider/" + handleA2)).status() === 404, "a disabled profile must be invisible");
    must((await a.page.goto(BASE + "/rider/" + handleA2)).status() === 200, "the owner can still preview a disabled profile");
    await a.page.goto(BASE + "/profile");
    await a.page.getByRole("button", { name: "Delete rider profile" }).click();
    await a.page.getByText("Your rider profile was deleted").waitFor();
    must((await a.page.goto(BASE + "/rider/" + handleA2)).status() === 404, "a deleted profile is gone, even for the owner");
    const { data } = await admin.from("rider_profiles").select("user_id").eq("handle", handleA2);
    must(data.length === 0, "row should be removed");
  });

  await step("profile API: sign-in required, rate limited, and no public read endpoint exists", async () => {
    must((await visitor.req.get(BASE + "/api/profile")).status() === 401, "GET /api/profile must need sign-in");
    must((await visitor.req.delete(BASE + "/api/profile")).status() === 401, "DELETE /api/profile must need sign-in");
    must([404, 405].includes((await visitor.req.get(BASE + `/api/riders/${handleB}`)).status()), "there must be no public JSON endpoint for profiles");
    const c = await login(await newUser("rate"));
    const statuses = [];
    for (let i = 0; i < 35; i++) statuses.push((await c.req.get(`${BASE}/api/profile/handle-available?handle=free${i}${run}`)).status());
    must(statuses.includes(429), "handle probing must be rate limited");
    await c.context.close();
  });

  // pages for the visual checks: A re-creates a public profile with everything switched on
  await step("accessibility: no serious or critical issues in light and dark (axe)", async () => {
    await a.page.goto(BASE + "/profile");
    await a.page.getByLabel("Handle").fill(`ra4${run}`);
    await a.page.getByLabel("Display name").fill("Adventure Rider");
    await a.page.getByLabel(/Bio/).fill("Exploring India.");
    await a.page.locator('input[name="interests"][value="touring"]').check({ force: true });
    await a.page.locator('input[name="is_public"][value="true"]').check();
    await a.page.locator('input[name="show_motorcycle"]').check({ force: true });
    await a.page.locator('select[name="featured_bike_id"]').selectOption(bikeA.id);
    await a.page.locator('input[name="show_stats"]').check({ force: true });
    await a.page.getByRole("button", { name: /Create profile|Save profile/ }).click();
    await a.page.getByText("Profile saved.").waitFor();
    handleA3 = `ra4${run}`;
    const problems = [
      ...(await axeScan(a.page, "/profile")),
      ...(await (async () => { await a.page.goto(BASE + "/rider/" + handleA3); return axeScan(a.page, "/rider (owner view)"); })()),
      ...(await (async () => { await visitor.page.goto(BASE + "/rider/" + handleA3); return axeScan(visitor.page, "/rider (public view)"); })()),
    ];
    must(problems.length === 0, problems.slice(0, 3).join(" | "));
  });
  var handleA3;

  await step("mobile usability: every control is at least 44px on the profile screens", async () => {
    const problems = [];
    await a.page.goto(BASE + "/profile"); problems.push(...(await smallTargets(a.page)).map((s) => "/profile " + s));
    await a.page.goto(BASE + "/rider/" + handleA3); problems.push(...(await smallTargets(a.page)).map((s) => "/rider(owner) " + s));
    const b = await login(B);
    await b.page.goto(BASE + "/rider/" + handleA3); problems.push(...(await smallTargets(b.page)).map((s) => "/rider(viewer) " + s));
    await b.page.locator("summary").click(); problems.push(...(await smallTargets(b.page)).map((s) => "/rider(report open) " + s));
    await b.context.close();
    must(problems.length === 0, problems.slice(0, 4).join("; "));
  });

  await step("deleting an account removes the profile, its blocks and reports", async () => {
    const { data: before } = await admin.from("rider_profiles").select("user_id").eq("user_id", A.id);
    must(before.length === 1, "precondition: A has a profile");
    await admin.auth.admin.deleteUser(A.id);
    const { data: after } = await admin.from("rider_profiles").select("user_id").eq("user_id", A.id);
    const { data: blocks } = await admin.from("profile_blocks").select("blocker_id").or(`blocker_id.eq.${A.id},blocked_id.eq.${A.id}`);
    const { data: reps } = await admin.from("profile_reports").select("id").or(`reporter_id.eq.${A.id},profile_user_id.eq.${A.id}`);
    must(after.length === 0 && blocks.length === 0 && reps.length === 0, "account deletion left profile data behind");
    must((await visitor.page.goto(BASE + "/rider/" + handleA3)).status() === 404, "the profile URL must stop working");
  });
} catch (e) {
  failed = true;
  console.error("STOPPED AT:", e.message.split("\n")[0]);
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser.close();
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  console.table(steps);
  console.log(failed ? "PROFILE E2E FAILED" : "PROFILE E2E PASSED", `| users cleaned up: ${users.length}`);
  process.exit(failed ? 1 : 0);
}
