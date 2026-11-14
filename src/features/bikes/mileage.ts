export interface FuelFill {
  odometerKm: number;
  litres: number;
}

export interface RealMileage {
  kmPerLitre: number;
  fills: number;       // fills used
  distanceKm: number;  // km covered between them
}

/**
 * Real-world mileage from fuel fills, using the "fill to full each time" method:
 * the litres added at a fill are what was burned since the previous fill.
 * Needs at least 2 fills with odometer readings. Pairs that make no sense (odometer
 * going backwards, zero litres) are skipped rather than distorting the average.
 */
export function realMileage(fills: FuelFill[]): RealMileage | null {
  const sorted = [...fills].filter((f) => f.litres > 0 && f.odometerKm >= 0).sort((a, b) => a.odometerKm - b.odometerKm);
  let km = 0, litres = 0, used = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].odometerKm - sorted[i - 1].odometerKm;
    if (d <= 0) continue;
    km += d;
    litres += sorted[i].litres;
    used++;
  }
  if (used === 0 || litres === 0) return null;
  const kmPerLitre = Math.round((km / litres) * 10) / 10;
  // Anything outside plausible motorcycle range means a missed fill or a typo: don't show a misleading number.
  if (kmPerLitre < 5 || kmPerLitre > 120) return null;
  return { kmPerLitre, fills: used + 1, distanceKm: km };
}
