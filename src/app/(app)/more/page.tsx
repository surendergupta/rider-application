import Link from "next/link";
import { requireSession } from "@/lib/auth-page";
import { isModerator } from "@/features/moderation/service";

export const metadata = { title: "More · India Long-Ride Planner" };

const LINKS = [
  { href: "/posts", title: "Community posts", text: "Road reports, tips and completed rides" },
  { href: "/clubs", title: "Clubs", text: "Join or start a riding club" },
  { href: "/riders", title: "Find riders", text: "Riders who chose to be listed" },
  { href: "/map", title: "Offline map", text: "A free map of India you can save to your phone" },
  { href: "/profile", title: "Rider profile", text: "Your handle, bio and what other riders can see" },
  { href: "/account", title: "Account", text: "Your login and deleting your data" },
  { href: "/pricing", title: "Plans", text: "What is free and what is planned" },
  { href: "/marketplace", title: "Gear marketplace", text: "Coming soon: pre-owned touring gear" },
];

export default async function MorePage() {
  const { supabase } = await requireSession();
  const links = (await isModerator(supabase)) ? [{ href: "/moderation", title: "Moderation", text: "Reports, takedowns and the audit log" }, ...LINKS] : LINKS;
  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">More</h1>
      <ul className="mt-5 space-y-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-11 items-center justify-between rounded-xl border border-line p-4 transition hover:bg-sunken">
              <span><span className="block font-semibold">{l.title}</span><span className="block text-sm text-muted">{l.text}</span></span>
              <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
