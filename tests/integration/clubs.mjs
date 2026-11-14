// Focused security and integrity test for riding clubs and memberships.
// Runs in a transaction that is ALWAYS rolled back. Usage: npm run test:db:clubs  (needs DATABASE_URL)
import pg from "pg";
import { loadEnv, pgConfig } from "../helpers/env.mjs";

const cfg = pgConfig(loadEnv());
if (!cfg) { console.log("SKIPPED: set DATABASE_URL in .env.local"); process.exit(0); }

const c = new pg.Client(cfg);
await c.connect();
const U = { O: "b1111111-1111-1111-1111-111111111111", A: "b2222222-2222-2222-2222-222222222222", M: "b3333333-3333-3333-3333-333333333333",
            N: "b4444444-4444-4444-4444-444444444444", X: "b5555555-5555-5555-5555-555555555555", Z: "b6666666-6666-6666-6666-666666666666" };
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

async function mkClub(owner, o = {}) {
  const k = { name: "Delhi Riders", visibility: "public", policy: "approval", limit: 10, ...o };
  const slug = o.slug ?? `club_${++seq}_${Math.random().toString(36).slice(2, 6)}`;
  const row = await one(owner, "insert into clubs (owner_id, slug, name, visibility, join_policy, member_limit) values ($1,$2,$3,$4,$5,$6) returning id", [owner, slug, k.name, k.visibility, k.policy, k.limit]);
  return row.id;
}
const join = (u, club) => one(u, "select club_request_join($1) s", [club]).then((x) => x.s);
const decide = (u, club, target, yes) => one(u, "select club_decide($1,$2,$3) s", [club, target, yes]).then((x) => x.s);
const invite = (u, club, handle) => one(u, "select club_invite($1,$2) s", [club, handle]).then((x) => x.s);
const respond = (u, club, yes) => one(u, "select club_respond($1,$2) s", [club, yes]).then((x) => x.s);
const setRole = (u, club, target, role) => one(u, "select club_set_role($1,$2,$3) s", [club, target, role]).then((x) => x.s);
const status = (club, uid) => priv(() => c.query("select status from club_members where club_id=$1 and user_id=$2", [club, uid])).then((r) => r.rows[0]?.status);
const roleOf = (club, uid) => priv(() => c.query("select role from club_members where club_id=$1 and user_id=$2", [club, uid])).then((r) => r.rows[0]?.role);
const activeUser = async (club, uid) => { await priv(() => c.query("insert into club_members (club_id, user_id, role, status) values ($1,$2,'member','active')", [club, uid])); };

try {
  await c.query("begin");
  for (const id of Object.values(U)) await c.query("insert into auth.users (id, aud, role, email) values ($1,'authenticated','authenticated',$2)", [id, id.slice(0, 8) + "@test.invalid"]);
  for (const [k, h, pub] of [["O", "owner_o", true], ["A", "admin_a", true], ["M", "member_m", true], ["N", "other_n", true], ["Z", "private_z", false]]) {
    await c.query("insert into rider_profiles (user_id, handle, display_name, is_public) values ($1,$2,$3,$4)", [U[k], h, h, pub]);
  }
  await c.query("set local role authenticated");

  // ---------- creating ----------
  await check("CLUB owner is automatically an active member with the owner role", async () => {
    const id = await mkClub(U.O);
    ok((await status(id, U.O)) === "active" && (await roleOf(id, U.O)) === "owner", "owner row missing");
  });
  await check("CLUB a user without a rider profile cannot start a club; nobody can start one in another's name", async () => {
    await expectErr(U.X, "insert into clubs (owner_id, slug, name) values ($1,'no_profile_club','Some club')", [U.X], "row-level security");
    await expectErr(U.M, "insert into clubs (owner_id, slug, name) values ($1,'forged_club','Some club')", [U.O], "row-level security");
  });
  await check("CLUB invalid clubs are rejected by the database", async () => {
    const bad = [
      ["short name", "insert into clubs (owner_id, slug, name) values ($1,'valid_slug','ab')"],
      ["slug too short", "insert into clubs (owner_id, slug, name) values ($1,'ab','Good name')"],
      ["slug with capitals", "insert into clubs (owner_id, slug, name) values ($1,'Bad_Slug','Good name')"],
      ["slug with a dash", "insert into clubs (owner_id, slug, name) values ($1,'bad-slug','Good name')"],
      ["digits-only slug", "insert into clubs (owner_id, slug, name) values ($1,'123456','Good name')"],
      ["reserved slug 'new'", "insert into clubs (owner_id, slug, name) values ($1,'new','Good name')"],
      ["limit of 1", "insert into clubs (owner_id, slug, name, member_limit) values ($1,'valid_slug','Good name',1)"],
      ["limit of 1001", "insert into clubs (owner_id, slug, name, member_limit) values ($1,'valid_slug','Good name',1001)"],
      ["unknown visibility", "insert into clubs (owner_id, slug, name, visibility) values ($1,'valid_slug','Good name','secret')"],
      ["unknown join policy", "insert into clubs (owner_id, slug, name, join_policy) values ($1,'valid_slug','Good name','free')"],
      ["private club that is not invite-only", "insert into clubs (owner_id, slug, name, visibility, join_policy) values ($1,'valid_slug','Good name','private','open')"],
      ["500+ character description", "insert into clubs (owner_id, slug, name, description) values ($1,'valid_slug','Good name',repeat('x',501))"],
    ];
    for (const [label, sql] of bad) ok((await errOf(U.O, sql, [U.O])) !== null, `accepted: ${label}`);
  });
  await check("CLUB slugs are unique", async () => {
    await mkClub(U.O, { slug: "same_slug" });
    await expectErr(U.M, "insert into clubs (owner_id, slug, name) values ($1,'same_slug','Another club')", [U.M], "clubs_slug_key");
  });

  // ---------- who can see a club ----------
  await check("VISIBILITY public clubs are visible to signed-in riders; private ones only to members and invitees", async () => {
    const pub = await mkClub(U.O), prv = await mkClub(U.O, { visibility: "private", policy: "invite" });
    ok((await q(U.N, "select 1 from clubs where id=$1", [pub])).length === 1, "public club hidden");
    ok((await q(U.N, "select 1 from clubs where id=$1", [prv])).length === 0, "private club leaked");
    await invite(U.O, prv, "other_n");
    ok((await q(U.N, "select 1 from clubs where id=$1", [prv])).length === 1, "an invitee must be able to see the club");
    ok((await q(U.M, "select 1 from clubs where id=$1", [prv])).length === 0, "another stranger saw the private club");
  });
  await check("VISIBILITY an archived club leaves public view but members still see it; it cannot be reopened", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await join(U.M, id);
    await q(U.O, "update clubs set status='archived' where id=$1", [id]);
    ok((await q(U.N, "select 1 from clubs where id=$1", [id])).length === 0, "archived club visible to a stranger");
    ok((await q(U.M, "select 1 from clubs where id=$1", [id])).length === 1, "members lost their archived club");
    await expectErr(U.O, "update clubs set status='active' where id=$1", [id], "club_archived");
    await expectErr(U.N, "select club_request_join($1)", [id], "not_found");
  });
  await check("VISIBILITY anonymous database access sees no clubs", async () => {
    const id = await mkClub(U.O);
    await c.query("reset role"); await c.query("set local role anon");
    let n = 0; try { n = (await c.query("select count(*)::int n from clubs where id=$1", [id])).rows[0].n; } catch { n = 0; }
    await c.query("reset role"); await c.query("set local role authenticated");
    ok(n === 0, "anon saw clubs");
  });
  await check("VISIBILITY only the owner can change club settings; the owner cannot be changed", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await join(U.A, id); await setRole(U.O, id, U.A, "admin");
    ok((await q(U.A, "update clubs set name='Hijacked' where id=$1", [id])).length === 0 && true, "");
    const t = await priv(() => c.query("select name from clubs where id=$1", [id]));
    ok(t.rows[0].name === "Delhi Riders", "an admin changed the club settings");
    ok((await errOf(U.O, "update clubs set owner_id=$2 where id=$1", [id, U.M])) !== null, "club ownership was reassigned");
  });

  // ---------- the members table ----------
  await check("MEMBERS browsers cannot write membership rows directly", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await expectErr(U.M, "insert into club_members (club_id, user_id, role, status) values ($1,$2,'member','active')", [id, U.M], "row-level security");
    await join(U.M, id);
    await q(U.M, "update club_members set role='admin' where club_id=$1 and user_id=$2", [id, U.M]);
    ok((await roleOf(id, U.M)) === "member", "a member made themselves admin");
    await q(U.M, "delete from club_members where club_id=$1 and user_id=$2", [id, U.M]);
    ok((await status(id, U.M)) === "active", "a member deleted their own row directly");
  });
  await check("MEMBERS who can see whom", async () => {
    const id = await mkClub(U.O);
    await join(U.A, id); await join(U.M, id);
    await decide(U.O, id, U.A, true);                                 // A active; M still requested
    ok((await q(U.O, "select 1 from club_members where club_id=$1", [id])).length === 3, "owner should see everyone");
    ok((await q(U.A, "select user_id from club_members where club_id=$1", [id])).length === 2, "an active member sees active members only");
    const mRows = await q(U.M, "select user_id from club_members where club_id=$1", [id]);
    ok(mRows.length === 1 && mRows[0].user_id === U.M, "an applicant must see only their own row");
    ok((await q(U.N, "select 1 from club_members where club_id=$1", [id])).length === 0, "a stranger saw members");
  });
  await check("MEMBERS strangers get a count, never names; hidden clubs give nothing", async () => {
    const pub = await mkClub(U.O), prv = await mkClub(U.O, { visibility: "private", policy: "invite" });
    ok((await one(U.N, "select club_member_count($1) n", [pub])).n === 1, "member count wrong");
    ok((await one(U.N, "select club_member_count($1) n", [prv])).n === null, "member count leaked for a hidden club");
  });

  // ---------- joining ----------
  await check("JOIN open clubs admit immediately; approval clubs queue the request; invite-only public clubs refuse", async () => {
    const open = await mkClub(U.O, { policy: "open" }), appr = await mkClub(U.O), inv = await mkClub(U.O, { policy: "invite" });
    ok((await join(U.M, open)) === "active", "open club");
    ok((await join(U.M, open)) === "active", "repeat join is harmless");
    ok((await join(U.M, appr)) === "requested", "approval club");
    ok((await join(U.M, appr)) === "requested", "repeat request is harmless");
    await expectErr(U.M, "select club_request_join($1)", [inv], "invite_only");
  });
  await check("JOIN private clubs cannot be requested; owners, profile-less users and removed riders are refused", async () => {
    const prv = await mkClub(U.O, { visibility: "private", policy: "invite" }), pub = await mkClub(U.O, { policy: "open" });
    await expectErr(U.N, "select club_request_join($1)", [prv], "not_found");
    await expectErr(U.O, "select club_request_join($1)", [pub], "is_owner");
    await expectErr(U.X, "select club_request_join($1)", [pub], "profile_required");
    await join(U.M, pub);
    await one(U.O, "select club_remove($1,$2)", [pub, U.M]);
    await expectErr(U.M, "select club_request_join($1)", [pub], "removed");
  });
  await check("JOIN an archived club cannot approve requests, accept invitations or send invitations", async () => {
    const id = await mkClub(U.O);
    await join(U.M, id);                                   // M has a pending request
    await invite(U.O, id, "other_n");                      // N has a pending invitation
    await q(U.O, "update clubs set status='archived' where id=$1", [id]);
    await expectErr(U.O, "select club_decide($1,$2,true)", [id, U.M], "club_archived");
    await expectErr(U.N, "select club_respond($1,true)", [id], "club_archived");
    await expectErr(U.O, "select club_invite($1,'admin_a')", [id], "club_archived");
    ok((await status(id, U.M)) === "requested" && (await status(id, U.N)) === "invited", "an archived club changed membership rows");
  });
  await check("JOIN approval: only managers decide, only pending requests can be decided, declined riders may ask again", async () => {
    const id = await mkClub(U.O);
    await join(U.M, id);
    await expectErr(U.N, "select club_decide($1,$2,true)", [id, U.M], "not_found");
    await expectErr(U.M, "select club_decide($1,$2,true)", [id, U.M], "not_found");
    await expectErr(U.O, "select club_decide($1,$2,true)", [id, U.N], "not_found");
    ok((await decide(U.O, id, U.M, false)) === "declined", "decline");
    ok((await join(U.M, id)) === "requested", "ask again after being declined");
    ok((await decide(U.O, id, U.M, true)) === "active", "approve");
  });

  // ---------- capacity ----------
  await check("CAPACITY a full club takes no more members (approval, open join, and the database guard)", async () => {
    const id = await mkClub(U.O, { limit: 2, policy: "approval" });
    await join(U.M, id); await decide(U.O, id, U.M, true);               // owner + M = 2 of 2
    await join(U.N, id);
    await expectErr(U.O, "select club_decide($1,$2,true)", [id, U.N], "club_full");
    const open = await mkClub(U.O, { limit: 2, policy: "open" });
    await join(U.M, open);
    await expectErr(U.N, "select club_request_join($1)", [open], "club_full");
    await c.query("savepoint g"); await c.query("reset role");
    let guard = null;
    try { await c.query("insert into club_members (club_id, user_id, role, status) values ($1,$2,'member','active')", [open, U.N]); }
    catch (e) { guard = e.message; await c.query("rollback to savepoint g"); }
    await c.query("set local role authenticated");
    ok(guard && guard.includes("club_full"), "the database guard did not stop an over-capacity insert: " + guard);
  });
  await check("CAPACITY an owner cannot shrink a club below its active members", async () => {
    const id = await mkClub(U.O, { policy: "open", limit: 5 });
    await join(U.M, id); await join(U.N, id);
    await expectErr(U.O, "update clubs set member_limit=2 where id=$1", [id], "limit_below_members");
    await q(U.O, "update clubs set member_limit=3 where id=$1", [id]);
  });

  // ---------- invitations ----------
  await check("INVITE managers invite public profiles by handle; invitees accept or decline", async () => {
    const id = await mkClub(U.O, { visibility: "private", policy: "invite" });
    ok((await invite(U.O, id, "member_m")) === "invited", "invite");
    ok((await invite(U.O, id, "MEMBER_M")) === "invited", "handles are case-insensitive; re-invite is harmless");
    ok((await respond(U.M, id, true)) === "active", "accept");
    ok((await invite(U.O, id, "other_n")) === "invited", "second invite");
    ok((await respond(U.N, id, false)) === "declined", "decline");
    ok((await q(U.N, "select 1 from clubs where id=$1", [id])).length === 1, "a declined invitee can still see the club");
  });
  await check("INVITE private, unknown and blocked profiles all look the same", async () => {
    const id = await mkClub(U.O);
    for (const h of ["private_z", "nobody_here"]) await expectErr(U.O, "select club_invite($1,$2)", [id, h], "not_found");
    await q(U.M, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.M, U.O]);
    await expectErr(U.O, "select club_invite($1,'member_m')", [id], "not_found");
  });
  await check("INVITE regular members cannot invite; already-active members and the club's own state are checked", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await join(U.M, id);
    await expectErr(U.M, "select club_invite($1,'other_n')", [id], "not_found");
    await expectErr(U.O, "select club_invite($1,'member_m')", [id], "already_member");
  });
  await check("INVITE inviting someone who already asked to join approves them", async () => {
    const id = await mkClub(U.O);
    await join(U.M, id);
    ok((await invite(U.O, id, "member_m")) === "active", "should approve the pending request");
  });
  await check("INVITE you can only answer an invitation you actually have", async () => {
    const id = await mkClub(U.O);
    await expectErr(U.M, "select club_respond($1,true)", [id], "not_found");
    await join(U.M, id);
    await expectErr(U.M, "select club_respond($1,true)", [id], "not_found");     // a request is not an invitation
  });

  // ---------- leaving, removing, roles ----------
  await check("LEAVE members can leave; the owner cannot (they archive); leaving frees a place", async () => {
    const id = await mkClub(U.O, { policy: "open", limit: 2 });
    await join(U.M, id);
    await expectErr(U.N, "select club_request_join($1)", [id], "club_full");
    ok((await one(U.M, "select club_leave($1) s", [id])).s === "left", "leave");
    ok((await join(U.N, id)) === "active", "the freed place should be available");
    await expectErr(U.O, "select club_leave($1)", [id], "is_owner");
  });
  await check("REMOVE managers remove members; admins cannot remove admins; only the owner removes admins; nobody removes the owner", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await join(U.A, id); await join(U.M, id); await join(U.N, id);
    await setRole(U.O, id, U.A, "admin"); await setRole(U.O, id, U.N, "admin");
    await expectErr(U.M, "select club_remove($1,$2)", [id, U.N], "not_found");              // a regular member cannot
    ok((await one(U.A, "select club_remove($1,$2) s", [id, U.M])).s === "removed", "an admin removes a member");
    await expectErr(U.A, "select club_remove($1,$2)", [id, U.N], "not_allowed");            // admin vs admin
    ok((await one(U.O, "select club_remove($1,$2) s", [id, U.N])).s === "removed", "the owner removes an admin");
    await expectErr(U.A, "select club_remove($1,$2)", [id, U.O], "is_owner");
    await expectErr(U.O, "select club_remove($1,$2)", [id, U.O], "is_owner");
    ok((await invite(U.O, id, "member_m")) === "invited", "a removed member can be invited back");
  });
  await check("ROLES only the owner assigns roles, only to active members, never the owner role", async () => {
    const id = await mkClub(U.O);
    await join(U.A, id); await join(U.M, id);
    await decide(U.O, id, U.A, true);
    await expectErr(U.A, "select club_set_role($1,$2,'admin')", [id, U.A], "not_found");     // no self-promotion
    await expectErr(U.O, "select club_set_role($1,$2,'admin')", [id, U.M], "not_found");     // M is only an applicant
    await expectErr(U.O, "select club_set_role($1,$2,'owner')", [id, U.A], "not_found");
    await expectErr(U.O, "select club_set_role($1,$2,'admin')", [id, U.O], "is_owner");
    ok((await setRole(U.O, id, U.A, "admin")) === "admin", "promote");
    ok((await roleOf(id, U.A)) === "admin", "role not stored");
    await join(U.N, id);
    ok((await decide(U.A, id, U.N, true)) === "active", "an admin can approve requests");
    ok((await setRole(U.O, id, U.A, "member")) === "member", "demote");
    await expectErr(U.A, "select club_decide($1,$2,true)", [id, U.M], "not_found");           // demoted: no longer a manager
  });
  await check("OWNER the owner row is protected even from direct privileged writes", async () => {
    const id = await mkClub(U.O);
    await c.query("reset role");
    for (const sql of ["update club_members set status='left' where club_id=$1 and role='owner'", "update club_members set role='member' where club_id=$1 and role='owner'"]) {
      await c.query("savepoint ow");
      let msg = null;
      try { await c.query(sql, [id]); } catch (e) { msg = e.message; await c.query("rollback to savepoint ow"); }
      ok(msg !== null, "owner row was changed: " + sql);
    }
    await c.query("set local role authenticated");
  });

  // ---------- blocks ----------
  await check("BLOCKS a blocked rider cannot see, join or be invited to the blocker's club (and vice versa)", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await q(U.O, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.O, U.M]);
    ok((await q(U.M, "select 1 from clubs where id=$1", [id])).length === 0, "blocked rider still sees the club");
    await expectErr(U.M, "select club_request_join($1)", [id], "not_found");
    await expectErr(U.O, "select club_invite($1,'member_m')", [id], "not_found");
    const id2 = await mkClub(U.N, { policy: "open" });
    await q(U.N, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.N, U.O]);
    ok((await q(U.O, "select 1 from clubs where id=$1", [id2])).length === 0, "a club by someone who blocked you must be hidden");
  });
  await check("BLOCKS a block hides a club even from a rider who had already joined", async () => {
    const id = await mkClub(U.O, { policy: "open" });
    await join(U.M, id);
    await q(U.O, "insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [U.O, U.M]);
    ok((await q(U.M, "select 1 from clubs where id=$1", [id])).length === 0, "blocked member still sees the club");
  });

  // ---------- reports ----------
  await check("REPORT a visible club can be reported once; the owner, hidden clubs and bad input cannot", async () => {
    const id = await mkClub(U.O), hidden = await mkClub(U.O, { visibility: "private", policy: "invite" });
    await q(U.N, "insert into club_reports (reporter_id, club_id, reason, note) values ($1,$2,'spam','selling things')", [U.N, id]);
    await expectErr(U.N, "insert into club_reports (reporter_id, club_id, reason) values ($1,$2,'spam')", [U.N, id], "uq_club_reports_open");
    await expectErr(U.O, "insert into club_reports (reporter_id, club_id, reason) values ($1,$2,'spam')", [U.O, id], "row-level security");
    await expectErr(U.N, "insert into club_reports (reporter_id, club_id, reason) values ($1,$2,'spam')", [U.N, hidden], "row-level security");
    await expectErr(U.M, "insert into club_reports (reporter_id, club_id, reason) values ($1,$2,'boring')", [U.M, id], "club_reports_reason_check");
    await expectErr(U.M, "insert into club_reports (reporter_id, club_id, reason, status) values ($1,$2,'spam','dismissed')", [U.M, id], "row-level security");
    ok((await q(U.O, "select 1 from club_reports")).length === 0, "the owner must not see who reported the club");
  });

  // ---------- function access ----------
  await check("ACCESS anonymous callers cannot run any membership function", async () => {
    const id = await mkClub(U.O);
    await c.query("reset role"); await c.query("set local role anon");
    const bad = [];
    for (const sql of ["select club_request_join($1)", "select club_member_count($1)", "select club_visible($1, null)", "select club_leave($1)"]) {
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
