import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ComingSoon } from "@/components/ComingSoon";
import { setWaitlistMembership, waitlistState } from "@/lib/waitlist";

export const metadata: Metadata = { title: "Community (what is next) · India Long-Ride Planner" };
export const dynamic = "force-dynamic";

async function setWaitlist(formData: FormData) {
  "use server";
  const ok = await setWaitlistMembership("community", formData.get("join") === "yes");
  if (!ok) redirect("/signup");
  revalidatePath("/community");
}

export default async function Community() {
  const { signedIn, joined } = await waitlistState("community");
  return (
    <ComingSoon
      title="Community posts and ride sharing"
      lead="Group rides, Find riders, riding clubs, community posts and completed-ride stories are live inside the app. Join the waitlist to hear about what comes next."
      planned={[
        "Notifications for invitations, requests and replies",
        "Comments on posts",
        "Ride RSVPs for a whole club",
        "Split trip expenses with the riders on a group ride",
      ]}
      safety={{
        heading: "Your privacy by default",
        body: "Your home address, location history and motorcycle documents will never be public. Trips stay private unless you choose to share them.",
      }}
      signedIn={signedIn}
      joined={joined}
      action={setWaitlist}
    />
  );
}
