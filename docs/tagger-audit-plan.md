# Plan: auditing the tagger

**Status:** draft, 2026-08-15. Not started. Written after a live tagging test this session
surfaced two real, distinct problems in one response: a worn photo silently not reaching the
model (fixed, PR #227), and a free-text field (`failure_risks`) contradicting the piece's own
structured fields (`"ribbed hem may bunch if tucked"` on a piece the tagger itself marked
`tuck_behavior: wear_over_only`, `length_hits_at: tunic` — tucking was never a live possibility).
That second one is not a one-off typo to patch; it's a symptom of never having asked whether the
tagger's output is *coherent*, only whether the schema is *populated*. This plan is the "ask before
building" list from that conversation, turned into something runnable.

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

---

## The six questions

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

**Script:** new — `scratch/measure_confidence_calibration.js`, reading `style_profile_json._confidence`
across all currently-tagged pieces (this part *is* measurable from current DB state, unlike Q1 — no
fresh calls needed for a first pass).

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

### 5. Cost vs. value of the anchor block

Every tag call includes low-detail reference thumbnails from the existing wardrobe (`buildAnchorBlock`)
for `formality`/`fabric_weight` calibration. `docs/tagger-cost-spec.md` already measured full-call
token cost ($0.067/garment, output-dominated) but didn't isolate what the anchor block specifically
costs versus what it buys in calibration consistency.

**Measure:** token cost of the anchor block in isolation (`buildAnchorBlock`'s output size is
already computable without a model call) versus a before/after comparison of `formality`/
`fabric_weight` cross-piece consistency with anchors on vs. off. This one **does** need billed calls
to fully answer (an A/B on real photos) — flag it as the one question in this plan that isn't free,
and gate it explicitly per the "never make a billed call without explicit approval" rule already in
`tagger-cost-spec.md`.

**Script:** partially free (anchor-block token size), partially billed (the A/B). Lowest priority of
the six — nice to know, not blocking anything.

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

1. **Q3** (free-text consistency) and **Q6** (override frequency) first — both are pure DB/text
   analysis on data that already exists, zero new tagging calls, and Q3 is the direct descendant of
   a bug already found this session.
2. **Q2** (confidence calibration) next — also DB-only, no new calls.
3. **Q4** (consumption gap) — extends existing tooling (`research_tagger_prompt.js`), moderate effort.
4. **Q1** (schema-fit-to-photo-availability) — needs a corpus of *fresh* tag responses with known
   photo sets, so it's gated on having Q2/Q3's tooling ready to point at that corpus once collected.
5. **Q5** (anchor block cost/value) last — the only one requiring new billed calls; do it once the
   others have shown whether there's still an open question worth spending on.

None of Q1-Q4 or Q6 need a billed model call. Q5 does, and should wait for explicit go-ahead per
`tagger-cost-spec.md`'s existing rule.
