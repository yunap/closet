# Garment evidence parity across chat paths (2026-09-15)

**Status:** active — **implemented as the one default path (revision 9, owner ruling 2026-09-15).** The three registered changes below are no longer flags. The owner directed one coherent default garment-evidence path across the chat flows instead of parallel flagged versions of the prompt and catalog. Sections 1–6 are kept as the record of how each part was verified before it became the default; §7 describes what now ships. The flags (`WARDROBE_SHARED_GARMENT_EVIDENCE`, `WARDROBE_NEUTRAL_WEATHER_WORDING`, `WARDROBE_NEUTRAL_TIME_OF_DAY_WORDING`), `styling-engine/weatherWording.js`, the offline parity harness and the semantic-inventory module were removed. Numbers and patch files in §4–§5 refer to that removed harness.

**Scope held by the owner.**
- The goal is truthful evidence parity: not another prompt, not a thermal rule.
- No clo/PET benchmark, warmth-score change or derived weather verdict goes into model input.
- No garment data is rewritten.
- `single_outfit` is a testing slice, not a permanent separate stylist. The end goal remains shared styling logic across chat flows.

**What these changes are.** Change 1 is a model-input change, not just a parity cleanup: Whole Wardrobe text grows 26%, the `/ask` catalog 6.2%, and trip's truth text shrinks (§5). The normal live checks (§6) are small smoke tests for usability and grounding. They cannot show which change improved or harmed selection, and no quality gain is claimed from parity alone.

**The claim, stated precisely.**
- Supplying 137's recorded short sleeves may prevent an invented "long-sleeve" explanation. The day-wear pilot does not show that it will change garment selection.
- If the same accurate evidence still yields unreliable outfits, the next investigation is selection variability and composition strategy, not more deterministic dress rules.

## 1 · What each path gives the model for the same garment (production today)

Rendered from the real builders on the frozen Stage 2 snapshot.

| Fact | Whole Wardrobe composer (`composerPieceLineSuffix`) | `/ask` single_outfit catalog + `view_pieces` truth (`singleOutfitStylistCatalogLine`) | Trip atomic composition (`buildPieceText`) |
|---|---|---|---|
| Derived warmth level | yes (`warmth:`) | yes (`warmth:`) | no |
| Sleeve length | **no** | yes | yes |
| Length, neckline, silhouette | no | yes | yes, with "[low confidence]" markers |
| Fibre | **no** | **no** | **no** |
| Fabric category, weight, fit, opacity | yes | yes (opacity only if not opaque) | yes |
| Interior construction / insulating layer | insulating layer only | outerwear only | no |
| reads_as (free prose) | yes | only when it adds words beyond the name | yes |
| Tagger prose (best use, style risk, formula compatibility, notes, AI trust, style lanes) | no | no | **yes** |
| do-not-pair | yes | no | yes |
| Owner RULES / REJECTED | no | no | yes |

**Evidence that free prose is not reliable recorded fact:**
- 115 is recorded `fabric: corduroy`, but its reads_as says "classic denim jeans".
- 125's reads_as says "cropped" against its manual `full_length`.
- 131's tagger note says "resting around mid-thigh" against its recorded `length: knee`.

**Evidence that missing fibre invites guessing:** in the pilot, the model called knit sneakers 198 (no fibre recorded) "wool sneakers" — the name of 996862.

## 2 · The 125 / 110 cropped-versus-full-length conflicts (diagnosed; data unchanged)

Read from a WAL-safe copy of the current wardrobe database.

| Piece | Recorded `length_hits_at` | Provenance | Conflicting text | Diagnosis |
|---|---|---|---|---|
| 125 light cream linen relaxed pants | `full_length` | **owner manual** (`manual_overrides` includes `length_hits_at`; confidence `manual`) | reads_as "relaxed cropped pants" (tagger prose, not in `manual_overrides`) | The owner's recorded length is authoritative; the reads_as prose is stale. It predates or ignores the manual correction and was never updated. |
| 110 white slim crop jeans | `full_length` | tagger, confidence **low**; not owner-edited | name "crop jeans"; tagger fit note "the hem hits at the ankle" | Probably a tagging error: the name and the tagger's own note both indicate ankle length. The pants vocabulary has `ankle`. Needs owner confirmation. |

The same scan finds two more bottoms with the pattern:
- 235 "sage cropped pants": `full_length`, confidence high, not manual.
- 996785 "tan corduroy skinny zip-hem pants": `full_length`, manual; "ankle zip" describes a detail, not length.

**Not acted on.** The shared line states 110 as `length: full_length (low confidence)` and 125 as `length: full_length`, and it omits reads_as, so neither conflict is presented as settled fact. Whether to correct 110 or 235 is the owner's call.

## 2a · What the record can attribute (provenance audit, WAL-safe copy of the current wardrobe)

- **reads_as:** present on 264 of 273 active pieces; only 2 are recorded as edited (`manual_overrides`). An edit records that the field was saved, not who wrote the words.
- **do-not-pair cautions:** present on 207 pieces, all tagger-generated (garment intelligence); no owner edit is recorded for them.
- **notes:** 39 are flagged as edited, but 13 of those are tagger "Fit:" text. Some notes hold saved chat replies. The record cannot attribute notes.
- **Stored rules (`styling_rules_learned`, printed as "RULES (authoritative)"), 41 entries on 27 pieces:**
  - 11 generated occasion receipts, already filtered before any model sees them;
  - **24 `[feedback:<type>]` copies** of outfit/board reactions. Owner ruling 2026-08-08 retired that writer because those reactions are not garment rules. **Production trip still sends these as authoritative rules today**; they are reported here, not deleted;
  - 6 other rules: two editor-edited ("This cardigan is clingy and needs a very thin base layer", on 170 and 224); three attributed to the owner by name and date (200, 201, 242); one saved chat message with a board image link (258).
- **Receipt ledger:** the `piece_rule_receipt` table has **0 rows**, so no stored rule can be proven owner-authored from receipts.

**Production fix: stored garment rules on every model path (not flagged).** `storedGarmentRules` (`styling-engine/ruleProvenance.js`) is the one place that decides what a model receives from `styling_rules_learned`. The stored data is never changed.

Readers:
- `buildPieceText`, used by capsule and trip roster selection and composition, capsule expansion, `get_garment_details` and the selected-piece flows;
- the tool-loop plan workbench line (`planWorkbenchPieceLine`);
- the `/ask` compact garment facts (`compactFreeformPieceFacts`, whose `styling_rules_learned` field previously carried the raw stored list).

**Authority is preserved.** The owner's historical stored rules remain `RULES (authoritative)`, with the same label and the same system-prompt wording as before. The empty `piece_rule_receipt` ledger is not evidence that a rule was not the owner's. Receipts were introduced after most rules were saved, so a missing receipt changes nothing.

**Narrow exclusions, each by the source that wrote the entry:**
- generated occasion receipts (existing filter, now also applied to the `/ask` compact facts);
- retired `[feedback:<type>]` reaction copies, covered by the 2026-08-08 ruling;
- saved chat replies: an entry identical to a chat message that the removed Save button marked in that thread's `savedIndices`. Content alone does not qualify. Today this matches 258 (thread `thread_1784194532514`, message 10).

**Tested on one piece that holds both a historical owner rule (no receipt) and a retired copy** (`test/storedRuleProvenance.test.js`). On every reader the owner rules print as `RULES (authoritative)` in stored order, and the copy, the receipt and the saved reply do not appear. A piece whose only entry is a copy gets no rules line.

**Global owner-feedback readers are unchanged.** These readers from the feedback map (§4, §2 C and E) neither read stored garment rules nor call the new code:
- `getOwnerRuleNotes` / `isOwnerRuleRow`, `getStylistFeedbackMemory`, `getWholeWardrobeFeedbackMemory`, `getAcceptedFeedbackSynthesisMemory`;
- `getSavedBoardMemory`, `getSavedBoardRendererMemory` / `withSavedBoardRendererMemory`, `getOutfitsForPieceMemory`, `getCalibrationMemoryForStylist`;
- `getLastOutfitEvaluation`, `getRecentWholeWardrobeSessionInfluence`, `getProvisionalWrongChoiceMemory`, `getStylistConversationState`;
- owner constraints (`ownerConstraintApplies`, `parseOwnerConstraintRow`) and occasion exclusions (`pieceOccasionCompatible`).

Every body except one is byte-identical to the last commit. `getWholeWardrobeFeedbackMemory` differs only by the earlier, unrelated 2026-09-13 narrow-evidence-authority header on this branch. The test also checks behaviour: changing a garment's stored rules leaves the output of the owner-rule, feedback, whole-wardrobe, synthesis and saved-board memories byte-identical.

Measured on the snapshot, 27 active garments with stored rules (41 entries: 11 occasion receipts, 24 retired copies, 1 saved chat reply, 5 owner rules):

| | Before | After (`buildPieceText`, capsule roster, trip roster, trip composition) |
|---|---|---|
| owner rules carried as `RULES (authoritative)` | 5 of 5 | 5 of 5 |
| `RULES (authoritative)` lines | 20 | 5 |
| retired copies printed | 24 | 0 |
| saved chat reply printed | yes | no |

The `/ask` compact facts carry the same 5 owner rules in `styling_rules_learned`. The exact diff is `production-rule-provenance.patch`: it only removes copy and saved-reply lines, and no owner rule line changes.

**Change 1 treatment (revision 5):**
- **Fact line:** compact recorded physical facts only.
- **Garment notes, selective:** only what the app has saved about the garment beyond its tags — a description edited in the app, the owner's stored rules (`RULES (authoritative)`, same exclusions as above), and `REJECTED` pairings. Delivered where garments are chosen among; a garment with none gets no entry.
- **Tagger notes:** only the unedited impression (the read that left the discovery catalog), labelled "not owner-verified", on `/ask` `view_pieces` for inspected pieces. **Tagger pairing cautions are not part of change 1**: `/ask` never carried them, so adding them would be a separate model-guidance change, not factual parity.
- **`notes` field:** not carried.

## 3 · Whole-garment field audit (before adopting any B1 superset)

| Field | What it records | Part-specific inference risk | Evidence | Treatment in the shared line |
|---|---|---|---|---|
| `fabric_weight` | whole garment | read as sleeve or lining thickness | Stage 2 A: 238's `weight: medium` read as sleeve evidence | `weight (whole garment)` |
| `stretch` | whole garment | read as sleeve compressibility | 144 retag pending (owner) | `stretch (whole garment)` |
| `fit_on_body` | whole garment's relation to body contours | read as sleeve or cuff fit | sleeve rulings 2026-09-14 | `fit on body (whole garment)` |
| `interior_construction` | ordinary non-insulating lining | read as insulation | pilot: "fully insulated by the jacket" (unlined) | stated as recorded (`unlined`, `full_lining`, `unknown`), next to `insulating layer` (materials / none / not recorded) |
| `fiber_content` | whole garment (face and lining not separated) | a guess in its absence | "wool sneakers" | named fibres, `unknown` kept, or `fibre: unknown` |
| `silhouette`, `length_hits_at`, `opacity`, `neckline`, `sleeve_length/shape` | outline / garment length / part-specific by name | low | — | stated; low-confidence values marked |
| derived `warmth` level | a score, not a recorded fact | collapses different garments onto one level | 2026-09-14 diagnosis: dress 996791 = tops rated comfortable; cardigan 131 = fleeces | **omitted** |
| reads_as, do-not-pair, stored rules, rejections | free prose | contradicts recorded fields | 115, 125, 131 above | **selective source-labelled notes** (§4), never on the fact line |
| tagger notes, best use, style risk | free prose | contradicts recorded fields | — | **omitted** |

**The B1 superset is not adopted as-is.** It appends facts to a line that keeps derived warmth and reads_as, and it adds whole-garment fields without scope labels.

## 4 · The three registered changes

### Change 1 — factual garment-evidence parity (`WARDROBE_SHARED_GARMENT_EVIDENCE`)

`styling-engine/garmentEvidenceLine.js`.

**Fact line** (`sharedGarmentEvidenceFacts`), in order:
- category (with bottom subtype), fabric, fibre (named, `unknown` kept, or `unknown`);
- `whole garment:` weight, stretch, fit;
- silhouette, length, hem, opacity, needs a base layer;
- for tops, dresses and outerwear: `sleeves` (**`unknown` when unrecorded**), sleeve shape, neckline;
- tuck; waistband, bottom shape, leg opening (when recorded);
- outerwear insulating layer (materials / none / not recorded) and interior;
- protection, footwear facts, accessory type, jewelry and necklace length, colours, pattern;
- `tagged formality …, season …`, provisional tags.

`?` marks a tagger low-confidence value. The conventions are stated once per request.

| Path | Fact line | Saved-record notes | Tagger notes |
|---|---|---|---|
| Whole Wardrobe | `ID <id>: <name>; <facts>` beside each photo | one text part after the roster: conventions, then `GARMENT NOTES — saved records for some pieces shown` | — |
| `/ask` single_outfit | catalog row in the production **sparse, default-aware** format (below); `view_pieces` truth is the full line | `garment_notes` on inspected pieces | `tagger_notes` (impression only) on inspected pieces |
| Trip composition | `piece_catalog` | `piece_catalog_conventions`, `piece_notes` | — |

The facts and each saved-record entry are byte-identical wherever they are delivered. The only other text change 1 touches is Whole Wardrobe's temperature sentence, which drops the now-false "each piece states its own `warmth:`".

**Not swapped:** trip roster selection, the trip tool-loop fallback line, capsule, the selected-piece composer, and system prompts.

**One set of facts, two renderings.** `garmentEvidenceFields(piece)` is the single source. `renderGarmentFactLine` (Whole Wardrobe, trip, `/ask` `view_pieces`) and `sparseGarmentCatalogRow` (`/ask` discovery catalog) both render from it, and each has a decoder.

**The sparse row keeps the production catalog's format:** `#id name | category | key:value;…`, with the production short keys (`fab`, `sil`, `len`, `neck`, `slv`, `waist`, `clr`, `pat`, `protect`, `formal`, …). Lists are joined with `/` (fibre and insulation with `+`).
- **Defaults omitted by stated convention:** `pat` solid, `opacity` opaque, `tuck` tucks_anywhere on tops, `formal` everyday, `season` year-round.
- **Stated once in the conventions, as production did:** `needs-base` marks a recorded yes and `needs-base:no` a recorded no; `protect` lists recorded meaningful rain or wind protection and an omitted `protect` means none recorded (the binary semantics of `weather_protection`, outerwear-weather-consolidation-spec §5); `fab` is fabric type, `weight` textile weight, `vweight` a shoe's or accessory's visual scale.
- **No omission hides a missing value:** when one of those fields is not recorded, the row writes `key:unknown` (92 rows for opacity, 20 for tuck, 7 for formal, 0 for season; pattern likewise).
- **Always stated:** `fibre` (21 rows `unknown`) and `slv` on tops, dresses and outerwear.
- **Everything else omitted is not recorded.**
- **Kept from production:** the occasion-tags sentence in the conventions.

**Parity check** (`test/sharedGarmentEvidenceLine.test.js`, and the harness over the snapshot catalog):
- The sparse row and the full line each decode to exactly the same fields, facts and unknowns alike. The test covers varied shapes: unrecorded fibre, sleeves and defaults; low-confidence and provisional values; needs-base; three insulation states; shoes; jewelry; skirts.
- **All 237 `/ask` rows reconstruct exactly (0 mismatches).**
- Apart from its explicit `:unknown` markers, a sparse row is never longer than the full line.

#### Old-versus-new catalog semantics (production row → change 1 row)

`scratch/catalog_semantic_inventory.mjs` decodes the **production** `/ask` row literally by the production conventions (including their defaults: omitted pattern = solid, opacity = opaque, season = year-round, needs-base = no, formality = everyday). It decodes the change 1 row by its own conventions, then compares every fact on every row. Each difference must be declared in its explanation table as gained, preserved, corrected or intentionally removed. `test/catalogSemanticInventory.test.js` fails on any undeclared difference and pins the meanings named in review: read, omitted pattern, needs-base, weather protection, cardigan tuck and accessory visual weight.

**Snapshot catalog: 237 rows, 0 undeclared differences.** Change 1 also adds 566 `?` low-confidence markers that production never showed. A value that differs only by that marker counts as the same fact.

| Fact | Rows by status | What the stylist gains or loses, and why |
|---|---|---|
| `accessory` | same 16 | Preserved. |
| `bottom_subtype` | new only 60 | GAINED: recorded bottom subtype (pants, skirt, shorts). |
| `category` | same 237 | Preserved. |
| `colours` | same 236 | Preserved. |
| `fabric` | same 237 | Preserved. |
| `fibre` | new only 237 | GAINED: recorded fibre, `unknown` when not recorded. |
| `fit` | same 183 | Preserved. |
| `formality` | same 230 | Preserved. |
| `heel` | same 27 | Preserved. |
| `hem` | new only 170 | GAINED: recorded hem finish (already sent by Whole Wardrobe and buildPieceText). |
| `insulating_layer` | same 4; new only 27 | GAINED: outerwear states `insulation:none` or `insulation:not recorded` instead of omitting both. |
| `interior` | same 16; new only 15 | GAINED: outerwear states `interior:unknown` instead of omitting it. |
| `length` | same 189 | Preserved. |
| `neckline` | same 127 | Preserved. |
| `needs_base` | same 6; old default only 231 | CORRECTED: production convention asserted "no" on every row without needs-base — clothing where needs_base is null (the field reference: not recorded, never "no") and shoes and accessories, where it is not a tagged field. A recorded yes or no is carried. |
| `opacity` | same 101; old default only 136 | CORRECTED: production convention asserted "opaque" for every row without opacity — clothing whose opacity is not recorded (change 1 writes `opacity:unknown`) and shoes and accessories, where opacity is not a tagged field. |
| `pattern` | same 232; changed 2; changed from old default 3 | CORRECTED: production decided "solid" from pattern_complexity; change 1 reads the recorded pattern_type, so a recorded non-solid pattern whose complexity says solid is stated. CORRECTED: production printed scale/complexity with no marker when the pattern type was missing, or beside a recorded type of solid; change 1 writes the type as `unknown` in front of the recorded detail, or states solid. |
| `protection` | same 10 | Preserved. |
| `read` | old only 148 | MOVED (intentional): tagger prose. It is no longer on every discovery row; view_pieces carries it as tagger_notes ("tagger impression (not owner-verified)") for inspected pieces. Discovery now relies on name, colours, pattern, silhouette and fabric. |
| `role_label` | old only 12 | REMOVED (intentional): `outerwear (layer_top)` was derived by matching "cardigan"/"vest" in the name or tagger read (garmentKind), not recorded; the garment name that carried that word is still shown. |
| `season` | same 237 | Preserved. |
| `shoe_type` | same 26 | Preserved. |
| `silhouette` | same 184 | Preserved. |
| `sleeve_shape` | same 48 | Preserved. |
| `sleeves` | same 133 | Preserved. |
| `stretch` | same 67; new only 24 | GAINED: stretch on bottoms (production row carried it only for tops, dresses and outerwear). |
| `tags` | same 16 | Preserved. |
| `toe` | same 24 | Preserved. |
| `tuck` | same 60; new only 29 | GAINED: recorded tucks_anywhere on tops is now an explicit default (production omitted it without declaring a default), and on dresses and outerwear a recorded tucks_anywhere is stated. |
| `visual_weight` | same 43 | Preserved. |
| `waistband` | same 58 | Preserved. |
| `walk_support` | same 27 | Preserved. |
| `warmth` | old only 187 | REMOVED (intentional): derived thermal level, not a recorded fact; owner scope keeps derived warmth out of model input. The recorded construction (fabric, fibre, weight, insulation, interior) stays. |
| `weight` | same 193 | Preserved. |

#### Quality-relevant differences (not just format)

These are intentional removals that can change what the stylist selects or claims. They are recorded as quality-relevant (`QUALITY_RELEVANT` in the inventory module, pinned by its test), so a live check watches them rather than treating them as explained format differences. Parity alone does not show whether they help or hurt.

| Path | Difference | Rows or lines | What a live check should watch |
|---|---|---|---|
| `/ask` discovery catalog | tagger **read** removed from discovery rows; it reappears only as `tagger_notes` on inspected pieces | 148 of 237 rows | Discovery-stage visual read removed: the stylist chooses its 8–12 workbench pieces without the tagger impression and sees it only for pieces it inspects. Watch whether workbench selection or the stated reasons change (e.g. statement pieces or visual character missed at discovery). |
| `/ask` discovery catalog | **derived warmth** level removed | 187 of 237 rows | Derived warmth level removed: the stylist judges thermal suitability from recorded construction (fabric, fibre, whole-garment weight, insulation, interior) without a precomputed level. Watch base and layer choices at the edges of the stated range, and whether explanations invent warmth claims. |
| Whole Wardrobe garment lines (check 2) | **derived warmth** removed from the line beside each photo | 68 of 83 lines | Same as above; the composer also loses the `warmth:` it was told to compare against the range. |
| Whole Wardrobe garment lines (check 2) | tagger **reads_as** removed | 82 of 83 lines | Whether card reasons lose visual character that the photo alone did not convey. |
| Whole Wardrobe garment lines (check 2) | tagger **do-not-pair** cautions removed (production already carried them inline) | 66 of 83 lines | Whether cards pair pieces the cautions warned against (for example two loud patterns); a caution is tagger guidance, not a recorded fact. |

**Found and fixed while building this inventory.** These were losses in the first sparse version, and each is now preserved:
- a recorded solid pattern (it read as "not recorded" once the solid default was gone);
- `other` answers for neckline, silhouette, sleeve shape, fabric and fit;
- pattern complexity when the pattern type is unrecorded (`pat:unknown/medium`);
- a recorded `needs-base:no`;
- tuck on dresses and outerwear (131's `wear_over_only`);
- visual weight on accessories;
- recorded silhouette and fit on bags, shoes, sunglasses, scarves and jewelry;
- the `fab`/`weight` glossary.

The same full-catalog pass also found that production packs sleeve length and shape into one `slv`, which the `3/4` sleeve-length value makes ambiguous. Change 1 keeps them as separate keys.

**What discovery loses, stated plainly:**
- **Tagger read** on 148 rows. The stylist now picks its workbench from name, colours, pattern, silhouette, fabric and construction, and sees the tagger's impression only on the pieces it inspects.
- **Derived warmth level** on 187 rows.
- **The name-derived `layer_top` label** on 12 rows.

**What it gains:**
- fibre on every row;
- hem finish, bottom subtype, stretch on bottoms, explicit insulation and interior states;
- visible low-confidence markers;
- honest unknowns where production asserted opaque (136 rows), no base layer needed (231) or solid.

**Tool descriptions under the flag.** `search_wardrobe` no longer promises "colour/read" in the catalog, and `view_pieces` no longer promises a "compact truth line". Both descriptions are restated for the flag only (`stylistToolsForTurn`); production descriptions are unchanged.

#### `view_pieces` growth, accounted (12 inspected pieces)

| Component | Production | Change 1 | Difference |
|---|---|---|---|
| truth line | 2,754 | 4,138 | +1,384 |
| — of which new facts net of warmth and read (same facts rendered sparse: 2,876) | | | +122 |
| — of which full-line labels (`whole garment:`, `tagged`, spelled-out keys) | | | +1,262 |
| `tagger_notes` (the tagger impression that left the catalog; no pairing cautions) | 0 | 883 | +883 |
| `garment_notes` (no workbench piece has a saved record) | 0 | 0 | +0 |
| `evidence_note` and names | 2,856 | 2,856 | +0 |
| JSON keys and ids | 625 | 841 | +216 |
| **total** | **6,235** | **8,718** | **+2,483** |

So the growth is the full line's longer labels and the tagger impression moving from discovery to inspection. New facts add +122 characters across the 12 pieces.

**Exact Whole Wardrobe diff, non-garment lines (S1):**
```diff
+Garment facts are recorded values only. `?` marks a value the tagger recorded with low confidence; `unknown` means not recorded; values after `whole garment:` describe the entire garment, not its sleeves, lining or any single part. An absent fact is not recorded and must not be inferred. Source-labelled garment notes, where given, are not recorded facts.
+
+GARMENT NOTES — saved records for some pieces shown (source-labelled; not recorded facts):
+- #350 red graphic v-neck tee: description edited in the app (author not recorded): graphic casual tee
+- #351 black graphic cat tee: description edited in the app (author not recorded): playful graphic tee
+- #168 coral solid maxi dress: REJECTED: emerald green v-neck top — rejected as a layer over this dress by Yuna (2026-08-02)
+- #224 lilac floral knit cardigan: RULES (authoritative): This cardigan is clingy and needs a very thin base layer.
-Temperature: 65°F high / 50°F low — each piece states its own `warmth:`; judge the outfit against the range, not against a number
+Temperature: 65°F high / 50°F low — judge the outfit against the range, not against a number
```

**One garment line, 137:**
```diff
-ID 137: black and cream striped knit top; warmth: moderate; weight: medium; fabric: cotton; reads_as: classic nautical stripe; opacity: opaque; fit_on_body: clings_stretchy; tuck_behavior: tucks_anywhere; hem_finish: straight_loose; do not pair: avoid another loud pattern
+ID 137: black and cream striped knit top; top; fabric cotton?; fibre cotton, spandex; whole garment: weight medium, fit clings_stretchy; silhouette fitted?; length hip?; hem straight_loose?; opacity opaque; sleeves short; neckline boat?; tuck tucks_anywhere; colours cream, black; pattern stripe, medium, medium; tagged formality everyday, season year-round
```

**`/ask` catalog rows, production → change 1:**
```diff
-#137 black and cream striped knit top | top | warmth:moderate;read:classic nautical stripe;clr:cream/black;pat:stripe/medium/medium;fab:cotton;weight:medium;sil:fitted;fit:clings_stretchy;len:hip;neck:boat;slv:short
+#137 black and cream striped knit top | top | fab:cotton?;fibre:cotton+spandex;weight:medium;fit:clings_stretchy;sil:fitted?;len:hip?;hem:straight_loose?;slv:short;neck:boat?;clr:cream/black;pat:stripe/medium/medium
-#110 white slim crop jeans | bottom | warmth:moderate;read:classic straight denim;clr:white;fab:denim;weight:medium;fit:skims;len:full_length;waist:structured_mid_waist
+#110 white slim crop jeans | bottom (pants) | fab:denim?;fibre:cotton+spandex+unknown;weight:medium?;fit:skims?;len:full_length?;hem:straight_loose?;waist:structured_mid_waist;clr:white;opacity:unknown
-#131 light grey and brown knit cardigan | outerwear (layer_top) | warmth:moderate;read:soft relaxed layer;clr:light grey/taupe;fab:cashmere;weight:medium;sil:relaxed;fit:hangs_straight;season:cool;len:knee;slv:long/fitted;tuck:wear_over_only
+#131 light grey and brown knit cardigan | outerwear | fab:cashmere;fibre:cashmere;weight:medium?;fit:hangs_straight;sil:relaxed;len:knee;hem:straight_loose?;slv:long;slvshape:fitted;tuck:wear_over_only;insulation:not recorded;interior:unknown;clr:light grey/taupe;season:cool;opacity:unknown
-#996767 olive green lightweight jacket | outerwear | warmth:moderate;read:olive military-utility cropped field jacket with rope drawstring waist;clr:olive/white;fab:cotton;weight:medium;sil:relaxed;fit:hangs_straight;season:cool;len:hip;neck:collared;slv:long/straight;protect:wind;interior:unlined
+#996767 olive green lightweight jacket | outerwear | fab:cotton;fibre:cotton;weight:medium;fit:hangs_straight;sil:relaxed;len:hip;hem:straight_loose;slv:long;slvshape:straight;neck:collared;insulation:none;interior:unlined;protect:wind;clr:olive/white;season:cool
```

The full request diffs are `ww-parity.patch`, `ask-parity.patch` and `trip-parity.patch`.

### Change 2 — neutral weather wording (`WARDROBE_NEUTRAL_WEATHER_WORDING`)

`styling-engine/weatherWording.js`. It removes **engine-derived** weather targets and requirements only:
- Whole Wardrobe's outerwear heading "(ordered for these conditions)" (the order itself is unchanged);
- the `COOL-END LAYER` paragraph;
- `/ask` single_outfit's `thermal_guidance` band target and its cold-need workbench instruction.

Garment lines are untouched.

**Single-outfit system prompt (fixed for change 2).** The workflow promised `thermal_guidance` in two sentences: step 1 ("along with thermal_guidance indicating the target upper-body warmth band") and step 2's cold-side workbench sentence. Change 2 removes the field, so under the flag both sentences are removed from `SINGLE_OUTFIT_STYLIST_SYSTEM` (`prompts.js`); production text is byte-identical (`prompt_equivalence.test.js`). `test/neutralWeatherWording.test.js` asserts the flag-on prompt equals production with exactly those two sentences removed. Change 2 `/ask` request diff: 4 system lines, `thermal_guidance` mentions 2 → 0, tool descriptions unchanged, catalog rows byte-identical (`change2-ask-live-check.patch`).

### Change 3 — time-of-day paragraph removed (`WARDROBE_NEUTRAL_TIME_OF_DAY_WORDING`)

The paragraph's first sentence repeats what the stated range and outing hours already carry; the rest prescribes garments and layers. Under the flag the whole paragraph is removed and nothing replaces it. Exact request diff (Whole Wardrobe, S1) — one line removed, no line added:

```diff
-TIME-OF-DAY WEATHER: Judge the part of the forecast range relevant to the request, not only the daily high. For an evening or early-morning outing near a cooler low, include a plausible removable transition layer when the shown wardrobe supports one. An indoor destination may shape the base outfit, but it does not erase arrival and departure weather. This also runs the other direction: the BASE outfit — what carries the main part of the day — should track the day's HIGH, not a cooler morning/evening low. Do not choose a heavy or insulating-fiber top or bottom (a chunky knit, wool, a mock neck) alongside bare warm-weather footwear (sandals, open-toe shoes) just because the low dipped cool; bare feet already say the day reads warm enough for that, so the rest of the base outfit should match — cover the cooler edges of the day with a removable layer instead of a heavier base garment.
```

`Temperature: 65°F high / 50°F low` and `Styling request: I'll be outside from about 4–8 p.m.; …` remain in every variant. The production pin still asserts the paragraph with the flag off. The change 3 test asserts the flag-on request equals production with exactly that line removed.

## 5 · Offline verification (no provider calls)

`scratch/garment_evidence_parity.mjs`, output in `scratch/garment_evidence_runs/2026-09-15/` (gitignored). Frozen Stage 2 snapshot; 17 sample garments, including stored-rule, saved-chat and rejection cases.

**Whole Wardrobe (actual composer request, S1 65/50, outside 4–8 p.m., count 1), each change alone:**

| Variant | Text chars (production 26,976) | Fact lines changed | Other lines changed | System, photos, token budget |
|---|---|---|---|---|
| change 1 | 33,957 (+25.9%): fact lines 26,319 (production garment lines 20,206) + notes 537 (4 entries) | 83 | temperature sentence; conventions and notes added | identical |
| change 2 | 26,610 | 0 | ordered heading; COOL-END paragraph | identical |
| change 3 | 26,082 | 0 | TIME-OF-DAY paragraph (removed) | identical |

The three changes touch **pairwise disjoint** lines. The stated range and request text are present in all four requests.

**`/ask` single_outfit (237 rows, 12-piece workbench):**

| Change | Catalog chars (production 50,789) | `view_pieces` text (production 6,235) | Other |
|---|---|---|---|
| change 1 | 53,957 (+6.2%); 237/237 rows reconstruct the full fact line exactly; 0 undeclared old-versus-new differences | 8,718: full fact line, 12 `tagger_notes` (impression only), 0 `garment_notes` (accounted above) | row IDs and order identical; `sparse_conventions` replaced |
| change 2 | rows byte-identical | — | `thermal_guidance` removed; standard instruction |

**Trip composition, 17 sample garments (change 1):** production 21,290 chars (after the production fix) → fact lines 5,766 + `piece_notes` 384 (3 entries).

**Cross-path parity (change 1):** every sample garment's facts and saved-record entry are byte-identical wherever delivered.

**Fact lines:** none contains a verdict, prose or rule word on any path. Owner rules appear only in the notes channel, as `RULES (authoritative)`.

**Size.** `/ask` keeps the production sparse format, so its growth is the new truthful content alone: explicit `unknown`s, fibre, hem, insulation and `?` markers, minus the derived warmth and tagger read. Whole Wardrobe and trip grow with the facts restored by the inventory (recorded solid pattern, `other` answers, hem, tuck on outerwear). No fact was trimmed.

## 6 · Suggested live checks (owner approval needed; show the exact request diff first)

Before any live call, show the owner the exact request diff for that change, regenerated on the day. For the first small change 1 check (check 1, `/ask`), `change1-ask-live-check.patch` holds the complete request difference: system prompt 0 changed lines; tool descriptions 4 (the `search_wardrobe` catalog sentence and the `view_pieces` truth sentence); the `stylist_catalog` frame and all 237 rows; `view_pieces` results. For check 2, `ww-parity.patch`. For change 2, `change2-ask-live-check.patch` and `ww-weather.patch`. Run each change **alone** against production, never combined. For each card, judge:
- **grounding:** does any stated fact contradict the record, or appear where the record says unknown?
- **would you wear it?**

These are small smoke tests, not proof of quality improvement. No blinded sheet.

1. **`/ask`:** "Style one casual outfit. I'll be outside 4–8 p.m., 65°F when I leave and 50°F by the time I return."
2. **Whole Wardrobe:** the same conditions, 3 cards.
3. **`/ask`:** "One outfit for a brisk 46°F morning walk."
4. **`/ask`:** "An outfit for a 72°F afternoon, out from noon to 5 p.m. You may use my charcoal ribbed knit sheath dress if it suits the conditions, or choose something else entirely." The dress is optional; declining it is a valid answer.
5. **Trip:** "Pack a 3-day city trip, highs 65°F, lows 50°F."

Change 1 applies to checks 1–5; change 2 to checks 1–4; change 3 to check 2 only. The production rule fix is already live in code on this branch and will be exercised by any of them. Roughly 5–8 provider calls per change.

## 7 · Implemented default (2026-09-15)

**Garment evidence, every chat composition path.**
- **Whole Wardrobe composer, selected-piece composer and card repair:** each garment photograph is labelled with the shared fact line (`sharedGarmentEvidenceLine`). The fact conventions are stated once. Whole Wardrobe also receives the saved-record notes block (owner `RULES (authoritative)`, `REJECTED`, edited descriptions) for shown pieces. The old composer line — derived `warmth:`, `reads_as` and tagger `do not pair` — is used only by the composer-experiment manifest test hook.
- **`/ask` single_outfit:** catalog rows use the sparse, default-aware rendering of the same facts. `view_pieces` returns the full fact line, `garment_notes` and `tagger_notes` (the tagger impression only). The tool descriptions say so.
- **Trip composition:** `piece_catalog` is the shared fact line, with `piece_catalog_conventions` and `piece_notes`.
- **Everywhere `buildPieceText` reaches a model** (capsule, trip roster selection, `get_garment_details`, selected-piece truth): the owner's stored rules keep their authority, retired reaction copies and the saved chat reply stay excluded (`ruleProvenance.js`), and **unverified tagger pairing guidance is no longer sent** (pairing requirements, failure risks, formula compatibility, do-not-pair).
- **Tool-loop plan workbench line, search thermal facts, freeform wardrobe manifest:** no derived `warmth` level and no name-derived `layer_top` label. The plan line also drops the tagger read.

**Weather wording.** Removed:
- the `/ask` `thermal_guidance` band target and its cold-need instruction;
- both single-outfit system-prompt sentences that promised `thermal_guidance`;
- Whole Wardrobe's "(ordered for these conditions)" heading;
- the `COOL-END LAYER` paragraph;
- the `TIME-OF-DAY WEATHER` paragraph;
- the "each piece states its own `warmth:`" clause.

The stated forecast range and the request text, including outing hours, remain.

**Preserved:** the owner's stored rules and rejections, the live wardrobe data (nothing rewritten), occasion exclusions, owner constraints and every global owner-feedback reader.

**Follow-up (2026-09-15, live thread `thread_1789503026074`).** An opaque lace top (opacity recorded by the owner, no base-layer
need recorded) was layered over a wool shell — the first time in seven stored cards using that top. The composer described the
shell as textural styling ("a clean, neutral base … rich textural layering"), not explicitly as coverage, so the items below are
plausible contributors, not a proven cause. Its base-layer data had not changed. What had: the shared line newly states the
tagger's `sleeve shape deep_armhole` and no longer carries the tagger read or pairing caution; the composer rules still named
retired labels (`needs_base: yes`, `fit_on_body`) that the lines no longer print; and nothing said an unrecorded base need is no
requirement. Changed:
- `requiredBaseLayerPromptRule` quotes the fact line's wording ("needs a base layer", `whole garment: … fit`) and says a garment
  whose facts do not say it needs a base layer has no base requirement;
- the Whole Wardrobe tail (owner wording): opacity and base-layer facts are authoritative; do not call an opaque garment sheer;
  do not infer a required base layer from lace, armhole, neckline or sleeve shape; layer underneath only when it serves a stated
  styling or practical purpose — legitimate layering stays open without inventing exposure;
- `STYLIST_SYSTEM` no longer calls the tagger read "the definitive visual impression".
Pinned in `test/freeform_observability.test.js`, `test/aiEndpointContracts.test.js` and `test/prompt_equivalence.test.js`.

## 8 · Live run `thread_1789508440573` (50/40°F, walking 1–6 p.m., five cards) — diagnosis

**Where the weak choices began.** The correct walking context, the shared garment facts and 63 photographs reached the Whole
Wardrobe composer. It returned five cards; all passed the local gate, with no repair or backfill. The weak choices began in
composition. Better supply was on the roster: 7 outerwear pieces, including a wool coat and an insulating puffer; 14 shoes, including
flat leather ankle boots, wool lace-up sneakers and loafers, several tagged walk support high.

**Plausible contributors, not proven causes.** Each item below is model-facing language or a data gap that could push toward light
layers; none is shown to have caused the model's choices, and the model had each piece's fibre, lining, construction and photograph.

- **The composer was told the roster is valid for the conditions.** Its system prompt said "the wardrobe shown has already been
  filtered for validity — compose freely within it" (commit 7188d3d), while the hard gates only remove plainly invalid pieces (82
  this run). `docs/activity-and-roster-spec.md` §4d diagnosed the same "the roster is an assertion of suitability, and the prompt
  says so" defect on `search_wardrobe`. **Corrected** (below).
- **A weather-blind occasion taste list.** `city_smart_casual` rendered "lean toward: tailored linen, structured denim, cardigans,
  light outerwear, loafers, slip-ons, low block heels" at any forecast. **Corrected 2026-09-15** — see §9.
- **Walking guidance names shoe types, not recorded facts** ("prefer low block heels, loafers, flats, sneakers"); the card that chose
  flats echoed "low block heels" in its watch note. The "prefer" half is unchanged; the same sentence's soft prohibitions
  (warm-weather boots; mules and sandals for hiking) were removed 2026-09-15 — see §9.
- **The cutout flats were not invisible to the model:** their name and photograph were sent. What the missing field explains is why
  the cold-footwear gate stayed silent — it reads only `toe_shape: open_toe` / `shoe_type: sandal`, and piece 204 is recorded as a
  pointed-toe flat. A tag gap in the gate, not a gap in what the model could see. No retag proposed.
- **Derived warmth labels stay removed.** This run is not evidence for restoring them: the model already had fibre, lining,
  construction and photographs for every piece it chose.

**Roster language corrected (2026-09-15) — the "eligible piece = adequate outfit" implication.** Audited every model-facing place
that says the roster was pre-filtered:
- Whole Wardrobe composer system prompt: now states that the roster passed the hard eligibility gates (occasion and register,
  activity footwear, pieces plainly unsuited to the conditions) and that this is eligibility, not a verdict that a piece or a
  combination is adequate; the completed outfit is judged against the stated conditions and duration.
- `search_wardrobe`'s `intent` description: prohibited pieces are filtered out so the model need not re-check those gates; what
  remains is eligible, which is not a judgment that any piece or combination suits the conditions.
- The stylist prompt's own search sentence, which said results are "already filtered to what is wearable … compose freely from what
  comes back without self-rejecting anything": now filtered by the occasion/activity gates, with eligibility explicitly not a
  judgment that a piece or a combination suits the conditions.
- Whole Wardrobe roster disclosure: removal of plainly unsuited pieces "does not certify the rest as warm enough".
- Activity roster note: a `{label}` rating covers that activity's footwear and register checks only.
- Left as-is, already scoped to what was checked: the selected-piece composer's "passed the wardrobe's register and footwear
  eligibility checks" sentence, and the single-outfit workflow's "hard-eligible garments" phrasing.

**Garment-fact integrity: tuck.** Tops 133 and 140 are recorded `wear_over_only`, their lines said so, and two cards instructed
tucking them. `tuckInstructionConflict` / `correctTuckInstruction` (`styling-engine/outfitValidation.js`) read the base top by slot
or role, never by garment name:
- **Whole Wardrobe:** the card is still delivered and still visible, with a "Fit note". The contradicted clause is dropped from the
  authoritative `styling_instructions` (the renderer is told to follow that field exactly) and the recorded mechanic stated instead;
  the model's original text is kept on the card as `stylingInstructionsOriginal`, so nothing is hidden.
- **`/ask` `propose_outfit`:** a contract issue the model must resolve before the card is accepted.
- **Trip/capsule plan submission:** a validation reason for resubmission.

**Limits of this check — the issue is not fully closed.** It inspects the base-top slot and the instruction field only. It does not
catch a tuck asserted in `reason`, `watchFor` or chat prose; a paraphrase with no tuck word ("hem inside the waistband"); a
contradiction about any other recorded mechanic (belting, sleeves pushed, worn open); or a contradicted instruction on a layer or
dress. Prose contradiction in general is unaddressed.

Pinned in `test/tuckInstructionIntegrity.test.js` and `test/aiEndpointContracts.test.js`.

## 9 · Retired directives removed from the assembled request (2026-09-15)

The `thread_1789508440573` capture showed the model receiving directives that outrank recorded facts
and, in three cases, assert rules the engine itself does not hold. Owner instruction: fix the clear
conflicts end to end — prompt, scoring and every chat path — and propose wording before touching the
less-clear ones.

**The authority question, settled first.** `docs/occasion_profiles_ratification.md` ratified the
occasion/activity taste lists on 2026-06-12 as **SOFT — "score penalty, never suppression"**, with the
`preferred_*` lists kept as "soft bonuses". The ratified home of these lists is therefore *roster
scoring*, not instruction text. Every prompt sentence that restated them as a requirement was
unratified, and in the capture it was also weather-blind.

| # | Directive | Source | Authority | Paths that received it | Action |
|---|---|---|---|---|---|
| 1 | "at most ONE bold print per outfit" | `prompts.js` (`STYLIST_SYSTEM`), `outfitSetPlanner.js` workbench line | Retired by owner ruling (print judgment is case-by-case); these two copies survived the earlier sweep because the `patternJudgment` regex did not match this phrasing | `/ask` (all chat flows), trip + capsule plan workbench | Replaced with case-by-case judgment; register default kept |
| 2 | "Do not suggest dressy, formal, or high-maintenance tops … for beach walks or outdoor walks" | `prompts.js` (`STYLIST_SYSTEM`) | Contradicts the ratification: hiking's `discouraged_materials` / `discouraged_pieces` are SOFT | `/ask` (all chat flows) | Replaced with a fact-anchored judgment, no category ban |
| 3 | "For this occasion/activity, lean toward: … ; use sparingly and justify in watchFor: …" | `routes/ai.js` ×3 blocks | Unratified rendering of SOFT scoring as instruction; weather-blind (suggested cardigans, light outerwear and low heels at 50/40°F) | Whole Wardrobe composer, selected-piece composer | Removed from the prompt; scoring untouched |
| 4 | "avoid … warm-weather boots" / "avoid … delicate sandals, mules, and sandals" | `routes/ai.js` comfort sentence ×2 | Mixed HARD and SOFT in one prohibition sentence | Whole Wardrobe composer, selected-piece composer | Sentence now names only gate-enforced exclusions |

**What deliberately did not change.**
- **The scoring.** `rules.js` still applies +8/+10 preferred and −8/−10 discouraged to roster ranking,
  in both scoring sites, because that is exactly what the owner ratified. The fix removes the
  *duplicate* claim from the prompt, not the ratified preference.
- **No suppression exists to remove.** Verified: `discouraged` never excludes — `tools.js` filters
  only `prohibited`, the plan validator rejects only `prohibited`, and `profileRuleFit` returns
  `discouraged` as a tier. The ratified "never suppression" boundary holds.
- **The Style Constitution** (`constitutionSeed.js`: "bold print on one piece + solid on the other")
  is the owner's own formula and is untouched.
- **Pattern-count code that is not a global rule:** the `controlled_print` mission definition
  (`patternCount === 1`) and the `earthy_structured_minimal` archetype's `extra_pattern` avoidance are
  scoped to named archetypes a look opts into, not caps applied to every outfit.
- **Trip prompt wording** ("never rely *solely* on dressy … outerwear"; "avoid delicate or
  high-maintenance pieces … *when practical alternatives exist*") is conditional judgment, not a
  categorical ban, so it stays.

**Cross-path coverage.** `test/stylingIntent.test.js` (shared `/ask` system), `test/plan_outfit_set.test.js`
(plan workbench), `test/aiEndpointContracts.test.js` (Whole Wardrobe walking and hiking turns,
selected-piece turn) each pin the absence of the retired directive and the presence of what the gate
actually enforces. Two deltas are registered in `test/prompt_equivalence.test.js`; the frozen snapshot
is unchanged.

**Open, not changed without approval:** `search_wardrobe` still labels results `ruleFit: discouraged` /
`discouraged material` on the `/ask` path. That is the same soft signal surfaced as a verdict word, so
`/ask` can still read "discouraged" for a garment no prompt discourages any more. Proposed minimal
wording, pending owner approval: state it as ranking evidence ("ranked below preferred for this
occasion") rather than a verdict.

## 10 · The two copies §9 missed, and what the roster scores actually do (2026-09-15)

§9 claimed "end to end" while two active model-facing copies survived. Both are now fixed.

**(a) The shared `/ask` system prompt (`styling-engine/core.js`).** Under the header
`OCCASION & CLIMATE PROFILES (RULES-AS-DATA)` it said: *"You MUST strictly apply that profile's
prohibited_materials, prohibited_footwear, and preferred style vibe rules … NEVER suggest heavy zip
ankle boots in summer months (June, July, August) even on cooler/windy days"* — an absolute,
calendar-based garment ban, in the prompt every chat flow inherits. Worse, the line beneath it
serialized all ten profiles **including every `preferred_*` / `discouraged_*` list** (22 soft-key
occurrences), so the ratified soft ranking lists were published to the model as rules-as-data under
a "you MUST apply" header — the same duplicate claim removed from the composers in §9.

Now: the ban is gone; the MUST covers `prohibited_materials` / `prohibited_footwear` only, which is
what the engine enforces; the vibe is described as the register it covers, not a garment
requirement; and the serialized blob is filtered so the soft keys never reach the model, while every
hard key (`prohibited_*`, `required_*`, `register_ceiling`, `required_occasion_tags`) and the
classification fields survive. (The private helper this section originally introduced was replaced
the same day by the shared `stripSoftRankingRules()` — see §11(b).)

**(b) `search_wardrobe` result tiers.** Every result carried `ruleFit` / `ruleFitLabel`, and each
photo label was captioned with its tier. Rather than renaming `discouraged`, the question was which
tiers carry something the model cannot get from the garment's own facts:

| Tier | What it tells the model | Verdict |
|---|---|---|
| `prohibited` | a hard gate excluded this piece, and why | **Kept** — it is the answer to "why can't I wear this", and is returned in `intent:'explain'` and in the annotated supply fallback |
| `unknown` | a field the gate reads is untagged | **Kept** — a fact about missing metadata, not a preference |
| `discouraged` | the piece matched a soft occasion/activity list | **Dropped** — its whole content is the ratified ranking lists; it adds no garment fact, and reads as a verdict |
| `preferred` | matched a soft bonus list | **Dropped** — same |
| `neutral` | nothing | **Dropped** — information-free |

The prompt bullets that taught the model to read the tiers were corrected to match (two registered
deltas), including the one that already conceded `discouraged` is "a legitimate, permitted choice,
not a piece to avoid" — prose walking back a verdict the data kept asserting.

**Roster-score validity check (offline, isolated DB copy, no provider calls).**
`scratch/audit_taste_bonus_roster_effect.mjs` builds the city/walking roster twice per scenario —
once as production does, once with only the `preferred_*` / `discouraged_*` keys emptied — through
the production context resolver with stated weather and live weather disabled.

| Scenario | Roster | Admitted by the bonuses | Displaced by them | Rank changes |
|---|---|---|---|---|
| city / walking / 50°F–40°F | 80 | #196 black slip-on loafers | #194 beige leather bow wedge shoes | 8 of 80 |
| city / walking / 72°F–62°F | 83 | #196 black slip-on loafers | #194 beige leather bow wedge shoes | 8 of 83 |

**Answer: no — the bonuses did not change which weather-suitable pieces reached the composer.** The
single membership change is identical at both temperatures: a preferred-footwear loafer displaces a
wedge of the same recorded season (`year-round`) and weight (`medium`). No warmer or cooler piece
gained or lost a place, and every rank change is one position, among shoes only. The bonuses are
weather-blind, but on this wardrobe their effect is weather-neutral.

**Limits.** One wardrobe, one occasion, two forecasts, roster cap 90 against ~80–83 eligible pieces,
so the cap barely binds and competition is mild — a tighter cap, or a wardrobe with many
preferred-material pieces, could show more. This measures membership and order only; it says nothing
about what the model then chose. The scores are unchanged, as the owner directed.

## 11 · Two boundaries finished before the live check (2026-09-15)

### (a) The `/ask` context dropped the stated range and the stated activity

In the `thread_1789508440573` capture, `THREAD STATE` recorded `activity: none` and a bare `50°` for
a request that said *walking around the city* at 50/40°F. Three independent defects, all in
`buildStylistConversationPayload`:

1. **The UI default was treated as a choice.** `effectiveActivity = activity || …` took the picker's
   `'none'` — sent on every turn — as authority. This is the same ruling the execution router
   already received (`provider.js`, 2026-09-15): a structured
   activity is authority only when it is a real choice; otherwise `extractExplicitActivity` reads
   the user's words. A literal `none` is now never recorded — *not chosen* is not *chosen none*.

   Two refinements this uncovered, both found by existing tests rather than by inspection:
   - **An activity read from this turn's own sentence is not thread context.** It belongs in
     established context (the model must see it), but counting it as evidence that the thread
     already had context flipped a fresh request into `correction` — "Give me one complete outfit.
     This is ordinary sightseeing and walking, not exercise." reads as a correction only if you
     believe there was something to correct. `hasThreadContext` now excludes it.
   - **Display prose is rebuilt only when the user stated BOTH endpoints.** "hot, highs 85F" states
     a high and no low; the extractor's single-value branch collapses that to 85/85, which is right
     for the profile (every composer path's stated-weather resolution does the same) but must never
     be written back as the user's own words — that would invent a low they never gave and discard
     the qualifier they did give. One-sided statements keep their original wording verbatim.
2. **The structured profile was deleted on exactly the turns that stated weather.**
   `effectiveWeatherProfile = explicitTurnWeather ? null : restoredWeatherProfile` — a new statement
   correctly supersedes stored physics, but nulling left only display prose. It now **replaces**
   the profile, composed through the existing stated-weather function
   (`weatherProfileFromStatedText`, exported from `stylingContext.js`) so the codebase keeps one
   such heuristic rather than growing a second.
3. **`/` was not a range separator.** `extractWeatherContext('50/40°F')` returned `"40°"` and
   `extractStructuredUserWeather` returned `{high_f:40, low_f:40}` — the stated high silently lost.
   Both extractors now accept `/`. This is parsing, not interpretation: no climate knowledge added.

Verified at the boundary and across the handoff:

| | before | after |
|---|---|---|
| `established.activity` | `none` | `walking` |
| `established.weather` | `50°` | `a forecast high of 50°F and low of 40°F` |
| `threadState.weather_profile` | absent | `{source: stated, high_f: 50, low_f: 40, is_cold: true}` |
| restored into `toolContext` | — | `{highF: 50, lowF: 40, isCold: true}` |

One existing test asserted `'weather_profile' in threadState === false` for an explicit-weather
turn. That assertion encoded the defect, so it now asserts the stated physics replace the stored
ones (78/56 → 95) rather than vanishing.

### (b) The selected-piece composer republished the taste lists

`selectedItemVisualComposerSystemPrompt()` serialized **both** `OCCASION_PROFILES` (22 soft-key
occurrences) and `ACTIVITY_PROFILES` (12) under `RULES-AS-DATA` — the third path publishing the
soft lists, with its own wording, after §9 removed them from the composer tails and §10 from `/ask`.
That is precisely how two chat paths end up giving different taste instructions for the same
garment.

One shared filter now serves every serializing path: `stripSoftRankingRules()` in `occasions.js`
(which imports nothing, so there is no cycle), used by `core.js` for `/ask` and by `routes/ai.js`
for both lists here. The private helper added in §10 was replaced by it. Hard keys are untouched —
the test pins that `prohibited_footwear`, `register_ceiling`, `required_occasion_tags` and the
classification fields still reach the model, and that no `preferred_*` / `discouraged_*` key does.
