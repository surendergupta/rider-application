"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item { href: string; label: string; icon: string; also?: string[] }

// Phone tab bar: five places. "More" collects everything else.
const TABS: Item[] = [
  { href: "/home", label: "Home", icon: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" },
  { href: "/trips", label: "Trips", icon: "M9 20l-5 2V6l5-2 6 2 5-2v16l-5 2zM9 4v16M15 6v16" },
  { href: "/rides", label: "Rides", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" },
  { href: "/bikes", label: "Garage", icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z" },
  { href: "/more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01", also: ["/map", "/account", "/profile", "/riders", "/clubs", "/posts"] },
];

// Wider screens have room for the same places as direct links.
const TOP: Item[] = [
  { href: "/home", label: "Home", icon: "" }, { href: "/trips", label: "Trips", icon: "" }, { href: "/rides", label: "Rides", icon: "" },
  { href: "/bikes", label: "Garage", icon: "" }, { href: "/clubs", label: "Clubs", icon: "" }, { href: "/riders", label: "Riders", icon: "" }, { href: "/map", label: "Map", icon: "" },
  { href: "/account", label: "Account", icon: "", also: ["/profile"] },
];

const isActive = (path: string, i: Item) => [i.href, ...(i.also ?? [])].some((h) => path === h || path.startsWith(h + "/"));

/** Top links for wider screens. Hidden on phones, where the bottom tab bar is used. */
export function TopNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
      {TOP.map((i) => (
        <Link key={i.href} href={i.href} aria-current={isActive(path, i) ? "page" : undefined}
          className={`flex min-h-11 items-center rounded-lg px-3 transition hover:bg-white/10 hover:text-white ${isActive(path, i) ? "bg-white/10 font-semibold text-white" : "text-white/80"}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Thumb-reach tab bar for phones. Every target is at least 44px. */
export function BottomTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-road pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {TABS.map((i) => {
          const active = isActive(path, i);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${active ? "text-accent" : "text-white/70 hover:text-white"}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={i.label === "More" ? 3 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={i.icon} />
                </svg>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
