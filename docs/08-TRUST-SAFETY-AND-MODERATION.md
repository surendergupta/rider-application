# 08 — Trust, Safety & Moderation

**Version:** 2.0 · **Status:** Policy and requirements for features that are **not built yet** (community, marketplace), plus what protects users today.

A rider marketplace and community are an operational commitment, not a form. Nothing below should ship without people and tools able to enforce it.

## 1. Marketplace category policy (first release)

| Category | Policy |
|---|---|
| Touring luggage, bags, racks | Allowed |
| Non-safety-critical accessories (phone mounts, covers, tools) | Allowed |
| Riding apparel (jackets, gloves, boots, rain gear) | Allowed with seller-stated condition and photos; moderators may require more detail |
| **Used helmets** | **Prohibited or tightly restricted** at launch: hidden damage and unknown crash history can be dangerous |
| Damaged or crash-affected protective equipment | Prohibited |
| Safety-critical components (brakes, tyres, structural parts) | Prohibited until a defensible category policy exists |
| Counterfeit or unauthorised goods | Prohibited |
| Motorcycles and ownership transfer | Out of scope |

Rules that follow from this:
- **Never label an item "verified"** unless a documented verification process actually exists.
- **No escrow, wallet or platform-controlled settlement** in the first version. Buyers and sellers arrange payment themselves, under prominent warnings about payment fraud, inspection before paying and ownership documentation.
- No shipping or checkout integration in the first version.
- Promoted listings, when they exist, are labelled and never exempt from moderation.

## 2. Marketplace listing requirements

A listing has: title, category, condition, price, city (not an exact address), description and photos. Moderators can request more information. Phone numbers and addresses are not shown publicly; contact goes through protected in-app inquiries.

Listing states: `draft`, `pending_review`, `active`, `reserved`, `sold`, `removed`. A seller marks reserved or sold. Removal records a reason.

## 3. Reporting and moderation workflow

- Any signed-in user can **report** a listing, post or user with a reason and optional note.
- A report opens a **moderation case**: `open` -> `under_review` -> `actioned` (removed, warned, restricted) or `dismissed`.
- **Target: reports reviewed within 24 hours (at least 95%).** Do not launch the marketplace beta without someone assigned to meet this.
- Actions: remove content, warn, temporarily restrict, ban. Every action writes an **audit event** (who, what, when, reason). Users can see that content was removed and why, and can appeal through a stated contact.
- Users can **block** another user; blocked users cannot contact them.
- Repeat or severe abuse (fraud, scams, counterfeit goods, harassment) leads to account restriction.
- Admin tools are required before the beta: report queue, listing takedown, account restriction, audit log. Admin access uses a separate role and every action is logged.

## 3b. Community policy

- Posts, rides and clubs are **private by default**; sharing is an explicit choice.
- **Never public:** home address, raw location history, private motorcycle documents, phone numbers.
- Public rider profile shows only what the rider chooses (display name, city-level location, bikes they choose to show).
- Club organisers can manage their own members and rides; they cannot see members' private trips or garage.
- Group features must not expose another rider's expenses, notes or documents without their explicit consent.

## 4. Privacy and data protection

- India's Digital Personal Data Protection Rules have phased commencement dates. **Review obligations that apply at the time of launch** (consent, notice, purpose limitation, retention, deletion, grievance handling, handling of children's data). This document does not assert which provisions are in force.
- Collect the minimum. Today the product stores an email, a hashed password, bikes, trips, expenses, maintenance records, document **expiry dates and a short note only** (no document numbers or files), checklist items, and interest/waitlist rows.
- **Not collected:** live location, bank or UPI data, receipts, document images, payment details.
- Trips and routes can reveal movement patterns: private by default, never published unless the rider turns on a share link.
- **Deletion:** a rider can delete the account and all data from the Account page. Backups may keep data for a limited, disclosed period.
- Share links are opt-in, expose only a fixed summary (title, route labels, distance, total, cost per km, status), are `noindex`, and stop working the moment sharing is turned off.
- If analytics are added: ask consent where required and never send trip, route or location detail.
- Name a **grievance contact** and publish it before launch.

## 5. Security baseline (in place now)

- Row-level security on every user table; two-account isolation tests run against the real database.
- Server-side checks on ownership; the owner is never taken from client input.
- Security headers (CSP, anti-framing, nosniff, HSTS, Permissions-Policy).
- Account deletion uses a server-only admin credential; no admin key reaches the browser.
- Rate limiting on route lookups (in memory; replace with a shared store before running multiple servers).
- CSV exports neutralise spreadsheet formula injection.

## 6. Incident response (before public launch)

Define: who is on call, how to disable a feature (feature flags), how to take down content quickly, how to notify affected users, and what to log. Keep logs free of tokens, coordinates and free-text notes.

## 7. Launch gates for trust and safety

| Gate | Needed before |
|---|---|
| Category policy published and shown to sellers | Marketplace beta |
| Report queue, takedown and audit log working | Marketplace beta |
| A named person meets the 24 h review target | Marketplace beta |
| Fraud and inspection warnings visible on every listing and inquiry | Marketplace beta |
| Privacy review against applicable data-protection provisions; grievance contact published | Public launch |
| Lawyer review of Terms and Privacy | Public launch |
| Custom email sending configured; secrets rotated | Public launch |

## 8. Status today

| Area | Status |
|---|---|
| RLS, ownership checks, headers, account deletion, share-link privacy | Built and tested |
| Waitlists (community, marketplace) | Built |
| Listings, inquiries, reports, moderation queue, blocks, audit events | **Not built** |
| Public profiles, group rides, clubs, community posts and ride stories | Built (focused checks) |
| Moderator queue (posts, rides, clubs, profiles), takedown, account restriction, audit log | **Built** (focused checks). Still needed: a named reviewer meeting the 24-hour target, an appeal contact, and removal notices to riders |
| Legal text | Draft, needs lawyer review |

## Addendum A (2026-11-14): Rider public profile policy (implemented)

**Principle:** opt-in, privacy-first, and separate from the private account. A profile is **private until the rider turns it on.** Nothing is shown unless the rider chooses it.

### What a public profile can contain
Handle (unique, lowercase), display name, avatar (coloured initials), optional bio (300 characters), optional city and state, riding interests (from a fixed list, up to 6), the rider's chosen motorcycle **make and model only**, and ride totals (completed rides, kilometres, number of places) **only if the rider turns them on**.

### What is never exposed
Email, phone number, home address, registration number, VIN, insurance or other documents, a motorcycle's custom name or odometer, exact or live location, trip routes, dates, expenses or any private ride history, and the internal user id. Location is city and state only; the form says never to enter an address.

### How this is enforced (not just promised)
- **No public database read path.** `rider_profiles` has no public SELECT policy, so the database interface cannot list or scrape profiles. Public pages are built on the server from a fixed field whitelist; they cannot include a column that is not on that list.
- **Indistinguishable refusals.** A missing handle, a private or disabled profile, and a viewer the owner has blocked all produce the same plain 404, so profiles cannot be probed.
- **No indexing.** Profile pages carry `noindex, nofollow` until community moderation is in place.
- **Text only.** Bio and names render as plain text; markup is never interpreted.
- **Handle rules.** 3 to 20 letters, numbers, underscores, at least one letter, stored lowercase (so case cannot create look-alikes), reserved words blocked. One change per 30 days, enforced in the database and not resettable by the rider. A handle freed by deleting a profile can be claimed by someone else.
- **Availability check** reveals only whether a handle is taken, never who owns it; it needs sign-in and is rate limited.

### Report and block
- **Report:** any signed-in rider can report a profile they can see (spam, impersonation, inappropriate, harassment, other, with an optional note up to 500 characters). One open report per reporter per profile; repeats are harmless duplicates. Limit 5 per hour per account. A reporter sees only their own reports.
- **Block:** a blocked rider gets a plain 404 for the blocker's profile and cannot report or block them. The blocked person is never told. The blocker keeps a list and can unblock at any time, even if the other profile later becomes private.
- Both are enforced in the APIs, not only hidden in the interface.

### Image avatars: deferred on purpose
Uploaded photos need moderation (review queue, takedown, audit log) that this document requires before launch and that does not exist yet. The avatar is therefore initials on a colour. Add image upload only together with the moderation tooling.

### Not built yet
A moderator queue to action reports (reports are stored with status `open`), audit events, and any messaging, follower or feed features (out of scope for this task).

## Addendum B (2026-11-14): Group rides and rider discovery (implemented)

### Rider discovery
Opt-in only (off by default), requires a Public profile, signed-in viewers only, paginated, rate limited. Shows only what the rider made public. Excludes the viewer and anyone blocked either way. Going private removes the rider immediately.

### Group rides: safety rules
- **Only a city or area is public.** The exact meeting point and host note go to confirmed riders only. Hosts are told to choose a public place such as a fuel station.
- **No live location, no photos, no free-form direct messaging** in this phase.
- **Disclosure:** the host and join forms state that display name and handle are visible to the riders on the ride, and that riders are not verified and no background checks are run. A safety note appears on every ride page.
- **Approval and removal:** hosts can require approval, remove riders, and withdraw invitations. A removed rider cannot rejoin themselves.
- **Blocks apply to rides:** a blocked rider cannot see, join or be invited to the blocker's rides, in either direction, even if they had joined before.
- **Reports:** any rider who can see a ride (and is not its host) can report it. One open report per reporter per ride; stored with status `open`.
- **Hosting requires a rider profile**, so riders on a ride always have a name and handle for the others to see.
- **Cancelled rides** stay visible to people who were part of them so nobody is left waiting at a meeting point, and are hidden from everyone else.

### Still required before a public launch of rides
A moderator queue to act on ride and profile reports (review, remove a ride, restrict an account) with an audit log; a named person meeting the 24-hour review target; decisions on notification channels; and lawyer review of the safety disclaimers.

## Addendum C (2026-11-14): Riding clubs (implemented)

- **Visibility:** public clubs show name, location, description and member count to signed-in riders; the member list is for members only. Private clubs exist only for members and invitees and are always invite only.
- **Privacy:** only city and state are stored; members see each other's display name and handle (disclosed on the create and join screens). No addresses, photos or messaging.
- **Control:** the owner is the accountable person: they edit settings, appoint or remove admins and archive the club. Admins can approve, invite and remove ordinary members. Removed riders cannot rejoin themselves.
- **Blocks and reports** work as for rides: a block hides clubs both ways, even from existing members; riders can report a club they can see and do not own (one open report per reporter).
- **Before a public launch:** the moderator queue must also cover club reports (review, archive or remove a club, restrict an owner), with the audit log and a named person meeting the 24-hour review target.

## Addendum B (2026-11-14): Community posts and ride stories (implemented)

- **Audience:** a post is either community-wide (signed-in riders who are not blocked) or club-only (active members of an active club). There is no public or search-engine access.
- **Ride stories** copy only the trip title, distance and completion date. The destination is included only when the rider ticks "Show the destination". Costs, expenses, start point, route and bike are never copied, and the post has no link back to the trip.
- **Limits:** 1,000 characters, 20 posts per rider per 24 hours (database), no images, no links preview, no editing, no comments.
- **Removal:** the author, or a club owner/admin for club posts, can delete. Reports (`post_reports`) are stored as `open`; riders cannot read anyone else's reports.
- **Launch gate (unchanged and still open):** the moderator queue must also cover post reports (review, remove a post, restrict an account) with the audit log and a named person meeting the 24-hour review target.

## Addendum: Moderator queue (2026-11-14, built)

- **Who:** moderators are listed in `moderators` and added with `npm run mod:add -- <handle>`. They use `/moderation`; to everyone else it does not exist.
- **Queue:** open reports (open or under review), oldest first, grouped per item with a count and reasons; a Closed tab; Restrictions; Audit log.
- **Decisions:** start review, dismiss, take down (post removed, ride cancelled, club archived, profile made private), or take down and restrict the owner for 7, 30 or 90 days or until lifted. Every decision needs a written reason and writes an audit event (who, what, when, why). One decision closes every open report about that item.
- **Restriction effect:** the rider cannot create posts, rides or clubs. They can still read, leave rides and clubs, and delete their own content and account. They see the reason on screen.
- **Safeguards:** a moderator cannot act on reports about themselves or restrict another moderator; the audit log cannot be edited or deleted from the app.
- **Still required before a public launch:** a named person meeting the 24-hour review target; a published appeal contact; a message to a rider whose content was removed; the same queue for marketplace listings; lawyer review of the wording.
