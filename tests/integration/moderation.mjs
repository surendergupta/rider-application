// Focused security and integrity test for the moderator queue, takedown, account restriction and audit log.
// Runs in a transaction that is ALWAYS rolled back. Usage: npm run test:db:moderation  (needs DATABASE_URL)
import pg from "pg";
import { loadEnv, pgConfig } from "../helpers/env.mjs";

const cfg = pgConfig(loadEnv());
if (!cfg) { console.log("SKIPPED: set DATABASE_URL in .env.local"); process.exit(0); }

const c = new pg.Client(cfg);
await c.connect();
// A author, B reporter, R second reporter, M moderator, N second moderator
const U = { A: "d1111111-1111-1111-1111-111111111111", B: "d2222222-2222-2222-2222-222222222222", R: "d3333333-3333-3333-3333-333333333333",
            M: "d4444444-4444-4444-4444-444444444444", N: "d5555555-5555-5555-5555-555555555555" };
const results = [];
let crashed = null;

const as = (uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
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
  await c.query("rollback to savepoint chk");
  results.push({ test: name, pass, detail: detail.slice(0, 90) });
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectErr = async (uid, sql, params, code) => {
  const m = await errOf(uid, sql, params);
  ok(m !== null, `expected "${code}" but it succeeded`);
  ok(m.includes(code), `expected "${code}" but got "${m.slice(0, 80)}"`);
};
const asOwner = async (fn) => { await c.query("reset role"); try { return await fn(); } finally { await c.query("set local role authenticated"); } };

const post = (u, body) => one(u, "select post_create($1,null,null,false) id", [body]).then((r) => r.id);
const report = async (u, table, col, id, reason = "spam") => (await one(u, `insert into ${table} (reporter_id, ${col}, reason) values ($1,$2,$3) returning id`, [u, id, reason])).id;
const postReport = (u, id, reason) => report(u, "post_reports", "post_id", id, reason);
const act = (u, kind, rid, action, reason = "because", days = null) => one(u, "select mod_act($1,$2,$3,$4,$5) r", [kind, rid, action, reason, days]).then((r) => r.r);
const audit = (u) => q(u, "select action, target_kind, target_id, reason, actor_id from moderation_audit order by created_at, id");
const mkRide = async (host) => (await one(host, "insert into rides (host_id, title, area_label, starts_on) values ($1,'Sunday ride','Pune', current_date + 5) returning id", [host])).id;
const mkClub = async (owner) => (await one(owner, "insert into clubs (owner_id, slug, name) values ($1,$2,'Club name') returning id", [owner, "mc_" + Math.random().toString(36).slice(2, 8)])).id;

try {
  await c.query("begin");
  for (const id of Object.values(U)) await c.query("insert into auth.users (id, aud, role, email) values ($1,'authenticated','authenticated',$2)", [id, id.slice(0, 8) + "@test.invalid"]);
  for (const [k, h] of [["A", "author_a"], ["B", "reader_b"], ["R", "reader_r"], ["M", "mod_m"], ["N", "mod_n"]]) {
    await c.query("insert into rider_profiles (user_id, handle, display_name, is_public) values ($1,$2,$2,true)", [U[k], h]);
  }
  await c.query("insert into moderators (user_id) values ($1), ($2)", [U.M, U.N]);
  await c.query("set local role authenticated");

  // ---------- access ----------
  await check("ACCESS only moderators can read the queue, act, list or lift restrictions", async () => {
    const id = await post(U.A, "spammy"); const rid = await postReport(U.B, id);
    await expectErr(U.B, "select * from mod_queue('open')", [], "not_moderator");
    await expectErr(U.A, "select * from mod_queue('open')", [], "not_moderator");
    await expectErr(U.B, "select mod_act('post',$1,'dismiss','no way')", [rid], "not_moderator");
    await expectErr(U.B, "select * from mod_restrictions()", [], "not_moderator");
    await expectErr(U.B, "select mod_lift_restriction($1,'x y z')", [U.A], "not_moderator");
    ok((await q(U.M, "select * from mod_queue('open')")).length === 1, "moderator cannot see the queue");
    ok((await one(U.B, "select i_am_moderator() m")).m === false && (await one(U.M, "select i_am_moderator() m")).m === true, "i_am_moderator wrong");
  });
  await check("ACCESS riders cannot read or write moderator tables, or call the internal helpers", async () => {
    ok((await q(U.B, "select 1 from moderators")).length === 0, "riders can read moderators");
    await expectErr(U.B, "insert into moderators (user_id) values ($1)", [U.B], "row-level security");
    await expectErr(U.B, "insert into moderation_audit (action) values ('dismiss')", [], "row-level security");
    await expectErr(U.B, "insert into account_restrictions (user_id, reason) values ($1,'self')", [U.B], "row-level security");
    await expectErr(U.B, "select is_moderator($1)", [U.M], "permission denied");
    await expectErr(U.B, "select is_restricted($1)", [U.A], "permission denied");
    await expectErr(U.B, "select mod_target_owner('post', gen_random_uuid())", [], "permission denied");
    ok((await q(U.B, "select 1 from moderation_audit")).length === 0, "riders can read the audit log");
  });
  await check("ACCESS anonymous users cannot call any moderator function", async () => {
    await c.query("reset role"); await c.query("savepoint anon_sp"); await c.query("set local role anon");
    let denied = 0;
    for (const sql of ["select mod_queue('open')", "select mod_act('post', gen_random_uuid(), 'dismiss', 'xxx')", "select i_am_moderator()", "select mod_restrictions()"]) {
      await c.query("savepoint a1");
      try { await c.query(sql); } catch { denied++; }
      await c.query("rollback to savepoint a1");
    }
    await c.query("rollback to savepoint anon_sp"); await c.query("set local role authenticated");
    ok(denied === 4, `only ${denied}/4 denied`);
  });
  await check("ACCESS a rider cannot change a report's status or edit a post directly", async () => {
    const id = await post(U.A, "mine"); const rid = await postReport(U.B, id);
    ok((await q(U.B, "update post_reports set status='dismissed' where id=$1 returning id", [rid])).length === 0, "reporter changed status");
    ok((await q(U.A, "update posts set status='active' where id=$1 returning id", [id])).length === 0, "author edited a post");
  });

  // ---------- the queue ----------
  await check("QUEUE groups several reports about one target into one row with a count and the reasons", async () => {
    const id = await post(U.A, "bad post");
    await postReport(U.B, id, "spam"); await postReport(U.R, id, "harassment");
    const rows = await q(U.M, "select * from mod_queue('open')");
    ok(rows.length === 1, `rows ${rows.length}`);
    ok(rows[0].report_count === 2 && rows[0].reasons.join() === "harassment,spam" && rows[0].kind === "post" && rows[0].summary === "bad post", "row wrong");
  });
  await check("QUEUE covers posts, rides, clubs and profiles", async () => {
    const p = await post(U.A, "p"); const r = await mkRide(U.A); const cl = await mkClub(U.A);
    await postReport(U.B, p);
    await report(U.B, "ride_reports", "ride_id", r, "unsafe"); await report(U.B, "club_reports", "club_id", cl, "other");
    await report(U.B, "profile_reports", "profile_user_id", U.A, "impersonation");
    const rows = await q(U.M, "select kind, summary from mod_queue('open')");
    ok(rows.map((x) => x.kind).sort().join() === "club,post,profile,ride", rows.map((x) => x.kind).join());
    ok(rows.find((x) => x.kind === "profile").summary.includes("@author_a"), "profile summary");
  });
  await check("QUEUE rejects an unknown scope", async () => {
    await expectErr(U.M, "select * from mod_queue('everything')", [], "bad_scope");
  });

  // ---------- acting ----------
  await check("ACT start review keeps the report in the queue as under_review and writes an audit event", async () => {
    const id = await post(U.A, "x"); const rid = await postReport(U.B, id);
    ok((await act(U.M, "post", rid, "start_review", "")) === "under_review", "state");
    ok((await one(U.M, "select status from mod_queue('open')")).status === "under_review", "status");
    const a = await audit(U.M); ok(a.length === 1 && a[0].action === "start_review" && a[0].actor_id === U.M, "audit");
  });
  await check("ACT dismiss closes every report about the target, leaves the content up, and records the reason", async () => {
    const id = await post(U.A, "fine post"); const r1 = await postReport(U.B, id); await postReport(U.R, id);
    ok((await act(U.M, "post", r1, "dismiss", "not a violation")) === "dismissed", "state");
    ok((await q(U.M, "select * from mod_queue('open')")).length === 0, "still in the open queue");
    ok((await one(U.M, "select report_count from mod_queue('closed')")).report_count === 2, "closed count");
    ok((await q(U.B, "select id from posts where id=$1", [id])).length === 1, "post was hidden");
    const a = await audit(U.M); ok(a[0].reason === "not a violation" && a[0].action === "dismiss", "audit");
  });
  await check("ACT removing a post hides it from riders and closes the reports", async () => {
    const id = await post(U.A, "bad"); const rid = await postReport(U.B, id);
    await act(U.M, "post", rid, "remove", "scam link");
    ok((await q(U.B, "select id from posts where id=$1", [id])).length === 0, "still visible to others");
    ok((await one(U.B, "select status from post_reports where id=$1", [rid])).status === "actioned", "report not actioned");
    ok((await one(U.A, "select status from posts where id=$1", [id])).status === "removed", "author should see removed state");
  });
  await check("ACT removing a ride cancels it; a club is archived; a profile becomes private and undiscoverable", async () => {
    const r = await mkRide(U.A); const cl = await mkClub(U.A);
    await asOwner(() => c.query("update rider_profiles set discoverable = true where user_id=$1", [U.A]));
    const rr = await report(U.B, "ride_reports", "ride_id", r); const cr = await report(U.B, "club_reports", "club_id", cl); const pr = await report(U.B, "profile_reports", "profile_user_id", U.A);
    await act(U.M, "ride", rr, "remove"); await act(U.M, "club", cr, "remove"); await act(U.M, "profile", pr, "remove");
    ok((await one(U.A, "select status from rides where id=$1", [r])).status === "cancelled", "ride");
    ok((await one(U.A, "select status from clubs where id=$1", [cl])).status === "archived", "club");
    const p = await one(U.A, "select is_public, discoverable from rider_profiles where user_id=$1", [U.A]);
    ok(p.is_public === false && p.discoverable === false, "profile");
    ok((await audit(U.M)).length === 3, "three audit events");
  });
  await check("ACT a reason of 3 to 300 characters is required to dismiss, remove or restrict", async () => {
    const id = await post(U.A, "x"); const rid = await postReport(U.B, id);
    for (const action of ["dismiss", "remove", "restrict"]) {
      await expectErr(U.M, "select mod_act('post',$1,$2,'  ')", [rid, action], "reason_required");
      await expectErr(U.M, "select mod_act('post',$1,$2,'ab')", [rid, action], "reason_required");
    }
    await expectErr(U.M, "select mod_act('post',$1,'remove',repeat('x',301))", [rid], "reason_required");
    ok((await audit(U.M)).length === 0, "failed actions must not write audit events");
  });
  await check("ACT unknown kind, action, report id and a closed report are refused", async () => {
    const id = await post(U.A, "x"); const rid = await postReport(U.B, id);
    await expectErr(U.M, "select mod_act('bogus',$1,'dismiss','reason')", [rid], "bad_kind");
    await expectErr(U.M, "select mod_act('post',$1,'ban','reason')", [rid], "bad_action");
    await expectErr(U.M, "select mod_act('post',gen_random_uuid(),'dismiss','reason')", [], "not_found");
    await expectErr(U.M, "select mod_act('ride',$1,'dismiss','reason')", [rid], "not_found");     // right id, wrong kind
    await act(U.M, "post", rid, "dismiss", "fine");
    await expectErr(U.N, "select mod_act('post',$1,'remove','late')", [rid], "already_closed");
  });
  await check("ACT a moderator cannot act on a report about their own content, or restrict another moderator", async () => {
    const own = await post(U.M, "my own post"); const r1 = await postReport(U.B, own);
    await expectErr(U.M, "select mod_act('post',$1,'remove','mine')", [r1], "self_target");
    await expectErr(U.M, "select mod_act('post',$1,'dismiss','mine')", [r1], "self_target");
    await act(U.N, "post", r1, "dismiss", "second moderator decides");
    const other = await post(U.N, "other mod post"); const r2 = await postReport(U.B, other);
    await expectErr(U.M, "select mod_act('post',$1,'restrict','nope')", [r2], "cannot_restrict");
    ok((await one(U.N, "select status from posts where id=$1", [other])).status === "active", "post removed despite refusal");
  });
  await check("ACT a refused action changes nothing", async () => {
    const id = await post(U.A, "keep me"); const rid = await postReport(U.B, id);
    await expectErr(U.M, "select mod_act('post',$1,'restrict','okay reason',400)", [rid], "bad_days");
    ok((await one(U.A, "select status from posts where id=$1", [id])).status === "active", "post removed");
    ok((await q(U.M, "select * from mod_queue('open')")).length === 1, "report closed");
    ok((await audit(U.M)).length === 0, "audit written");
  });

  // ---------- restriction ----------
  await check("RESTRICT removes the content, blocks new posts, rides and clubs, and the rider can see why", async () => {
    const id = await post(U.A, "scam"); const rid = await postReport(U.B, id);
    await act(U.M, "post", rid, "restrict", "repeated scams", 7);
    ok((await one(U.A, "select status from posts where id=$1", [id])).status === "removed", "not removed");
    await expectErr(U.A, "select post_create('again', null, null, false)", [], "account_restricted");
    await expectErr(U.A, "insert into rides (host_id, title, area_label, starts_on) values ($1,'Ride','Pune', current_date + 3)", [U.A], "account_restricted");
    await expectErr(U.A, "insert into clubs (owner_id, slug, name) values ($1,'blocked_club','Blocked')", [U.A], "account_restricted");
    const mine = await one(U.A, "select reason, restricted_until from account_restrictions where user_id=$1", [U.A]);
    ok(mine.reason === "repeated scams" && mine.restricted_until, "own restriction not visible");
    ok((await q(U.B, "select 1 from account_restrictions")).length === 0, "others can see restrictions");
    ok(await post(U.B, "other riders are unaffected"), "other rider blocked");
  });
  await check("RESTRICT an indefinite restriction stays until lifted; a lifted or expired one no longer blocks", async () => {
    const id = await post(U.A, "x"); const rid = await postReport(U.B, id);
    await act(U.M, "post", rid, "restrict", "serious abuse");                                 // no days = until lifted
    ok((await q(U.M, "select * from mod_restrictions()")).length === 1, "not listed");
    await expectErr(U.A, "select post_create('a', null, null, false)", [], "account_restricted");
    await expectErr(U.B, "select mod_lift_restriction($1,'x y z')", [U.A], "not_moderator");
    await expectErr(U.M, "select mod_lift_restriction($1,'')", [U.A], "reason_required");
    await q(U.N, "select mod_lift_restriction($1,'appeal accepted')", [U.A]);
    ok(await post(U.A, "back again"), "still blocked after lifting");
    await expectErr(U.M, "select mod_lift_restriction($1,'again please')", [U.A], "not_found");
    const a = await audit(U.M); ok(a.some((x) => x.action === "lift_restriction" && x.target_id === U.A && x.actor_id === U.N), "lift not audited");
    await asOwner(() => c.query("insert into account_restrictions (user_id, reason, restricted_until) values ($1,'past',now() - interval '1 day')", [U.B]));
    ok(await post(U.B, "expired restriction does not block"), "expired restriction blocked");
    ok((await q(U.M, "select * from mod_restrictions()")).length === 0, "expired still listed");
  });

  // ---------- audit log ----------
  await check("AUDIT the log cannot be edited or deleted, even by a moderator", async () => {
    const id = await post(U.A, "x"); const rid = await postReport(U.B, id);
    await act(U.M, "post", rid, "dismiss", "fine");
    ok((await q(U.M, "update moderation_audit set reason='edited' returning id")).length === 0, "moderator edited the log");
    ok((await q(U.M, "delete from moderation_audit returning id")).length === 0, "moderator deleted from the log");
    ok((await audit(U.M)).length === 1 && (await audit(U.N)).length === 1, "moderators see the log");
  });
  await check("AUDIT removing the moderator account keeps the audit event", async () => {
    const id = await post(U.A, "x"); const rid = await postReport(U.B, id);
    await act(U.M, "post", rid, "remove", "gone");
    await asOwner(() => c.query("delete from auth.users where id=$1", [U.M]));
    const a = await audit(U.N); ok(a.length === 1 && a[0].actor_id === null, "audit event lost");
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
