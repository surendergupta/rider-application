import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { getClubDetail, updateClub } from "@/features/clubs/service";
import { CLUB_FIELD_ERRORS, ClubForm, clubFormToRaw } from "@/components/ClubForm";

export const metadata = { title: "Edit club · India Long-Ride Planner" };

async function updateAction(formData: FormData) {
  "use server";
  const { supabase, user } = await requireSession();
  const slug = String(formData.get("club_slug"));
  if (!rateLimit(`club-edit:${user.id}`, 30, 60_000).allowed) redirect(`/clubs/${slug}/edit?error=rate`);
  const r = await updateClub(supabase, user.id, slug, clubFormToRaw(formData));   // only the owner's club matches; anyone else gets "not found"
  if (!r.ok) redirect(`/clubs/${slug}/edit?error=${r.code}${r.field ? `&field=${encodeURIComponent(r.field)}` : ""}`);
  revalidatePath(`/clubs/${slug}`);
  redirect(`/clubs/${slug}?notice=saved`);
}

export default async function EditClubPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; field?: string }> }) {
  const { supabase, user } = await requireSession();
  const { slug } = await params;
  const sp = await searchParams;
  const detail = await getClubDetail(supabase, user.id, slug);
  if (!detail || !detail.isOwner) notFound();                    // only the owner edits; everyone else sees a plain 404
  const c = detail.club;
  const message = !sp.error ? null
    : sp.error === "VALIDATION_ERROR" ? CLUB_FIELD_ERRORS[sp.field ?? ""] ?? "Check the club details."
    : sp.error === "limit_below_members" ? "The limit cannot be lower than the current members."
    : sp.error === "rate" ? "Too many saves. Try again in a minute."
    : "Could not save the club. Try again.";

  return (
    <main className="px-5 py-8">
      <Link href={`/clubs/${c.slug}`} className="tap text-sm underline">← Back to the club</Link>
      <h1 className="mt-2 text-2xl font-bold">Edit club</h1>
      {message && <p role="alert" className="mt-4 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">{message}</p>}
      <ClubForm editing action={updateAction} hidden={{ club_slug: c.slug }} submitLabel="Save changes"
        defaults={{ name: c.name, slug: c.slug, description: c.description, city: c.city, state: c.state, visibility: c.visibility, joinPolicy: c.joinPolicy, memberLimit: c.memberLimit }} />
    </main>
  );
}
