# Spec 34: The public front door — landing page, canned tour, invite-request queue, and the admin UI

> ## ⚠️ HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The `Status:` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.


**Status:** Written + reviewed 2026-07-20. Open questions RULED (see below). Builds on spec 33 Parts 1–4, all MERGED (#136–#140).
**Implementation split (owner ruling 2026-07-20): two PRs.** PR A = **admin UI (Part 4) first** — it's the operational need and doesn't depend on the public surface. PR B = the public front door (Parts 1–3: landing/welcome, canned tour, invite-request queue). Part 3's request queue writes to a table the admin UI reads, so PR A ships the `invite_requests` table + its admin panel with an empty queue, and PR B adds the public endpoint that fills it — no rework, and A is useful the day it lands.
**Owner rulings encoded (2026-07-20 discussion):** (1) new users must not land on a bare login wall — a warm landing page, yes; a separate pre-login carousel tour, no (the spec 32 wizard + demo wardrobe ARE the tour); (2) accidental no-invite visitors get a canned tour + a request-an-invite queue, NOT live LLM access; (3) the BYOK walk-in open-signup tier is deliberately DEFERRED until the app leaves the owner's machine; (4) **an admin UI for handling users ships in this spec** — the Part 2/4 CLI scripts (`create-invite.js`, `reset-password.js`, `approve-operator-key.js`) were explicitly "no admin UI in v1, CLI only"; this spec is that v2, with the scripts demoted to break-glass.

## The audience model (read first)

Every current visitor is one of three people, and the front door serves all three from one place:

1. **An invited friend** arriving via a link the owner sent personally. The page's job is confirmation and warmth, not conversion — "you're in the right place." Invite links carry the code.
2. **A returning user** — login form on the same page. No dead-end login wall.
3. **An accidental discoverer** — no invite. They get a real look at the product (canned tour) and a path in (request queue), but no accounts and no LLM spend. Self-defending by construction: there is nothing on the public surface that costs money per visitor.

## Part 1 — Landing / join page

- Logged-out visitors at any app route land on `/welcome` (logged-in users never see it). One screen: the one-sentence pitch ("a personal stylist that actually knows your closet"), two or three real product shots (an outfit card, the import review, a stylist chat), the canned tour (Part 2) as the centerpiece, and the account actions.
- **Invite links carry the code:** `/join?invite=CODE` pre-fills signup and greets — "You're invited" (inviter's display name deliberately NOT shown: invites know `created_by`, but leaking who runs which account is a privacy call the invitee didn't make; generic warmth is enough).
- Manual code entry stays (someone texted a bare code). Invalid/used code → a kind message, not a form error dump — with the request-queue path offered.
- **The no-invite state is designed, not a 401:** "invite-only for now" + the tour + the request form. This is the graceful-curious-partner page ruled needed back in the spec 33 discussion.
- Static, no per-visitor server work beyond serving the page; no analytics in v1.

## Part 2 — The canned tour (show the product without running it)

- A replayed stylist conversation: real transcripts recorded from a demo-wardrobe session, played back as a paced, interactive-feeling chat (tap/scroll to advance — NOT autoplay video), plus stills of the import review and an outfit board. Zero LLM calls, zero accounts, zero abuse surface — the anonymous-visitor version of "the demo wardrobe is the tour."
- Content is **checked-in static assets** (curated transcript JSON + images), not live data: curated once, versioned in git, no drift risk and nothing personal. Assembled from the demo wardrobe's 62 pieces so no real person's closet appears.
- Tour ends with the fork: "Have an invite? →" / "Want in? →" (request queue).

## Part 3 — Invite-request queue

- `invite_requests` table in **system.db** (id, email, note "how'd you find this?", status: pending|approved|dismissed, created_at, decided_at) — deliberately NOT an email-sending flow; zero-external-services posture holds. Approving does not notify anyone; the owner sends the code personally, which is the invite-only model working as designed.
- Public `POST /api/invite-requests`: email + optional note. Abuse guard, minimal but present: honeypot field + per-IP rate limit (small in-memory counter is fine at this scale) + dedupe on email (re-submitting bumps created_at, no duplicate rows).
- The queue surfaces in the admin UI (Part 4): approve → mints a one-time invite and shows the copyable `/join?invite=CODE` link next to the requester's email; dismiss → status only, row kept (a re-request after dismissal is visible as such).

## Part 4 — The admin UI (owner requirement 2026-07-20)

- **Admin flag, not a magic user id:** additive `is_admin INTEGER DEFAULT 0` on users; migration sets it for user #1. Every guard checks the flag (`requireAdmin` middleware on an `/api/admin/*` namespace) — no `userId === 1` scattered anywhere. Admin UI is a Settings section (e.g. Settings → Administration) rendered only for admins; non-admins get neither the UI nor the endpoints (403).
- **Users list** — one row per account: email, created, last-seen (max over sessions), active-session count, cumulative spend (read from the user's own DB meter), storage footprint (their data dir size), `operator_key_approved`, own-keys-configured indicator (boolean only — never the keys), admin flag, status. Actions:
  - **Operator-key approval toggle** (replaces `approve-operator-key.js`).
  - **Per-user spend-ceiling override** (blank = the $20 default).
  - **Password reset:** generates a one-time reset code shown ONCE to the admin, who hands it over personally (same trust channel as invites); the user redeems it at login for a new password. Replaces `reset-password.js` and stays email-free.
  - **Revoke all sessions** (force logout — the sessions table from spec 33's device-management ruling, reused).
  - **Disable / re-enable:** `status` column (active|disabled); disabled users can't log in, existing sessions die on next request, their data stays intact. This is the safe first reach — deletion is separate and scarier.
  - **Delete:** typed-confirmation (the email), removes the account, sessions, AND the user's data directory. Their per-user file layout makes this genuinely complete — one directory — which cuts both ways; the confirmation copy says so plainly. Admins cannot delete themselves; the last admin cannot be deleted or de-flagged.
- **Invites panel** — mint (code + copyable join link), outstanding and used lists (who invited whom, when redeemed), revoke unused codes. Replaces `create-invite.js`.
- **Requests panel** — the Part 3 queue with approve/dismiss.
- CLI scripts stay as documented break-glass (locked-out admin, headless box) but the UI is the normal path.

## Deferred (documented, not built): the BYOK walk-in tier

Open signup where uninvited users create accounts with **zero operator-key access** — wizard routes them through the add-your-own-Anthropic-key step (already built, PR #140), they pay Anthropic directly and cost the operator only disk. Architecturally cheap now; deliberately parked because it's a *posture* decision, not a code one: it only makes sense once the app is on a VPS with HTTPS, and it means strangers' wardrobe photos on the operator's infrastructure. When revived, the landing page's request-queue slot becomes the "or sign up with your own key" slot — nothing in Parts 1–3 is throwaway.

## Explicitly out of scope

- Email sending of any kind (verification, notification, reset links).
- Analytics/tracking on the public page; SEO work.
- In-UI admin creation of users (invites are the only door); multi-admin management beyond the flag.
- Live/sandboxed LLM demo for anonymous visitors (the canned tour is the ruling).

## Acceptance

- Logged-out visit to any route → `/welcome`; logged-in users never see it; login works from it.
- `/join?invite=CODE` pre-fills; used/invalid codes get the kind message + request path; bare-code entry works.
- Tour plays with the network tab quiet: zero API calls, zero LLM spend, all assets static.
- Request queue: submission lands pending; honeypot and rate-limit paths rejected; duplicate email bumps, not duplicates; approve mints a working one-time code; dismissed rows persist.
- Admin: non-admin gets 403 on every `/api/admin/*` route and no UI; toggle/ceiling/reset/disable/delete each verified end-to-end (reset code redeemable exactly once; disabled user's live session dies on next request; delete removes the data dir; last-admin protections hold).
- The three replaced CLI scripts still run (break-glass), and the suite stays green + hermetic (admin tests against a scratch system.db).

## Review rulings (owner, 2026-07-20)

1. **Tour production: record a real demo-wardrobe session and edit it down** (not written from scratch) — it stays honest to actual product behavior. The edited transcript + stills are curated once and checked into git as static assets.
2. **Disabled-user login copy: honest** — "account disabled, contact the operator," not a generic credential error. This is friends-and-family; the honest message is the kind one.
3. **Storage footprint: computed live** per admin-page load (`du` on the user's data dir — fine at this scale). Revisit caching only if it gets slow.
4. **Spend visibility: cumulative only** in v1 — the admin sees the single number, not a per-session history. Less poking into a user's private file; the meter already lives in their `app_meta`.
