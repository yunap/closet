# Selected-piece roster: the stylist chooses what she looks at (spec, 2026-10-24)

**Status:** owner-approved direction (2026-10-24); implemented on `fix/card-explanation-layering-evidence`
verified offline, then live-checked: owner-rated blind 2026-10-24, best or tied on all three test garments (§8).

## 1 · The problem

The first card turn on a garment (`generateOutfitsForPieceInternal` → the selected-piece composer)
shows the stylist photos of a roster that code chose before she was involved. The selection,
`selectCandidatesForOutfitGeneration` (`styling-engine/rules.js`), works like this:
- It ranks every usable garment with `compatibilityScoreForSelectedItem`.
- It keeps a fixed quota per category. For a bottom anchor that is 12 tops, 8 shoes, 5 outer
  layers and 5 accessories; for a top anchor, 12 bottoms and the same rest.

The trace (`scratch/trace_selected_piece_roster.mjs`, isolated DB copy, no model call):

| Anchor | Usable in the category the outfit needs | Shown |
|---|---|---|
| black wide-leg knit trousers (996914) | 103 tops | 12 |
| olive utility skinny pants (996905) | 103 tops | 12 |
| black solid long shirt (211) | 62 bottoms | 12 |

The ranking is word matching: any top whose text says "sleeveless", "tank", "shell", "fitted" or
"short sleeve" gets +12 with any bottom, and a "relaxed" or "oversized" top gets −8 with "wide"
trousers. On the knit trousers this put:
- the rooster intarsia sweater (996915) at 61st;
- the emerald v-neck sweater (996904) at 60th.

Meanwhile a sleeveless crop top, a crochet tank and two graphic tees made the 12, in late October.

The owner's better turn-8 cards (thread_1792822990468) were built from exactly the garments this
cut. The five accessory slots are also wasted: the composer drops accessories before it shows
photos, so the stylist saw 26 garments, not 31.

The garment-read replay (`docs/garment-read-first-composer-design.md` §7) found that neither a
written read nor more thinking improved this turn. The owner's ruling (2026-10-24): "no matter how
good the thinking is, the model can't do much if it does not know about the garments."

## 2 · The change

The stylist chooses her own roster from the complete eligible catalog. The composer then works
from those photos exactly as it does today.

**1. Catalog.** The catalog is every garment the photo roster itself would accept for this request,
with no quota and no ranking:
- `evaluateVisualComposerPiecePool` over the active wardrobe, with capacity set to the whole pool,
  so its eligibility gates run and its image cap does not;
- minus pieces the automatic-use pool blocks;
- minus accessories (the composer excludes them today).

Structural exclusions follow the composer's slot vocabulary, since one outfit has one bottom or one
dress and one pair of shoes:
- a bottom anchor drops other bottoms and dresses;
- a dress anchor drops other dresses and bottoms;
- a shoe anchor drops other shoes.

Tops and outerwear stay for a top or outerwear anchor, because either can be a middle layer.

Each line is `stylistCatalogLine`: the same sparse fact line the `/ask` single-outfit catalog uses,
with no score, no tagger prose and no fit verdict. Lines are grouped by category in identity
order, so the order carries no opinion.

**2. One roster call** (`selected_piece_roster_selection`, structured, the app's normal stylist
provider). It receives:
- the anchor's photo at high detail and its garment truth line;
- occasion, season, mission, mood and activity, as the composer gets them;
- the catalog.

She chooses up to **40** garments worth seeing, across whatever roles the outfits need. The
schema is `{ roster_piece_ids: integer[] (1–40), selection_note: string }`. `selection_note` is
diagnostic only and never shown.

She chooses from text, then composes from photos. This is the `/ask` single-outfit pattern (sparse
catalog, then `view_pieces`), which produced the owner's better turn-8 cards. The founding
visual-grounding rule is about composing from text alone, and this keeps every composition on
photos.

**3. Mechanical checks, no styling.**
- IDs not in the catalog are dropped and recorded in `unknownIds`.
- Duplicates and the anchor are dropped; order is kept.
- The pick is trimmed to 40.
- The complete-outfit supply requirement (`completeOutfitSupplyRequirement`, the same contract the
  quota path uses) is checked with `buildCoveredCandidateSet`, `initialSelection` = her pick.
  - If her pick cannot make a complete outfit (say, no shoes), the coverage builder adds what is
    needed from the code ranking, and the additions are recorded (`addedForCoverageIds`).
  - That ranking survives only as this coverage source and as the fallback below.

**4. Fallback.** If the call fails, times out, or returns no usable ID, the turn uses today's
code-ranked roster. Debug records `rosterSource: 'code_ranked_fallback'` and the reason. A failed
roster never blocks a turn.

**5. Downstream.** Her roster replaces the code-ranked candidates everywhere the turn scopes to
"the roster":
- the composer's photos;
- the memory scoping (`selectedPieceRosterIds`, owner-guidance pieces).

These are unchanged:
- the photo pool's gates, which still run on her pick;
- the composer prompt and schema;
- card count;
- worn-photo-first;
- recovery, which already reads the whole wardrobe;
- footwear repair;
- validation.

Her 40 plus the anchor stay under the composer's 54-image cap, so the pool's per-category trim
never runs on her pick.

**6. Scope.** This applies to wardrobe mode only. The ideal-mode branches (`idealMode`,
`idealOnlyMode`) keep their own ranking. It covers both callers of
`generateOutfitsForPieceInternal`: the direct first turn, and `/ask`'s `generate_outfits` tool
with an anchor.

**7. Kill switch.** `WARDROBE_SELECTED_PIECE_MODEL_ROSTER=off` restores today's selection. The
default is on.

**8. Debug** (`debug.visualCritic.rosterSelection`):
- `source` and `fallbackReason`;
- `catalogCount` and `catalogCounts` by category;
- `pickedCount`, `pickedCounts`, `unknownIds` and `addedForCoverageIds`;
- `selectionNote`, `usage` and `error`.

## 3 · What it does not do

- It adds no gate and removes none. Every eligibility decision stays where it is.
- It gives the roster call no feedback memory in this version. The composer still gets all of it.
  This is a known limit: a rejected pairing cannot steer what she chooses to look at.
- It does not touch the whole-wardrobe composer, trips, capsules or the `/ask` tool loop.
- It does not delete `compatibilityScoreForSelectedItem`. Ideal mode, the coverage source and the
  fallback still use it.

## 4 · Cost

The figures are estimates from the three captured first turns (Gemini 3.5 Flash-Lite):
- **Roster call:** measured offline on the three anchors: 182–265 catalog lines plus one photo,
  ≈12–17k text tokens and ~1k image tokens in, ~400 out, ≈ $0.005–0.006.
- **Composer:** up to 41 photos instead of 26, roughly +16k image tokens, ≈ +$0.005.
- **First turn:** ≈ $0.013 → ≈ $0.024.

## 5 · Tests (offline, no provider)

1. **Catalog** (unit): contains every eligible top and excludes accessories, other bottoms and
   dresses for a bottom anchor. It keeps tops and outerwear for a top anchor. Its lines carry no
   score.
2. **Validation** (unit):
   - unknown, duplicate and anchor IDs are dropped and reported;
   - the pick is trimmed to 40 in order;
   - a pick without shoes gets shoes added from coverage, recorded in `addedForCoverageIds`.
3. **End to end** through `generateOutfitsForPieceInternal`, with a stubbed provider:
   - the composer's photos are exactly the stylist's pick plus the anchor;
   - a garment ranked far down by the code but picked by her reaches the composer.
4. **Fallback:** an error, empty IDs, or the kill switch each give today's roster, and debug says
   why.
5. **Existing selected-piece tests** pass unchanged. Their stub answers the roster call with
   outfit JSON, which takes the fallback.
6. **Mock AI:** `WARDROBE_MOCK_AI` returns a roster from the catalog, so the sandbox stays free.

## 6 · Verification before any paid run

Run `scratch/trace_selected_piece_roster.mjs` on the three anchors. It shows:
- catalog sizes and category counts;
- that the turn-8 garments (996904, 996915, 63, 65, 996783, 196) are in the knit-trousers catalog;
- the exact composer request a pick would produce.

The paid check is for owner approval, not run: one live first turn per anchor (3 runs,
≈ $0.07). Each would be rated against its frozen control output from the replay.

## 7 · Offline verification (2026-10-24)

`scratch/verify_selected_piece_model_roster.mjs` runs the shipped `chooseSelectedPieceRoster` on an
isolated DB copy, with the provider stubbed (no network, no cost):

| Anchor | Catalog | Today's code roster | The thread's later suggestions, now in the catalog |
|---|---|---|---|
| knit trousers 996914 | 182 (103 tops, 41 outerwear, 38 shoes) | 30 | all six turn-8/10 garments; the code roster had none of them |
| olive pants 996905 | 182 | 30 | 150, 196, 990362, 996922; the code roster had none of them |
| black long shirt 211 | 265 (102 tops, 62 bottoms, 22 dresses, 41 outerwear, 38 shoes) | 30 | 92, 996905, 361, 151, 187 |

Two black-shirt suggestions stay out, correctly:
- 167, under an owner exclusion ("user-excluded for city");
- 122, blocked by automatic-use for low tag confidence.

The thread's prose turn had suggested both, because the prose path does not gate.

Tests: `test/selected_piece_model_roster.test.js` (8 tests). The full `test/` suite passes, 2,567
of 2,567.

## 8 · Live check (2026-10-24, owner-rated blind)

`scratch/selected_piece_roster_live.mjs` ran one live first turn per anchor, with the shipped code
on an isolated DB copy, pinned to Gemini 3.5 Flash-Lite like the controls: 6 calls, ≈ $0.05.

The owner rated each live set blind alongside the two control sets from the garment-read replay,
which were made with the old code-ranked roster
(`scratch/selected_piece_roster_live_sheets.mjs`, hanger photos):

| Anchor | Control r1 | Control r2 | Stylist roster | She picked (of catalog) |
|---|---|---|---|---|
| olive utility skinny pants | 4 (5,4,5) | 4 (5,4,5) | **5** (5,5,5) | 22 of 170 |
| black wide-leg knit trousers | 3 (3,3,5), partly distinct | 3 (3,3,5), partly distinct | **4** (4,5,4), distinct | 21 of 170 |
| black solid long shirt | 5 (5,5,5) | 5 (5,5,5) | 5 (5,4,5) | 15 of 265 |

Set ratings are shown with card ratings in brackets. Mean card rating: stylist roster 4.67,
controls 4.44.

**How to read it:**
- The stylist roster rated best on two garments and tied on the third.
- The biggest gain came on the knit trousers, the case the cap was diagnosed on.
- This is one live set per garment, so it is direction, not proof.

**Open:** she picked well under the 40 allowed (15–22, below the old 26). On the black shirt she
chose 4 of 62 bottoms. "Up to 40" reads as a ceiling. Asking her to bring several real
alternatives for each role is the obvious next wording to test.

## 9 · Roster wording: a shortlist to compare (2026-10-24)

The prompt now frames the pick as a shortlist that will be compared on photographs. It asks for
several real alternatives for every part the outfits need, and says the cap ("You may choose up to
40") without naming any per-role count.

It was replayed roster-only (`scratch/selected_piece_roster_prompt_replay.mjs`): the three captured
live roster requests were sent again with only the system prompt changed. That was 6 calls, ≈ $0.038.

| Anchor | Old prompt (live) | New prompt r1 | New prompt r2 |
|---|---|---|---|
| olive utility skinny pants | 22 (12 top, 5 outer, 5 shoes) | 40 (22, 9, 9) | 30 (14, 8, 8) |
| black wide-leg knit trousers | 21 (10 top, 7 outer, 4 shoes) | 22 (9, 7, 6) | 18 (6, 7, 5) |
| black solid long shirt | 15 (3 top, 4 bottom, 4 outer, 4 shoes) | 32 (8, 9, 7, 8) | 39 (10, 11, 8, 10) |

**How to read it:**
- The olive pants and the black shirt roughly doubled, and the black shirt's bottoms went from 4
  to 9–11.
- The knit trousers did not change. Her notes there describe three narrow directions ("sleek
  minimal column with fitted dark tops", "cozy textured monochrome") and choose for those.
- Pick size is not quality. The knit trousers' 21-piece pick was the one rated 4 against the
  controls' 3. No cards have been composed or rated from the new picks.

## 10 · Live check of the shortlist wording (2026-10-24, owner-rated blind)

`scratch/selected_piece_roster_live.mjs live_roster_v2` ran one live first turn per anchor with the
§9 wording: 6 calls, $0.041.

| Anchor | Live picks with §9 wording | Previous live set ("up to 40") | Shortlist wording |
|---|---|---|---|
| olive utility skinny pants | 24 | 5 (5,4,5), partly distinct | 5 (5,4,5), distinct |
| black wide-leg knit trousers | 25 | 5 (5,5,5) | 5 (5,5,5) |
| black solid long shirt | 16 | 4 (5,4,5) | 5 (5,5,5) |

The owner rated both sets blind (`scratch/selected_piece_roster_live_sheets.mjs v2`). Set ratings
are shown with card ratings in brackets. Mean card rating: shortlist 4.89, previous 4.78.

**How to read it:**
- **Noise:** the same previous live sets scored ±1 against their first rating (knit trousers 4 → 5,
  black shirt 5 → 4), so the one-point difference here is within noise.
- **Outcome:** both wordings now rate at or near the top on all three garments. The shortlist
  wording is no worse and is kept.
- **Pick size:** this varies more between calls than between wordings. Across three calls with the
  same wording, the black shirt got 16, 32 and 39 picks. The wording does not reliably raise the
  pick size.
