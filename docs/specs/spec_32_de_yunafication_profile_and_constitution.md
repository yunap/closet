# Spec 32: De-Yunafication — user profile config, the style constitution as data + onboarding flow, and BYOK graceful degradation

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


**Status:** Reviewed 2026-07-18 (rulings: Layer-3 as FORM in v1; BYOK key UI in; constitution history in). Parts 1–2 IMPLEMENTED 2026-07-18 (branch `codex/spec-32-profile-constitution`, byte-equivalence proven against a real-DB copy, 594/594 green). **Part 4 DEFERRED (owner ruling 2026-07-18):** the platform decision landed on a MULTIUSER WEB APP (owner is a 30-year web developer; desktop dropped) — key handling belongs to that platform spec's auth/tenancy design, not a local config file. Part 3 in progress.
**Owner ruling encoded:** the style constitution does NOT ship as a blank editor or a static template — it turns into a FLOW in onboarding (interview-driven), then keeps growing through the existing learning loop.
**Scope note:** platform-independent by design. No auth, no multi-tenancy, no Electron packaging, no platform decision — this spec makes a *single-user instance configurable to a person who is not Yuna*. Whatever platform is chosen later inherits this unchanged.

## The safety rail (read first)

**Yuna-equivalence is the acceptance gate for the whole spec:** with Yuna's profile seeded (a provided migration does this from her current data), every assembled system prompt is **byte-identical** to today's `prompts.js` output — proven by snapshot tests, not eyeballs. Her instance must not change behavior at all; only the *source* of the words moves from code to data. This is the same discipline as spec 29's "rename only, byte-zero behavior change."

## Part 1 — User profile as data

- New `user_profile` storage (app_meta keys or a one-row table — follow the `home_location` precedent, which is already data): `display_name`, `pronouns` (subject/object/possessive; default they/them), `home_location` (exists — fold into the same read path).
- `prompts.js` stops exporting personalized string constants and starts exporting **assembly functions** taking a profile: the 23 "Yuna" references and ~10 she/her pronoun sites become template slots. Tests that assert on prompt text (16 "Yuna" refs in aiEndpointContracts alone) switch to a shared seeded-default fixture profile.
- Frontend: the handful of display personalizations (header, the hardcoded `SUGGESTIONS` referencing Yuna's actual garments, the known-cities list in StylistChat) read from profile / become generic (suggestions should derive from the user's real wardrobe categories once pieces exist; empty-wardrobe suggestions point at onboarding).
- Explicitly GLOBAL (not per-user): the tagger's craft rulings (lavender-vs-taupe, home-occasion strictness, folk_artisan boundaries) — those are quality lessons about garments, not Yuna's taste. They stay in code.

## Part 2 — The style constitution becomes per-user data

- The five hardcoded layers in `prompts.js` — `BODY_CONTRACT`, `PROVEN_FORMULAS`, `AESTHETIC_GRAVITY`, `LANE_NEUTRALITY`, `WORKING_STYLE` — move to a `style_constitution` store (per-layer rows: layer key, body text, updated_at; additive migration).
- Prompt assembly reads the stored layers; provider.js's stable-prefix cache split is preserved (the constitution is stable within a session — cache behavior unchanged).
- **Migration seeds Yuna's rows verbatim from today's constants** (the equivalence snapshot proves it).
- **Edit history (owner ruling 2026-07-18):** an append-only `constitution_history` table (layer key, prior text, source: edit|interview|migration, timestamp), written on every change. Once the constitution leaves git, this preserves the project's ruling-archaeology ability ("what did Layer 3 say before the interview rewrote it?"). No UI beyond a read-only listing; additive migration.
- A minimal **constitution view/edit surface** (settings-adjacent, plain text per layer) — the owner-ruling pattern this project runs on must survive productization: a user reading what their stylist believes about them, and correcting it directly, IS the product's core loop. Edits are the durable escape hatch for anything the interview gets wrong.
- Lane-drift vocabulary (Layer 4's "catalog drift", "teacher/librarian drift" — terms ratified from Yuna's feedback history) ships in the generic template as *empty*, with the generic quality bar retained ("execution, not conformity"); each user's drift terms accrue through their own feedback, same as Yuna's did.

## Part 3 — The constitution interview (the onboarding flow — owner's ruling)

First-run onboarding wizard, sequenced: **welcome → profile (name/pronouns/location) → API keys (Part 4) → constitution interview → wardrobe import (spec 31) → done**. The interview produces the initial constitution:

- **Layer 1 (Body & Comfort Contract) — structured form, required.** Hard rules must be explicit and user-confirmed, not inferred: cling/coverage boundaries (midsection, arms, neckline, hem — multi-select + free text), shoe constraints (heel tolerance, walking reality), tuck/engineering tolerance, maintenance tolerance. These are the rules the register/comfort gates ultimately serve — worth a form's precision. Skippable only with an explicit "no restrictions" confirmation, never by omission.
- **Layer 3 (Aesthetic Gravity) — structured form in v1 (owner ruling 2026-07-18; the stylist-run conversational version is a follow-up spec).** Fields: home-base vibe words (free text + suggested-lane chips), color loves and hates, print/pattern appetite, plus an open "anything else your stylist should know" text area. The layer text is assembled from the answers and shown for approval/edit before saving. The plum/mustard lesson is encoded as a *generic* assembly rule: NEVER record a "favorite/signature color" the user didn't literally state — loves/hates are recorded as stated, no superlatives synthesized.
- **Layer 2 (Proven Formulas) — starts nearly empty, by design.** Formulas are *earned* (proven = worn and confirmed), not interviewed. Seed only the two universal mechanics lines (hierarchy, light-expands/dark-recedes). Spec 31 tie-in: after a wardrobe import, mine the accepted worn-outfit photos for recurring silhouette patterns and PROPOSE (never auto-write) formula candidates for user ratification. The confirmed-outfit lookbook line stays (it's DB-driven already).
- **Layer 4 + Working Style — defaults**, generic template text; evolve through use. One interview question total ("how direct do you want feedback?") feeds Working Style.
- Interview is re-runnable per layer from settings (redo the aesthetic chat without touching the body contract).

## Part 4 — BYOK graceful degradation

- **Settings UI for the two keys ships in this spec (owner ruling 2026-07-18):** a simple settings screen writing a local config file the server reads at startup (env still wins for dev; the file is chmod 600 and gitignored). Key storage hardening (OS keychain) remains the platform spec's job — this UI is the portable baseline it will wrap or replace.
- **Anthropic key: required** — absence routes to onboarding's key step with a link to get one, not a crash (today provider.js throws at call time).
- **OpenAI key: optional, and its absence must degrade cleanly** — it powers image rendering ONLY (verified: all five OpenAI client sites in core.js are image-creation functions). Without it: render buttons show a "add an OpenAI key to enable outfit images" state instead of erroring; everything else untouched. Today's behavior on a missing key (throw) becomes gated capability detection surfaced to the frontend once.
- Cost visibility: surface the existing per-call pricing machinery in settings (session spend to date), reusing provider.js tables — display only, no new metering.

## Acceptance

- **The equivalence snapshot:** assembled prompts with Yuna's seeded profile === current constants, byte-for-byte, for every prompt the app sends (STYLIST_SYSTEM, composer systems, critics, tagger). This test is written FIRST and must pass before/after the constants are deleted.
- Generic-profile assembly test: empty/default profile renders a coherent, Yuna-free prompt set (no "Yuna", no she/her unless configured, no Urban Artisan, no plum/mustard clause).
- Onboarding flow test: fresh empty DB → wizard completes → profile + constitution rows exist → stylist chat functions with the generic constitution.
- BYOK degradation test: no OpenAI key → outfit-image endpoints return the capability-off response, zero throws in the log; no Anthropic key → server starts, UI routes to key setup.
- Suite stays hermetic (`wardrobe.db` mtime rule) and fully green.
- Live smoke (owner): run her real instance post-migration through a normal styling turn (must be indistinguishable), then a scratch empty-DB instance through the full wizard including the aesthetic interview.

## Risks / out of scope

- Biggest risk is a silent drift in Yuna's own prompts during the constants→data move — that's what the byte-equivalence snapshot exists to make impossible.
- Interview quality for Layer 3 is a judgment surface; containment is that every layer is user-visible and editable (Part 2's surface), so a bad draft is a correction away, not baked in.
- Out of scope: auth/multi-tenant/hosting, Electron packaging and keychain storage, marketplace/template constitutions, **the stylist-run conversational Layer-3 interview (follow-up spec — v1 ships the form per the 2026-07-18 review ruling)**, Pinterest-board import for aesthetic seeding (parked; would slot into the Layer 3 step later), translating constitution edits into engine-gate changes (constitution text informs the model; the structured gates keep their own owner-ruling pipeline).
