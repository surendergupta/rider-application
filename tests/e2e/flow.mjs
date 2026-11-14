// Browser end-to-end test of the full rider journey, on a phone-size viewport.
// Usage: start the app (npm run dev), then: npm run test:e2e
// Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in .env.local. Creates one confirmed test
// user and always deletes it (the final step deletes it through the app's own Delete Account flow).
import fs from "node:fs";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../helpers/env.mjs";

const env = loadEnv();
const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3626}`;
const CANDIDATES = [
  process.env.E2E_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) { console.error("No Chrome/Edge found. Set E2E_BROWSER."); process.exit(2); }
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) { console.log("SKIPPED: Supabase env not set"); process.exit(0); }

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const email = `e2e-${Date.now()}@example.com`;
const password = "E2e-test-pass-123";
const { data: created, error: cerr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (cerr) { console.error("Could not create test user:", cerr.message); process.exit(2); }
const uid = created.user.id;

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
const steps = [];
const text = () => page.locator("main").innerText();
const smallTargets = () => page.evaluate(() => {
  // every visible button, link and field must be at least 44px tall, except links inside running text
  const out = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.tagName === "A" && el.closest("p, li > span, td, .maplibregl-ctrl-attrib")) continue;
    if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 30)}" ${Math.round(r.height)}px`);
  }
  return out;
});
const step = async (name, fn) => {
  try { await fn(); steps.push({ step: name, result: "PASS" }); }
  catch (e) { steps.push({ step: name, result: "FAIL: " + e.message.split("\n")[0].slice(0, 110) }); throw e; }
};

let failed = false;
try {
  await step("landing + legal pages load", async () => {
    await page.goto(BASE + "/"); await page.getByRole("heading", { level: 1 }).waitFor();
    for (const [p, h] of [["/terms", "Terms of Use"], ["/privacy", "Privacy Policy"], ["/signup", "Create your free account"],
                          ["/marketplace", "Rider-to-rider gear marketplace"], ["/community", "Community posts and ride sharing"],
                          ["/pricing", "A free rider account that stays useful"]]) {
      await page.goto(BASE + p); await page.getByRole("heading", { name: h }).waitFor();
    }
  });
  await step("security headers present", async () => {
    const r = await page.request.get(BASE + "/");
    const h = r.headers();
    if (!h["content-security-policy"] || h["x-frame-options"] !== "DENY" || h["x-content-type-options"] !== "nosniff") throw new Error("missing headers");
  });
  await step("signed-out protected pages redirect to login", async () => {
    for (const p of ["/home", "/bikes", "/trips", "/account"]) { await page.goto(BASE + p); await page.waitForURL("**/login"); }
  });
  await step("API rejects signed-out requests", async () => {
    const r = await page.request.get(BASE + "/api/bikes"); if (r.status() !== 401) throw new Error("status " + r.status());
  });
  await step("sign in", async () => {
    await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForURL("**/home");
    await page.getByRole("heading", { name: "Ready for your next ride?" }).waitFor();
    if (!(await text()).includes("Add your motorcycle")) throw new Error("empty garage hint missing");
  });
  await step("design: dark by default, theme toggle persists, no flash", async () => {
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.evaluate(() => localStorage.removeItem("lrp-theme")); await page.reload();
    if ((await theme()) !== "dark" || (await bg()) !== "rgb(18, 22, 27)") throw new Error("default must be the dark brand theme (#12161B)");
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    if ((await theme()) !== "light" || (await bg()) !== "rgb(246, 247, 249)") throw new Error("light theme not applied");
    await page.reload();
    if ((await theme()) !== "light") throw new Error("choice not remembered after reload");
    // the saved theme is applied by an inline script before paint, so the very first HTML already works without a dark flash
    const html = await (await page.request.get(page.url())).text();
    if (!html.includes('localStorage.getItem("lrp-theme")')) throw new Error("theme init script missing from the document head");
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    if ((await theme()) !== "dark") throw new Error("could not switch back to dark");
  });
  await step("design: phone tab bar, 44px touch targets", async () => {
    // on a phone the bottom tab bar is the navigation; the top links are hidden
    const tabs = page.locator('nav[aria-label="Main"]:visible');
    if ((await tabs.count()) !== 1) throw new Error("expected exactly one visible main nav on a phone");
    const labels = (await tabs.first().innerText()).split("\n").map((x) => x.trim()).filter(Boolean);
    for (const l of ["Home", "Trips", "Rides", "Garage", "More"]) if (!labels.includes(l)) throw new Error("tab missing: " + l);
    if ((await tabs.first().locator('a[aria-current="page"]').innerText()).trim() !== "Home") throw new Error("active tab should be Home");
    const small = await smallTargets();
    if (small.length) throw new Error("touch targets under 44px: " + small.slice(0, 4).join("; "));
  });
  await step("add bike", async () => {
    await page.goto(BASE + "/bikes");
    await page.getByLabel("Name").fill("Test Himalayan"); await page.getByLabel("Make").fill("Royal Enfield");
    await page.getByLabel(/Real-world mileage/).fill("30"); await page.getByLabel(/Tank size/).fill("12"); await page.getByLabel(/Odometer/).fill("16450");
    await page.getByRole("button", { name: "Add bike" }).click(); await page.getByText("Test Himalayan").waitFor();
  });
  await step("maintenance: interval, record, due state sync", async () => {
    await page.getByRole("link", { name: "Test Himalayan" }).click(); await page.waitForURL(/\/bikes\/[0-9a-f-]{36}$/);
    const sched = page.locator("main form").nth(2);
    await sched.getByLabel("Every (km)").fill("5000"); await sched.getByLabel(/Last done/).fill("12000");
    await page.getByRole("button", { name: "Save interval" }).click(); await page.getByText("every 5000 km").waitFor();
    if (!(await text()).includes("OK")) throw new Error("expected OK badge");
    const rec = page.locator("main form").nth(3);
    await rec.getByLabel("Date").fill("2026-11-10"); await rec.getByLabel(/Odometer/).fill("17500"); await rec.getByLabel(/Cost/).fill("1,800");
    await page.getByRole("button", { name: "Add record" }).click(); await page.getByText("2026-11-10").waitFor();
    const t = await text();
    if (!t.includes("₹1,800.00") || !t.includes("Odometer 17500 km") || !t.includes("Due at 22500 km")) throw new Error("sync wrong: " + t.slice(0, 300));
  });
  await step("garage documents: expiry states, renewal, and the Home dashboard alerts", async () => {
    const ist = new Date(Date.now() + 5.5 * 3600e3);
    const plus = (d) => new Date(ist.getTime() + d * 86400e3).toISOString().slice(0, 10);
    const bikeUrl = page.url().split("?")[0];
    const docForm = () => page.locator("main form").filter({ has: page.getByRole("button", { name: "Save document" }) });
    await docForm().getByLabel("Document").selectOption("insurance"); await docForm().getByLabel("Expires on").fill(plus(10));
    await page.getByRole("button", { name: "Save document" }).click(); await page.getByText("Expires in 10 days").waitFor();
    await docForm().getByLabel("Document").selectOption("puc"); await docForm().getByLabel("Expires on").fill(plus(-5));
    await page.getByRole("button", { name: "Save document" }).click(); await page.getByText("Expired 5 days ago").waitFor();
    await docForm().getByLabel("Document").selectOption("registration"); await docForm().getByLabel("Expires on").fill(plus(400));
    await page.getByRole("button", { name: "Save document" }).click(); await page.getByText("Expires in 400 days").waitFor();
    // Home: the expired and expiring documents are flagged, the far-off one is not
    await page.goto(BASE + "/home");
    const alerts = page.getByTestId("alerts"); await alerts.waitFor();
    const t = await alerts.innerText();
    if (!t.includes("PUC certificate expired") || !t.includes("Insurance expiring")) throw new Error("alerts wrong: " + t);
    if (t.includes("Registration")) throw new Error("far-off document should not alert");
    if (t.indexOf("PUC certificate expired") > t.indexOf("Insurance expiring")) throw new Error("expired should come before expiring");
    // renew the PUC: saving the same type again updates it and the alert goes away
    await page.goto(bikeUrl);
    await docForm().getByLabel("Document").selectOption("puc"); await docForm().getByLabel("Expires on").fill(plus(200));
    await page.getByRole("button", { name: "Save document" }).click(); await page.getByText("Expires in 200 days").waitFor();
    await page.goto(BASE + "/home");
    if ((await page.getByTestId("alerts").innerText()).includes("PUC")) throw new Error("renewed document still alerting");
    // remove insurance: no alerts left, so the dashboard says all clear
    await page.goto(bikeUrl);
    await page.getByRole("button", { name: "Remove Insurance" }).click(); await page.getByText("Expires in 10 days").waitFor({ state: "detached" });
    await page.goto(BASE + "/home"); await page.getByTestId("all-clear").waitFor();
  });
  await step("create trip", async () => {
    await page.goto(BASE + "/trips");
    await page.getByLabel("Trip name").fill("Delhi to Jaipur"); await page.getByLabel("From", { exact: true }).fill("Delhi");
    await page.getByLabel("To", { exact: true }).fill("Jaipur");
    await page.getByLabel("Days", { exact: true }).fill("3"); await page.getByLabel("Terrain").selectOption("mountains"); await page.getByLabel("Season").selectOption("monsoon");
    await page.getByRole("button", { name: "Create trip" }).click();
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}$/);
  });
  await step("budget = Rs1,545 (golden case) and revision 2", async () => {
    await page.getByLabel("Distance (km)").fill("270"); await page.getByLabel(/Petrol price/).fill("105");
    await page.getByLabel("Food (₹)").fill("500"); await page.getByLabel("Other (₹)").fill("100");
    await page.getByRole("button", { name: "Save budget" }).click(); await page.getByText("Estimated total").waitFor();
    const t = await text();
    if (!t.includes("₹1,545.00") || !t.includes("9 l") || !t.includes("₹945.00")) throw new Error("budget wrong: " + t.slice(0, 300));
    await page.getByRole("button", { name: "Save new revision" }).click(); await page.getByText("revision 2").waitFor();
  });
  await step("start trip, log expenses, actual vs estimate", async () => {
    await page.getByRole("button", { name: "Mark active" }).click(); await page.getByText("Delhi → Jaipur · active").waitFor();
    const add = () => page.locator("form").filter({ has: page.getByRole("button", { name: "Add expense" }) });
    await add().getByLabel("Category").selectOption("fuel"); await add().getByLabel(/Amount/).fill("1120"); await add().getByLabel(/Litres/).fill("10.5"); await add().getByLabel(/Odometer/).fill("17500");
    await page.getByRole("button", { name: "Add expense" }).click(); await page.getByText("₹1,120.00").first().waitFor();
    await add().getByLabel("Category").selectOption("food"); await add().getByLabel(/Amount/).fill("300"); await add().getByLabel("Note").fill("=HYPERLINK(\"x\")");
    await page.getByRole("button", { name: "Add expense" }).click(); await page.getByText("₹300.00").first().waitFor();
    const t = await text();
    if (!t.includes("₹1,420.00") || !t.includes("Under by ₹125.00") || !t.includes("₹5.26")) throw new Error("numbers wrong: " + t.slice(0, 500));
  });
  await step("invalid expense shows error and saves nothing", async () => {
    const add = page.locator("form").filter({ has: page.getByRole("button", { name: "Add expense" }) });
    await add.getByLabel(/Amount/).fill("0"); await page.getByRole("button", { name: "Add expense" }).click(); await page.getByRole("alert").waitFor();
  });
  await step("CSV export is correct and formula-safe", async () => {
    const r = await page.request.get(page.url().split("?")[0].replace("/trips/", "/api/trips/") + "/export.csv");
    const body = await r.text();
    if (r.status() !== 200 || !body.includes(",fuel,1120.00,10.5") || !body.includes(",food,300.00") || !body.includes("'=HYPERLINK")) throw new Error(body.slice(0, 300));
  });
  await step("real mileage from fuel fills + fuel-stop plan", async () => {
    const add = () => page.locator("form").filter({ has: page.getByRole("button", { name: "Add expense" }) });
    await add().getByLabel("Category").selectOption("fuel"); await add().getByLabel(/Amount/).fill("1050");
    await add().getByLabel(/Litres/).fill("10"); await add().getByLabel(/Odometer/).fill("17800");
    await page.getByRole("button", { name: "Add expense" }).click(); await page.getByText("₹1,050.00").first().waitFor();
    const t = await text();
    // 300 km on 10 l = 30 km/l
    if (!t.includes("Your real mileage: 30 km/l")) throw new Error("real mileage missing: " + t.slice(0, 600));
    if (!t.includes("Full-tank range about 360 km") || !t.includes("fits in one tank")) throw new Error("fuel plan wrong");
  });
  await step("itinerary: days and stops, totals, budget mismatch, long day, maps handoff", async () => {
    const addForm = () => page.locator("form").filter({ has: page.getByRole("button", { name: "Add stop" }) });
    const addStop = async (day, place, type, km) => {
      await addForm().getByLabel("Day", { exact: true }).fill(String(day));
      await addForm().getByLabel("Place").fill(place);
      await addForm().getByLabel("Stop type").selectOption(type);
      await addForm().getByLabel("Km from previous stop").fill(String(km));
      await page.getByRole("button", { name: "Add stop" }).click();
      await page.getByText(place, { exact: true }).first().waitFor();
    };
    await addStop(1, "Gurugram", "fuel", 30);
    await addStop(1, "Neemrana", "food", 100);
    await addStop(1, "Jaipur", "stay", 140);
    let t = await text();
    if (!t.includes("1 day · 270 km")) throw new Error("itinerary total wrong: " + t.slice(t.indexOf("Itinerary"), t.indexOf("Itinerary") + 300));
    if (await page.getByTestId("itinerary-mismatch").count()) throw new Error("270 km should match the 270 km budget");
    // a second day pushes the total beyond what the budget uses
    await addStop(2, "Ajmer", "ride", 135);
    t = await text();
    if (!t.includes("2 days · 405 km")) throw new Error("two-day total wrong");
    const warn = await page.getByTestId("itinerary-mismatch").innerText();
    if (!warn.includes("135 km more than the 270 km")) throw new Error("mismatch text wrong: " + warn);
    // long day is flagged
    await addStop(3, "Udaipur", "stay", 450);
    if (!(await text()).includes("A long riding day")) throw new Error("long day not flagged");
    await page.getByRole("button", { name: "Remove stop Udaipur" }).click();
    await page.getByText("Udaipur", { exact: true }).waitFor({ state: "detached" });
    // navigation handoff link: right origin, destination, waypoints in order
    const href = await page.getByTestId("maps-link").getAttribute("href");
    const u = new URL(href);
    if (u.origin + u.pathname !== "https://www.google.com/maps/dir/") throw new Error("bad link " + href);
    if (u.searchParams.get("origin") !== "Delhi" || u.searchParams.get("destination") !== "Jaipur") throw new Error("origin/destination wrong");
    if (u.searchParams.get("waypoints") !== "Gurugram|Neemrana|Jaipur|Ajmer") throw new Error("waypoints wrong: " + u.searchParams.get("waypoints"));
    if ((await page.getByTestId("maps-link").getAttribute("rel")) !== "noopener noreferrer") throw new Error("external link must be noopener");
    // removing the extra day brings the total back in line with the budget
    await page.getByRole("button", { name: "Remove stop Ajmer" }).click();
    await page.getByText("Ajmer", { exact: true }).waitFor({ state: "detached" });
    if (!(await text()).includes("1 day · 270 km")) throw new Error("total after removal wrong");
    if (await page.getByTestId("itinerary-mismatch").count()) throw new Error("mismatch should clear");
  });
  await step("checklist v2: personalised, statuses, additive update", async () => {
    await page.getByRole("button", { name: "Add ride checklist" }).click();
    const readyText = async () => (await text()).match(/(\d+)\/(\d+) ready/);
    await page.getByText(/\d+\/\d+ ready/).first().waitFor();
    let m = await readyText();
    const total1 = Number(m[2]);
    if (m[1] !== "0") throw new Error("should start at 0 ready");
    const t = await text();
    // mountains + monsoon + 3 days must add conditional items on top of the core list
    for (const must of ["Permits or entry passes", "Raincoat or rain suit", "Stay booked", "Bungee cords"]) {
      if (!t.includes(must)) throw new Error("missing personalised item: " + must);
    }
    if (t.includes("Sunscreen")) throw new Error("summer item shown for a monsoon ride");
    for (const cat of ["Documents", "Safety gear", "Motorcycle", "Touring", "Essentials"]) if (!t.includes(cat)) throw new Error("missing category " + cat);
    // gear prompt links to the marketplace waitlist page
    await page.getByTestId("gear-prompt").getByRole("link", { name: /marketplace/i }).waitFor();
    // status changes: packed counts as ready; owned does not; aria-pressed reflects it
    await page.getByRole("button", { name: "Driving licence: Packed", exact: true }).click();
    await page.getByText(new RegExp(`1/${total1} ready`)).first().waitFor();
    if ((await page.getByRole("button", { name: "Driving licence: Packed", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("packed not pressed");
    await page.getByRole("button", { name: "Riding gloves: Have it", exact: true }).click();
    await page.locator('button[aria-label="Riding gloves: Have it"][aria-pressed="true"]').waitFor();
    if (!(await readyText())[0].startsWith("1/")) throw new Error("owned must not count as ready");
    await page.getByRole("button", { name: "Valid PUC certificate: N/A", exact: true }).click();
    await page.getByText(new RegExp(`2/${total1} ready`)).first().waitFor();
    // change ride details, update suggestions: new items are ADDED, existing statuses are KEPT
    await page.getByLabel("Terrain").last().selectOption("desert"); await page.getByLabel("Season").last().selectOption("summer");
    await page.getByRole("button", { name: "Save ride details" }).click(); await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Update suggestions for these ride details" }).click();
    await page.getByText("Sunscreen and a cooling neck cover").waitFor();
    m = await readyText();
    if (Number(m[2]) <= total1) throw new Error("update should add items");
    if (m[1] !== "2") throw new Error("existing statuses were lost: " + m[0]);
    if (!(await text()).includes("Permits or entry passes")) throw new Error("update must not remove existing items");
    // pressing update twice must not duplicate anything
    const before = Number((await readyText())[2]);
    await page.getByRole("button", { name: "Update suggestions for these ride details" }).click(); await page.waitForLoadState("networkidle");
    if (Number((await readyText())[2]) !== before) throw new Error("duplicate items after second update");
  });
  await step("marketplace waitlist: join and leave", async () => {
    const tripPage = page.url().split("?")[0];
    await page.goto(BASE + "/marketplace");
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await page.getByRole("button", { name: /You are on the waitlist/ }).waitFor();
    await page.getByRole("button", { name: /You are on the waitlist/ }).click();
    await page.getByRole("button", { name: "Join the waitlist" }).waitFor();
    await page.goto(tripPage);
  });
  await step("share link: public page shows summary only, then turns off", async () => {
    await page.getByRole("button", { name: "Create share link" }).click();
    const link = (await page.getByTestId("share-link").innerText()).trim();
    if (!/^\/s\/[0-9a-f-]{36}$/.test(link)) throw new Error("bad link " + link);
    const anon = await browser.newContext(); // signed-out visitor
    const pub = await anon.newPage();
    const r = await pub.goto(BASE + link);
    if (r.status() !== 200) throw new Error("public status " + r.status());
    const body = await pub.locator("body").innerText();
    if (!body.includes("Delhi to Jaipur") || !body.includes("₹2,470.00")) throw new Error("summary wrong: " + body.slice(0, 300));
    if (body.includes("HYPERLINK") || body.includes("Dhaba")) throw new Error("private notes leaked");
    if ((await pub.locator('meta[name="robots"]').getAttribute("content")) !== "noindex, nofollow") throw new Error("not noindex");
    await page.getByRole("button", { name: "Stop sharing" }).click(); await page.getByRole("button", { name: "Create share link" }).waitFor();
    const off = await pub.goto(BASE + link);
    if (off.status() !== 404) throw new Error("link still live: " + off.status());
    await anon.close();
  });
  await step("pricing: signed-in early-access interest is saved", async () => {
    const tripPage = page.url().split("?")[0];
    await page.goto(BASE + "/pricing");
    await page.getByRole("button", { name: "₹199 / month" }).click();
    await page.getByText("You are on the early-access list").waitFor();
    await page.goto(tripPage);
  });
  await step("delete an expense updates totals", async () => {
    await page.goto(page.url().split("?")[0]);
    await page.getByRole("button", { name: "Delete food expense" }).click();
    await page.waitForFunction(() => !document.body.innerText.includes("₹300.00"));
    if (!(await text()).includes("₹1,120.00")) throw new Error("wrong total after delete");
  });
  await step("design: 44px touch targets on every main screen", async () => {
    const tripUrl = page.url().split("?")[0];
    const problems = [];
    for (const [name, url] of [["home", "/home"], ["garage", "/bikes"], ["trips", "/trips"], ["account", "/account"], ["pricing", "/pricing"], ["map", "/map"], ["trip", tripUrl.replace(BASE, "")]]) {
      await page.goto(BASE + url); await page.waitForLoadState("networkidle");
      const small = await smallTargets();
      if (small.length) problems.push(`${name}: ${small.slice(0, 3).join("; ")}`);
    }
    await page.goto(tripUrl);
    if (problems.length) throw new Error(problems.join(" | "));
  });
  await step("complete trip hides expense form; archived view works", async () => {
    await page.getByRole("button", { name: "Mark completed" }).click(); await page.getByText("· completed").waitFor();
    if (await page.getByRole("button", { name: "Add expense" }).count()) throw new Error("form still shown");
    await page.getByRole("button", { name: "Mark archived" }).click(); await page.getByText("· archived").waitFor();
    await page.goto(BASE + "/trips"); if ((await text()).includes("Delhi to Jaipur")) throw new Error("archived trip still in active list");
    await page.getByRole("link", { name: "Show archived" }).click(); await page.getByText("Delhi to Jaipur").waitFor();
  });
  await step("route preview API validates input and fails soft without a provider", async () => {
    const bad = await page.request.post(BASE + "/api/routes/preview", { data: { origin: { lat: 999, lon: 0 } } });
    if (bad.status() !== 422) throw new Error("expected 422, got " + bad.status());
  });
  await step("account deletion removes the user and all data", async () => {
    await page.goto(BASE + "/account");
    await page.getByLabel(/Type/).fill("nope"); await page.getByRole("button", { name: "Delete everything" }).click(); await page.getByRole("alert").waitFor();
    await page.getByLabel(/Type/).fill("DELETE"); await page.getByRole("button", { name: "Delete everything" }).click();
    await page.waitForURL("**/login?notice=deleted");
    const { data } = await admin.auth.admin.getUserById(uid);
    if (data?.user) throw new Error("user still exists");
    const { count } = await admin.from("bikes").select("*", { count: "exact", head: true }).eq("user_id", uid);
    if (count) throw new Error("data left behind");
  });
} catch {
  failed = true;
} finally {
  await browser.close();
  await admin.auth.admin.deleteUser(uid).catch(() => {}); // no-op if the app already deleted it
  console.table(steps);
  console.log(failed ? "E2E FAILED" : "E2E PASSED");
  process.exit(failed ? 1 : 0);
}
