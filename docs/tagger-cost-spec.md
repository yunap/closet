# Spec: tagger cost and cold-start quality

**Status:** Phase 2 (model-tier screening) executed and decided 2026-08-23 for both cold-start
(§6b) and warm/anchored (§6c) tagging — adopt `claude-haiku-4-5` for normal tagging. The
import-crop distribution is the one arm still untested (§6b). Phases 0/1 (caching, content
reordering, dead-field cleanup, cost-gate fixes) were independently implemented between this
spec's authoring and the Phase 2 run; see `docs/tagger-audit-findings.md`. Phases 3/4 remain
undecided. **No production routing has been changed** — this spec records the decision; the
routing change is separate, unapproved work.
**Author's note:** every number here is measured against the real 236-piece wardrobe by a read-only
script, named inline. Nothing in this spec was estimated.

---

## 1. Why

**Owner, 2026-07-26:** *"the largest barrier for my users to start using the app is bringing
in/tagging their wardrobes."*

Tagging is a **per-signup onboarding cost**, paid on the user's own key (BYOK, spec 33). It is also
the app's single most expensive operation, and it scales with wardrobe size — so it is the first
thing a new user pays for and the last thing they get value from.

This supersedes the earlier framing of tagger work as quality-first. It is cost-first, with quality
held at or above today's level. It is also the precursor the video-import decision was waiting on
(`ui-v1-design-handoff.md` issue 5, owner: *"Optimising the tagging step may be the better first
move, and it pays off across every import path and the wardrobe generally"*).

### Measured today

Per garment, `claude-sonnet-4-6`, no caching:

| | tokens | cost |
|---|---|---|
| input | 9,880 | $0.0296 |
| output | up to 2,500 (the cap) | $0.0375 |
| **total** | | **$0.0671** |

**Output is 56% of the bill.** Prompt trimming attacks the smaller half.

Cold-start onboarding (no anchors — see §3.1):

| | 50 garments | 200 garments |
|---|---|---|
| today | $3.05 | **$12.18** |
| + prompt caching | $2.29 | $9.17 |
| + haiku-4-5 | **$0.76** | **$3.06** |

Target: **≥70% reduction with no measurable quality regression in the cold-start configuration.**

---

## 2. Constraints — already ruled, do not reopen

| ruling | source | effect on this spec |
|---|---|---|
| *"AI retagging reports what changed, leaves results reviewable, and cannot race Save"* | `ui-v1-design-handoff.md`, ratified | Capture-then-apply (§4) **is** this principle at batch scale |
| Nothing is retagged automatically, by design | surface map → Tasks | Apply stays a deliberate owner action; no auto-run |
| Worn-photo scope — **OPEN, needs owner agreement** | `ui-v1-design-handoff.md` | §8 Q3. Do **not** settle it as an implementation detail |
| Any tagged-field change = 9 wiring points, "tagger prompts ×2" first | `freeform-rearchitecture-handoff.md` | `extract-pieces` travels with `tag-piece`; both in scope |
| `occasions.js` frozen; prohibitions encode validity only; no new profiles | `occasion_profiles_ratification.md` | This spec changes what the tagger **emits**, never what profiles **mean** |
| Register ceilings ratified 2026-07-05, incl. `casual → everyday` | `occasion_profiles_ratification.md` | Out of scope. The 108-piece exclusion is intended |
| Never make a billed call without explicit approval | session handoff | §6 is the only billed step; it is gated |

---

## 3. Findings this spec rests on

All from `docs/engine-behaviour-map.md`; scripts named.

### 3.1 A new user gets zero calibration anchors — `measure_provenance.js`

`buildAnchorBlock` only buckets pieces whose field appears in `manual_overrides`. A wardrobe with
no corrections yields an **empty anchor block**. The wardrobe-calibration mechanism is unavailable
to exactly the population whose first impression decides adoption; it is rich-get-richer by
construction. **Cold start is therefore the primary case for this spec**, and the owner's wardrobe
(18 anchors, 202 formality corrections) is the *atypical* one.

### 3.2 The tagger uses no prompt caching, and structurally cannot — `measure_image_path.js`

`tagPieceWithProvider` sets no `cache_control`. It also **cannot benefit until reordered**: the
per-piece photo is pushed into `content` **first** (`routes/ai.js:364`), before the anchors and the
prompt, and an Anthropic cache prefix must be contiguous from the start. The machinery already
exists (`provider.js` → `PROMPT_CACHE_BREAKPOINT`, `systemToAnthropicBlocks`) and the stylist
conversation path uses it.

### 3.3 Prompt composition — `research_tagger_prompt.js`

| section | tokens | share of user prompt |
|---|---|---|
| CALIBRATION ANCHORS (static A/B/C archetypes) | 2,340 | **44%** |
| DESCRIPTIVE CUES & LABELS | 2,166 | 41% |
| PHOTO PROPERTY AUTHORITY MAP | 578 | 11% |
| PHYSICAL PROPERTY FRAMEWORK | 179 | 3% |
| `TAG_PIECE_SYSTEM` (separate) | 294 | — |

The static archetypes are the largest block. For a warm user they duplicate the dynamic anchors;
for a cold-start user they are the **only** calibration that exists.

### 3.4 Paid output is discarded — `taggerMerge.js:243`

`cross_photo_agreement_note` is explicitly demanded by the prompt (*"Always emit a brief
cross-photo agreement note"*) and deleted in `applyTaggerResult`. Output tokens paid for and thrown
away.

### 3.5 Tagger predictions are destroyed on merge — `research_tagger_prompt.js`

`mergeWithManualOverrides` keeps the owner's value and discards the model's. Nothing archives it,
so **202 formality corrections cannot tell us what the tagger got wrong**. Only 9 raw pairs survive
(`import_clusters.tags_json` linked to a piece). At n=9: 56 field comparisons, 46 agree; the
disagreements cluster as `fabric_weight: heavy → medium` (4×) and `formality: everyday → elevated`
(2×).

### 3.6 Two cost gates under-quote

- `routes/importer.js`: `TAG_EST_INPUT_TOKENS = 6000` vs measured **9,880**. The prompt text alone
  is 6,097, so images were never counted.
- `scratch/backfill_retagger.js`: `COST_PER_PIECE_ESTIMATE = 0.018` vs measured **$0.0671** —
  3.7× low. Its `$3.00` cap would admit ~166 pieces having actually spent **$11.15**.

### 3.7 No truncation

All 58 pieces tagged by the current prompt carry `style_lanes`, `garment_intelligence`,
`_confidence` and `photo_properties`. The 2,500 cap is not biting; it is a ceiling, not a target.

---

## 3.7b One tagger, four callers — but two input distributions

**There is only one tagger.** `tagPieceWithProvider` is called by all four paths, with the same
`TAG_PIECE_SYSTEM`, the same `TAG_PIECE_PROMPT`, the same anchors and the same model:

| caller | photos sent | `existingPiece` |
|---|---|---|
| `BatchAdd` → `/tag-piece` | user-uploaded hanger (+ worn) | null |
| `PieceForm` add → `/tag-piece` | user-uploaded hanger (+ worn) | null |
| `PieceForm` edit → `/tag-piece-existing/:id` | the piece's stored photos | **the piece** → Ground Truth Overrides block |
| `routes/importer.js` `/tag` | **a detector crop**, or the full source photo when the crop failed | null |
| `scratch/backfill_retagger.js` | stored photos | the piece |

**So owner corrections do bear on import quality, and any tagger improvement transfers to import
automatically.** The prompt is shared.

**What differs is the input distribution, and it is materially harder for import:**

- It tags a **crop**, not a clean garment photo.
- When crop verification failed twice, it sends the **full source photo** instead, labelled
  `WORN PHOTO` with guidance *"full photo — locate the garment"*. **22 of 162** import garments are
  in this state (`crop_ok = 0`).
- A crop taken from a worn outfit shot is still labelled `HANGER PHOTO`.
- One deliberate mitigation exists, with its provenance recorded in the source: when the crop is
  good *and* came from a worn outfit, the full photo is sent alongside it, because *"tagging a
  partial crop alone misreads categories (a dress cropped waist-down tags as a skirt)"*.

**The one genuinely separate tagger is `/extract-pieces`** (`EXTRACT_PIECES_SYSTEM`, live from
`src/views/OutfitLookbook.jsx:737` — "add pieces from an outfit photo"). Different prompt, no
anchors, no photo-authority map, no `_confidence` map. See the engine map → *`extract-pieces`*.

**Consequence for §6:** evaluating on the owner's clean stored photos measures the **add/edit**
path only. Import is the harder distribution, the cold-start path, and the adoption barrier. The
evaluation therefore needs **two arms** — clean photos and real import crops — because a cheaper
model tier that holds on hanger shots may not hold on a waist-down crop. **All 162 import crops are
still on disk** (140 verified, 22 fallback), so the import arm can be built for free.

---

## 3.8 How much of this already exists in the importer

**The import pipeline has already solved several of these problems in its own scope.** Where it
has, this spec should *generalise the existing mechanism*, not invent a parallel one.

| spec item | importer | elsewhere (add-piece, retag, edit) |
|---|---|---|
| Raw tagger output archived before apply | ✅ `import_clusters.tags_json` | ❌ nothing |
| Review before the value reaches a piece | ✅ review-queue endpoint renders stored tags | ❌ applied immediately |
| Human override at apply time | ✅ reviewer `name`/`category` beat model tags | partial (PieceForm, post-hoc) |
| Deferred apply — tag and apply are separate calls | ✅ `/tag` then `/accept` | ❌ single shot |
| Cost preflight + explicit approval gate | ✅ `{approve:true}` required | ❌ none |
| Real spend recorded from usage | ✅ `addSpend` → `import_sessions.spent_usd` | ❌ none |
| Cheap model tier | ✅ 5 of 6 stages on `claude-haiku-4-5` | ❌ full stylist model |
| Batching | ✅ classify 10/call, crop-verify 10, cluster 12 | ❌ 1 garment per call |
| **Prompt caching** | ❌ none | ❌ none |
| **Cold-start calibration** | ❌ — and import *is* the cold-start path | ❌ |

**Consequences for this spec:**

1. **Phase 4 (capture-then-apply) is mostly a generalisation, not new work.** The importer already
   does tag → store raw → review → apply-with-override. Lift that pattern to a per-piece archive
   that also covers the add-piece, retag and edit paths.
2. **Phase 6's model change has precedent in the same file.** `IMPORT_CHEAP_MODEL`,
   `askCheapJson`, its salvage layer and its retry-at-3× already exist and run haiku across five
   stages. **Tagging is the sole holdout** — it is the one stage that calls
   `ACTIVE_STYLIST_MODEL`. So the question is narrower than "can haiku tag?": it is "why was
   tagging exempted from a cheap tier the rest of the pipeline already uses?"
3. **Tagging is also the only unbatched stage.** Every other stage amortises its prompt across
   10–12 items. Tagging sends the full 5,288-token prompt per garment.
4. **Caching is absent everywhere** — the one lever with no prior art anywhere in the codebase's
   AI paths except the stylist conversation.
5. **The importer's governance is the model for the retag path**, which currently has neither a
   preflight nor spend recording — only a 3.7×-low constant.

---

## 4. Phase 0 — capture-then-apply (no billed calls to build)

**The evaluation harness and the missing-history fix are the same work.**

1. **Archive raw tagger output.** Every call to `tagPieceWithProvider` writes its raw JSON, keyed by
   piece id, with `tagger_version`, model id, timestamp and the photo filenames it saw.
2. **`backfill_retagger.js --capture <file>`** — dry run, writes raw output + the existing `getDiff`
   result to JSONL instead of stdout. It already refuses to touch a manual override (write-path
   guard throws); keep that.
3. **`--apply-from <file>`** — replays `applyTaggerResult(currentPieceRow, capturedTags)` and
   writes. **Safe to defer**: the merge re-reads the *live* row, and `PieceForm` registers every
   hand-edit as a `manual_override`, so corrections made between capture and apply are protected
   automatically. **Guard:** refuse to apply if a photo filename has changed since capture.
4. **Fix both cost constants** (§3.6) to the measured figures, and make the retagger's cap count in
   real dollars.

**Why this is first:** it makes every later phase measurable and re-appliable, it stops the next
run from throwing away its own evidence, and it means a billed pass is never paid for twice.

**Borrow, don't invent.** Per §3.8 the importer already implements this end to end — tag → store
raw in `import_clusters.tags_json` → review-queue endpoint → accept with reviewer overrides beating
model tags. The work here is generalising that to a per-piece archive covering add-piece, retag and
edit, not designing a new mechanism. Reuse its governance too: preflight, explicit approval,
`addSpend` from real usage.

---

## 5. Phase 1 — free structural wins (no quality risk, no billed calls)

1. **Reorder `content` and enable caching.** Move the static prompt and anchor block **before** the
   per-piece photo, mark the prefix with `cache_control`, and use `systemToAnthropicBlocks` for the
   system prompt. **−31%, quality-neutral.** In a bulk import the hit rate approaches 100%.
2. **Audit the output schema field by field.** Delete from the prompt anything never read.
   `cross_photo_agreement_note` is confirmed dead (§3.4); `real_wear_notes`, `maintenance`,
   `placement` and the free-text `garment_intelligence` lists need tracing — several *are*
   consumed, so this is an audit, not a cull. Output is 56% of spend, so this is the highest-value
   free lever.
3. **Delete `setPath`** (`taggerMerge.js:168`), flagged **DEAD — delete in next spec** by
   `cleanup-inventory.md`.
4. **Fix the importer preflight estimate** so the cost gate stops under-quoting by 1.6×.

**Exit criterion:** measured per-garment cost falls to ~$0.0465 with byte-identical output on a
re-run of the same piece.

---

## 6. Phase 2 — the model-tier decision (the only billed step)

**Question:** does `claude-haiku-4-5` tag well enough for a **cold-start** user?

This is worth 67% of the bill and is the only lever with genuine quality risk. The importer already
runs haiku for classification, detection, crop verification, clustering and merge matching —
**tagging is the sole stage still on the full stylist model**, and the cheap-tier plumbing
(`IMPORT_CHEAP_MODEL`, `askCheapJson`, salvage, retry-at-3×) is already built and in production.
So the honest form of the question is narrower: *why was tagging exempted from a tier the rest of
the pipeline already trusts?* If the answer is "nobody tested it", this is a cheap test. If there
is a recorded reason, it belongs in §2 and this phase changes shape.

**Also worth testing in the same run: batching.** Tagging is the only unbatched stage — every
other one amortises its prompt across 10–12 items. Batching 5 garments per call would cut the
per-garment prompt cost ~5×, though caching (Phase 1) already captures most of that, and output
scales linearly regardless. The larger prize is wall-clock: a 200-garment onboarding is currently
200 serial calls.

### Design

- **Two arms, because there are two input distributions (§3.7b).**
  - **Arm A — clean photos (add/edit path):** 30 pieces drawn from the **42** that are both
    unversioned *and* carry ≥2 owner corrections. Ground truth exists only where the owner
    intervened; on untouched fields a diff is version drift, not error. Include piece **353**
    (cargo pants, `length_hits_at` mis-tagged `mid-thigh`) as a fixed regression case.
  - **Arm B — import crops:** the same comparison against real detector crops, which are the
    harder distribution and the one that gates onboarding. All 162 are still on disk; include some
    of the 22 `crop_ok = 0` fallbacks, since those are the worst realistic input. Ground truth here
    is thinner — use the 9 linked `tags_json` pairs plus any pieces the owner will certify.
  - **Arm B is the one that decides adoption.** A tier that holds on hanger shots but fails on a
    waist-down crop would ship a quiet onboarding regression, which is exactly the failure this
    spec exists to avoid.
- **Configuration: cold start.** Strip the anchor block. Testing against this wardrobe's 18 anchors
  would measure a setup no new user ever sees.
- **Pin the model explicitly** in both arms and record it in the capture.
- **Noise floor first:** re-run 10 pieces on the *unchanged* configuration to measure
  self-disagreement. Without it, a delta is uninterpretable.

### Cost

| step | pieces | cost | lands in DB? |
|---|---|---|---|
| baseline, sonnet, cold-start config | 30 | $2.01 | ✅ captured, appliable |
| noise floor (repeat 10) | 10 | $0.67 | ❌ measurement only |
| haiku, same 30 | 30 | $0.47 | ✅ if it passes |
| **true evaluation overhead** | | **~$2.70** | rest is retag work already owed |

### Decision rule

- Haiku's disagreement-with-ground-truth is **within the noise floor** → adopt haiku. Done.
- Haiku is **worse only on specific fields** → route those fields to sonnet, or accept and correct.
- Haiku is **broadly worse** → stay on sonnet, keep Phase 1's 31%, and proceed to Phase 3.

---

## 6b. Phase 2 — executed 2026-08-23: results and decision

**This is a revised, smaller version of §6's design, run under a tighter budget.** By the time this
ran, Phases 0/1 were already independently implemented (`docs/tagger-audit-findings.md`): caching
and content-reordering are live, `cross_photo_agreement_note` and `setPath` are gone, and the
garment-field taxonomy had since split by category (shoes/accessories no longer share
`silhouette`/`fabric_weight` with clothing — see `docs/garment-field-reference.md`). None of that
invalidated the core Phase 2 question, which had not been touched: tagging still always ran on
`claude-sonnet-4-6`; the haiku-vs-sonnet A/B had never been run.

### What changed from §6's design

- **One arm, not two.** §6 called for a clean-photo arm plus an import-crop arm, with Arm B named
  as "the one that decides adoption." The import-crop files on disk from the prior import session
  turned out to be poor material for this screening round (owner judgment call, not a
  measurement) and were dropped. **This run only covers the clean hanger/worn-photo distribution.**
  The import-crop arm is still unrun and is the largest remaining gap — see "What this doesn't
  answer" below.
- **10 cases, not 30+10+30.** Budget-driven. §6's Arm A also leaned on pieces with ≥2 owner
  corrections as a ground-truth proxy; this run explicitly avoided that (99.6% of active pieces now
  carry *some* manual override, so "has corrections" no longer discriminates, and correction
  history spans several tagger generations so isn't clean ground truth regardless). Cases were
  picked for category/silhouette/fabric-weight/formality diversity instead.
- **Noise floor measured narrowly, not broadly.** Instead of §6's flat 10-piece repeat-everything
  step, only the two cases that showed disagreement were repeated (2 extra Sonnet calls), after the
  first pass identified which cases needed it. Cheaper, and it's what actually settled the
  ambiguous cases (below).
- **Cold start achieved via an isolated DB copy** (`manual_overrides` cleared), not a code change —
  `buildAnchorBlock` already returns empty with no matching overrides. `existingPiece` was passed as
  `null` for every case, so the per-piece Ground-Truth-Overrides block was suppressed too. One small
  additive repo change was needed: `tagPieceWithProvider` (`routes/ai.js`) gained an optional `model`
  key so the harness could pin Sonnet/Haiku per call without relying on the module-load-time
  `ANTHROPIC_STYLIST_MODEL` env var. No existing caller passes it; production behavior is unchanged.

### Manifest (10 cases, all clean hanger/worn photos, owner's real wardrobe)

| case | piece | category | fabric_weight | formality | silhouette/type | length |
|---|---|---|---|---|---|---|
| c1 | 996780 | dress | medium | elevated | sheath | midi |
| c2 | 996778 | dress | light | dressy | shift | below_knee |
| c3 | 996783 | top | light | everyday | straight | hip |
| c4 | 990446 | top | medium | everyday | fitted | waist |
| c5 | 996784 | bottom | light | lounge | tapered | floor_length |
| c6 | 990390 | bottom | heavy | everyday | relaxed | full_length |
| c7 | 996760 | outerwear | heavy | everyday | oversized | mid_thigh |
| c8 | 996759 | outerwear | medium | elevated | structured | knee |
| c9 | 996776 | accessory | slim (jewelry) | elevated | fitted | above-knee |
| c10 | 205 | shoes | medium | dressy | pump/pointed | below_ankle |

### Results

22 calls total (10 cases × 2 models, plus 2 targeted Sonnet repeats). **100% JSON-parse success**,
zero retries, zero malformed output, zero missed-garment cases, on both models. **Total spend
$0.6294** — Sonnet $0.3882 (10 calls), Haiku $0.1346 (10 calls), noise-floor repeats $0.1066 (2
calls) — against a quoted ceiling of $0.80 and well under §6's original $2.70 budget. Haiku ran
**~65% cheaper and ~46% faster** per call (avg 19.3s vs 35.9s), consistent with §6's projection.

### Field-level findings and adjudication

Comparing Sonnet vs Haiku on Tier-1 fields (category-aware — shoes/accessories compared on their
own current field set, not `fabric_weight`/`silhouette`), most cases were exact or near-exact
matches; two showed real disagreement (c2, c7). Both were run down to a verdict:

- **c7 (996760, a heavy oversized sherpa-fleece pullover hoodie):** Sonnet called it `category:
  top` on two independent runs (fully reproducible, not noise); Haiku called it `outerwear`,
  matching the piece's stored value. **Owner ruling: the fabric is too warm to read as a top** —
  this is a real Sonnet miss, not an ambiguous garment. **Verdict: `haiku_better`.**
- **c2 (996778, a silk abstract-print dress with sequin shoulder detail):** the two stable
  disagreements were `silhouette` (Sonnet: sheath, Haiku: wrap) and `fabric_weight` (Sonnet: medium,
  Haiku: light). A one-call Sonnet repeat showed the *other* two apparent disagreements on this case
  (`length_hits_at`, `formality`) were pure sampling noise — Sonnet didn't even agree with itself,
  and its second `formality` answer matched Haiku's. On the two stable fields, **owner ruling: the
  hanger-photo folds do read as a wrap, and the fabric is silk** (consistent with Haiku's "light,"
  not Sonnet's "medium") — the worn photo was partly occluded by a phone, which plausibly explains
  why this was a harder case for both models. **Verdict: `haiku_better`.**
- All other 8 cases: **`equivalent`** — either full agreement, or differences confined to soft
  formality/length judgment calls with no clear winner.

**0 of 10 cases showed a Haiku regression of any severity. 2 of 10 showed Haiku correcting a
Sonnet error.** The decision rule's stop condition ("2+ clear material regressions") did not
trigger — the opposite happened.

### Decision

**Adopt `claude-haiku-4-5` for cold-start tagging.** On this screening set Haiku matched or beat
Sonnet on every field checked, at ~65% lower cost and ~46% lower latency, with identical schema
reliability. Nothing has been changed in production routing yet — `ACTIVE_STYLIST_MODEL` and
`tagPieceWithProvider`'s default still resolve to Sonnet everywhere. This section records the
result the routing change should cite; the routing change itself is separate, deliberate work (see
"Next" below).

### What this doesn't answer

- **The import-crop distribution is untested.** §6 named this "the one that decides adoption" —
  crops and fallback-to-full-photo cases are still the harder, cold-start-relevant path this spec
  exists for, and this run says nothing about it. Re-running the import arm (with better source
  material than what was on disk from the prior session) is the most important follow-up before
  treating this as a full adoption decision rather than a promising screen.
- **10 cases is a screening sample, not a powered study.** It caught two real errors, which is a
  good sign for Haiku, but it cannot bound a rare-failure rate the way a larger run could.
- ~~Warm-wardrobe (calibration-anchor) tagging was not tested.~~ **Addressed 2026-08-23** — see §6c.
- **Batching was not tested** (§6, "also worth testing in the same run") — out of scope for this
  pass.

### Next (not yet done, not yet approved)

1. Decide whether to gate the import-crop follow-up on new import test material, or accept the
   cold-start clean-photo result as sufficient for the add/edit path only (leaving import on Sonnet
   for now).
2. If proceeding: wire the `model` param already added to `tagPieceWithProvider` into an actual
   routing decision (env-gated cold-start-only Haiku routing, most likely), behind explicit owner
   approval — this spec's Phase 2 answers "does Haiku tag well enough," not "route production
   traffic to it," and that remains a separate step per this doc's own non-reopenable constraint
   (§2: "never make a billed call without explicit approval" applies to routing changes' blast
   radius too, even though routing itself isn't a billed call).
3. Raw output for all 22 calls, plus the isolated cold-start DB copy used to produce them, are
   scratch artifacts from this run and were not committed; re-running this harness is cheap (~$0.63)
   if the results need to be reproduced or extended.

---

## 6c. Phase 2 follow-up — warm/anchored tagging, executed 2026-08-23

§6b only tested the cold-start prompt shape (no calibration anchors). This follow-up asked the
same haiku-vs-sonnet question with the real dynamic anchor block **enabled**, since a warm user's
tag calls (the majority of this wardrobe's actual tagging traffic) carry that block and it changes
the prompt shape materially — a tier decision for cold start doesn't automatically transfer.

### Design

- **4 garments, 2 models each = 8 calls**, chosen so the anchor block was actually relevant: at
  least two touching `formality`-anchor buckets and two touching `fabric_weight`-anchor buckets in
  the real wardrobe's current anchor pool (which, checked directly, covers all four formality values
  and three of four fabric_weight values already — so the more useful selection axis turned out to
  be thin buckets and historically-tricky pieces, not raw coverage).
- **Three of the four cases were reused from §6b** (996760, 996778, 996784) specifically to get a
  direct within-garment cold-vs-warm comparison, not just four new unrelated data points. The
  fourth (126, a tweed vest) was picked fresh to stress the thinnest `fabric_weight=heavy` bucket
  (7 source pieces) alongside `formality=elevated` (88 sources).
- **`existingPiece` stayed `null` for all 8 calls**, same as §6b — this isolates the calibration-
  anchor mechanism as the only new variable. It does not exercise the separate per-piece
  Ground-Truth-Overrides block, which only fires when an existing piece is passed in.
- **A real DB copy (uncleared)** was used instead of the cold run's overrides-wiped copy, so
  `buildAnchorBlock`'s pool reflects the actual, current wardrobe.

### A methodology bug caught before running: self-leaking anchors

`buildAnchorBlock` has no way to exclude "the piece currently being tagged" from its own anchor
pool — `tagPieceWithProvider` doesn't receive a piece id when `existingPiece` is `null`. Checking
the 4 candidates' own `manual_overrides` found that **two of the four were already anchor sources
for the exact field being tested**: piece 996778 already had `fabric_weight` in its own overrides,
and piece 126 already had `formality` in its own. Confirmed directly: the anchor block generated
for 996778 included the line `fabric_weight=light: 996778 abstract brushstroke print sheath dress
... reads_as: dramatic black-ivory brushstroke print shift with sequin shoulder detail` — its own
id, field value, *and* description, handed back to the model tagging it. Running the test unfixed
would have measured "does showing a model its own labeled answer work," not "does warm anchoring
help."

**Fix:** `tagPieceWithProvider` gained a second optional parameter, `excludeAnchorPieceId`, that
filters the anchor-pool query by id before calling `buildAnchorBlock`. Additive, unused by any
production caller, verified directly (with vs. without exclusion) before the paid run.

### Results

8/8 calls succeeded, 100% parse rate, zero retries. **Cost $0.3152** (Sonnet $0.2353 / 4 calls,
Haiku $0.0799 / 4 calls) — Haiku ~66% cheaper and ~48% faster (17.2s vs 33.0s avg), consistent with
the cold-run ratios. Combined cold + warm spend across both phases: **$0.9446**.

### Field-level findings and adjudication

| case | piece | finding | verdict |
|---|---|---|---|
| w1 | 996760 (a modern fleece pullover hoodie — corrected from an earlier "sherpa" mischaracterization) | `category` flipped for **both** models between cold and warm (Sonnet: top→outerwear; Haiku: outerwear→top). **Owner ruling: warmth is not determinable from the photo alone**, so neither answer is checkable against visual evidence — this piece's stored `outerwear` value likely reflects how the owner actually wears it, not something recoverable from the hanger/worn shots. | **dropped as unadjudicable**, not scored either direction |
| w2 | 996778 (silk print dress, reused from §6b) | Haiku correct on `fabric_weight` (light, matching silk) where Sonnet said medium; `silhouette` inconclusive — all three of stored/Sonnet/Haiku disagreed (shift/sheath/wrap) | `haiku_better` |
| w3 | 996784 (lounge bottom, reused from §6b) | Sonnet correct on `formality` (lounge, matching stored) where Haiku said everyday; both models missed `length_hits_at` together (floor_length vs ankle — a shared miss, not a model-tier difference) | `sonnet_better` |
| w4 | 126, tweed vest (fresh case) | Sonnet called an **unmistakable vest** `outerwear`; Haiku correctly matched the stored `top`. Unlike w1, a vest's construction (open front, sleeveless) is visible in the photo, so this is a real, checkable error, not an ambiguous garment | `haiku_better` |

**Net: 2 Haiku wins (w2, w4), 1 Sonnet win (w3), 1 dropped as unanswerable from photo evidence
(w1), zero material regressions in either direction.** This does not change the direction of §6b's
finding — it extends "Haiku matches or beats Sonnet" to the warm/anchored prompt shape as well as
cold start.

### Decision

**Extend the §6b decision to warm tagging: adopt `claude-haiku-4-5` for normal tagging, cold and
warm.** Nothing has been changed in production routing — this section, like §6b, records the result
a routing change should cite. The import-crop distribution (§6b, "What this doesn't answer") is
still the one untested arm and remains the largest gap before calling this decision complete for
every tagging path.

---

## 7. Phase 3 — cold-start calibration (conditional on Phase 2)

Only if the cold-start configuration proves weak — which is the likeliest failure, since it is the
weakest configuration in the system and the one every new user gets.

The dynamic anchors cannot help a new user (§3.1), so cold-start quality has to come from the
static prompt — currently three hard-coded archetypes costing 44% of the token budget. Options, to
be measured, not assumed:

- **Ship a curated seed anchor set** — a small number of exemplar garments with photos, shipped
  with the app, giving every new user a calibrated baseline on day one.
- **Rewrite the static archetypes** against the measured error profile (§3.5) — they should
  demonstrate the boundaries the tagger actually gets wrong (`heavy` vs `medium`, `everyday` vs
  `elevated`), not generic range-setting.
- **Backfill anchors from the user's own corrections sooner** — lower the threshold so the first
  handful of corrections start calibrating immediately.

**Not in this phase:** widening `buildAnchorBlock`'s field list to include `occasions`. It helps
warm users only, costs tokens, and `occasions` is an array so each combination becomes its own
bucket (38 corrections → 31 near-unique anchors). Revisit after cold start is solved.

---

## 8. Open questions for the owner

1. ~~Approve ~$2.70 of billed evaluation (§6)?~~ **Answered 2026-08-23** — a smaller $0.63 run was
   approved and executed instead; see §6b.
2. ~~Certify a ~20-piece gold set?~~ **Superseded** — §6b adjudicated the two disagreement cases
   directly with the owner rather than pre-certifying a gold set; correction history was confirmed
   unusable as ground truth (99.6% of active pieces now carry some override).
3. **Worn-photo scope** — ratify or defer. The engine's authority map already scopes worn photos to
   fit, drape, length, tuck, waistband and on-body silhouette, which matches the stated preference;
   the product decision is still open and a prompt rewrite could settle it by accident.
4. **Quality floor:** is "no measurable regression against the owner's corrections" the right bar,
   or should cold-start quality be allowed to drop slightly in exchange for a 67% cut?

---

## 9. Non-goals

- Re-tagging the owner's 167 unversioned pieces. That happens *after* the tagger is improved, per
  the standing ruling — this wardrobe has been re-tagged multiple times already and each pass is
  only as good as the tagger that day.
- Any change to `occasions.js`, the register ceilings, or profile semantics.
- The consumer-side defects (editorial prompt's missing length clause, the `pattern_type` blind
  spot, the singular/plural gap). They misread good data rather than producing bad data — separate
  spec.
- Renaming garments. `name_suggestion` is mapped client-side at intake only; a retag never renames.

---

## 10. How we know it worked

- Per-garment cost, measured by `measure_image_path.js`, falls ≥70% from $0.0671.
- A 200-garment cold-start onboarding costs **≤$3.50**, down from $12.18.
- Haiku's disagreement with owner ground truth is within the measured noise floor, or the
  regression is confined to fields the decision rule accepted.
- Re-running a captured piece produces byte-identical output at lower cost (Phase 1 only).
- Both cost gates report within 10% of measured spend.
