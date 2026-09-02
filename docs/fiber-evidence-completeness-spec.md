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

## 4. The vocabulary had six copies, and one had already drifted — **RESOLVED 2026-09-01**

The first draft of this section said "four copies, and they currently agree." Both halves were
wrong. Implementing §7.1 found six:

| copy | location | state before |
|---|---|---|
| `FIBER_OPTIONS` | `src/components/PieceForm.jsx:52` | 35 values |
| `FIBER_OPTIONS` | `src/components/BatchAdd.jsx:28` | 35 values |
| inline enum text | `styling-engine/prompts.js:988` | 35 values |
| inline enum text | `routes/ai.js:1544` (the `/extract-pieces` duplicate) | 35 values |
| `VALID_FIBERS` | `styling-engine/taggerMerge.js:6` | 35 values |
| `FIBER_VALUES` | `styling-engine/attributes.js:6` | **22 values — 13 behind** |

The five live copies agreed. The sixth, `FIBER_VALUES`, was exported and **imported by nothing**,
and had silently fallen 13 values behind: no `hemp`, no `tweed`, and none of the eleven jewellery
materials. It drifted precisely because nothing consumed it, which is what an unowned vocabulary
looks like in the window *before* it causes a visible bug. Had any consumer been pointed at it —
the obvious thing for a future change to do, since it has the canonical-looking name — every
jewellery piece and every tweed garment would have failed validation into `"unknown"`.

So the drift risk was not hypothetical after all. It was already realised, in the one copy that
happened to be inert.

### 4.1 What replaced them

`styling-engine/fiberTaxonomy.js` — a dependency-free leaf module, extracted rather than added to
`attributes.js` because `attributes.js` imports `confidenceFromProfile` from `taggerMerge.js`, so
`taggerMerge` cannot import `attributes` back without a cycle. Same extraction, for the same
reason, as `thermal.js` earlier in this arc.

It owns the vocabulary as ordered **family blocks** (`plant_cellulose`, `filament_protein`,
`insulating`, `regenerated_cellulose`, `synthetic`, `constructed_textile`, `jewelry_material`,
`unresolved`). The two orderings in use turned out to be permutations of the same blocks, so
neither is hand-kept:

```text
FIBER_VALUES         insulating-first   → tagger prompt (both copies) + VALID_FIBERS
FIBER_OPTIONS_ORDER  plant-first        → both intake forms
```

`INSULATING_FIBERS` is now derived from `FIBER_FAMILIES.insulating` rather than maintained beside
it — "which fibres trap body heat" is the definition of that family, not a second list.
`FIBER_FAMILY_APPLICABILITY` is carried for §7.5's category filtering and is deliberately unread:
§7.1 is behaviour-preserving.

### 4.2 Evidence it changed nothing

- **`prompt_equivalence` passes.** It already checks `TAG_PIECE_PROMPT` byte-for-byte against a
  frozen pre-refactor fixture, so the tagger prompt is proven unchanged rather than assumed.
- The `routes/ai.js` copy is outside that fixture, so its rendered `fiber_content` line was
  compared byte-for-byte against the same line at `HEAD` — identical.
- **Full suite: 1738 tests, 2 failures — the same 2 that fail at `HEAD` (1736 tests).** Verified by
  running the suite in a detached worktree at `HEAD`, not by memory of which failures are known.
- Two tests added: one asserting no consumer re-lists the vocabulary, one pinning both orderings
  and the insulating family to the literals that shipped. `test/batchAdd.test.js`'s existing
  source-text assertion changed from "a local array exists" to "it derives from the canonical
  order" — the assertion it should always have been.

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

### 7.1 Canonical fibre vocabulary — **DONE**, see §4.1

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

## 10. One normalizer, both write paths as adapters — **DONE 2026-09-01**

Found while auditing §8. `fiber_content` had two write paths with different semantics:

- **Tagger merge** went through `normalizeFiberContent()`, which returned `["unknown"]` for empty
  input and rewrote any unrecognised token to `"unknown"`.
- **Manual edit** went through neither. `routes/crud.js` wrote `fiber_content||'[]'` verbatim — the
  one omission in an `UPDATE` that already normalized `fabric_category`, `formality`,
  `heel_height`, `walk_support`, `accessory_subtype`, `jewelry_type`, `necklace_length`,
  `bottom_subtype`, `outerwear_role` and `weather_protection` beside it.

So `[]` versus `["unknown"]` recorded **which code last wrote the row**, not anything about the
garment — which is why the four `[]` pieces in §2 exist despite a normalizer that should make the
state unreachable.

### 10.1 The contract

`fiberContentNormalization(input) → { values, invalid }` lives in `fiberTaxonomy.js`, with the
taxonomy and field semantics. `routes/crud.js` and `taggerMerge.js` are adapters that call it;
neither owns write semantics any more. `normalizeFiberContent()` remains as a thin wrapper so
existing importers are unaffected.

| rule | behaviour |
|---|---|
| empty / missing / non-array | `[]` on **both** paths |
| out-of-vocabulary token | dropped from `values`, returned in `invalid` — **never** `"unknown"` |
| `"unknown"` beside resolved fibres | preserved; it is the partial-evidence marker |
| duplicates, casing, whitespace | deduped, folded, trimmed |
| ordering | canonical taxonomy order, so `["down","polyester"]` and `["polyester","down"]` store identically |
| synonyms | `lyocell → tencel`, remapped before validation |
| completeness / warmth | **not inferred here.** That is §5's verdict layer; putting it in the write path is what §5 exists to prevent |

### 10.2 Why empty normalizes to `[]` rather than `["unknown"]`

`["unknown"]` is an *assertion* that someone looked and could not tell. Nothing about an empty
input supports making that claim on the writer's behalf — the same "do not manufacture a fact"
rule §6 turns on.

It also matters operationally, which decided it: **`isPopulated(["unknown"])` is `true`**, and
`fiber_content` is gate-critical. The old tagger-side default therefore suppressed this field's own
review chip — a piece with no fibre evidence looked populated and never surfaced for attention.
`normalizeWeatherProtection()` already documents the same choice for the same reason.

This is the one deliberate behaviour change in §10. It applies to future writes only; the 23
existing `["unknown"]` rows are untouched, since normalization runs on write.

### 10.3 Invalid tokens are surfaced, not just returned

Returning `invalid` and reading it nowhere would be the `[R1]` shape this arc keeps fixing, so it
has a consumer. `queueFiberTaxonomyReviews()` in `lib/colorTaxonomyReview.js` files a
`retag-suggestion` todo against the piece, reusing the identical mechanism and todo shape that
already handles unsupported colours — *"unsupported material 'x'. It was not added to the
garment."* Wired into both `routes/crud.js` write sites.

The tagger's own path is wired too, and it is the likelier source of an invented material.
`tagPieceWithProvider()` drops the invalid token and returns it as `tags.fiber_taxonomy_gaps`,
exactly mirroring `sanitizeTaggerColors`'s `color_taxonomy_gaps`. Two routes consume it:

- **Retag an existing piece** — `routes/ai.js` queues immediately, beside the colour queue; it has
  both `db` and the piece id.
- **Tag a new piece** — there is no piece yet, so the gap rides out in the tag response, both
  intake forms forward it on save, and `routes/crud.js` queues it together with anything it
  detected itself. Without that hop the evidence would vanish silently: the invalid material is
  already gone from `fiber_content` before the form ever posts, so the piece would be created
  cleanly and nobody would learn the tagger invented a material.

`tagPieceWithProvider()` stays free of `db` — it reports, the routes write. #3 is closed.

### 10.4 Evidence

Full suite **1745 tests, 2 failures — the same 2 that fail at `HEAD`**. Seven tests added:

- `test/fiberTaxonomy.test.js` (new) — the case table, including a direct assertion that the
  manual-edit and tagger-merge paths agree for every input that used to diverge.
- `test/crudEndpoints.test.js` — end-to-end through the real route: canonical ordering, the review
  todo actually being filed, `[]` surviving as `[]`, and partial evidence surviving a round trip.
- `test/taggerMerge.test.js` — an existing assertion **corrected**. It expected
  `['wool', 'unknown', 'linen']` from a submission containing `'mystery fiber'`, encoding the
  collapse of invalid evidence into valid uncertainty as intended behaviour.

## 11. The completeness fact — **DONE 2026-09-01**, owner ruling applied

Ruled: persist it, do not derive `complete` from the absence of a marker.

```text
fiber_content               what materials are recorded
fiber_content_completeness  whether that composition is complete
manual_overrides/confidence who/what owns the value
```

### 11.1 Semantics

```text
unknown   completeness was never established
partial   explicitly KNOWN incomplete
complete  explicitly VERIFIED complete
```

The distinction that makes this durable, per the ruling: **`partial` is not "contains some
values."** A list with fibres in it says nothing about whether more exist; where the writer does
not know, the honest state is `unknown`. So nothing sets `partial` merely because fibres are
present.

### 11.2 Writer rules

| writer | may write |
|---|---|
| photo/tagger inference | `unknown`, `partial` |
| manual edit / care-label transcription | `unknown`, `partial`, `complete` |

A tagger proposing `complete` is downgraded to **`unknown`**, not `partial` — proposing
completeness is not evidence of incompleteness either. Enforced at the boundary in
`normalizeFiberCompleteness(value, { source })`, and guarded in `applyTaggerResult` even though the
tagger does not emit the field today, so the rule holds at the moment one is added rather than
being remembered later. A manual assertion is protected from retagging by the existing
`manual_overrides` machinery — verified, not assumed — rather than by a second mechanism here.

### 11.3 Legacy seeding

Legacy rows start at `unknown`. The single exception is rows carrying **explicit existing
evidence** of incompleteness: an `"unknown"` sitting *alongside* resolved fibres is the writer
stating "plus something I could not identify" — a statement, not an absence. A bare `["unknown"]`
is not, since it says nothing was resolved.

Verified against a WAL-inclusive copy of the live DB: **10 seeded `partial`** — exactly the ten
rows §2 identified — and **258 `unknown`**. The puffer seeds `unknown`: its composition happens to
be complete, but nobody has yet *asserted* that, and the seed's job is to record what was
established, not what is true.

### 11.4 The editor control

Asked in the owner's terms, not the internal vocabulary:

```text
Is this the complete material composition?     [ Yes ]  [ Not sure ]
```

`Yes → complete`. `Not sure` **preserves an existing `partial`** and otherwise writes `unknown` —
`partial` is the stronger statement, and answering this control should never quietly discard it.

### 11.5 Evidence

Full suite **1749 tests, 2 failures — the same 2 that fail at `HEAD`**. Tests cover the writer
rules, the round trip through the real route, rejection of out-of-enum values, and the case that
motivated the whole thing: two pieces with byte-identical `fiber_content`, one asserting
`complete` and one left `unknown`, with completeness the only thing separating them.

### 11.6 Tagger emission of `partial` — **DONE 2026-09-01**

Ruled in: the tagger gains a new **factual output**, known-incomplete fibre composition. It still
cannot assert completeness. Without this the system could represent `partial` while the main
automated intake path was unable to populate it, even where the photo itself establishes
incompleteness.

The puffer is that case exactly. A photograph can establish that a baffled, filled construction
exists and that the fill's composition is not identifiable — which is all `partial` claims. The
model is never asked what the fill *is*.

The schema contract is deliberately narrow:

> `"partial|unknown"` — use `partial` **only** when the image gives positive evidence that
> additional material components exist whose composition cannot be identified: visible lining,
> padding, quilting or baffles, fill, or clearly distinct unidentified material panels. Otherwise
> `unknown`. Never emit `complete`. Do not use `partial` merely because you are unsure, and do not
> assume it by category.

The last sentence is load-bearing. "Use partial when unsure" or "for coats, assume partial" would
collapse `partial` back into `unknown` and undo §11.1. A test asserts that wording survives.

`'complete'` is not in the tagger's permitted vocabulary, and `normalizeFiberCompleteness()`
downgrades it at the boundary if one is emitted anyway — belt and braces, since the prompt is the
weaker of the two guarantees.

**The snapshot was updated deliberately, not re-frozen.** `test/prompt_equivalence.test.js` already
carries dated accepted deltas for exactly this purpose, and this change was recorded the same way,
leaving `prompts_yuna_snapshot.json` untouched as a byte-level ratchet. Recorded as: *the tagger
gains a new factual output — known-incomplete fibre composition; it still cannot assert
completeness.*

### 11.7 What is NOT verified

The four fixtures are asserted at the layer this repo can decide: the **disposition** of whatever
the tagger emits. Whether the model actually returns `partial` for a quilted coat and `unknown` for
a plain tee is model behaviour, and confirming it needs one real, billed tagging run against those
photos. It is not asserted, and the test says so in place rather than letting a green suite imply
it. Recommend re-tagging the puffer as the single-piece check when that spend is worth it.

## 12. Remaining

- **The verdict layer (§5).** `fiberEvidenceCompleteness(piece)` now has a real fact to read
  instead of inferring one. Its thermal consumer is the point of the exercise: a `complete` "no
  insulating fibres" is evidence, an `unknown` one is not. Acceptance criterion 8 still binds —
  neither may become hard invalidity.
- ~~**Tagger emission of `partial`.**~~ **DONE 2026-09-01** — see §11.6.
- **UI projections (§7.5).** Family grouping, category filtering, consequence copy, and the
  incompleteness warning — now driveable from the shared verdict rather than editor-local rules.
