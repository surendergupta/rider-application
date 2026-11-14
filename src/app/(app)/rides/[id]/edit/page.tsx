import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { todayInIndia } from "@/features/garage/documents";
import { getRideDetail, updateRide } from "@/features/rides/service";
import { RIDE_FIELD_ERRORS, RideForm, rideFormToRaw } from "@/components/RideForm";

export const metadata = { title: "Edit ride · India Long-Ride Planner" };

async function updateAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  const id = String(formData.get("ride_id"));
  if (!rateLimit(`ride-edit:${user.id}`, 30, 60_000).allowed) redirect(`/rides/${id}/edit?error=rate`);
  const r = await updateRide(supabase, user.id, id, rideFormToRaw(formData));
  if (!r.ok) redirect(`/rides/${id}/edit?error=${r.code}${r.field ? `&field=${encodeURIComponent(r.field)}` : ""}`);
  revalidatePath(`/rides/${id}`);
  redirect(`/rides/${id}?notice=saved`);
}

export default async function EditRidePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; field?: string }> }) {
  const { supabase, user } = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const detail = await getRideDetail(supabase, user.id, id);
  if (!detail || !detail.isHost) notFound();                      // only the host edits; everyone else sees a plain 404
  const r = detail.ride;
  const message = !sp.error ? null
    : sp.error === "VALIDATION_ERROR" ? RIDE_FIELD_ERRORS[sp.field ?? ""] ?? "Check the ride details."
    : sp.error === "capacity_below_going" ? "You cannot set the limit below the riders already going."
    : sp.error === "rate" ? "Too many saves. Try again in a minute."
    : "Could not save the ride. Try again.";

  return (
    <main className="px-5 py-8">
      <Link href={`/rides/${id}`} className="tap text-sm underline">← Back to the ride</Link>
      <h1 className="mt-2 text-2xl font-bold">Edit ride</h1>
      {message && <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{message}</p>}
      <RideForm action={updateAction} hidden={{ ride_id: id }} submitLabel="Save changes" today={todayInIndia()} defaults={{
        title: r.title, description: r.description, area: r.area, destination: r.destination, startsOn: r.startsOn, startTime: r.startTime, endsOn: r.endsOn,
        visibility: r.visibility, requiresApproval: r.requiresApproval, maxRiders: r.maxRiders, distanceKm: r.distanceKm,
        meetingPoint: detail.meetingPoint, hostNote: detail.hostNote,
      }} />
    </main>
  );
}
