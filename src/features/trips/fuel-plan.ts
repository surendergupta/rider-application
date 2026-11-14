export interface FuelPlanInput {
  distanceKm: number;
  mileageKmpl: number;
  tankLitres: number;
  /** Fraction of the tank kept in reserve. 0.2 = plan to refuel with 20% left. */
  reserveFraction?: number;
}

export interface FuelPlan {
  rangeKm: number;        // full-tank range
  safeRangeKm: number;    // range you plan around (keeps the reserve)
  stops: number;          // refuels needed after the start
  stopAtKm: number[];     // distance markers by which to have refuelled
  litresNeeded: number;
  warnings: string[];
}

export function fuelPlan(i: FuelPlanInput): FuelPlan | null {
  if (!(i.distanceKm > 0) || !(i.mileageKmpl > 0) || !(i.tankLitres > 0)) return null;
  const reserve = i.reserveFraction ?? 0.2;
  const rangeKm = Math.round(i.tankLitres * i.mileageKmpl);
  const safeRangeKm = Math.floor(rangeKm * (1 - reserve));
  if (safeRangeKm <= 0) return null;

  const stopAtKm: number[] = [];
  for (let km = safeRangeKm; km < i.distanceKm; km += safeRangeKm) stopAtKm.push(km);

  const warnings: string[] = [];
  if (safeRangeKm < 150) {
    warnings.push("Your safe range is short. Plan refuels early and often on this trip.");
  }
  warnings.push(
    "Markers are distances, not pump locations. On remote stretches (for example in the Himalayas) pumps can be 200 km apart or closed. Fill up whenever you can and carry spare fuel if it is allowed.",
  );

  return {
    rangeKm,
    safeRangeKm,
    stops: stopAtKm.length,
    stopAtKm,
    litresNeeded: Math.round((i.distanceKm / i.mileageKmpl) * 10) / 10,
    warnings,
  };
}
