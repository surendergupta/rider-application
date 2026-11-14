import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · India Long-Ride Planner" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="14 November 2026">
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address and a securely hashed password.</li>
        <li><strong>What you enter:</strong> bikes, trips (names, origin and destination labels, dates, distances), budgets, expenses and maintenance records.</li>
        <li><strong>Technical:</strong> a session cookie that keeps you signed in, and basic server logs for reliability and security.</li>
      </ul>

      <h2>What we do not collect</h2>
      <ul>
        <li>We do not track your live location or GPS while you ride.</li>
        <li>We do not connect to your bank, UPI or payment accounts, and we do not store receipts or payment details.</li>
        <li>We do not sell your data or show advertising.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to run the service for you: showing your trips and budgets, calculating totals and keeping your account secure. Trips and routes can reveal where you travel, so they are private to your account and never published.</p>

      <h2>Where it is stored</h2>
      <p>Data is stored with our database provider, Supabase, with access rules that limit every record to its owner. Passwords are never visible to us.</p>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Delete:</strong> use the Account page to permanently delete your account and all your data. This cannot be undone.</li>
        <li><strong>Backups:</strong> deleted data may remain in provider backups for a limited period before it is overwritten.</li>
      </ul>

      <h2>Analytics</h2>
      <p>We do not currently use third-party analytics. If we add it, we will ask for consent where required and will not send trip, route or location details.</p>

      <h2>Contact</h2>
      <p>Questions or requests about your data: contact the service operator at the support address shown on the website.</p>
    </LegalPage>
  );
}
