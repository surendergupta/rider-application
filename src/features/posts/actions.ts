"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { createPost, deletePost, reportPost } from "./service";
import { safeReturnPath } from "./validation";

function back(returnTo: unknown, code: string): never {
  const path = safeReturnPath(returnTo);
  revalidatePath("/posts");
  if (path.startsWith("/clubs/")) revalidatePath(path);
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${code}`);
}

/** Every action checks the session itself: a Server Action can be called directly, not only from the page. */
export async function sendPostAction(formData: FormData) {
  const { supabase, user } = await requireSession();
  const returnTo = formData.get("returnTo");
  if (!rateLimit(`post-send:${user.id}`, 10, 60_000).allowed) back(returnTo, "rate");
  const club = String(formData.get("club") ?? "");
  const r = await createPost(supabase, club === "" ? null : club, {
    body: formData.get("body") ?? "", tripId: formData.get("tripId") ?? "", includeDestination: formData.get("includeDestination") ?? "",
  });
  back(returnTo, r.ok ? "posted" : r.code === "VALIDATION_ERROR" ? "post_invalid" : r.code);
}

export async function removePostAction(formData: FormData) {
  const { supabase, user } = await requireSession();
  const returnTo = formData.get("returnTo");
  if (!rateLimit(`post-remove:${user.id}`, 30, 60_000).allowed) back(returnTo, "rate");
  const r = await deletePost(supabase, formData.get("id"));
  back(returnTo, r.ok ? "post_removed" : r.code);
}

export async function reportPostAction(formData: FormData) {
  const { supabase, user } = await requireSession();
  const returnTo = formData.get("returnTo");
  if (!rateLimit(`post-report:${user.id}`, 5, 3_600_000).allowed) back(returnTo, "rate");
  const r = await reportPost(supabase, user.id, formData.get("id"), { reason: formData.get("reason"), note: formData.get("note") ?? "" });
  back(returnTo, r.ok ? "reported" : r.code === "VALIDATION_ERROR" ? "report_failed" : r.code);
}
