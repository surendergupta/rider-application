import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ComingSoon } from "@/components/ComingSoon";
import { setWaitlistMembership, waitlistState } from "@/lib/waitlist";

export const metadata: Metadata = { title: "Rider gear marketplace (coming soon) · India Long-Ride Planner" };
export const dynamic = "force-dynamic";

async function setWaitlist(formData: FormData) {
  "use server";
  const ok = await setWaitlistMembership("marketplace", formData.get("join") === "yes");
  if (!ok) redirect("/signup");
  revalidatePath("/marketplace");
}

export default async function Marketplace() {
  const { signedIn, joined } = await waitlistState("marketplace");
  return (
    <ComingSoon
      title="Rider-to-rider gear marketplace"
      lead="Experienced riders sell touring gear they no longer use. New riders get what their checklist says they still need, for less. It is not built yet. Join the waitlist and we will build it for the people who ask."
      planned={[
        "List old touring luggage, rain gear, accessories and eligible riding apparel",
        "Browse by category, size, brand and budget",
        "Contact sellers through the app, without sharing your number",
        "Mark items available, reserved or sold",
        "Report suspicious listings; moderators can remove them",
      ]}
      safety={{
        heading: "Safety first: what will not be listed",
        body: "Used helmets, damaged protective equipment, counterfeit goods and safety-critical components will be prohibited or tightly restricted. Hidden damage and an unknown crash history can make them dangerous for the next rider. We will not label an item 'verified' unless a documented verification process exists. The first version has no payments, escrow or shipping: buyers and sellers arrange that themselves, with clear fraud warnings.",
      }}
      signedIn={signedIn}
      joined={joined}
      action={setWaitlist}
    />
  );
}
