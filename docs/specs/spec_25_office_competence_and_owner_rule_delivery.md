# Spec 25: Professional-context competence in the system prompt, owner-rule delivery to the workbench, and scoped reaction history

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


**Status:** Proposed (2026-07-16). Not implemented.
**Priority:** High-value, all strings — no mechanism. This re-homes the last knowledge family that previously lived only in deleted scorer code (office-context styling competence), fixes stored owner rules being under-weighted, and stops reaction history from being read as global style doctrine. Ship as one PR.
**Files touched:** `styling-engine/prompts.js` (STYLIST_SYSTEM bullet), `styling-engine/rules.js` (`getStylistFeedbackMemory` rendering), `styling-engine/tools.js` + `styling-engine/outfitSetPlanner.js` (owner rules → plan workbench), `docs/freeform-rearchitecture-handoff.md` (live-test plan gains style expectations), tests.

## Live evidence (2026-07-16, wardrobe-dev.log.claude12.3 + DB forensics)

- **The boho office drift predates spec 14 and is a model-composition property, not a cleanup regression.** Monday's outfit in the post-#106 run is piece-identical (`260, 990440, 196, 103`) to Monday in the 07-15 run composed BEFORE spec 14 existed; Tuesday's stripe-mock-neck-over-tropical-pants pairing likewise. The deleted office scorers had been out of the composition path since the model-mode flip; nothing they guarded was running. Principle this spec operationalizes: **cleanups delete mechanism, never knowledge — knowledge that lived only in deleted mechanism gets re-homed in prompt doctrine.**
- **Three of four plain office days composed print-led/artisan** (botanical patchwork + relaxed mauve pants; tropical print pants + paisley shawl; abstract animal print blouse) while quiet, structured, gate-eligible alternatives sat unused in the same rosters (wide-leg/taupe/oatmeal trousers, tie-front blouse, emerald shell — several appear elsewhere in the same plan). NOT a wardrobe-thinness problem: slots were `weather:"indoor"` (heat-neutralized) and the quiet shelf was eligible. Also register-incoherent pairings within outfits (dressy paisley shawl over casual relaxed pants).
- **The owner's stored rule was in the prompt and ignored.** Row 342 ("For office and client days: structured silhouettes only — no maxi skirts, no shawls at work"), stored via `store_user_correction` on 07-16, confirmed present in the /ask payload's "Global saved stylist feedback/preferences" section (`buildStylistConversationPayload` → `getStylistFeedbackMemory(null,null,24)`, [core.js:3788](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/core.js:3788)). The next office plan still produced a maxi skirt (Thursday) and a shawl (Tuesday). Causes: it renders as `- preference_reaction on message: …`, visually identical to 23 reaction-history crumbs; and plan composition happens against the workbench tool result, ~40k tokens from the system tail (every instruction the model demonstrably obeys lives in the workbench).
- **Reaction history reads as global doctrine.** Row 341 — owner praise for "geometric maxi skirt + ruffled plum top… perfect for an upscale dinner" — sits in the same flat list; the corpus of artisan/botanical praise (saved from dinner/social boards) plausibly drives the boho lean on office days. The lines carry their board labels but nothing tells the model reactions are context-scoped.

## Part 1 — Professional-context competence bullet in STYLIST_SYSTEM

Add one bullet to the styling-doctrine section of `STYLIST_SYSTEM` (prompts.js), system-side baseline competence — NOT a user preference:

> "Professional and work contexts (office days, client meetings, presentations) default to quiet, structured, low-print styling: solid or subtle pieces lead, at most ONE bold print per outfit as a deliberate accent, and every accessory's register must match the outfit's register (no dressy shawls or statement wraps over casual pieces at work). Save artisan, botanical, and statement styling for social contexts — dinners, galleries, weekends — unless the user asks for it at work. This is the default, not a rule the user must state."

This is the deleted `pieceOfficePolishScore`/office-register intent re-homed at the architecture's designated taste layer. Wording judged against the #68/#86 owner rulings: it constrains print *count and context*, never bans prints by name, and says nothing about hemline (the owner's maxi/shawl rule is HER rule, Part 2's job — the system line must not hard-code it).

Note: any STYLIST_SYSTEM edit re-caches the stable prefix once (~39k write on the first turn after deploy) — expected, not a leak.

## Part 2 — Owner rules: distinct rendering + workbench delivery

**Selector:** rows written by `store_user_correction` — today `feedback_type='preference_reaction' AND target_type='message'`. Also have `storeUserCorrection` write `feedback_type='owner_rule'` going forward and treat both as owner rules (no migration; old rows still match the legacy selector).

1. **Rendering** (`getStylistFeedbackMemory`, rules.js): owner-rule rows render as `- OWNER RULE: <note>` and sort to the top of the feedback section (after is_gold), under their own sub-header `Owner rules (standing, apply them):` — visually severed from reaction history. They remain prompt guidance, not gates — the #44 memory-pollution lesson (stored text must never get absolute mechanical authority) stands.
2. **Workbench delivery** (tools.js fetches, `buildPlanSlotWorkbench` renders): the plan workbench response gains, when any owner rules exist, an `owner_rules` block appended to `instructions`: `"OWNER RULES — apply to every outfit you compose: <notes, newest first, cap ~8>"`. Deterministic string pass-through of the same rows; composition-time context is where every obeyed instruction lives.

## Part 3 — Scope the reaction history

In the feedback section rendering, group non-rule rows under a header that states their scope: `Saved reactions (scoped to the named board/context they were given on — taste signals, not global directives):`. The lines already carry labels ("— Nice Dinner"); the header tells the model what the labels mean. One string.

## Part 4 — Style expectations join the live-smoke doctrine

Update the handoff doc's live test plan (and spec 21's smoke menu when it lands): the office-week smoke criterion becomes "5/5 cards AND Mon–Wed read office-quiet (≤1 bold print per outfit, no statement wraps, accessory register matches)" — delivery counts alone let this whole class ship. Friday may stay Friday.

## Acceptance (live, owner-run)

Re-run the exact office prompt after merge, then (per the standing plan) the owner adds her context extension ("save botanical/artisan for social days") as a stored rule and re-runs once more:

- Mon–Wed: quiet/structured leads, prints as single accents, zero shawls/wraps.
- Thursday: register-appropriate presentation look, no maxi skirt (her stored rule, now workbench-delivered).
- The workbench response visibly contains the OWNER RULES block with row 342's text.

## Tests

- `getStylistFeedbackMemory`: owner-rule rows render with the `OWNER RULE` prefix under the sub-header, sort above reactions; reaction rows render under the scoped header; legacy `preference_reaction/message` rows treated as rules; unit-fixture with both kinds.
- `storeUserCorrection` writes `owner_rule` type; dedupe still holds across the type change.
- Workbench: `instructions` contains the OWNER RULES block iff rules exist; cap respected; no block when the table is empty.
- STYLIST_SYSTEM contains the Part 1 bullet (string presence); ratchet net-zero.

## Risks

Zero mechanism — all strings and one enum value on new rows. The known trade: prompt-only office competence is exactly what failed in the pre-gate era (#66–#72 whack-a-mole), BUT that era failed at the *scorer* layer with keyword code; the architecture's bet — model judgment + explicit doctrine — has held everywhere else post-#106 (beach, dinner, coastal, register). If office drift persists after Parts 1+2 land and the owner's context rule is stored, that evidence reopens the question honestly — next step would be discussed, not assumed.
