// Applies supabase/migrations/*.sql that have not been applied yet, each in its own transaction.
// Usage: npm run migrate   (needs DATABASE_URL in .env.local)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv, pgConfig } from "../tests/helpers/env.mjs";

const cfg = pgConfig(loadEnv());
if (!cfg) { console.error("Set DATABASE_URL in .env.local"); process.exit(1); }
const dir = path.resolve("supabase/migrations");
const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();

const c = new pg.Client(cfg);
await c.connect();
await c.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
const applied = new Set((await c.query("select name from public.schema_migrations")).rows.map((r) => r.name));

// Databases set up before this tracker existed: record 0001/0002 as applied instead of re-running them.
if (applied.size === 0 && (await c.query("select to_regclass('public.bikes') t")).rows[0].t) {
  for (const name of ["0001_init.sql", "0002_integrity.sql"]) {
    await c.query("insert into public.schema_migrations (name) values ($1) on conflict do nothing", [name]);
    applied.add(name);
  }
  console.log("recorded existing 0001/0002 as applied");
}

for (const f of files) {
  if (applied.has(f)) continue;
  try {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await c.query("insert into public.schema_migrations (name) values ($1)", [f]);
    await c.query("commit");
    console.log("applied", f);
  } catch (e) {
    await c.query("rollback");
    console.error("FAILED", f, "-", e.message);
    await c.end();
    process.exit(1);
  }
}
console.log("up to date");
await c.end();
