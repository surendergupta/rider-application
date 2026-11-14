import Link from "next/link";
import { Avatar } from "@/components/ProfileCard";
import type { RideCard as Ride } from "@/features/rides/service";

/** "Sat, 5 Dec" or "Sat, 5 Dec to Sun, 6 Dec", from calendar dates (no timezone shifting). */
export function formatRideDate(startsOn: string, endsOn: string | null, time: string | null): string {
  const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const range = endsOn && endsOn !== startsOn ? `${fmt(startsOn)} to ${fmt(endsOn)}` : fmt(startsOn);
  return time ? `${range}, ${time}` : range;
}

const STATE_CHIP: Record<string, { text: string; cls: string }> = {
  open: { text: "Open", cls: "bg-success-bg text-success-fg" },
  full: { text: "Full", cls: "bg-warn-bg text-warn-fg" },
  cancelled: { text: "Cancelled", cls: "bg-danger-bg text-danger-fg" },
  past: { text: "Finished", cls: "bg-sunken text-muted" },
};
const MY_CHIP: Record<string, string> = { host: "You are hosting", going: "You are going", requested: "Request sent", invited: "You are invited" };

export function RideCardView({ ride }: { ride: Ride }) {
  const state = STATE_CHIP[ride.state];
  return (
    <li>
      <Link href={`/rides/${ride.id}`} className="block rounded-xl border border-line p-4 transition hover:bg-sunken">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words font-semibold">{ride.title}</h3>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${state.cls}`}>{state.text}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {ride.area}{ride.destination ? ` → ${ride.destination}` : ""}
          {ride.distanceKm != null ? ` · ${ride.distanceKm} km` : ""}
        </p>
        <p className="mt-1 text-sm">{formatRideDate(ride.startsOn, ride.endsOn, ride.startTime)}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            {ride.host && <Avatar initials={ride.host.initials} color={ride.host.avatarColor} size={24} />}
            {ride.host ? `Hosted by ${ride.host.displayName}` : "Hosted by a rider"}
          </span>
          <span>{ride.going} of {ride.maxRiders} riders{ride.visibility === "invite_only" ? " · Invite only" : ride.requiresApproval ? " · Host approves" : ""}</span>
        </div>
        {ride.myStatus && MY_CHIP[ride.myStatus] && (
          <p className="mt-2 text-xs font-semibold text-link">{MY_CHIP[ride.myStatus]}</p>
        )}
      </Link>
    </li>
  );
}
