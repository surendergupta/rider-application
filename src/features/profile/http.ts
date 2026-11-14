import { apiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import type { Failure } from "./service";

export const failureResponse = (f: Failure) => apiError(f.status, f.code, f.message, f.field);

/** Per-account limits keep scripted abuse (handle probing, report spam) cheap to stop. */
export function limited(key: string, limit: number, windowMs: number) {
  const r = rateLimit(key, limit, windowMs);
  return r.allowed ? null : apiError(429, "RATE_LIMITED", "Too many requests. Try again in a little while.");
}
