export interface ClubDefaults {
  name?: string; slug?: string; description?: string | null; city?: string | null; state?: string | null;
  visibility?: "public" | "private"; joinPolicy?: "open" | "approval" | "invite"; memberLimit?: number;
}

const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";

/** Create (with a link) or edit (link is fixed so shared links keep working). Everything is validated again on the server. */
export function ClubForm({ action, defaults = {}, submitLabel, editing = false, hidden = {} }: { action: (f: FormData) => Promise<void>; defaults?: ClubDefaults; submitLabel: string; editing?: boolean; hidden?: Record<string, string> }) {
  return (
    <form action={action} className="mt-6 space-y-5">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="block text-sm">Club name
        <input name="name" required minLength={3} maxLength={60} defaultValue={defaults.name ?? ""} className={input} />
      </label>
      {editing ? (
        <p className="text-sm text-muted">Club link: <strong className="text-fg">/clubs/{defaults.slug}</strong> (it cannot be changed, so shared links keep working)</p>
      ) : (
        <label className="block text-sm">Club link
          <div className="mt-1 flex items-center rounded-lg border border-line-strong focus-within:ring-2 focus-within:ring-saffron/30">
            <span className="pl-3 text-muted" aria-hidden="true">/clubs/</span>
            <input name="slug" required minLength={3} maxLength={30} autoCapitalize="none" autoComplete="off" spellCheck={false} aria-describedby="slug-help"
              className="w-full rounded-lg border-0 bg-transparent p-2 focus:outline-none" />
          </div>
          <span id="slug-help" className="mt-1 block text-xs text-muted">3 to 30 letters, numbers or underscores. You cannot change it later.</span>
        </label>
      )}
      <label className="block text-sm">About the club (optional)
        <textarea name="description" rows={3} maxLength={500} defaultValue={defaults.description ?? ""} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">City (optional)<input name="city" maxLength={60} defaultValue={defaults.city ?? ""} className={input} /></label>
        <label className="block text-sm">State (optional)<input name="state" maxLength={60} defaultValue={defaults.state ?? ""} className={input} /></label>
      </div>
      <p className="-mt-3 text-xs text-muted">City and state only. Never enter an address.</p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Who can see the club</legend>
        {[["public", "Public", "Any signed-in rider can find it and see its name and member count."], ["private", "Private", "Only members and people you invite can see it. Always invite only."]].map(([v, label, help]) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
            <input type="radio" name="visibility" value={v} defaultChecked={(defaults.visibility ?? "public") === v} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{help}</span></span>
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">How riders join</legend>
        {[["open", "Anyone can join", "Riders join straight away."], ["approval", "Join by approval", "Riders ask to join and you or an admin decides."], ["invite", "Invite only", "Only riders you invite can join."]].map(([v, label, help]) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
            <input type="radio" name="join_policy" value={v} defaultChecked={(defaults.joinPolicy ?? "approval") === v} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
            <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{help}</span></span>
          </label>
        ))}
        <p className="text-xs text-muted">A private club is always invite only.</p>
      </fieldset>

      <label className="block text-sm">Member limit (including you)
        <input name="member_limit" type="number" required min="2" max="1000" defaultValue={defaults.memberLimit ?? 100} className={input} />
      </label>

      <p className="rounded-lg bg-sunken p-3 text-xs text-muted">
        Members who can see the club will see your display name and handle, and members see each other&apos;s. We do not verify clubs or riders.
      </p>
      <button className="rounded-lg bg-saffron px-6 font-semibold text-ink transition hover:bg-saffron-dark">{submitLabel}</button>
    </form>
  );
}

export function clubFormToRaw(f: FormData) {
  return {
    name: f.get("name") ?? "", slug: f.get("slug") ?? "", description: f.get("description") ?? "", city: f.get("city") ?? "", state: f.get("state") ?? "",
    visibility: f.get("visibility") ?? "", join_policy: f.get("join_policy") ?? "", member_limit: f.get("member_limit") ? Number(f.get("member_limit")) : NaN,
  };
}

export const CLUB_FIELD_ERRORS: Record<string, string> = {
  name: "Give the club a name of 3 to 60 characters.",
  slug: "The club link must be 3 to 30 letters, numbers or underscores, with at least one letter. Some words are reserved.",
  description: "The description must be 500 characters or fewer.",
  city: "City must be 60 characters or fewer.", state: "State must be 60 characters or fewer.",
  visibility: "Choose who can see the club.", join_policy: "Choose how riders join. A private club is invite only.",
  member_limit: "Choose a limit between 2 and 1,000. It cannot be below the current members.",
};
