"use server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth-page";
import { actOnReport, isModerator, liftRestriction } from "./service";
import { parseTab } from "./validation";

function back(tab: unknown, code: string): never {
  revalidatePath("/moderation");
  const t = parseTab(tab);
  redirect(`/moderation${t === "open" ? "?" : `?tab=${t}&`}notice=${code}`);
}

/** Every action checks that the caller is a moderator itself: a Server Action can be called directly, not only from the page. */
async function requireModerator() {
  const { supabase, user } = await requireSession();
  if (!(await isModerator(supabase))) notFound();
  return { supabase, user };
}

export async function moderateAction(formData: FormData) {
  const { supabase, user } = await requireModerator();
  const tab = formData.get("tab");
  if (!rateLimit(`mod-act:${user.id}`, 60, 60_000).allowed) back(tab, "rate");
  const r = await actOnReport(supabase, {
    kind: formData.get("kind"), reportId: formData.get("reportId"), action: formData.get("action"),
    reason: formData.get("reason") ?? "", days: formData.get("days") ?? "",
  });
  back(tab, r.ok ? r.outcome : r.code === "VALIDATION_ERROR" ? "invalid" : r.code);
}

export async function liftRestrictionAction(formData: FormData) {
  const { supabase, user } = await requireModerator();
  if (!rateLimit(`mod-lift:${user.id}`, 30, 60_000).allowed) back("restrictions", "rate");
  const r = await liftRestriction(supabase, { userId: formData.get("userId"), reason: formData.get("reason") ?? "" });
  back("restrictions", r.ok ? "lifted" : r.code === "VALIDATION_ERROR" ? "invalid" : r.code);
}
