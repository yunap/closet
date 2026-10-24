# Read the garment first — selected-piece composer (design, 2026-10-24)

**Status:** historical — replay run and rated 2026-10-24; **no arm beat control, nothing carried** (§7). Production unchanged; the follow-up is [selected-piece-model-roster-spec.md](selected-piece-model-roster-spec.md).

## 1 · What the owner saw

In three piece threads from 2026-10-24, the stylist gave better advice once she had answered
questions about the garment. In those turns she described the garment and named directions for it:
- `thread_1792821629010`: olive utility skinny pants
- `thread_1792822990468`: black wide-leg knit trousers
- `thread_1792823824264`: black solid long shirt

Each thread followed the same sequence:
- **Turn 2:** the first cards, from the selected-piece composer.
- **Turn 4:** "let's think about these… what else can you see".
- **Turn 6:** "tell me how you see these pants and how you decide what to pair them with?"
- **Turn 8:** "give me few examples following the above directions".

The turn-8 cards took distinct directions and were reasoned from what the garment is. On the knit
trousers the owner said "these look better". The olive-pants turn 8 repeated turn 2 because of the
repeat bug fixed in 304e30c, so it says nothing about this pattern.

## 2 · Why the first turn never gets that step

The first card turn is `generateOutfitsForPieceInternal` → one structured call, subflow
`selected_piece_visual_composer` (`routes/ai.js`). Its request is shown below; the figures were
checked against the three captures in `~/.wardrobe-captures`:
- the anchor photo at high detail and 25 support photos, ~28k image tokens;
- the shared `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` plus the selected-anchor contract;
- schema `composerOutfitSlotsSchema({ minOutfits: 3, maxOutfits: 4 })`.

Three facts explain the gap:
- **She does no reasoning before the cards.** The composer runs Gemini at
  `thinking_level: low`, and all three captures report `total_thought_tokens: 0`. Before her first
  slot ID, the only thing she writes is `layering_check`.
- **The prompt tells her to compare silently.** It says "Do all comparison silently… never expose
  deliberation". It also says "Select each outfit on its own merits… never weaken an outfit to
  increase variety". So each card is chosen on its own, and the set settles into variations of one
  safe idea: three dark-column cards for the black shirt.
- **The later turns that worked ran differently.** They ran in the `/ask` tool loop at
  `thinking_level: medium`, with her own garment read and directions already written into the
  history.

Two things therefore differ between turn 2 and turn 8: the thinking budget, and the written read
and directions. The test in §5 separates them.

## 3 · The change

The read and directions are written once for the set, before any outfit, and each card says which
direction it builds. This is not a per-card explanation.

**Schema** (selected-piece call only, behind an option like `stylistNote`). Two new top-level
fields come before `outfits`, and each outfit gets one new first field:

```
garment_read : string              — written first
directions   : [ { name, idea } ]  — 2–4 items
outfits[i].direction : string      — first field of each card, the name of one direction
```

Gemini fills structured output in schema order (the captured output writes `layering_check` before
`label`, as declared), so the read is written before any ID is chosen.

**Instruction** (appended to the selected-piece system prompt):

> READ THE GARMENT FIRST. Before composing, write `garment_read`: how you see the selected garment
> in its photograph and recorded facts — its weight, drape, line, volume, texture and character —
> and what that asks of the pieces worn with it. Then write `directions`: two to four distinct
> ways to wear this garment that the wardrobe shown can carry well, each a styling idea rather than
> a list of garments. Build each outfit from one direction and name it in that outfit's
> `direction`. Leave out a direction the wardrobe cannot carry well rather than building it weakly.

**What it deliberately does not do:**
- It names no garment category, verdict or styling rule, so she reasons rather than follows a list.
- The rule against weakening an outfit for variety stays. A direction the wardrobe can't carry is
  dropped, not built badly.
- It adds no gate, repair or validation of the read. A `direction` that matches no listed name is
  logged, not rejected.

**What the 2026-09-15 day-wear pilot taught.** That pilot added a per-card explanation
(`wear_through_day`) written after the slots. It came out flat: the explanations described the
choices rather than correcting them, and 3 of 6 rationalized a poor choice. This design differs on
the axis that pilot exposed:
- the read is written before the cards and is about the anchor garment, not about a chosen outfit;
- it then decides the cards, through `direction`.

The rating in §5 still asks the rationalization question directly.

## 4 · Offline work (no model calls)

1. **Replay harness** (`scratch/garment_read_replay.mjs`). Each arm's request is built from the
   three captured wire requests, so the roster, photos and garment lines are the ones the owner saw:
   - `20261024T055745633Z-p97929-63e73900-0002`
   - `20261024T062205474Z-p99897-deecea28-0002`
   - `20261024T063425667Z-p1826-0b563123-0002`

   All 26 image hashes per request are present in `~/.wardrobe-captures/images` (checked).
   No app code changes for the experiment.
2. **Preflight**, which must pass before any send:
   - Arm A's request hashes equal to the captured `requestSha256`.
   - Arm B differs from A only in the appended instruction, the new schema fields and the token cap.
   - Arm C differs only in `thinking_level` and the token cap.
   - Every image resolves.
   - It prints a cost estimate computed from the captured token counts.
3. **Dry run:** it prints the three arms' diffs per thread and stops.
4. **Review sheets** (`scratch/garment_read_review_sheets.mjs`), produced from the outputs:
   - blinded, with arm order shuffled per thread;
   - card photos taken from the capture images.

   The sheets come in two parts so the read cannot unblind the arms:
   - **Part 1** (`part1_cards.html`) shows cards only, with `garment_read`, `directions`,
     `direction` and `layering_check` left out.
   - **Part 2** (`part2_reads.html`) shows arm B's reads and directions, and is opened only after
     Part 1 is rated.

   `key.json` maps set numbers back to arms. *(Amended 2026-10-24, before rating: the first draft
   showed the read on B sheets, which would have revealed the arm.)*

If the owner's rating shows B wins, production follows in its own change: the option on
`composerOutfitSlotsSchema`, the instruction constant, and contract tests. Those tests check that:
- with the option off, the request is byte-identical to today's;
- with it on, the only differences are the declared ones;
- the instruction contains no category or verdict vocabulary;
- the new fields pass through `resolveComposerSlotOutfit` untouched.

## 5 · The paid run (for approval; not run)

The run would use Gemini 3.5 Flash-Lite, the composer call only, from the frozen captures. It has
three arms:

| Arm | Change | Est. per call |
|---|---|---|
| A control | exact captured request | $0.013 |
| B read first | instruction + schema; `max_output_tokens` 2900 → 3500 | ~$0.015 |
| C think more | `thinking_level: medium` only; cap +4000 (thinking counts against it) | ~$0.02 |

**Cost:** 3 threads × 3 arms × 2 replicates = 18 calls, **≈ $0.30**. One replicate (9 calls) is
≈ $0.15, at the cost of seeing less of each arm's variance.

**Owner rating** (blinded, per thread):
- each card 1–5;
- each set: does it show distinct directions (yes / partly / no)?
- B only: is the read true to the garment (yes / partly / no)?
- B only: do the cards follow the read, or does the read rationalize them (follows / rationalizes /
  unsure)?

**Pre-registered reading:**
- **B wins:** its set rating beats A in at least 2 of 3 threads in both replicates, with at most
  one read marked rationalizing.
- **If C ≈ B:** the cheaper change is the thinking level, with no schema change.
- **If neither beats A:** nothing is carried, and the raw outputs are read before any further
  prompt change.

## 6 · Open owner decisions

1. **Approve the paid run:** 18 calls (≈$0.30) or 9 (≈$0.15).
2. **If B wins, does the read reach the user?** Today the reply above the first cards is the field
   dump from `formatStructuredOutfitFeedback`, which `StylistChat.jsx` already treats as engine
   text. The garment read and directions could replace it as the stylist's own words. The owner
   found the read valuable on its own in these threads.
3. **Scope if it wins:** the selected-piece path only at first. The Whole Wardrobe and `/ask`
   `bounded_multi` composers share the same system prompt and schema, but have no single anchor
   garment to read.

## 7 · Result (2026-10-24)

The run made 18 calls for $0.276 (`scratch/garment_read_runs/2026-10-24/`). The owner rated Part 1
blind (56 of 57 cards, all 18 sets) and then Part 2.

| Garment | A set (r1, r2) | B set | C set | B distinct | C distinct |
|---|---|---|---|---|---|
| olive utility skinny pants | 5, 5 | 4, 5 | 4, 5 | partly, yes | partly, yes |
| black wide-leg knit trousers | 3, 3 | 3, 3 | 4, 3 | no, no | yes, partly |
| black solid long shirt | 5, 5 | 5, 5 | 5, 4 | yes, yes | yes, partly |

Mean card rating: A 4.35, B 4.11, C 4.33.

**Arm B's reads (Part 2):**
- true to the garment: yes 4, partly 2;
- cards follow the read: unsure for all 6.

**Pre-registered reading:**
- B beat A in 0 of 6 thread × replicate cells (5 ties, 1 loss), so **B does not win**.
- C beat A once and lost twice. Neither arm beat A, so nothing is carried.

**Why the comparison had little room to show a difference.** On the olive pants and the black
shirt, control already scored 5 in both replicates. Only the knit trousers had room to improve, and
there B's sets were rated not distinct both times.

**What the knit-trousers roster shows (no model call).** The owner's turn-8 cards were better on
this garment, and they used:
- the emerald v-neck knit sweater (996904);
- the rooster intarsia sweater (996915);
- blouses 63 and 65, and tank 996783;
- the black slip-on loafers (196).

None of these was in the first-turn composer's 26-piece roster. That roster is the anchor plus
about 32 supports pre-ranked by `selectAutomaticUseCandidatesForOutfitGeneration`
(`limit: 32`, `routes/ai.js`), from 330 active pieces. Its 12 tops include a sleeveless crop top
and three graphic tees.

The turn-8 tool loop searched the whole wardrobe instead, and attached 39 photos. So on this
garment, the stronger lead is what the composer is given rather than how it reasons. This is
recorded as a hypothesis, not a cause. The candidate cap is a documented difference
(`docs/flows/selected-piece-composer.md`), and no ruling on it exists.
