import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";

async function deleteAccount(formData: FormData) {
  "use server";
  if (String(formData.get("confirm")).trim() !== "DELETE") redirect("/account?error=confirm");

  // Identify the user from their verified session; never from form input.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  // Deleting the auth user cascades to every table (all user_id FKs are ON DELETE CASCADE).
  const { error } = await createAdminClient().auth.admin.deleteUser(data.user.id);
  if (error) redirect("/account?error=failed");

  await supabase.auth.signOut();
  redirect("/login?notice=deleted");
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold">Account</h1>
      <p className="mt-1 text-sm text-muted">{data.user?.email}</p>

      <section className="mt-6 rounded-xl border border-line p-5">
        <h2 className="font-semibold">Rider profile</h2>
        <p className="mt-1 text-sm text-muted">Optional. Create a public profile with a handle and a short bio. It is private until you turn it on.</p>
        <Link href="/profile" className="tap mt-2 text-sm font-semibold text-link underline">Manage rider profile</Link>
      </section>

      <section className="mt-8 rounded-xl border border-danger-fg/30 bg-danger-bg p-5">
        <h2 className="font-semibold text-danger-fg">Delete account and all data</h2>
        <p className="mt-2 text-sm text-fg">
          This permanently deletes your bikes, trips, budgets, expenses and maintenance records, and your login. It cannot be undone.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger-fg">
            {error === "confirm" ? "Type DELETE exactly to confirm." : "Could not delete the account. Try again."}
          </p>
        )}
        <form action={deleteAccount} className="mt-4 space-y-3">
          <label className="block text-sm">
            Type <strong>DELETE</strong> to confirm
            <input name="confirm" autoComplete="off" required
              className="mt-1 w-full rounded-lg border border-line-strong p-2 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200" />
          </label>
          <button className="rounded-lg bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-700">Delete everything</button>
        </form>
      </section>
    </main>
  );
}
