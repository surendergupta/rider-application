import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/db/server";
import { rateLimit } from "@/lib/rate-limit";
import { ProfileCard, Avatar } from "@/components/ProfileCard";
import {
  deleteProfile, disableProfile, getOwnProfile, listBlocked, listOwnBikes, loadPublicProfile, saveProfile, unblockRider,
} from "@/features/profile/service";
import { profilePath } from "@/features/profile/public";
import { AVATAR_COLORS, HANDLE_COOLDOWN_DAYS, INTERESTS, canChangeHandle, initialsOf, type AvatarColor } from "@/features/profile/validation";

export const metadata = { title: "Rider profile · India Long-Ride Planner" };

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}

async function saveAction(formData: FormData) {
  "use server";
  const { supabase, user } = await session();
  if (!rateLimit(`profile-save:${user.id}`, 20, 60_000).allowed) redirect("/profile?error=rate");
  const raw = {
    handle: formData.get("handle") ?? "",
    display_name: formData.get("display_name") ?? "",
    bio: formData.get("bio") ?? "",
    location_city: formData.get("location_city") ?? "",
    location_state: formData.get("location_state") ?? "",
    interests: formData.getAll("interests").map(String),
    avatar_color: formData.get("avatar_color") ?? "",
    is_public: formData.get("is_public") === "true",
    show_motorcycle: formData.get("show_motorcycle") === "on",
    featured_bike_id: formData.get("featured_bike_id") ? String(formData.get("featured_bike_id")) : null,
    show_stats: formData.get("show_stats") === "on",
    discoverable: formData.get("discoverable") === "on",
  };
  const r = await saveProfile(supabase, user.id, raw);
  revalidatePath("/profile");
  // Only fixed codes go in the URL, never free text, so a crafted link cannot put words on this page.
  redirect(r.ok ? "/profile?saved=1" : `/profile?error=${r.code}${r.field ? `&field=${encodeURIComponent(r.field)}` : ""}`);
}

async function disableAction() {
  "use server";
  const { supabase, user } = await session();
  await disableProfile(supabase, user.id);
  revalidatePath("/profile");
  redirect("/profile?saved=disabled");
}

async function deleteAction() {
  "use server";
  const { supabase, user } = await session();
  await deleteProfile(supabase, user.id);
  revalidatePath("/profile");
  redirect("/profile?saved=deleted");
}

async function unblockAction(formData: FormData) {
  "use server";
  const { supabase, user } = await session();
  await unblockRider(supabase, user.id, String(formData.get("handle") ?? ""));
  revalidatePath("/profile");
  redirect("/profile?saved=unblocked");
}

const FIELD_ERRORS: Record<string, string> = {
  handle: "Handle must be 3 to 20 characters: letters, numbers and underscores, with at least one letter. Some words are reserved.",
  display_name: "Enter a display name of up to 50 characters.",
  bio: "Bio must be 300 characters or fewer.",
  location_city: "City must be 60 characters or fewer.",
  location_state: "State must be 60 characters or fewer.",
  interests: "Pick up to 6 interests from the list.",
  avatar_color: "Pick an avatar colour from the list.",
  featured_bike_id: "Choose which motorcycle to show, or turn the motorcycle off.",
};
const CODE_ERRORS: Record<string, string> = {
  HANDLE_TAKEN: "That handle is already taken. Try another.",
  HANDLE_COOLDOWN: `You can change your handle once every ${HANDLE_COOLDOWN_DAYS} days.`,
  rate: "Too many saves. Wait a minute and try again.",
  INTERNAL_ERROR: "Could not save your profile. Try again.",
};
const SAVED: Record<string, string> = {
  "1": "Profile saved.", disabled: "Your profile is now private. Nobody else can see it.",
  deleted: "Your rider profile was deleted and the handle is free again.", unblocked: "Rider unblocked.",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string; field?: string; saved?: string }> }) {
  const { supabase, user } = await session();
  const sp = await searchParams;
  const [profile, bikes, blocked] = await Promise.all([getOwnProfile(supabase, user.id), listOwnBikes(supabase), listBlocked(supabase)]);
  const view = profile ? await loadPublicProfile(profile.handle, user.id) : null;

  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");

  const cooldown = profile ? canChangeHandle(profile.handle_changed_at) : { allowed: true, nextAllowedAt: null };
  const message = sp.error
    ? (sp.error === "VALIDATION_ERROR" ? FIELD_ERRORS[sp.field ?? ""] ?? "Check your details and try again." : CODE_ERRORS[sp.error] ?? "Could not save your profile.")
    : null;
  const input = "mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-saffron focus:outline-none focus:ring-2 focus:ring-saffron/30";
  const isPublic = profile?.is_public ?? false;

  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">Rider profile</h1>
      <p className="mt-1 text-sm text-muted">
        Optional and private by default. Nothing is shown to other riders until you choose Public. We never show your email, phone, address,
        registration number or your trips.
      </p>

      {sp.saved && SAVED[sp.saved] && <p role="status" className="mt-4 rounded-lg bg-success-bg p-3 text-sm text-success-fg">{SAVED[sp.saved]}</p>}
      {message && <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{message}</p>}

      <section className="mt-6" aria-labelledby="preview">
        <div className="flex items-center justify-between gap-3">
          <h2 id="preview" className="text-lg font-semibold">Preview</h2>
          {profile && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isPublic ? "bg-success-bg text-success-fg" : "bg-warn-bg text-warn-fg"}`} data-testid="visibility-chip">
              {isPublic ? "Public" : "Private: only you can see it"}
            </span>
          )}
        </div>
        {view ? (
          <div className="mt-3">
            <ProfileCard profile={view.profile} />
            <p className="mt-2 text-xs text-muted">This is the saved version, exactly as other riders see it.</p>
            <p className="mt-3 break-all text-sm">
              Profile link: <span className="select-all font-medium" data-testid="profile-link">{`${proto}://${host}${profilePath(profile!.handle)}`}</span>
            </p>
            <Link href={profilePath(profile!.handle)} className="tap mt-1 text-sm font-semibold text-link underline">
              {isPublic ? "Open public page" : "Open private preview"}
            </Link>
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-sunken p-4 text-sm text-muted">You have not created a rider profile yet. Fill in the form below to start. It stays private until you turn it on.</p>
        )}
      </section>

      <form action={saveAction} className="mt-8 space-y-6">
        <section aria-labelledby="identity" className="space-y-4">
          <h2 id="identity" className="text-lg font-semibold">Public identity</h2>
          <label className="block text-sm">Handle
            <div className="mt-1 flex items-center rounded-lg border border-line-strong focus-within:ring-2 focus-within:ring-saffron/30">
              <span className="pl-3 text-muted" aria-hidden="true">@</span>
              <input name="handle" required minLength={3} maxLength={21} defaultValue={profile?.handle ?? ""} readOnly={!cooldown.allowed}
                autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="handle-help"
                className="w-full rounded-lg border-0 bg-transparent p-2 focus:outline-none read-only:opacity-70" />
            </div>
            <span id="handle-help" className="mt-1 block text-xs text-muted">
              {cooldown.allowed
                ? `3 to 20 letters, numbers or underscores. After your first change you can change it once every ${HANDLE_COOLDOWN_DAYS} days.`
                : `You can change your handle again on ${cooldown.nextAllowedAt!.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`}
            </span>
          </label>
          <label className="block text-sm">Display name
            <input name="display_name" required maxLength={50} defaultValue={profile?.display_name ?? ""} className={input} />
          </label>
          <fieldset>
            <legend className="text-sm">Avatar colour</legend>
            <p className="text-xs text-muted">Your avatar shows your initials. Photo upload is not available yet.</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {(Object.keys(AVATAR_COLORS) as AvatarColor[]).map((c) => (
                <label key={c} className="relative cursor-pointer">
                  <input type="radio" name="avatar_color" value={c} defaultChecked={(profile?.avatar_color ?? "orange") === c} className="peer sr-only" />
                  <span className="grid rounded-full p-1 ring-2 ring-transparent peer-checked:ring-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                    <Avatar initials={initialsOf(profile?.display_name ?? "Rider")} color={c} size={44} />
                  </span>
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">Bio (optional, up to 300 characters)
            <textarea name="bio" rows={3} maxLength={300} defaultValue={profile?.bio ?? ""} className={input} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">City (optional)
              <input name="location_city" maxLength={60} defaultValue={profile?.location_city ?? ""} className={input} />
            </label>
            <label className="block text-sm">State (optional)
              <input name="location_state" maxLength={60} defaultValue={profile?.location_state ?? ""} className={input} />
            </label>
          </div>
          <p className="text-xs text-muted">City and state only. Never enter an address.</p>
        </section>

        <fieldset className="space-y-2">
          <legend className="text-lg font-semibold">My riding interests</legend>
          <p className="text-xs text-muted">Pick up to 6.</p>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => (
              <label key={i.id} className="relative cursor-pointer">
                <input type="checkbox" name="interests" value={i.id} defaultChecked={profile?.interests?.includes(i.id)} className="peer sr-only" />
                <span className="flex min-h-11 items-center rounded-full border border-line-strong px-4 text-sm transition peer-checked:border-accent peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-on-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                  {i.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby="show" className="space-y-4">
          <h2 id="show" className="text-lg font-semibold">What other riders can see</h2>
          <fieldset>
            <legend className="text-sm font-medium">Profile visibility</legend>
            <div className="mt-2 grid gap-2">
              {[["false", "Private", "Only you can see it. This is the default."], ["true", "Public", "Anyone with your link can see the details you choose below."]].map(([v, label, help]) => (
                <label key={v} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
                  <input type="radio" name="is_public" value={v} defaultChecked={String(isPublic) === v} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                  <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{help}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-lg border border-line p-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" name="discoverable" defaultChecked={profile?.discoverable} className="h-4 w-4 accent-[var(--accent)]" />
              List me in Find riders
            </label>
            <p className="mt-1 text-xs text-muted">Lets signed-in riders find you by name, state or interest. Needs a Public profile. Off by default.</p>
          </div>

          <div className="rounded-lg border border-line p-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" name="show_motorcycle" defaultChecked={profile?.show_motorcycle} className="h-4 w-4 accent-[var(--accent)]" />
              Show my motorcycle
            </label>
            {bikes.length > 0 ? (
              <label className="mt-2 block text-sm">Which one
                <select name="featured_bike_id" defaultValue={profile?.featured_bike_id ?? ""} className={input}>
                  <option value="">Choose a motorcycle</option>
                  {bikes.map((b) => <option key={b.id} value={b.id}>{[b.make, b.model].filter(Boolean).join(" ") || b.display_name}</option>)}
                </select>
              </label>
            ) : (
              <p className="mt-1 text-xs text-muted">Add a motorcycle in your <Link href="/bikes" className="underline">Garage</Link> first.</p>
            )}
            <p className="mt-2 text-xs text-muted">Only the make and model are shown. Never your bike&apos;s name, odometer, registration number or documents.</p>
          </div>

          <div className="rounded-lg border border-line p-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" name="show_stats" defaultChecked={profile?.show_stats} className="h-4 w-4 accent-[var(--accent)]" />
              Show my ride statistics
            </label>
            <p className="mt-1 text-xs text-muted">Totals only: completed rides, kilometres and number of places. Never your routes, dates or expenses.</p>
          </div>
        </section>

        <button className="rounded-lg bg-saffron px-6 font-semibold text-ink transition hover:bg-saffron-dark">
          {profile ? "Save profile" : "Create profile"}
        </button>
      </form>

      {profile && (
        <section className="mt-10 space-y-3" aria-labelledby="manage">
          <h2 id="manage" className="text-lg font-semibold">Manage</h2>
          {isPublic && (
            <form action={disableAction}>
              <button className="rounded-lg border border-line-strong px-4 text-sm font-medium hover:bg-sunken">Disable profile (make it private)</button>
            </form>
          )}
          <form action={deleteAction}>
            <button className="rounded-lg border border-danger-fg/40 px-4 text-sm font-medium text-danger-fg hover:bg-danger-bg">Delete rider profile</button>
          </form>
        </section>
      )}

      <section className="mt-10" aria-labelledby="blocked">
        <h2 id="blocked" className="text-lg font-semibold">Blocked riders</h2>
        {blocked.length === 0 ? (
          <p className="mt-2 text-sm text-muted">You have not blocked anyone.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {blocked.map((b, i) => (
              <li key={b.handle ?? i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{b.handle ? `@${b.handle}` : "Rider no longer available"}</span>
                {b.handle && (
                  <form action={unblockAction}>
                    <input type="hidden" name="handle" value={b.handle} />
                    <button className="text-sm underline" aria-label={`Unblock @${b.handle}`}>Unblock</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
