import Link from "next/link";
import { redirect } from "next/navigation";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { todayInIndia } from "@/features/garage/documents";
import { createRide } from "@/features/rides/service";
import { RIDE_FIELD_ERRORS, RideForm, rideFormToRaw } from "@/components/RideForm";

export const metadata = { title: "Host a ride · India Long-Ride Planner" };

async function createAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  if (!rateLimit(`ride-create:${user.id}`, 10, 60 * 60_000).allowed) redirect("/rides/new?error=rate");
  const r = await createRide(supabase, user.id, rideFormToRaw(formData));
  // Only fixed codes go in the URL, never free text.
  if (!r.ok) redirect(`/rides/new?error=${r.code}${r.field ? `&field=${encodeURIComponent(r.field)}` : ""}`);
  redirect(`/rides/${r.id}?notice=created`);
}

export default async function NewRidePage({ searchParams }: { searchParams: Promise<{ error?: string; field?: string }> }) {
  const { supabase, user } = await requireSession();
  const sp = await searchParams;
  const { data: profile } = await supabase.from("rider_profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!profile) redirect("/profile");

  const message = !sp.error ? null
    : sp.error === "VALIDATION_ERROR" ? RIDE_FIELD_ERRORS[sp.field ?? ""] ?? "Check the ride details."
    : sp.error === "rate" ? "You have created several rides in the last hour. Try again later."
    : sp.error === "profile_required" ? "Create a rider profile first."
    : sp.error === "account_restricted" ? "A moderator has restricted your account, so you cannot do this right now."
    : "Could not create the ride. Try again.";

  return (
    <main className="px-5 py-8">
      <Link href="/rides" className="tap text-sm underline">← Rides</Link>
      <h1 className="mt-2 text-2xl font-bold">Host a ride</h1>
      {message && <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{message}</p>}
      <RideForm action={createAction} submitLabel="Create ride" today={todayInIndia()} />
    </main>
  );
}
