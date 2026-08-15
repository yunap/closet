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
| `silhouette` | top, bottom, dress, outerwear (**not shoes** — see `shoe_type`/`toe_shape`) | **top**: `fitted \| slim \| straight \| relaxed \| boxy \| drop-shoulder \| oversized \| peplum \| wrap` — **bottom, `bottom_subtype = skirt`**: `a_line \| pencil \| full \| slip \| straight \| pleated \| wrap` — **bottom, `bottom_subtype` pants/culottes/overalls/other**: `straight \| wide \| bootcut \| flare \| tapered \| barrel \| relaxed` — **dress**: `fitted \| sheath \| shift \| A-line \| wrap \| slip \| column \| fit-and-flare \| empire \| relaxed` — **outerwear**: `fitted \| straight \| boxy \| relaxed \| oversized \| structured` | yes, category- and `bottom_subtype`-conditional in `prompts.js` as of 2026-08-14 | PieceForm, BatchAdd | `CONSTRUCTION_BY_CATEGORY[cat].silhouetteOptions` for top/dress/outerwear; `BOTTOM_SKIRT_SILHOUETTE_OPTIONS`/`BOTTOM_PANTS_SILHOUETTE_OPTIONS` (chosen by `bottom_subtype` at render time) for bottom. **Rewritten 2026-08-14** to close the tagger/UI mismatch noted below — top gained `straight`; bottom's `structured` was dropped (meaningless for either skirts or pants; use `fit_on_body = structured` instead) and the field became `bottom_subtype`-conditional; dress gained `empire`; outerwear dropped `cropped` (opportunistically preserved into that piece's `length_hits_at` by the migration if unset) and `longline` (no unambiguous target — outerwear length concepts now live entirely in `length_hits_at`, see below) and gained `straight`. Shoes lost generic `silhouette` entirely — see `shoe_type`/`toe_shape`. |
| `shoe_type` | shoes | `mule \| loafer \| boot \| sandal \| pump \| flat \| sneaker \| other \| unknown` | yes | PieceForm, BatchAdd | `SHOE_TYPE_OPTIONS`; gate-critical for shoes (`missingGateFields`). New 2026-08-14, replacing shoes' slice of the old generic `silhouette` enum (`mule\|loafer\|boot\|sandal\|heel\|flat\|sneaker`). Deliberately never uses `heel` — `heel_height` already represents heel height, so a `heel` shoe type would just duplicate that axis without saying what kind of shoe it is. One-time migration mapped recognizable old `silhouette` words (`loafer`, `boot`, etc.) across; this sandbox's real shoe data had generic-fit words instead (`slim`/`fitted`/`relaxed` — leftover from before shoes had their own silhouette vocabulary at all), so those backfilled to null and surface via the normal missing-field review chip rather than being guessed. |
| `toe_shape` | shoes | `pointed \| almond \| round \| square \| open_toe \| other \| unknown` | yes | PieceForm, BatchAdd | `TOE_SHAPE_OPTIONS`. New 2026-08-14, replacing shoes' other slice of the old generic `silhouette` enum (`pointed\|almond\|round\|square\|open-toe`). Same backfill-or-null migration behavior as `shoe_type`. |
| `hem_finish` | top, bottom | **top**: `straight_loose \| banded_elastic \| ribbed \| curved \| shirttail \| high_low \| asymmetric \| other` — **bottom**: `straight_loose \| cuffed \| raw \| tapered \| banded_elastic \| slit \| asymmetric \| other` | yes, category-conditional in `prompts.js` as of 2026-08-14 | PieceForm, BatchAdd | `CONSTRUCTION_BY_CATEGORY[cat].hemOptions`. Stored values are unchanged for the fields both categories already had (`straight_loose`, `banded_elastic`, `raw`, etc.) — only PieceForm's display **labels** got friendlier text for a few (e.g. bottom's `straight_loose` chip reads "straight/open", `raw` reads "raw/frayed", `banded_elastic` reads "elastic/banded"); do not confuse the label with the stored value when grepping for a value elsewhere. **Rewritten 2026-08-14** to close the tagger/UI mismatch noted below: top gained `curved`, `shirttail`, `high_low`, and `asymmetric`, dropped the catch-all `design_hem`; bottom's `asymmetrical` was renamed to `asymmetric` (matching top) and `design_hem` was dropped, `other` added. **Only `straight_loose` and `banded_elastic` are tuckable, in either category** — every other value, including `shirttail`, is a wear-over/no-tuck hem. This was a real correction: shirttail hems (the curved, longer-in-back style typically worn untucked with the tails hanging free) were initially assumed tuckable and are not — confirmed against a photo. See `computeTuckNote()` in `wardrobeAiContext.js`, which now checks hem_finish against exactly those two tuckable values instead of the old `ribbed`/`design_hem` no-tuck check. |
| `tuck_behavior` | top | `tucks_anywhere \| tucks_with_structure \| wear_over_only` | **yes as of 2026-08-14** (previously tagger only rated confidence on this field, never produced a value — see `_confidence` vs schema split in `prompts.js`) | PieceForm; **BatchAdd added 2026-08-14** (was DB+gate-wired but had zero UI anywhere before this pass) | `prompts.js` schema |
| `waistband_type` | bottom | `structured_high_waist \| structured_mid_waist \| structured_low_waist \| soft_elastic_pull_on \| tight_no_room \| drawstring_relaxed` | **yes as of 2026-08-14** (same gap as tuck_behavior; `structured_low_waist` added same pass) | PieceForm; **BatchAdd added 2026-08-14** | `prompts.js` schema. `structured_low_waist` receives tuck the same way the other structured waistbands do — see `computeWaistbandNote()` in `wardrobeAiContext.js`. |
| `fit_on_body` | clothing | `clings_stretchy \| clings_drapey \| skims \| hangs_straight \| drapes \| structured \| none` | yes | PieceForm, BatchAdd (added 2026-08-14 — was tagged and DB-wired but had no BatchAdd control before this pass) | `prompts.js` schema |
| `heel_height` | shoes | `flat \| low \| mid \| high` | yes | PieceForm, BatchAdd | `HEEL_HEIGHT_OPTIONS`; gate-critical for shoes |
| `walk_support` | shoes | `high \| medium \| low` | yes | PieceForm, BatchAdd | `WALK_SUPPORT_OPTIONS`; gate-critical for shoes |

## Fabric / pattern / visual

| Field | Applies to | Valid values | AI-tagged | Editable | Source of truth |
|---|---|---|---|---|---|
| `fabric_category` | all | **top/bottom/dress/outerwear**: `jersey \| knit \| rib knit \| ponte \| sweatshirt fleece \| fleece \| cotton \| poplin \| linen \| linen blend \| rayon \| viscose \| modal \| silk \| satin \| crepe \| chiffon \| organza \| lace \| crochet \| jacquard \| wool \| cashmere \| boucle \| denim \| twill \| canvas \| corduroy \| tweed \| velvet \| leather \| faux leather \| suede \| faux suede \| mesh \| technical/performance \| synthetic \| other` (38 values) — **shoes**: `leather \| suede \| nubuck \| patent \| canvas \| mesh \| woven \| synthetic \| textile \| rubber \| other` — **accessory**: `leather \| suede \| metal \| stone \| straw \| canvas \| synthetic \| textile \| rubber \| wood \| ceramic \| glass \| horn \| shell \| resin \| other` | yes, category-conditional in `prompts.js` as of 2026-08-14 | PieceForm, BatchAdd | `FABRIC_BY_CATEGORY[cat].fabricOptions`. **Rewritten 2026-08-14** to close the tagger/UI mismatch previously documented here (the tagger used one flat 35-value clothing enum for every category, so it could never correctly tag a shoe's `nubuck` or an accessory's `wood`/`ceramic`/`glass`) — now category-conditional in both `prompts.js` and the `/extract-pieces` duplicate in `routes/ai.js`. Clothing gained `jacquard`/`organza`/`boucle`; shoes gained `nubuck`/`woven` (`woven` is the catch-all for raffia/straw/other woven shoe materials, not a separate value per material); accessory gained `wood`/`ceramic`/`glass`, then `stone` in a same-day follow-up once jewelry review surfaced gemstone/pearl/crystal pieces had nowhere to go either, then `horn`/`shell`/`resin` after a live tagging test on a belt returned "horn-look buckle" in `reads_as`/`notes` with no structured value to match. **Single-select, and now says so**: for shoes/accessory this field is labeled "Primary Material" (not just "Material") with a hint pointing at `fiber_content` for composite pieces — a metal-and-stone earring previously looked like it could only be tagged as one or the other, since `fabric_category` is a single value by design (one primary material) while `fiber_content`/Material Properties is the multi-select field meant to capture a composite. |
| `fabric_weight` | top, bottom, dress, outerwear (**not shoes/accessory** — see `visual_weight`) | `ultralight \| light \| medium \| heavy` | yes | PieceForm, BatchAdd | gate-critical. **Narrowed to clothing-only 2026-08-14** — see `visual_weight` below for the split. |
| `visual_weight` | shoes, accessory | `delicate \| slim \| medium \| chunky` | yes | PieceForm, BatchAdd | `VISUAL_WEIGHT_OPTIONS`/`FABRIC_BY_CATEGORY[cat].weightOptions`; gate-critical for shoes/accessory (`missingGateFields`). **New 2026-08-14**, splitting a real concept out of `fabric_weight`: shoes/accessory were already using the `delicate/slim/medium/chunky` scale under a UI label that said "Visual weight" while writing to the same `fabric_weight` column clothing uses for `ultralight/light/medium/heavy` — the label was correct, the backing field wasn't. One-time migration backfilled existing shoe/accessory `fabric_weight` values into this new column (`fabric_weight` itself is kept, not dropped, and is simply no longer read for these categories going forward). Redirected consumers: `missingGateFields`, `pieceTextBlob`, `structuredPieceSignalTokens`, the whole-wardrobe piece descriptor, the capsule-planner compact descriptor, `search_wardrobe`'s relevance scorer and structured output, and both `buildWardrobePieceTruthText`/`buildWardrobeManifestLine` in `wardrobeAiContext.js`. **Deliberately scoped to shoes/accessory as a whole for this pass** — scarves and hats arguably belong on the clothing scale instead (real warmth/drape relevance, unlike bags/belts/jewelry/watches), but that's an `accessory_subtype`-conditional refinement left for a follow-up, not implemented here. |
| `fiber_content` | all | Array from: `cotton \| linen \| hemp \| silk \| wool \| merino \| cashmere \| alpaca \| mohair \| fleece \| down \| tencel \| modal \| rayon \| viscose \| polyester \| nylon \| acrylic \| spandex \| leather \| suede \| denim \| metal \| stone \| wood \| ceramic \| glass \| horn \| shell \| resin \| unknown` (30 values, one flat list for every category) | yes | PieceForm, BatchAdd | `FIBER_OPTIONS`. Must include the primary fiber implied by `fabric_category` per tagger instructions (e.g. `fabric_category: silk` → `fiber_content` must include `silk`); gate-critical. `hemp` added 2026-08-14. **`lyocell` is not a separate value** — normalized to `tencel` (both the tagger prompt and `normalizeFiberContent()` in `taggerMerge.js` treat them as one stored concept; lyocell is the generic fiber name, Tencel its branded form). **`nubuck` wet-sensitivity**: `pieceHasWetSensitiveFootwearMaterial()` now also excludes `nubuck` shoes from wet-exposure requests, alongside the existing `suede`/`canvas` — read off `fabric_category`, not `fiber_content`, since that function already merges both fields. **`metal`/`stone`/`wood`/`ceramic`/`glass` added same day, in response to reviewing this exact table**: none of the original 22 fibers fit a jewelry/accessory piece, so `fiber_content` silently collapsed to `unknown` for any `fabric_category: metal` piece despite the tagger's own alignment instruction — same rationale as `leather`/`suede`/`denim` already being non-fiber values here. **`horn`/`shell`/`resin` added the same day again**, this time from a real live tagging call: a belt's horn-look buckle was correctly described in `reads_as`/`notes` ("horn-like resin material") but had no structured value in either `fabric_category` or `fiber_content` to land in. **UI relevance**: for `accessory_subtype = jewelry`, `pattern_type`/`pattern_scale`/`pattern_complexity` and `season` are hidden entirely in both forms (necklaces/earrings/etc. have no meaningful pattern or season); `reads_as` stays since it's one free-text field, not a chip wall. "Accessory type" also moved to the top of the Garment character section in both forms, ahead of Pattern & Visual, so `accessory_subtype` is known before the rest of the section decides what to render. **This table only covers valid values, not runtime behavior** — for what the engine actually does with a piece's `fiber_content` (which functions read it, whether it drives warmth/wet-exposure/capsule-scoring decisions, and how much of the real wardrobe is currently missing it), see `docs/engine-behaviour-map.md` → *The gates → Gate-field coverage* and *Provenance → The table*. Those numbers are re-derivable, not fixed: `node scratch/measure_open_questions.js` (Q1, Q7, Q8) and `node scratch/measure_provenance.js` are both read-only, no model call. |
| `stretch` | top, bottom, dress, outerwear | `none \| minimal \| moderate \| stretchy` | **yes as of 2026-08-14** (previously manual-only, no `applyTagValue` call anywhere) | PieceForm; **BatchAdd added 2026-08-14** (had zero UI before this pass, despite being a documented editable field) | `prompts.js` schema. `moderate` added same pass. Tagged conservatively from visible fabric behavior (drape, rib knit, visible give at seams); added to `CONFIDENCE_FIELDS` so an unclear photo gets a review badge instead of a guessed value. |
| `opacity` | clothing (not shoes/accessory) | `opaque \| semi_sheer \| sheer \| open_weave` | yes | PieceForm, BatchAdd | `OPACITY_OPTIONS` |
| `needs_base` | clothing (not shoes/accessory) | `yes \| no \| null` (conservative default: null, not "no") | yes | PieceForm, BatchAdd | `NEEDS_BASE_OPTIONS` |
| `pattern_type` | all | `solid \| floral \| botanical \| stripe \| polka_dot \| check \| plaid \| geometric \| abstract \| animal \| graphic \| paisley \| patchwork \| other` | yes | PieceForm, BatchAdd | `prompts.js` schema. **Extended 2026-08-14** — added `polka_dot`, `check`, `paisley`, `patchwork` (purely additive, nothing renamed or removed, not in a `VALID_*` Set). `check` covers gingham/windowpane; `plaid` is intersecting bands/lines; `geometric` is shape-dominant abstraction; `abstract` is nonrepresentational/painterly, explicitly including tie-dye-like motifs — there is no separate `tie_dye` value, use `abstract` + `reads_as` for that nuance; `animal` is animal-surface pattern/repeated motif, a single illustrated animal is `graphic` instead. |
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
- **outerwear**: `cropped | waist | high_hip | hip | low_hip | mid_thigh | knee | mid_calf | ankle | full_length | floor_length | unknown` — `full_length`/`floor_length` added 2026-08-14 so outerwear length concepts that used to live (lossily) in `silhouette`'s dropped `longline` value have a real home; a piece whose old `silhouette` was `longline` had that word opportunistically preserved into `length_hits_at` by the migration if the piece didn't already have a `length_hits_at` value set
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

## Silhouette/hem_finish rewrite, shoe_type/toe_shape split, and waistband_type addition (2026-08-14)

A second coder-handoff pass, same day as the sleeve/bottom_subtype/length_hits_at work above.
Motivated by documenting `silhouette` and `hem_finish`'s real per-category value lists for this
file (see rows above) and discovering the tagger schema didn't match the UI's lists at all —
same class of drift the earlier `length_hits_at` split had already fixed once.

**Shoes were the worst case.** The old shared `silhouette` enum conflated two unrelated shoe axes
— what kind of shoe (`mule`, `loafer`, `boot`, `sandal`, `heel`, `flat`, `sneaker`) and what shape
the toe is (`pointed`, `almond`, `round`, `square`, `open-toe`) — into one field a shoe piece could
only pick one value from. Split into `shoe_type` and `toe_shape` (rows above), wired through the
**full tagging/edit/merge path**, not just exposed in the form:

- `db.js`: new `shoe_type`/`toe_shape` columns, one-time migration mapping recognizable old
  `silhouette` shoe words into both new columns (`TOE_SHAPE_MAP`/`SHOE_TYPE_MAP`), guarded to only
  run where both new columns are still null.
- `prompts.js` / `routes/ai.js` tagger schemas: both fields added to both copies (this is one of
  the few fields present in the `/extract-pieces` duplicate schema — see drift note below).
- `taggerMerge.js`: both added to `CONFIDENCE_FIELDS` so they get review badges.
- `attributes.js` `missingGateFields()`: `shoe_type` (not `toe_shape`) is gate-critical for shoes,
  same tier as `heel_height`/`walk_support`.
- **Three separate free-text "blob" builders** that regex-based gates (`pieceMatchesFootwear()`
  and friends in `rules.js`/`occasions.js`/`footwear-comfort.js`) depend on for words like
  `loafer`/`boot`/`sandal` needed the new fields added or those gates would have gone silently
  blind the moment `silhouette` stopped carrying shoe-type words: `attributePieceTextBlob()`
  (`attributes.js`), `pieceTextBlob()` (`rules.js`), and a third, easy-to-miss **local blob
  duplicated inline inside `inferWholeWardrobePieceRoles()`** (also `rules.js`, not the same code
  path as `pieceTextBlob()`) that drives `sharp_finish`/`soft_shoe` role inference. All three now
  include `shoe_type`/`toe_shape`.
- `tools.js`: `search_wardrobe` piece object now surfaces both fields.
- `PieceForm.jsx`/`BatchAdd.jsx`: `silhouette` UI hidden entirely for `category = shoes`; new
  Shoe Type / Toe Shape chip rows shown instead, with the same missing-field review-highlight
  treatment other gate-critical fields get.
- `crud.js`/`importer.js`/`intakeReview.js`/`OutfitLookbook.jsx`: standard field-list wiring
  (POST/PUT columns, `TAGGABLE_PIECE_COLUMNS`, `REVIEW_EDITABLE_FIELDS`, extracted-piece
  forwarding) — same pattern every prior field addition in this doc followed.

**A duplicate dead function was found and deliberately left alone.** `computeTuckNote()` and
`computeWaistbandNote()` — the functions that turn `hem_finish`/`waistband_type` into a stylist-
facing tuck note — exist as **two independent implementations**: a live one in
`wardrobeAiContext.js` (actually called by `buildWardrobePieceTruthText`, the chat-facing piece
description) and a dead one in `styling-engine/core.js` that's exported but never imported
anywhere. Only the live copy was updated for the new tuckable-hems rule and
`structured_low_waist`; the dead copy in `core.js` still has the old logic. Not a bug fix scope
here — flagging so a future cleanup pass doesn't have to rediscover it.

**routes/ai.js `/extract-pieces` schema sync, this pass**: `hem_finish` (category-conditional),
`length_hits_at`'s outerwear extension, `silhouette` (merged bottom pants+skirt vocab into one
list since that endpoint has no `bottom_subtype` to condition on), `shoe_type`, `toe_shape` — all
synced. `bottom_subtype`, `accessory_subtype`, `jewelry_type`, `necklace_length`, `tuck_behavior`,
`waistband_type` remain **not** in that endpoint's schema — left as the same documented drift the
prior pass called out, not expanded or fixed here.

## Known drift / open items

- Full value-spelling parity check (tagger enum spelling vs. UI chip label vs. any literal-string
  gate match) has not been done field-by-field beyond what's noted above — flagged as future work,
  not verified clean.
- `shoes` and `accessory` fields beyond what's listed here (upper material detail, closure type,
  bag size/strap type) do not exist as structured fields yet — `notes`/`reads_as` free text is the
  only capture mechanism. Deliberately deferred: `accessory_subtype`/`jewelry_type` shipped
  as the minimal-viable slice; further subtype fields wait until real tagged data shows what's
  actually missing.
- `visual_weight` is category-level (all of `shoes`+`accessory`), not `accessory_subtype`-level.
  Owner's own framing: scarves/hats plausibly want the clothing `fabric_weight` scale (real
  warmth/drape relevance) while bags/belts/jewelry/watches/gloves don't. Explicitly deferred as a
  follow-up rather than guessed — revisit once there's a reason to, not a blocking gap today.
- `routes/ai.js`'s `/extract-pieces` schema still doesn't have `bottom_subtype`, `accessory_subtype`,
  `jewelry_type`, `necklace_length`, `tuck_behavior`, or `waistband_type` (`neckline`, the sleeve
  split, category-conditional `length_hits_at`/`silhouette`/`hem_finish`/`fabric_category`, `stretch`,
  and the new `shoe_type`/`toe_shape`/`visual_weight` are synced as of 2026-08-14). Two independent
  tagger schemas remain a real drift risk; unifying them is worth doing at some point, not done here.
- `styling-engine/core.js` has a dead, unused duplicate of `computeTuckNote()`/
  `computeWaistbandNote()` that was not updated for the 2026-08-14 tuckable-hems rule or
  `structured_low_waist` — the live versions both consumers actually use are in
  `wardrobeAiContext.js`. Worth deleting the dead copy at some point, not done here.
