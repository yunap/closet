# Feedback routing — proposal

**What exists is described in [`feedback-and-memory-map.md`](feedback-and-memory-map.md).** This
document does not restate it and carries no measurements of its own; where a number is needed, run
`node scratch/measure_feedback_surface.js` and cite the section. If this document and the map
disagree, the map is right.

Written 2026-08-08, after mapping the surface.

## The problem in one sentence

Feedback is collected in six channels and treated as if it answered one question, so most of it
either lands in a prompt or lands nowhere — and prompt text is the destination with the worst
cost-to-value ratio of the four available.

## 1. Four destinations, not one

Every piece of feedback answers one of four different questions. Route by the question.

### A · "The garment data is wrong" → a retag task

The only destination that **fixes the system permanently** instead of steering one generation. It
already exists and works: a wrong-length board complaint becomes a `retag-suggestion` to-do naming
the garment *and* the field, which clears when that field is saved, and which never changes a tag
by itself. See the map §3 → *Into `todos`*.

It currently covers only the six wrong-length reasons. **The routing unit is the sub-reason, not
the feedback type** — a complaint routes only when it names **one garment and one field**:

| feedback | routes? | field it implicates |
|---|---|---|
| `wrong_length` sub-reasons | ✅ shipped | `length_hits_at`, `sleeve_type` |
| `wrong_garment_details` | ✅ candidate | `reads_as`, `pattern_*`, `neckline`, `sleeve_type` |
| `bad_occasion` | ✅ candidate | `occasions` |
| `layer_too_long`, `competing_hemlines` | ✅ candidate | `length_hits_at` |
| `wrong_item_read` | ⚠️ aggregate only | `occasions`, `formality`, `reads_as` |
| `fit_issue`, `too_much_volume`, `shape_lost`, `unbalanced_proportions`, `too_columnar` | ❌ relational | none — these describe two garments against each other |

`fit_issue` is `target_type='whole_wardrobe_outfit'`: a judgment about how an outfit hangs together,
not about the garment field `fit_on_body`. Relational complaints belong in destination C.

The safety property that makes imperfect routing acceptable here: a wrong suggestion costs one
dismissed to-do, never a corrupted tag.

### B · "The picture is wrong" → render calibration

Already correct and already separated — image-fidelity feedback reaches the image prompt and is kept
out of styling. Needs two repairs, both in §3.

### C · "This garment is wrong for me" → a score

Already exists, per-user and weighted, in **two** deterministic consumers (map §4). This is the only
mechanism that makes a personal preference binding *without* a prompt and *without* a global rule —
which is what the 2026-08-07 owner ruling requires, since occasion profiles ship to every user.

`buildWholeWardrobeFeedbackInfluence` already computes per-piece, per-combination, per-formula and
per-occasion influence and has no production caller. It should be revived, not rewritten.

### D · "This is a standing instruction" → the prompt

Only what cannot be a tag correction or a score.

> **The routing rule: the prompt is the destination of last resort, not the default.**

## 2. Prompt-size discipline

Where feedback does reach a prompt, three rules. This is what makes it affordable to give the
capsule its share at all — today's readers concatenate raw rows, which grows without bound and lands
in the prompt tail where this codebase has already measured stored rules losing (spec 25/26).

1. **Scope to the pieces in play.** Only feedback touching a garment on the bench or in the outfit.
   `getSavedBoardRendererMemory` already does this correctly — copy its overlap check.
2. **Consolidate, don't concatenate.** *"Marked too plain on 4 outfits containing this jacket"* is
   one line and stronger evidence than four lines.
3. **Cap per destination, not globally.** A garment with 20 reactions contributes a summary.

## 3. The plan

| # | change | status |
|---|---|---|
| 0.1 | Stop `renderer_calibration` scoring against garment selection | **open — and larger than first thought** |
| 0.2 | Remap `wrong_energy` → `too_subdued` | open |
| 0.3 | Stop board/outfit critique landing on the garment card | **shipped** (`96c3246`) |
| 0.4 | Decide `renderer_calibration`'s fate | needs owner ruling |
| 1 | Route "your data is wrong" signals to retag tasks | open |
| 2 | One consolidated influence layer | open |
| 3 | Give the capsule its share | open |
| 4 | Taxonomy cleanup | open |

**0.1** — both scorers guard image-fidelity feedback with
`target_type === 'generated_visual_board' && IMAGE_FIDELITY_FEEDBACK_TYPES.has(...)`
(`rules.js:532` and `rules.js:2656`), so `renderer_calibration` rows fall through in *both*. The fix
is the same one-line widening in two places. Every affected row carries `context_type='piece'`, so
nothing else filters them out.

**0.2** — `too_subdued` is already one of `wrong_energy`'s own seven sub-reasons
(`wrongEnergyReasonLabels`, `rules.js:729`), so the target is not invented. Do it as a **one-time
backfill of existing rows**, not as a rule in code: the seven sub-reasons mean different things and
guessing between them is only safe for rows whose author has said what they meant.

**1** — measure how many to-dos the existing rows would generate before shipping. If it is hundreds,
add a threshold (two independent complaints on the same field) — and `wrong_item_read` should never
be one-strike.

**2** — deterministic, so it needs a ranking A/B and the #44 memory-pollution caution about stored
text gaining mechanical authority.

**3** — prompt half first (cheap, reversible, measurable on one run), scoring half second.

**4** — collapse the duplicate labels (four ways to say "boring", three to say "proportions are
off"), decide `pairs_well_with`, and make the Style-profile panel show which stored rules are
actually delivered.

## 4. Decisions needed before building

These are decisions about the plan. Questions about *what exists* live in the map's
`[owner check wanted]` markers.

1. **Should board reactions influence capsule selection at all?** A reaction to one rendered outfit
   is evidence about that outfit; treating it as evidence about a garment's place in a 24-piece
   capsule is a larger inferential step. `getStylistFeedbackMemory` already separates scoped
   reactions ("taste signals, not global directives") from standing rules. Phase 3 should respect
   that line rather than flatten it, and where the line sits is an owner call.
2. **Retag threshold** — one complaint, or two?
3. **Phase order** — 0.1 and 0.2 are cheap and independent. Phase 1 attacks tagger accuracy, which
   is upstream of several open problems. Phase 3 is the one that changes the surface currently
   being worked on.
