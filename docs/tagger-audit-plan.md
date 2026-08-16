# Plan: auditing the tagger

**Status:** draft, amended 2026-08-15. Not started. Written after a live tagging test this session
surfaced two real, distinct problems in one response: a worn photo silently not reaching the
model (fixed, PR #227), and a free-text field (`failure_risks`) contradicting the piece's own
structured fields (`"ribbed hem may bunch if tucked"` on a piece the tagger itself marked
`tuck_behavior: wear_over_only`, `length_hits_at: tunic` — tucking was never a live possibility).
That second one is not a one-off typo to patch; it's a symptom of never having asked whether the
tagger's output is *coherent*, only whether the schema is *populated*. This plan is the "ask before
building" list from that conversation, turned into something runnable.

**Amended same day:** checked against `docs/app-surface-map.md`, `docs/engine-behaviour-map.md`,
`docs/feedback-and-memory-map.md`, and `docs/garment-field-reference.md` to confirm the plan would
actually let the owner answer "is the tagger the best it can be, knowing everything else this app
already knows." Added Q7 (schema drift between the two tagger prompts), broadened Q5 from anchors-
only to the four cost levers `engine-behaviour-map.md` already measured, added the `tagger_version`
split requirement to Q2, and added the "what this plan must not re-derive or re-litigate" section
below so the audit builds on existing findings instead of quietly reproducing (or contradicting)
them.

## Why this is a plan, not a spec

Every field-taxonomy fix this session (glasses, pearl/crystal/enamel, tweed, the hem/tuck
decoupling) was reactive — found by hand, one live tagging call or one manual review at a time.
That's an expensive way to find gaps and it doesn't scale: dozens of fields, one photo's worth of
signal per finding. This plan is about building a few read-only measurement scripts (the existing
convention — see `scratch/measure_*.js`, `scratch/audit_*.js`, `scratch/research_tagger_prompt.js`)
that turn "does the tagger have problems" into a number, the same way
`docs/engine-behaviour-map.md` and `docs/tagger-cost-spec.md` already did for gate-field coverage
and token cost. **No implementation work is proposed here** — this is the list of questions and how
to answer each one cheaply, for the owner to prioritize before any fix gets scoped.

## What this plan must not re-derive or re-litigate

`docs/engine-behaviour-map.md`'s tagger section (*The tagger prompt* onward) already answered
several of these questions once, against real data. Re-measuring them from scratch without citing
what's already known risks either wasted work or — worse — quietly re-deriving a wrong answer the
map already corrected (see Q2 below). Read that section before running anything here.

It also lists **prior rulings a tagger spec must respect**, which this plan inherits rather than
reopens:

- **[OPEN, not ratified]** Worn-photo scope — should worn-photo analysis be scoped to fit/drape/
  wear behavior only, or can it revise broader identity/style fields? The engine's photo-authority
  map already leans toward the narrow reading but the product decision was never made. This is a
  legitimate open question for this plan (see Q1) — it is *not* settled ground.
- Optimising the tagger is already owner-sanctioned as the priority lever, ahead of video-import
  work.
- "AI retagging reports what changed, stays reviewable, cannot race Save" — a ratified UI
  principle any apply-step design here must honor, not re-propose.
- Nothing is retagged automatically — capture-then-apply only, by design.
- `occasions.js` is frozen; a tagger spec may change what the tagger *emits* for occasions, never
  what the occasion profiles themselves mean.
- Piece 353 (cargo pants, mis-tagged `length_hits_at: mid-thigh`) is a known regression case —
  useful as a fixed sample in any eval harness this plan's findings lead to.

**What is deliberately out of scope, even though it's adjacent.** The register-ceiling ratification
(`casual -> everyday`, ratified 2026-07-05) reads the tagger's `formality` output and is affected by
how well that field is tagged — but the ceiling itself is a taste/policy call the map explicitly
says not to reopen on data grounds. The wardrobe and the tagger prompt have both changed
substantially since that ratification date, so it may be worth an owner conversation on its own —
but that conversation is about occasion-profile policy, not tagger quality, and bundling it here
would misrepresent a taste call as something these measurement scripts can settle. Flagged, not
included.

---

## The seven questions

### 1. Is the schema asking for things a single photo can actually answer?

`tagPieceWithProvider` asks for ~35 structured fields plus a `style_profile_json` with 6 more
sub-objects, from **one hanger photo** in the common case (worn photo is optional, and per this
session, was silently not even reaching the model until just now). Several fields are structurally
unknowable without a worn photo — `fit_on_body`, `tuck_behavior`, drape-dependent parts of
`real_wear_notes` — and the tagger already knows this (this session's live test: `fit_on_body`/
`fiber_content` came back `low` confidence, with an explicit note: *"no worn photo is available"*).

**Measure:** for a sample of real tag responses (or a fresh batch run against the real wardrobe),
group fields by confidence *conditioned on whether a worn photo was provided*. If a field is reliably
low-confidence on hanger-only calls regardless of garment, that's a candidate to either drop from
the hanger-only schema (ask it only when a worn photo exists) or mark `needs_worn_photo` in the
schema comment so the UI can say so before the call, not after.

**Script:** new — `scratch/measure_confidence_by_photo_set.js`. Needs a corpus of real responses,
not just current DB state (confidence isn't persisted per-photo-set once merged). Depends on
question 6 below for where that corpus comes from.

### 2. Is confidence actually calibrated, or reflexively "high"?

In this session's one sample response, ~26 of ~32 `_confidence` entries were `"high"`, including
`shoe_type`/`toe_shape`/`heel_height`/`walk_support` — all `null` on a top, so "high confidence"
on a null is a non-signal, not a real one. If confidence collapses to "high" by default and only
drops on the ~5 fields the prompt explicitly tells it to hedge on, then confidence isn't measuring
uncertainty — it's echoing the prompt's own instructions back.

**Measure:** distribution of confidence values per field, across a real sample (not one piece).
Cross-check: does a field's confidence ever vary within the same field across different pieces, or
is it constant regardless of how ambiguous the photo actually was? A field that's always `"high"`
across every sampled piece, independent of photo quality, is not carrying information.

**Must split by `tagger_version` before drawing any conclusion.** `docs/engine-behaviour-map.md`'s
2026-08-08 amendment already found that pre-v2 `low` values are not real ratings — they're
`normalizeConfidenceMap`'s fallback for a missing/absent field, proven by pre-v2 pieces showing
**zero** `medium` values on any structural field across hundreds of pieces (a genuine rating process
doesn't do that). Measuring calibration on the whole wardrobe undifferentiated would re-collapse
that distinction and re-derive the wrong reading the map already retracted. Compare confidence
distributions for `v2.0.0-photo-property-authority`-and-later pieces only, or report unversioned/v1
separately and flag them as provenance-unknown rather than as tagger hedging.

**Script:** new — `scratch/measure_confidence_calibration.js`, reading `style_profile_json._confidence`
across all currently-tagged pieces, grouped by `tagger_version` (this part *is* measurable from
current DB state, unlike Q1 — no fresh calls needed for a first pass).

### 3. Internal consistency — does free text contradict the structured fields next to it?

The bug that started this: `garment_intelligence.failure_risks` referenced a tuck scenario the
piece's own `tuck_behavior`/`length_hits_at` already ruled out. `style_profile_json` has five other
free-text surfaces with the same exposure: `pairing_requirements`, `real_wear_notes` (5 sub-fields),
`do_not_pair_rules`, `style_notes.risk`, `formula_compatibility`. Nothing validates that any of them
agree with the structured fields sitting in the same JSON response.

**Measure:** grep a sample of real responses for tuck/hem/fit/drape keywords inside the free-text
fields, cross-reference against the structured `tuck_behavior`/`hem_finish`/`fit_on_body`/
`length_hits_at` on the same piece, flag contradictions by hand for the first pass (a fully
automated contradiction-detector is a stretch goal, not step one).

**Script:** new — `scratch/audit_freetext_structured_consistency.js`. This is the one direct
descendant of the actual bug found this session — highest-priority of the six to build first.

### 4. Field bloat — is everything asked for actually consumed downstream?

`docs/engine-behaviour-map.md` already found real instances of this for `fiber_content` (a real gap
that's "latent, not live" for hot-weather/wet-exposure clauses on ~35/236 pieces) and
`scratch/research_tagger_prompt.js` already computes "instructed field vs. persisted column" and
dead-instruction detection at the *schema* level. What's missing is the next hop: instructed →
persisted → **actually read by a consumer function**. A field can be perfectly tagged and still be
dead weight if nothing downstream ever reads it.

**Measure:** extend `research_tagger_prompt.js`'s column list with a grep-based consumer count per
field (`grep -rn "\.field_name\b"` across `styling-engine/`, count call sites, exclude the tagger/
CRUD/UI plumbing itself). Fields with populated data and zero real consumers are the next class of
gap to look for, same shape as the `fiber_content` finding but systematic instead of one-at-a-time.

**Script:** extend the existing `scratch/research_tagger_prompt.js` rather than write a new one —
it already has the instructed/persisted halves of this; it's missing the "consumed" half.

### 5. Cost — the anchor block, and the three bigger levers already measured

Every tag call includes low-detail reference thumbnails from the existing wardrobe (`buildAnchorBlock`)
for `formality`/`fabric_weight` calibration. `docs/tagger-cost-spec.md` already measured full-call
token cost ($0.067/garment, output-dominated) but didn't isolate what the anchor block specifically
costs versus what it buys in calibration consistency. **The anchor block is the smallest of four
cost levers `engine-behaviour-map.md`'s *Tagging cost* section already measured** — reframing this
question around all four rather than anchors alone, since the owner reframed tagging cost as an
**adoption barrier** (per-signup onboarding cost, not a personal budget line), and the anchor slice
is a rounding error against the other three:

| lever | measured savings | status |
|---|---|---|
| model tier (haiku vs. the full stylist model) | **67%** | needs an eval harness to judge quality risk — the real question |
| prompt caching | **31%**, quality-neutral | currently impossible — the photo is placed before the prompt/anchors in the content array, breaking cache-prefix contiguity |
| output schema trimming | attacks the 56%-of-bill output half | `cross_photo_agreement_note` is demanded, paid for, then deleted on arrival in `applyTaggerResult` — an audit of which schema fields are actually consumed is Q4's job, applied here |
| latency (batching) | wall-clock, not dollars | 200 serial calls per 200-garment onboarding; importer already batches every other stage |
| anchor block (original Q5) | smallest of the four | still worth a number, not worth top billing |

**Also directly relevant to "is the tagger the best it can be":** `buildAnchorBlock` only buckets
pieces already in `manual_overrides`, so **a brand-new wardrobe with zero corrections gets zero
anchors** — the calibration mechanism that makes the tagger good is unavailable to exactly the
population (new signups) whose first impression decides adoption. Rich-get-richer by construction.
Any cold-start quality work has to come from the static prompt, since the dynamic half doesn't
exist for that population. Worth stating explicitly as a finding even though no new script is
needed to see it (`buildAnchorBlock`'s bucket-skip logic is read directly).

**Measure:** token cost of the anchor block in isolation (`buildAnchorBlock`'s output size is
already computable without a model call) versus a before/after comparison of `formality`/
`fabric_weight` cross-piece consistency with anchors on vs. off. Prompt-caching and output-schema
savings are also free to measure (byte-count and schema-trace, no model call). Model-tier savings
are free to *estimate* from token counts; **validating haiku's tagging quality is the one sub-item
that needs billed calls** (an A/B on real photos) — flag that specific piece, and gate it explicitly
per the "never make a billed call without explicit approval" rule already in `tagger-cost-spec.md`.

**Script:** mostly free (anchor-block token size, prompt-caching prefix analysis, output-schema
consumption trace via Q4's tooling); one billed sub-item (haiku quality A/B). No longer the lowest
priority of the set — the three non-anchor levers are the larger dollar/latency findings, even
though validating them stays gated on approval same as before.

### 7. Schema drift between the two tagger prompts

`tagPiecePromptTemplate` (`styling-engine/prompts.js`) is not the only tagger schema in the
codebase. `routes/ai.js`'s `/extract-pieces` endpoint (the "scan a whole outfit photo" flow) hand-
maintains its own copy instead of importing the real one, and per `docs/garment-field-reference.md`
it is currently missing six fields the real tagger has — `bottom_subtype`, `accessory_subtype`,
`jewelry_type`, `necklace_length`, `tuck_behavior`, `waistband_type` — one of which (`tuck_behavior`)
is the exact field this plan's own trigger bug traces back to. `docs/engine-behaviour-map.md`
independently found the consequence downstream: `extract-pieces` output emits no `_confidence` map
at all, so `getFieldConfidence` defaults it to `medium` — meaning pieces created through this path
are **trusted more than the real tagger's own output**, despite being derived from strictly less
evidence (no calibration anchors, no photo-authority map, no `style_profile_json`).

This is not a hypothetical drift risk — it's a live, current gap between two schemas that are
supposed to describe the same garments, and "is the tagger the best it can be" has to include
"which tagger," since a piece can enter the wardrobe through either path.

**Measure:** diff the two schemas field-by-field (both are static source, no model call) and
classify each gap as: never-synced-but-harmless (field genuinely doesn't apply to the
extract-pieces use case), synced-but-should-be-checked, or live-risk (drifted since last sync,
like the six above). Cross-reference against `attributes.js`'s `CONFIDENCE_FIELDS` to confirm the
`medium`-default consequence for each gap.

**Script:** new — `scratch/audit_tagger_schema_drift.js`. Free, no model call, no corpus needed —
purely a source-code diff plus one config cross-reference. Cheap enough to run alongside Q3/Q6 in
the first pass rather than waiting for its own slot.

### 6. Ground truth — how would we know if a field is *wrong*, not just self-consistent?

Every question above measures internal properties of the tagger's own output — coverage, confidence
distribution, self-consistency, consumption. None of them can catch the case where the tagger is
confidently, consistently, and completely *wrong* about what's actually in the photo. Today the only
correction signal is a human editing a field by hand, which becomes a `manual_overrides` entry —
there's no systematic accuracy check against known-correct pieces.

**Measure:** this is the hard one and the one this plan explicitly does **not** solve. The nearest
thing to a data source is `manual_overrides` itself — how often does a human correct a given field
after tagging, across the real wardrobe? A field that gets overridden constantly is either poorly
tagged or poorly specified (ambiguous schema instructions) — either way, worth knowing. This reuses
existing data (no new calls, no new corpus) and is a reasonable proxy for real-world accuracy even
though it's not a controlled ground-truth check.

**Script:** new — `scratch/measure_manual_override_frequency.js`, reading `manual_overrides` across
all real pieces, grouped by field. Cheapest of the six to build (existing DB column, no photo
handling, no live tagging needed) — candidate for first pass alongside Q3.

---

## Suggested order

1. **Q3** (free-text consistency), **Q6** (override frequency), and **Q7** (schema drift) first —
   all three are pure source/DB/text analysis on data that already exists, zero new tagging calls,
   and Q3 is the direct descendant of a bug already found this session.
2. **Q2** (confidence calibration, split by `tagger_version`) next — also DB-only, no new calls.
3. **Q4** (consumption gap) — extends existing tooling (`research_tagger_prompt.js`), moderate
   effort. Its output also feeds the output-schema-trimming sub-item of Q5.
4. **Q1** (schema-fit-to-photo-availability) — needs a corpus of *fresh* tag responses with known
   photo sets, so it's gated on having Q2/Q3's tooling ready to point at that corpus once collected.
5. **Q5** (cost — anchors, caching, output schema, latency, model tier) mostly last, but split it:
   the caching/output-schema/anchor-token measurements are free and can run anytime after Q4; only
   the model-tier quality validation (a haiku A/B) needs a billed call, and that's the piece to gate
   on explicit go-ahead, not the whole question.

Only the model-tier A/B inside Q5 needs a billed model call. Everything else in Q1-Q4, Q6, and Q7
is free, and should wait on nothing but the owner's prioritization.
