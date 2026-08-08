# Seasonal capsules — current product and engine behaviour

Updated 2026-08-07 through PR #216. This is the canonical description of what the capsule feature
does now. The research and live-run documents remain useful provenance, but when an older finding
conflicts with this document, this document wins.

## Product contract

The product is the selected garment set. Outfit cards are representative evidence that the set can
serve the person's life; they are not the primary optimization target and their count does not
create garment quotas.

For a broad request such as “I want a summer capsule,” the conversational stylist first asks what
the season actually contains. The resulting lifestyle jobs—home, errands, city outings, nature
walks, restaurants, social events, or whatever the person states—drive selection. A season name by
itself does not mean hot weather, home-only dressing, dresses, or a fixed number of layers.

## Selection pipeline

1. Production turns the conversation into explicit use-case slots and a finite garment budget. An
   unnumbered seasonal capsule uses 24 pieces.
2. Deterministic gates form an eligible bench from active owned garments. Weather, occasion,
   activity, suppression, owner rules, garment dependencies, and register validity remain code
   constraints.
3. The roster model sees the eligible garment photos and chooses the finite roster. This path is on
   by default; `WARDROBE_MODEL_CAPSULE_ROSTER=false` disables it. The bench is capped at **70**
   pieces (ratified 2026-08-06).
4. Code validates IDs, budget, and real lifestyle/wearability coverage. The model gets one bounded
   repair attempt. If the only remaining defect after that repair is a duplicated ID, the engine
   keeps every unique model pick and fills the empty place itself (`model_repaired_locally`) rather
   than discarding the rest of the selection. If a hard defect remains, production uses the
   deterministic roster and discloses that fallback in plain language, without validator arithmetic
   or piece IDs.
5. The composition model builds a bounded representative rotation from the fixed roster. Code
   validates the submitted IDs and relationships; it may fill a missing structural piece from the
   same slot roster without another provider call.
6. The result renders the **whole roster** visually, not only the pieces an example card happened
   to use — the garment set is the product. The closing-response guard accepts any selected roster
   ID, so the stylist may discuss a piece no card demonstrated.

The comparison harness calls the same production roster chooser. It refuses a blind run when the
bench photos cannot be resolved, offers `--dry-run` before billing, supports one-scenario filters,
records both model attempts and repair reasoning, and writes visual sheets plus `comparison.json`.

## Category shape

For a 24-piece capsule the model receives this practitioner-informed starting shape:

| tops | bottoms | dresses | layers | shoes |
|---:|---:|---:|---:|---:|
| 8 | 7 | 3 | 2 | 4 |

It is guidance, not validity. The model is asked to report its counts and explain departures, and
that reasoning is kept for review — but since PR #215 it is **explanation, not validation**. Code
does not reject a roster because its self-reported counts, departure prose, or per-piece job list
are incomplete or inconsistent; the selected IDs are the roster, and the garment set itself is what
gets checked. A paid, structurally valid selection is never discarded over its own bookkeeping.
Code likewise does not reject a roster merely because it has fewer dresses, a different layer
count, or another category tradeoff that better serves the elicited life.

There is no universal hard requirement for:

- exactly two layers;
- at least one dress;
- a statement piece or loud print;
- fixed winter layer roles or a sleeve-covered-top ratio;
- duplicate casual or elevated shoes derived from the number of cards;
- one distinct outfit core for every representative card.

Hard checks remain for owned/eligible IDs, exact total budget, use-case coverability, genuine bases
for dependent garments, activity-specific footwear where the lifestyle needs it, the neutral/accent
palette boundary, and owner/weather/occasion/garment-validity rules.

## Palette contract

Every capsule receives an automatic neutral foundation. The working target is about 70% neutral or
neutral-adjacent pieces, with 60–75% accepted. The person does not need to name black, cream, olive,
navy, or other neutrals.

Colours named by the person are requested accent families for the remaining places. Free-text
shade names are mapped through the application's canonical colour taxonomy—for example, fuchsia
maps to the pink family. Display shades such as mustard and teal are not independent colour
families.

A requested colour can do any visual job: protagonist, support, grounding piece, print, dress,
layer, or shoe. It never has to be a hero piece. If the requested family has no season- and
lifestyle-eligible garment in the candidate bench, the capsule stays neutral instead of silently
substituting another accent, and the person is told which family was unavailable.

The original capsule request is retained when the next user turn merely answers the lifestyle
question, so a palette named on turn one cannot disappear before roster selection. Model and
deterministic-fallback rosters use the same palette boundary.

## Composition integrity

A dress is a complete core. A top may accompany it only when garment truth supports one of two
real relationships:

- the top is an overlay worn over the dress; or
- the top is a base layer worn under a compatible dress.

Both garments must also have been visually inspected. Merely placing a tank or blouse beside a
dress in `allowed_piece_ids` does not make it a layer. The validator rejects unexplained top+dress
IDs and prose that revises itself while leaving stale IDs behind. This rule came from the offline
replay of “White Tank + Black-Brown Lace Floral Dress”; explicit overlays and explicit under-dress
base layers remain valid.

## Evidence and user-facing claims

A selected garment absent from the representative cards means only “not demonstrated.” It does
not mean rejected, bad, or previously flagged. The closing response may claim a requested-colour
or wardrobe shortage only when a plan line explicitly reports insufficient eligible supply; it
cannot infer shortage from absence in the roster or cards.

## Current evidence

The corrected summer comparison used the real production lifestyle: Casual / Home / Errands,
Nature Walk, City Outing / Museum, and Restaurant / Social. In the latest accepted comparison the
model produced a valid 24-piece roster on its first call, matched the example 8/7/3/2/4 shape, and
showed stronger measured per-slot capacity than the deterministic roster. Visual judgment still
belongs to the owner; the harness exists to make that comparison inspectable, not to turn its
metrics into aesthetic truth.

That run is also the evidence that **closed the two long-open capsule questions**: it ratified the
bench width at 70 (it resolved all 70 bench photos and the model chose well from them), and it
closed Step 5 by acceptance on the model path. See `capsule-index-and-plan.md` §6a and §6b.

Offline coverage includes the production roster prompt wiring, category-departure behavior,
palette persistence and family fallback, the deterministic fallback's accent swap at the neutral
ceiling, duplicate-ID local recovery, the exact stale top/dress replay, explicit overlay and
base-layer cases, and final-response evidence boundaries.

## Related records

- [Capsule lifestyle contract](capsule-lifestyle-contract-2026-08-06.md): detailed session and
  requirement-correction record.
- [Real-world category research](capsule-real-world-rules.md): external formulas and the correction
  from universal rules to starting guidance.
- [Palette research and rulings](capsule-palette-rules.md): sources, taxonomy, neutral foundation,
  and the yellow-request live defect.
- [Step 5 evaluation](capsule-step5-evaluation.md): historical live-run findings. **Step 5 is
  closed (2026-08-06)**; this document is provenance, and its nine acceptance criteria are
  superseded where they ask for universal category floors.
- [Roster selection specification](capsule-roster-selection-spec.md): bench → model → validator
  architecture.
