// DB integration test: RLS isolation, composite ownership, estimate RPC, status machine, idempotency.
// Runs in a transaction that is ALWAYS rolled back, so it leaves nothing behind.
// Usage: npm run test:db   (needs DATABASE_URL in .env.local)
import pg from "pg";
import { loadEnv, pgConfig } from "../helpers/env.mjs";

const cfg = pgConfig(loadEnv());
if (!cfg) { console.log("SKIPPED: set DATABASE_URL in .env.local"); process.exit(0); }

const c = new pg.Client(cfg);
await c.connect();
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const results = [];
let setupError = null;

async function check(name, fn, expectFail = false) {
  await c.query("savepoint s");
  let pass, detail = "";
  try { detail = (await fn()) ?? ""; pass = !expectFail; }
  catch (e) { pass = expectFail; detail = e.message; }
  await c.query("rollback to savepoint s");
  results.push({ test: name, pass, detail: String(detail).slice(0, 60) });
}
const as = (uid) => c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);

try {
  await c.query("begin");
  await c.query("insert into auth.users (id, aud, role, email) values ($1,'authenticated','authenticated','a@test.invalid'), ($2,'authenticated','authenticated','b@test.invalid')", [A, B]);
  await c.query("set local role authenticated");
  await as(A);
  const bike = (await c.query("insert into bikes (user_id, display_name) values ($1,'A bike') returning id", [A])).rows[0].id;
  const trip = (await c.query("insert into trips (user_id, bike_id, title, origin_label, destination_label) values ($1,$2,'t','x','y') returning id", [A, bike])).rows[0].id;
  const rid = "33333333-3333-3333-3333-333333333333";
  await c.query("insert into expenses (user_id, trip_id, category, amount_paise, client_request_id) values ($1,$2,'food',5000,$3)", [A, trip, rid]);

  await c.query("insert into trip_checklist_items (user_id, trip_id, category, label) values ($1,$2,'documents','Driving licence')", [A, trip]);
  await c.query("insert into pro_interest (user_id, plan) values ($1,'pro_yearly')", [A]);
  await c.query("insert into waitlist (user_id, topic) values ($1,'marketplace')", [A]);
  await c.query("insert into trip_stops (user_id, trip_id, day_number, place, stop_type, leg_km) values ($1,$2,1,'Gurugram','fuel',30)", [A, trip]);
  await check("stop with invalid type rejected", () =>
    c.query("insert into trip_stops (user_id, trip_id, day_number, place, stop_type) values ($1,$2,1,'X','teleport')", [A, trip]), true);
  await check("stop on day 0 or day 61 rejected", async () => {
    for (const d of [0, 61]) {
      await c.query("savepoint dd");
      try { await c.query("insert into trip_stops (user_id, trip_id, day_number, place) values ($1,$2,$3,'X')", [A, trip, d]); throw new Error("accepted day " + d); }
      catch (e) { if (e.message.startsWith("accepted")) throw e; await c.query("rollback to savepoint dd"); }
    }
  });
  await check("stop with negative or absurd distance rejected", async () => {
    for (const km of [-1, 3001]) {
      await c.query("savepoint kk");
      try { await c.query("insert into trip_stops (user_id, trip_id, day_number, place, leg_km) values ($1,$2,1,'X',$3)", [A, trip, km]); throw new Error("accepted " + km); }
      catch (e) { if (e.message.startsWith("accepted")) throw e; await c.query("rollback to savepoint kk"); }
    }
  });
  await check("blank stop place rejected", () =>
    c.query("insert into trip_stops (user_id, trip_id, day_number, place) values ($1,$2,1,'   ')", [A, trip]), true);
  await c.query("insert into vehicle_documents (user_id, bike_id, doc_type, expires_on) values ($1,$2,'insurance','2027-01-01')", [A, bike]);
  await check("duplicate document type per bike rejected", () =>
    c.query("insert into vehicle_documents (user_id, bike_id, doc_type, expires_on) values ($1,$2,'insurance','2028-01-01')", [A, bike]), true);
  await check("invalid document type rejected", () =>
    c.query("insert into vehicle_documents (user_id, bike_id, doc_type, expires_on) values ($1,$2,'licence','2028-01-01')", [A, bike]), true);
  await check("community waitlist topic accepted, unknown topic rejected", async () => {
    await c.query("insert into waitlist (user_id, topic) values ($1,'community')", [A]);
    await c.query("savepoint t");
    try { await c.query("insert into waitlist (user_id, topic) values ($1,'spam')", [A]); throw new Error("accepted bad topic"); }
    catch (e) { if (e.message === "accepted bad topic") throw e; await c.query("rollback to savepoint t"); }
  });
  await check("pro_interest accepts V2 plans, rejects old/unknown ones", async () => {
    await c.query("update pro_interest set plan='club_pro' where user_id=$1", [A]);
    await c.query("savepoint p");
    try { await c.query("update pro_interest set plan='monthly' where user_id=$1", [A]); throw new Error("accepted old plan"); }
    catch (e) { if (e.message === "accepted old plan") throw e; await c.query("rollback to savepoint p"); }
  });
  await check("invalid checklist status rejected", () =>
    c.query("update trip_checklist_items set status='lost' where trip_id=$1", [trip]), true);
  await check("old checklist category rejected", () =>
    c.query("insert into trip_checklist_items (user_id, trip_id, category, label) values ($1,$2,'gear','x')", [A, trip]), true);
  await check("checklist item defaults to status needed", async () => {
    const r = (await c.query("select status from trip_checklist_items where trip_id=$1 and label='Driving licence'", [trip])).rows[0];
    if (r.status !== "needed") throw new Error(r.status);
  });
  await check("invalid trip profile (terrain) rejected", () =>
    c.query("update trips set terrain='ocean' where id=$1", [trip]), true);
  await check("duplicate waitlist row rejected", () =>
    c.query("insert into waitlist (user_id, topic) values ($1,'marketplace')", [A]), true);
  await check("duplicate checklist label on the same trip rejected", () =>
    c.query("insert into trip_checklist_items (user_id, trip_id, category, label) values ($1,$2,'documents','Driving licence')", [A, trip]), true);
  await check("estimate RPC returns rev 1 with total 154500", async () => {
    const r = (await c.query("select * from create_trip_estimate($1,270,30,10500,9,94500,0,50000,0,10000,'{}')", [trip])).rows[0];
    if (r.revision !== 1 || String(r.total_paise) !== "154500") throw new Error(JSON.stringify(r));
  });
  await check("direct INSERT into trip_estimates denied", () =>
    c.query("insert into trip_estimates (user_id, trip_id, revision, distance_km, mileage_kmpl, fuel_price_paise_per_litre, fuel_litres, fuel_paise) values ($1,$2,9,1,1,1,1,1)", [A, trip]), true);
  await check("invalid status draft->completed denied", () => c.query("update trips set status='completed' where id=$1", [trip]), true);
  await check("draft->active sets started_at", async () => {
    const r = await c.query("update trips set status='active' where id=$1 returning started_at", [trip]);
    if (!r.rows[0].started_at) throw new Error("no started_at");
  });
  await check("duplicate client_request_id rejected", () =>
    c.query("insert into expenses (user_id, trip_id, category, amount_paise, client_request_id) values ($1,$2,'food',5000,$3)", [A, trip, rid]), true);
  await check("non-fuel expense with fuel fields rejected", () =>
    c.query("insert into expenses (user_id, trip_id, category, amount_paise, fuel_litres, client_request_id) values ($1,$2,'food',100,2,gen_random_uuid())", [A, trip]), true);

  await as(B);
  await check("B sees none of A's rows", async () => {
    const r = (await c.query("select (select count(*) from bikes) b,(select count(*) from trips) t,(select count(*) from expenses) e,(select count(*) from trip_estimates) s")).rows[0];
    if (Object.values(r).some((v) => v !== "0")) throw new Error(JSON.stringify(r));
  });
  await check("B sees none of A's checklist or Pro interest", async () => {
    const r = (await c.query("select (select count(*) from trip_checklist_items) c, (select count(*) from pro_interest) p, (select count(*) from waitlist) w, (select count(*) from vehicle_documents) d, (select count(*) from trip_stops) st")).rows[0];
    if (r.c !== "0" || r.p !== "0" || r.w !== "0" || r.d !== "0" || r.st !== "0") throw new Error(JSON.stringify(r));
  });
  await check("B cannot add a checklist item to A's trip", () =>
    c.query("insert into trip_checklist_items (user_id, trip_id, category, label) values ($1,$2,'safety','Helmet')", [B, trip]), true);
  await check("B cannot read or change A's Pro interest", async () => {
    if ((await c.query("update pro_interest set plan='monthly' where user_id=$1", [A])).rowCount !== 0) throw new Error("updated");
  });
  await check("B cannot add or change documents on A's bike", async () => {
    if ((await c.query("update vehicle_documents set expires_on='2030-01-01' where bike_id=$1", [bike])).rowCount !== 0) throw new Error("updated");
    await c.query("savepoint d");
    try { await c.query("insert into vehicle_documents (user_id, bike_id, doc_type, expires_on) values ($1,$2,'puc','2030-01-01')", [B, bike]); throw new Error("inserted"); }
    catch (e) { if (e.message === "inserted") throw e; await c.query("rollback to savepoint d"); }
  });
  await check("B cannot add, change or delete stops on A's trip", async () => {
    if ((await c.query("update trip_stops set place='hacked' where trip_id=$1", [trip])).rowCount !== 0) throw new Error("updated");
    if ((await c.query("delete from trip_stops where trip_id=$1", [trip])).rowCount !== 0) throw new Error("deleted");
    await c.query("savepoint ts");
    try { await c.query("insert into trip_stops (user_id, trip_id, day_number, place) values ($1,$2,1,'Intruder')", [B, trip]); throw new Error("inserted"); }
    catch (e) { if (e.message === "inserted") throw e; await c.query("rollback to savepoint ts"); }
  });
  await check("B cannot update A's bike", async () => {
    if ((await c.query("update bikes set display_name='x' where id=$1", [bike])).rowCount !== 0) throw new Error("updated");
  });
  await check("B cannot delete A's expense", async () => {
    if ((await c.query("delete from expenses where trip_id=$1", [trip])).rowCount !== 0) throw new Error("deleted");
  });
  await check("B cannot estimate on A's trip", () => c.query("select * from create_trip_estimate($1,1,1,1,1,1,0,0,0,0,'{}')", [trip]), true);
  await check("B cannot create trip on A's bike", () =>
    c.query("insert into trips (user_id, bike_id, title, origin_label, destination_label) values ($1,$2,'t','x','y')", [B, bike]), true);
  await check("B cannot insert a row owned by A", () => c.query("insert into bikes (user_id, display_name) values ($1,'forged')", [A]), true);

  // ================= rider profiles (migration 0007) =================
  await c.query("reset role");
  await c.query("set local role authenticated"); await as(A);
  await c.query("insert into rider_profiles (user_id, handle, display_name) values ($1,'rider_a','Rider A')", [A]);
  await as(B);
  await c.query("insert into rider_profiles (user_id, handle, display_name) values ($1,'rider_b','Rider B')", [B]);
  await as(A);

  await check("PROFILE new profile is private and shows nothing by default", async () => {
    const r = (await c.query("select is_public, show_motorcycle, show_stats, handle_changed_at from rider_profiles where user_id=$1", [A])).rows[0];
    if (r.is_public || r.show_motorcycle || r.show_stats || r.handle_changed_at) throw new Error(JSON.stringify(r));
  });

  // --- constraints: each of these must be rejected by the database itself ---
  await as(B);
  const badInsert = (label, sql, params = []) =>
    check(`PROFILE rejects ${label}`, async () => {
      await c.query("savepoint pb"); // profile rows for B already exist, so test against a throwaway user via update-free insert
      try { await c.query(sql, params); throw new Error("accepted"); }
      catch (e) { if (e.message === "accepted") throw e; await c.query("rollback to savepoint pb"); }
    });
  await c.query("delete from rider_profiles where user_id=$1", [B]);
  await badInsert("a reserved handle", "insert into rider_profiles (user_id, handle, display_name) values ($1,'admin','B')", [B]);
  await badInsert("an upper-case handle", "insert into rider_profiles (user_id, handle, display_name) values ($1,'Rider_B','B')", [B]);
  await badInsert("a too-short handle", "insert into rider_profiles (user_id, handle, display_name) values ($1,'ab','B')", [B]);
  await badInsert("a handle with a dot", "insert into rider_profiles (user_id, handle, display_name) values ($1,'rider.b','B')", [B]);
  await badInsert("a digits-only handle", "insert into rider_profiles (user_id, handle, display_name) values ($1,'12345','B')", [B]);
  await badInsert("a blank display name", "insert into rider_profiles (user_id, handle, display_name) values ($1,'rider_b','   ')", [B]);
  await badInsert("a 301-character bio", "insert into rider_profiles (user_id, handle, display_name, bio) values ($1,'rider_b','B',$2)", [B, "x".repeat(301)]);
  await badInsert("an unknown interest", "insert into rider_profiles (user_id, handle, display_name, interests) values ($1,'rider_b','B','{hacking}')", [B]);
  await badInsert("more than 6 interests", "insert into rider_profiles (user_id, handle, display_name, interests) values ($1,'rider_b','B','{adventure,touring,commuting,weekend,mountains,off_road,city}')", [B]);
  await badInsert("an unknown avatar colour", "insert into rider_profiles (user_id, handle, display_name, avatar_color) values ($1,'rider_b','B','neon')", [B]);
  await badInsert("show_motorcycle without choosing a bike", "insert into rider_profiles (user_id, handle, display_name, show_motorcycle) values ($1,'rider_b','B',true)", [B]);
  await badInsert("featuring someone else's motorcycle", "insert into rider_profiles (user_id, handle, display_name, featured_bike_id) values ($1,'rider_b','B',$2)", [B, bike]);
  await check("PROFILE handle uniqueness holds even though B cannot see A's profile", async () => {
    await c.query("savepoint dup");
    try { await c.query("insert into rider_profiles (user_id, handle, display_name) values ($1,'rider_a','B')", [B]); throw new Error("accepted"); }
    catch (e) { if (e.message === "accepted") throw e; if (!e.message.includes("rider_profiles_handle_key")) throw e; await c.query("rollback to savepoint dup"); }
  });
  await c.query("insert into rider_profiles (user_id, handle, display_name) values ($1,'rider_b','Rider B')", [B]);

  // --- row-level security ---
  await check("PROFILE B cannot read, change or delete A's profile", async () => {
    const seen = (await c.query("select count(*)::int n from rider_profiles where user_id=$1", [A])).rows[0].n;
    const upd = (await c.query("update rider_profiles set display_name='hacked' where user_id=$1", [A])).rowCount;
    const del = (await c.query("delete from rider_profiles where user_id=$1", [A])).rowCount;
    if (seen !== 0 || upd !== 0 || del !== 0) throw new Error(JSON.stringify({ seen, upd, del }));
  });
  await check("PROFILE B cannot create a profile owned by A", () =>
    c.query("insert into rider_profiles (user_id, handle, display_name) values ($1,'forged_a','x')", [A]), true);

  // --- handle change limit: one change per 30 days that the rider cannot reset ---
  await as(A);
  await check("PROFILE first handle change is allowed, a second within 30 days is blocked", async () => {
    await c.query("update rider_profiles set handle='rider_a2' where user_id=$1", [A]);
    await c.query("savepoint cd");
    try { await c.query("update rider_profiles set handle='rider_a3' where user_id=$1", [A]); throw new Error("accepted second change"); }
    catch (e) { if (e.message === "accepted second change") throw e; if (!e.message.includes("handle_cooldown")) throw e; await c.query("rollback to savepoint cd"); }
  });
  await check("PROFILE a rider cannot reset their own cooldown by editing the timestamp", async () => {
    await c.query("update rider_profiles set handle='rider_a2' where user_id=$1", [A]);
    await c.query("update rider_profiles set handle_changed_at = null where user_id=$1", [A]);   // the clock must ignore this
    await c.query("savepoint cr");
    try { await c.query("update rider_profiles set handle='rider_a3' where user_id=$1", [A]); throw new Error("cooldown was reset"); }
    catch (e) { if (e.message === "cooldown was reset") throw e; if (!e.message.includes("handle_cooldown")) throw e; await c.query("rollback to savepoint cr"); }
  });
  await check("PROFILE saving other fields never resets the handle clock", async () => {
    await c.query("update rider_profiles set handle='rider_a2' where user_id=$1", [A]);
    const t1 = (await c.query("select handle_changed_at t from rider_profiles where user_id=$1", [A])).rows[0].t;
    await c.query("update rider_profiles set display_name='Renamed' where user_id=$1", [A]);
    const t2 = (await c.query("select handle_changed_at t from rider_profiles where user_id=$1", [A])).rows[0].t;
    if (String(t1) !== String(t2)) throw new Error("clock moved");
  });
  await check("PROFILE handle can change again after 30 days", async () => {
    await c.query("update rider_profiles set handle='rider_a2' where user_id=$1", [A]);
    await c.query("reset role");
    await c.query("alter table public.rider_profiles disable trigger trg_rider_profiles_handle");
    await c.query("update rider_profiles set handle_changed_at = now() - interval '31 days' where user_id=$1", [A]);
    await c.query("alter table public.rider_profiles enable trigger trg_rider_profiles_handle");
    await c.query("set local role authenticated"); await as(A);
    await c.query("update rider_profiles set handle='rider_a3' where user_id=$1", [A]);
  });

  // --- no public read path ---
  await c.query("update rider_profiles set is_public = true where user_id=$1", [A]);
  await check("PROFILE anonymous database access returns no profiles even when public", async () => {
    await c.query("reset role"); await c.query("set local role anon");
    let n = 0;
    try { n = (await c.query("select count(*)::int n from rider_profiles")).rows[0].n; } catch { n = 0; /* permission denied is also fine */ }
    await c.query("reset role"); await c.query("set local role authenticated"); await as(A);
    if (n !== 0) throw new Error("anon saw " + n + " rows");
  });
  await check("PROFILE another signed-in user cannot list public profiles through the database either", async () => {
    await as(B);
    const n = (await c.query("select count(*)::int n from rider_profiles where is_public")).rows[0].n;
    await as(A);
    if (n !== 0) throw new Error("B saw " + n);
  });

  // --- blocks ---
  await check("PROFILE block: cannot block yourself", () =>
    c.query("insert into profile_blocks (blocker_id, blocked_id) values ($1,$1)", [A]), true);
  await c.query("insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [A, B]);
  await check("PROFILE block: the blocked rider cannot see, remove or forge blocks", async () => {
    await as(B);
    const seen = (await c.query("select count(*)::int n from profile_blocks")).rows[0].n;
    const del = (await c.query("delete from profile_blocks where blocker_id=$1", [A])).rowCount;
    await c.query("savepoint fb");
    let forged = false;
    try { await c.query("insert into profile_blocks (blocker_id, blocked_id) values ($1,$2)", [A, B]); forged = true; } catch { await c.query("rollback to savepoint fb"); }
    await as(A);
    if (seen !== 0 || del !== 0 || forged) throw new Error(JSON.stringify({ seen, del, forged }));
  });

  // --- reports ---
  await as(B);
  await c.query("insert into profile_reports (reporter_id, profile_user_id, reason, note) values ($1,$2,'spam','looks fake')", [B, A]);
  await check("PROFILE report: a second open report for the same profile is rejected", () =>
    c.query("insert into profile_reports (reporter_id, profile_user_id, reason) values ($1,$2,'harassment')", [B, A]), true);
  await check("PROFILE report: cannot report yourself, use an unknown reason, or exceed 500 characters", async () => {
    for (const [sql, params] of [
      ["insert into profile_reports (reporter_id, profile_user_id, reason) values ($1,$1,'spam')", [B]],
      ["insert into profile_reports (reporter_id, profile_user_id, reason) values ($1,$2,'boring')", [B, A]],
      ["insert into profile_reports (reporter_id, profile_user_id, reason, note) values ($1,$2,'other',$3)", [B, A, "x".repeat(501)]],
    ]) {
      await c.query("savepoint rp");
      try { await c.query(sql, params); throw new Error("accepted"); }
      catch (e) { if (e.message === "accepted") throw e; await c.query("rollback to savepoint rp"); }
    }
  });
  await check("PROFILE report: a reporter cannot pre-close their own report or file it as someone else", async () => {
    for (const [sql, params] of [
      ["insert into profile_reports (reporter_id, profile_user_id, reason, status) values ($1,$2,'spam','dismissed')", [B, A]],
      ["insert into profile_reports (reporter_id, profile_user_id, reason) values ($1,$2,'spam')", [A, B]],
    ]) {
      await c.query("savepoint rq");
      try { await c.query(sql, params); throw new Error("accepted"); }
      catch (e) { if (e.message === "accepted") throw e; await c.query("rollback to savepoint rq"); }
    }
  });
  await check("PROFILE report: the reported rider cannot see reports about them", async () => {
    await as(A);
    const n = (await c.query("select count(*)::int n from profile_reports")).rows[0].n;
    await as(B);
    if (n !== 0) throw new Error("A saw " + n);
  });

  // --- ride statistics function: counts only, server (service role) only ---
  await c.query("reset role");
  const mk = async (dest, status, extra = "") => {
    const id = (await c.query("insert into trips (user_id, bike_id, title, origin_label, destination_label) values ($1,$2,'t','x',$3) returning id", [A, bike, dest])).rows[0].id;
    if (status !== "draft") {
      if (status === "completed") { await c.query("update trips set status='active' where id=$1", [id]); await c.query("update trips set status='completed' where id=$1", [id]); }
      else await c.query("update trips set status=$2 where id=$1", [id, status]);
    }
    if (extra) await c.query(extra, [id]);
    return id;
  };
  const t1 = await mk("Jaipur", "completed");
  await c.query("insert into trip_estimates (user_id, trip_id, revision, distance_km, mileage_kmpl, fuel_price_paise_per_litre, fuel_litres, fuel_paise) values ($1,$2,1,270,30,10000,9,90000)", [A, t1]);
  await mk(" jaipur ", "completed", "update trips set actual_distance_km = 100 where id = $1");     // same place, actual distance wins
  await mk("Goa", "draft");                                                                           // not completed: ignored
  await mk("Leh", "archived");                                                                        // archived: ignored
  await check("PROFILE stats count only completed rides: rides, km and distinct places", async () => {
    const r = (await c.query("select * from rider_stats($1)", [A])).rows[0];
    if (r.rides !== 2 || Number(r.km) !== 370 || r.places !== 1) throw new Error(JSON.stringify(r));
  });
  await check("PROFILE stats for a rider with no completed rides are zero", async () => {
    const r = (await c.query("select * from rider_stats($1)", [B])).rows[0];
    if (r.rides !== 0 || Number(r.km) !== 0 || r.places !== 0) throw new Error(JSON.stringify(r));
  });
  await check("PROFILE stats function is not callable from a browser session", async () => {
    await c.query("set local role authenticated"); await as(B);
    await c.query("savepoint sf");
    let callable = false;
    try { await c.query("select * from rider_stats($1)", [A]); callable = true; }
    catch { await c.query("rollback to savepoint sf"); }
    await c.query("reset role");
    if (callable) throw new Error("callable from a browser session");
  });
} catch (e) {
  setupError = e; // never swallow: a crash before/between checks must fail the run
} finally {
  await c.query("rollback");
  const left = (await c.query("select count(*) n from auth.users where id in ($1,$2)", [A, B])).rows[0].n;
  await c.end();
  console.table(results);
  const failed = results.filter((r) => !r.pass).length;
  if (setupError) console.error("TEST CRASHED:", setupError.message);
  if (results.length === 0) console.error("NO CHECKS RAN");
  console.log(setupError || results.length === 0 ? "FAILED" : failed ? `${failed} FAILED` : "ALL PASSED", `| checks: ${results.length} | leftover users: ${left}`);
  process.exit(setupError || results.length === 0 || failed || left !== "0" ? 1 : 0);
}
