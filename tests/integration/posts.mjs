// Focused security and integrity test for community posts and ride stories.
// Runs in a transaction that is ALWAYS rolled back. Usage: npm run test:db:posts  (needs DATABASE_URL)
import pg from "pg";
import { loadEnv, pgConfig } from "../helpers/env.mjs";

const cfg = pgConfig(loadEnv());
if (!cfg) { console.log("SKIPPED: set DATABASE_URL in .env.local"); process.exit(0); }

const c = new pg.Client(cfg);
await c.connect();
const U = { A: "c1111111-1111-1111-1111-111111111111", B: "c2222222-2222-2222-2222-222222222222", M: "c3333333-3333-3333-3333-333333333333",
            G: "c4444444-4444-4444-4444-444444444444", X: "c5555555-5555-5555-5555-555555555555" };
const results = [];
let crashed = null;
let seq = 0;

const as = (uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
const priv = async (fn) => { await c.query("reset role"); try { return await fn(); } finally { await c.query("set local role authenticated"); } };
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

const post = (u, body, club = null, trip = null, dest = false) => one(u, "select post_create($1,$2,$3,$4) id", [body, club, trip, dest]).then((r) => r.id);
const visibleTo = async (u, id) => (await q(u, "select id from posts where id=$1", [id])).length === 1;
async function mkClub(owner, o = {}) {
  const slug = `pc_${++seq}_${Math.random().toString(36).slice(2, 6)}`;
  return (await one(owner, "insert into clubs (owner_id, slug, name, visibility, join_policy) values ($1,$2,'Post club',$3,$4) returning id", [owner, slug, o.visibility ?? "public", o.policy ?? "open"])).id;
}
const addMember = (club, uid, role = "member") => priv(() => c.query("insert into club_members (club_id, user_id, role, status) values ($1,$2,$3,'active')", [club, uid, role]));
async function mkTrip(owner, status = "completed") {
  return priv(async () => {
    const bike = (await c.query("insert into bikes (user_id, display_name) values ($1,'Bike') returning id", [owner])).rows[0].id;
    const completed = status === "completed";
    return (await c.query(
      `insert into trips (user_id, bike_id, title, origin_label, destination_label, status, actual_distance_km, completed_at)
       values ($1,$2,'Delhi to Leh','12 Secret Lane, Delhi','Leh',$3, $4, $5) returning id`,
      [owner, bike, status, completed ? 1234.56 : null, completed ? new Date().toISOString() : null])).rows[0].id;
  });
}

try {
  await c.query("begin");
  for (const id of Object.values(U)) await c.query("insert into auth.users (id, aud, role, email) values ($1,'authenticated','authenticated',$2)", [id, id.slice(0, 8) + "@test.invalid"]);
  for (const [k, h] of [["A", "author_a"], ["B", "reader_b"], ["M", "member_m"], ["G", "guest_g"]]) {
    await c.query("insert into rider_profiles (user_id, handle, display_name, is_public) values ($1,$2,$2,false)", [U[k], h]);
  }
  await c.query("set local role authenticated");

  // ---------- creating ----------
  await check("POST a rider with a profile can post to the community; others see it", async () => {
    const id = await post(U.A, "Road to Manali is clear");
    ok(await visibleTo(U.A, id) && await visibleTo(U.B, id), "not visible");
  });
  await check("POST nobody can insert or edit a post directly", async () => {
    await expectErr(U.A, "insert into posts (author_id, body) values ($1,'direct')", [U.A], "row-level security");
    const id = await post(U.A, "mine");
    const upd = await q(U.A, "update posts set body='edited' where id=$1 returning id", [id]);
    ok(upd.length === 0, "author could edit");
    ok((await one(U.A, "select body from posts where id=$1", [id])).body === "mine", "body changed");
  });
  await check("POST a user without a rider profile cannot post", async () => {
    await expectErr(U.X, "select post_create('hello', null, null, false)", [], "profile_required");
  });
  await check("POST empty, whitespace-only and over-long bodies are rejected", async () => {
    await expectErr(U.A, "select post_create('', null, null, false)", [], "body_required");
    await expectErr(U.A, "select post_create(E'   \n\t ', null, null, false)", [], "body_required");
    await expectErr(U.A, "select post_create(repeat('x',1001), null, null, false)", [], "body_too_long");
    ok(await post(U.A, "x".repeat(1000)), "1000 chars should pass");
  });
  await check("POST at most 20 posts in 24 hours, per rider", async () => {
    for (let i = 0; i < 20; i++) await post(U.A, `post ${i}`);
    await expectErr(U.A, "select post_create('one too many', null, null, false)", [], "post_rate_limit");
    ok(await post(U.B, "a different rider is not limited"), "other rider blocked");
  });
  await check("POST anonymous users cannot call post_create and see no posts", async () => {
    await post(U.A, "visible to riders only");
    await c.query("reset role"); await c.query("savepoint anon_sp");
    await c.query("set local role anon");
    let callDenied = false, seen = -1;
    await c.query("savepoint a1");
    try { await c.query("select post_create('x', null, null, false)"); } catch { callDenied = true; }
    await c.query("rollback to savepoint a1");
    try { seen = (await c.query("select id from posts")).rows.length; } catch { seen = 0; }
    await c.query("rollback to savepoint anon_sp");
    await c.query("set local role authenticated");
    ok(callDenied, "anon could call post_create");
    ok(seen === 0, `anon could read ${seen} posts`);
  });

  // ---------- visibility ----------
  await check("VIS a block hides posts in both directions", async () => {
    const a = await post(U.A, "from A"), b = await post(U.B, "from B");
    await priv(() => c.query("insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.B, U.A]));
    ok(!(await visibleTo(U.B, a)) && !(await visibleTo(U.A, b)), "block did not hide posts");
    ok(await visibleTo(U.M, a), "unblocked rider lost the post");
  });
  await check("VIS club posts are visible to active members only", async () => {
    const club = await mkClub(U.A);
    await addMember(club, U.M);
    const id = await post(U.A, "club only", club);
    ok(await visibleTo(U.M, id) && await visibleTo(U.A, id), "members cannot see");
    ok(!(await visibleTo(U.B, id)), "outsider can see a club post");
    await priv(() => c.query("insert into club_members (club_id, user_id, role, status) values ($1,$2,'member','requested')", [club, U.B]));
    ok(!(await visibleTo(U.B, id)), "applicant can see a club post");
    await priv(() => c.query("update club_members set status='removed' where club_id=$1 and user_id=$2", [club, U.M]));
    ok(!(await visibleTo(U.M, id)), "removed member still sees the post");
  });
  await check("VIS posts in a private club are not visible to outsiders", async () => {
    const club = await mkClub(U.A, { visibility: "private", policy: "invite" });
    const id = await post(U.A, "secret club", club);
    ok(!(await visibleTo(U.B, id)), "leaked");
  });
  await check("VIS posting to a club needs active membership; archiving blocks posting and hides posts from members", async () => {
    const club = await mkClub(U.A);
    await expectErr(U.B, "select post_create('hi', $1, null, false)", [club], "not_found");
    await addMember(club, U.M);
    const id = await post(U.M, "member post", club);
    ok(await visibleTo(U.A, id), "owner cannot see member post");
    await priv(() => c.query("update clubs set status='archived' where id=$1", [club]));
    await expectErr(U.M, "select post_create('late', $1, null, false)", [club], "club_archived");
    ok(!(await visibleTo(U.B, id)), "outsider sees archived club post");
    ok(!(await q(U.A, "select id from posts where club_id=$1 and author_id<>$2", [club, U.A])).length, "owner sees member post in archived club");
  });

  // ---------- ride stories ----------
  await check("STORY a completed trip becomes a snapshot of title, distance and date only", async () => {
    const trip = await mkTrip(U.A);
    const id = await post(U.A, "What a ride", null, trip, false);
    const r = await one(U.B, "select kind, trip_title, trip_distance_km::float d, trip_completed_on, trip_destination from posts where id=$1", [id]);
    ok(r.kind === "ride_story" && r.trip_title === "Delhi to Leh" && Math.abs(r.d - 1234.6) < 0.01 && r.trip_completed_on, "snapshot wrong");
    ok(r.trip_destination === null, "destination shared without consent");
    const cols = (await q(U.B, "select column_name from information_schema.columns where table_name='posts'")).map((x) => x.column_name);
    ok(!cols.some((n) => /origin|trip_id|expense|cost|route|bike|lat|lon/.test(n)), "posts has a private-looking column: " + cols.join());
  });
  await check("STORY the destination is copied only when asked; the origin never is", async () => {
    const trip = await mkTrip(U.A);
    const id = await post(U.A, "", null, trip, true);
    const rows = await q(U.B, "select * from posts where id=$1", [id]);
    ok(rows[0].trip_destination === "Leh", "destination missing");
    ok(!JSON.stringify(rows).includes("Secret Lane"), "origin leaked");
  });
  await check("STORY the snapshot survives later changes to, and deletion of, the trip", async () => {
    const trip = await mkTrip(U.A);
    const id = await post(U.A, "kept", null, trip);
    await priv(() => c.query("update trips set title='Renamed' where id=$1", [trip]));
    await priv(() => c.query("delete from trips where id=$1", [trip]));
    ok((await one(U.B, "select trip_title from posts where id=$1", [id])).trip_title === "Delhi to Leh", "snapshot changed");
  });
  await check("STORY only your own, completed trip can be shared", async () => {
    const other = await mkTrip(U.B), draft = await mkTrip(U.A, "draft");
    await expectErr(U.A, "select post_create('stolen', null, $1, false)", [other], "not_found");
    await expectErr(U.A, "select post_create('draft', null, $1, false)", [draft], "trip_not_completed");
    await expectErr(U.A, "select post_create('nope', null, gen_random_uuid(), false)", [], "not_found");
  });
  await check("STORY a story needs no text; the row shape is enforced by the database", async () => {
    const trip = await mkTrip(U.A);
    ok(await post(U.A, "", null, trip), "silent story rejected");
    await priv(async () => {
      await c.query("savepoint s1");
      let bad = false; try { await c.query("insert into posts (author_id, kind, body, trip_title) values ($1,'post','x','sneaky')", [U.A]); } catch { bad = true; }
      await c.query("rollback to savepoint s1");
      ok(bad, "constraint missing for a plain post carrying trip fields");
      await c.query("savepoint s2");
      let bad2 = false; try { await c.query("insert into posts (author_id, kind, body) values ($1,'ride_story','x')", [U.A]); } catch { bad2 = true; }
      await c.query("rollback to savepoint s2");
      ok(bad2, "constraint missing for a story with no trip data");
    });
  });

  // ---------- deleting ----------
  await check("DEL the author can delete; other riders cannot", async () => {
    const id = await post(U.A, "to delete");
    ok((await q(U.B, "delete from posts where id=$1 returning id", [id])).length === 0, "outsider deleted");
    ok((await q(U.A, "delete from posts where id=$1 returning id", [id])).length === 1, "author could not delete");
  });
  await check("DEL club owner and admins can remove club posts; plain members cannot", async () => {
    const club = await mkClub(U.A);
    await addMember(club, U.M, "admin"); await addMember(club, U.B); await addMember(club, U.G);
    const p1 = await post(U.B, "member post", club), p2 = await post(U.B, "another", club);
    ok((await q(U.G, "delete from posts where id=$1 returning id", [p1])).length === 0, "plain member deleted");
    ok((await q(U.M, "delete from posts where id=$1 returning id", [p1])).length === 1, "admin could not delete");
    ok((await q(U.A, "delete from posts where id=$1 returning id", [p2])).length === 1, "owner could not delete");
  });
  await check("DEL a club admin cannot remove a community-wide post", async () => {
    const club = await mkClub(U.A);
    const id = await post(U.B, "community post");
    ok((await q(U.A, "delete from posts where id=$1 returning id", [id])).length === 0, "club owner removed a community post");
    ok(club && (await visibleTo(U.B, id)), "post vanished");
  });
  await check("DEL deleting a post removes its reports; deleting a user removes their posts", async () => {
    const id = await post(U.A, "gone soon");
    await q(U.B, "insert into post_reports (reporter_id, post_id, reason) values ($1,$2,'spam')", [U.B, id]);
    await q(U.A, "delete from posts where id=$1", [id]);
    ok((await priv(() => c.query("select count(*)::int n from post_reports where post_id=$1", [id]))).rows[0].n === 0, "report left behind");
    const p2 = await post(U.A, "user gone");
    await priv(() => c.query("delete from auth.users where id=$1", [U.A]));
    ok((await priv(() => c.query("select count(*)::int n from posts where id=$1", [p2]))).rows[0].n === 0, "post outlived user");
  });

  // ---------- reporting ----------
  await check("REPORT a rider can report a visible post once; duplicates are refused; reports are private", async () => {
    const id = await post(U.A, "report me");
    await q(U.B, "insert into post_reports (reporter_id, post_id, reason, note) values ($1,$2,'spam','x')", [U.B, id]);
    await expectErr(U.B, "insert into post_reports (reporter_id, post_id, reason) values ($1,$2,'spam')", [U.B, id], "duplicate key");
    ok((await q(U.M, "select id from post_reports")).length === 0, "another rider can read reports");
    ok((await q(U.A, "select id from post_reports")).length === 0, "the author can read reports about them");
    ok((await q(U.B, "select id from post_reports")).length === 1, "reporter cannot read own report");
  });
  await check("REPORT cannot report your own post, a post you cannot see, or with a forged reporter, status or reason", async () => {
    const id = await post(U.A, "mine");
    await expectErr(U.A, "insert into post_reports (reporter_id, post_id, reason) values ($1,$2,'spam')", [U.A, id], "row-level security");
    await expectErr(U.B, "insert into post_reports (reporter_id, post_id, reason) values ($1,$2,'spam')", [U.M, id], "row-level security");
    await expectErr(U.B, "insert into post_reports (reporter_id, post_id, reason, status) values ($1,$2,'spam','actioned')", [U.B, id], "row-level security");
    const club = await mkClub(U.A); const hidden = await post(U.A, "club", club);
    await expectErr(U.B, "insert into post_reports (reporter_id, post_id, reason) values ($1,$2,'spam')", [U.B, hidden], "row-level security");
    await expectErr(U.B, "insert into post_reports (reporter_id, post_id, reason) values ($1,$2,'bogus')", [U.B, id], "check");
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
