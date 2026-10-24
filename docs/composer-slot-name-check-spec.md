# Composer slots carry the garment's name, so a wrong ID is caught (spec, 2026-10-24)

**Status:** active. Owner approved this on 2026-10-24, and it amends the 2026-09-13 atomic-slot
ruling. Implemented with `docs/selected-piece-model-roster-spec.md`.

## 1 · The failure

Live thread `thread_1792867254713`, the first card turn on the black flare leg denim pants. Card 2,
"Artisan Gradient Layer", is the black turtleneck (144) with the anchor and black slip-on loafers,
plus a sweater in `middle_layer_id`.

**What the composer intended.** Every word of the card describes the gradient floral print
drop-shoulder cashmere sweater (996870):
- the label;
- `reason`: "The gradient print sweater…";
- `styling_instructions`: "Layer the gradient cashmere sweater…".

Her `layering_check` judged that sweater too: "the relaxed gradient cashmere sweater (id 996890)".

**What the card held.** `middle_layer_id` was 996890, the navy and cream striped knit sweater: the
next garment in the roster list, also a cashmere sweater.

**What the inputs showed.** The capture shows both garments' labels and photos were correctly paired
in the request. The model wrote the wrong ID.

**The owner's judgment.** The gradient sweater over the turtleneck makes sense. The delivered card,
two ordinary sweaters stacked, does not. So the wrong ID also defeated the layering check: her
physical judgment was about a garment that was not on the card.

**Why nothing caught it.** The 2026-09-13 ruling made the slots IDs only, so that "an ID and a name
cannot disagree". The flip side is that a wrong ID is undetectable: nothing on the card says which
garment the model meant.

## 2 · The change

**1. Names in the answer.** Each slot gets a `*_name` string written immediately before its `*_id`.
The prompt asks the model to copy the garment's name from its label. The name is evidence of
intent only:
- identity is still the ID;
- a name never selects, replaces or rescues a garment. The 2026-09-13 rule that "stale IDs are no
  longer rescued by name" stands.

**2. Check.** `resolveComposerSlotOutfit` compares each filled slot's stated name with the
recorded name of the garment its ID names. The comparison works on word sets: every word of the
stated name must appear in the recorded name.
- A shortened name passes: "gradient cashmere sweater" for the gradient sweater.
- A different garment's name fails: "gradient cashmere sweater" for the striped one.

A failure is the hard slot finding `slot_name_mismatch`. Its evidence carries the slot, the ID, both
names and, when the stated name fits exactly one other shown garment, that garment's ID. A slot
with an empty name is not checked.

**3. One correction call.** If any card in a composer answer has a name mismatch, the composer is
called once more:
- it gets the same request, plus its own previous answer and a note naming each mismatch;
- it is asked to return the same outfits with each slot's ID matching the garment it means, and to
  rebuild an outfit if the garment it described is not shown;
- the corrected answer replaces the original only if it parses.

Either way, a card that still mismatches becomes a Needs review card (the existing path for slot
findings). Debug records the mismatches, whether the correction ran, its usage, and how many
mismatches remained. This applies to both visual composers (selected-piece and Whole Wardrobe),
which share the schema and the resolver.

**4. Not done.**
- Code never swaps the ID for the one the name fits. That would be code choosing the garment.
- No other prose check is added.

## 3 · Tests (offline)

- Schema: each `*_name` sits directly before its `*_id`.
- Resolver: an exact name, a shortened name and an empty name pass; another garment's name is a
  hard `slot_name_mismatch` carrying the other garment's ID.
- Composer, stubbed:
  - the incident's card triggers exactly one correction call, and the corrected card ships;
  - an uncorrected card becomes Needs review;
  - a correction that fails to parse keeps the original answer;
  - a clean answer makes no extra call.
- `thread_1792867254713` replay: the captured composer output resolves to `slot_name_mismatch` on
  card 2 under the new resolver, with the name added as the model wrote it.
