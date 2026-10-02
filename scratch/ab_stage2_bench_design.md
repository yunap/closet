# Stage 2 — component isolation on a fixed photographic bench (design only; runs only if Stage 1 shows a difference)

Question: does mandatory complete-system deliberation (2–3 complete candidate systems, then a choice)
cause the difference, versus flat workbench selection? Everything else is held identical.

## Bench (fixed; confirm each photograph before any live run)

| Role | Pieces (id — name — warmth) |
|---|---|
| Bases | #1 Whale stripe tee — moderate · #133 navy cream striped button-up — moderate · #84 mustard knit sweater — moderate · one everyday light base, to be chosen by photo |
| Bottoms | #107 dark blue slim straight jeans — moderate · #89 Gray straight trousers — moderate · #127 beige cotton relaxed capris — light |
| Shoes | #214 black canvas sneakers — support high · #215 cream textured slip-on shoes — high · #191 brown leather zip ankle boots — medium |
| Light layers | #159 gray jacket · #996759 cream trench coat with belt |
| Moderate layers | #157 dark grey knit draped cardigan · #996760 cream and taupe plaid fleece coat |
| Warm layers | #996866 navy quilted puffer jacket with ribbed side panels · #996867 black double-breasted funnel neck wool coat |

16 pieces. Shared payload for both arms: identical system text (style constitution, structure rule, slot
contract), identical conditions block, every bench piece as one `singleOutfitStylistCatalogLine` plus its
photograph, in id order. No ordering heading, tier, or ranking.

## The only differing bytes

Slot object (both arms): `{ label: string, base_top_id|bottom_id|dress_id|middle_layer_id|outer_layer_id|shoes_id: integer|null, reason: string }`, all required.

### Turn 1 — draft

Flat arm task text:
> Look at every garment on this bench and choose the pieces for one complete outfit for these conditions.

Flat arm schema: `{ system: <slot object> }`

Deliberation arm task text:
> Look at every garment on this bench and write 2–3 genuinely different complete outfits for these conditions. Each must be complete on its own.

Deliberation arm schema: `{ systems: <slot object>[] (minItems 2, maxItems 3) }`

### Evidence (identical format in both arms; raw evaluator values only)

For each drafted system, computed by `evaluateWearableOutfit` on the bench pieces:
```
System <n>
- Cold end target: <level>
- Completed system, every layer on: <level>
- Ordinal distance: <signed integer>
- Warm end target: <level>
- Completed system, best configuration for the warm end: <level>
- Ordinal distance: <signed integer>
- Construction findings: <code: message; …> | none
```
No `preferred`, `discouraged`, `acceptable`, "on target", "fits", or an engine-selected system.

### Turn 2 — final

Flat arm task text:
> Here is the evaluator's evidence for your outfit. Keep it or change pieces from the bench, and return the final outfit.

Flat arm task text continues:
> If your final outfit's cold-end ordinal distance is not 0, state the visual or operational tradeoff that justifies it.

Flat arm schema: `{ system: <slot object>, changed: boolean, change_reason: string, tradeoff: string|null }`
Local check (both arms, owner ruling): final cold-end distance ≠ 0 and empty `tradeoff` → finding `missing_tradeoff` (recorded, card kept).

Deliberation arm task text:
> Here is the evaluator's evidence for each of your outfits. Choose one; you may change individual pieces from the bench. If the outfit you choose has a cold-end ordinal distance other than 0, state the visual or operational tradeoff that justifies it.

Deliberation arm schema: `{ chosen_index: integer, system: <slot object>, tradeoff: string|null }`
Local check: identical to the flat arm — final cold-end distance ≠ 0 and empty `tradeoff` → `missing_tradeoff` (recorded, card kept). Both arms carry the same off-target obligation, so a difference cannot come from one arm being asked to justify itself and the other not.

## Cost

About 16 × 1,080 image tokens + ~8k text ≈ 25k input per turn, two turns, ~1k output → ≈ $0.02 per run
on gemini-3.5-flash-lite. One run per arm × scenario = 6 runs ≈ $0.11.
