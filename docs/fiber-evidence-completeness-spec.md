# Spec — fiber evidence completeness and its canonical owner

**Status:** Proposed 2026-09-01. Written in response to a review of the garment-editor
proposal that followed the black-puffer tagging incident. **Route:**
[docs/README.md](README.md). Governed by
[architecture-ownership-consolidation-spec.md](architecture-ownership-consolidation-spec.md)
and the [responsibility census](architecture-responsibility-census.md). Related:
[garment-warmth-calibration.md](garment-warmth-calibration.md),
[garment-warmth-evidence-map.md](garment-warmth-evidence-map.md),
[garment-field-reference.md](garment-field-reference.md).

## 1. The incident this comes from

A black puffer coat was tagged `fiber_content: ["polyester", "nylon"]`. The care label reads:

```text
SHELL:  100% polyester
LINING: 100% polyester
FILL:   60% duck down, 40% feather
```

The tag was not wrong. The shell and lining *are* polyester. It was **incomplete, stored in a
shape that cannot express incompleteness** — and every thermal consumer read it as a complete
statement of composition, concluding the coat had no insulating material.

The general failure: `fiber_content` conflates *"the fibres are X"* with *"the fibres I could
see are X."* For a lined or filled garment those are different claims, and only the second is
what a photo-based tagger can honestly produce.

## 2. Measured state of the field

`node` against a read-only copy of the live DB, 268 active pieces:

| state | count | meaning |
|---|---|---|
| `[]` | 4 | nothing recorded (3 shoes + `996768 Duster`) |
| `["unknown"]` | 24 | explicitly unresolved |
| resolved fibres **+** `"unknown"` | 10 | **partial — already being written** |
| resolved fibres only | 230 | presented as complete |
| `fiber_content` in `manual_overrides` | 140 | provenance machinery is real and heavily used |

The 10 partial rows:

```text
108     black washed bootcut denim jeans   ["denim","spandex","unknown"]
110     white slim crop jeans              ["cotton","spandex","unknown"]
122     olive green utility cropped pants  ["cotton","spandex","unknown"]
151     Apple skirt                        ["unknown","cotton"]
169     navy solid canvas slip shoes       ["cotton","unknown"]
202     pink tweed pointed heels           ["leather","unknown"]
238     green floral knit cardigan         ["cotton","unknown"]
362     woven straw crossbody bag          ["leather","unknown","hemp"]
990358  navy technical hoodie              ["polyester","spandex","unknown"]
994060  multi-colored botanical scarf      ["wool","unknown"]
```

### 2.1 The partial state is written and never read

This is the finding that reframes the review's fourth point. Partial-ness is **not** a state
Closet needs to invent — the tagger and the owner have been improvising it for months by
including `"unknown"` alongside resolved fibres. And no reader interprets it.
`pieceHasInsulatingMaterial()` asks only `fibers.some(f => INSULATING_FIBERS.has(f))`, so:

```text
["polyester","nylon"]            →  no insulating material
["polyester","nylon","unknown"]  →  no insulating material     ← identical verdict
```

That is the `[R1]` shape this arc has already fixed three times: a fact recorded at the source
and dropped at the consumer. Had the puffer been tagged with the trailing `"unknown"`, the
information needed to catch it would have been present in the row — and still ignored.

## 3. `"unknown"` is currently overloaded three ways

1. **Honest uncertainty.** The tagger prompt instructs it explicitly: "for uncertain textile
   composition … use `fiber_content: ["unknown"]` rather than inventing a specific fiber."
2. **The empty default.** `normalizeFiberContent([])` returns `["unknown"]`, not `[]`.
3. **Out-of-vocabulary coercion.** `.map(v => VALID_FIBERS.has(v) ? v : 'unknown')` — an
   unrecognised value is silently rewritten to `"unknown"` rather than dropped or rejected.

These three collapse **only in the singleton case**. In a multi-member list, `"unknown"`
unambiguously means "plus something I could not identify" — including case 3, where a fibre the
tagger did name but Closet could not spell degrades into exactly the right verdict.

**Note for [garment-field-reference.md](garment-field-reference.md):** that document's "How safe
is it to extend an enum?" section places `fiber_content` in the *loosely validated* tier by
omission. It is strictly validated, and its failure mode is worse than the strict tier described
there — an out-of-list value does not null out visibly, it becomes `"unknown"`, indistinguishable
from an honest admission of uncertainty. The `fiber_content` row also cites `FIBER_OPTIONS` (a UI
constant) as source of truth. Both need correcting alongside this work.

## 4. The vocabulary has four copies

| copy | location | role |
|---|---|---|
| `FIBER_OPTIONS` | `src/components/PieceForm.jsx:52` | edit-dialog chips |
| `FIBER_OPTIONS` | `src/components/BatchAdd.jsx:28` | intake-review chips |
| inline enum text | `styling-engine/prompts.js:988` | tagger schema |
| `VALID_FIBERS` | `styling-engine/taggerMerge.js:6` | write-path validation |

**They currently agree** — all 35 values, verified by diff. The drift risk is structural, not yet
realised, and this should not be oversold as a live defect. What *is* live is that
`prompts.js:988` carries several hundred words of genuine domain semantics (which materials belong
to jewellery; that footwear linings are the only place a boot's warmth is recorded) that exist
**only** inside a prompt string, invisible to the user and unavailable to any other consumer.

The repo already has the pattern for fixing this. `SLEEVE_SHAPE_VALUES` / `SLEEVE_SHAPE_OPTIONS`
in `styling-engine/attributes.js` (2026-08-26) is a canonical vocabulary owner from which "the
tagger schema, PieceForm, and BatchAdd all derive … rather than keeping their own copy." Fibre
vocabulary should follow it. This is precedent, not invention.

## 5. Ownership chain

Adopted from the review, which is correct that a UI projection must not own the meaning it
displays:

```text
CANONICAL FIELD DEFINITION          styling-engine/attributes.js
  fibre vocabulary + family + applicability + user consequence
            ↓
PERSISTED GARMENT FACT              pieces.fiber_content
  + existing manual_overrides / confidence provenance
            ↓
SHARED FACT READER / VERDICT        fiberEvidenceCompleteness(piece)
  unknown | partial | complete
            ↓
 ┌─────────────┬──────────────┬──────────────┐
 editor UI     thermal model  tagger/intake
 warning       calibration    completeness
 projection    consumer       writer
```

The UI owns **when and how to show** the warning. It does not own **whether the evidence is
incomplete**.

## 6. Where this spec diverges from the review

The review proposes a new persisted column:

```text
fiber_content_completeness = unknown | partial | complete
```

**This spec proposes deriving the verdict first, with no schema change.** §2.1 shows the
distinction is already present in the stored data:

```text
[]  or  ["unknown"]        → unknown
[...fibres, "unknown"]     → partial
[...fibres]                → complete
```

Reasons to derive rather than store:

- It ships against 10 rows of **real existing data** instead of a column that is `NULL`
  everywhere until a backfill runs.
- It requires no migration, no backfill authorization, and no second write path to keep in sync
  with `fiber_content` itself.
- It honours the ownership chain exactly as drawn — the verdict is canonical and shared; only its
  *storage* differs.
- The review's own reasoning for separating completeness from provenance applies with more force
  here: a derived verdict **cannot** drift from the fibre list it describes, whereas a stored
  column can.

The weakness is real and should be stated plainly: derivation depends on the tagger emitting the
trailing `"unknown"` reliably, and **it currently does not** — the puffer did not get one. So
§7.4 makes that instruction explicit in the tagger prompt. If, after a measurement pass on
re-tagged pieces, the marker still proves unreliable, a stored column earns its keep and this
decision should be revisited. Recording that as a re-openable decision rather than a settled one.

Everything else in the review is adopted as written, including its rejection of the phrase
"apply the same treatment to every `GATE_CRITICAL_FIELDS` entry." That was wrong: it makes an
implementation bucket the owner of user-facing meaning, and would turn `GATE_CRITICAL_FIELDS` into
a second field-semantics registry. The correct form is: **audit every gate-critical field for
missing user-consequence metadata; do not let the list own that metadata.**

## 7. The work

### 7.1 Canonical fibre vocabulary — `styling-engine/attributes.js`

Following the `SLEEVE_SHAPE_OPTIONS` precedent, one exported table carrying value, label, family,
and applicability:

```text
{ value: 'down',   label: 'Down',   family: 'insulating',  appliesTo: ['clothing', 'shoes'] }
{ value: 'pearl',  label: 'Pearl',  family: 'jewelry',     appliesTo: ['accessory'] }
```

`FIBER_OPTIONS` in both forms, `VALID_FIBERS` in `taggerMerge.js`, and the enum text in
`prompts.js:988` all derive from it. A test asserts single-sourcing, matching
`test/batchAdd.test.js`'s existing pattern of importing the real constant rather than copying it.

`INSULATING_FIBERS` becomes a projection of `family: 'insulating'` rather than a parallel hand-kept
set — it currently lists exactly the seven members of that family.

### 7.2 Field-consequence metadata — same owner

Each field's user-facing consequence lives with its definition, not in the editor and not keyed
off `GATE_CRITICAL_FIELDS`:

```text
fiber_content
  consequence: "Helps determine warmth and weather suitability"
```

The editor renders it. Populating this for the other gate-critical fields is a follow-up audit,
not part of this change.

### 7.3 `fiberEvidenceCompleteness(piece)` — the shared verdict

Returns `unknown | partial | complete` per §6. Consumers:

- **Editor** — shows the incompleteness warning (§7.5).
- **Thermal** — `garment-warmth-calibration.md`'s open question of how much authority to give a
  negative insulating result. A `complete` "no insulating fibres" is evidence; a `partial` one is
  not. This closes the puffer case at the layer where it actually went wrong.
- **Intake review** — `src/utils/intakeReview.js` can surface partial evidence as a review chip
  alongside its existing low-confidence chips.

Acceptance criterion 8 of the consolidation spec still binds: **`unknown` and `partial` must never
become hard invalidity.** They downgrade the authority of a negative result; they do not invalidate
a piece.

### 7.4 Tagger prompt — make the partial marker explicit

`prompts.js:988` currently instructs `["unknown"]` only for wholly-uncertain composition. Extend it
to the partial case, with the puffer as the worked example: when a garment is visibly lined,
filled, or quilted and only the shell material can be identified, include `"unknown"` **alongside**
the identified fibres rather than presenting the shell as the whole composition.

This is also the one instruction that would have prevented the incident at its source.

### 7.5 Editor projections

- **Chip grouping and filtering** — group by `family`, filter by `appliesTo`. Today `ChipRow`
  renders a flat wrap of 35 chips with no headers and no per-category filter, so a coat offers
  `pearl`, `enamel`, `horn` and `ceramic`, and `down` is buried mid-wall with nothing marking it
  as the value that decides warmth. The family ordering already exists in the array and is
  destroyed by the projection; this fixes the projection, not the vocabulary.
- **Consequence line** — rendered from §7.2.
- **Incompleteness warning** — rendered from §7.3's verdict, scoped to outerwear. Measured yield
  on the current wardrobe is small and specific rather than noisy, and it would have fired on the
  puffer in its pre-correction state.

## 8. Open ruling

Whether to revisit §6 and add a stored `fiber_content_completeness` column, once §7.4 has been
live long enough to measure whether the partial marker is emitted reliably. Deriving first is
reversible; storing first is not.
