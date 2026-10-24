# Explore: an opt-in mode for less obvious outfits around a piece (spec, 2026-10-24)

**Status:** active. This is the owner-approved direction (2026-10-24, option 1 of three), and all three
open decisions are settled (§5). It is implemented on `feat/selected-piece-explore` and verified
offline and in the mock-AI sandbox (§6). The paid run awaits owner approval.

## 1 · Why

**What the owner said.** After the stylist-chosen roster
(`docs/selected-piece-model-roster-spec.md`), the first card turn on a piece rates well. Its last
blind round scored 5 on every card, but it is still "too safe". If those are the ideal pairings,
that is fine; the owner would still like to see other, less obvious solutions.

**What creativity means here.** It is about **outfit styling, across all its dimensions**, not about
swapping print for black-on-black. The owner was unsure what "safe" would even mean in this context.

**What the replay shows** (`scratch/flare_vibe_mood_replay.mjs`, black flare jeans, 6 calls,
2026-10-24):
- every card rated 5;
- only 1 of 6 sets was "interesting, not just safe";
- the sets kept one formula: two black-on-black outfits plus one print outfit, the same print blouse
  in five of six;
- a Mood line ("more interesting outfits, not just safe black columns") did not change it;
- removing "clean columns" from the city vibe produced the one interesting set, once in two runs.

The owner judged this weak data and asked for a separate option instead of changing the default.

**Two things in today's code push toward the expected answer:**
- **The variety rule.** The shared composer system prompt (`styling-engine/prompts.js`) says:
  "Select each outfit on its own merits… Prefer a meaningfully different alternative only when it
  is at least as strong; never weaken an outfit to increase variety." That is right for the
  default, where the strongest answer is the point. It also guarantees that, when the strongest
  answer is the obvious one, every card leans towards it.
- **The roster step is told neither the card count nor the goal.** `selectedPieceRosterSystemPrompt`
  asks for "several genuinely different outfits" with no number and no mode. It shortlists for the
  expected outfits, and the composer then has nothing else to work with.

## 2 · The design

### 2.1 What Explore asks for, by intent rather than by list

One instruction, shared by both steps, says what Explore is for and leaves the dimensions to the
stylist. In line with the owner's rule against spelling out every case, it names no styling
dimension, garment category or technique.

> EXPLORE. The outfits anyone would assemble first around this garment, its obvious and expected
> pairings, are already known, so leave them out. Show outfits that still work, and work for a
> reason that is not the obvious one. Where that reason comes from is your judgment for this
> garment and this wardrobe. Each outfit takes its own direction: no two should be variations of
> the same idea. Every outfit must still be wearable for the request and physically sound, and you
> should be able to say in its reason what makes it work.

This also answers "what is safe": safe is not a property of a garment or a colour. It is the outfit
she would reach for first, which in Explore is the one to skip. The default mode remains the place
for the ideal pairings.

### 2.2 Where it changes behaviour

All of these apply only when Explore is on; the default is byte-identical to today.

| Step | Default (unchanged) | Explore |
|---|---|---|
| Roster call (`chooseSelectedPieceRoster`) | current prompt | the same prompt plus the EXPLORE instruction and the number of outfits the composer will build ("you are choosing for 5 outfits") |
| Composer system prompt (`selectedItemVisualComposerSystemPrompt`) | includes the variety rule | the variety rule is replaced by the EXPLORE instruction: one rule swapped, not appended, so the two never compete |
| Card count (`SELECTED_PIECE_OUTFIT_COUNT`) | 3–4 | exactly 5 |
| Occasion vibe (request line + profile list in the system prompt) | each profile's `vibe` | each profile's `explore_vibe` where it has one (§2.2.1), in both places; profile data, not string surgery on the prompt |
| Reply header (`formatStructuredOutfitFeedback`) | "Signature / strongest direction" for card 1 | no "signature/strongest" framing; each card is headed as an explore direction |

#### 2.2.1 Explore vibes, for every occasion (owner-approved, 2026-10-24)

Explore is available for every occasion. In Explore, a vibe keeps what the occasion itself asks
for: register, comfort, movement and the mood of the event. It drops words that prescribe how the
outfit should look (palette, texture, silhouette), because those are what Explore asks her to go
beyond. Each profile in `styling-engine/occasions.js` gains an `explore_vibe`; a profile without
one uses its `vibe` unchanged. The default mode keeps every vibe as it is.

| Occasion profile | `vibe` (default, unchanged) | `explore_vibe` | Dropped in Explore |
|---|---|---|---|
| city_smart_casual | polished, comfortable, walk-friendly, clean columns | polished, comfortable, walk-friendly | clean columns |
| evening_social | sharp, artistic, low-key drama, deep color palettes, rich textures | sharp, artistic, low-key drama | deep color palettes, rich textures |
| outdoor_daytime_social | relaxed, creative, textured, airy, intentional | relaxed, creative, intentional | textured, airy |
| home_loungewear | comfort-first, soft, unstructured | comfort-first, soft | unstructured ("soft" kept: comfort for loungewear) |
| casual | low-key, easy, everyday, unforced | — (uses `vibe`) | nothing |
| gallery_art_event | artful, intentional, gallery-appropriate | — (uses `vibe`) | nothing |
| concert | expressive, grounded, movement-friendly | — (uses `vibe`) | nothing |

Test: with Explore on, no request carries a default `vibe` that has an `explore_vibe`. With
Explore off, every request carries the unchanged `vibe`.

To make the swap safe, the variety rule moves into one exported constant (`OUTFIT_VARIETY_RULE`)
that the shared prompt template uses. Explore replaces that constant. The Whole Wardrobe composer
and `/ask` keep it, because Explore is not offered there.

**Unchanged in Explore:**
- the eligibility gates (occasion, register, season, weather, activity, footwear, owner exclusions);
- the photo roster's gates;
- slot validation and the name check (`docs/composer-slot-name-check-spec.md`);
- the layering check;
- the shared wearability evaluator;
- worn-photo-first;
- the model and the thinking level, held at today's setting so that one thing changes at a time.

Explore loosens nothing about wearability. It changes only what the stylist is asked to look for.

### 2.3 Roster size

The cap stays at 40. The constraint is how many garments she picks: 15–34 so far, varying between
identical calls. Telling the roster step "5 outfits, each its own direction, beyond the obvious" is
expected to raise the pick without a per-role count. If her Explore picks still come out thin, the
fallback is raising the cap, which is a one-number change, decided from the test in §4.

### 2.4 Interface

The piece form ("Use my wardrobe with…", `StylistChat.jsx`, next to Style direction and "Mood or
styling request") gets one toggle, **Explore**. It is off by default and not persisted.
- A short hint under it: "Outfits beyond the obvious pairings for this piece." (owner choice, 2026-10-24)
- It is sent as `explore: true` in the `/generate-outfits-for-piece` body, and carried in the
  thread's `stylingContext`, so a follow-up knows the cards came from Explore.
- Card labels show the stylist's own direction names. The strength chip reads "explore" in place
  of "signature/strong".

**Not in v1:**
- Explore from the `/ask` chat (the `generate_outfits` tool);
- Explore for Use my wardrobe (no anchor);
- making Explore the default.

### 2.5 Small fix carried in the same change

The "Style direction" dropdown sends only the bare ID (`Mission: unexpected_pairing`) to the roster
and composer calls. The descriptions in the tooltip legend (`OUTFIT_MISSIONS` in `prompts.js`)
never reach the stylist. Send the label and description instead, for example "Style direction:
Unexpected Pairing — experiment with a less obvious combination…". This is independent of Explore,
and it is a bug either way.

## 3 · Cost

The figures are measured on the live runs (Gemini 3.5 Flash-Lite):
- composer input is 26–38k tokens, almost all photos, ≈ $0.009–0.011;
- each card is about 270 output tokens, ≈ $0.0007;
- each extra roster photo is about 1k tokens, ≈ $0.0003.

| | Default today | Explore (5 cards) |
|---|---|---|
| Roster call | ≈ $0.005–0.007 | ≈ $0.005–0.007 (slightly longer prompt) |
| Composer | ≈ $0.009–0.013 | ≈ $0.011–0.018 (2 more cards, likely a larger pick) |
| First turn | ≈ $0.016 | ≈ $0.018–0.024 |

The default's cost is unchanged.

## 4 · Testing

**Offline, no provider:**
- With Explore off, the roster request, the composer request and the card count are byte-identical
  to today's: a snapshot of each built request.
- With Explore on:
  - the composer prompt contains the EXPLORE instruction and does not contain the variety rule;
  - the roster prompt states the outfit count;
  - the schema asks for exactly 5 outfits.
- The EXPLORE instruction names no garment category or styling dimension. A test pins this, as
  with the roster prompt's no-counts test.
- The Whole Wardrobe composer prompt still contains the variety rule.
- Style direction: the request carries the label and description, not the bare ID.
- The interface sends `explore` only when the toggle is on. The mock AI handles Explore requests,
  so the sandbox stays free.

**Paid, owner approval first:** live first turns on four garments (the olive utility skinny pants,
the black wide-leg knit trousers, the black solid long shirt, the black flare leg denim pants),
2 replicates each:
- **Explore:** 8 turns, ≈ $0.18;
- **default:** 4 new default turns as the same-day comparison, ≈ $0.07;
- **total:** ≈ $0.25.

The sheets are blinded, with hanger photos and the existing rating questions, plus one more:
**"Would you wear it, or is it interesting but not for you?"** (wear / interesting only /
neither). That separates "interesting" from "worse".

**Pre-registered reading:**
- **Explore works** if its sets are rated "interesting" (yes) in at least 5 of 8, against the
  default's rate. Its mean card rating must not fall below 4.0, and at least half its cards must be
  rated "wear".
- **If it is more interesting but rarely wearable,** the instruction pushed too far, so reword it
  before shipping.
- **If it is no more interesting,** read the roster picks first, before changing the composer
  wording.

## 5 · Open owner decisions

1. ~~The hint text under the toggle.~~ **Decided 2026-10-24:** "Outfits beyond the obvious pairings for this piece."
2. ~~Whether Explore should drop the city vibe's "clean columns".~~ **Decided 2026-10-24: removed
   in Explore only**, and extended the same day to every occasion's look words (§2.2.1). The
   default keeps every vibe.
3. ~~Whether Explore should later be offered from the chat.~~ **Decided 2026-10-24: the toggle only for
   now.** Chat is reconsidered after the form version is rated.

## 6 · Implementation and offline verification (2026-10-24)

**Code:**
- `styling-engine/occasions.js`: `explore_vibe` on four profiles; `occasionVibe`;
  `stripSoftRankingRules(profiles, { explore })`, which never emits `explore_vibe` as a field.
- `styling-engine/prompts.js`: `OUTFIT_VARIETY_RULE` (the same text, now one constant) and
  `EXPLORE_INSTRUCTION`.
- `styling-engine/selectedPieceRoster.js`: `selectedPieceRosterSystemPrompt(max, { explore, outfitCount })`.
- `routes/ai.js`:
  - `selectedItemVisualComposerSystemPrompt({ explore })`, which swaps the rule and refuses if it is
    not present exactly once;
  - `selectedPieceOutfitCount` (5 in Explore);
  - `styleDirectionLine` (§2.5);
  - `explore` threaded through `generateOutfitsForPieceInternal` → roster → composer → name
    correction;
  - the post-validation cut is now the mode's count (it was a fixed 4, which would have dropped the
    fifth card);
  - Explore cards carry `strength: 'explore'` and keep the model's own rating as `modelStrength`.
- `styling-engine/core.js`: the reply header reads "· Explore" with "Explore direction" sections.
- `StylistChat.jsx`: the toggle and hint; `explore: true` in the request and the thread's
  `stylingContext`; an "Explore" request chip.
- `docs/occasion_profiles_ratification.md`: Amendment 4.

**Tests:**
- `test/selected_piece_explore.test.js` adds 8 tests: vibes, the prompt swap, the instruction
  naming no styling dimension, the roster prompt, Style direction, end to end with Explore on and
  off, and the interface.
- `test/aiEndpointContracts.test.js` now expects the Style direction label and description, not
  the bare ID.
- `prompt_equivalence` still passes byte for byte.
- `node --test test/`: 2,580 of 2,580 pass.

**Sandbox** (mock AI, restarted fresh): the toggle sends `explore: true`; the response asks for 5
outfits, carries the roster's Explore prompt, heads the reply "· Explore", and shows the "Explore"
chip. The sandbox mock returns a single canned card that omits the anchor, so it is flagged for
review: that is the mock's own behaviour, not Explore's.

**Paid run, prepared and not sent:** `scratch/selected_piece_roster_live.mjs` gains `--explore`,
`--rep N`, `--with-flare` and `--dry`. Its plan is in §4.

## 7 · Live check (2026-10-24, owner-rated)

The run covered 12 live first turns with the shipped code on an isolated DB copy, using Gemini 3.5
Flash-Lite, for $0.214:
- 8 Explore turns: 4 garments × 2;
- 4 same-day default turns.

The sheet was `scratch/selected_piece_roster_live_sheets.mjs explore`, with hanger photos. **It was
not fully blind:** Explore sets have 5 cards and default sets 3, as the sheet stated.

| | Explore (8 sets, 40 cards) | Default (4 sets, 12 cards) |
|---|---|---|
| Sets "interesting, not just safe" | **8 yes** | 0 yes, 3 partly, 1 not rated |
| Mean card rating | 4.75 | 4.83 |
| Cards you would wear | 31 wear, 8 interesting only, 1 neither | 11 wear, 1 interesting only |
| Set ratings | 5, 5, 4, 4, 4, 5, 5, 5 | 5, 5, 5 (one not rated) |

**Pre-registered reading (§4):** Explore works.
- 8 of 8 sets were interesting; the bar was at least 5 of 8.
- The mean card rating was 4.75; the bar was at least 4.0.
- 31 of 40 cards (78%) were "wear"; the bar was at least half.

**Where it fell short:**
- On the black wide-leg knit trousers, 6 of 10 Explore cards were "interesting only".
- On the black long shirt (run 1), one card, the shirt worn open over a black turtleneck with
  charcoal trousers, was "neither" (3).
- Several Explore sets still open with a monochrome column on the black anchors, which is the
  expected pairing the instruction asks her to leave out: "Monochrome Fitted Column", "Monochrome
  Knit Flow", "Urban Monochrome Column". This is noted for a later look. No change was made, because
  the pass bars were met.
