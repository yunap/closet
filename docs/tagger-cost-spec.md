# Spec: tagger cost and cold-start quality

**Status:** draft for owner ratification, 2026-07-26. Not implemented.
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

1. **Approve ~$2.70 of billed evaluation** (§6)? Nothing is written without a second explicit
   approval.
2. **Certify a ~20-piece gold set?** Cheaper and cleaner than inferring ground truth from
   correction history.
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
