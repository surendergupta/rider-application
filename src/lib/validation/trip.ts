import { z } from "zod";

export const tripCreateSchema = z.object({
  bike_id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  origin_label: z.string().trim().min(1).max(250),
  destination_label: z.string().trim().min(1).max(250),
  travel_date: z.iso.date().nullable().optional(),
  trip_days: z.number().int().min(1).max(60).nullable().optional(),
  terrain: z.enum(["plains", "hills", "mountains", "desert"]).nullable().optional(),
  season: z.enum(["summer", "monsoon", "winter"]).nullable().optional(),
});

export const manualDistanceSchema = z.object({
  distance_km: z.number().gt(0).max(20000),
});

export const tripStatusSchema = z.object({
  status: z.enum(["draft", "active", "completed", "archived"]),
});

const paise = z.number().int().min(0).max(100_000_000_00);

export const estimateSchema = z.object({
  distance_km: z.number().gt(0).max(20000),
  mileage_kmpl: z.number().gt(0).max(200),
  fuel_price_paise_per_litre: paise,
  toll_paise: paise.default(0),
  food_paise: paise.default(0),
  stay_paise: paise.default(0),
  other_paise: paise.default(0),
  input_sources: z.record(z.string(), z.enum(["user", "indicative", "provider"])).default({}),
});

export const expenseSchema = z
  .object({
    category: z.enum(["fuel", "toll", "food", "stay", "maintenance", "parking", "other"]),
    amount_paise: z.number().int().gt(0).max(100_000_000_00),
    spent_at: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().max(1000).nullable().optional(),
    fuel_litres: z.number().gt(0).max(1000).nullable().optional(),
    fuel_price_paise_per_litre: z.number().int().gt(0).nullable().optional(),
    odometer_km: z.number().int().min(0).nullable().optional(),
    client_request_id: z.uuid(),
  })
  .refine((e) => e.category === "fuel" || (e.fuel_litres == null && e.fuel_price_paise_per_litre == null), {
    message: "fuel fields are only valid for the fuel category",
  });
