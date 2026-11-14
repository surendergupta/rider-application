import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(100)
  .transform((s) => (s === "" ? null : s))
  .nullable()
  .optional();

export const bikeCreateSchema = z.object({
  display_name: z.string().trim().min(1).max(100),
  make: optionalText,
  model: optionalText,
  mileage_kmpl: z.number().gt(0).lte(200).nullable().optional(),
  tank_litres: z.number().gt(0).lte(100).nullable().optional(),
  odometer_km: z.number().int().min(0).nullable().optional(),
});

export const bikeUpdateSchema = bikeCreateSchema.partial().extend({
  is_archived: z.boolean().optional(),
});

export type BikeCreate = z.infer<typeof bikeCreateSchema>;
