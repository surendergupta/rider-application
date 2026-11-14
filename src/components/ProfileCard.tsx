import { AVATAR_COLORS } from "@/features/profile/validation";
import { formatKm, type PublicProfile } from "@/features/profile/public";

/** Initials badge. Image upload is deferred until moderation tooling exists (docs/08), so there is no photo to moderate. */
export function Avatar({ initials, color, size = 72 }: { initials: string; color: keyof typeof AVATAR_COLORS; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 select-none place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: AVATAR_COLORS[color], fontSize: Math.round(size * 0.38) }}
    >
      {initials}
    </span>
  );
}

/**
 * Presentational only: it renders exactly the PublicProfile it is given, which is already a strict whitelist.
 * All text is rendered as plain text by React (escaped), so a hostile bio cannot inject markup.
 */
export function ProfileCard({ profile }: { profile: PublicProfile }) {
  return (
    <article className="rounded-3xl bg-surface p-6 ring-1 ring-line" aria-label={`Rider profile: ${profile.displayName}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Rider profile</p>
      <div className="mt-4 flex items-center gap-4">
        <Avatar initials={profile.initials} color={profile.avatarColor} />
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-extrabold leading-tight">{profile.displayName}</h1>
          <p className="text-muted">@{profile.handle}</p>
          {profile.location && <p className="mt-0.5 text-sm text-muted">{profile.location}</p>}
        </div>
      </div>

      {profile.bio && <p className="mt-4 whitespace-pre-line break-words leading-relaxed">{profile.bio}</p>}

      {profile.stats && (
        <dl className="mt-5 grid grid-cols-3 gap-3 text-center" aria-label="Ride statistics">
          {[
            ["Rides", String(profile.stats.rides)],
            ["KM ridden", formatKm(profile.stats.km)],
            ["Places", String(profile.stats.places)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-sunken p-3">
              <dd className="text-2xl font-extrabold">{value}</dd>
              <dt className="text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      )}

      {profile.motorcycle && (
        <p className="mt-5 text-sm"><span className="text-muted">Rides a </span><strong>{profile.motorcycle}</strong></p>
      )}

      {profile.interests.length > 0 && (
        <div className="mt-5">
          <h2 className="text-sm font-semibold">My riding interests</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.interests.map((i) => (
              <li key={i.id} className="rounded-full bg-sunken px-3 py-1 text-xs font-medium">{i.label}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
