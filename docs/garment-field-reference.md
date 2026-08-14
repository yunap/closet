# Garment field reference

What every `pieces` field means, what values it accepts, whether AI tagging fills it in, and
where it's editable. Written 2026-08-14 alongside the sleeve/tuck/waistband/accessory-subtype
audit (see git log around that date for the fixes this reference documents).

**Colors are not covered here** — see [color-taxonomy-rules.md](color-taxonomy-rules.md) for the
color family/display-name model. Every other structured field lives below.

## How to read this

- **Applies to**: which `category` values the field is meaningful for. A field can be stored on
  any piece but is only shown/tagged/gated for its listed categories.
- **AI-tagged**: whether `tagPiecePromptTemplate` (the tagger prompt, `styling-engine/prompts.js`)
  actually asks the model to produce this value. A field can exist as a DB column and be manually
  editable without ever being tagged automatically — that combination is flagged under Notes.
- **Editable**: which of the two intake surfaces expose a control for it. `PieceForm` is the full
  edit-piece dialog; `BatchAdd` is the fast multi-photo intake review. They are not required to
  match — `PieceForm`'s "Stylist controls" section (curation fields like recommendation status)
  is edit-only by design, not a gap.
- **Source of truth**: where the valid-value enum is actually defined in code. When the tagger
  prompt, the DB validation (`taggerMerge.js`), and the UI constant list don't all agree, that's
  called out explicitly rather than silently picking one.

## How safe is it to extend an enum?

Always safe for existing data — the `pieces` table has no `CHECK` constraints, so a row's stored
value keeps working no matter what gets added or removed from a field's valid-value list later.
Extending an enum is purely additive to future writes.

The real risk is two different validation tiers silently disagreeing:

- **Loosely validated** fields (most of the ones below) have no `VALID_*` `Set` in
  `taggerMerge.js` — whatever the tagger or a manual edit sends is stored as-is. Extending these
  is simple: update the tagger prompt's enum text and the UI chip options in both `PieceForm.jsx`
  and `BatchAdd.jsx`. Worst case if you miss a spot: a gate that pattern-matches specific known
  strings just won't recognize the new value yet — silently ignored, not broken.
- **Strictly validated** fields (`formality`, `heel_height`, `walk_support`, `accessory_subtype`,
  `jewelry_type`, `necklace_length`, `bottom_subtype`) go through `normalizeEnumValue()` against a
  `VALID_*` `Set`.
  **Forgetting to update that Set means the new value gets silently nulled on every save** — AI-tagged
  or manual — even though it looks accepted in the tagger prompt and the UI dropdown. That's the
  failure mode to check for, not data corruption: a value that looks like it saved but quietly
  reverts to null.

## Structural fields

| Field | Applies to | Valid values | AI-tagged | Editable | Source of truth |
|---|---|---|---|---|---|
| `category` | all | `top \| bottom \| dress \| outerwear \| shoes \| accessory` | yes | PieceForm, BatchAdd | `prompts.js` schema |
| `bottom_subtype` | bottom | `pants \| shorts \| skirt \| culottes \| overalls \| other \| unknown` | yes | PieceForm, BatchAdd | `prompts.js` schema; validated in `taggerMerge.js`. Type only, deliberately no length baked in — see `bottomKind()` writeup below. Gate-critical for bottom (via `missingGateFields`). |
| `accessory_subtype` | accessory | `belt \| bag \| jewelry \| scarf \| hat \| watch \| gloves \| other` | yes | PieceForm, BatchAdd | `prompts.js` schema; validated in `taggerMerge.js` |
| `jewelry_type` | accessory (`accessory_subtype = jewelry` only) | `necklace \| earrings \| bracelet \| ring \| pin` | yes | PieceForm, BatchAdd | same. Named `jewelry_placement` at first ship; renamed same day — the values are jewelry types, not placements, and the name should say so. |
| `necklace_length` | accessory (`jewelry_type = necklace` only) | `choker \| short \| long` | yes | PieceForm, BatchAdd | `prompts.js` schema. How it sits/falls — the detail that matters for neckline pairing. Other jewelry types (pin lapel/chest/scarf position, etc.) don't have an equivalent field yet — deliberately scoped to necklace only for now. |
| `neckline` | top, dress | `V \| scoop \| crew \| boat \| mock \| turtleneck \| cowl \| off-shoulder \| square \| wrap \| halter \| strapless \| one-shoulder \| collared \| shawl \| other \| unknown` | yes | PieceForm, BatchAdd | `CONSTRUCTION_BY_CATEGORY.showNeckline` gates display. Extended 2026-08-14 — dropped the old `none` value per owner call (existing `none`-tagged pieces keep working, nothing validates this field against a Set — see "How safe is it to extend an enum" note below). `turtleneck` activates `necklineWarmth()` in `attributes.js`, which already had a dead `turtle` regex waiting for a real tagged value. |
| `sleeve_length` | top, dress, outerwear | `sleeveless \| cap \| short \| elbow \| 3/4 \| long \| extra_long \| unknown` | yes | PieceForm, BatchAdd | Split from `sleeve_type` 2026-08-14 — see split writeup below. Dress got sleeve UI at all for the first time earlier the same day (was tagged, never editable — [PieceForm.jsx:109](../src/components/PieceForm.jsx)). |
| `sleeve_shape` | top, dress, outerwear (hidden when `sleeve_length = sleeveless`) | `fitted \| straight \| relaxed \| puff \| bishop \| bell \| flutter \| raglan \| dolman \| other \| unknown` | yes | PieceForm, BatchAdd | Split from `sleeve_type` 2026-08-14; `raglan` added same day |
| `length_hits_at` | top, bottom, dress, outerwear, shoes | Genuinely per-category vocabulary as of 2026-08-14 — see "Category-conditional length_hits_at" writeup below for the full value lists and the bottom skirt-vs-pants split | yes | PieceForm, BatchAdd | `CONSTRUCTION_BY_CATEGORY[cat].lengthOptions` for top/dress/outerwear/shoes; `BOTTOM_SKIRT_LENGTH_OPTIONS`/`BOTTOM_PANTS_LENGTH_OPTIONS` (chosen by `bottom_subtype` at render time) for bottom |
| `silhouette` | all clothing + shoes | Per-category option list | yes | PieceForm, BatchAdd | `CONSTRUCTION_BY_CATEGORY[cat].silhouetteOptions` |
| `hem_finish` | top, bottom | `straight_loose \| banded_elastic \| ribbed \| design_hem` (top); different set for bottom | yes | PieceForm, BatchAdd | `CONSTRUCTION_BY_CATEGORY[cat].hemOptions` |
| `tuck_behavior` | top | `tucks_anywhere \| tucks_with_structure \| wear_over_only` | **yes as of 2026-08-14** (previously tagger only rated confidence on this field, never produced a value — see `_confidence` vs schema split in `prompts.js`) | PieceForm; **BatchAdd added 2026-08-14** (was DB+gate-wired but had zero UI anywhere before this pass) | `prompts.js` schema |
| `waistband_type` | bottom | `structured_high_waist \| structured_mid_waist \| soft_elastic_pull_on \| tight_no_room \| drawstring_relaxed` | **yes as of 2026-08-14** (same gap as tuck_behavior) | PieceForm; **BatchAdd added 2026-08-14** | `prompts.js` schema |
| `fit_on_body` | clothing | `clings_stretchy \| clings_drapey \| skims \| hangs_straight \| drapes \| structured \| none` | yes | PieceForm, BatchAdd (added 2026-08-14 — was tagged and DB-wired but had no BatchAdd control before this pass) | `prompts.js` schema |
| `heel_height` | shoes | `flat \| low \| mid \| high` | yes | PieceForm, BatchAdd | `HEEL_HEIGHT_OPTIONS`; gate-critical for shoes |
| `walk_support` | shoes | `high \| medium \| low` | yes | PieceForm, BatchAdd | `WALK_SUPPORT_OPTIONS`; gate-critical for shoes |

## Fabric / pattern / visual

| Field | Applies to | Valid values | AI-tagged | Editable | Source of truth |
|---|---|---|---|---|---|
| `fabric_category` | all | Long canonical list (jersey, knit, cotton, silk, leather, denim, … 30 values) | yes | PieceForm, BatchAdd | `FABRIC_BY_CATEGORY.default.fabricOptions`; shoes/accessory get a shorter material list |
| `fabric_weight` | all | `ultralight \| light \| medium \| heavy` for clothing; `delicate \| slim \| medium \| chunky` for shoes/accessory | yes | PieceForm, BatchAdd | gate-critical everywhere |
| `fiber_content` | all | Array from canonical fiber list (wool, cotton, silk, polyester, … `unknown`) | yes | PieceForm, BatchAdd | must align with `fabric_category` per tagger instructions; gate-critical |
| `stretch` | non-shoes/accessory | `none \| minimal \| stretchy` | not in tagger schema — **manual-only field**, no `applyTagValue` call anywhere | PieceForm, BatchAdd | inline literal in both forms |
| `opacity` | clothing (not shoes/accessory) | `opaque \| semi_sheer \| sheer \| open_weave` | yes | PieceForm, BatchAdd | `OPACITY_OPTIONS` |
| `needs_base` | clothing (not shoes/accessory) | `yes \| no \| null` (conservative default: null, not "no") | yes | PieceForm, BatchAdd | `NEEDS_BASE_OPTIONS` |
| `pattern_type` | all | `solid \| floral \| stripe \| botanical \| geometric \| abstract \| animal \| graphic \| plaid \| other` | yes | PieceForm, BatchAdd | `prompts.js` schema |
| `pattern_scale` | all | `none \| subtle \| medium \| bold` | yes | PieceForm, BatchAdd | same |
| `pattern_complexity` | all | `solid \| quiet \| medium \| loud` | yes | PieceForm, BatchAdd | same; `loud` is what the one-loud-print-per-outfit rule keys off |
| `reads_as` | all | Free text — "dominant visual impression"; overrides `colors` for style-read purposes | yes | PieceForm, BatchAdd | free text, no enum |
| `background_color` | all | Free text — literal base color | yes | PieceForm, BatchAdd | free text; distinct from `colors` array, see color-taxonomy doc |
| `formality` | all except accessory | `lounge \| everyday \| elevated \| dressy` | yes | PieceForm, BatchAdd | `FORMALITY_OPTIONS`; gate-critical |

## Curation fields (never AI-tagged — owner/edit-only)

These exist to let a person override or constrain auto-styling behavior. None appear in the
tagger schema; all live in `PieceForm`'s edit-only "Stylist controls" section, not in `BatchAdd`
(intentional — BatchAdd is fast triage, these are considered curation).

| Field | Valid values | Notes |
|---|---|---|
| `status` | `active \| needs-repair \| consider-donating \| donated` | |
| `recommendation_status` | `trusted \| experimental \| needs_fit_review \| avoid` | default `trusted` |
| `fit_confidence` | `unknown \| high \| medium \| low` | default `unknown` |
| `role_permission` | `auto \| focal_ok \| support_only \| only_when_requested \| never_auto` | default `auto` |
| `occasion_permissions` | multi-select from the `occasions` list | empty = any occasion allowed |
| `engine_notes` | free text | "private instructions for auto styling" |
| `occasions` (on the piece itself) | `casual, city, evening, smart-casual, outdoor, home` | UI constant matched the tagger enum as of 2026-08-14. Previously included `walking`, which no consumer ever read off a piece's `occasions` array (not even a substring match) — it was confusion with the separate per-request "activity" axis (`ACTIVITY_VALUES` in `stylingIntent.js`, drives footwear rules, not stored per-piece). Removed from both edit forms; not touched in the outfit-level occasion picker (`OutfitLookbook.jsx`) or the wardrobe browse filter (`PieceInventory.jsx`), which are legitimately separate, user-set fields unrelated to this gap. |
| `season` | `warm \| cool \| year-round` | AI-tagged |

## Nested: `style_profile_json`

Everything below lives inside the JSON blob, not as flat columns. All of it is tagger-populated
(`prompts.js` schema, `style_profile_json` block) and rendered read-only in PieceForm's "AI style
read" panel — none of it has manual edit controls beyond the confidence-pinning mechanism.

- `style_lanes` — object of 10 named lanes (`artistic_minimal`, `modern_bohemian`,
  `folk_artisan`, `boho_romantic`, `boho_festival`, `graphic_casual`, `earthy_structured`,
  `polished_classic`, `romantic_soft`, `workwear_utilitarian`) each scored 0+.
- `visual_roles` — 1-4 of: `hero_piece, support_piece, grounding_piece, sharpener_piece,
  texture_piece, movement_piece, column_piece, quiet_anchor, color_accent`.
- `coverage` — `normal | full-insulating`.
- `bareness` — `normal | high`. **Not read anywhere** — see `pieceBareness()` in
  `attributes.js`, which deliberately derives bareness from `sleeve_length`/`neckline`/
  `length_hits_at` instead, because this authored field was audit-found unreliable
  wardrobe-wide.
- `style_notes.best_use`, `style_notes.risk` — free text.
- `garment_intelligence.auto_use_trust` — `trusted | support_only | experimental |
  needs_fit_review | do_not_auto_use`.
- `garment_intelligence.best_outfit_role` — `hero | support | grounding | movement | sharpener |
  color_accent | texture_accent | column`.
- `garment_intelligence.pairing_requirements` — 0-4 free-text engine-facing requirements.
- `garment_intelligence.failure_risks` — 0-4 free-text physical/wear risks.
- `garment_intelligence.occasion_confidence` — per-occasion `low | medium | high` for the 6
  tagger occasions.
- `garment_intelligence.formula_compatibility` — 0-4 free-text outfit formulas.
- `garment_intelligence.real_wear_notes` — `fit`, `drape`, `scale`, `placement`, `maintenance`,
  all free text.
- `garment_intelligence.do_not_pair_rules` — 0-4 free-text rules. **Known gate gap**: the
  composer can see a piece's own `do_not_pair_rules` and still violate them — owner-ruled
  log-only, no enforcement fix scheduled (see prior audit notes).
- `_confidence` — per-field `high | medium | low | manual` confidence map. Drives the "AI unsure" /
  "review" badges in both forms. `CONFIDENCE_FIELDS` in `taggerMerge.js` is the whitelist of which
  top-level fields get a confidence entry at all — a field missing from that list can never show
  a confidence badge even if the tagger schema asks for it.

## Field splits: sleeve_type → sleeve_length + sleeve_shape (2026-08-14)

The old `sleeve_type` enum (`sleeveless|cap|short|3/4|long|bell|bishop|none`) conflated two axes:
most values are lengths, but `bell`/`bishop` are shapes with no length ever captured. Split into
`sleeve_length` and `sleeve_shape` (see rows above). The old `sleeve_type` DB column is **not
dropped** — this codebase's migrations are additive-only — and was one-time backfilled into the
new columns on server startup (`db.js`): clean length values map straight across, `bell`/`bishop`
map to `sleeve_shape` with `sleeve_length` left null (lossy by construction — that information was
never captured), and the old `none` sentinel maps to both fields null. Left-null pieces surface
through the normal missing-field review flow rather than being bulk re-tagged.

This also caught a real duplicate-schema drift: `routes/ai.js`'s `/extract-pieces` endpoint (the
"scan a whole outfit photo" flow in `OutfitLookbook.jsx`) hardcodes its own copy of the tagger
schema instead of importing from `prompts.js`, and had silently fallen behind on `neckline` and
the sleeve fields both. Synced as part of this pass, but **any future field change needs to touch
both schemas** — there is no single source of truth for the tagger enum. Worth unifying at some
point, not done here.

## New field: bottom_subtype, and the bottomKind() rewrite (2026-08-14)

Before this field existed, distinguishing a skirt from pants within the single `bottom` category
relied entirely on `bottomKind()` in `attributes.js` — a function whose primary signal,
`style_profile_json.bottom_kind`, **the tagger never actually populated** (not in the tagger
schema at all), so it always fell through to a name/`reads_as` regex, defaulting to `'pants'` if
nothing matched. `bottom_subtype` fixes the root cause: it's now in the tagger schema and validated
like `accessory_subtype`.

Deliberately **type-only** — no length baked in (unlike the old `style_profile_json.bottom_kind`
values, which mixed `skirt-mini|skirt-midi|skirt-maxi` into one axis). `bottomKind()` now derives
skirt length granularity by combining `bottom_subtype = 'skirt'` with the existing `length_hits_at`
value instead. The legacy `style_profile_json.bottom_kind` check and the name-regex fallback are
both kept, in that order, for pieces not yet tagged with `bottom_subtype` — nothing regresses for
untagged pieces, they just don't benefit from the fix until re-tagged.

This unblocked item 4 below — skirts and pants now do have different `length_hits_at` enums.

## Category-conditional length_hits_at (2026-08-14, coder-handoff item 4)

Previously one flat shared enum across every category. Now genuinely per-category, and per-
`bottom_subtype` for bottoms:

- **top**: `cropped | waist | high_hip | hip | low_hip | tunic | unknown`
- **outerwear**: `cropped | waist | high_hip | hip | low_hip | mid_thigh | knee | mid_calf | ankle | unknown`
- **dress**, or **bottom** when `bottom_subtype = skirt`: `mini | above_knee | knee | below_knee | midi | ankle | maxi | unknown`
- **bottom** when `bottom_subtype` is `pants | culottes | overalls | other`: `shorts | knee | mid_calf | ankle | full_length | floor_length | unknown`
- **shoes**: `low | below_ankle | ankle | high_top | mid_calf | knee | over_knee | unknown` — `low`
  replaces the old `open`/`closed` pair. Those were never actually reachable from the tagger (not
  in its schema) and duplicated the separate `shoe_coverage` field's job, so nothing of value was
  preserved by keeping them.
- **accessory**: not applicable, untouched.

Same column, values rewritten in place by a one-time `db.js` migration (idempotent — renamed
values never match an old-format key again). Clean 1:1 renames applied automatically (`crop` ->
`cropped`, `above-knee` -> `above_knee`, `mid-thigh` -> `mid_thigh`, `full-length` -> `full_length`,
etc.); anything with no unambiguous target in the new vocabulary was left null rather than guessed
— e.g. `mid-thigh` on a top (dropped for tops — not in the new list at all), `longline` on
outerwear (still expressible via `silhouette`), `above-knee`/`midi`/`maxi` on pants (those are now
skirt-only concepts). Bottom pieces needed `bottom_subtype` to know which vocabulary applied; where
it was still unset, the migration used the same name/`reads_as` regex `bottomKind()` already uses
as its own fallback, and backfilled `bottom_subtype` from that same guess while it was there.

Two regexes broke silently from this and needed fixing: `pieceBareness()` and `pieceCoverage()` in
`attributes.js` both used `\b`-anchored word matches (`mid-thigh`, `full`, `floor`) that assumed
hyphens. Underscore is a `\w` character, so `\bfull\b` never matches inside `full_length` — no
`\W` boundary exists at the underscore for `\b` to anchor on. Fixed to match the underscore-joined
forms explicitly. Worth remembering for any future field that moves to underscore_case: a
`\b`-anchored regex tuned for hyphenated values will silently stop matching, not error.

## Known drift / open items

- `stretch` has no tagger support at all — always manual.
- Full value-spelling parity check (tagger enum spelling vs. UI chip label vs. any literal-string
  gate match) has not been done field-by-field beyond what's noted above — flagged as future work,
  not verified clean.
- `shoes` and `accessory` fields beyond what's listed here (upper material detail, closure type,
  bag size/strap type) do not exist as structured fields yet — `notes`/`reads_as` free text is the
  only capture mechanism. Deliberately deferred: `accessory_subtype`/`jewelry_type` shipped
  as the minimal-viable slice; further subtype fields wait until real tagged data shows what's
  actually missing.
- `routes/ai.js`'s `/extract-pieces` schema still doesn't have `accessory_subtype`, `jewelry_type`,
  `necklace_length`, `tuck_behavior`, or `waistband_type` (only `neckline`, the sleeve split, and
  now the category-conditional `length_hits_at` — without `bottom_subtype`, since that endpoint
  doesn't tag it — got synced). Two independent tagger schemas remain a real drift risk; unifying
  them is worth doing at some point, not done here.
