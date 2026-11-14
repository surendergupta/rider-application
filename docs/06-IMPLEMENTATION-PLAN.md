# 06 — Implementation & Delivery Plan

**Version:** 1.0 · **Approach:** 90-day validation → pilot → launch roadmap

## 1. Delivery strategy

Build the smallest safe, useful vertical slice first: **bike → trip route/distance → budget → expense entry → actual vs estimated**. Maintenance follows. Route, fuel and toll providers must remain replaceable. A 4–6-week code target is possible only if the MVP is trimmed to P0 and the team/availability supports it; no committed delivery dates are implied.

### Critical gates

- **G0, Discovery:** validated rider problems and meaningful interest; review hypotheses with evidence.
- **G1, Architecture:** select routing provider after licensing/India tests; sign off schema/RLS and tracking/privacy approach.
- **G2, Functional MVP:** all P0 journeys implemented and tested; no fake live price/toll precision.
- **G3, Private pilot:** cross-account isolation, backup/restore, usability and critical bug gates pass.
- **G4, Public launch:** production operations, terms/privacy, analytics consent, security checks and support workflow ready.

## 2. 12-week schedule

| Weeks | Focus | Outputs | Exit gate |
|---|---|---|---|
| 1–2 | Rider discovery, 20–30 interviews, survey, competitor/provider review, landing page | Interview notes, prioritized pain ranking, hypothesis log, waitlist | G0 decision |
| 3 | Foundation | Repo, CI, Auth, DB migrations/RLS, design system, environment isolation | Security smoke tests |
| 4 | Trip planning | Bikes CRUD, trip wizard, geocoding/routing adapter, route fallback | Plan/edit draft demo |
| 5 | Cost engine & spend | Estimate snapshot, expenses CRUD, variance and analytics basics | Full plan → expense path |
| 6 | Maintenance & hardening | Service records, due guidance, responsive UX, recovery and negative tests | G2 |
| 7–8 | Private pilot | 10–30 riders, telemetry, support, route quality corrections | G3 |
| 9–10 | Controlled launch | Landing/site copy, P1 export if feasible, marketing content, pricing experiments | Launch readiness |
| 11–12 | Public release and iterate | Release notes, incident response, top validated fixes | G4 / postlaunch baseline |

Do **not** add payment, AI generation, offline map downloads or hotel booking to the critical path without formal scope change.

## 3. Work breakdown and dependencies

| ID | Epic / deliverable | Depends on | Priority | Done when |
|---|---|---|---|---|
| W01 | User interviews + landing | None | P0 | Research log and evidence-based go/no-go |
| W02 | Provider/terms assessment | W01 | P0 | Routing demo on representative Indian routes; documented terms |
| W03 | UI kit + design prototype | W01 | P0 | Mobile screens and error states signed off |
| W04 | Repo, environments, CI | None | P0 | Typecheck/lint/tests/deploy preview pass |
| W05 | Auth and secure session | W04 | P0 | Protected routes and sign-out verified |
| W06 | PostgreSQL migration + RLS | W04 | P0 | Two-user authorization tests pass |
| W07 | Bike CRUD | W05, W06 | P0 | Create/edit/archive/list validated |
| W08 | Route provider adapter | W02, W04 | P0 | Routes + timeout/manual distance handling |
| W09 | Trip wizard + lifecycle | W07, W08 | P0 | Draft/start/complete/restore per state rules |
| W10 | Deterministic budget engine | W09 | P0 | Formula/rounding golden tests pass |
| W11 | Expense ledger + summary | W09, W06 | P0 | Accurate sums and retry idempotency |
| W12 | Maintenance log/schedule | W07, W06 | P0 | Due/overdue logic tested |
| W13 | QA, privacy, ops, pilot | W05–W12 | P0 | G2/G3 release checks pass |
| W14 | CSV export | W11 | P1 | Correct filtered data and quoting |
| W15 | Provider fuel/toll data | W02, W10 | P1 | Provenance and staleness visible |
| W16 | Subscription experiments | G3 evidence | P2 | Separate pricing/payment spec approved |
| W17 | Offline sync / maps | G3 evidence | P2 | Conflict rules, storage licensing and tests approved |

## 4. Sprint approach

**Sprint 0 (discovery / setup):** define target rider jobs; source route provider; prototype mobile UI; choose quality gates; create DB migration plan.

**Sprint 1 (foundation):** Auth, migration, RLS, bikes, app shell and consistent error handling. Demo bike create/edit under two distinct accounts.

**Sprint 2 (trip budget):** trip basics, route preview and explicit manual distance, budget engine with editable inputs, immutable estimate revision. Demo one-trip cost computation with deterministic tests.

**Sprint 3 (tracking):** active trip, quick expense entry, spend totals and service records. Demo full ride workflow and retry-after-failed-request.

**Sprint 4 (hardening/pilot):** accessibility, mobile performance, cross-user penetration tests, support playbook, representative Indian route validation, feedback prioritization.

## 5. Recommended repository structure

```text
india-long-ride/
├── README.md
├── docs/
│   ├── 01-PRD.md
│   ├── 02-TRD.md
│   ├── 03-APP-FLOW.md
│   ├── 04-UI-UX-DESIGN-BRIEF.md
│   ├── 05-BACKEND-SCHEMA.md
│   └── 06-IMPLEMENTATION-PLAN.md
├── src/
│   ├── app/(public)/
│   ├── app/(auth)/
│   ├── app/(app)/
│   ├── app/api/
│   ├── components/
│   ├── features/bikes/
│   ├── features/trips/
│   ├── features/expenses/
│   ├── features/maintenance/
│   ├── lib/auth/
│   ├── lib/db/
│   ├── lib/routing/
│   ├── lib/money/
│   └── lib/validation/
├── supabase/migrations/
├── tests/unit/
├── tests/integration/
├── tests/e2e/
└── .github/workflows/
```

Note: parentheses in Next.js route groups are literal directory names.

## 6. Test strategy

| Layer | Scenarios | Gate |
|---|---|---|
| Unit | Fuel estimate, paise rounding, totals, due-km, lifecycle, validation | Every PR |
| DB integration | Composite ownership, RLS direct access, update/delete policies, duplicate idempotency, estimate immutability | Before pilot |
| API integration | Auth expiry, route timeout, provider errors, malformed input, duplicate POST, status conflicts | Every merge |
| Browser E2E | Signup → bike → plan → budget → start → expense → complete → maintenance | Before G2/G3 |
| Accessibility | Keyboard, input errors, focus management, zoom and screen reader smoke | Before pilot |
| Security | Two-account IDOR attempts, rate limit, secret exposure, CSP, role grants | Before pilot |
| Performance | Mobile cold load, map lazy loading, query timing and provider timeouts | Before public launch |
| Recovery | Failed expense request and retry; restore from DB backup; deploy rollback | Before G3/G4 |

### Essential golden calculation cases

1. 600 km / 30 km/l × ₹100/l = **20 l, ₹2,000** fuel estimate.
2. 270 km / 30 km/l × ₹105/l = **9 l, ₹945** fuel estimate.
3. Add ₹500 food and ₹100 other to case 2 → **₹1,545** total.
4. `km/l = 0` is rejected; a total with zero route distance must show `N/A` for cost/km.
5. Retry the same expense with the same request UUID → exactly **one** expense row.
6. Cross-owner expense link → DB constraint or policy denies mutation.

## 7. Work estimates and capacity assumptions

Single experienced full-stack developer, limited custom design, stable external routing API: around **4–6 weeks for P0 engineering** after discovery is plausible but not guaranteed. Real-world route-provider evaluation, accessibility, testing, data cleanup and operational hardening may extend it. A 12-week timeline includes interviews, pilot, fixes and staged launch.

Cost model must include maps/geocoding calls, hosting, managed DB, storage, email, domain, error monitoring and taxes. **₹0–₹500/month is an aspiration for very low pilot usage, not a verified quote or guaranteed ceiling.** Model costs at 100/1,000/10,000 MAU, with expected route previews per user and free-tier eligibility checked in writing.

## 8. Pricing and monetization experiments

Start with a free private pilot. Proposed `Free: 3 trips/month` and `Pro: ₹699–999/month or ₹6,999/year` are **unvalidated options**; high relative pricing could suppress conversion. Conduct willingness-to-pay interviews and randomized offer tests only after showing riders the working core product. Do not promise 100 customers = ₹70,000–₹1 lakh *net* monthly revenue: gross MRR excludes payment fees, refunds, taxes, support, acquisition and infrastructure costs.

When subscription is justified, write separate payment and entitlement requirements: provider webhook verification, duplicate event processing, plan limits, renewals, refunds, invoices, billing disputes and account deletion behavior.

## 9. Roles and approval owners

For solo development, one person may fill multiple roles, but keep distinct review checks: **product owner** (scope/acceptance), **frontend/design** (UX/accessibility), **backend engineer** (DB/API/security), **QA reviewer** (negative tests), **ops owner** (deployment/backups/incident), and **rider pilot** (real-world feedback).

## 10. Launch checklist

- [ ] Interviews and priority validation documented; target use case still compelling.
- [ ] Every P0 story demonstrates its acceptance criteria.
- [ ] India route samples reviewed; source/vehicle limitations communicated.
- [ ] Private data inaccessible across accounts; no exposed service-role/provider secrets.
- [ ] Database migrations repeatable; restore test completed.
- [ ] Expenses never silently duplicate on retry; totals and historical estimates stable.
- [ ] Legal pages, privacy disclosure, data deletion and support contact available.
- [ ] Mobile usability and accessibility passes; no unsafe while-riding interaction.
- [ ] Alerting, quota monitoring, staging rollback and incident playbook are in place.
- [ ] Paid plan and savings claims omitted unless supported by validated evidence.

## 11. Decision log template

| Date | Decision | Options | Rationale | Owner | Impacted docs |
|---|---|---|---|---|---|
| 2026-11-14 | Design a validation-first P0 | Full featured vs thin MVP | Reduce data-provider dependence | Product | All |
| TBD | Choose routing provider | Mappls / Mapbox / Google / OSM-based | Coverage, legal use, motorcycle support, cost | Tech | TRD, flow, schema |
| TBD | Pilot launch target | Invite-only / open beta | Quality and support capacity | Product | PRD, implementation |

## Addendum A (2026-11-14): Status and revised priorities

**Built and tested** (unit 49, DB isolation, browser end-to-end): auth and sign-up, bikes, trips, estimates, expenses, CSV, maintenance, account deletion, legal pages, checklist v2 with personalisation, real mileage, fuel-stop planner, shared trip link, Pro early-access capture, marketplace waitlist, offline-map foundation.

**Decision log**

| Date | Decision | Rationale | Impacted docs |
|---|---|---|---|
| 2026-11-14 | Add personalised checklist to MVP; marketplace is "Coming soon" with waitlist only | Checklist is cheap and useful now; a marketplace needs moderation, messaging and safety policy | PRD, TRD, flow, UX, schema |
| 2026-11-14 | No used helmets / safety-critical gear in marketplace v1 | Hidden damage and crash history | PRD, UX |
| 2026-11-14 | Pro stays unsold; capture plan interest instead | Validate willingness to pay before payment work | PRD, plan |
| 2026-11-14 | No fuel or toll price feeds | No free official India source; scraping breaks terms and goes stale. Note: two-wheelers are generally exempt from national-highway tolls, so a toll feed matters little for this product (verify current rules) | TRD |

**Next (in order):** (1) finish offline-map verification; (2) pilot with 10-30 riders and read the Pro/marketplace interest numbers; (3) decide routing provider; (4) group-ride expense splitting if pilot interest is real; (5) marketplace phase 2 only if the waitlist justifies it.

**Pre-launch blockers still open:** custom SMTP for confirmation emails; rotate exposed secrets; lawyer review of Terms and Privacy; self-hosted map file; shared-store rate limiting.

## Addendum B (2026-11-14): V2.0 status and next steps

**Built and tested** (65 unit tests, 31 database checks, 23 browser steps): everything in Addendum A plus the Garage document reminders, the Home dashboard, the V2 landing and pricing, the Community and Marketplace waitlists, and the **multi-day itinerary with stops and Google Maps handoff**.

**Decision log**
| Date | Decision | Rationale | Docs |
|---|---|---|---|
| 2026-11-14 | Adopt Product Specification V2.0 (four modules, modular monolith) | Garage and reminders drive day-to-day retention; tours are only a few per year | All |
| 2026-11-14 | Build order: Garage + Touring, then Community + group rides, then Marketplace, then paid plans | Useful with zero community; charge only for workflows riders repeat | PRD, 07 |
| 2026-11-14 | Plans to validate: Free, Tour Pass 149, Rider Pro 199/month or 1,499/year, Club Pro 499 | Replaces earlier 149/month and 999/year idea | 07 |
| 2026-11-14 | Marketplace: free listings, no commission, no escrow, no used helmets | Safety and trust, competitor free listings | 08 |
| 2026-11-14 | Documents store dates only, never numbers or files | Nothing sensitive to leak | 05, 08 |

**Next, in order**
1. Re-run the map data script to fetch the wider glyph set, then re-run the map test.
2. Rider interviews and a pilot (10-30 riders); read waitlist and plan-interest counts.
3. Close the last P0 gap: **rider public profile** (opt-in, unique handle, nothing private exposed; design it against `08` first).
4. Choose a routing provider; then add place search and a route button.
5. Phase 2 only if the pilot justifies it: group rides and expense splitting, clubs, listings plus the moderation tooling in `08`.
6. Phase 3: write the payment and entitlement spec, then build it.

**Offline map status:** verified against a **production build**: the map renders, saves to the device, and after the browser goes offline a reload still shows the map from the saved copy, with the MapLibre worker and label fonts served from the cache. In **dev mode** the same test fails on a framework-generated script, so test offline behaviour with `npm run build` and `npm start`, not `npm run dev`. Run it with `E2E_BASE_URL=http://localhost:<port> npm run test:e2e:map`. Rare scripts (for example some Arabic or Cyrillic place names) need extra label glyph files: re-run `scripts/get-offline-map.ps1`, which now fetches the wider set and skips files you already have.

**Pre-launch blockers:** custom SMTP for confirmation emails; rotate secrets that were exposed during development; lawyer review of Terms and Privacy; self-hosted map file; shared-store rate limiting; `08` launch gates.

## Addendum C (2026-11-14): Design system shipped

- **Done:** dark-default theme with light toggle, semantic colour tokens, Inter + Manrope, 44 px touch targets, phone bottom tab bar, new landing hero.
- **Guarded by tests:** `tests/unit/theme-contrast.test.ts` reads the real tokens and enforces contrast in both themes (text 7:1 or 4.5:1, control borders 3:1), requires identical tokens in both themes, blocks token names that clash with Tailwind utilities, and pins the dark palette to the brief. The browser test checks dark-by-default, theme persistence, the tab bar, and that every main screen has no touch target under 44 px.
- **Decision log:** 2026-11-14 adopt the premium adventure visual identity; dark default with light mode; own artwork instead of third-party photography; keep product name "Long-Ride Planner" until naming is decided.
- **Counts:** 112 unit tests, 31 database checks, 26 browser steps, 6 offline-map steps.

## Addendum D (2026-11-14): Rider Public Profile P0

**Decision log**
| Date | Decision | Rationale | Docs |
|---|---|---|---|
| 2026-11-14 | Profile is opt-in, private by default, with no public database read path | Prevent enumeration and accidental exposure | 01, 02, 05, 08 |
| 2026-11-14 | Avatar is coloured initials; photo upload deferred | Uploads need moderation tooling that does not exist yet | 01, 08 |
| 2026-11-14 | One handle change per 30 days, enforced in the database | Stops handle swapping to impersonate or evade blocks | 05, 08 |
| 2026-11-14 | Profile pages are `noindex` | No moderation tooling yet | 08 |

**Open items:** moderator queue and audit events for profile reports; shared-store rate limiting; image avatars with moderation; a decision on whether profiles should ever be search-indexed.

## Addendum E (2026-11-14): Development-first strategy and Community Phase 1

### Strategy (agreed)
Complete the planned features first, then run full end-to-end and regression testing. During development we still run basic checks and **focused** tests of each feature, and we do not skip security checks for authentication, authorization, RLS, uploads or payments.

| Activity | During development | Final testing phase |
|---|---|---|
| Feature implementation | Yes | Fixes only |
| TypeScript, migrations, build | Yes | Yes |
| Focused feature tests (including RLS and authorization) | Yes | Yes |
| Complete browser E2E suite | Deferred | Required |
| Full regression, performance and load testing | Deferred | Required |
| Full security assessment | Focused checks | Required |
| Production deployment | No | Only after approval |

**Two separate milestones:** **Development Complete** = all agreed-scope features, migrations, APIs and UI flows implemented and passing their focused checks. **Testing Complete** = the integrated application passes complete functional, security, E2E, accessibility and regression testing. **Production Ready** needs both.

### Phase status
1. Core development: Touring, Garage, maintenance and expenses, rider profile, checklists, dashboard: **built**.
2. **Community: Phase 1 built** (rider discovery, group rides, invitations, participation). Remaining in Community: riding clubs and memberships, community posts and ride sharing.
3. Marketplace: not started. 4. Monetization: not started (interest capture only). 5. Full testing and regression: deferred. 6. Production readiness: deferred.

### Focused checks for Community Phase 1
`tsc` clean; production build compiles all routes; migrations 0008 and 0009 applied; 163 unit tests; `npm run test:db:community` (34 checks); `npm run test:e2e:community` (browser, includes accessibility and touch targets for the new screens). The full browser suite and full regression are **deliberately not re-run** until the testing phase.

### Decision log
| Date | Decision | Rationale | Docs |
|---|---|---|---|
| 2026-11-14 | Development-first: defer full E2E and regression, keep focused checks | Faster feature delivery; integration risk managed by focused tests | 06 |
| 2026-11-14 | Participation rules in database functions; no browser writes to participants | Capacity, approval and blocks cannot be bypassed by a UI bug | 02, 05 |
| 2026-11-14 | Discovery is opt-in and separate from "public" | A shareable link is not the same as being listed | 01, 08 |
| 2026-11-14 | Exact meeting point in a separate table | Row-level reads cannot hide a single column | 02, 05, 08 |
| 2026-11-14 | Navigation: Rides tab; Map, Account and others under More | Five phone tabs maximum | 03, 04 |

## Addendum F (2026-11-14): Clubs built; Community status

**Community Phase 1 complete:** rider discovery, group rides with invitations and participation, and **riding clubs and memberships**. **Remaining in Community:** community posts and ride sharing; notifications; moderator queue.

**Focused checks for clubs:** `tsc` clean; production build compiles `/clubs`, `/clubs/[slug]`, `/clubs/[slug]/edit`, `/clubs/new`; migration 0010 applied; 179 unit tests; `npm run test:db:clubs` (30 checks). The browser suite for clubs is **deliberately deferred** to the testing phase, as agreed.

**Decision log**
| Date | Decision | Rationale |
|---|---|---|
| 2026-11-14 | Club link is permanent; private clubs are always invite only | Shared links keep working; a private club cannot be joined by request |
| 2026-11-14 | Owner cannot leave; they archive | A club always has an accountable owner; no ownership-transfer flow yet |
| 2026-11-14 | Test results stream to `test-results/` as they happen | An interrupted run no longer loses its evidence |

**Next (in order):** community posts and ride sharing; then Marketplace; then Monetization; then remaining integrations and UI; then feature freeze and the full testing phase.

## Addendum G (2026-11-14): Community posts and ride sharing built

**Built:** community-wide posts, club-only posts, **ride stories** (share a completed trip), reporting, and deletion by the author or a club owner/admin. Pages: `/posts` (tabs: Community, My clubs, My posts) and a "Club posts" section on each club page for active members. Migration `0011_community_posts.sql`; code in `src/features/posts/`; components `PostCard` and `PostComposer`.

**Decision log**
| Date | Decision | Rationale | Docs |
|---|---|---|---|
| 2026-11-14 | Posts are created only by the database function `post_create()`; no browser insert or update policy | Membership, profile, daily limit and trip ownership are checked in one place and cannot be bypassed by a UI bug | 02, 05 |
| 2026-11-14 | A ride story is a **snapshot** (title, distance, completion date) with no link to the private trip | Costs, expenses, origin, route and bike can never be read through a post; later edits or deletion of the trip do not change it | 05, 08 |
| 2026-11-14 | Destination is copied only if the rider ticks "Show the destination"; origin is never copied | Free-text origins can be a home address | 08 |
| 2026-11-14 | No editing, comments or likes in this phase | Less to moderate; delete and report cover the abuse cases | 08 |
| 2026-11-14 | 20 posts per rider per 24 hours, enforced in the database | Works across server instances, unlike the in-memory limiter | 02 |
| 2026-11-14 | Club posts are visible to active members only; blocks hide posts both ways; archived clubs hide their posts | Same rules as clubs and rides | 08 |

**Focused checks:** `tsc` clean; production build compiles `/posts`; migration 0011 applied; 17 new unit tests (`tests/unit/posts.test.ts`); `npm run test:db:posts` (21 checks: creation, rate limit, anonymous access, blocks, club visibility, snapshot privacy, deletion rights, reports). The browser suite for posts is **deliberately deferred** to the testing phase, as agreed.

**Still open in Community:** notifications; the moderator queue (post and club reports are stored as `open` but nobody can action them yet); comments if the pilot asks for them. The moderator queue is a **launch gate** in `08`.

**Next (in order):** moderator queue and audit events (covers rides, profiles, clubs and posts); then Marketplace; then Monetization; then remaining integrations and UI; then feature freeze and the full testing phase.

## Addendum H (2026-11-14): Moderator queue and audit log built

**Built:** a moderator role, a report queue covering **posts, group rides, clubs and rider profiles**, four decisions (start review, dismiss, take down, take down and restrict the account), account restrictions that can be lifted, and an append-only audit log. Page: `/moderation` (moderators only; everyone else gets the normal "not found"). Migrations `0013_moderation.sql` and `0014_moderation_queue_fix.sql`; code in `src/features/moderation/`.

**How to make someone a moderator:** `npm run mod:add -- <handle>` (add `--remove` to revoke). It is SQL-only on purpose, so nobody can make themselves one. The person needs a rider profile first.

**Decision log**
| Date | Decision | Rationale | Docs |
|---|---|---|---|
| 2026-11-14 | Moderators are rows in `moderators`; no browser can read or write that table | Admin access is a separate role and cannot be self-granted | 02, 08 |
| 2026-11-14 | Every action is a database function that changes the content, closes the reports and writes the audit event in one transaction | An action with no audit event cannot happen; nothing can be half-applied | 05, 08 |
| 2026-11-14 | A reason of 3 to 300 characters is required for every decision except "start review" | Section 3 of `08`: every action records who, what, when, why | 08 |
| 2026-11-14 | Reports about the same item are shown as one row with a count, and one decision closes them all | Duplicate reports do not multiply moderator work | 08 |
| 2026-11-14 | A moderator cannot act on a report about their own content, and cannot restrict another moderator | Conflict of interest: a second moderator must decide | 08 |
| 2026-11-14 | Takedown = post removed, ride cancelled, club archived, profile made private. Nothing is deleted | Evidence is kept; nothing is irreversible except by SQL | 08 |
| 2026-11-14 | A restriction (7, 30 or 90 days, or until lifted) blocks creating posts, rides and clubs, using database triggers | Also covers `post_create()` and any future writer | 02, 05 |
| 2026-11-14 | The audit log has no insert, update or delete policy for anyone, moderators included | Nothing can edit history from the app | 05 |

**Focused checks:** `tsc` clean; production build compiles `/moderation`; migrations 0013 and 0014 applied; 205 unit tests (`tests/unit/moderation.test.ts`); `npm run test:db:moderation` (19 checks: access for riders, anonymous users and moderators; queue grouping; every decision for every kind; reason rules; conflict of interest; atomic refusals; restriction enforcement, expiry and lifting; audit immutability). Posts, clubs and community suites re-run for regressions. The browser suite for moderation is **deliberately deferred** to the testing phase, as agreed.

**Still open (launch gates in `08`):** a **named person** who actually meets the 24-hour review target; a stated **appeal contact** (a restricted rider sees the reason but not yet where to appeal); notifying a rider that their content was removed and why (the rider sees the removed state, but there is no message); the same queue for **marketplace listings** when they exist. A "warn" action and bans are not built (restriction covers the abuse cases for now).

**Next (in order):** Marketplace; then Monetization; then remaining integrations and UI; then feature freeze and the full testing phase.
