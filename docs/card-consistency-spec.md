# Spec — card/prose consistency, and the dress archetype

**Status:** active — Part 1 and Part 2's mechanical half IMPLEMENTED 2026-08-16; §5.2(2) and §8 open
**Last verified:** 2026-08-16 — measured against the live wardrobe and two captured threads

Route: [docs/README.md](README.md). Sources this spec must not restate:
[engine-behaviour-map.md](engine-behaviour-map.md) (what the engine does today),
[capsule-index-and-plan.md](capsule-index-and-plan.md) (the enforcement boundary this reuses),
[freeform-rearchitecture-handoff.md](freeform-rearchitecture-handoff.md) (the turn contract this
extends).

---

## 1. The defect class

**A card and its own words disagree.** Three instances, found independently, never named as one
thing:

1. **Capsule auto-completion, 2026-07-30.** A card titled "Ankle Boots" whose `piece_ids` held navy
   canvas slip shoes. `completeSubmittedPlanOutfits` filled a missing slot deterministically and
   *"nothing reconciles a card's title/reason text against a piece the engine adds afterward."*
   Logged in [capsule-index-and-plan.md](capsule-index-and-plan.md) §, never fixed.
2. **Dress + top prose omission, `thread_1786659896815`.** Two cards paired a blouse and a floral
   tank with a lace midi dress; `buildOutfitMechanicsReason` had no branch for a top alongside a
   dress, so the reason described the dress and the layer and never named the garment the owner was
   being told to wear. Template branch fixed 2026-08-16; the model side is this spec.
3. **The archetype label.** "Grounded Dress Edit", silhouette *"one-piece column"*, goal *"without
   extra fuss"* — asserted onto an outfit carrying two extra tops. Part 3 below.

All three: the engine changed or described an outfit, and nothing checked the description against
the pieces.

**The turn contract has no clause for this.** Its three clauses are *truth* (claims must match what
was verified this turn), *context* (clarifications), *delivery* (cards actually delivered). An
internally-inconsistent card passes all three: every piece is real and verified, and the card was
delivered. Nothing asks whether the card's words describe the card.

## 2. Owner rulings, 2026-08-16

- **A separate top with a dress is a styling decision, not a hard ban.** It must not be gated.
- **The reasoning must be visible.** *"In both of those examples the styling did not make much
  sense, or at least I would want to see the stylist's reasoning for it."*
- **The single dress archetype is a defect and should be fixed.**

## 3. Why disclosure and not a gate

Settled precedent, restated only by citation:

- Capsule Step 4: disclosure, **not a hard filter or a new generation instruction** — *"the `home`-gate
  precedent is that hard filters on taste dimensions starve capacity."*
- The capsule enforcement boundary: structural availability is deterministic, **taste is the model's**,
  and post-composition disclosure reports what the model did not demonstrate.
- Freeform's mission: *"the model owns the conversation; deterministic code guarantees only garment
  truth and output form."*
- Decision B (owner, 2026-06-25): advisor mode exists so **code does not censor composer results**.

Dress+top is a taste dimension. It stays legal, and the category-structure contract is **not** changed.

**Prompt-only instruction will not work, and both arcs proved it.** Capsule criterion 8: the
functional-demonstration clause was in the workbench, the jacket was in the allowed IDs, and the
composer still demonstrated no layer — *"Instruction present, behaviour unchanged."* Freeform reached
the same conclusion three times (spec 3 Part 0, spec 7 Part 2, spec 11): prompt guidance alone is not
reliable; verify mechanically. So this spec adds a **check**, not a paragraph.

## 4. Part 1 — the consistency clause

### 4.1 Detect (deterministic, no judgment)

`outfitLayersTopWithDress(pieces)` — true when an outfit contains both a `dress` and a `top`.
A structural fact about category groups. No keywords, no text classification.

### 4.2 Require (mechanical, deliberately weak)

When true, the card's own `reason` must **name the top** — substring match on the piece name.
Modelled on `findZeroResultContradiction`: a cheap match against a fact already known to be true,
not general fact-checking. A false positive costs one retry; the miss costs an unexplained garment.

This is intentionally not a quality bar on the *explanation*. It cannot be, and pretending
otherwise would be the taste-in-code mistake again. It only enforces that the stylist accounted for
the choice.

### 4.3 Enforce

- **Freeform `/ask`** — a fourth turn-contract clause, `cardProseInconsistent`, in the truth family,
  using the existing per-`blockType` retry Set. Correction message: *you proposed <top> with
  <dress> and did not explain it — say why it is layered, or propose the outfit without it.*
- **Composer / selected-piece** — coachable once, capsule-style.

### 4.4 Terminal case — keep the top, flag it

If the retry does not produce an explanation: **the top stays and the card carries a visible flag.**
It is never silently dropped. Three independent precedents converge here and any one of them
would be enough — capsule ships `model_repaired_with_gaps` with the gap stated; advisor mode exists
so code does not censor composer output; Decision B ruled against filtering results down.

Flag copy: *"This look layers a top with the dress and the stylist did not say why — treat the top
as optional."*

### 4.5 Generalising to instance 1

The same clause covers the capsule title mismatch: after `completeSubmittedPlanOutfits` adds a piece,
the card's title/reason are stale by construction. Engine-added pieces are a known event, so this
needs no retry — regenerate or flag at the point of completion. Closes a finding logged 2026-07-30.

## 5. Part 2 — the dress archetype

### 5.1 Today

```js
if (archetype.id !== 'dress_grounded_sharp' && hasDress) continue   // rules.js
```

Any outfit with a dress skips every other archetype, so `dress_grounded_sharp` wins unopposed.
Three consequences: the label carries no information (two different cards in one response were both
"Grounded Dress Edit"); its `avoidRoles: ['extra_pattern']` −12 penalty cannot disqualify because
nothing competes; and its stated silhouette is asserted onto outfits that are not one-piece columns.

The exclusion itself is sound — a dress outfit is not a "Grounded Graphic Column". The defect is
that nothing was added on the other side.

### 5.2 Fix, in two parts

1. **Stop asserting an unchecked description.** `silhouette` and `dominantDirection` must be derived
   from the pieces present, not copied from the archetype, whenever they disagree — a dress carrying
   two tops is not a one-piece column. Same principle as Part 1: do not describe what you did not
   check.
2. **Give the dress family more than one member**, so the label discriminates and the penalty can
   bite. Minimum viable set: the existing grounded/one-piece formula, plus a layered-dress formula,
   plus a statement/print-led one.

**5.2(2) — question withdrawn 2026-08-17.** It asked the owner to author archetype definitions, which
is not a reasonable thing to ask (*"I know nothing about archetypes"*), and it is largely moot: since
the authored-text fix the model's own label survives repair, so the archetype name now appears only
on cards where no model label exists at all. What remains is a code-only change needing no styling
input — when a dress outfit carries extra layers and the model gave no label, derive one from the
pieces (`wholeWardrobeLabelFromPieces`, which already exists) instead of using the archetype's name.
Low value; listed, not scheduled.

## 6. Acceptance

**Implemented 2026-08-16.** Criteria 1, 2, 4, 5 and 6 met and covered by tests in
`test/outfit_structure.test.js`; the 30-scenario candidate A/B is byte-identical, confirming this
work touched description and validation and never selection. Criterion 3 (two dress outfits must not
share a label) depends on §5.2(2) and remains open with it.

### Original criteria

1. `thread_1786659896815`'s two cards, replayed: each either names the top in its reason or carries
   the flag. Neither loses the top.
2. No card asserts "one-piece column" while carrying a top.
3. Two dress outfits with materially different structures do not receive the same label.
4. A dress outfit with no extra top is unchanged, end to end.
5. The category-structure contract is untouched; `npm test` green; the 30-scenario candidate A/B
   byte-identical (this spec touches description and validation, never selection).
6. `docs/engine-behaviour-map.md` amended in the same commit, per AGENTS.md.

## 7. Out of scope

Hard-gating dress+top. Scoring pressure on layering. Retagging. Changing
the category-structure contract. Any change to *which* pieces get selected.

## 8. Open — needs an owner ruling before this ships

1. ~~The terminal ending for a new clause~~ **RULED 2026-08-17: capsule's ending, for all of them.**
   Owner: *"didn't we say the capsule way is better?"* — yes, and it was already the answer. The turn
   contract now discloses: a clause that has spent its one retry and is still failing appends a short
   statement of what is unresolved rather than returning the answer unchanged and unremarked. It is
   deliberately not a second retry — the one-per-clause budget exists to prevent exactly that spiral.
   `discloseUnresolvedFreeformChecks`, counted as `unresolvedCheckDisclosures`.
2. ~~The dress archetype definitions~~ — withdrawn, see §5.2(2).

## Appendix — the cost measurement behind the philosophy discussion

Two captured threads, same wardrobe, 2026-08-16, both producing outfit cards:

| | iterations | cost | result |
|---|---|---|---|
| freeform `/ask` (`thread_1786908272853`) | 6 | **$0.433** | 3 cards |
| builder (`thread_1786908644157`) | 1 | **$0.097** | 5 cards |

Freeform's turn, by component: cache creation 82,189 tok **$0.308 (71%)**; prompt replay 316,656 tok
$0.095 (22%); **model output 1,989 tok $0.030 (7%)**. ~52,800 tokens of context re-sent per
iteration, and `withMovingCacheBreakpoint` writes a fresh cache entry each time at 1.25× input rate,
so one additional iteration costs **~$0.067 before the model emits a token**.

**The expense is not model autonomy — it is round-trips.** The four `search_wardrobe` calls in that
turn rediscovered things the app already held (resolved weather, the wardrobe manifest already in
the prompt). Capping iterations treats the symptom; pre-resolving what is knowable and handing the
model one workbench — what `plan_outfit_set` already does for multi-slot — treats the cause, without
moving a single taste decision into code. Recorded here because it bears on the next spec (activity
inference and roster ranking), not because this spec acts on it.
