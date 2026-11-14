# 04 — UI/UX Design Brief

**Version:** 1.0 · **Audience:** Product designer, frontend engineer, QA

## 1. Product feel

Create a **calm, practical ride cockpit**, not a complex dashboard. The rider should quickly understand: where am I planning to go, how far, how much might it cost, what have I spent, and what maintenance is due? The aesthetic can reference topographic contour lines, road geometry and touring gear, but legibility outranks decoration.

**Design adjectives:** sturdy, spacious, trustworthy, outdoorsy, mobile-first, accessible. Avoid clutter, aggressive gamification, unreliable danger claims and constant location prompts.

## 2. Layout and information hierarchy

- Mobile-first widths: design at 360px and test at 320px, 390px, 768px, 1024px and larger.
- Authenticated mobile app: compact top bar + bottom navigation (**Home, Trips, Bikes, Settings**); prominent contextual action within each screen.
- Desktop: left navigation and content area with up to two columns; maps/details side by side on trip screens.
- Use progressive disclosure: essentials first; optional details in collapsible sections.
- Maintain a predictable hierarchy: screen title → one key metric/summary → main action → detailed content.

## 3. Suggested visual tokens (initial, adjustable)

| Token | Proposal | Usage |
|---|---|---|
| Primary ink | `#17262B` | Main text, strong headings |
| Canvas | `#F7F8F4` | Page background |
| Card | `#FFFFFF` | Forms and summaries |
| Brand accent | `#176B58` | Primary CTA, active states |
| Secondary accent | `#E6A343` | Distance/route highlights; not sole signal |
| Warning | `#A45C12` | Unverified / estimate notices |
| Error | `#A32733` | Validation failures |
| Border | `#D8DEDA` | Dividers/input outlines |
| Typography | Inter or system UI fonts | Loading performance and multilingual readability |

These are design candidates, not accessibility-certified pairs. **Verify WCAG 2.2 AA contrast** for every foreground/background combination, especially muted captions and CTA text.

## 4. Component library

| Component | Variants/states |
|---|---|
| App shell / bottom tab bar | Active, disabled, keyboard focus, narrow viewport |
| Button | Primary, secondary, danger, text; loading/disabled |
| Numeric field | INR, paise handling, km, km/l, litres; validation and explanatory help |
| Place search | Async results, no match, provider failure, manual alternative |
| Date picker | Date, historical date, future date, locale |
| Route preview | Map loading/error/empty, route select, warning + attribution |
| Budget breakdown | Fuel, toll, stay, food, other; totals/variance |
| Expense row | Category icon, amount, date, edit/delete controls |
| Empty state | Explanation + next useful action |
| Confirm dialog | Archive, delete, reopen, sign out |
| Status chip | Draft, Active, Completed, Archived; never color alone |
| Toast / inline notice | Saved, not saved, network failure, external estimate caveat |
| Due reminder | Remaining km / overdue km; clearly not safety-certified |

Use icons **with labels** for critical actions. Ensure 44×44 CSS px touch targets where practical, visible focus rings, keyboard-accessible dialogs, and user-friendly error messages.

## 5. Page-specific wireframe guidance

### A. Dashboard

```text
┌─────────────────────────────────┐
│ Good morning       [Profile]    │
│ Plan your next ride             │
│ [ + New trip                ]   │
│                                 │
│ ACTIVE RIDE                     │
│ Delhi → Jaipur                  │
│ Budget ₹2,800   Spent ₹1,140    │
│ [Open trip]                     │
│                                 │
│ MY BIKES                        │
│ Himalayan 450 · next oil check  │
│ [View maintenance]              │
│                                 │
│ Home   Trips   Bikes   Settings │
└─────────────────────────────────┘
```

Illustrative values only, not factual estimates. If no active trip, present upcoming draft instead; no empty metric cards.

### B. Trip wizard

Show progress `Step 1 of 4` with short form; map appears only when route data is ready. In route review show at least route length, indicative duration (if provider supplies), source, route option selection and limitations. In budget step show editable assumptions and sticky total.

### C. Trip detail

Above fold: route name/status, estimated vs actual amount, budget breakdown and primary **Add expense** for active trips. Below: map thumbnail, categorized expense list, trip actions and provenance. Completed trip shows **Review expenses** instead of add CTA.

### D. Quick expense entry

Category as labeled compact selection; amount keyboard numeric first; note/date collapsed or secondary. For fuel: litres and odometer in expandable “Fuel details”. Display inline save confirmation; never dismiss a failed entry.

### E. Bike maintenance

At top: bike identity and latest odometer with timestamp. Due service card states `Next oil change at 8,000 km (500 km remaining)` only where a user-configured service interval exists. Chronological service list; add-service action.

## 6. Copywriting and trust

Use concise Hinglish-friendly English labels in v1, with a translation framework for future Hindi/regional locales. Preferred language examples:

- “Estimated fuel: ₹1,650 — based on 30 km/l and ₹110/l.”
- “Fuel price entered by you. Local pump prices may differ.”
- “Toll estimate unavailable for motorcycles on this route. Add your estimate.”
- “Your expense hasn't been saved. Reconnect and retry.”
- “Route is for planning only. Check local roads before departure.”

Avoid “Guaranteed cheapest route”, “Safe road”, “Verified bike-friendly hotel” or “Save ₹3,000” without independently defensible evidence.

## 7. Accessibility and environmental constraints

- WCAG 2.2 AA intent; logical headings, skip links, labels, error summary, appropriate focus movement, accessible dialogs, reduced-motion support.
- Strong readability in sunlight; never rely solely on low-contrast gray; scalable text up to 200%.
- Mobile forms must avoid accidental double submit and support back/forward navigation.
- Images and map tiles load lazily with useful text fallback; route distance and warnings accessible without map visibility.
- No prompts asking users to type while operating a motorcycle; language encourages stopping safely.
- Prefer responsive web pages over heavy always-on map UI on low-memory devices.

## 8. Design deliverables & handoff

Provide a Figma file with typography/color tokens, components and states, mobile and desktop views of every P0 screen, clickable prototypes for trip/expense/maintenance flows, error/empty/loading variants, accessibility notes and a developer redline/spec. All UI scenarios should map to `03-APP-FLOW.md` and P0 IDs in `01-PRD.md`.

## 9. Design acceptance checklist

- [ ] First-time rider can create bike and trip without reading documentation.
- [ ] Manual route distance path works visibly when provider fails.
- [ ] Every estimate explains assumptions and whether data is manually entered or sourced.
- [ ] Expense entry is fast, clear and safe against accidental double submissions.
- [ ] Maintenance due status is sourced from explicit bike/record data.
- [ ] All screens have accessible error, empty, loading and success variants.
- [ ] Visual review done for 320px mobile, sunlight contrast and long Indian city names.

## Addendum A (2026-11-14): Landing, checklist and marketplace presentation

**Landing hero:** headline "Plan your ride. Track every rupee." with the supporting line "India's motorcycle touring companion". Claims must stay true: no promise of route, toll or live road data.

**Feature grid:** budget with real mileage, fuel-stop planner, ride readiness checklist, offline map, expense log, shareable ride, and a "Rider gear marketplace" card with a **Coming soon** badge linking to the waitlist page.

**Checklist item:** label plus a row of four pill buttons (Need it, Have it, Packed, N/A). The selected pill is dark; packed/N/A items are struck through. Pills are real buttons with `aria-pressed` and a label that names the item. Touch targets are at least 32px high.

**Gear prompt:** amber callout above the list when safety gear is still needed.

**Marketplace page:** "Coming soon" badge, what is planned, a prominent amber **safety box** (no used helmets or safety-critical gear), and one primary waitlist button.

**Pricing page:** two cards. Pro is marked "Early access", features are labelled "(coming)", and a footer states no payment is taken and prices are planned, not final.

## Addendum B (2026-11-14): V2.0 presentation

**Landing:** eyebrow "Built for Indian motorcyclists"; headline "Every ride. Every bike. One home."; supporting line about planning adventures, keeping the bike ready, tracking every rupee, and connecting with riders and gear soon. Under the hero, a four-card strip (Plan a Ride, My Garage, Find Riders, Gear Marketplace). Unbuilt cards carry a saffron **Coming soon** badge. Do not imply routes, tolls, community or marketplace exist today.

**Home dashboard:** heading "Ready for your next ride?" (small label "Your riding space"). Dark "next trip" card with a saffron button; "Needs attention" list with red (urgent) and amber (soon) pills; 2x2 tiles with dashed borders and a "Soon" pill for unbuilt modules. The all-clear state is green.

**Navigation (signed in):** Home, Trips, Garage, Map, Account, Sign out in a dark header; the Sign out button must not wrap on a 390 px screen.

**Document rows:** type, date and note on the left; status pill (green ok, amber expiring, red expired) and a "Remove" text button on the right.

**Pricing:** four cards on desktop (one per plan), stacked on phone. Rider Pro is the dark card. Every paid feature is marked "(coming)"; footer states no payment is taken and prices are proposed.

**Imagery:** illustrative placeholders only; do not use real brand or third-party photos without rights.

## Addendum C (2026-11-14): Visual identity and design system (implemented)

**Direction:** premium adventure. A modern motorcycle dashboard crossed with a travel-planning app: dark charcoal surfaces, orange accent, simple cards, large calm type, map-focused trip screens. **Dark is the default identity; light mode is the same palette inverted** and is chosen with a toggle (remembered in the browser; applied before first paint so nothing flashes).

### Colour tokens
Pages use semantic names only (`bg-surface`, `text-muted`, `border-line` ...), never raw colours, so one switch re-themes every screen.

| Token | Dark | Light | Use |
|---|---|---|---|
| canvas | #12161B | #F6F7F9 | Page background |
| surface | #242B33 | #FFFFFF | Cards |
| sunken | #1A2027 | #F1F5F9 | Inputs, tracks, subtle bands |
| line / line-strong | #343E49 / #6C7A89 | #E2E8F0 / #7F8EA3 | Dividers / control borders |
| fg | #F3F5F7 | #0B1220 | Body text |
| muted / subtle | #A7B2BF / #8794A3 | #475569 / #5A687B | Secondary text |
| accent | #F97316 | #F97316 | Fills behind dark text: buttons, selected items, bars |
| link | #FB923C | #C2410C | Orange **text** (links) |
| success / warn / danger (fg, bg) | green / amber / red pairs | darker text on pale fills | Status pills and messages |

The token named `canvas` (not `base`) because `text-base` is Tailwind's font size; a clash once turned all `text-base` text into the page colour.

### Typography
Inter for interface text; Manrope for headings and marketing headlines. Both are self-hosted at build time (no third-party font requests at runtime).

### Components and rules
- Cards 12-16 px radius; primary actions are orange fills with dark text; selected pills use the accent fill.
- **44 px minimum touch targets** for every button, link-as-button and field (global rule plus a `tap` utility for links). Inline text links inside sentences are exempt. The map's OpenStreetMap credit links are third-party legal text and are exempt.
- **Data-heavy screens (expenses, maintenance, forms) prioritise contrast:** body text at least 7:1, secondary text at least 4.5:1, control borders at least 3:1, in both themes.
- Focus is always visible (orange outline).
- Reduced-motion preference disables entrance animations.

### Navigation
Phones: fixed **bottom tab bar** (Home, Trips, Garage, Map, Account) with icons and the active tab highlighted. Wider screens: the same items as top links. Theme toggle and Sign out stay in the header.

### Landing hero
Eyebrow "YOUR NEXT ADVENTURE STARTS HERE", headline "Where to next?", the line "Ride more. Explore more.", primary action "Explore Your Next Ride". The scenery is **original artwork** (layered mountain ridges, a dashed winding road, a sun glow), not photography. Real motorcycle photography is welcome later but needs images the project has rights to; do not use third-party photos, even from reference mock-ups.

### Out of scope / known limits
- The map basemap is always the light style, so it appears as a light panel in dark mode. A dark basemap flavour is a possible follow-up.
- The brief's concept screens for marketplace listings use sample listings; the real marketplace is not built, and no fake listings are shown.
- The working product name stays "Long-Ride Planner"; the brief's "RIDE INDIA" wordmark was not adopted until a name, domain and trademark check are decided.
- A full Figma set (landing, dashboard, trip planner, trip details and expenses, garage, community, marketplace) is still a design deliverable; the running app now serves as the reference for the first five.

## Addendum D (2026-11-14): Rider profile screens

Follows the design system in Addendum C. Public card: label "Rider profile", initials avatar (white initials on a palette colour at 4.5:1 or better), display name, `@handle`, city and state, bio, a three-tile row (Rides, KM ridden, Places) only when allowed, "My riding interests" chips, and "Rides a <make model>" only when allowed. Edit screen: preview first, then the form in three groups (Public identity, My riding interests, What other riders can see). Visibility is two large radio cards (Private is the default). Interest chips and avatar swatches are real checkboxes and radios, at least 44 px, with a visible focus ring. Safety controls on the public page are secondary buttons; the report form opens in a disclosure. An automated accessibility scan (axe, WCAG 2 A/AA) runs on these screens in light and dark.

## Addendum E (2026-11-14): Community screens

Ride cards: title, state pill (Open, Full, Cancelled, Finished), "city to destination" and distance, date and time, host avatar and name, "X of Y riders" with "Host approves" or "Invite only", and the viewer's own status in link colour. Invitations use an orange outline. Request rows show avatar, name, handle, the ride and Approve/Decline buttons that name the rider for screen readers. Forms use grouped fieldsets (Where, When, Who can join) with help text tied to inputs by `aria-describedby`. The report form opens in a disclosure. All controls are at least 44 px; radios and checkboxes use the whole row as the target. Automated accessibility scans (WCAG 2 A and AA) cover these screens in light and dark.
