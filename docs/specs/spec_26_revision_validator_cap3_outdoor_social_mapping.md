# Spec 26: Reason-revision validator, footwear cap at 3, the outdoor_daytime_social confidence mapping bug, and four delivery/robustness strings

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
**Priority:** Part 3 is a diagnosed live bug that has cost winery-slot coverage in four separate runs; Part 1 is a twice-captured truthfulness bug; Part 2 carries an owner ruling (cap = 3). One PR.
**Files touched:** `styling-engine/outfitSetPlanner.js` (validator + cap + workbench strings), `src/utils/wardrobeAiContext.js` (confidence mapping), `styling-engine/tools.js` (partial-accept message, propose tool description), `styling-engine/prompts.js` or tool text (indoor season guidance), `routes/ai.js` (tagger maxTokens), tests. `dist/` rebuild if wardrobeAiContext is bundled client-side.

## Part 1 — Reason-revision validator (truthfulness)

Two captured occurrences of the model revising its outfit mid-reason while submitting the un-revised `piece_ids`: the 07-15 Tuesday card ("**Actually revising:** emerald v-neck top + oatmeal pants…" — dress submitted anyway) and the 07-16 Thursday card ("**wait, maxi skirt is prohibited per owner rule. Switching:** …mini skirt" — maxi 167 submitted; the phantom mini 96 then tripped the prose-citation guard downstream). The piece_ids-ARE-the-outfit instruction (spec 19 Part 3) failed both times.

In `validateSubmittedPlanOutfits`: reject any submitted outfit whose `reason` matches mid-course revision markers — `/\b(wait[,—ó -]|actually[, ]|switching to|revising|scratch that|instead let'?s)\b/i` — with: `"your reason revises itself mid-sentence — decide the pieces first, update piece_ids to match, and resubmit with a clean reason describing only the pieces you actually included."` This matches the model's OWN reply prose, not garment text (`// ratchet-allow: model's own reply prose, not garment matching` — the looksLikeDestinationOrWeatherQuestion precedent). Apply the same check in `propose_outfit`'s `why_it_works`. Tests: both live reason strings verbatim → rejected with the coaching; a clean reason containing the word "waiting" (e.g. "worth waiting for sunset") → NOT rejected (word-boundary + punctuation guards); resubmission with clean reason accepted.

## Part 2 — Footwear cap trigger moves to 3 (owner ruling, 2026-07-16) + gap-fill pointer

Live evidence from the first enforced run: the cap worked mechanically (coached rejections naming gate-eligible reuse options; hike's athletic pair exempted correctly; dinner obediently reused loafers) but the effective-2 calibration deadlocked the coastal slot — the model refused loafers-at-the-beach (defensible taste), burned the resubmit budget, coastal delivered 0/1.

- Change the rejection trigger from "distinct pairs ≥ 2" to "**distinct pairs ≥ 3**" (a 4th distinct pair is rejected when an already-used pair is gate-eligible; the eligibility exemption and coached message are unchanged).
- **Partial-accept message gains the legal path**: append to the resubmit-cap success message: `"To fill the disclosed gaps, call plan_outfit_set again with JUST the unfilled slot(s) — accepted cards carry forward automatically."` Evidence: post-close, the model tried submitting to a dead plan, then propose_outfit (blocked), and never found the spec-23 merge path — which is only advertised in the propose-block message it sees too late.
- Tests: 3rd distinct pair accepted; 4th rejected with coaching; exemption still fires; cap survives a partial re-plan merge; partial-accept message contains the pointer.

## Part 3 — outdoor_daytime_social must not read the tagger's rugged `outdoor` confidence (diagnosed live bug)

**Chain, verified in code + live DB (2026-07-16):** winery slots resolve to occasion `outdoor_daytime_social` → `normalizeOccasionForConfidence` ([wardrobeAiContext.js:81](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/src/utils/wardrobeAiContext.js:81)) prefix-collapses every `outdoor*` occasion to the single tagger key `outdoor` → the tagger fills `outdoor` with rugged/exposure semantics, so refined pieces systematically carry `outdoor: low` (live DB: linen wide-leg pants 128 low, patchwork top 260 low, paisley blouse 83 medium) → `autoStylingTrustDecision` suppresses low + not-explicitly-tagged ([wardrobeAiContext.js:146](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/src/utils/wardrobeAiContext.js:146)) → exactly the pieces ideal for a winery patio die with "AI profile low confidence for outdoor_daytime_social," the model re-picks them from the shared catalog, burns resubmits, and the slot under-fills. Four runs show this signature. The prefix rule predates the `outdoor_daytime_social` occasion — an accident of `startsWith('outdoor')`, not a gate-history Decision.

Fix in `normalizeOccasionForConfidence` (or at the lookup site): occasions matching *social* outdoor (`outdoor daytime social`, and any future `outdoor_*_social`) resolve confidence as the **best of** `casual`, `smart-casual`, and `outdoor` keys. Rationale: exposure is the weather gates' job, ruggedness is the activity profile's job — occasion confidence should measure social-register suitability. Plain `outdoor`/hiking-flavored occasions keep the strict `outdoor` key.

Tests: fixture with `outdoor: low, casual: high` passes an `outdoor_daytime_social` check (the 128/260 shape); fixture with all-low still suppressed (gate keeps teeth); a hiking-flavored occasion still reads `outdoor` strictly; suppression reason text unchanged for true suppressions. If `wardrobeAiContext.js` is bundled into the frontend, rebuild `dist/` per repo convention.

## Part 4 — Indoor season guidance for the propose path

Live: a "client meeting tomorrow morning" propose turn had tailored trousers rejected TWICE as "hot weather: insulating piece" — an indoor, air-conditioned context gated by the July forecast because the model passed `season:"warm"` and the propose path has no indoor signal; the model recovered by `anchor:true` on a piece the user never named (third wrong-gate→anchor incident class). One line in `propose_outfit`'s tool description (and/or the declare_intent cards contract): `"For indoor occasions (office, restaurant, meeting, gallery), pass season:'indoor' — the live forecast applies only to time spent outdoors."` Mirrors the plan-slot mechanism that already works.

## Part 5 — Owner rules are hard requirements (framing)

Live: with the rule delivered and acknowledged, the model still wrote "the red paisley wrap shawl **can drape over the shoulders if the office AC runs cold**" — a constructed exception on a regular office day. Strengthen the workbench OWNER RULES framing: `"OWNER RULES — hard requirements, not suggestions. Do not construct exceptions or conditional workarounds (no 'in case the AC runs cold'). If a rule makes a slot impossible, disclose the conflict instead of bending the rule."` Prompt-firmness only; the #44 boundary (no mechanical authority for stored text) stands.

## Part 6 — Professional-slot styling line joins the workbench

The spec-25 competence bullet is live in STYLIST_SYSTEM ([prompts.js:99](../Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/prompts.js:99)) but demonstrably weak from tail position (the 07-16 office run: shawl on Tuesday, double botanical on Wednesday). Same delivery lesson as owner rules: append to workbench instructions, contextually scoped by its own wording: `"For professional/work slots (office, client, presentation): quiet, structured pieces lead; at most ONE bold print per outfit; accessory register matches the outfit; no statement wraps at work. Social slots (dinner, gallery, weekend) are where statement styling belongs."` The 07-16 dinner probe (Saturday Night Botanica — fully vibrant) shows current pressure does not over-suppress; re-check that probe after this lands since the pressure moves closer to composition.

## Part 7 — Tagger response truncation (spec 22 follow-up)

`AI retag error: SyntaxError: Unterminated string in JSON at position 5084` at `parseModelJson` — spec 22 fixed the 400; the tagger response now truncates at the default ~1,200-token cap. Raise `maxTokens` on the tagger call path (`tagPieceWithProvider` → `askStylist`) to ≥ 2,500, and have `parseModelJson` report truncation explicitly (distinguish "model returned bad JSON" from "response hit the token cap") so the next cap issue self-identifies. Test: tagger prompt path passes the raised cap; a deliberately truncated fixture produces the truncation-specific error. Live acceptance: retag piece 258 — third attempt's the charm.

## Parked for owner discussion AFTER this spec (recorded, no code)

Whether baseline office norms beyond prints/wraps — e.g. skirt length (the mini has now appeared twice in office contexts) — belong in the Part 6 competence line as system defaults rather than user rules. The owner's position (2026-07-16): average office norms should not require user rules. Revisit with the post-26 office run as evidence; wording must respect the #68/#86 rulings (hemline is not formality — any hemline guidance must be occasion-scoped, never a formality signal).

## Risks

Part 3 loosens one suppression mapping in the tag-driven direction with an all-low fixture keeping the gate's teeth. Part 1 is prose-matching on the model's own output — narrow markers, word-boundary tested. Part 2 is a threshold change under an owner ruling. Parts 4–6 are strings. Part 7 is a token cap.
