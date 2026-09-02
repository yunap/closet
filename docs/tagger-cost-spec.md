# Spec: tagger cost and cold-start quality

**Status:** Phase 2 (model-tier screening) executed and decided 2026-08-23 for both cold-start
(§6b) and warm/anchored (§6c) tagging — adopt `claude-haiku-4-5` for normal tagging. A follow-up
screen (§6d, 2026-08-27) evaluated Gemini 3.5/3.1 Flash-Lite as cheaper alternatives to Haiku on the
same tagger contract — both screened as viable, with 3.1 Flash-Lite the stronger candidate on cost.
~~**No routing decision has been made** for Gemini; §6d is a screening result, not an adoption.~~
**Superseded 2026-09-02 — see §6e: Gemini 3.1 Flash-Lite is now the tagger default.** The
import-crop distribution is the one arm still untested for any tier (§6b). Phases 0/1 (caching,
content reordering, dead-field cleanup, cost-gate fixes) were independently implemented between
this spec's authoring and the Phase 2 run; see `docs/tagger-audit-findings.md`. Phases 3/4 remain
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

## 6d. Phase 2 follow-up — Gemini Flash-Lite tiers, executed 2026-08-27

This runs the same question §6b/§6c asked of Haiku against Sonnet — does a cheaper model tag well
enough? — one tier further down, against two Gemini models: **`gemini-3.5-flash-lite`** and
**`gemini-3.1-flash-lite`**. Both are Google's cheap/fast tier, the same role Haiku plays for
Anthropic (`gemini-3.7-flash`, used elsewhere in this session's Gemini evaluation slice, is a
heavier tier and not a fair Haiku comparison — confirmed by both naming and pricing: Haiku is
$1/$5 per M tokens; 3.5/3.1 Flash-Lite are $0.30/$2.50 and $0.25/$1.50; 3.7 Flash is $0.75/$3.75).

This work grew out of a separate Gemini-adapter evaluation slice (`styling-engine/provider.js`'s
`providerOverride` mechanism, plan `quizzical-foraging-boot`) and reused it: `tagPieceWithProvider`
(`routes/ai.js`) gained an additive `providerOverride` param, threaded through to
`askStylistWithUsage`, exactly like §6b's own `model` param addition — no existing caller passes
it, production behavior unchanged. `excludeAnchorPieceId` (§6c's fix) was set on every call.

### What changed from §6b/§6c's design

- **No stored-tag ground truth.** §6b/§6c never used stored DB values as ground truth, for good
  reason (99.6% of pieces carry some override, spanning several tagger generations — not a clean
  baseline). An earlier pass of this screen mistakenly diffed Gemini's output against stored tags;
  caught and discarded before drawing conclusions. All real comparisons here are fresh-Haiku vs.
  fresh-Gemini, same photo, same call.
- **Photo-adjudicated quality, not agreement-rate.** "Agreement with Haiku" was tried as a quality
  metric and rejected: it only measures similarity to Haiku, and several real disagreements found
  here were Haiku being *wrong* (below) — a metric that rewards matching Haiku's own errors is not
  evidence of quality. The real quality read is a small, manually adjudicated sample (owner + agent,
  checked against actual garment photos), matching §6b/§6c's own case-by-case adjudication method.
- **Hanger-only input was checked and rejected as insufficient**, then corrected. An initial pass
  sent only the hanger/flat-lay photo (`tagPieceWithProvider`'s single-photo call shape); several of
  the pieces used also have a `worn_photo` on file that real production tagging normally includes
  (§3.7b's own caller table: hanger **+ worn**, not hanger alone). Rerun with both photos for the
  4 of 6 pieces that have one on file (1, 33, 88, 89); agreement-rate moved from 68.6% to 75.7%
  hanger-only→hanger+worn (kept for context despite the metric being retired — the shift itself is
  informative: some of the original gap was missing information, not model divergence).
- **A real methodology bug caught mid-run, same shape as §6c's:** the tagger's `_confidence` map and
  `garment_intelligence` sub-object were briefly (and wrongly) flagged as a Gemini completeness gap
  — see "A false alarm" below. Traced fully before being ruled out.

### Manifest

6 pieces, category-diverse (top, dress, bottom, outerwear, accessory, and a second top), drawn from
the owner's real wardrobe: 1 (Whale stripe tee), 33 (Green maxi dress), 89 (Gray straight
trousers), 90 (small labradorite pendant necklace), 88 (striped knit cardigan), 63 (white tie-front
blouse). Not selected for owner-correction density (§6b's own later note: that axis stopped
discriminating once 99.6% of pieces carried some override) — selected for category spread, and
piece tags were shown to the owner before the paid run for a sanity check on the stored baseline.

### Results

Two real Anthropic-credit-exhaustion incidents interrupted this run (unrelated to Gemini — the
operator's Anthropic key ran out of balance mid-session and was topped up) and one 500 "high
demand" server error from `gemini-3.7-flash` during an unrelated adjacent check (also unrelated to
the tagger, see the Gemini evaluation slice's own notes) — neither affected the numbers below, both
were caught and the affected calls re-run cleanly.

**Hanger-only (6 pieces, 1 rep):**

| | Haiku | Gemini 3.5 Flash-Lite | Gemini 3.1 Flash-Lite |
|---|---|---|---|
| success | 6/6 | 6/6 | 5/6 (1 truncation — see below) |
| avg cost/garment | $0.0098 | $0.0049 | ~$0.0037 |
| avg latency | ~16.6s | ~22.6s (one 102s cache-miss outlier) | ~8.8s |

**Hanger + worn (4 pieces — 1, 33, 88, 89 — the real production input shape):**

| | Haiku | Gemini 3.5 Flash-Lite | Gemini 3.1 Flash-Lite (2 reps, 8 calls) |
|---|---|---|---|
| success | 4/4 | 4/4 | **8/8** |
| avg cost/garment | $0.0124 | $0.0064 (**48% cheaper**) | $0.0043 (**65% cheaper**) |
| avg latency | ~19.2s, steady | ~25.9s (one 83s outlier) | ~7.3s, no outliers |

Total spend across both benchmark passes and the closeout: on the order of $0.30–0.40 across ~40
real calls (Haiku + both Gemini tiers combined) — not separately reconciled to the cent, unlike
§6b/§6c's precise accounting; this screen prioritized coverage over exact spend tracking.

### The truncation false start

One Gemini 3.1 Flash-Lite call (piece 63, hanger-only) hit the tagger's `maxTokens: 2500` cap and
returned unparseable JSON, truncated mid-`_confidence` block. Initially misdiagnosed as a
3.1-specific tokenization inefficiency (a chars-per-output-token ratio roughly half of Haiku's and
3.5's on that one sample). A repeat of the *identical* call (same piece, same model, same cap)
completed normally, well under the cap — and the 8-call closeout at the real production input shape
saw **zero truncations**. Conclusion: this was ordinary run-to-run variance, not a systematic
defect — the same lesson §6b's own noise-floor check (c2's Sonnet self-disagreement) already
taught, re-learned here the hard way by not repeating a single failing sample before diagnosing it.

### A false alarm: `garment_intelligence` looked missing from Gemini, wasn't

Gemini 3.5 Flash-Lite's output appeared to omit `garment_intelligence` (nested under
`style_profile_json`, defined at `prompts.js`'s tagger schema example) on 0/10 comparisons — flagged
as a real completeness regression, since this field is genuinely consumed downstream
(`attributes.js`'s `getOccasionConfidence`, `rules.js`'s `pieceGarmentIntelligence`, and
`softScoreFloors.js` — occasion confidence, auto-use trust, outfit scoring; confirmed not safe to
drop). Traced through the full path before accepting the finding:

1. **Canonical schema** (`prompts.js`'s `tagPiecePromptTemplate`): `garment_intelligence` nested
   inside `style_profile_json`.
2. **No structured-output schema is sent to either provider for the tagger** — `tagPieceWithProvider`
   calls `askStylistWithUsage` (not the schema-enforced `askStylistStructuredWithUsage`), so this is
   pure prompt-example-driven free text for both Haiku and Gemini. Nothing to "weaken" in a schema
   conversion step, because there is no schema conversion step.
3. **Raw response:** Gemini nests it correctly, matching the documented schema, every time checked.
   **Haiku's raw response puts it at the top level instead — 10/10 times, across every call in both
   benchmark passes.**
4. **Normalization** (`tagPieceWithProvider`): preserves whatever nesting the model produced; does
   not relocate a top-level `garment_intelligence` into the documented nested slot.
5. **Persistence** (`taggerMerge.js`'s `applyTaggerResult`): builds the incoming profile **only**
   from `tags.style_profile_json`. A top-level `garment_intelligence` — Haiku's shape, in this
   sample — is never read and never reaches the stored piece.

**So the finding inverted: Gemini's structured-output compliance on this field was correct
throughout; the "omission" was a bug in this screen's own top-level-only comparison script, not in
Gemini.** Checked against the real 260-piece wardrobe (read-only, live `wardrobe.db`) to see whether
Haiku's top-level placement was a live production problem: **213/260 active pieces (82%) do have
`garment_intelligence` correctly nested and populated** (90% for the current `v2.0.0` tagger
version) — this session's 10/10 top-level-only sample did not generalize; most real Haiku tagging
gets this right. The remaining ~18% gap (47 pieces, concentrated in older/unknown tagger versions)
is a real, separate, pre-existing finding — not caused by, or resolved by, this Gemini screen — and
is not chased further here.

### Field-level adjudication (owner + agent, checked against real garment photos)

Comparing fresh Haiku vs. fresh Gemini 3.5 Flash-Lite output field-by-field, then checking every
real disagreement against the actual photo (hanger and, where available, worn) rather than trusting
either model's answer or a raw disagreement count:

**Gemini correct, Haiku wrong (7):** piece 33's `silhouette` (photo shows drop-waist construction —
fitted bodice to hip, then the skirt gathers; Haiku said `fit-and-flare`, then on the worn-photo
rerun `A-line` — still wrong both times) and `length_hits_at` (the dress is named "Green **maxi**
dress" and the worn photo shows it hitting at the ankle; Haiku said `knee`, wrong under both hanger
and worn conditions — confirmed a real, repeatable Haiku miss, not a missing-information artifact).
Piece 63's `neckline` (photo shows an unambiguous V-opening; Haiku said `wrap`) and `sleeve_length`
(owner adjudication: `cap` is the closer read of the two). Piece 88's `category` (Gemini said
`outerwear`, matching this piece's own established stored category; Haiku said `top`) and `colors`
(Gemini's set included the plainly visible near-black stripe band; Haiku's `sage` doesn't match
anything in the photo). Piece 90's `colors` (a small square green stone is clearly visible; Haiku's
set missed it).

**Haiku correct, Gemini wrong (2):** piece 33's and piece 90's `background_color` — this field means
"the garment's own base color" (`prompts.js`), not the photo backdrop; Gemini answered `white`
both times, matching neither garment's actual color, while Haiku correctly named the real base
color (`emerald`, `silver`) both times. A repeatable, specific misread of this one field's
instructions, not general color-blindness (Gemini's separate `colors` array was accurate on both of
these same pieces). On the hanger+worn rerun of piece 88, Haiku's `open` neckline also held up
better than Gemini's shifting, unconfirmed collar-type guesses (`shawl`, then `cowl` on separate
runs) against a worn photo that shows no distinct collar structure at all.

**Net: 7 clear wins for Gemini, 2 for Haiku, on facts actually checked against photos.** Sample is
small (6 pieces) — the same caveat §6b itself raised about its own 10-case screen applies here more
strongly, not less.

### Decision

**Both Gemini Flash-Lite tiers screen as viable Haiku alternatives for the tagger, on cost, latency,
and the adjudicated accuracy sample. 3.1 Flash-Lite is the stronger candidate of the two** — cheaper
than 3.5 ($0.0043 vs. $0.0064/garment on the real hanger+worn shape, ~65% below Haiku), a clean
0/8 failure rate on repeat, and no latency outliers in its closeout run (3.5 had one 83s spike in
the same conditions). Neither tier is provider-routed in production — this is a screening result
matching §6b/§6c's own posture ("this section records the result a routing change should cite; the
routing change itself is separate, deliberate work"), not an adoption decision.

### What this doesn't answer

- **Import-crop distribution untested** — same gap §6b/§6c left open, now open for three tiers
  instead of two.
- **6 pieces is a screening sample, not a powered study** — smaller than §6b's own 10-case screen,
  which itself called that size insufficient to bound a rare-failure rate.
- **Latency tail behavior is not well characterized.** Both Gemini tiers showed occasional large
  outliers (83–102s) on cache-miss, image-heavy calls in earlier passes of this session's broader
  Gemini evaluation, though the 3.1 closeout's 8 calls showed none. Not enough samples to state a
  real percentile.
- **`_confidence` and `garment_intelligence` structural placement was traced for correctness, not
  audited for whether Gemini's confidence calibration itself (`high`/`medium`/`low` values, as
  opposed to where they're nested) is trustworthy** — out of scope for this pass.
- **No BYOK, UI, or persisted-provider-selection work has been done** — this remains entirely behind
  the experimental `providerOverride` mechanism, consistent with the Gemini evaluation slice's own
  scope boundary.

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

---

## 6e. Adoption — Gemini 3.1 Flash-Lite becomes the tagger default (2026-09-02)

**Owner decision.** §6d screened; this adopts. `TAGGER_PROVIDER_OVERRIDE` in `routes/ai.js` now
defaults to `'gemini'` rather than `''`, so tagging routes to `gemini-3.1-flash-lite` with no env
var set. Reverting is still a one-variable change: `TAGGER_PROVIDER_OVERRIDE=anthropic`.

### What §6d measured, and why 3.1 rather than 3.5

At the real production input shape (hanger + worn):

| | Haiku | Gemini 3.5 Flash-Lite | **Gemini 3.1 Flash-Lite** |
|---|---|---|---|
| success | 4/4 | 4/4 | **8/8** |
| cost/garment | $0.0124 | $0.0064 (48% cheaper) | **$0.0043 (65% cheaper)** |
| latency | ~19.2s | ~25.9s, one 83s outlier | **~7.3s, no outliers** |

3.1 is both cheaper and faster than 3.5, with no latency outliers — it is the deliberate choice,
not a stale default. (An earlier note in this session called it drift, on the grounds that `/ask`
uses 3.5. That was wrong: the stylist and the tagger were benchmarked separately and reached
different tiers for different reasons.)

### Production evidence, not a benchmark

First real tagging call after the switch, from `ai_call_log`:

```text
06:55:22  gemini-3.1-flash-lite  tag_piece      in 22,298  out 1,571  $0.0079  6.6s
05:09:44  claude-haiku-4-5       unattributed   in  3,186  out 1,735  $0.0292  16.7s
```

**73% cheaper and 2.5x faster** on the same wardrobe, ninety minutes apart. Latency landed on
§6d's ~7.3s prediction.

Two things that benchmark did not show:

- **The Haiku call cost 2.4x §6d's figure** ($0.0292 vs $0.0124) on a *third* of the input tokens.
  Cheap input, expensive bill — the Anthropic cache-write pattern. The real production gap is
  therefore wider than the screen suggested, in Gemini's favour.
- **Gemini used 7x the input tokens** (22,298 vs 3,186) and still cost a quarter as much. Input
  volume is what prompt caching would otherwise attack, so the Phase 0/1 caching work is worth
  less on this path than it was on Anthropic.

Quality on that call was correct on every field this session's two specs added: `fit_on_body:
skims` on a tailored coat (the fabric-stiffness default correctly overridden by visible shaping),
`fiber_content: ["wool","unknown"]` with `fiber_content_completeness: partial`, and a
`thermal material verdict` of `insulating` scoring it `very warm`. `manual_overrides` was empty —
pure model output.

### What this adoption does NOT resolve

- ~~**BYOK — the blocking gap for the multiuser platform.**~~ **RETRACTED 2026-09-02, same day.**
  This section originally called Gemini BYOK a shipping blocker. That was **wrong**, and how it
  went wrong is worth keeping: the claim was read off the error string in `assertProviderKey()` —
  *"experimental path, no BYOK yet"* — rather than off the code path. `resolveGeminiKey()` is
  `resolveKey('gemini', userId)`, the identical per-user-then-installation resolution Anthropic and
  OpenAI use, and the Settings screen has had a working Gemini key field all along. The error
  string was stale from before Stage D, and `provider.js`'s own comment above `resolveGeminiKey`
  said so. **Gemini BYOK works; this adoption carries no BYOK gap.** The stale message has been
  replaced with `noKeyErrorMessage('gemini')`, matching the other two providers — it had been
  telling users to set an env var when the actual fix is adding a key in Settings.

- **The import-crop distribution is still untested on any tier.** §6 called it *"the one that
  decides adoption"*; §6d did not cover it and neither does this. Adoption here rests on the
  add/edit/retag path only.
- **10 screening cases plus one production call** is not a powered study. It is enough to justify
  a reversible default on one wardrobe; it is not enough to bound a rare-failure rate.

### 6f. Truncation at the token cap — a verbose output contract, not a low ceiling (2026-09-02)

The first real tagging session after §6e's switch failed:

```text
Model response hit the token cap (maxTokens: 2500) and was truncated before valid JSON completed
```

Output tokens from `ai_call_log` against the old cap:

```text
claude-haiku-4-5       1735    69%
claude-sonnet-4-6      1662    66%
gemini-3.1-flash-lite  1571    63%
gemini-3.1-flash-lite  2496   100%   truncated mid-JSON, same schema, same model
```

**The first fix was a cap raise to 4000, and it was wrong** — it protected the symptom and left the
cause. Owner ruling: *the token ceiling should protect against unusual variance, not subsidize an
unnecessarily verbose output contract.* Examining the schema found two real sources.

#### The elastic block: `real_wear_notes`

Five sub-keys, **two specified as literally empty strings** (`drape`, `placement`) — no guidance on
content, no length bound on any of the five. Measured across the 221 pieces carrying
`garment_intelligence`:

```text
pairing_requirements    mean 1.5   max 3    (schema allows 0-4)
failure_risks           mean 0.9   max 3    (0-4)
formula_compatibility   mean 1.7   max 4    (0-4)
do_not_pair_rules       mean 1.3   max 3    (0-4)
real_wear_notes         mean 4.9   max 5    (5 sub-keys)
```

**The bounded lists were never the problem** — the model self-limits at roughly a third of its
allowance, so tightening them would have saved almost nothing. `real_wear_notes` is filled 4.9 of 5,
*including* `maintenance`, whose own instruction says to omit it for ordinary machine-washable
garments. That is a prompt-contract failure rather than model variance: empty-string placeholders
read as slots that must be answered.

Every key now carries a purpose and an **8-12 word bound**, and **OMIT replaces the empty string**,
with an explicit rule against sending empty values or the object itself when nothing applies.

#### The bookkeeping: `_confidence`

34 keys emitted flat with no category conditioning — while the same schema *is* category-conditional
for `silhouette`, `fabric_category` and `length_hits_at`. A coat was rating its confidence in
`heel_height`, `jewelry_type`, `waistband_type`, `shoe_type`, `toe_shape`, `walk_support`,
`accessory_subtype`, `bottom_subtype`, `necklace_length` and `tuck_behavior`: **10 of 34
inapplicable**, about 55 output tokens. Now instructed to omit inapplicable entries.

**What this change does and does not do.** It reduces the irrelevant entries the MODEL EMITS — an
output-token saving. It does **not** shrink the persisted confidence map, and cannot:
`normalizeConfidenceMap()` re-materialises every `CONFIDENCE_FIELDS` entry, defaulting an absent one
to `'low'`. The stored map is 33 keys before and after. An earlier draft of this section predicted
the stored count would fall to ~25, which was simply wrong about the write path.

Omitted entries therefore land as `'low'`. Verified before shipping that this cannot produce
spurious review chips: `lowConfidenceFields` filters every one of those fields by category.

A dead `outerwear_role` entry was also still in `CONFIDENCE_FIELDS` after that field's retirement
earlier the same day.

#### What was NOT cut

`garment_intelligence` is the largest single block (215 tokens on a real coat) and every one of its
eight sub-keys has live consumers — `occasion_confidence` alone has 14. It earns its size.

#### The ceiling

**3000 for single-piece tagging**, not 4000. Clean outputs sit at 1600-1700, so 3000 is slack rather
than a new normal: the ceiling absorbs variance, the contract does the work.

**`/extract-pieces` stays at 3000.** An earlier version of this change raised it to 5000 by analogy
— *"same schema, therefore more exposed"* — which is not evidence. Its output scales with the number
of garments in one photo, so it needs a sizing rule, and **`ai_call_log` holds zero calls from that
flow** to build one from. Measure before moving it.

#### Telemetry: truncation was invisible

The truncated call was logged with `success = 1` — the provider returned 200 and the failure only
surfaced when the caller could not parse the body, after the spend row was written. That made the
very evidence needed to judge whether these bounds work unreliable.

Fixed at both provider boundaries: a response whose `stopReason` is `max_tokens` is logged as a
failure with an explicit message — `callOutcomeFromUsage` on the Gemini paths,
`truncationOutcome` in the Anthropic/OpenAI fetch hook. The provider's own stop reason is
authoritative, so neither needs a heuristic.

#### A screening result revisited

§6d hit this exact truncation and dismissed it: *"ordinary run-to-run variance, not a systematic
defect."* Right about the variance, wrong about the consequence. The screen measured cost and
latency carefully, and never asked how close to the ceiling the winning tier ran — nor whether the
output contract deserved the tokens it was spending.

#### Acceptance result — 5 live calls, 2026-09-02

Run with `scratch/measure_tagger_contract.mjs` (read-only; measures the tagger's output without
persisting it). All calls `gemini/gemini-3.1-flash-lite`, routing verified before spending. Total
spend **$0.0233**.

```text
                        coat x4                 shoe    baseline
output tokens      2136 1336 1128 1210         1034     1571 clean / 2496 truncated
real_wear_notes      3    3    3    3             2      5
  words              28   26   28   34           20      34   (longest value <= 12 words)
confidence keys     33   33   33   33            33      35
stop reason        null null null null         null      never recorded
parse succeeded    yes  yes  yes  yes           yes      —
```

**What this establishes:**

- **The elastic block fix works.** `real_wear_notes` fell from 5 keys to 3 (2 on the boot), every
  value inside its word bound, consistently across all five calls. This was the diagnosis and it
  holds.
- **No truncations, no parse failures**, and the worst observed call — 2136 — sits at **71% of the
  3000 cap**, against 2496 at 100% of the old one. The ceiling is sized for the observed tail.
- **Typical calls were leaner** (mean 1369 against a 1571 clean baseline).

**What it does NOT establish.** Five calls cannot prove a stable token reduction: the observed
spread is 1034-2136, wider than the ~115-token saving the change was estimated to produce, so any
mean comparison here is inside the noise. The claim worth making is narrower — *the elastic block is
demonstrably sparser and bounded, and the tail now fits comfortably under the ceiling* — not "output
dropped by N tokens". Note also that the single 2136 call was the only cold one; the other four
show cache hits.

`stopReason` reads `null` on normal Gemini completions, which is correct: that provider reports a
finish reason only in the abnormal case. The path that matters is `max_tokens`, which now surfaces
as failure telemetry rather than `success = 1`.

#### Reproducing the check


`scratch/check_tagger_output_budget.js` (read-only) reports the six measurements this review asked
for, against their pre-change baselines:

```bash
WARDROBE_ALLOW_LIVE_DB=1 node scratch/check_tagger_output_budget.js --id 996867
```

```text
  measurement                   now                    before the change
  output tokens                 1571                   1571 clean / 2496 truncated
  real_wear_notes keys          5                      4.9 of 5 on average
  real_wear_notes words         34                     unbounded; ~8-12 each now
  confidence keys               35                     34, ten inapplicable on a coat
  stop reason                   (not recorded)         was never recorded at all
  parse succeeded               yes                    truncation logged as success
```

`scratch/check_tagger_output_budget.js` reports the same six values for an already-tagged piece from
stored data; `scratch/measure_tagger_contract.mjs --id <id> --reps <n>` makes the live calls. Judge
on the structural lines — `real_wear_notes` keys and words — not on output tokens, for the reason
above.
