import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { BottomTabs, TopNav } from "@/components/AppNav";
import { ThemeToggle } from "@/components/ThemeToggle";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas pb-24 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-line bg-road text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <Link href="/home" aria-label="Long-Ride Planner home" className="flex min-h-11 items-center gap-2 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-saffron text-ink" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5.5" cy="17" r="3" /><circle cx="18.5" cy="17" r="3" /><path d="M5.5 17 9 9h4l2 4h3.5M9 9 7.5 6H6" />
              </svg>
            </span>
            <span className="hidden sm:inline">Long-Ride Planner</span>
          </Link>
          <TopNav />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <form action={signOut}>
              <button className="whitespace-nowrap rounded-lg border border-white/25 px-3 text-sm text-white/85 hover:bg-white/10 hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-line [&>main]:mx-0 [&>main]:max-w-none">
          {children}
        </div>
      </div>
      <BottomTabs />
    </div>
  );
}
