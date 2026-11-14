import { z } from "zod";

export const SERVICE_TYPES = ["oil", "chain", "tyre", "brake", "general", "other"] as const;
const serviceType = z.enum(SERVICE_TYPES);

export const maintenanceSchema = z.object({
  service_type: serviceType,
  service_date: z.iso.date(),
  odometer_km: z.number().int().min(0).max(2_000_000).nullable().optional(),
  cost_paise: z.number().int().min(0).max(100_000_000_00).default(0),
  next_due_km: z.number().int().min(0).max(2_000_000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const scheduleSchema = z.object({
  service_type: serviceType,
  interval_km: z.number().int().min(1).max(100000),
  last_service_km: z.number().int().min(0).max(2_000_000).nullable().optional(),
});
