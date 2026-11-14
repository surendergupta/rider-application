import {
  GENERAL_ROUTE_WARNING,
  RoutingUnavailableError,
  type LatLon,
  type RouteCandidate,
  type RoutingAdapter,
} from "./adapter";

const MAX_CANDIDATES = 3;
const TIMEOUT_MS = 8000;

/**
 * Adapter for any OSRM-compatible HTTP API (self-hosted OSRM, or a provider exposing the same
 * contract). OSRM's standard profiles are general road routing, so results are always labeled
 * motorcycle_specific = false. The public demo server is NOT for production use; configure
 * ROUTING_BASE_URL with a service whose terms permit your usage.
 */
export function createOsrmAdapter(baseUrl: string, fetchImpl: typeof fetch = fetch): RoutingAdapter {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async getRoutes({ origin, destination, waypoints }) {
      const pts: LatLon[] = [origin, ...waypoints, destination];
      const coords = pts.map((p) => `${p.lon},${p.lat}`).join(";");
      const url = `${base}/route/v1/driving/${coords}?alternatives=true&overview=false&steps=false`;

      let res: Response;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
      } catch {
        throw new RoutingUnavailableError("Routing service did not respond in time");
      }
      if (!res.ok) throw new RoutingUnavailableError(`Routing service error (${res.status})`);

      const body = (await res.json().catch(() => null)) as
        | { code?: string; routes?: { distance: number; duration: number }[] }
        | null;
      if (!body || body.code !== "Ok" || !Array.isArray(body.routes) || body.routes.length === 0) {
        throw new RoutingUnavailableError("No route found between those points");
      }

      const generatedAt = new Date().toISOString();
      return body.routes.slice(0, MAX_CANDIDATES).map((r, i): RouteCandidate => ({
        routeId: `osrm-${i}`,
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        provider: "osrm",
        sourceKind: "provider",
        motorcycleSpecific: false,
        warnings: [GENERAL_ROUTE_WARNING],
        generatedAt,
      }));
    },
  };
}
