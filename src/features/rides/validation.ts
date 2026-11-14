import { z } from "zod";
import { todayInIndia } from "@/features/garage/documents";

const stripControls = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
const cleanLine = (s: string) => stripControls(s).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

function optionalLine(max: number, label: string) {
  return z.string().default("").transform(cleanLine)
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`))
    .transform((s) => (s === "" ? null : s));
}
function optionalText(max: number, label: string) {
  return z.string().default("").transform((s) => stripControls(s).replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max, `${label} must be ${max} characters or fewer.`))
    .transform((s) => (s === "" ? null : s));
}

export const MAX_RIDE_DAYS = 30;

/** Calendar-date arithmetic in UTC, so a date string never shifts with the server's timezone. */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

const base = z.object({
  title: z.string().transform(cleanLine).pipe(z.string().min(3, "Give the ride a title of at least 3 characters.").max(100, "Title must be 100 characters or fewer.")),
  description: optionalText(1000, "Description"),
  // City or area only: this is shown to everyone who can see the ride. The exact spot goes in meeting_point.
  area_label: z.string().transform(cleanLine).pipe(z.string().min(2, "Enter the city or area the ride starts in.").max(100, "Area must be 100 characters or fewer.")),
  destination_label: optionalLine(100, "Destination"),
  starts_on: z.iso.date("Choose a start date."),
  start_time: z.string().default("").transform((s) => s.trim())
    .pipe(z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must look like 06:30.")]))
    .transform((s) => (s === "" ? null : s)),
  ends_on: z.string().default("").transform((s) => s.trim())
    .pipe(z.union([z.literal(""), z.iso.date("End date is not valid.")])).transform((s) => (s === "" ? null : s)),
  visibility: z.enum(["public", "invite_only"], "Choose who can see this ride."),
  requires_approval: z.boolean(),
  max_riders: z.number("Enter how many riders (including you).").int("Riders must be a whole number.").min(2, "A group ride needs at least 2 riders.").max(100, "Up to 100 riders."),
  distance_km: z.number().gt(0, "Distance must be more than 0.").max(5000, "Distance must be 5,000 km or less.").nullable(),
  meeting_point: optionalLine(200, "Meeting point"),
  host_note: optionalText(500, "Note for riders"),
});

/** Rules that depend on "today" are applied to new rides and date edits, never to rides that already exist unchanged. */
export function rideInputSchema(today: string = todayInIndia()) {
  return base.superRefine((r, ctx) => {
    if (r.starts_on < today) ctx.addIssue({ code: "custom", path: ["starts_on"], message: "The start date cannot be in the past." });
    if (r.ends_on) {
      if (r.ends_on < r.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "The end date cannot be before the start date." });
      else if (r.ends_on > addDays(r.starts_on, MAX_RIDE_DAYS)) ctx.addIssue({ code: "custom", path: ["ends_on"], message: `A ride can last up to ${MAX_RIDE_DAYS} days.` });
    }
  });
}
export type RideInput = z.infer<ReturnType<typeof rideInputSchema>>;

export const inviteSchema = z.object({
  handle: z.string().transform((s) => s.trim().replace(/^@+/, "").toLowerCase()).pipe(z.string().regex(/^[a-z0-9_]{3,20}$/, "Enter a rider's handle, like @rider_name.")),
});

export const rideReportSchema = z.object({
  reason: z.enum(["spam", "unsafe", "inappropriate", "harassment", "other"], "Choose a reason."),
  note: optionalText(500, "Details"),
});

/** Filters for browsing public rides. Everything optional; unknown values fall back to the default. */
export const rideFilterSchema = z.object({
  area: z.string().default("").transform(cleanLine).pipe(z.string().max(60)).catch(""),
  when: z.enum(["week", "month", "all"]).catch("all"),
  open: z.enum(["1", ""]).catch(""),
});
export type RideFilters = z.infer<typeof rideFilterSchema>;

export function whenRange(when: "week" | "month" | "all", today: string): { from: string; to: string | null } {
  return { from: today, to: when === "week" ? addDays(today, 7) : when === "month" ? addDays(today, 31) : null };
}

/** Short database error codes from the participation functions, turned into plain messages. */
export const RIDE_ERRORS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: "That ride or rider could not be found." },
  ride_full: { status: 409, message: "This ride is full." },
  ride_closed: { status: 409, message: "This ride is no longer open." },
  profile_required: { status: 403, message: "Create a rider profile first. Other riders see it next to your ride." },
  is_host: { status: 422, message: "You are the host of this ride." },
  removed: { status: 403, message: "The host has removed you from this ride." },
  already_going: { status: 409, message: "That rider is already going." },
  too_many_invites: { status: 409, message: "This ride has too many pending invitations." },
  capacity_below_going: { status: 409, message: "You cannot set the limit below the riders already going." },
  ride_cancelled: { status: 409, message: "A cancelled ride cannot be reopened." },
  auth_required: { status: 401, message: "Sign in required." },
};

export function mapRideError(message: string | undefined): { status: number; code: string; message: string } {
  const code = Object.keys(RIDE_ERRORS).find((k) => (message ?? "").includes(k));
  return code ? { code, ...RIDE_ERRORS[code] } : { status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Try again." };
}

export type RideState = "cancelled" | "past" | "full" | "open";

/** What a rider should see as the ride's overall state. Past is judged in India time. */
export function rideState(r: { status: string; starts_on: string; ends_on: string | null }, going: number, max: number, today: string = todayInIndia()): RideState {
  if (r.status === "cancelled") return "cancelled";
  if ((r.ends_on ?? r.starts_on) < today) return "past";
  return going >= max ? "full" : "open";
}
