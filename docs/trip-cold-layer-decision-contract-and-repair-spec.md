# Spec — a mandatory cold-layer decision contract, and one bounded repair pass for it

**Status:** Ratified 2026-09-06, ready to implement (both parts together). **Route:**
[docs/README.md](README.md). Extends the
`assigned_layer_piece_ids` relation from `1a506b6` ("Add a per-card assigned-layer relation for the
trip cold floor, separate from piece_ids", thread_1788508369689 arc). Does **not** replace or weaken
that arc's own ratified boundary — see §0.

## 0. What this spec explicitly does not reopen

`1a506b6` already ruled out roster-level suppression of `NO_WARM_LAYER_FOR_COLD` ("a coat packed for
one mountain day cannot retroactively warm an unrelated thin-blouse-and-skirt card") and chose a
card-scoped, model-committed relation instead. This spec keeps that architecture exactly as ratified
— the cold floor stays card-scoped, the model still owns which packed layer goes with which look, and
nothing here lets a card pass without a genuine, verified commitment to a real layer. This spec is
about *compliance*, not architecture: the model has the facts it needs and is not reliably acting on
them.

## 1. The problem, evidenced

Live thread `thread_1788667759424` (a real Vienna, VA trip, atomic composition path). Five of seven
submitted cards were rejected, every one for the identical reason:

```
sightseeing_days x2, museum_days, evening_dinners x2 — all: "no warm layer for cold weather"
```

Every rejected submission had `assigned_layer_piece_ids: []`. Traced and confirmed, not assumed:

- `cold_layer_required: true` reached the model for all three affected slots (computed directly
  from the real persisted `weatherProfile` for this thread).
- Genuine, gate-eligible packed layers were available in every case — `pieceOccasionCompatible`
  confirmed both the trench coat and the olive jacket pass the occasion gate for `city`,
  `gallery / art event`, and `smart casual` alike (only the UPF hoodie, correctly, does not).
- The instruction exists in **two** places the model reads: a detailed per-workbench-turn line
  (`outfitSetPlanner.js:4359`, "choose a packed layer... and name its ID in
  assigned_layer_piece_ids") and a shorter restatement in the composition system prompt
  ([routes/ai.js:4653](../routes/ai.js)) — the second sitting immediately before roughly four large,
  unrelated style-doctrine blocks in a ~16.7k-text-token call.

So this is confirmed as an output-contract compliance failure: the model had every fact and every
instruction it needed, twice, and simply never populated an optional array field, on any of the five
cards.

## 2. Non-goals

- **Not a change to what makes a card pass.** `NO_WARM_LAYER_FOR_COLD`'s actual criterion
  (`hasMinimumWarmLayer`, `outerwearLayerPositivelyInadequate`) is untouched. A card must still be
  genuinely warm; this spec only changes how the model is made to commit to that, and how one narrow
  failure class gets a second chance to commit correctly.
- **Not roster-level suppression.** §0.
- **Not the ordinary (non-atomic) tool-loop's existing resubmit behavior.** That path already allows
  the model to retry within the same turn after a rejection; this spec's Part B is specifically about
  the atomic composer, which has none.
- **Not deterministic auto-selection of a layer**, in either part. Part A asks the model a mandatory
  question; Part B gives it one narrow second chance to answer it. Neither part ever picks a piece on
  the model's behalf — that would blur exactly the line `1a506b6` drew (a card's warmth claim must be
  the model's own commitment, not an engine inference).
- **Not extending capsule's `completeSubmittedPlanOutfits` auto-completion to cover layers.** That
  mechanism (shoes/bottom/top only, `CAPSULE_GAP_GROUPS`) silently *picks* a replacement piece — the
  opposite of what this spec wants for a thermal claim specifically.

## 3. Part A — a mandatory cold-layer decision contract

### 3.1 The decision rule

Replace the optional `assigned_layer_piece_ids` array (on the outfit object, in **both** schemas
that carry it — `tripPlanCompositionSchema` in [routes/ai.js:4065](../routes/ai.js) for the atomic
path, and the ordinary `submit_plan_outfits` schema in
[tools.js:1151](../styling-engine/tools.js)) with a single, always-required object:

```js
cold_layer_decision: {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['core_is_warm_enough', 'assigned_packed_layer', 'not_required'],
      description: "core_is_warm_enough: piece_ids alone (its own outerwear piece, or a heavy-fabric top/dress as the main piece) is already warm enough for this slot's conditions. assigned_packed_layer: piece_ids is not warm enough on its own, and assigned_layer_piece_id names the packed roster layer worn WITH this look. not_required: this slot's cold_layer_required is false -- answer this for every outfit, even when it is."
    },
    assigned_layer_piece_id: {
      type: ['integer', 'null'],
      description: "The packed roster layer ID for mode 'assigned_packed_layer' only, chosen for fit with this specific outfit and its occasion/activity -- not part of the card's own visual identity, do not also put it in piece_ids. Must be null for every other mode."
    }
  },
  required: ['mode', 'assigned_layer_piece_id']
}
```

Enum-style, not a boolean/nullable-ID pair — a boolean plus a nullable ID permits logically incoherent
states (`core_is_warm_enough: true` with a non-null ID) that then need their own rejection path just to
name the incoherence. Three named modes make every valid state exactly representable and every
invalid state a schema-shape mismatch or a single pairing check, not a combinatorial one.

Always required, on every outfit, regardless of that slot's own `cold_layer_required` value — a
*conditionally*-required field asks the model to first judge whether the condition applies before
deciding whether to answer, which is exactly the extra reasoning step the live failure shows cannot
be relied on. Always asking removes that judgment call entirely: every outfit answers the same
question, and validation is what decides whether the answer mattered.

### 3.2 Mechanical validation (`validateSubmittedPlanOutfits`)

The claim is never trusted at face value — it is checked against the same facts the existing floor
already reads, and each mode has exactly one valid ID pairing:

```text
given: slot.cold_layer_required, outfit.cold_layer_decision, outfit's resolved core pieces

if !slot.cold_layer_required:
    mode must be 'not_required', assigned_layer_piece_id must be null -- reject otherwise
    (mirrors the existing "assigned_layer_piece_ids is only valid when cold_layer_required is true"
    rule, same message shape). Nothing else is checked -- irrelevant when no floor applies.

else (slot.cold_layer_required is true):
    mode 'not_required' is itself invalid here -- reject ("this slot requires a cold layer; mode
    cannot be not_required").

    mode 'core_is_warm_enough':
        assigned_layer_piece_id must be null -- reject otherwise ("mode is core_is_warm_enough but
        assigned_layer_piece_id is also set -- pick one")
        mechanically verify the claim: hasMinimumWarmLayer(corePieces) must actually be true.
        FALSE CLAIM -> reject with a distinct reason ("cold_layer_decision claims
        core_is_warm_enough, but piece_ids does not contain a qualifying layer or heavy-fabric main
        -- the claim is false"), not the generic NO_WARM_LAYER_FOR_COLD message, so a false claim
        and a simple omission are distinguishable in diagnostics -- and, per §4.3, both converge on
        the same Part B repair path once distinguished.

    mode 'assigned_packed_layer':
        assigned_layer_piece_id must be a real, non-null integer -- reject with today's exact
        "no warm layer for cold weather" message otherwise (this is the direct replacement for
        today's silent-omission case).
        Resolve it against the same gateAllowedIds already used for piece_ids (exactly "in the
        current packing roster AND eligible for this slot", unchanged) and the same
        outerwearLayerPositivelyInadequate check -- unchanged criteria, only the input field changed.
```

### 3.3 Preserving the downstream relation

Every consumer of the *result* of this decision — `accepted.assignedLayerIds`, `annotateTripOutfit`,
`tripPlanContext`, the diagnostic capture script, `test/tripPackingRoster.test.js`'s existing
assertions — keeps reading the exact same internal shape it does today (`assignedLayerIds: [id]` or
absent). `validateSubmittedPlanOutfits` translates `cold_layer_decision.assigned_layer_piece_id`
into that internal array shape at the point of validation; nothing downstream needs to change.

## 4. Part B — one narrow, bounded repair pass

### 4.1 The decision rule

The atomic composer is deliberately zero-repair today (`boundedComposition: true` — one call, one
validation pass, so a set-level rule can't silently drop an otherwise-valid card with no way to fix
it). That's correct for most failure classes. This one is mechanically distinctive enough to earn a
narrow exception:

```text
after the first validation pass:
    repairable = failures where:
        - the ONLY hard failure is a cold_layer_decision rejection from §3.2 -- EITHER shape:
            (a) mode 'assigned_packed_layer' with a missing/invalid ID (the omission case), OR
            (b) mode 'core_is_warm_enough' mechanically disproven (the false-claim case)
          both converge here once §3.2 has told them apart for diagnostics -- see §4.3.
          A card with any OTHER failure is excluded from this batch entirely, never repaired.
        - AND at least one gate-eligible, outerwearLayerPositivelyInadequate-clear packed layer
          exists in that slot's own allowed_piece_ids (reuse tripRosterFailures' own
          hasMinimumWarmLayer([piece]) check, per-piece, against the slot's gate-eligible set --
          if the roster genuinely has nothing that could ever satisfy this slot, repairing is
          pointless and the card stays a disclosed, honest failure)

    if repairable is empty: stop, exactly today's behavior.

    else: ONE additional, narrowly-scoped composition call --
        - contains ONLY the repairable cards, and for each: its ORIGINAL piece_ids/title UNCHANGED,
          its slot's cold_layer_required, and the specific gate-eligible qualifying layer candidates
        - explicit instruction: fix ONLY the cold_layer_decision for this exact card. Do not change
          piece_ids, title, reason, or styling_instructions unless choosing mode
          'core_is_warm_enough' genuinely requires a warmer core -- in that one case, and only that
          case, piece_ids may change; otherwise the card's own identity is carried through untouched.
          This is the guard against a repair meant to attach a trench instead silently restyling the
          whole look.
        - the model still makes the actual pick -- this call presents candidates, never inserts one
        - re-validate the repaired submissions through the SAME validateSubmittedPlanOutfits

    cards still failing after this one repair round are accepted as genuine, disclosed failures --
    no second repair round, matching this codebase's established "one repair attempt, then honest
    degradation" pattern (capsule roster selection, trip roster selection).
```

### 4.3 False claims and omissions converge on one recoverable path

`§3.2` deliberately gives a false `core_is_warm_enough` claim a different rejection message than a
missing `assigned_packed_layer` ID — that distinction is for diagnostics (a future trace should be
able to tell "the model lied" from "the model forgot" without re-deriving it from context). It is
NOT a distinction Part B's eligibility check makes: both are, structurally, "the model's stated
cold-layer decision for this card doesn't hold up," and both get exactly one shot at the same narrow
repair once diagnosed. A card is excluded from repair only for having a *different, unrelated*
failure alongside the cold-layer one — never for which of the two cold-layer failure shapes it hit.

### 4.4 Cost shape

A second provider call only fires when this exact, narrow condition is met — ideally rare once Part A
ships, since Part A should catch most of this before it ever reaches a rejection. The repair call's
payload is bounded to just the repairable cards and their slots, not a full-rotation resubmit, keeping
it small relative to the original composition call.

## 5. Worked cases

| Scenario | `mode` | `assigned_layer_piece_id` | Result |
|---|---|---|---|
| Cold slot, model correctly names the trench | `assigned_packed_layer` | `996759` (trench, gate-eligible) | accepted, `assignedLayerIds: [996759]` |
| Cold slot, model claims core is warm but it isn't | `core_is_warm_enough` | `null` | rejected — **false claim**, distinct message from plain omission; eligible for Part B repair (§4.3) |
| Cold slot, mode `assigned_packed_layer` but ID missing/invalid, roster has a qualifying layer | `assigned_packed_layer` | missing/invalid | first-pass rejection → Part B repair offers trench + jacket as candidates, original piece_ids carried through unchanged → model resubmits with a real pick |
| Cold slot, roster genuinely has no qualifying layer for this slot | any | any | **not** sent to repair — `cold_floor_infeasible` should already have caught this before composition; if it somehow reaches here anyway, stays a disclosed failure, not silently retried forever |
| Non-cold slot | must be `not_required` | must be `null` | any other mode, or a non-null ID, rejected the same way a stray `assigned_layer_piece_ids` is today |
| Cold slot, card fails for cold layer AND an unrelated reason (e.g. duplicate core) | any | any | **not** sent to repair — excluded from the batch entirely, stays a disclosed failure for both reasons |
| The exact live failure shape (5 of 7 cards fail the cold-layer decision, 2+ qualifying layers exist per slot) | — | — | **must not recur** — pinned directly as a test (§6) |

## 6. Tests

- Unit tests on `validateSubmittedPlanOutfits` for every row of §5's table, both schema paths
  (atomic composition and ordinary `submit_plan_outfits`).
- The false-claim case produces a distinguishable reason string from the plain-omission case (so a
  future trace can tell "the model lied" from "the model forgot" without re-deriving it).
- **The exact live failure shape, pinned directly**: a fixture reproducing `thread_1788667759424`'s
  shape — 3 non-hiking slots, `cold_layer_required: true`, a roster containing a UPF hoodie (fails
  `outerwearLayerPositivelyInadequate`) alongside a trench and a jacket (both pass it and the
  occasion gate) — with a mock composer that first omits a valid `cold_layer_decision` entirely for
  all three slots. Assert: first pass rejects all three; Part B's repair fires (not the "no
  repairable candidates" branch); a mock repair response naming the trench for each is accepted; the
  final accepted count is 3 of 3, not 0.
- **False-claim → repair convergence (§4.3)**: a card whose first-pass submission is
  `mode: 'core_is_warm_enough'` but mechanically disproven, with no other failure, must land in the
  same repairable batch as an omission failure — assert it appears in the repair call's payload and
  can be recovered by a corrected resubmission, exactly like the omission case.
- A repair-round mock that submits a *different*, unrelated failure (e.g., a duplicate-core
  violation) on one of the repairable cards: assert that card is excluded from the repair batch
  entirely and remains a disclosed failure, never silently merged into the cold-layer repair.
- A roster with **no** qualifying layer for a given slot: assert the card is never sent to repair
  (no wasted call) and remains a disclosed `NO_WARM_LAYER_FOR_COLD` failure.
- **The repair prompt carries the original core unchanged**: assert the repair call's payload for
  each repairable card states its original `piece_ids`/`title` verbatim, and includes the explicit
  "fix only the decision, don't restyle" instruction from §4.1 — not just that the model *could*
  infer this, but that the payload actually says so.
- Confirm the repair call, when it fires, never appears to have chosen a piece itself — assert the
  repair request payload states candidate IDs but the accepted outfit's `assignedLayerIds` always
  traces back to the mock model response, never a value synthesized by the repair-orchestration code.

## 7. Acceptance criterion

A trip whose roster genuinely contains a qualifying, gate-eligible warm layer for a cold slot does
not lose that slot's cards to a forgotten optional field — either because the mandatory decision
contract caught the omission before submission, or because the one bounded repair pass recovered it
afterward. A slot whose roster genuinely cannot satisfy the cold floor still fails honestly, with no
attempt to force a recovery that isn't there. Five cards silently disappearing because of an omitted
optional relation, as in `thread_1788667759424`, cannot recur undetected — the exact failure shape is
pinned as its own test.
