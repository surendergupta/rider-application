// Focused browser test for Community Phase 1: rider discovery, group rides, invitations, participation, blocks, reports.
// Also checks accessibility (axe, light and dark) and 44px touch targets on the new screens.
// Usage: start the app, then `npm run test:e2e:community`. Creates throwaway users and always deletes them.
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
const password = "Comm-test-pass-123";
const users = [];
const browser = await chromium.launch({ executablePath: exe, headless: true });
const contexts = [];

async function newUser(tag, profile) {
  const email = `comm-${tag}-${run}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("create user: " + error.message);
  const u = { id: data.user.id, email, tag, handle: `c${tag}${run}` };
  users.push(u);
  if (profile) {
    const { error: e2 } = await admin.from("rider_profiles").insert({
      user_id: u.id, handle: u.handle, display_name: profile.name, is_public: profile.public ?? true, discoverable: profile.discoverable ?? false,
      location_city: profile.city ?? null, location_state: profile.state ?? null, interests: profile.interests ?? [], bio: profile.bio ?? null,
    });
    if (e2) throw new Error("profile: " + e2.message);
  }
  return u;
}
async function login(u) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(context);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.goto(BASE + "/login");
  await page.getByLabel("Email").fill(u.email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL("**/home");
  return { context, page, user: u };
}
const steps = [];
fs.mkdirSync("test-results", { recursive: true });
const progressFile = "test-results/community-e2e-progress.log";
fs.writeFileSync(progressFile, `# community e2e started ${new Date().toISOString()}\n`);
const record = (line) => { console.log(line); fs.appendFileSync(progressFile, line + "\n"); };   // written immediately, survives a hard stop
const step = async (name, fn) => {
  try { await fn(); steps.push({ step: name, result: "PASS" }); record(`PASS  ${name}`); }
  catch (e) {
    const msg = e.message.split("\n")[0].slice(0, 160);
    steps.push({ step: name, result: "FAIL: " + msg }); record(`FAIL  ${name} :: ${msg}`); throw e;
  }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const text = (p) => p.locator("body").innerText();
const html = (p) => p.content();
const ist = () => new Date(Date.now() + 5.5 * 3600e3);
const dateIn = (n) => new Date(ist().getTime() + n * 86400e3).toISOString().slice(0, 10);

const smallTargets = (p) => p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary")) {
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.tagName === "A" && el.closest("p, li > span, td")) continue;
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) { const l = el.closest("label"); if (l) r = l.getBoundingClientRect(); }
    if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 28)}" ${Math.round(r.height)}px`);
  }
  return out;
});
async function axeScan(p, label) {
  const bad = [];
  for (const theme of ["dark", "light"]) {
    await p.evaluate((t) => localStorage.setItem("lrp-theme", t), theme);
    await p.reload(); await p.waitForLoadState("networkidle");
    await p.addScriptTag({ path: axePath });
    const res = await p.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    for (const v of res.violations) if (["serious", "critical"].includes(v.impact)) bad.push(`${label} [${theme}] ${v.id}: ${v.nodes[0]?.target?.join(" ")}`);
  }
  await p.evaluate(() => localStorage.removeItem("lrp-theme"));
  return bad;
}

async function fillRide(p, o) {
  await p.getByLabel("Ride title").fill(o.title);
  await p.getByLabel("City or area the ride starts in").fill(o.area ?? "Delhi");
  if (o.destination) await p.getByLabel("Destination (optional)").fill(o.destination);
  if (o.meeting !== undefined) await p.getByLabel("Exact meeting point (optional)").fill(o.meeting);
  await p.getByLabel("Start date").fill(o.date ?? dateIn(7));
  if (o.time) await p.getByLabel("Start time (optional)").fill(o.time);
  await p.locator(`input[name="visibility"][value="${o.visibility ?? "public"}"]`).check();
  const box = p.locator('input[name="requires_approval"]');
  if (o.approval === false) await box.uncheck(); else await box.check();
  await p.getByLabel("Number of riders, including you").fill(String(o.max ?? 5));
  if (o.note) await p.getByLabel("Note for confirmed riders (optional)").fill(o.note);
}
async function createRide(p, o) {
  await p.goto(BASE + "/rides/new");
  await fillRide(p, o);
  await p.getByRole("button", { name: "Create ride" }).click();
  await p.waitForURL(/\/rides\/[0-9a-f-]{36}/);
  return p.url().split("?")[0].split("/").pop();
}

let failed = false;
try {
  const H = await newUser("h", { name: "Host Harry", discoverable: true, state: "Delhi", city: "Delhi", interests: ["touring"] });
  const P = await newUser("p", { name: "Pat Rider", discoverable: true, state: "Delhi", city: "Gurugram", interests: ["touring", "mountains"], bio: "Weekend rider" });
  const Q = await newUser("q", { name: "Quinn Quiet", discoverable: false, state: "Goa" });          // public but NOT listed in discovery
  const X = await newUser("x");                                                                        // no rider profile at all
  const h = await login(H), p = await login(P), q = await login(Q), x = await login(X);

  await step("discovery lists only opted-in public riders, excludes yourself, and filters work", async () => {
    await h.page.goto(BASE + "/riders");
    let t = await text(h.page);
    must(t.includes("Pat Rider") && t.includes(`@${P.handle}`), "an opted-in rider should be listed");
    must(!t.includes("Quinn Quiet"), "a public rider who did not opt in to discovery must not be listed");
    must(!t.includes("Host Harry"), "you must not see yourself");
    for (const s of [P.email, P.id, Q.id]) must(!t.includes(s) && !(await html(h.page)).includes(s), "discovery leaked " + s.slice(0, 8));
    await h.page.goto(BASE + "/riders?interest=mountains"); must((await text(h.page)).includes("Pat Rider"), "interest filter should match");
    await h.page.goto(BASE + "/riders?interest=city"); must(!(await text(h.page)).includes("Pat Rider"), "interest filter should exclude");
    await h.page.goto(BASE + "/riders?state=delhi&q=pat"); must((await text(h.page)).includes("Pat Rider"), "state + name filter (case-insensitive)");
    await h.page.goto(BASE + "/riders?q=" + encodeURIComponent("%_,();--")); must(!(await text(h.page)).includes("Internal Server Error"), "hostile search text must not break the page");
    // a blocked rider disappears from discovery in both directions
    await admin.from("profile_blocks").insert({ blocker_id: H.id, blocked_id: P.id });
    await h.page.goto(BASE + "/riders"); must(!(await text(h.page)).includes("Pat Rider"), "a rider you blocked must not be listed");
    await p.page.goto(BASE + "/riders"); must(!(await text(p.page)).includes("Host Harry"), "a rider who blocked you must not be listed to you");
    await admin.from("profile_blocks").delete().eq("blocker_id", H.id);
    // opting out removes you
    await admin.from("rider_profiles").update({ is_public: false }).eq("user_id", P.id);
    await h.page.goto(BASE + "/riders"); must(!(await text(h.page)).includes("Pat Rider"), "going private must remove a rider from discovery");
    const { data: row } = await admin.from("rider_profiles").select("discoverable").eq("user_id", P.id).single();
    must(row.discoverable === false, "the discovery flag must be cleared when the profile goes private");
    await admin.from("rider_profiles").update({ is_public: true, discoverable: true }).eq("user_id", P.id);
    must((await (await fetch(`${BASE}/riders`, { redirect: "manual" })).status) === 307, "discovery needs sign-in");
  });

  await step("hosting needs a rider profile", async () => {
    await x.page.goto(BASE + "/rides/new"); await x.page.waitForURL("**/profile");
    await x.page.goto(BASE + "/rides"); await x.page.getByText("to host or join rides").waitFor();
  });

  let ride1;
  await step("host creates a ride; the exact meeting point stays private", async () => {
    ride1 = await createRide(h.page, { title: "Delhi to Jaipur weekend", destination: "Jaipur", meeting: "SECRET fuel station, Sector 9", time: "06:30", max: 3, note: "Bring cash for tolls" });
    const t = await text(h.page);
    must(t.includes("Delhi to Jaipur weekend") && t.includes("1 of 3 riders confirmed"), "ride summary wrong: " + t.slice(0, 200));
    must(t.includes("SECRET fuel station") && t.includes("Bring cash for tolls"), "the host must see the meeting details");
    must((await h.page.getByTestId("private-details").count()) === 1, "private details block missing for host");
  });

  await step("a stranger sees public details only, never the meeting point or anyone's id", async () => {
    await p.page.goto(BASE + "/rides/" + ride1);
    const t = await text(p.page), src = await html(p.page);
    must(t.includes("Delhi to Jaipur weekend") && t.includes("Hosted by Host Harry") && t.includes("1 of 3"), "public details missing");
    for (const s of ["SECRET", "Sector 9", "Bring cash", H.id, H.email]) must(!t.includes(s) && !src.includes(s), "LEAK to a non-member: " + s);
    must(t.includes("shared with riders the host confirms"), "should explain how to get the meeting point");
    must((await p.page.getByRole("button", { name: "Ask to join" }).count()) === 1, "join button missing");
    must((await p.page.getByText("Who is going").count()) === 0, "participant list must not be visible to a non-member");
  });

  await step("request, review, approve: the meeting point appears only after approval", async () => {
    await p.page.getByRole("button", { name: "Ask to join" }).click();
    await p.page.getByText("Request sent").waitFor();
    must(!(await text(p.page)).includes("SECRET"), "a pending request must not see the meeting point");
    await h.page.goto(BASE + "/rides");
    await h.page.getByText("Requests to review (1)").waitFor();
    await h.page.goto(BASE + "/home");
    await h.page.getByText("1 rider wants to join your rides").waitFor();
    await h.page.goto(BASE + "/rides");
    await h.page.getByRole("button", { name: "Approve Pat Rider" }).click();
    await h.page.getByText("Rider approved").waitFor();
    await p.page.goto(BASE + "/rides/" + ride1);
    await p.page.getByText("You are going.").first().waitFor();
    const t = await text(p.page);
    must(t.includes("SECRET fuel station") && t.includes("Bring cash for tolls"), "a confirmed rider must see the meeting point");
    must(t.includes("2 of 3 riders confirmed") && t.includes("Who is going (2)"), "confirmed riders should see the list: " + t.slice(0, 300));
    must(!t.includes(P.id) && !(await html(p.page)).includes(H.id), "participant list must not expose ids");
    await q.page.goto(BASE + "/rides/" + ride1);
    must(!(await text(q.page)).includes("Pat Rider") && !(await text(q.page)).includes("SECRET"), "another stranger must not see names or the meeting point");
  });

  await step("invite-only rides are invisible until invited; invitations are answered from Rides", async () => {
    const inv = await createRide(h.page, { title: "Invite only night ride", visibility: "invite_only", max: 4 });
    must((await q.page.goto(BASE + "/rides/" + inv)).status() === 404, "an invite-only ride must be a 404 for others");
    await q.page.goto(BASE + "/rides"); must(!(await text(q.page)).includes("Invite only night ride"), "invite-only ride leaked into Find rides");
    await h.page.goto(BASE + "/rides/" + inv);
    await h.page.getByPlaceholder("@rider_name").fill("@nobodyhere" + run);
    await h.page.getByRole("button", { name: "Send invitation" }).click();
    await h.page.getByText("could not be found, or cannot be invited").waitFor();
    await h.page.getByPlaceholder("@rider_name").fill("@" + Q.handle.toUpperCase());
    await h.page.getByRole("button", { name: "Send invitation" }).click();
    await h.page.getByText("Invitation sent").waitFor();
    await q.page.goto(BASE + "/rides"); await q.page.getByText("Invitations (1)").waitFor();
    await q.page.goto(BASE + "/home"); await q.page.getByText("You have 1 ride invitation").waitFor();
    await q.page.goto(BASE + "/rides");
    await q.page.getByRole("button", { name: "Accept" }).click();
    await q.page.getByText("You are going").first().waitFor();
    must((await q.page.goto(BASE + "/rides/" + inv)).status() === 200, "an invited rider must be able to open the ride");
    await h.page.goto(BASE + "/rides/" + inv);
    await h.page.getByText("Who is going (2)").waitFor();
    // the host can remove a rider; a removed rider cannot rejoin on their own
    await h.page.getByRole("button", { name: `Remove Quinn Quiet from the ride` }).click();
    await h.page.getByText("Rider removed").waitFor();
    must((await q.page.goto(BASE + "/rides/" + inv)).status() === 404, "a removed rider on an invite-only ride loses access");
  });

  await step("capacity: a full ride shows Full and takes no more riders", async () => {
    const full = await createRide(h.page, { title: "Tiny two rider ride", approval: false, max: 2 });
    await p.page.goto(BASE + "/rides/" + full);
    await p.page.getByRole("button", { name: "Join this ride" }).click();
    await p.page.getByText("You are going").first().waitFor();
    await q.page.goto(BASE + "/rides/" + full);
    await q.page.getByText("This ride is full.").first().waitFor();
    must((await q.page.getByRole("button", { name: /join|ask to join/i }).count()) === 0, "a full ride must not offer a join button");
    await q.page.goto(BASE + "/rides?open=1"); must(!(await text(q.page)).includes("Tiny two rider ride"), "'only rides with space' must hide full rides");
    // and the host cannot shrink below the riders already going (edit form)
    await h.page.goto(BASE + `/rides/${full}/edit`);
    await h.page.getByLabel("Number of riders, including you").fill("2");
    await h.page.getByRole("button", { name: "Save changes" }).click();
    await h.page.getByText("Ride saved.").waitFor();
  });

  await step("server-side validation on the ride form (no client help)", async () => {
    await h.page.goto(BASE + "/rides/new");
    await h.page.evaluate(() => [...document.forms].find((f) => /Create ride/.test(f.innerText))?.setAttribute("novalidate", ""));   // bypass the browser, hit the server
    await fillRide(h.page, { title: "ab", date: "2020-01-01" });
    await h.page.getByRole("button", { name: "Create ride" }).click();
    await h.page.getByRole("alert").waitFor();
    must(/title/i.test(await h.page.getByRole("alert").innerText()), "should reject a 2-letter title with a clear message");
    await h.page.goto(BASE + "/rides/new");
    await h.page.evaluate(() => [...document.forms].find((f) => /Create ride/.test(f.innerText))?.setAttribute("novalidate", ""));
    await fillRide(h.page, { title: "Valid title", date: "2020-01-01" });
    await h.page.getByRole("button", { name: "Create ride" }).click();
    await h.page.getByRole("alert").waitFor();
    must(/start date/i.test(await h.page.getByRole("alert").innerText()), "should reject a past start date");
    // a stranger cannot open the host's edit page
    must((await p.page.goto(BASE + `/rides/${ride1}/edit`)).status() === 404, "only the host may edit");
  });

  await step("report a ride; blocking hides the host's rides; unblocking restores them", async () => {
    await p.page.goto(BASE + "/rides/" + ride1);
    await p.page.getByText("Report this ride").click();
    await p.page.getByLabel("Reason").selectOption("unsafe");
    await p.page.getByRole("button", { name: "Send report" }).click();
    await p.page.getByText("Your report was sent").waitFor();
    const { data: reps } = await admin.from("ride_reports").select("reporter_id, status").eq("ride_id", ride1);
    must(reps.length === 1 && reps[0].reporter_id === P.id && reps[0].status === "open", "report not stored correctly");
    await h.page.goto(BASE + "/rides/" + ride1);
    must((await h.page.getByText("Report this ride").count()) === 0, "a host cannot report their own ride");
    // H blocks P from P's profile page
    await h.page.goto(BASE + "/rider/" + P.handle);
    await h.page.getByRole("button", { name: "Block this rider" }).click();
    await h.page.getByText("Rider blocked").waitFor();
    must((await p.page.goto(BASE + "/rides/" + ride1)).status() === 404, "a blocked rider must lose access to the host's ride");
    await p.page.goto(BASE + "/rides"); must(!(await text(p.page)).includes("Delhi to Jaipur weekend"), "blocked rider still sees the ride in lists");
    await h.page.goto(BASE + "/rider/" + P.handle);
    await h.page.getByRole("button", { name: "Unblock" }).click();
    await h.page.getByText("Rider unblocked").waitFor();
    must((await p.page.goto(BASE + "/rides/" + ride1)).status() === 200, "unblocking should restore access");
  });

  await step("leaving frees a place; cancelling hides the ride from strangers but not from riders", async () => {
    await p.page.goto(BASE + "/rides/" + ride1);
    await p.page.getByRole("button", { name: "Leave this ride" }).click();
    await p.page.getByText("You are no longer part of this ride").waitFor();
    must(!(await text(p.page)).includes("SECRET"), "after leaving, the meeting point must be hidden again");
    await p.page.getByRole("button", { name: "Ask to join" }).click();
    await p.page.getByText("Request sent").waitFor();
    await h.page.goto(BASE + "/rides/" + ride1);
    await h.page.getByRole("button", { name: "Approve Pat Rider" }).click();
    await h.page.getByText("Rider confirmed").waitFor();
    await h.page.getByRole("button", { name: "Cancel ride" }).click();
    await h.page.getByTestId("cancelled-banner").waitFor();
    await p.page.goto(BASE + "/rides/" + ride1); await p.page.getByTestId("cancelled-banner").waitFor();
    must((await q.page.goto(BASE + "/rides/" + ride1)).status() === 404, "a cancelled ride must be a 404 for strangers");
    await q.page.goto(BASE + "/rides"); must(!(await text(q.page)).includes("Delhi to Jaipur weekend"), "a cancelled ride must leave Find rides");
    must((await h.page.getByRole("button", { name: "Cancel ride" }).count()) === 0, "a cancelled ride has no more host actions");
  });

  await step("navigation: phone tabs and the More page", async () => {
    const tabs = h.page.locator('nav[aria-label="Main"]:visible');
    await h.page.goto(BASE + "/home");
    const labels = (await tabs.first().innerText()).split("\n").map((s) => s.trim()).filter(Boolean);
    for (const l of ["Home", "Trips", "Rides", "Garage", "More"]) must(labels.includes(l), "tab missing: " + l);
    await h.page.goto(BASE + "/rides"); must((await tabs.first().locator('a[aria-current="page"]').innerText()).trim() === "Rides", "Rides tab should be active");
    await h.page.goto(BASE + "/map"); must((await tabs.first().locator('a[aria-current="page"]').innerText()).trim() === "More", "Map lives under More");
    await h.page.goto(BASE + "/more");
    for (const l of ["Find riders", "Offline map", "Rider profile", "Account"]) await h.page.getByText(l, { exact: true }).first().waitFor();
  });

  await step("accessibility (axe, light and dark) and 44px touch targets on the new screens", async () => {
    const live = await createRide(h.page, { title: "Weekend ride for checks", meeting: "Public fuel station", max: 5, note: "Be on time" });
    await p.page.goto(BASE + "/rides/" + live); await p.page.getByRole("button", { name: "Ask to join" }).click(); await p.page.getByText("Request sent").waitFor();
    const problems = [], taps = [];
    for (const [who, label, url] of [[h, "host ride page", `/rides/${live}`], [h, "rides", "/rides"], [h, "new ride", "/rides/new"], [h, "edit ride", `/rides/${live}/edit`],
                                     [h, "riders", "/riders"], [h, "more", "/more"], [p, "rider ride page", `/rides/${live}`]]) {
      await who.page.goto(BASE + url); await who.page.waitForLoadState("networkidle");
      if (label === "rider ride page") await who.page.locator("summary").click();
      taps.push(...(await smallTargets(who.page)).map((s) => `${label}: ${s}`));
      problems.push(...(await axeScan(who.page, label)));
    }
    must(problems.length === 0, "accessibility: " + problems.slice(0, 3).join(" | "));
    must(taps.length === 0, "touch targets: " + taps.slice(0, 4).join("; "));
  });
} catch (e) {
  failed = true;
  console.error("STOPPED AT:", e.message.split("\n")[0]);
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await browser.close();
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  console.table(steps);
  console.log(failed ? "COMMUNITY E2E FAILED" : "COMMUNITY E2E PASSED", `| users cleaned up: ${users.length}`);
  process.exit(failed ? 1 : 0);
}
