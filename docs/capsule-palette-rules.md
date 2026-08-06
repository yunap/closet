# Capsule palette rules — what the established frameworks say, and what this engine does

> **Start at [capsule-index-and-plan.md](capsule-index-and-plan.md)** — the map of every capsule
> document, the live-run findings, and the sequenced plan. This document is one piece of that.


Researched 2026-07-30. Companion to `docs/capsule-real-world-rules.md`, which covers category
counts. This one covers colour. Same standard: every claim is cited, and every engine number
below was measured, not recalled.

## Why this document exists

The colour constants in `styling-engine/outfitSetPlanner.js` — the 17-entry
`CAPSULE_NEUTRAL_COLORS` list, the `+12` neutral bonus inside `capsuleVersatilityScore`, and
`CAPSULE_STATED_PALETTE_BONUS = 14` — were invented in code, exactly like the category quotas
were. Nothing ratifies them. This document is the source they should have been derived from.

## What the frameworks specify

### Palette size: roughly 5–9 shades, structured in tiers

| tier | count | typical members |
|---|---|---|
| base neutrals | **2–4** (most say 2–3) | black, white, beige, navy, grey, camel |
| secondary / "main" colours | **1–3** | olive, rust, burgundy, forest green |
| accents | **1–4** | whatever genuinely flatters and reads as personality |

Two representative structures: *"2 to 3 base neutrals… 1 to 2 secondary colors… 1 to 2 accent
colors"* ([Rue Sophie](https://ruesophie.com/blogs/the-style-edit/capsule-wardrobe-color-palette)),
and a *"nine-shade palette made of three main colors, two neutrals, and four accents"* from the
same source, offered as an upper bound that still *"ensures variety without chaos."*

Neutral-adjacent colours — olive, tan, navy, dusty blue — are consistently described as extending
the base rather than counting as accents.

### Proportion: neutrals dominate, accents are capped

Base neutrals should be *"around 60 to 70%"* of the wardrobe. Accents run to about **25%** of
items, with the sharper operational form: **no more than one or two garments per category in
accent colours**
([A Considered Life](https://www.aconsideredlife.co.uk/2023/11/create-a-wardrobe-colour-palette.html)).

> **Recorded discrepancy — do not cite 60/30/10 as a wardrobe rule.** Several summaries state the
> palette ratio as "60% base neutrals / 30% accent / 10% metallic." Reading the primary source, that
> split is prescribed **for an individual outfit** — *"roughly sixty percent neutral, thirty percent
> secondary color, and ten percent accent in an outfit"* — not for the composition of the wardrobe.
> The wardrobe-level figure from the same body of guidance is 60–70% neutrals. The two are easy to
> conflate and they are not the same claim.

### The connectivity rule — the one that is actually operational

> "each accent should pair with every neutral and at least two main colors, so that a single accent
> sweater or skirt links into several outfits instead of demanding new companion pieces"
> — [AI Color Analysis](https://aicoloranalysis.com/blog/capsule-wardrobe-color-palette)

This is the only published colour rule that is directly testable against a roster, and it is the
one that matters most here: **an accent piece that does not link is not a colour problem, it is a
wasted slot.** A cohesive palette is described as what makes the wardrobe *"interchangeable"* —
colour cohesion is the mechanism by which a capsule's combination count is real rather than
nominal ([Closet Cachet](https://closetcachete.com/style-guide/build-a-capsule-wardrobe)).

### Prints: no published numeric ratio

Sought and not found. The prints-vs-neutrals guidance is qualitative — pick a print as the colour
story's origin, or use prints as accents against a neutral base — with no recommended count or
proportion ([Closet Choreography](https://closetchoreography.com/capsule-wardrobe-colors-how-to-make-a-capsule-wardrobe-with-prints-vs-neutrals/)).
The former `statement_presence` post-condition (at least one `pattern_complexity: loud` piece) had
no published numeric basis. It has since been removed as a universal hard capsule rule. The roster
model may still choose expressive pieces when they earn a job; code does not manufacture one from
the season label.

## What this engine currently does

> **Current implementation note, 2026-08-06.** The table below records the deterministic
> selector's original per-piece levers and is retained as provenance. Production roster selection
> now defaults to the visual roster model, whose prompt receives the neutral-foundation and
> requested-family contract. Deterministic fallback is constrained to the same family boundary.
> See [capsule-current-behaviour.md](capsule-current-behaviour.md) for the active end-to-end flow.

Every colour lever is **per-piece**. Measured by reading `outfitSetPlanner.js`:

| lever | location | scope |
|---|---|---|
| `CAPSULE_NEUTRAL_COLORS`, 17 entries, **substring** matched | line ~594 | per piece |
| `+12` "recombines with everything" neutral bonus, suppressed only when `pattern_complexity === 'loud'` | `capsuleVersatilityScore` | per piece |
| `CAPSULE_STATED_PALETTE_BONUS = 14`, applied only when the user names colours | `capsuleVersatilityScore` | per piece |
| `capsuleSimilarityKey` uses the first colour for de-duplication | line ~718 | per piece |

**Nothing in the planner evaluates the roster's colour set as a whole.** There is no term for
palette breadth, no cohesion measure, and no connectivity check. When the user states no palette —
the common case — the only colour pressure that exists is the per-piece neutral bonus.

## Measured against the live run

Roster from `thread_1785380251549`; deterministic roster recomputed on the same wardrobe and
slots. A piece counts as *pure neutral* when every tagged colour is neutral, *accent-carrying* when
any is not. Colour families collapse near-synonyms (cream/ivory/white → one slot), which is the
fairest available proxy for "shades in the palette".

| | pure neutral | accent-carrying | colour families |
|---|---|---|---|
| **framework guidance** | **60–70%** | **~25%** | **5–9** |
| model-chosen roster | 71% | 29% | **12** |
| deterministic roster | 79% | 21% | **13** |
| whole wardrobe (243 active) | 60% | 39% | 21 |

Three things follow.

1. **Proportion is roughly right, and the model is closer to guidance than the algorithm.** 71%
   against a 60–70% target; the deterministic roster's 79% is over. This is consistent with the
   earlier observation that the model's roster read as more coherent — it is not a subjective
   impression, it lands nearer the published proportion.
2. **Breadth is not controlled at all.** Both rosters span 12–13 colour families against a
   recommended 5–9 shades. Nothing in the engine pushes down on this, because breadth is a
   property of the set and every lever is per-piece.
3. **The connectivity rule explains the coral maxi.** It sat in both rosters and appeared in zero
   looks — the exact failure the rule describes, an accent that demands companion pieces instead of
   linking into outfits. That finding was previously logged as a roster-utility puzzle; it has a
   name in the published practice.

## A defect this measurement exposed

`CAPSULE_NEUTRAL_COLORS` contains bare `'blue'` and is matched by substring, so any colour string
containing "blue" scores as a neutral. Seven active pieces earn the `+12` bonus by that entry
alone. Most are denim and legitimately neutral, but the guard that is supposed to catch the rest
only suppresses `pattern_complexity === 'loud'`:

- **piece 87, floral chiffon blouse, colours `pink/green/blue`, `pattern_complexity: medium`** —
  collects the full +12 "recombines with everything" bonus. A three-colour floral is not a neutral.
- piece 262, blue botanical dress (`blue/turquoise/pink`) is tagged `loud`, so the guard does
  suppress it — the leak is specifically at `medium`.

No published neutral list includes unqualified "blue"; they name navy, and treat dusty blue as
neutral-adjacent. The list is broader than any source supports at that one entry.

## Implementation status, 2026-07-30

| finding | status |
|---|---|
| neutral bonus paid to any piece with *one* neutral colour | **fixed** — `pieceReadsAsNeutral` now requires **every** tagged colour to be neutral |
| `CAPSULE_NEUTRAL_COLORS` missing genuine neutrals | **fixed** — `taupe` and `oatmeal` added |
| bare `'blue'` in the neutral list | **owner is reviewing the tags** — the auto-tagger's colour recognition is unreliable under varying lighting, so this is being corrected at the garment level rather than by narrowing the list |
| accents that link into no outfit (the coral maxi) | **disclosed, not enforced** — `describeCapsuleRosterUtilization` |
| no set-level palette breadth control | **evaluation disclosure added** — family breadth is reported after composition |
| no cohesion pressure when no palette is stated | **deferred pending Step 5 evidence** — no generation pressure added yet |

**Owner decision 2026-07-30 (superseded 2026-08-06):** the first implementation was disclosure
rather than generation pressure so the corrected model roster could be evaluated without steering
it. The subsequent live comparisons supplied that evidence and the owner ratified the operational
contract below.

**Owner decision 2026-08-06:** every capsule has an automatic neutral foundation. Aim for roughly
70% neutral or neutral-adjacent pieces; accept 60–75% so this remains a practical band rather than an
exact aesthetic formula. Colours named by the person are accent families for the remaining places,
not the whole palette, and the person never has to repeat the neutrals. If a requested accent family
is absent from the season- and lifestyle-eligible candidate bench, use neutrals rather than an
unrelated accent and tell the person which requested family was unavailable. Availability means
eligible for this capsule, not merely present somewhere in the owned wardrobe.

The requested colour is not synonymous with a hero garment. It may appear as a protagonist,
support, grounding piece, print, layer, dress, or shoe. The contract governs the roster's colour
story; it does not prescribe which aesthetic job must carry the colour.

### Live-run correction, 2026-08-06

Thread `thread_1786036700758` asked for a summer capsule in yellow, then answered the intake
question with lifestyle contexts. The first-turn request was not passed to `plan_outfit_set`; only
the second-turn lifestyle answer reached palette extraction. The model therefore selected without
yellow, the deterministic fallback introduced unrelated accents, and the closing response inferred
both a “true yellow hero” shortage and a previously “bad” cardigan from its own output. The active
wardrobe did contain eligible yellow-family pieces, including a mustard top and yellow-containing
light layers.

The resulting evidence rules are part of the palette contract:

- preserve the most recent capsule request when the next turn is its clarification answer;
- hold deterministic fallback to the same neutral/requested-family boundary as model selection;
- a roster piece absent from representative cards means only **not demonstrated**, never rejected,
  bad, or previously flagged;
- report a requested-colour shortage or wardrobe gap only from an explicit eligible-supply plan
  line. Absence from the selected roster or displayed cards is not supply evidence.

### What the neutral-bonus fix actually changed

The `+12` bonus is paid for "recombines with everything", and the old test — does *any* tagged
colour match the neutral list — paid it in full to a five-colour floral (piece 87,
`pink/green/blue/yellow/white`, qualifying on one "blue"). Requiring every colour to be neutral
keeps the two-tone patterns that genuinely do recombine (a navy/white stripe tee, a grey/black
striped cardigan) and drops the prints that do not. Across the live wardrobe the bonus now reaches
**137 pieces rather than 168**.

Switching from "any" to "every" made the neutral list's *completeness* matter in a way it never had
to before: under "any", an unrecognised neutral name was harmless because some other colour carried
the piece; under "every", it wrongly disqualifies. An audit of every colour name in the wardrobe
found exactly two genuine neutrals missing — `taupe` (10 pieces) and `oatmeal` (6) — both now
added. `silver` was deliberately left out, since published practice treats metallics as their own
tier rather than as a base neutral.

### Roster utilization

`describeCapsuleRosterUtilization` reports the roster pieces that reach no card, as a plan line
next to the shortfall disclosure. Against the live run it produces:

> `[capsule roster: 4 of 24 pieces did not make it into a look — coral solid maxi dress, olive green lightweight jacket, cream knit open cardigan, small labradorite pendant necklace]`

Counted over accepted **and** needs-review cards, because a piece inside a repairable card has a
job waiting. Deliberately a disclosure: forcing an unused piece into a look would buy the metric
with a worse outfit.

## Caveats

- **Practitioner sources, not a standard** — same caveat as `docs/capsule-real-world-rules.md`.
  Convergence across independent sources is the evidence; no single page is authoritative.
- **Colour *families* are a proxy.** The engine stores free-text colour names, not a colour space.
  Collapsing them into families is a judgement call made in the measurement script, and a different
  grouping would move the "12 families" figure. The comparison to "5–9 shades" is indicative, not
  exact.
- **These frameworks assume you are choosing a palette and then acquiring to it.** This engine
  selects from a closet that already exists. The neutral fallback is therefore essential: an absent
  requested family does not make the capsule impossible and does not authorize a different accent.
- **The accent-family rule constrains substitutions, not garment eligibility.** A neutral garment
  may always satisfy a needed structural or lifestyle job. What is forbidden is silently replacing
  the person's requested orange, for example, with an unrelated pink accent because orange supply
  was thin.

## Sources

- [Create Your Capsule Wardrobe Color Palette — Rue Sophie](https://ruesophie.com/blogs/the-style-edit/capsule-wardrobe-color-palette)
- [How to Create a Wardrobe Colour Palette — A Considered Life](https://www.aconsideredlife.co.uk/2023/11/create-a-wardrobe-colour-palette.html)
- [Your Capsule Wardrobe Color Palette Guide — AI Color Analysis](https://aicoloranalysis.com/blog/capsule-wardrobe-color-palette)
- [How to Build a Capsule Wardrobe: Fewer Pieces—More Outfits — Closet Cachet](https://closetcachete.com/style-guide/build-a-capsule-wardrobe)
- [Capsule Wardrobe Colors: Prints vs Neutrals — Closet Choreography](https://closetchoreography.com/capsule-wardrobe-colors-how-to-make-a-capsule-wardrobe-with-prints-vs-neutrals/)
- [Build a Capsule Wardrobe Color Palette — The Elegance Edit](https://theeleganceedit.com/create-capsule-wardrobe-color-palette/)
- [Developing a Colour Palette for your Wardrobe — Anuschka Rees](https://anuschkarees.com/blog/2013/05/23/developing-a-colour-palette-for-your-wardrobe)
