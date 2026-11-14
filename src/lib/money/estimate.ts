export interface EstimateInput {
  distanceKm: number;
  plannedMileageKmPerLitre: number;
  petrolPricePaisePerLitre: number;
  tollPaise: number;
  foodPaise: number;
  stayPaise: number;
  otherPaise: number;
}

export interface Estimate {
  fuelLitres: number;
  fuelPaise: number;
  totalPaise: number;
  costPerKmPaise: number | null;
}

const nonNegInt = (n: number) => Number.isInteger(n) && n >= 0;

export function computeEstimate(i: EstimateInput): Estimate {
  if (!(i.distanceKm > 0)) throw new RangeError("distanceKm must be > 0");
  if (!(i.plannedMileageKmPerLitre > 0)) throw new RangeError("mileage must be > 0");
  for (const v of [i.petrolPricePaisePerLitre, i.tollPaise, i.foodPaise, i.stayPaise, i.otherPaise]) {
    if (!nonNegInt(v)) throw new RangeError("amounts must be non-negative integer paise");
  }
  // litres rounded to 3 dp (matches NUMERIC(12,3)); fuel cost rounded to whole paise
  const fuelLitres = Math.round((i.distanceKm / i.plannedMileageKmPerLitre) * 1000) / 1000;
  const fuelPaise = Math.round((i.distanceKm * i.petrolPricePaisePerLitre) / i.plannedMileageKmPerLitre);
  const totalPaise = fuelPaise + i.tollPaise + i.foodPaise + i.stayPaise + i.otherPaise;
  return { fuelLitres, fuelPaise, totalPaise, costPerKmPaise: costPerKmPaise(totalPaise, i.distanceKm) };
}

/** Cost per km in paise, or null ("N/A") when distance is zero. */
export function costPerKmPaise(totalPaise: number, distanceKm: number): number | null {
  return distanceKm > 0 ? Math.round(totalPaise / distanceKm) : null;
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}
