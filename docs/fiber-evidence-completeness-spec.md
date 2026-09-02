# Spec — fiber evidence completeness and its canonical owner

**Status:** Proposed 2026-09-01, **amended the same day** after review. §6's derivation was
too strong and is corrected below; §8's condition is now answered by measurement rather than
left as a suspicion; two new required corrections (§9, §10) came out of that audit. Written in response to a review of the garment-editor
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
| `["unknown"]` | 23 | explicitly unresolved |
| resolved fibres **+** `"unknown"` | 10 | **partial — already being written** |
| resolved fibres only | 231 | presented as complete |
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

### 2.2 The puffer today, and a measurement error worth recording

After the care label was read, the owner corrected the piece by hand:

```text
996775  Black puffer coat   outerwear   heavy   fabric_category: synthetic
        fiber_content    : ["polyester","nylon","down"]
        manual_overrides : [... "fiber_content" ...]
```

It is the only piece in the wardrobe recording `down`, and it is now the sharpest illustration of
§6. This value is **genuinely complete** — transcribed from a photographed care label listing
shell, lining and fill — and it is **byte-identical in storage** to an unverified photo guess.
Nothing distinguishes the two. The owner has already done the work completeness requires, and
there is nowhere to record that they did it.

**Measurement error recorded, per the repo's habit of recording corrections rather than quietly
adjusting.** An intermediate version of this spec claimed no piece recorded `down` and that the
edit had not landed. That was wrong: `wardrobe.db` was copied without its `-wal` sidecar, so the
read returned a checkpoint several hours stale while the edit sat committed in the WAL. Three
existing scripts (`measure_freeform_turns.js`, `report_ai_spend.js`,
`report_freeform_threads.js`) already copy `-wal`/`-shm` alongside the main file;
[database-safety.md](database-safety.md) did not say to, and now does.
The distribution in §2 is measured WAL-inclusive.

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

## 6. The derivation contract (amended)

The review's correction is adopted, and it is the same error class as everything else in this
arc: **never manufacture a fact from the absence of a marker.**

The original §6 proposed `[...fibres] → complete`. The puffer disproves that inference directly —
`["polyester","nylon"]` was produced from a good photo and was incomplete. Absence of `"unknown"`
tells us the writer did not emit an uncertainty marker. It does not tell us the composition was
established. Deriving `complete` there would define the natural experiment out of existence and
recreate exactly the confidently-wrong state this spec exists to prevent.

The canonical reader in `styling-engine/attributes.js` therefore owns three states, none of which
asserts completeness:

```text
fiberContentEvidenceState(piece)

[]                              → unknown
["unknown"]                     → unknown
["cotton","unknown"]            → partial
["polyester","nylon"]           → resolved, completeness unknown
["polyester","nylon","down"]    → resolved, completeness unknown
```

**Derive incompleteness where the data proves it; do not derive completeness where it does not.**
Promotion of the third state to `complete` requires a separate source assertion, which the current
value list cannot encode by itself.

### 6.1 Still not a stored column — yet

The reasons for deriving rather than persisting the *first two* states stand: they are already
present in real data (§2), they need no migration or backfill, and a derived verdict cannot drift
from the list it describes. What §8 now settles is whether a *fourth* fact — "the composition was
actually checked" — has anywhere to live.

### 6.2 Adopted without change

The review's rejection of "apply the same treatment to every `GATE_CRITICAL_FIELDS` entry" is
adopted. That phrasing made an implementation bucket the owner of user-facing meaning and would
have turned the list into a second field-semantics registry. Correct form: **audit every
gate-critical field for missing user-consequence metadata; do not let the list own it.**

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

## 8. Can existing provenance express completeness? — measured: no

The review set the correct condition: *a stored completeness fact is required only if no existing
authoritative provenance mechanism can express that the composition was actually checked as
complete.* That is now audited rather than suspected.

**`manual_overrides` cannot express it.** It records that a human owns the current value, not that
they established every shell/lining/fill component. The wardrobe contains **4 direct
counterexamples** — pieces whose `fiber_content` is manually pinned *and* still partial
(`151 Apple skirt`, `202 pink tweed pointed heels`, `362 woven straw crossbody bag`,
`994060 multi-colored botanical scarf`). Each asserts human ownership of a value that openly
admits it is incomplete. A mechanism that is simultaneously true and uninformative about
completeness cannot be the completeness fact.

The puffer makes the same point from the opposite direction, and more forcefully. Its
`fiber_content` is manually pinned *and* genuinely complete, transcribed from a care label. Both
it and a photo-derived guess carry the identical `manual_overrides` entry. The flag is true in
both cases, so it separates nothing.

**Tagger confidence cannot express it.** Confidence is confidence in the emitted answer, not
completeness of inaccessible construction — the prompt itself says to emit medium/high "when
fiber, category, and drape agree", none of which can see a fill. And manual pinning sets
confidence to `manual` regardless — the same value for a label transcription and for an
unexamined photo read. The puffer's `style_profile_json` confidence map is in fact empty, so
there is not even a value to reinterpret.

**Conclusion:** neither mechanism answers "was the complete material composition established?", so
a small persisted completeness/source fact does earn its keep — reached from the semantic
requirement, as the review asked, not from backfill mechanics. Its shape is deliberately left
open here; it should be specified only alongside §7.4, since a completeness assertion with no
reliable writer is worth nothing.

The care label is the concrete case it must serve:

```text
SHELL:  100% polyester      ← a photo can see this
LINING: 100% polyester
FILL:   60% duck down       ← this decides the warmth, and only a label states it
```

## 9. Required correction — out-of-vocabulary is not unknown

Raised by the review and adopted as a separate required fix.
`normalizeFiberContent()` does `.map(v => VALID_FIBERS.has(v) ? v : 'unknown')`, collapsing
**invalid evidence into valid uncertainty**. The responsibility census requires hard invalidity and
unknown metadata to stay distinct:

```text
out-of-vocabulary fiber   ≠   unknown fiber
```

An unrecognised value should be rejected or flagged for review, not silently rewritten into an
honest-looking admission of uncertainty. This also removes the one case that muddied §6: a coerced
value currently lands in a list looking exactly like a deliberate partial marker.

## 10. Required correction — `fiber_content` has two write paths with different semantics

Found while auditing §8, and it undermines the `[] → unknown` half of §6 if left alone.

- **Tagger merge** goes through `normalizeFiberContent()`, which returns `["unknown"]` for empty
  input.
- **Manual edit** does not. `routes/crud.js` writes `fiber_content||'[]'` verbatim — in the same
  `UPDATE` statement where `fabric_category`, `formality`, `heel_height`, `walk_support`,
  `accessory_subtype`, `jewelry_type`, `necklace_length`, `bottom_subtype`, `outerwear_role` and
  `weather_protection` are all normalized. `fiber_content` is the omission.

So `[]` versus `["unknown"]` is decided by **which path last wrote the row**, not by anything
anyone knows about the garment. That is why the four `[]` pieces (§2) exist at all despite a
normalizer that should make the state unreachable. Both routes must share one normalizer before
any verdict is derived from the distinction between them.

## 11. Open ruling

The shape of the persisted completeness/source fact established as necessary in §8 — and whether
it is specified before or after §7.4's tagger change gives it a reliable writer.
