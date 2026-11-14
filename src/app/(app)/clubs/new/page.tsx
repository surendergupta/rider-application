import Link from "next/link";
import { redirect } from "next/navigation";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { createClub } from "@/features/clubs/service";
import { CLUB_FIELD_ERRORS, ClubForm, clubFormToRaw } from "@/components/ClubForm";

export const metadata = { title: "Start a club · India Long-Ride Planner" };

async function createAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  if (!rateLimit(`club-create:${user.id}`, 5, 60 * 60_000).allowed) redirect("/clubs/new?error=rate");
  const r = await createClub(supabase, user.id, clubFormToRaw(formData));
  // Only fixed codes go in the URL, never free text.
  if (!r.ok) redirect(`/clubs/new?error=${r.code}${r.field ? `&field=${encodeURIComponent(r.field)}` : ""}`);
  redirect(`/clubs/${r.slug}?notice=created`);
}

export default async function NewClubPage({ searchParams }: { searchParams: Promise<{ error?: string; field?: string }> }) {
  const { supabase, user } = await requireSession();
  const sp = await searchParams;
  const { data: profile } = await supabase.from("rider_profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!profile) redirect("/profile");

  const message = !sp.error ? null
    : sp.error === "VALIDATION_ERROR" ? CLUB_FIELD_ERRORS[sp.field ?? ""] ?? "Check the club details."
    : sp.error === "SLUG_TAKEN" ? "That club link is already taken. Try another."
    : sp.error === "rate" ? "You started several clubs in the last hour. Try again later."
    : sp.error === "profile_required" ? "Create a rider profile first."
    : sp.error === "account_restricted" ? "A moderator has restricted your account, so you cannot do this right now."
    : "Could not create the club. Try again.";

  return (
    <main className="px-5 py-8">
      <Link href="/clubs" className="tap text-sm underline">← Clubs</Link>
      <h1 className="mt-2 text-2xl font-bold">Start a club</h1>
      {message && <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{message}</p>}
      <ClubForm action={createAction} submitLabel="Create club" />
    </main>
  );
}
