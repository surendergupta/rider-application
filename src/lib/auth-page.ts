import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";

/** For pages and server actions that need a signed-in rider. Sends everyone else to the login page. */
export async function requireSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return { supabase, user: data.user };
}
