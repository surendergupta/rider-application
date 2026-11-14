import "server-only";
import { createClient, supabaseConfigured } from "@/lib/db/server";

export type WaitlistTopic = "marketplace" | "community";

/** Signed-in state and whether this user is on the waitlist for a topic. */
export async function waitlistState(topic: WaitlistTopic): Promise<{ signedIn: boolean; joined: boolean }> {
  if (!supabaseConfigured()) return { signedIn: false, joined: false };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { signedIn: false, joined: false };
  const { data: row } = await supabase.from("waitlist").select("topic").eq("topic", topic).maybeSingle();
  return { signedIn: true, joined: Boolean(row) };
}

/** Join (join = "yes") or leave the waitlist. Anonymous visitors are sent to sign up by the caller. */
export async function setWaitlistMembership(topic: WaitlistTopic, join: boolean): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return false;
  if (join) await supabase.from("waitlist").upsert({ user_id: data.user.id, topic }, { onConflict: "user_id,topic" });
  else await supabase.from("waitlist").delete().eq("topic", topic);
  return true;
}
