# 07 — Monetization & Growth

**Version:** 2.0 · **Status:** Strategy and validation plan. **Nothing here is on sale.** Prices are hypotheses to test, not commitments.

## 1. Principles

1. **A free rider account must be genuinely useful forever.** Garage, service and document reminders, fuel tracking, basic trip budgets, checklists and (when built) community access stay free.
2. **Do not charge for record-keeping or for listing old gear.** Those features attract users and create retention.
3. **Charge when the product saves substantial effort,** coordinates a group or delivers useful analysis: complex tours, organised groups, ownership analytics.
4. **Validate before building payments.** The plan is to measure real interest first (see section 5), then specify payments properly.
5. **No unverified claims.** Do not advertise savings, "verified" items or accuracy the product does not have.

## 2. Plans to test

| Plan | Proposed price | For | Planned contents (none sold yet) |
|---|---|---|---|
| **Free Rider** | ₹0, permanent | Everyone | Garage, service logs and reminders, document expiry reminders, fuel tracking, basic trip budgets, checklists, offline map, shareable trip summary; community access once built |
| **Tour Pass** | ₹149 per trip | A rider planning one big tour | Advanced itinerary, group budget tools, detailed report export, extended preparation for a defined trip |
| **Rider Pro** | ₹199 per month; ₹1,499 per year being tested | Riders who tour often | Advanced trip tools across rides, ownership cost analysis, premium exports, enhanced route planning |
| **Club Pro** | ₹499 per club per month (pilot) | Ride organisers and clubs | Club dashboard, member management, ride scheduling, RSVP workflows, shared trip reporting |

**Why group pricing may work (hypothesis):** a club of 30 may pay ₹499/month collectively more readily than 30 riders paying ₹199 each, and organisers get recurring coordination value. This must be tested with real organisers.

**Prices are proposed validation prices.** GST treatment, payment fees, refunds and subscription terms are unresolved and must be settled before anything is sold.

## 3. Marketplace monetization

- **Start with free listings and no commission.** Competitors already promote free, zero-commission listing, so charging early would hurt supply.
- **Later options:** optional promoted listings, business storefronts, affiliate partnerships.
- **Promotions must be clearly labelled** and must never override safety moderation or category rules (see `08-TRUST-SAFETY-AND-MODERATION.md`).
- No escrow, wallet or platform-held settlement in the first version.

## 4. Illustrative revenue arithmetic

This only shows how the numbers combine. It is **not a forecast**.

| Assumption | Value | Monthly gross |
|---|---|---|
| Rider Pro subscribers | 150 x ₹199 | ₹29,850 |
| Club Pro clubs | 20 x ₹499 | ₹9,980 |
| **Subscription MRR** | | **₹39,830** |
| Tour Passes sold per month (one-off, not recurring) | 100 x ₹149 | ₹14,900 |
| **Illustrative gross** | | **₹54,730** |

Before GST, payment fees, refunds, hosting, map and routing costs, support, marketing, churn and any staff cost. Reaching 150 paying subscribers needs a much larger active base: at the 3% paid-conversion pilot target that is about 5,000 eligible active users.

## 5. Validation before payments (what exists today)

- The public **Pricing** page shows the four plans and records, for each signed-in user, which plan they would choose (`pro_interest`, one row per user). **No payment data is collected and nothing is charged.** Features on it are labelled "(coming)".
- **Waitlists** for Community and the Marketplace (`waitlist`, one row per user per topic).
- These counts, together with rider interviews, decide what to build next. Treat interest as a weak signal: clicking a button is not paying.

## 6. Metrics and gates

| KPI | Pilot target | What it proves |
|---|---|---|
| Onboarding completion | at least 70% | First-run usability |
| Garage creation among onboarded users | at least 60% | Rider setup value |
| First trip or expense recorded | at least 40% | Core activation |
| Day-30 retained users | at least 20% | Repeat usefulness |
| Paid conversion among eligible active users | at least 3% | Monetization signal |
| Marketplace reports reviewed within 24 h | at least 95% | Moderation readiness |

These are proposed starting targets, not industry benchmarks. Adjust with real cohort data. The headline metric should be **monthly riders completing a meaningful action** (logging a service, planning a trip, coordinating a ride, completing a marketplace interaction), not registrations.

## 7. Reasons to come back (retention)

| Frequency | Reason |
|---|---|
| Daily | Check garage, add fuel |
| Weekly | Plan outings, update expenses |
| Monthly | Service and document reminders, ownership costs |
| Before touring | Itinerary, budget, checklist |
| After touring | Reconcile expenses, save history, share |
| Occasionally | Buy or sell used accessories |

Long tours happen only a few times a year, so the **garage and reminders** carry day-to-day retention. The Home dashboard ("Needs attention") exists for this reason.

## 8. Competitive position

The strategy research found existing products with overlapping scope (a touring/community/marketplace app, a free fuel and service logger with paid analytics, and rider-to-rider marketplaces with free listings). **Verify these facts again before using them in any public material.** Our position must rest on **better integrated workflows, useful India-specific information and reliable execution**, never on claiming nobody else offers these features.

## 9. Before charging anyone

A separate payment and entitlement specification is required, covering: provider choice, webhook signature verification and idempotent event processing, server-side entitlements and plan limits, renewals, cancellations, refunds, invoices and GST, dispute handling, and what happens to paid features when an account is deleted. Do not start it until the interest data and pilot gates justify it.
