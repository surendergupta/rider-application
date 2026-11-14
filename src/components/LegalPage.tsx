import Link from "next/link";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-road text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="tap font-bold">Long-Ride Planner</Link>
          <Link href="/login" className="tap text-sm text-white/80 hover:text-white">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <article className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-line sm:p-10 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-fg [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ul]:text-fg">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="!mt-1 text-sm text-muted">Last updated {updated}</p>
          {children}
          <p className="mt-10 rounded-lg bg-warn-bg p-3 text-xs text-warn-fg">
            Draft: this text describes how the product works today. Have it reviewed by a qualified lawyer before public launch.
          </p>
        </article>
      </main>
    </div>
  );
}
