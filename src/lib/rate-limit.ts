/**
 * Fixed-window in-memory limiter, per key. Good enough for one server instance and for stopping
 * accidental or abusive bursts. For multi-instance production, back this with a shared store
 * (Redis/Upstash/Supabase) behind the same function.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return { allowed: true, remaining: limit - 1 };
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}

export function resetRateLimits() {
  hits.clear();
}
