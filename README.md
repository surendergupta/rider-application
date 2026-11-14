# India Motorcycle Rider Platform

**Product Specification V2.0** · 14 November 2026 · Status: **validation-first; Garage + Touring built, Community and Marketplace "coming soon"**

A mobile-first platform for Indian motorcyclists that stays useful **before, during and after every ride, and when the bike is parked.** Working name in the app: *Long-Ride Planner*.

> **Every ride. Every bike. One home.** Plan trips, keep the bike ready, track every rupee; later: find riders and pre-owned touring gear.

## The four modules

| Module | What it is | Status |
|---|---|---|
| **Touring** | Trip budgets, real mileage from fuel fills, fuel-stop planner, **multi-day itinerary with stops and a Google Maps handoff**, personalised ride checklist, expense log, actual vs estimate, shareable trip summary, offline map | Built |
| **Garage** | Multiple bikes, service log and reminders, insurance/PUC/registration expiry reminders, Home dashboard ("needs attention") | Built |
| **Community** | **Rider public profile, rider discovery (opt-in), group rides with invitations, approvals and capacity, riding clubs with roles, report and block**; community posts later | Phase 1 and clubs built; posts waitlist only |
| **Marketplace** | Pre-owned touring gear (no used helmets) | Waitlist only |

One rider account ties them together. Free stays genuinely useful; paid plans are being **validated, not sold** (see `07`).

## Read in this order

| File | Purpose |
|---|---|
| [01-PRD.md](docs/01-PRD.md) | Vision, users, scope, priorities, acceptance criteria |
| [02-TRD.md](docs/02-TRD.md) | Architecture, technical choices, security, integrations |
| [03-APP-FLOW.md](docs/03-APP-FLOW.md) | Screens, navigation, journeys, states |
| [04-UI-UX-DESIGN-BRIEF.md](docs/04-UI-UX-DESIGN-BRIEF.md) | Design direction, components, content, accessibility |
| [05-BACKEND-SCHEMA.md](docs/05-BACKEND-SCHEMA.md) | PostgreSQL/Supabase data model, RLS, API contract |
| [06-IMPLEMENTATION-PLAN.md](docs/06-IMPLEMENTATION-PLAN.md) | Phases, status, tests, launch gates, risks |
| [07-MONETIZATION-AND-GROWTH.md](docs/07-MONETIZATION-AND-GROWTH.md) | Plans to test, pricing stance, metrics, validation |
| [08-TRUST-SAFETY-AND-MODERATION.md](docs/08-TRUST-SAFETY-AND-MODERATION.md) | Marketplace policy, moderation, privacy, launch gates |

Documents 01-06 keep their original text and carry dated **Addendum** sections. Where an addendum conflicts with earlier text, **the latest addendum wins** (V2.0 = "Addendum B").

## Architecture at a glance

- **Modular monolith**: one Next.js (App Router, TypeScript) app with modules for Auth/Profile, Touring, Garage, Community, Marketplace, Payments/Admin. No microservices.
- **Design:** dark-by-default premium adventure theme with a light mode toggle; semantic colour tokens (contrast enforced by tests); Inter and Manrope; 44 px touch targets; phone bottom tab bar. Details: `docs/04-UI-UX-DESIGN-BRIEF.md` (Addendum C).
- **Data/auth:** Supabase Auth + PostgreSQL, row-level security on every user table, SQL migrations in `supabase/migrations/` (run with `npm run migrate`).
- **Money:** INR in integer paise. Measurements in km, litres, km/l.
- **Maps:** MapLibre + free OpenStreetMap-based PMTiles, saved to the device for offline use. Routing provider not chosen yet; distance is entered manually.
- **Not in the first release:** turn-by-turn navigation, AI assistant, live group tracking, emergency features, in-app settlement, advanced messaging, marketplace checkout. Use an established navigation app for turn-by-turn guidance.

## Run it

```bash
cp .env.example .env.local     # fill in the Supabase keys
npm install
npm run migrate                # needs DATABASE_URL
npm run dev                    # http://localhost:3626
```

| Command | What it checks |
|---|---|
| `npm test` | Unit tests (calculations, validation, checklist, document expiry, routing adapter) |
| `npm run test:db` | Two-account isolation and integrity rules against the real database (rolled back) |
| `npm run test:e2e` | Full rider journey in a real browser on a phone-size screen |
| `npm run test:db:clubs` | Club security and integrity rules: visibility, join policies, capacity, roles, owner protection, blocks (rolled back) |
| `npm run test:db:community` | Community security and integrity rules: ride visibility, private meeting point, capacity, approvals, blocks (rolled back) |
| `npm run test:e2e:profile` | Rider profile privacy, concurrency, report and block, accessibility (browser) |
| `npm run test:e2e:community` | Rides, invitations, discovery, accessibility and touch targets on the new screens (browser) |
| `npm run test:e2e:map` | Map renders, saves for offline use, works offline (needs the map data; run it against a production build: `npm run build && npx next start -p 3627`, then `E2E_BASE_URL=http://localhost:3627`) |
| `npm run test:all` | All of the above |

Offline map data: `powershell -ExecutionPolicy Bypass -File scripts\get-offline-map.ps1` (read the script first).

## Scope and source-of-truth conventions

The PRD owns **what/why** and acceptance criteria; TRD owns **how**; the schema owns **data contracts**; app flow owns **interaction behaviour**; the UX brief owns **presentation**; the implementation plan owns **delivery**; `07` owns **commercial** decisions; `08` owns **trust, safety and privacy** policy. If they conflict, record a decision in the implementation plan and update every affected file.

### Assumptions that still need validation

1. India-first; single rider per account. Group features are phase 2.
2. Petrol motorcycles are primary; diesel and EV are out of scope.
3. Users supply fuel price and mileage. No promise of city-level pump prices.
4. Tolls, stays and road conditions are never shown as verified unless a verified source exists.
5. Users should get value without connecting financial accounts, granting continuous GPS access or paying.
6. Paid plans, prices and marketplace demand are hypotheses until riders show real interest.

**Not legal, safety or navigation advice.** Route, toll, fuel, accommodation and weather information must be independently verified before a ride. Never encourage phone use while riding.
