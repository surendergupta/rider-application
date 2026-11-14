// Grants or removes the moderator role. Moderators are managed with SQL on purpose: nobody can make themselves one.
// Usage: npm run mod:add -- <rider handle>            grant
//        npm run mod:add -- <rider handle> --remove   revoke
import pg from "pg";
import { loadEnv, pgConfig } from "../tests/helpers/env.mjs";

const handle = process.argv[2]?.replace(/^@/, "").toLowerCase();
const remove = process.argv.includes("--remove");
const cfg = pgConfig(loadEnv());
if (!cfg) { console.error("Set DATABASE_URL in .env.local"); process.exit(1); }
if (!handle || handle.startsWith("--")) { console.error("Usage: npm run mod:add -- <rider handle> [--remove]"); process.exit(1); }

const c = new pg.Client(cfg);
await c.connect();
try {
  const u = (await c.query("select user_id from public.rider_profiles where handle = $1", [handle])).rows[0];
  if (!u) { console.error(`No rider profile with the handle "${handle}". They need a rider profile first.`); process.exitCode = 1; }
  else if (remove) { await c.query("delete from public.moderators where user_id = $1", [u.user_id]); console.log(`@${handle} is no longer a moderator.`); }
  else { await c.query("insert into public.moderators (user_id) values ($1) on conflict do nothing", [u.user_id]); console.log(`@${handle} is now a moderator.`); }
} finally { await c.end(); }
