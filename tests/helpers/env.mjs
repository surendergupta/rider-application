import fs from "node:fs";
import path from "node:path";

/** Loads KEY=VALUE pairs from .env.local (no overriding of real env vars). Returns the merged env. */
export function loadEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  const out = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }
  return out;
}

/** Parses DATABASE_URL (password may contain / & + so URL() is avoided). */
export function pgConfig(env) {
  const m = env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@:]+):(\d+)\/(\w+)$/);
  if (!m) return null;
  return { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5], ssl: { rejectUnauthorized: false } };
}
