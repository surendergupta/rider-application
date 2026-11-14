import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { getRoutingAdapter } from "@/lib/routing";
import { RoutingUnavailableError } from "@/lib/routing/adapter";

const point = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const bodySchema = z.object({
  origin: point,
  destination: point,
  waypoints: z.array(point).max(5).default([]),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  // Per-account quota so a user cannot run up the routing bill.
  const rl = rateLimit(`route-preview:${auth.user.id}`, 20, 60_000);
  if (!rl.allowed) return apiError(429, "RATE_LIMITED", "Too many route lookups. Try again in a minute.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid route request");

  try {
    const routes = await getRoutingAdapter().getRoutes(parsed.data);
    return NextResponse.json({
      routes: routes.map((r) => ({
        route_id: r.routeId,
        distance_m: r.distanceM,
        duration_s: r.durationS,
        route_source_kind: r.sourceKind,
        provider: r.provider,
        motorcycle_specific: r.motorcycleSpecific,
        warnings: r.warnings,
      })),
    });
  } catch (e) {
    if (e instanceof RoutingUnavailableError) {
      return apiError(503, "ROUTING_UNAVAILABLE", `${e.message}. You can enter the distance manually.`);
    }
    return apiError(500, "INTERNAL_ERROR", "Route lookup failed");
  }
}
