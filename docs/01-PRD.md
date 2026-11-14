# 01 — Product Requirements Document (PRD)

**Product:** India Long-Ride Planner + Expense Tracker  
**Version:** 1.0 · **Date:** 2026-11-14 · **Status:** Proposed, pending discovery

## 1. Problem and opportunity

Indian motorcycle riders planning 500+ km rides commonly split their process across maps, fuel-price lookups, notes, spreadsheets, messaging apps and maintenance diaries. This makes cost predictions hard to audit and actual trip spending hard to compare against budget. The proposed product unifies **plan → budget → ride expenses → trip review → bike maintenance** in a mobile-first workflow.

**Unverified hypotheses:** Indian data coverage in competitors is insufficient; better budgeting may save ₹1,000–₹3,000 per trip; riders will pay for advanced planning. Research must confirm or reject these claims. Do not market them as established outcomes.

## 2. Target users and jobs to be done

| Persona | Job | Pain | MVP solution |
|---|---|---|---|
| Weekend distance rider | Estimate a 500–1,000 km ride budget | Fuel/food/toll estimates scattered | Route distance and editable cost worksheet |
| Touring rider | Log multi-day costs | Cash receipts and small items forgotten | Fast categorized entry; trip overview |
| Motorcycle owner | Track service spend and interval | Service notes lost | Mileage-based service log and due forecast |
| First-time long-distance rider | See likely spend before departure | Unknown assumptions | Transparent range and editable defaults |

**Priority:** Indian riders using Android/mobile browsers, budget-sensitive, English-first with Hindi-ready copy. No assumption that every rider has continuous internet access.

## 3. Value proposition and principles

- **Transparent instead of falsely precise:** display inputs, source, freshness, assumptions and confidence of estimates.
- **Fast at the roadside:** entry in a few taps when safely stopped.
- **India-aware:** INR, kilometre, litre, Indian cities/addresses, toll category limitations and varied network coverage.
- **Privacy by default:** no continuous location tracking or financial account sync required.
- **Offline-aware, not offline-claimed:** last loaded information may remain visible; full offline editing/sync is a later milestone after robust conflict handling.

## 4. Goals and measurable outcomes

| Metric | Pilot target / rule |
|---|---|
| Discovery | 20–30 interviews; 50 responses; record actual frequency and priority of pain points |
| Activation | ≥60% of invited testers create bike + first trip (hypothesis) |
| Core utility | ≥50% of activated pilot users log ≥1 expense |
| Task time | Typical expense entry ≤30 sec in usability test (excluding login) |
| Reliability | 0 known critical authorization/data-loss defects before pilot |
| Route quality | User validates displayed start/end, waypoints and route distance; errors easy to report |
| Retention | Track 30-day return/second-trip rate; no fabricated target until baseline |

Waitlist of 100–200 emails and paid-preorder interest are aspirational signals, **not** pass/fail proof. Payment acceptance should be tested ethically with explicit terms and refund policy.

## 5. MVP functional requirements

**Priority legend:** P0 = required for pilot, P1 = pilot improvement, P2 = later.

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| AUTH-01 | P0 | Email-based account registration/sign-in/out | User can access only their data; can sign out on mobile |
| BIKE-01 | P0 | Create/edit/archive a motorcycle | Name, make/model optional, mileage km/l, odometer km, fuel type petrol; no negative numbers |
| TRIP-01 | P0 | Create draft trip with start, destination, date and optional waypoints | Persist edits, assign bike and explicit trip status |
| TRIP-02 | P0 | Obtain distance and route preview from selected map provider | Show route geometry, km, source and error/fallback when routing unavailable |
| TRIP-03 | P0 | Estimate fuel budget | `(estimated_km / planned_km_per_litre) × INR_per_litre`; user may edit values |
| TRIP-04 | P0 | Add editable allowances for toll, stay, food and miscellaneous | Summary correctly totals line items and records estimate assumptions |
| TRIP-05 | P0 | Start/complete/archive a trip | Trip status changes validated; completed trip read-only unless reopened |
| EXP-01 | P0 | Add/edit/delete manually entered trip expenses | Category, amount, timestamp, note; fuel may include litres, odometer and unit price |
| EXP-02 | P0 | Show actual spend vs estimate and cost/km | Totals match expense records; handle zero km with N/A |
| MAINT-01 | P0 | Log bike maintenance | Service type, service odometer, date, cost, notes, optional next due km |
| MAINT-02 | P0 | Show due/overdue service | Based on odometer and configured intervals; no unearned claim of exact prediction |
| UX-01 | P0 | Responsive, accessible mobile experience | 320px+ layouts, screen-reader labels, keyboard navigation, loading/empty/error states |
| DATA-01 | P0 | Private storage and deletion controls | RLS policies, ownership checks, account delete/export process documented |
| PRICE-01 | P1 | Indicative fuel price lookup | Show locality, source, fetched-at and manual override; no hidden replacement |
| TOLL-01 | P1 | External indicative toll estimate | Show if source supports motorcycles; otherwise “Not available—enter manually” |
| STAY-01 | P2 | Stay suggestions | Only with licensed provider/curated verified records; avoid invented bike friendliness |
| REPORT-01 | P1 | Download CSV trip expenses | Accurate INR amounts and timestamps; PDF export later |
| OFFLINE-01 | P2 | Offline write queue with sync | Implement only after conflict and privacy tests |
| AI-01 | P2 | Explain route options in plain language | No unsourced closures/safety assertions; model cannot select road geometry |
| PAY-01 | P2 | Subscription/payment | Only after retention and willingness-to-pay evidence |

### Expense categories

`fuel`, `toll`, `food`, `stay`, `maintenance`, `parking`, `other`. All optional fields must be truly optional; amounts must be positive. Refunds/adjustments require a separate, auditable handling design before supporting negative expenses.

## 6. Primary use cases

**UC1 — Plan a ride:** register bike → enter origin/destination/date → choose returned route → enter mileage/fuel price → adjust non-fuel allowances → save plan. Result: budget with explicit assumptions and a stored route snapshot.

**UC2 — Track spend:** open active trip → add fuel/toll/food/stay entry → view spent-to-date and remaining budget. Updating fuel also records optional measured litres and odometer; it does not silently overwrite the bike's odometer.

**UC3 — Maintain bike:** select bike → record oil/chain/tyre/brake/other maintenance → optionally specify service interval → show due-by-odometer. No remote diagnosis or safety assurance.

## 7. Calculation rules

- Fuel litres estimate = distance km ÷ user-input km/l; km/l must be strictly positive.
- Fuel amount INR = fuel litres estimate × INR/litre, rounded to nearest paise **only at final money calculation**.
- Estimated total = estimated fuel + manually supplied toll + food + stay + other allowances.
- Actual total = sum of recorded expenses associated with trip.
- Actual cost/km = actual total ÷ actual distance if entered, otherwise planned distance with an explicit “based on planned distance” label; if neither is >0, N/A.
- Per-litre efficiency from fuel fill-ups is not inferred unless sufficient consistent odometer and fill-to-fill data exists; avoid misleading mileage calculations.

Show total variance = actual − estimate, not “savings” unless both amounts are comparable and final.

## 8. Explicit non-goals for first pilot

Turn-by-turn navigation, live accident/road-hazard reports, offline map downloads, crowdsourced safety ratings, hotel booking, GST/tax reconciliation, group ride splits, social feed, automatic bank/SMS scanning, automatic mileage prediction, EV range, insurance, AI route planning and subscriptions.

## 9. Risks and dependencies

| Risk | Mitigation / decision |
|---|---|
| Map prices/terms change | Provider adapter; quota alarms; confirm terms before production |
| Fuel and toll data inaccurate | Manual override; estimated label; store source and timestamp |
| GPS usage distracts rider | Stationary-use UX; no ride-time prompts or interaction nudges |
| Network failure | Save drafts reliably online; report offline state; offline sync later |
| Privacy breach | Supabase RLS, automated negative tests, server-side ownership enforcement |
| Scope expansion | Prioritize P0; require a written change decision for P1/P2 promotion |
| Poor willingness-to-pay | Free pilot; qualitative interviews; do not assume ₹699–999/month works |

## 10. Open product decisions

1. Which routing service has acceptable India coverage, motorcycle restrictions, terms and budget?
2. Do pilot riders need stopover/day segmentation or simply one route with waypoints?
3. What local languages are highest priority after English?
4. Should non-trip fuel and maintenance spending appear in a separate all-bike ledger?
5. Which fuel-price/toll data licensing arrangements are viable?
6. What price, if any, passes actual purchase-intent validation?

## 11. Definition of done

The P0 acceptance matrix passes in staging, test users complete plan/log/review flows, RLS cross-account tests pass, no severe data corruption or account leakage remains, routes and estimates are explicitly marked with assumptions, and a documented rollback/recovery path exists.

## Addendum A (2026-11-14): Touring checklist, rider marketplace, differentiation

**Why:** budgeting and expense logging alone is replaceable by a notes app or spreadsheet. Value that riders cannot easily get elsewhere: budgets based on their *real* mileage, fuel-stop planning, a checklist tuned to the ride, and (later) a way to get missing gear. These also create reasons to return between trips.

| Feature | Priority | Release | Status |
|---|---|---|---|
| Trip planner (manual distance) | P0 | MVP | Built |
| Expense tracker | P0 | MVP | Built |
| Motorcycle maintenance | P0 | MVP | Built |
| Touring requirements checklist (statuses: need it / have it / packed / N/A) | P0 | MVP | Built |
| Personalised suggestions by trip days, terrain, season | P1 | MVP enhancement | Built |
| Real mileage from fuel fills; fuel-stop planner | P1 | MVP enhancement | Built |
| Shareable trip summary (opt-in public link) | P1 | MVP enhancement | Built |
| Pro early-access interest capture (no payments) | P1 | MVP enhancement | Built |
| Marketplace: "Coming soon" page + waitlist | P1 | MVP enhancement | Built |
| Marketplace: sell used gear, browse, buyer-seller messaging | P2 | Phase 2 | Not built |
| Marketplace payments, shipping | P3 | Future | Not built |

### Checklist requirements (CHK)
- CHK-01 Categories: Documents, Safety gear, Motorcycle, Touring, Essentials.
- CHK-02 Each item has a status: needed, owned, packed, not applicable. Packed and N/A count as "ready".
- CHK-03 Suggestions depend on optional trip days, terrain (plains/hills/mountains/desert) and season (summer/monsoon/winter). Unset fields never add conditional items.
- CHK-04 Changing ride details and pressing "update suggestions" only **adds** newly relevant items; existing items and statuses are kept.
- CHK-05 Items still needed in the Safety gear category surface a prompt linking to the marketplace waitlist.

### Marketplace (phase 2) product rules
- Used **helmets and other safety-critical protective equipment are prohibited or tightly restricted** in the first version (hidden damage, unknown crash history).
- Out of the first version: in-app payments, shipping, bike ownership transfer.
- Needs: listing with photos/condition/price/location, browse and filter, protected messaging, available/reserved/sold, report and block.
- Until built: public "Coming soon" page with an account-based waitlist (one row per user).

### Pricing stance
Pro is **not for sale**. The pricing page records which planned plan (monthly/yearly) a signed-in user would pick, to measure real willingness to pay before any payment work. Prices shown are hypotheses.

## Addendum B (2026-11-14): Product Specification V2.0 (supersedes the narrow long-ride scope and Addendum A pricing)

### Vision
A motorcycle rider platform that stays useful **before, during and after every ride, and while the bike is parked**: Touring, Garage, Community and Marketplace on one rider account. The opportunity is a rider's digital garage, riding history, trusted network and touring toolkit, not a route planner alone. Competitors with broad scope already exist, so differentiation must come from **integrated workflows, useful India-specific information and reliable execution**.

### Target users
| Rider type | Main problem | Value |
|---|---|---|
| Daily commuters | Fuel spend and upkeep | Garage and cost tracking |
| Weekend riders | Finding rides and partners | Community and ride discovery |
| Long-distance tourers | Complex, expensive tours | Touring workspace |
| Riding clubs | Members and group trips | Club management |
| New riders | Equipment and preparation | Checklists and gear discovery |
| Experienced riders | Unused equipment | Marketplace |

**Launch focus:** daily owners, weekend riders and tourers. Club organisers are the first serious business segment.

### Feature priority (P0 first release, P1 early expansion, P2 later)
| Area | P0 | P1 | P2 |
|---|---|---|---|
| Touring | Solo trips; multi-day itinerary and stops; fuel and budget estimates; pre-ride checklist; trip expenses and reports | Invite group riders; shared expense settlement; offline trip pack | Live group tracking |
| Garage | Multiple bikes; fuel and odometer logs; service log; reminder dashboard | Insurance/PUC expiry reminders; total ownership cost; service record export | Predictive maintenance |
| Community | Rider public profile | Share completed trips; nearby public rides; clubs; announcements and RSVPs | Posts and reactions; in-app messaging; club subscriptions |
| Marketplace | Teaser and waitlist | Browse; create listings; seller contact and reports; moderator approval and takedown | Seller reputation; promoted listings; escrow/delivery/checkout |

### Build status against that matrix (2026-11-14)
- **Built:** solo trips (manual distance), fuel and budget estimates with real mileage and fuel-stop plan, personalised checklist, expenses and CSV, shareable trip summary; multiple bikes, fuel logs with odometer, service log and reminders, **insurance/PUC/registration expiry reminders (P1)**, **Home dashboard**; marketplace and community **waitlists**.
- **Also built:** **multi-day itinerary with stops** (P0): days, ordered stops with a type and distance from the previous stop, per-day and total km, a warning when the itinerary and the budget distance disagree, a long-day prompt, and a navigation handoff link to Google Maps.
- **Not built (P0 gap):** rider public profile.
- **Also built:** moderator queue, takedown, account restriction and audit log (see `06` Addendum H and `08`).
- **Not built (later):** group invites and settlement, offline trip pack, community modules, listings and moderation, payments.

### Explicit exclusions from the first release
Native turn-by-turn navigation, AI travel assistant, live GPS group tracking, emergency dispatch, in-app financial settlement, advanced messaging, marketplace checkout. Use an established navigation app for guidance; the product provides itinerary planning, estimates and handoff.

### Roadmap
| Phase | Weeks (target, not commitment) | Content | Exit gate |
|---|---|---|---|
| 0 Validation | 1-2 | 25-40 rider interviews, landing test, journeys, models | Evidence of repeat usage interest and top three paid-worthy problems |
| 1 Core: Ride + Garage | 3-8 | Auth, profile, garage, trips, budgets, expenses, maintenance, checklists, dashboard; community limited to shareable trips; marketplace waitlist | End-to-end workflows pass functional and security tests |
| 2 Social + Marketplace beta | 9-14 | Rider discovery, public rides, clubs, invitations, listings, moderation, seller contact | Small cohort completes real coordination and moderated listings with acceptable support load |
| 3 Paid touring + club tools | 15-20 | Group reports, trip passes, subscriptions, club dashboards, payments, entitlements | Checkout, entitlements, renewal/cancel handling, measurable willingness to pay |
| 4 Scale | After evidence | Advanced offline, richer road intelligence, collaboration, trust systems, AI-assisted planning | Proven demand and sustainable unit economics |

For a solo developer the full roadmap takes considerably longer.

### Monetization and trust
Commercial plans, prices, metrics and validation are in `07-MONETIZATION-AND-GROWTH.md` (this replaces the Addendum A pricing, which used different numbers). Marketplace category policy, moderation, privacy and launch gates are in `08-TRUST-SAFETY-AND-MODERATION.md`.

### Product principle
A free rider account is genuinely useful forever. Paid features make complex tours, organised groups and ownership analysis significantly easier.

### Acceptance additions (GAR)
- GAR-01 A rider can record insurance, PUC and registration expiry dates per bike (type, date, short note only; no numbers or files).
- GAR-02 A document is valid through its expiry date and "expired" from the next day; "expiring" means 30 days or fewer.
- GAR-03 Saving the same type again updates its expiry; removing it clears reminders.
- GAR-04 Home lists overdue services and expired/expiring documents across all bikes, most urgent first, or says "all clear".

## Addendum C (2026-11-14): Rider Public Profile (P0, implemented)

| Requirement | Status |
|---|---|
| Public handle: unique, editable (once per 30 days) | Built |
| Display name | Built |
| Avatar | Built as coloured initials. **Photo upload deferred** until moderation tooling exists (see `08`) |
| Bio, max 300 characters | Built |
| Location: city and state only | Built |
| Riding interests (fixed list, up to 6) | Built |
| Motorcycle: only if the rider chooses; make and model only | Built |
| Ride statistics: only with explicit permission; totals only | Built |
| Visibility Public / Private (default Private) | Built |
| Shareable profile URL | Built (`/rider/<handle>`, not indexed by search engines) |
| Report and block | Built; moderator queue not built |

**Out of scope for this feature:** feeds, followers, chat, marketplace transactions, avatar photo upload.

**Acceptance (PRO):** a rider can create, preview, edit, disable and delete their profile; public profiles never expose private account or motorcycle data; private, disabled and blocked-viewer profiles are inaccessible and look like missing ones; handle uniqueness holds under concurrent requests; reports and blocks are enforced by the APIs; light and dark modes pass automated accessibility checks; Garage, Touring and the offline map are unaffected.

## Addendum D (2026-11-14): Community Phase 1 (implemented): rider discovery, group rides, invitations, participation

Builds on the rider public profile. Clubs, community posts, group expense settlement and the marketplace remain later phases.

### Rider discovery
- A rider is listed only if they opt in (**"List me in Find riders"**, off by default) and their profile is Public. Going private removes them from discovery automatically.
- Signed-in riders can search by name or handle, filter by state and interest, and page through results. Cards show only what the rider made public. Yourself and anyone blocked in either direction are never listed.

### Group rides
- A rider with a rider profile can **host** a ride: title, description, **city or area** (public), optional destination, dates and time, distance, who can join (**Public** or **Invite only**), whether the host approves each rider, a rider limit (2 to 100, host included), and an optional **exact meeting point** and note shown only to confirmed riders.
- **Join:** on a public ride a rider asks to join (or joins instantly if the host does not require approval). The host approves or declines. Riders can leave or withdraw. A removed rider cannot rejoin by themselves.
- **Invitations:** the host invites a rider by handle (public profiles only). The invitee accepts or declines from Rides. Inviting someone who already asked approves them.
- **Capacity** is enforced by the database: a ride never exceeds its limit, a host cannot shrink it below the riders already confirmed, and leaving frees a place.
- **Cancel:** a cancelled ride is visible only to its participants and cannot be reopened.
- **Find rides:** upcoming public rides, filter by city or area, date window and "only rides with space".
- **Home** shows invitations to answer and requests to review.
- **Report** a ride (unsafe, spam, inappropriate, harassment, other). One open report per reporter per ride. Hosts cannot report their own ride.

### Privacy rules (acceptance)
- The exact meeting point and host note are visible only to the host and confirmed riders.
- Other riders see a headcount, not names. Confirmed riders and the host see who is going, by display name and handle, never ids.
- Blocked riders (either direction) cannot see each other's rides, join them, or be invited.
- Joining discloses the rider's display name and handle to the riders on that ride; this is stated on the join and host forms.

### Not in this phase
Clubs and memberships, community posts, ride photos and uploads, in-app messaging, live location sharing, payments, and a moderator queue for ride and profile reports.

## Addendum E (2026-11-14): Riding clubs and memberships (implemented)

- **Start a club** (needs a rider profile): name, a permanent link (`/clubs/<link>`), description, **city and state only**, who can see it (**Public** or **Private**), how riders join (**Anyone**, **By approval**, **Invite only**; a private club is always invite only) and a member limit (2 to 1,000).
- **Roles:** owner (one, cannot leave, archives the club), admins (approve requests, invite, remove ordinary members), members. Only the owner assigns or removes admins and edits club settings.
- **Joining:** open clubs admit at once; approval clubs queue a request an owner or admin decides; invite-only clubs admit only invited riders. Leaving frees a place. A removed rider cannot rejoin by themselves.
- **Invitations:** owner or admin invites by handle (public profiles only). Inviting someone who already asked approves them. Invitees accept or decline from Clubs.
- **Find clubs:** public active clubs by name and state, with member counts. Private clubs are invisible to everyone but members and invitees.
- **Archive:** an archived club leaves public view, stays visible to its members, accepts no new members and cannot be reopened.
- **Report** a club (one open report per reporter; the owner cannot report their own). **Blocks** apply: a blocked rider cannot see, join or be invited to the blocker's club.
- **Home** lists club invitations to answer and join requests to review.
- **Not in this phase:** club announcements, club-wide ride RSVPs, club-linked rides, ownership transfer, club images.
