export interface RideDefaults {
  title?: string; description?: string | null; area?: string; destination?: string | null; startsOn?: string; startTime?: string | null; endsOn?: string | null;
  visibility?: "public" | "invite_only"; requiresApproval?: boolean; maxRiders?: number; distanceKm?: number | null; meetingPoint?: string | null; hostNote?: string | null;
}

const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

/** Used for creating and editing a ride. Server-rendered; the action validates everything again on the server. */
export function RideForm({ action, defaults = {}, submitLabel, today, hidden = {} }: { action: (f: FormData) => Promise<void>; defaults?: RideDefaults; submitLabel: string; today: string; hidden?: Record<string, string> }) {
  return (
    <form action={action} className="mt-6 space-y-5">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="block text-sm">Ride title
        <input name="title" required minLength={3} maxLength={100} defaultValue={defaults.title ?? ""} className={input} />
      </label>
      <label className="block text-sm">About this ride (optional)
        <textarea name="description" rows={3} maxLength={1000} defaultValue={defaults.description ?? ""} className={input}
          placeholder="Pace, stops, who it suits, what to bring" />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Where</legend>
        <label className="block text-sm">City or area the ride starts in
          <input name="area_label" required minLength={2} maxLength={100} defaultValue={defaults.area ?? ""} className={input} aria-describedby="area-help" />
          <span id="area-help" className="mt-1 block text-xs text-muted">Shown to everyone who can see this ride. Do not enter a street address here.</span>
        </label>
        <label className="block text-sm">Destination (optional)
          <input name="destination_label" maxLength={100} defaultValue={defaults.destination ?? ""} className={input} />
        </label>
        <label className="block text-sm">Exact meeting point (optional)
          <input name="meeting_point" maxLength={200} defaultValue={defaults.meetingPoint ?? ""} className={input} aria-describedby="meet-help" />
          <span id="meet-help" className="mt-1 block text-xs text-muted">Only you and riders you have confirmed can see this. Choose a public place, such as a fuel station.</span>
        </label>
      </fieldset>

      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="col-span-2 text-sm font-semibold">When</legend>
        <label className="block text-sm">Start date
          <input name="starts_on" type="date" required min={today} defaultValue={defaults.startsOn ?? ""} className={input} />
        </label>
        <label className="block text-sm">Start time (optional)
          <input name="start_time" type="time" defaultValue={defaults.startTime ?? ""} className={input} />
        </label>
        <label className="block text-sm">End date (optional)
          <input name="ends_on" type="date" min={today} defaultValue={defaults.endsOn ?? ""} className={input} />
        </label>
        <label className="block text-sm">Distance in km (optional)
          <input name="distance_km" type="number" step="0.1" min="0.1" max="5000" inputMode="decimal" defaultValue={defaults.distanceKm ?? ""} className={input} />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Who can join</legend>
        <div className="grid gap-2">
          {[["public", "Public", "Any signed-in rider can see it and ask to join."], ["invite_only", "Invite only", "Only riders you invite can see it."]].map(([v, label, help]) => (
            <label key={v} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
              <input type="radio" name="visibility" value={v} defaultChecked={(defaults.visibility ?? "public") === v} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
              <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{help}</span></span>
            </label>
          ))}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" name="requires_approval" defaultChecked={defaults.requiresApproval ?? true} className="h-4 w-4 accent-[var(--accent)]" />
          I approve each rider who asks to join a public ride
        </label>
        <label className="block text-sm">Number of riders, including you
          <input name="max_riders" type="number" required min="2" max="100" defaultValue={defaults.maxRiders ?? 10} className={input} />
        </label>
      </fieldset>

      <label className="block text-sm">Note for confirmed riders (optional)
        <textarea name="host_note" rows={2} maxLength={500} defaultValue={defaults.hostNote ?? ""} className={input} />
      </label>

      <p className="rounded-lg bg-sunken p-3 text-xs text-muted">
        Riders who can see this ride will see your display name and handle. A group ride has real risks: ride within your ability, wear proper gear, and never use your phone while riding.
        We do not verify riders or run background checks.
      </p>
      <button className="rounded-lg bg-saffron px-6 font-semibold text-ink transition hover:bg-saffron-dark">{submitLabel}</button>
    </form>
  );
}

/** Turns the submitted form into the object the server validates. */
export function rideFormToRaw(f: FormData) {
  const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
  return {
    title: f.get("title") ?? "", description: f.get("description") ?? "", area_label: f.get("area_label") ?? "",
    destination_label: f.get("destination_label") ?? "", starts_on: f.get("starts_on") ?? "", start_time: f.get("start_time") ?? "",
    ends_on: f.get("ends_on") ?? "", visibility: f.get("visibility") ?? "", requires_approval: f.get("requires_approval") === "on",
    max_riders: num("max_riders") ?? NaN, distance_km: num("distance_km"), meeting_point: f.get("meeting_point") ?? "", host_note: f.get("host_note") ?? "",
  };
}

export const RIDE_FIELD_ERRORS: Record<string, string> = {
  title: "Give the ride a title of 3 to 100 characters.",
  description: "The description must be 1,000 characters or fewer.",
  area_label: "Enter the city or area the ride starts in.",
  destination_label: "The destination must be 100 characters or fewer.",
  starts_on: "Choose a start date that is today or later.",
  start_time: "Start time must look like 06:30.",
  ends_on: "The end date must be on or after the start date, within 30 days.",
  visibility: "Choose who can see this ride.",
  max_riders: "Choose between 2 and 100 riders, including you. You cannot go below the riders already confirmed.",
  distance_km: "Distance must be between 0.1 and 5,000 km.",
  meeting_point: "The meeting point must be 200 characters or fewer.",
  host_note: "The note must be 500 characters or fewer.",
};
