export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteCandidate {
  routeId: string;
  distanceM: number;
  durationS: number;
  provider: string;
  sourceKind: "provider" | "manual";
  /** true only if the provider really routes with a motorcycle profile */
  motorcycleSpecific: boolean;
  warnings: string[];
  generatedAt: string;
}

export interface RoutingAdapter {
  getRoutes(input: { origin: LatLon; destination: LatLon; waypoints: LatLon[] }): Promise<RouteCandidate[]>;
}

export class RoutingUnavailableError extends Error {
  constructor(message = "Routing is unavailable") {
    super(message);
    this.name = "RoutingUnavailableError";
  }
}

export const GENERAL_ROUTE_WARNING =
  "General road route, not motorcycle-certified. Verify the route and local conditions before you ride.";

/** Manual distance fallback (TECH-05): always labeled source_kind = manual. */
export function manualRoute(distanceKm: number): RouteCandidate {
  if (!(distanceKm > 0)) throw new RangeError("distanceKm must be > 0");
  return {
    routeId: "manual",
    distanceM: Math.round(distanceKm * 1000),
    durationS: 0,
    provider: "manual",
    sourceKind: "manual",
    motorcycleSpecific: false,
    warnings: ["Distance entered manually."],
    generatedAt: new Date().toISOString(),
  };
}

/** Placeholder until the routing provider is chosen (decision log, G1). */
export const unconfiguredRouting: RoutingAdapter = {
  async getRoutes() {
    throw new RoutingUnavailableError("No routing provider configured yet");
  },
};
