// Focused security and integrity test for Community Phase 1 (rides, invitations, participation, discovery opt-in).
// Runs in a transaction that is ALWAYS rolled back. Usage: npm run test:db:community  (needs DATABASE_URL)
import pg from "pg";
import { loadEnv, pgConfig } from "../helpers/env.mjs";

const cfg = pgConfig(loadEnv());
if (!cfg) { console.log("SKIPPED: set DATABASE_URL in .env.local"); process.exit(0); }

const c = new pg.Client(cfg);
await c.connect();
const U = { H: "a1111111-1111-1111-1111-111111111111", P: "a2222222-2222-2222-2222-222222222222", Q: "a3333333-3333-3333-3333-333333333333",
            X: "a4444444-4444-4444-4444-444444444444", Z: "a5555555-5555-5555-5555-555555555555" };
const results = [];
let crashed = null;

const as = (uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
const priv = async (fn) => { await c.query("reset role"); try { return await fn(); } finally { await c.query("set local role authenticated"); } };
/** Runs a statement as a user and returns the error message, or null if it succeeded. The failed statement is rolled back. */
async function errOf(uid, sql, params = []) {
  await as(uid); await c.query("savepoint eo");
  try { await c.query(sql, params); await c.query("release savepoint eo"); return null; }
  catch (e) { await c.query("rollback to savepoint eo"); return e.message; }
}
const q = async (uid, sql, params = []) => { await as(uid); return (await c.query(sql, params)).rows; };
const one = async (uid, sql, params = []) => (await q(uid, sql, params))[0];

async function check(name, fn) {
  await c.query("savepoint chk");
  let pass = true, detail = "";
  try { await fn(); } catch (e) { pass = false; detail = e.message; }
  await c.query("rollback to savepoint chk");   // every check starts from the same clean state
  results.push({ test: name, pass, detail: detail.slice(0, 90) });
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectErr = async (uid, sql, params, code) => {
  const m = await errOf(uid, sql, params);
  ok(m !== null, `expected "${code}" but it succeeded`);
  ok(m.includes(code), `expected "${code}" but got "${m.slice(0, 80)}"`);
};

const future = () => new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
async function mkRide(host, o = {}) {
  const r = { title: "Weekend ride", area: "Delhi", visibility: "public", approval: true, max: 10, ...o };
  const row = await one(host, `insert into rides (host_id, title, area_label, starts_on, visibility, requires_approval, max_riders)
    values ($1,$2,$3,$4,$5,$6,$7) returning id`, [host, r.title, r.area, future(), r.visibility, r.approval, r.max]);
  return row.id;
}
const join = (u, ride) => one(u, "select ride_request_join($1) s", [ride]).then((x) => x.s);
const decide = (u, ride, target, yes) => one(u, "select ride_decide($1,$2,$3) s", [ride, target, yes]).then((x) => x.s);
const invite = (u, ride, handle) => one(u, "select ride_invite($1,$2) s", [ride, handle]).then((x) => x.s);
const respond = (u, ride, yes) => one(u, "select ride_respond($1,$2) s", [ride, yes]).then((x) => x.s);
const status = (ride, uid) => priv(() => c.query("select status from ride_participants where ride_id=$1 and user_id=$2", [ride, uid])).then((r) => r.rows[0]?.status);

try {
  await c.query("begin");
  for (const id of Object.values(U)) await c.query("insert into auth.users (id, aud, role, email) values ($1,'authenticated','authenticated',$2)", [id, id.slice(0, 8) + "@test.invalid"]);
  // profiles: H, P, Q public; Z private; X has none
  for (const [k, h, pub] of [["H", "host_h", true], ["P", "rider_p", true], ["Q", "rider_q", true], ["Z", "rider_z", false]]) {
    await c.query("insert into rider_profiles (user_id, handle, display_name, is_public) values ($1,$2,$3,$4)", [U[k], h, h, pub]);
  }
  await c.query("set local role authenticated");

  // ---------- discovery opt-in ----------
  await check("DISCOVERY a private profile cannot be made discoverable (the flag is forced off)", async () => {
    await q(U.Z, "update rider_profiles set discoverable = true where user_id = $1", [U.Z]);
    const r = await priv(() => c.query("select discoverable from rider_profiles where user_id=$1", [U.Z]));
    ok(r.rows[0].discoverable === false, "a private profile became discoverable");
  });
  await check("DISCOVERY the table constraint also refuses discoverable + private if the trigger were bypassed", async () => {
    await c.query("reset role"); await c.query("alter table rider_profiles disable trigger trg_rider_profiles_discoverable");
    let msg = null;
    await c.query("savepoint dz");
    try { await c.query("update rider_profiles set discoverable = true where user_id = $1", [U.Z]); } catch (e) { msg = e.message; await c.query("rollback to savepoint dz"); }
    await c.query("alter table rider_profiles enable trigger trg_rider_profiles_discoverable"); await c.query("set local role authenticated");
    ok(msg && msg.includes("rider_profiles_discoverable_needs_public"), "constraint did not fire: " + msg);
  });
  await check("DISCOVERY switching a profile to private also removes it from discovery", async () => {
    await q(U.P, "update rider_profiles set discoverable = true where user_id = $1", [U.P]);
    await q(U.P, "update rider_profiles set is_public = false where user_id = $1", [U.P]);
    const r = await priv(() => c.query("select discoverable from rider_profiles where user_id=$1", [U.P]));
    ok(r.rows[0].discoverable === false, "still discoverable after going private");
  });

  // ---------- creating rides ----------
  await check("RIDE host is automatically a confirmed rider", async () => {
    const id = await mkRide(U.H);
    ok((await status(id, U.H)) === "going", "host row missing");
  });
  await check("RIDE a user without a rider profile cannot host", async () => {
    await expectErr(U.X, "insert into rides (host_id, title, area_label, starts_on) values ($1,'Some ride','Delhi',$2)", [U.X, future()], "row-level security");
  });
  await check("RIDE nobody can create a ride in someone else's name", async () => {
    await expectErr(U.P, "insert into rides (host_id, title, area_label, starts_on) values ($1,'Fake ride','Delhi',$2)", [U.H, future()], "row-level security");
  });
  await check("RIDE invalid rides are rejected by the database", async () => {
    const bad = [
      ["title too short", "insert into rides (host_id, title, area_label, starts_on) values ($1,'ab','Delhi',$2)"],
      ["blank area", "insert into rides (host_id, title, area_label, starts_on) values ($1,'Good title','  ',$2)"],
      ["max riders 1", "insert into rides (host_id, title, area_label, starts_on, max_riders) values ($1,'Good title','Delhi',$2,1)"],
      ["max riders 101", "insert into rides (host_id, title, area_label, starts_on, max_riders) values ($1,'Good title','Delhi',$2,101)"],
      ["unknown visibility", "insert into rides (host_id, title, area_label, starts_on, visibility) values ($1,'Good title','Delhi',$2,'secret')"],
      ["ends before it starts", "insert into rides (host_id, title, area_label, starts_on, ends_on) values ($1,'Good title','Delhi',$2,'2000-01-01')"],
      ["zero distance", "insert into rides (host_id, title, area_label, starts_on, distance_km) values ($1,'Good title','Delhi',$2,0)"],
    ];
    for (const [label, sql] of bad) ok((await errOf(U.H, sql, [U.H, future()])) !== null, `accepted: ${label}`);
  });

  // ---------- who can see a ride ----------
  await check("VISIBILITY a public open ride is visible to any signed-in rider; invite-only is not", async () => {
    const pub = await mkRide(U.H), inv = await mkRide(U.H, { visibility: "invite_only" });
    ok((await q(U.P, "select id from rides where id = $1", [pub])).length === 1, "public ride hidden");
    ok((await q(U.P, "select id from rides where id = $1", [inv])).length === 0, "invite-only ride leaked");
    ok((await q(U.H, "select id from rides where id = $1", [inv])).length === 1, "host cannot see their own ride");
  });
  await check("VISIBILITY a cancelled ride disappears for strangers but stays for the host", async () => {
    const id = await mkRide(U.H);
    await q(U.H, "update rides set status='cancelled' where id=$1", [id]);
    ok((await q(U.P, "select id from rides where id=$1", [id])).length === 0, "cancelled ride visible to a stranger");
    ok((await q(U.H, "select id from rides where id=$1", [id])).length === 1, "host lost their cancelled ride");
  });
  await check("VISIBILITY anonymous database access sees no rides", async () => {
    const id = await mkRide(U.H);
    await c.query("reset role"); await c.query("set local role anon");
    let n = 0; try { n = (await c.query("select count(*)::int n from rides where id=$1", [id])).rows[0].n; } catch { n = 0; }
    await c.query("reset role"); await c.query("set local role authenticated");
    ok(n === 0, "anon saw rides");
  });

  // ---------- exact meeting point ----------
  await check("PRIVACY the exact meeting point is visible only to the host and confirmed riders", async () => {
    const id = await mkRide(U.H);
    await q(U.H, "insert into ride_private (ride_id, meeting_point, host_note) values ($1,'Secret petrol pump, Sector 9','bring cash')", [id]);
    ok((await q(U.H, "select meeting_point from ride_private where ride_id=$1", [id])).length === 1, "host cannot read it");
    ok((await q(U.P, "select 1 from ride_private where ride_id=$1", [id])).length === 0, "stranger read the meeting point");
    ok((await join(U.P, id)) === "requested", "should be pending approval");
    ok((await q(U.P, "select 1 from ride_private where ride_id=$1", [id])).length === 0, "a pending request read the meeting point");
    await decide(U.H, id, U.P, true);
    ok((await q(U.P, "select meeting_point from ride_private where ride_id=$1", [id])).length === 1, "confirmed rider cannot read it");
    ok((await q(U.Q, "select 1 from ride_private where ride_id=$1", [id])).length === 0, "another stranger read it");
    ok((await q(U.P, "update ride_private set meeting_point='x' where ride_id=$1", [id])) && true, "");
    const t = await priv(() => c.query("select meeting_point from ride_private where ride_id=$1", [id]));
    ok(t.rows[0].meeting_point === "Secret petrol pump, Sector 9", "a rider changed the host's meeting point");
  });
  await check("PRIVACY only the host can write the meeting point", async () => {
    const id = await mkRide(U.H);
    await expectErr(U.P, "insert into ride_private (ride_id, meeting_point) values ($1,'x')", [id], "row-level security");
  });

  // ---------- the participants table is read-only from browsers ----------
  await check("PARTICIPANTS browsers cannot write participant rows directly", async () => {
    const id = await mkRide(U.H);
    await expectErr(U.P, "insert into ride_participants (ride_id, user_id, status) values ($1,$2,'going')", [id, U.P], "row-level security");
    await join(U.P, id);
    const upd = await q(U.P, "update ride_participants set status='going' where ride_id=$1 and user_id=$2", [id, U.P]);
    ok((await status(id, U.P)) === "requested", "a rider approved themselves");
    ok((await q(U.P, "delete from ride_participants where ride_id=$1 and user_id=$2", [id, U.P])) && (await status(id, U.P)) === "requested", "a rider deleted their own row directly");
    void upd;
  });
  await check("PARTICIPANTS who can see whom", async () => {
    const id = await mkRide(U.H);
    await join(U.P, id); await join(U.Q, id);
    await decide(U.H, id, U.P, true);
    ok((await q(U.H, "select 1 from ride_participants where ride_id=$1", [id])).length === 3, "host should see everyone");
    ok((await q(U.P, "select user_id from ride_participants where ride_id=$1", [id])).length === 2, "confirmed rider should see confirmed riders only (host + self)");
    const qRows = await q(U.Q, "select user_id from ride_participants where ride_id=$1", [id]);
    ok(qRows.length === 1 && qRows[0].user_id === U.Q, "a pending rider must see only their own row");
    ok((await q(U.X, "select 1 from ride_participants where ride_id=$1", [id])).length === 0, "a stranger saw participants");
  });
  await check("PARTICIPANTS strangers get a headcount, never names", async () => {
    const id = await mkRide(U.H);
    ok((await one(U.P, "select ride_going_count($1) n", [id])).n === 1, "headcount wrong");
    const inv = await mkRide(U.H, { visibility: "invite_only" });
    ok((await one(U.P, "select ride_going_count($1) n", [inv])).n === null, "headcount leaked for a ride the viewer cannot see");
  });

  // ---------- joining ----------
  await check("JOIN approval flow: request, approve, decline, idempotent", async () => {
    const id = await mkRide(U.H);
    ok((await join(U.P, id)) === "requested", "request");
    ok((await join(U.P, id)) === "requested", "repeat request must be harmless");
    ok((await decide(U.H, id, U.P, true)) === "going", "approve");
    ok((await join(U.P, id)) === "going", "repeat join after approval");
    ok((await join(U.Q, id)) === "requested", "second rider");
    ok((await decide(U.H, id, U.Q, false)) === "declined", "decline");
    ok((await join(U.Q, id)) === "requested", "a declined rider may ask again");
  });
  await check("JOIN only the host can approve; only pending requests can be decided", async () => {
    const id = await mkRide(U.H);
    await join(U.P, id);
    await expectErr(U.Q, "select ride_decide($1,$2,true)", [id, U.P], "not_found");
    await expectErr(U.P, "select ride_decide($1,$2,true)", [id, U.P], "not_found");   // cannot approve yourself
    await expectErr(U.H, "select ride_decide($1,$2,true)", [id, U.Q], "not_found");   // Q never asked
  });
  await check("JOIN a ride without approval confirms immediately", async () => {
    const id = await mkRide(U.H, { approval: false });
    ok((await join(U.P, id)) === "going", "should be going at once");
  });
  await check("JOIN needs a rider profile; the host cannot join their own ride", async () => {
    const id = await mkRide(U.H);
    await expectErr(U.X, "select ride_request_join($1)", [id], "profile_required");
    await expectErr(U.H, "select ride_request_join($1)", [id], "is_host");
  });
  await check("JOIN past rides are closed", async () => {
    const id = (await priv(() => c.query("insert into rides (host_id, title, area_label, starts_on) values ($1,'Old ride','Delhi','2020-01-01') returning id", [U.H]))).rows[0].id;
    await expectErr(U.P, "select ride_request_join($1)", [id], "ride_closed");
  });
  await check("JOIN cancelled rides cannot be joined, reopened, or have their host changed", async () => {
    const id = await mkRide(U.H);
    await q(U.H, "update rides set status='cancelled' where id=$1", [id]);
    await expectErr(U.P, "select ride_request_join($1)", [id], "not_found");
    await expectErr(U.H, "update rides set status='open' where id=$1", [id], "ride_cancelled");
    const id2 = await mkRide(U.H);
    ok((await errOf(U.H, "update rides set host_id=$2 where id=$1", [id2, U.P])) !== null, "host was changed");
  });

  // ---------- capacity ----------
  await check("CAPACITY a full ride cannot take more riders (approval, instant join, and the database guard)", async () => {
    const id = await mkRide(U.H, { max: 2 });
    await join(U.P, id); await decide(U.H, id, U.P, true);               // host + P = 2 of 2
    await join(U.Q, id);
    await expectErr(U.H, "select ride_decide($1,$2,true)", [id, U.Q], "ride_full");
    const open = await mkRide(U.H, { max: 2, approval: false });
    await join(U.P, open);
    await expectErr(U.Q, "select ride_request_join($1)", [open], "ride_full");
    await c.query("savepoint g"); await c.query("reset role");
    const m = await errOf(U.H, "select 1", []); void m;
    let guard = null;
    try { await c.query("insert into ride_participants (ride_id, user_id, status) values ($1,$2,'going')", [open, U.Q]); }
    catch (e) { guard = e.message; await c.query("rollback to savepoint g"); }
    await c.query("set local role authenticated");
    ok(guard && guard.includes("ride_full"), "the database guard did not stop an over-capacity insert: " + guard);
  });
  await check("CAPACITY a host cannot shrink a ride below the riders already confirmed", async () => {
    const id = await mkRide(U.H, { approval: false, max: 5 });
    await join(U.P, id); await join(U.Q, id);                          // 3 going
    await expectErr(U.H, "update rides set max_riders=2 where id=$1", [id], "capacity_below_going");
    await q(U.H, "update rides set max_riders=3 where id=$1", [id]);
  });

  // ---------- invitations ----------
  await check("INVITE invite-only: request fails, host invites by handle, rider accepts or declines", async () => {
    const id = await mkRide(U.H, { visibility: "invite_only" });
    await expectErr(U.P, "select ride_request_join($1)", [id], "not_found");
    ok((await invite(U.H, id, "rider_p")) === "invited", "invite");
    ok((await invite(U.H, id, "RIDER_P")) === "invited", "handles are case-insensitive and re-inviting is harmless");
    ok((await q(U.P, "select id from rides where id=$1", [id])).length === 1, "an invited rider must be able to see the ride");
    ok((await respond(U.P, id, true)) === "going", "accept");
    const id2 = await mkRide(U.H, { visibility: "invite_only" });
    await invite(U.H, id2, "rider_q");
    ok((await respond(U.Q, id2, false)) === "declined", "decline");
    ok((await q(U.Q, "select id from rides where id=$1", [id2])).length === 1, "a rider who declined can still see the ride");
  });
  await check("INVITE only public profiles can be invited; unknown, private and blocked all look the same", async () => {
    const id = await mkRide(U.H);
    for (const h of ["rider_z", "nobody_here"]) await expectErr(U.H, "select ride_invite($1,$2)", [id, h], "not_found");
    await q(U.P, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.P, U.H]);
    await expectErr(U.H, "select ride_invite($1,$2)", [id, "rider_p"], "not_found");
  });
  await check("INVITE only the host can invite; you cannot invite yourself or someone already going", async () => {
    const id = await mkRide(U.H, { approval: false });
    await expectErr(U.P, "select ride_invite($1,'rider_q')", [id], "not_found");
    await expectErr(U.H, "select ride_invite($1,'host_h')", [id], "is_host");
    await join(U.P, id);
    await expectErr(U.H, "select ride_invite($1,'rider_p')", [id], "already_going");
  });
  await check("INVITE inviting someone who already asked to join approves them", async () => {
    const id = await mkRide(U.H);
    await join(U.P, id);
    ok((await invite(U.H, id, "rider_p")) === "going", "should approve the pending request");
  });
  await check("INVITE you can only answer an invitation you actually have", async () => {
    const id = await mkRide(U.H, { visibility: "invite_only" });
    await expectErr(U.P, "select ride_respond($1,true)", [id], "not_found");
    const pub = await mkRide(U.H);
    await join(U.P, pub);
    await expectErr(U.P, "select ride_respond($1,true)", [pub], "not_found");   // a request is not an invitation
  });

  // ---------- leaving and removal ----------
  await check("LEAVE a rider can leave; a host cannot (they cancel); leaving frees a place", async () => {
    const id = await mkRide(U.H, { approval: false, max: 2 });
    await join(U.P, id);
    await expectErr(U.Q, "select ride_request_join($1)", [id], "ride_full");
    ok((await one(U.P, "select ride_leave($1) s", [id])).s === "left", "leave");
    ok((await join(U.Q, id)) === "going", "the freed place should be available");
    await expectErr(U.H, "select ride_leave($1)", [id], "is_host");
  });
  await check("REMOVE the host can remove riders; removed riders cannot rejoin themselves; the host cannot be removed", async () => {
    const id = await mkRide(U.H, { approval: false });
    await join(U.P, id);
    await expectErr(U.Q, "select ride_remove($1,$2)", [id, U.P], "not_found");
    ok((await one(U.H, "select ride_remove($1,$2) s", [id, U.P])).s === "removed", "remove");
    await expectErr(U.P, "select ride_request_join($1)", [id], "removed");
    await expectErr(U.H, "select ride_remove($1,$2)", [id, U.H], "is_host");
    ok((await invite(U.H, id, "rider_p")) === "invited", "the host may invite a removed rider back");
  });

  // ---------- blocks ----------
  await check("BLOCKS a blocked rider cannot see, join or be invited to the blocker's rides (and vice versa)", async () => {
    const id = await mkRide(U.H, { approval: false });
    await q(U.H, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.H, U.P]);
    ok((await q(U.P, "select 1 from rides where id=$1", [id])).length === 0, "blocked rider still sees the ride");
    await expectErr(U.P, "select ride_request_join($1)", [id], "not_found");
    await expectErr(U.H, "select ride_invite($1,'rider_p')", [id], "not_found");
    const id2 = await mkRide(U.Q, { approval: false });
    await q(U.Q, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.Q, U.H]);
    ok((await q(U.H, "select 1 from rides where id=$1", [id2])).length === 0, "the blocker's ride must be hidden from the blocked rider");
  });
  await check("BLOCKS a block hides a ride even from someone who had already joined", async () => {
    const id = await mkRide(U.H, { approval: false });
    await join(U.P, id);
    await q(U.H, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.H, U.P]);
    ok((await q(U.P, "select 1 from rides where id=$1", [id])).length === 0, "blocked rider still sees a ride they had joined");
  });

  // ---------- reports ----------
  await check("REPORT a visible ride can be reported once; own rides, hidden rides and bad input cannot", async () => {
    const id = await mkRide(U.H), hidden = await mkRide(U.H, { visibility: "invite_only" });
    await q(U.P, "insert into ride_reports (reporter_id, ride_id, reason, note) values ($1,$2,'unsafe','speed run')", [U.P, id]);
    await expectErr(U.P, "insert into ride_reports (reporter_id, ride_id, reason) values ($1,$2,'spam')", [U.P, id], "uq_ride_reports_open");
    await expectErr(U.H, "insert into ride_reports (reporter_id, ride_id, reason) values ($1,$2,'spam')", [U.H, id], "row-level security");
    await expectErr(U.P, "insert into ride_reports (reporter_id, ride_id, reason) values ($1,$2,'spam')", [U.P, hidden], "row-level security");
    await expectErr(U.Q, "insert into ride_reports (reporter_id, ride_id, reason) values ($1,$2,'boring')", [U.Q, id], "ride_reports_reason_check");
    await expectErr(U.Q, "insert into ride_reports (reporter_id, ride_id, reason, status) values ($1,$2,'spam','dismissed')", [U.Q, id], "row-level security");
    ok((await q(U.H, "select 1 from ride_reports")).length === 0, "the host must not see who reported them");
  });

  // ---------- function access ----------
  await check("ACCESS anonymous callers cannot run any participation function", async () => {
    const id = await mkRide(U.H);
    await c.query("reset role"); await c.query("set local role anon");
    const bad = [];
    for (const sql of ["select ride_request_join($1)", "select ride_going_count($1)", "select ride_visible($1, null)"]) {
      await c.query("savepoint an");
      try { await c.query(sql, [id]); bad.push(sql); } catch { await c.query("rollback to savepoint an"); }
    }
    await c.query("reset role"); await c.query("set local role authenticated");
    ok(bad.length === 0, "anon could run: " + bad.join(", "));
  });
} catch (e) {
  crashed = e;
} finally {
  await c.query("rollback").catch(() => {});
  const left = (await c.query("select count(*)::int n from auth.users where id = any($1)", [Object.values(U)])).rows[0].n;
  await c.end();
  console.table(results);
  const failed = results.filter((r) => !r.pass).length;
  if (crashed) console.error("TEST CRASHED:", crashed.message);
  if (results.length === 0) console.error("NO CHECKS RAN");
  console.log(crashed || !results.length ? "FAILED" : failed ? `${failed} FAILED` : "ALL PASSED", `| checks: ${results.length} | leftover users: ${left}`);
  process.exit(crashed || !results.length || failed || left ? 1 : 0);
}
