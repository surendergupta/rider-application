import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of Use · India Long-Ride Planner" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Use" updated="14 November 2026">
      <h2>1. What this service is</h2>
      <p>India Long-Ride Planner is a tool for planning motorcycle trip budgets, recording your own expenses and tracking bike maintenance. It is a planning aid, not a navigation system.</p>

      <h2>2. Estimates are not guarantees</h2>
      <p>Budgets are calculated from the distance, mileage and prices you enter. Route, toll, fuel, stay and weather information may be wrong, incomplete or out of date. Verify routes and local conditions yourself before every ride. Service reminders are guidance based on intervals you set; follow your motorcycle manufacturer&apos;s manual.</p>

      <h2>3. Ride safely</h2>
      <p>Do not use the app while riding. Log expenses and plan only when you have stopped in a safe place. You are responsible for your own safety, your vehicle and obeying the law.</p>

      <h2>4. Your account</h2>
      <ul>
        <li>You are responsible for keeping your password secure and for activity under your account.</li>
        <li>Give accurate information and do not misuse the service, attempt to access other users&apos; data, or overload it.</li>
        <li>You can delete your account and all its data at any time from the Account page.</li>
      </ul>

      <h2>5. Your data</h2>
      <p>You own what you enter. We use it only to provide the service, as described in the Privacy Policy.</p>

      <h2>6. Availability and liability</h2>
      <p>The service is provided as is, without warranties, and may change or be unavailable at times. To the extent the law allows, we are not liable for losses arising from reliance on estimates, route information or service reminders, or from trip decisions you make.</p>

      <h2>7. Changes</h2>
      <p>We may update these terms. Continued use after an update means you accept the new terms.</p>
    </LegalPage>
  );
}
