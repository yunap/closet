# Tagger audit findings

**Status:** first pass complete, 2026-08-15; amended 2026-08-16 with real Q1 evidence (n=9, growing),
a first real latency measurement, and ten follow-on fixes/confirmations found live while gathering
it. Executes `docs/tagger-audit-plan.md`'s Q2–Q7
(all free questions); Q1 is answered by an incrementally-growing real corpus rather than a one-shot
synthetic batch — the owner tags each garment hanger-only, captures the result, adds a worn photo,
re-tags, and that pair becomes a real data point, for no incremental cost beyond garments they were
tagging anyway. This is the same controlled design originally proposed for a separate billed batch,
not a substitute for it — the "ask before spending" gate applied to *me* running an extra batch of
calls the owner didn't otherwise need; it never applied to the owner's own ordinary tagging. See Q1
below for the corpus as it stands. Wardrobe was 245 active pieces at measurement time — up from the
236/242 baselines cited in `docs/engine-behaviour-map.md`, so several numbers below have moved since
that map was
written. Re-run the cited script rather than trusting a number here indefinitely; that map's own
convention.

Same tag vocabulary as the other maps: **[by design]**, **[bug]**, **[unverified]**,
**[owner check wanted]**. Every finding cites the script that produced it — all are new, committed
under `scratch/`, read-only, no model call except where explicitly marked otherwise.

**Answering the framing question up front:** no, not yet — but this pass turned a vague "the tagger
has problems" into a ranked, mostly-free worklist. See *Synthesis* at the bottom.

---

## Q7 — Schema drift between the two tagger prompts

**Script:** `scratch/audit_tagger_schema_drift.js`

`tagPiecePromptTemplate` (`styling-engine/prompts.js`) asks for **67** top-level/nested fields.
`/extract-pieces`'s hand-maintained duplicate (`routes/ai.js`) asks for **29** (30 minus the
`pieces` array wrapper). Beyond the four whole-subsystem omissions already known
(`_confidence`, `photo_properties`, `style_profile_json`, `cross_photo_agreement_note`), seven
independent top-level fields are simply never asked:

| field | confidence-whitelisted? | consequence |
|---|---|---|
| `accessory_subtype` | yes | defaults to **medium** — no review flag ever surfaces the gap |
| `bottom_subtype` | yes | same |
| `jewelry_type` | yes | same |
| `necklace_length` | yes | same |
| `tuck_behavior` | yes, and in `STRUCTURE_FIT_CONFIDENCE_FIELDS` | correctly flagged **low** on a provisional clothing piece |
| `waistband_type` | yes, and in `STRUCTURE_FIT_CONFIDENCE_FIELDS` | correctly flagged **low** on a provisional clothing piece |
| **`fit_on_body`** | yes, and in `STRUCTURE_FIT_CONFIDENCE_FIELDS` | correctly flagged **low** on a provisional clothing piece — **new finding, not in `garment-field-reference.md`'s six-field drift list** |

**[bug]** Four of the seven (`accessory_subtype`, `bottom_subtype`, `jewelry_type`,
`necklace_length`) are outside `STRUCTURE_FIT_CONFIDENCE_FIELDS`, so a piece created via
`/extract-pieces` gets **medium confidence and no review badge** on a field that was never even
asked for — worse than the already-known "extract-pieces trusts everything at medium" finding,
because these four fields aren't merely under-evidenced, they're *absent by construction* with
nothing telling the owner to check them. `fit_on_body`/`tuck_behavior`/`waistband_type` at least
get the low-confidence flag correctly, since they sit in the whitelist that also gates on
`tag_state`.

Reverse direction: `/extract-pieces` asks for nothing tag-piece doesn't already ask for (only
`pieces`, the array wrapper). Not a two-way drift — extract-pieces is a strict, incompletely-synced
subset.

**[fixed 2026-08-15]** All seven fields added to `/extract-pieces`'s schema
(`routes/ai.js`), verified against the audit script: the gap list is now empty except for the
already-known whole-subsystem omissions. Chose **patch, not unification** — the two schemas stay
independent literals, which is the smaller, faster fix; the drift-proofing move (importing a
shared field list so this can't recur) was discussed and deliberately deferred, see below.
`fit_on_body`/`tuck_behavior`/`waistband_type`'s instruction text was written specifically for this
endpoint rather than copied verbatim from `tag-piece`: `/extract-pieces` always receives a *worn*
outfit photo, which is exactly the evidence `tag-piece`'s own photo-authority map says those three
fields need and often lack — so the wording says so explicitly ("This photo IS a worn photo —
judge fit and drape directly...") rather than hedging the way `tag-piece`'s conditional worn-photo
wording does.

**[bug, found while verifying the fix would actually reach the wardrobe, fixed 2026-08-15]**
`/extract-pieces` has exactly one live UI caller — `OutfitLookbook.jsx`'s `OutfitForm` "scan for
pieces in this photo" feature (confirmed by grep; **not** used anywhere in the onboarding
batch-add or bulk-import paths, which both call the real tagger directly). That caller has its
**own** hardcoded field-forwarding list in `handleSubmit`, separate from the schema, and it was
already silently dropping `opacity`, `stretch`, `needs_base`, `fiber_content`, `formality`,
`heel_height`, `walk_support` — fields the schema already asked for, paid for, and computed —
before this session touched anything. Without fixing this too, the schema fix above would have
been real but inert: the model would emit the 7 new fields and the frontend would discard them
before the piece was ever created, same as it already did to the 7 pre-existing ones. Fixed by
adding all 14 field names to the forwarding list, plus a `fiber_content`-specific
`JSON.stringify` line (it's an array field, needs the same treatment as `colors`/`occasions`
already get). This is the third occurrence of the documented "enumerate and silently drop unknown
fields" pattern (`PieceForm`/`BatchAdd` are the other two) — worth remembering as a class, not
just this one instance, next time a field is added anywhere in the tagger schema.

**Verified:** `scratch/audit_tagger_schema_drift.js` re-run clean; a static JSON-parse check on the
edited schema block; `npx vite build` succeeds; full test suite compared — same 10 pre-existing
baseline failures before and after (verified via `git stash`), nothing new.

**Deliberately not done this session — put on the TODO list per owner decision:** whether
`OutfitForm`'s scan feature should still exist in its current form. Its only consumer creates a new
wardrobe piece whenever match confidence isn't `high`, which is the duplicate-creation behavior the
owner already stepped away from once. The schema-drift fix makes the endpoint's *output* more
complete; it does not address whether the feature's *auto-create* behavior is still the right
design. Research this before touching that flow again — do not assume the schema fix implicitly
endorses continuing to use it as-is.

---

## Q6 — Manual override frequency, all fields (ground-truth proxy)

**Script:** `scratch/measure_manual_override_frequency.js`

244/245 pieces (**99.6%**) carry at least one manual override — nearly universal, up from 228/236
(96.6%) at the map's last measurement. 40 distinct fields have ever been hand-corrected. Top five:
`formality` 201 (82%), `fiber_content` 110 (45%), `fit_confidence` 90 (37%), `occasions` 88 (36%),
`length_hits_at` 81 (33%).

**[unverified, worth flagging]** `fiber_content`'s correction count nearly tripled since the map's
last measurement (37/236 → 110/245). That's too large a jump to be organic drift from 9 new pieces
— worth checking whether a bulk correction pass happened, since it changes the Q5 anchor-cost
calculus below the same way `occasions` did.

Only **one** confidence-eligible field has never been manually corrected: `bottom_subtype` — the
newest field (shipped 2026-08-14), so zero corrections is not itself alarming yet. This replaces
the map's older finding that `heel_height`/`recommendation_status`/`role_permission` were the
uncorrected trio: `heel_height` now has 3 corrections and `recommendation_status` has 3 — the
wardrobe has moved. `role_permission` still shows zero.

---

## Q3 — Free-text vs. structured field consistency

**Script:** `scratch/audit_freetext_structured_consistency.js`

Two genuinely new contradictions found, on different pieces than the original bug — the method
generalizes:

- **Piece 996763 "pink raincoat"**: `length_hits_at: knee`, but its own `real_wear_notes` says
  *"full-length coat; covers full silhouette."* Clean, direct contradiction between a structured
  field and the free text sitting next to it in the same response.
- **Piece 996760 "cream and taupe plaid fleece coat"**: `length_hits_at: mid_thigh`, but its own
  free text says (twice) *"length estimated as midi from visible drape proportion."* The piece
  contradicts itself across two of its own sentences, not just against the structured field.

The tuck-behavior check (the original bug's own shape) found one candidate, and on inspection it's
a **valid** sentence, not a repeat of the bug — a `wear_over_only` piece whose free text correctly
says tucking isn't advisable.

**[unverified, schema-design finding]** The fit/drape check had a very high false-positive rate
(44 candidates, nearly all describing what a *partner* piece should be — *"needs a structured
top"* — not this piece's own `fit_on_body`) even after restricting to the free-text fields meant to
describe the piece itself (`failure_risks`, `real_wear_notes`, `style_notes.risk`/`best_use`).
That's not a script bug — it's `style_notes.risk`/`best_use` routinely blending self-description
and pairing-advice in the same sentence, which the schema doesn't structurally separate. That
conflation is *why* an automated contradiction detector is a stretch goal per the plan, not a first
step: the free text doesn't cleanly say what it's describing.

**[fixed 2026-08-15]** Traced to the actual root cause: **the schema instructed the mixing.**
`style_notes.risk`'s own worked example in `prompts.js` was *"can look shapeless if not paired
with fitted bottom"* — a pairing-conditional sentence, in the field explicitly meant to describe
the piece alone. Checked all six `garment_intelligence` free-text fields against what they're
supposed to describe: four are clean (`failure_risks`, `real_wear_notes` self-describe;
`pairing_requirements`, `do_not_pair_rules`, `formula_compatibility` are partner-facing by name and
content). Only `style_notes.risk` actively instructed the conflation its own example demonstrated;
`style_notes.best_use` is a softer, inherent case (a "styling role" is relational by definition —
not fixed, out of scope for this pass).

Rewrote `style_notes.risk`'s instruction to be strictly intrinsic (true of the garment worn alone
— *"shows every crease after sitting"*, *"reads busy up close despite reading solid from a
distance"*), explicitly prohibited pairing-conditional phrasing, and redirected displaced
pairing-conditional statements to the two existing fields whose phrasing already fits them
(`pairing_requirements` for "needs X", `do_not_pair_rules` for "avoid Y") — no new field, no schema
shape change, matching the smallest-change option discussed. Regenerated the frozen prompt
snapshot (`scratch/regen_prompt_snapshot.mjs`), diffed to confirm only `TAG_PIECE_PROMPT` moved,
and confirmed the old pairing-conditional example string is gone from the new prompt. Full test
suite compared before/after: same 10 pre-existing baseline failures either way.

**Not done:** `style_notes.best_use`'s softer conflation, and re-running Q3's audit script against
freshly-tagged pieces to confirm the fix actually changes tagger *output* (today's wardrobe was
tagged under the old instruction, so this fix only affects pieces tagged or re-tagged from now on
— it cannot retroactively clean existing free text, same non-retroactivity as every other prompt
change in this document).

---

## Q2 — Confidence calibration, split by `tagger_version`

**Script:** `scratch/measure_confidence_calibration.js`

Confirms the map's 2026-08-08 amendment cleanly on the current wardrobe: unversioned and `v1.0.0`
pieces show **zero** `medium` confidence values on every structural field sampled (`length_hits_at`,
`silhouette`, `fit_on_body`, `hem_finish`, `tuck_behavior`, `fabric_category`, `colors`,
`pattern_type`, `reads_as`, `category`) — a rating process doesn't do that; this is the
normalization-default artifact, not tagger hedging, exactly as the amendment found.

**[by design, encouraging]** Where the v2 prompt actually ran, confidence genuinely discriminates,
and does so *sensibly*: visually-obvious fields (`pattern_type` 51/73 high, `reads_as` 45/73 high,
`category` 49/73 high) skew high, while hard structural/fit fields
(`tuck_behavior`, `fit_on_body`, `hem_finish`) stay spread across low/medium/high. This is the
opposite of the original session's worry ("~26 of ~32 entries were reflexively high") — that worry
holds for null fields on the wrong category, not for v2's real judgment calls.

**[owner check wanted]** `formality` confidence reads `manual` on essentially every piece regardless
of `tagger_version` — including unversioned ones. This isn't a contradiction of the amendment; it
clarifies that `pinManualConfidence` fires at *edit* time, independent of when the piece was last
tagged, so a pre-v2 piece hand-corrected on formality after the fact still reads `manual` correctly.

**[fixed 2026-08-15, was: bug, small]** Piece 990359 had `stretch` in `manual_overrides` but its
confidence read `undefined`, not `manual`. Traced and confirmed **not a code bug** —
`pinManualConfidence` itself pins correctly today (verified directly:
`pinManualConfidence({}, ['stretch'])` → `{_confidence: {stretch: 'manual'}}`). The gap was pure
historical residue: `stretch` joined `CONFIDENCE_FIELDS` only on 2026-08-14, and this piece's
override was written before that and never re-saved since, so it never got backfilled. Fixed by
`scratch/backfill_pinned_confidence.js` (preview-by-default, `--apply` to write, same convention as
`scratch/clean_impossible_length_reports.js`), generalized across the whole wardrobe rather than
hand-fixed on one piece — found exactly the one piece the audit already knew about, applied, and
re-verified at 0 mismatches with `scratch/measure_confidence_calibration.js`'s own sanity check.

---

## Q4 — Field consumption: instructed → persisted → actually consumed

**Script:** extended `scratch/research_tagger_prompt.js` (new §6)

The new consumer-count sweep (grep-based, styling-engine/ only, excludes tagger/prompt plumbing)
found:

| field | consumer files |
|---|---|
| `sleeve_type` | **0** |
| `stretch` | 1 |
| `walk_support` | 2 |
| `neckline` / `background_color` / `fiber_content` / `heel_height` / `opacity` | 3 each |

**[by design, false alarm explained]** `sleeve_type`'s zero is not a live gap — it's the pre-split
column (`sleeve_length`/`sleeve_shape` replaced it 2026-08-14) correctly retired but still present
for backward-compatible schema reads, per `garment-field-reference.md`. Checked directly:
`sleeve_length` has 5 consumer files, `sleeve_shape` has 4 — the *replacement* fields are read
fine. The old column is genuinely dead, as documented, not newly discovered.

**[meta-finding]** `research_tagger_prompt.js`'s own hardcoded `TAGGABLE` field list still lists
`sleeve_type` instead of the split fields — the exact same "two things describing the same schema,
one goes stale" problem Q7 found in the tagger prompts themselves, now found in the audit tooling
built to check them. Not fixed here (out of scope for a measurement script edit), flagged for
whoever next touches that file.

**[correction, 2026-08-15]** This section originally claimed `stretch` was *"populated on 236/245
pieces"* — wrong, and caught only while tracing the field further (below). The real number is
**57/244 (23%)**; the 236 figure was misattributed from an unrelated wardrobe-size baseline
elsewhere in this document. Corrected here rather than silently edited, since the wrong number was
live in this doc for part of this session.

**Traced 2026-08-15, script: `scratch/trace_stretch_consumption.js`.** `stretch`'s one consumer,
`refinedFabric()` in `styling-engine/softScoreFloors.js:76`, only reads it inside a narrow branch:
`fabric_category === 'synthetic'` AND `fabric_weight` is `ultralight`/`light` AND `fit_on_body` is
`drapes` or unset. Every other fabric category short-circuits to a verdict before `stretch` is ever
consulted. On the real wardrobe:

- Only **8/244 pieces (3%)** ever reach the branch where `stretch` is read at all.
- Of those 8, **zero** have `stretch` actually block the outcome (none are `moderate`/`stretchy` —
  every piece that reaches the check also happens to pass it).

**Verdict: fully non-discriminating today, not a latent gap.** This puts `stretch` in the same
category `engine-behaviour-map.md` documented for `heel_height`/`role_permission` before they were
ever corrected — a correctly-wired mechanism with zero pieces currently able to exercise it —
**not** the same category as `fiber_content`'s live wet-exposure miss, which affected two real,
identifiable garments. Spending tagger-prompt tokens improving `stretch` tagging quality would not
change any current outcome; the gate it feeds is too narrow for this wardrobe's composition to
ever fire it, regardless of tagging accuracy.

**One design risk found in passing, not confirmed live:** unset `stretch` is treated identically to
`stretch: "none"` in the pass-list (`['none', 'minimal', ''].includes(...)`), rather than being
excluded conservatively the way `needs_base`'s own instruction explicitly requires ("conservative
default: null, not 'no'"). 5 of the 8 reachable pieces have no `stretch` value at all and pass
anyway. No known case today produces a wrong answer from this — there's no ground truth showing any
of those 5 are actually stretchy — but it's backwards from the schema's own stated convention for
handling absence, and worth fixing if this gate is ever widened to matter more.

Truncation check: **zero** missing `style_lanes`/`garment_intelligence`/`_confidence`/
`photo_properties` across all 73 v2-tagged pieces — no truncation evidence at the current output
cap.

---

## Q5 (free parts) — Cost levers beyond the anchor block

**Script:** `scratch/measure_tagger_cost_levers.js`, plus the `cross_photo_agreement_note` grep
already run for Q7's classification logic.

**Anchor block, re-measured on the live wardrobe:**

| anchor fields | anchors | tokens |
|---|---|---|
| `formality` + `fabric_weight` (current) | 19 | ≈557 |
| + `occasions` | **76** | **≈2,294** |

**[owner check wanted, numbers moved]** The map's original estimate for adding `occasions` was
+31 anchors / a modest token cost, framed as "worth measuring, not an obvious win." Since then
`occasions` corrections nearly doubled (38→88, per Q6), so the real cost of that change is now
**+1,738 tokens per tag call** for +57 anchors — over 3x the size of the current anchor block on
its own, added to a call whose input is already under-quoted by 1.6x. This tips the calculus:
what was "worth an A/B" now reads as "probably not worth it without a stronger case," pending an
actual quality comparison, not a recommendation to do it.

**[fixed 2026-08-15, was: bug — owner-discussed same day] The anchor block had no total-size
ceiling, only a per-bucket one.** `buildAnchorBlock`
(`styling-engine/taggerMerge.js:158`) caps items *within* a bucket at `perValue = 3`, but never caps
the *number of buckets*. That's invisible for the two fields anchored today because both are scalar
enums with a small, fixed number of possible values — `formality` can never exceed 4 buckets × 3 =
12 anchors, no matter how many pieces get corrected, so the per-bucket cap accidentally reads as a
global one. It isn't: `buildAnchorBlock` buckets by the *joined string* of the field's value
(`taggerMerge.js:172`), so an array field like `occasions` produces one bucket per distinct
*combination* observed, not per possible value. With no ceiling on combinations, the anchor set
grows without bound as more pieces get hand-corrected — which is exactly backwards for a mechanism
whose cost is supposed to buy calibration consistency, not scale with wardrobe curation effort.

**The fix already has a precedent two lines away in the same file.** `anchorThumbsForTagger`
already caps the *thumbnail* half of this mechanism at `limit = 8` regardless of how many anchors
exist. The *text* block was never given the equivalent treatment. Three ways to close that gap,
weighted toward the smallest change:

1. **Global anchor-count ceiling (owner's preference).** After bucketing, keep only the first N
   anchors total (e.g. sort by some deterministic order and truncate to, say, 20). Smallest change,
   same shape as the existing thumbnail cap. Still needs a rule for *which* anchors survive the cut
   when there are more buckets than room — arbitrary-selection risk, the same class of issue this
   session's audit already flagged for which 8 anchors get a thumbnail today.
2. **Cap buckets per field**, not just items per bucket (e.g. "at most 6 distinct values
   illustrated per field"). More deliberate about coverage across an array field's combinations,
   still needs a selection rule.
3. **Bucket array fields by individual tag, not joined combination**, so `[casual]` and
   `[casual, city]` both count toward one `casual` bucket. Fixes the combinatorial explosion at the
   root rather than capping around it, but changes what the anchor teaches the model — per-tag
   calibration instead of whole-combination calibration — a bigger behavioral change than a cap,
   not established here to be equivalent.

**Shipped: option 1, global anchor-count ceiling.** `buildAnchorBlock` now takes a `maxAnchors`
parameter (default `DEFAULT_MAX_ANCHORS = 24` — above today's real 19-anchor count, so current
behavior on `formality`+`fabric_weight` is byte-identical; verified). The selection-rule question
from option 1 above is resolved by sorting **buckets** (not individual anchors) by their freshest
item's recency before truncating, so a ceiling hit drops whole least-recently-corrected *values*
rather than splitting a bucket arbitrarily, and — as a side effect — the existing
`anchorThumbsForTagger` 8-thumbnail cap is no longer picking from Map-insertion-order-dependent
anchors either, since the array it draws from is now itself deterministically ordered.
Verified: a synthetic 100-bucket case correctly caps at 24 (was uncapped before); the live
wardrobe's real 19-anchor output is unchanged; the hypothetical `occasions`-added case drops from
76 anchors/≈2,294 tokens to 24/≈741. `test/gateMetadataPhase1.test.js`'s existing anchor-block
tests still pass unmodified.

**Prompt-caching, content-array order re-verified against current source (`routes/ai.js`,
`tagPieceWithProvider`):**

```
1. photo image(s)              <- per-piece, unique every call
2. anchor block + thumbnails   <- wardrobe-state-dependent, stable within a session
3. ground-truth override text  <- per-piece
4. TAG_PIECE_PROMPT (5,290 tok) <- fully static, LAST
```

**[fixed 2026-08-15, was: bug, confirmed]** No `cache_control` marker existed anywhere near the
`TAG_PIECE_PROMPT` content push — under **any** ordering, the single largest chunk of every tag call
(72% of the ~7,362-token prompt) was not eligible for caching. `PROMPT_CACHE_BREAKPOINT` was applied,
but only to `TAG_PIECE_SYSTEM` (~294 tokens, ~4% of the real cost). Fixed both pieces together in
`routes/ai.js`'s `tagPieceWithProvider`: content is now assembled `[TAG_PIECE_PROMPT] →
[anchor block + thumbnails] → cache_control marker → [photo] → [ground-truth overrides]`, with
`cache_control: {type: 'ephemeral'}` on the last block of the stable prefix (reusing
`toAnthropicContentBlocks`'s existing verbatim `cache_control` passthrough — no provider-layer
change needed). Verified end to end with a stubbed provider handler: block 0 is the full
29,447-char prompt, the marker lands exactly on the last anchor thumbnail, and the per-piece photo
follows after it. `test/gateMetadataPhase1.test.js` unaffected.

**[fixed 2026-08-15, was: bug]** `cross_photo_agreement_note` was instructed twice in the prompt
(rules 5 and 7 of the conflict-resolution section, plus the schema field itself), paid for on every
call, then unconditionally deleted at `styling-engine/taggerMerge.js:291` on arrival — nothing ever
consumed it. Decision: **drop it** rather than wire it somewhere, since no consumption path was
established anywhere in the codebase and inventing one is new feature work, not a free cleanup.
Removed the schema field and both prompt instructions from `styling-engine/prompts.js`; left
`taggerMerge.js`'s defensive `delete patch.cross_photo_agreement_note` in place (harmless no-op,
same belt-and-suspenders shape as its `_confidence`/`photo_properties` siblings, costs nothing to
keep). `/extract-pieces` never had this field, so no matching change needed there.
`test/prompt_equivalence.test.js`'s frozen-prompt snapshot (`test/fixtures/prompts_yuna_snapshot.json`)
regenerated via the existing `scratch/regen_prompt_snapshot.mjs` — diffed to confirm **only**
`TAG_PIECE_PROMPT` changed (257 fewer characters, every other of the 20 tracked prompt constants
byte-identical).

**Not run:** the haiku-vs-sonnet quality A/B — stays gated on explicit approval, unchanged from the
plan.

---

## Q1 — Schema fit to photo availability (answered by a growing real corpus, n=9 so far)

**Script:** `scratch/measure_confidence_by_photo_set.js`

A free natural-experiment substitute was attempted, using the 73 v2-tagged pieces' already-recorded
`photo_properties` (did the actual tag call include a `fit_visible` photo) instead of a fresh
corpus. Result: **confounded, inconclusive.**

The "no fit-visible photo" group (17 pieces) is dominated by accessories and shoes (8 accessory, 2
shoes, 6 outerwear, 1 top) — categories that are also just easier to tag confidently on
`pattern_type`/`colors` regardless of worn-photo availability. This fully explains why even the
**control** fields (`pattern_type`, `colors` — fields the prompt claims are answerable from any
photo) showed a large, spurious gap (0% low-confidence without a worn photo vs. ~30% with one) —
category composition, not photo availability, is driving that number.

The fit-dependent fields showed a mixed, small-sample signal: `length_hits_at` and `silhouette`
moved in the expected direction (worse without a fit-visible photo — 59% vs. 29%/34% low
confidence), but `fit_on_body`/`tuck_behavior`/`waistband_type` did not show a clean pattern at
n=17. **Not strong enough to act on.**

**A separate synthetic batch to run this controlled comparison was proposed and deliberately not
run this session** — that gate was about *me* spending on calls the owner didn't otherwise need,
and holds for that specific ask. It does not gate the owner's own ordinary tagging, which turns out
to produce the exact same comparison for free.

**[2026-08-16, the actual corpus — n=9 so far, growing]** Nine real garments the owner needed to
tag anyway went through the same controlled comparison via the ordinary "Update details with AI"
flow: hanger-only first, result captured, worn photo added, re-tagged. Every additional garment
tagged this way adds another real data point to this same set — this section grows as that happens,
not as a one-time report.

**Piece 135 ("black grey textured cropped cardigan"): the worn photo changed the answer, not just
the confidence.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `clings_drapey` (low) | `skims` (**high**) |
| `length_hits_at` | `cropped` (medium) | `waist` (**high**) |
| `silhouette` | `relaxed` (medium) | `fitted` (**high**) |

All three structural fields didn't just gain confidence — they changed **value**. The hanger-only
read was substantively wrong on all three, not merely under-evidenced: a garment described as
cropped, relaxed, and clingy-draping turned out to be waist-length, fitted, and skimming once the
worn photo was available. Real confirmation that a hanger-only tag can produce a confidently-
wrong-looking answer that is actually incorrect on structure.

**Piece 141 ("sheer black open cardigan"): a confirmation case.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `drapes` (low) | `drapes` (**high**) |

Same value both times — the hanger-only guess happened to be right, and the worn photo raised
confidence from a hedge to a real answer without changing it. `length_hits_at`, `silhouette`, and
`tuck_behavior` were already stable and high-confidence in both conditions on this piece.

**Piece 996780 ("lavender textured sheath midi dress"): a second, cleaner confirmation case.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `skims` (low) | `skims` (**high**) |
| `length_hits_at` | `midi` (medium) | `midi` (medium — unchanged) |
| `silhouette` | `sheath` (high) | `sheath` (high — unchanged) |

Same pattern as 141: only `fit_on_body` needed the worn photo, and `length_hits_at`/`silhouette`
were already confident and correct from the hanger photo alone on this piece and didn't move at
all — evidence the tagger doesn't uniformly hedge everything without a worn photo, just the fields
that genuinely need one.

**Piece 996781 ("white ruffle-front lace-sleeve blouse", top): confirmation, plus a useful
contrast field.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `hangs_straight` (low) | `hangs_straight` (**high**) |
| `silhouette` | `relaxed` (medium) | `relaxed` (**high**) |
| `tuck_behavior` | `wear_over_only` (high) | `wear_over_only` (high — unchanged) |
| `sleeve_shape` | `relaxed` (medium) | `straight` (medium) — value changed |

`tuck_behavior` was already high-confidence from the hanger photo and stayed exactly the same —
real evidence the tagger isn't reflexively hedging every fit-adjacent field without a worn photo,
only the ones it judges as actually needing one. `sleeve_shape` changing value is a new kind of
drift not seen in the first three pairs, and isn't clearly assigned either way by the
photo-authority map (sleeve *existence* is hanger-authoritative; sleeve *shape* isn't explicit).

**Piece 996782 ("black ditsy floral popover blouse", top): the cleanest confirmation yet.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `hangs_straight` (low) | `hangs_straight` (**high**) |
| `silhouette` | `relaxed` (high) | `relaxed` (high — unchanged) |
| `tuck_behavior` | `tucks_with_structure` (medium) | `tucks_with_structure` (medium — unchanged) |
| `hem_finish` | `shirttail` (high) | `shirttail` (high — unchanged) |

Only `fit_on_body` moved; everything else that was already settled — whether high or medium — held
exactly. This also corrected an over-read from the first two pairs: `hem_finish` confidence
*dropping* on a re-tag looked like it might be a systematic effect after 996780; here it didn't
happen at all, putting it at 2 of 5 pairs rather than 2 of 2 — a reminder that a pattern seen twice
in a row can still be noise, not yet a rule.

**Piece 996783 ("emerald green v-neck sleeveless tank", top): mixed — confirmation plus a second
correction.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `skims` (low) | `skims` (**high**) |
| `tuck_behavior` | `tucks_anywhere` (medium) | `tucks_anywhere` (**high**) |
| `silhouette` | `relaxed` (medium) | `straight` (**high**) — value changed |

`silhouette` changing value here, on top of piece 135's correction, means it's now been wrong in
**2 of 8 pairs** — and both times the hanger-only guess was `relaxed` and got corrected to
something more specific (`fitted`, `straight`) once the worn photo showed the real drape. Same
field failing the same way twice is more informative than the raw correction count: `relaxed`
looks like a plausible fallback guess for `silhouette` on a hanger photo when the actual cut is
hard to judge flat, corrected once real drape is visible.

**Piece 996784 ("floral botanical print active leggings", bottom — first bottom-category data):
confirmation plus a third correction, different field this time.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | `clings_stretchy` (medium) | `clings_stretchy` (**high**) |
| `length_hits_at` | `mid_calf` (medium) | `ankle` (**high**) — value changed |
| `silhouette` | `tapered` (high) | `tapered` (high — unchanged) |
| `waistband_type` | `structured_high_waist` (medium) | `structured_high_waist` (medium — unchanged) |

`length_hits_at` changing value here matches piece 135's earlier correction on the same field —
now **2 of 8 pairs** for `length_hits_at`, same as `silhouette`. Two different fields have each
independently been wrong twice across eight pairs; neither is a fluke at this point. Also the first
piece where `fit_on_body` started above `low` confidence (`medium`) — a fitted, technical-fabric
legging, plausibly easier to read from a flat photo than a drapey woven top.

**Piece 996785 ("tan corduroy skinny zip-hem pants", bottom): the strongest confirmation yet — no
guess at all, then a confident answer.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | **`null`** — no value, no confidence | `skims` (**high**) |
| `length_hits_at` | `ankle` (medium) | `ankle` (high — unchanged) |
| `silhouette` | `tapered` (high) | `tapered` (high — unchanged) |
| `waistband_type` | `structured_mid_waist` (high) | `structured_mid_waist` (high — unchanged) |

Every other pair so far had *some* low-or-medium-confidence guess that got upgraded. This one had
nothing — the tagger correctly declined to guess `fit_on_body` from the hanger photo alone, then
answered confidently once a worn photo existed. That is the photo-authority mechanism working
exactly as designed, in its cleanest form across the whole corpus — until the next pair.

**Piece 996786 ("cream wide-leg fleece drawstring pants", bottom): the same clean pattern, back to
back.**

| field | hanger-only | hanger+worn |
|---|---|---|
| `fit_on_body` | **`null`** — no value, no confidence | `hangs_straight` (**high**) |
| `length_hits_at` | `ankle` (medium) | `ankle` (medium — unchanged) |
| `silhouette` | `wide_leg` (high) | `wide_leg` (high — unchanged) |
| `waistband_type` | `drawstring_relaxed` (high) | `drawstring_relaxed` (high — unchanged) |

Two in a row now with the same "no guess → confident answer" pattern on `fit_on_body`, both on
loose/wide-leg cuts. That's a real, specific pattern, not a one-off: the tagger appears to reliably
decline to guess `fit_on_body` on relaxed/wide-leg bottoms from a hanger photo alone, more so than
on fitted pieces, and answers confidently once real evidence exists.

**Smaller findings from across the nine pieces, unrelated to the photo-authority mechanism
itself:** piece 135's `hem_finish` and `stretch` changed value between conditions despite neither
being fit-dependent, confidence staying `high`/`medium` throughout — no hedge at either point.
`hem_finish` confidence *dropped* on re-tag in 2 of 9 pairs (996780, 996781) with the value
unchanged both times, on a field the authority map says should be answerable from the flat hanger
photo alone — real but inconsistent (most pairs showed no such drop), ordinary call-to-call
tagger variance rather than anything the worn photo should be causing.

**Reading n=9 honestly:** 3 corrections (135's three fields, 996783's `silhouette`, 996784's
`length_hits_at`), 6 confirmations (141, 996780, 996781, 996782, 996785, 996786) — both outcomes
the photo-authority map is designed to produce, both observed repeatedly. Category coverage:
outerwear ×2, dress ×1, top ×4, bottom ×3 — the two categories with zero coverage at n=3 (top,
bottom) now have the most data of any category. Two specific fields (`silhouette`, `length_hits_at`) have each
independently failed the same way twice, which is a more useful signal than the aggregate
correction rate: a hanger photo alone doesn't fail randomly across every field, it fails
predictably on a small number of them. The read holds and sharpens: "a hanger photo alone can
produce a confidently-wrong structural answer," specifically on `silhouette` and `length_hits_at`
more than the others measured so far.

**Latency, measured for the first time — 2026-08-16.** Raised twice as "feels slow" earlier this
session with nothing to check it against (see the two UI-bug entries below); `routes/ai.js` had no
timing instrumentation for tag calls at all before this pass (`commit 36b16de` added it). First
real measurement, on piece 996785's hanger-only call, immediately after a `wardrobe-api` restart:

> **32,908ms.** Input: 1,578 tok (uncached) + 11,254 tok (freshly written to cache) ≈ 12,832 tok
> total. Output: 1,615 tok. Cache: **MISS** — expected, since the restart cleared any warm cache.

**Caching (shipped earlier this session) is not expected to fix most of this.** Prompt caching
only skips *re-processing* input the model has already seen; it does nothing for how long the
model takes to *generate* its answer. At typical decode speeds for a large frontier model, ~1,615
output tokens lines up closely with a ~33-second wait — the dominant cost here is very likely
output length, not input reprocessing or lack of caching. The next call in this session should
show `cache: HIT`, which should measurably help cost and the input-side latency, but the
output-generation time — most of the 33 seconds — is untouched by it. The two real levers for
cutting that time are trimming what the tagger is asked to write (shorter free-text fields) or a
faster-decoding model tier for tagging — both bigger, separate decisions already on the open list
below (the model-tier one is the same 67%-cost-savings item that needs a real quality check before
anyone acts on it).

**Two adjacent UI bugs found and fixed while gathering this data, unrelated to tagger quality
itself:** tagging a brand-new piece for the first time was showing "AI found no new details to
apply. Your protected edits were preserved." even when every field had actually been filled in
correctly — `PieceForm.jsx` read a `changedCount` variable before React had actually run the state
updater that computed it, so the count was stuck at its initial `0` essentially every time
(`commit 8fae4fa`). Separately, deleting a just-picked (never-saved) photo before saving showed a
false "will be removed when you save" + a "Restore" button with nothing real to restore, because
the removal handler didn't distinguish a not-yet-saved local file pick from an actually-saved photo
(`commit 85d2740`). Both verified live in the sandbox; neither caused any actual data loss on the
real pieces they were found on (135, 141, 996780) — confirmed against the wardrobe directly.

---

## Model-tier A/B — design only, not yet run (2026-08-16)

The biggest remaining cost lever (67% cheaper input/output per `engine-behaviour-map.md`'s
*Tagging cost* section) and, per today's latency finding, plausibly the biggest remaining
**latency** lever too — but it needs a real quality check before anyone acts on it, and that
check needs new billed calls. Designed here, gated on explicit go-ahead before running, same rule
as everywhere else in this document.

**1. Cold-start is the config that has to be tested — not the current wardrobe.**
`engine-behaviour-map.md` already flagged this: the real adoption question is *"does a cheap tier
tag well enough for a brand-new user with zero calibration anchors,"* not *"does it tag well
against this wardrobe's 19 owner-corrected anchors."* Testing warm would measure a configuration
no new user ever sees. So the primary run strips the anchor block entirely — `buildAnchorBlock`
called with `fields: []`, matching what a real day-one signup gets.

**2. Paired, same-photo, read-only — the same design Q1's corpus used.** For each sampled piece,
call `tagPieceWithProvider` twice on the *same* photo(s): once with the current model
(`ACTIVE_STYLIST_MODEL`, currently `claude-sonnet-4-6`), once with a `model` override to
`claude-haiku-4-5`. Never call `applyTaggerResult` or write to the DB — this stays a pure
comparison, same as the originally-proposed (and superseded) synthetic Q1 batch. Model choice is
the only variable; everything else (photo, prompt, schema) is identical between the two calls.

**3. Sample selection: prioritize pieces with existing owner corrections.** Model-vs-model
agreement alone only shows that they differ, not which one is right. Pieces with populated
`manual_overrides` give real ground truth — for those specific fields, both models' outputs can
be scored against what the owner actually confirmed, not just against each other. Stratify across
categories the way Q1's corpus did (top/bottom/dress/outerwear/shoes/accessory), preferring pieces
with the most manual corrections so the ground-truth signal is as strong as possible per piece
sampled.

**4. Four evaluation dimensions — not a single pass/fail:**

| dimension | method | cost |
|---|---|---|
| structured-field agreement vs. owner ground truth | automated diff against `manual_overrides` fields | free (uses the paired outputs already collected) |
| confidence calibration | reuse Q2's `tagger_version`-split methodology — does haiku's `_confidence` discriminate, or collapse to reflexively high? | free |
| free-text quality (`garment_intelligence`/`style_notes`) | small side-by-side sample, human-read — doesn't scale like structured diffing | free, but bounded to ~5-8 pieces since it needs a person |
| real cost and latency | read directly off the paired calls, using this session's own logging (`commit 36b16de`) | free, byproduct of the paired calls |

**5. A decision rule, stated before running, not fitted after seeing results.** Proposed bar:
adopt haiku (at minimum for cold-start/new-user tagging, not necessarily as a wholesale
replacement) if structured-field agreement against owner ground truth clears roughly 90%,
confidence calibration isn't degenerate, and free-text quality survives owner spot-check.
Otherwise keep the current model. Open for the owner to adjust before running — the point is
having a stated bar at all, not this specific number.

**Real pricing, not estimated** (`styling-engine/provider.js`'s own `ANTHROPIC_PRICING_PER_MILLION`
table), cold-start config (no anchors, one photo, ~7,808 input tokens):

| model | cost/garment (realistic ~1,600 out) | cost/garment (2,500 cap) |
|---|---|---|
| sonnet (current) | $0.0474 | $0.0609 |
| haiku-4.5 (candidate) | $0.0158 | $0.0203 |

| N garments (paired, both models) | total cost |
|---|---|
| 15 | ~$0.95–$1.22 |
| 20 | ~$1.26–$1.62 |

**Not run.** Needs: (a) the owner's go-ahead on N and confirmation cold-start is the right primary
condition, (b) agreement on the decision-rule threshold, (c) the actual billed batch. All three
open.

---

## Synthesis — is the tagger the best it can be?

**Not yet, but seven free, no-quality-risk items shipped the same session this was written, and the
rest is now a ranked worklist rather than a feeling.** Shipped:

1. **Caching fix** (Q5) — content-array reorder + `cache_control` on the real prefix boundary.
   ~31% cost reduction on every future tag call, verified end to end, zero behavior change to what
   the tagger produces.
2. **Anchor total-count cap** (Q5) — `buildAnchorBlock` now takes a `maxAnchors` ceiling (default
   24), closing the mechanism that made the `occasions` finding below get worse every time the
   owner corrects another piece. Today's real anchor set (19) is unaffected; verified against a
   synthetic 100-bucket case and the live wardrobe.
3. **`pinManualConfidence` gap backfilled** (Q2) — one piece's stale pre-mechanism data, confirmed
   not a live code bug, fixed with a generalized, reusable script rather than a one-off patch.
4. **`cross_photo_agreement_note` dropped from the schema** (Q5/Q7) — stopped paying for a field
   nothing consumed; frozen prompt snapshot regenerated and diffed to confirm nothing else moved.
5. **Schema drift patched** (Q7) — all 7 missing fields added to `/extract-pieces`, with
   worn-photo-specific instruction text for the 3 fit-related ones rather than copied verbatim.
   Also fixed a second, adjacent bug found while verifying this reaches the wardrobe at all: the
   endpoint's one live caller (`OutfitLookbook.jsx`) had its own field-forwarding list that was
   already silently dropping 7 pre-existing fields before this session touched anything.
6. **`style_notes.risk` no longer instructs the self/pairing conflation** (Q3) — traced the free-
   text consistency problem to its root: the field's own worked example was a pairing-conditional
   sentence. Rewrote the instruction to be strictly intrinsic and redirected displaced
   pairing-conditional statements to the two existing fields already shaped for them. Only affects
   pieces tagged from now on — not retroactive to the wardrobe's existing free text.
7. **`stretch`'s low consumer count traced and resolved** (Q4) — its one consumer only ever fires
   for 8/244 pieces (synthetic + light + drapey), and zero of those 8 currently have `stretch`
   change the outcome. Not a latent gap in the `fiber_content` sense — a correctly-wired mechanism
   this wardrobe's composition never exercises. Also corrected a factual error this doc had stated
   earlier in the same session (`stretch` populated on 236/245 — wrong; the real number is 57/244).
8. **Two adjacent UI bugs found and fixed while gathering the Q1 corpus, plus latency
   instrumentation added** — a false "no new details, protected edits preserved" toast that fired
   on every tag call regardless of outcome (React state-timing bug, `commit 8fae4fa`); a false
   "photo will be removed" + dead "Restore" prompt for a photo that was never saved in the first
   place (`commit 85d2740`); and tag-call latency/cache-hit logging that didn't exist before
   (`commit 36b16de`), which produced this session's first real measurement — see Q1.
9. **`style_notes.risk` fix confirmed against real output, not just prompt text.** Re-ran
   `scratch/audit_freetext_structured_consistency.js` against the live wardrobe: all 7 pieces
   tagged with the current prompt show genuinely intrinsic risk text (fabric wrinkling, color
   washing out in sun, print reading busy up close, fabric showing dirt) — none repeat the old
   "looks deficient if not paired with X" pattern. One honest near-miss, not a clean sweep: piece
   996783's risk says *"any adjacent pattern or saturated color will **compete** directly with
   it"* — close to the literal prohibited phrase ("competes with Y"), though framed as a
   consequence of the color's own dominance rather than the old deficiency-without-a-partner
   framing. 6 of 7 clean, 1 of 7 borderline.
10. **`stretch`'s null-handling risk fixed.** `refinedFabric()` (`softScoreFloors.js`) required
    `stretch` to be `none`/`minimal`/**unset** to pass — an absent value silently passed the same
    test as a confirmed non-stretchy one, backwards from this schema's own conservative-default
    convention (`needs_base`'s explicit rule). Now requires stretch to be *explicitly* known and
    non-stretchy; unset correctly fails the check. Verified directly: unset → `false` (was `true`),
    `stretch: "none"` → still `true` (unchanged), `stretch: "stretchy"` → still `false`
    (unchanged). Existing `test/softScoreFloors.test.js` unaffected.
11. **`photo_properties.<PHOTO>.notes` dropped from the schema** — measured first: across the 7
    real v2-tagged pieces, `garment_intelligence`'s free-text fields (`real_wear_notes`,
    `do_not_pair_rules`, `pairing_requirements`, `formula_compatibility`, `failure_risks`,
    `occasion_confidence`) account for 34% of output and are all genuinely consumed downstream —
    not safe to cut. The `_confidence` map (18%) drives real UI review badges across all 32
    tracked fields per `garment-field-reference.md` — also not a clean cut despite its size. Only
    `photo_properties.notes` (~218 chars/piece, 72% of that section, ~5-6% of total output)
    checked out as genuinely unread by anything outside the normalization functions themselves —
    same shape as `cross_photo_agreement_note`. It also comes *after* the `fit_visible`/
    `real_context` judgments it would ostensibly justify in the schema, so it's post-hoc
    rationalization, not reasoning the model uses on its way to those judgments — removing it
    shouldn't affect their quality. Verified: schema JSON parses, snapshot regenerated and diffed
    to confirm only `TAG_PIECE_PROMPT` moved. This is a real but small win — maybe 80-95 of the
    ~1,615 output tokens — not a fix for the ~33-second latency measured earlier; the two levers
    that would actually move that number (trimming real `garment_intelligence` content, or a
    faster model tier) remain open, bigger decisions.

**Still open, ranked by leverage:**

1. **The `occasions`-anchor expansion is still not recommended as-is** (Q5) — the cap now bounds
   its worst case, but the underlying cost/benefit question (does anchoring occasions actually
   improve tagging quality enough to justify the tokens) was never answered, only bounded.
2. **Whether the two tagger schemas should be unified, not just patched** (Q7) — the drift itself
   is fixed, but nothing prevents the next field added to `tag-piece` from drifting the same way
   again. Deliberately deferred as a bigger, separate decision (import a shared field list vs. keep
   two literals in sync by hand) rather than folded into the patch.
3. **Whether `OutfitLookbook.jsx`'s scan-for-pieces feature should still exist in its current
   form** — its only consumer, and the reason `/extract-pieces` exists at all. Auto-creates a new
   wardrobe piece whenever match confidence isn't `high`, the duplicate-creation behavior already
   stepped away from once. **On the TODO list, not researched this session** — the schema/forwarding
   fixes make the endpoint's output more complete; they say nothing about whether the feature's
   design is still right.
4. **Confidence calibration works where the current prompt has actually run** (Q2) — the mechanism
   is sound; the gap is coverage. 161/245 pieces (66%) are still unversioned. This reframes "fix
   confidence calibration" as "finish rolling out the prompt that already fixed it."
5. **`style_notes.best_use`'s softer self/pairing conflation is still open** (Q3) — a "styling
   role" is relational by definition, so unlike `risk` it can't be fully separated by an instruction
   rewrite alone. Not addressed this session.
6. **Q1's core question is being answered by a real, growing corpus, not a separate gated batch,
   and now has real category coverage.** The free proxy was too confounded to answer it; the
   actual answer is coming from the owner's own ordinary tagging — same piece, hanger-only then
   hanger+worn, captured each time, at **n=9** and counting, spanning outerwear/dress/top/bottom.
   3 corrections, 6 confirmations. Two specific fields (`silhouette`, `length_hits_at`) have each
   independently failed the same way twice — a hanger photo doesn't fail randomly, it fails
   predictably on a small number of fields. It is the real thing this question needed, not a
   stand-in for it, and the read has sharpened from "leans toward" to a specific, actionable
   claim: hanger-only tagging is least trustworthy on `silhouette` and `length_hits_at`.
7. **Tag-call latency is real and measured — ~33 seconds on the first call after a restart** —
   and caching (shipped earlier this session) is not expected to fix most of it. The output-schema
   side got one free, measured cut (`photo_properties.notes`, item 11 above, ~5-6% of output) after
   confirming the rest of the schema's size is genuinely consumed, not decorative. That's real but
   small — cutting the wait for real still needs either trimming actual `garment_intelligence`
   content (a real quality tradeoff, not a freebie) or a faster-decoding model tier — both bigger,
   undecided questions, not something this pass resolves on its own.
8. **The model-tier A/B is designed, not run.** See *Model-tier A/B* above for the full plan:
   cold-start (no-anchor) primary condition, paired same-photo read-only calls, ground-truth
   scoring against `manual_overrides`, a stated decision rule, and real pricing (~$0.95–$1.62 for
   15-20 paired garments). This is the biggest single lever left on this list — 67% cheaper, and
   plausibly faster given today's latency finding — but needs the owner's go-ahead on sample size
   and the decision threshold before any of it runs.

Nothing here overrides `docs/engine-behaviour-map.md`'s existing findings — every number either
confirmed them on fresher data (Q2, Q5's caching/`cross_photo_agreement_note` claims) or extended
them into new territory the map hadn't measured (Q6's full-field sweep, Q7's schema diff, Q4's
consumer counts). The register-ceiling question flagged as out-of-scope in the plan remains
out-of-scope here — nothing in this pass touched it.
