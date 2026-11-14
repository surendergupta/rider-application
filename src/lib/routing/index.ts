import { unconfiguredRouting, type RoutingAdapter } from "./adapter";
import { createOsrmAdapter } from "./osrm";

/** Provider is chosen by env so it stays replaceable (TRD section 5). */
export function getRoutingAdapter(): RoutingAdapter {
  const base = process.env.ROUTING_BASE_URL;
  return base ? createOsrmAdapter(base) : unconfiguredRouting;
}
