# Colour taxonomy — research, current-state audit, and proposed redesign

> **Start at [capsule-index-and-plan.md](capsule-index-and-plan.md)** — the map of every capsule
> document, the live-run findings, and the sequenced plan. This document is one piece of that.


Written 2026-07-30. Third in the series with `docs/capsule-real-world-rules.md` (category counts)
and `docs/capsule-palette-rules.md` (palette). Same standard: every external claim is cited, every
claim about this codebase was measured.

**Owner decision, 2026-07-30:** the colour model is redesigned and the data reconciled *before*
further capsule-palette work. The palette findings in `docs/capsule-palette-rules.md` — set-level
breadth control, accent connectivity — all depend on a colour model that can group shades, and this
codebase does not have one.

## 1. Why this is blocking

Every colour defect found while researching the capsule palette traces to one absence: **there is
no concept of a colour family anywhere in this system.** Each consumer re-invents one as a
hardcoded list matched by substring against free text.

Measured across the engine:

| list | location | entries | entries that can never match |
|---|---|---|---|
| `CAPSULE_NEUTRAL_COLORS` | `outfitSetPlanner.js` | 19 | **4** — `gray`, `khaki`, `stone`, `camel` |
| `accentList` | `attributes.js:196` | 16 | **5** — `coral`, `fuchsia`, `magenta`, `chartreuse`, `violet` |
| `MISSION_FOCAL_COLORS` | `rules.js:1664` | 25 | **9** — `coral`, `fuchsia`, `magenta`, `chartreuse`, `violet`, `terracotta`, `ochre`, `emerald`, `cognac` |
| `focalColors` | `rules.js:1897` | 25 | duplicate of the above, inline |
| `focalColors` | `rules.js:3597` | 25 | duplicate again, inline |
| `dressyColors` | `softScoreFloors.js:6` | 8 | 0 |

**Eighteen dead entries, and the same 25-name list written out three times.** These lists were
authored against an imagined vocabulary, never reconciled with the one the tagger actually emits.
`gray` is dead purely because the vocabulary spells it `grey`.

Substring matching is the other half of the same absence. It is why a five-colour floral
(`pink/green/blue/yellow/white`) scored as a neutral: `'blue'` appears in the list, `.includes()`
found it. That was patched in `pieceReadsAsNeutral`, but the patch is a workaround for a missing
model, not a fix.

## 2. What the standards say

### Two levels: family and display name

**Google's Retail API models colour exactly this way** — `colorFamilies` for the standard groups,
`colorDisplayNames` for *"the color aliases used in the website frontend"*, explicitly noting the
display name "may be different from standard color family names"
([ColorInfo](https://cloud.google.com/php/docs/reference/cloud-retail/latest/V2.ColorInfo)). Google
weights the family field above custom attributes for retrieval.

Merchant Center's standard families are **Red, Pink, Orange, Yellow, Purple, Green, Cyan, Blue,
Brown, White, Gray, Black, Mixed** — 13
([Color \[color\]](https://support.google.com/merchants/answer/6324487?hl=en)). Up to 3 colours per
item, one primary plus two secondary.

**Adaptation needed for apparel:** that list has no beige/neutral family — beige, camel and taupe
would all collapse into Brown, which destroys exactly the distinction a wardrobe needs most.

### Filter UI: swatches, and group the shades

Baymard's guidance is that fashion filters should use visual **colour swatches** rather than text
labels alone — *"Instead of solely text labels like 'Red' or 'Navy', color swatches display a
visual chip"* — with tooltips or labels for accessibility, a minimum hit area of ~7mm, and shades
of one colour grouped under a single swatch rather than listed as peers
([Ecommerce Filter UI](https://baymard.com/learn/ecommerce-filter-ui),
[Mobile Interactive Color Swatches](https://baymard.com/blog/mobile-interactive-color-swatches)).

### Which colours are neutral

The fashion consensus list: **black, white, grey, beige, brown, navy, camel, taupe, olive, cream,
ivory, stone, charcoal** — with navy, olive, brown and taupe described as neutrals *by versatility*
rather than by being achromatic
([OGLmove](https://oglmove.com/blogs/knowledge/what-are-neutral-colors-in-clothing),
[Dressarte Paris](https://www.dressarteparis.com/what-are-neutral-colors-in-clothing-neutral-style-guide/)).

**Metallics are consistently their own tier, not neutrals** — consistent with the palette
research's "10% metallics or statement pieces". Silver is therefore modelled below as `metallic`,
not `neutral`, with the caveat that a silver knit often reads as grey in wear. That one is a
judgement call and is flagged as an open question.

## 3. Current-state audit

### The vocabulary has already drifted from the data

`src/utils/colors.js` → `COLOR_OPTIONS` declares **38** shade names with hex values. The wardrobe
uses **38**. They are not the same 38:

- **`silver` is in the data but not in the declared vocabulary** — one piece carries a colour the
  system never offered. Something wrote outside the enum.
- **`periwinkle` is declared but used by nothing.**

The filter panel is populated from values present in the data, not from `COLOR_OPTIONS`, which is
why the panel shows Silver and not Periwinkle. Two sources of truth, already disagreeing.

### The panel mixes two levels as peers

Five blues — Blue, Dark Blue, Light Blue, Navy, Denim — sit at the same level with no parent.
Five greys — Grey, Dark Grey, Light Grey, Charcoal, Silver — likewise. A person filtering for
"blue" gets one fifth of their blue garments.

### A long tail that no filter needs

12 of 38 values are carried by **4 or fewer pieces**: purple×1, ivory×1, lilac×1, silver×1,
teal×2, burgundy×2, rust×2, sage×3, mustard×3, dark grey×3, denim×3, lavender×4.

### The vocabulary cannot express colours the wardrobe contains

**The coral maxi dress is tagged `pink`.** There is no `coral`, so the tagger rounded it. "Coral"
survives only in the garment's name, which is why it never appeared in any colour measurement — and
why `coral` sits dead in two engine lists that were written expecting it. Also absent: `gold`,
`khaki`, `greige`.

## 4. Ratified model

Two derived properties per shade, kept orthogonal:

- **`family`** — the hue group, for grouping and breadth. What the filter swatches collapse to.
- **`neutrality`** — `neutral` | `neutral-adjacent` | `accent` | `metallic` | `multi`. The role the
  colour plays in a palette.

Keeping them separate is what lets navy be *blue* and *neutral* at once, which a single-axis family
list cannot express and which every fashion source treats as essential.

| shade | family | neutrality |
|---|---|---|
| black | `black` | neutral |
| charcoal, dark grey, grey, light grey | `grey` | neutral |
| white, ivory, cream | `white` | neutral |
| oatmeal, beige, tan, taupe, *camel*, *khaki*, *greige* | `beige` | neutral |
| brown | `brown` | neutral-adjacent |
| navy, dark blue | `blue` | neutral |
| denim | `blue` | neutral-adjacent |
| blue, light blue | `blue` | accent |
| teal, turquoise | `cyan` | accent |
| olive, sage | `green` | neutral-adjacent |
| green | `green` | accent |
| yellow, mustard, amber | `yellow` | accent |
| orange, rust | `orange` | accent |
| red, burgundy | `red` | accent |
| pink, mauve, *coral* | `pink` | accent |
| purple, plum, lavender, lilac | `purple` | accent |
| silver, *gold* | `metallic` | metallic |
| multi | `multi` | multi |

*Italic* entries are shades added by this work. The ratified model has 15 families. Black, white,
and grey remain separate families because they are distinct retrieval and garment-entry choices,
even though all three share `neutrality: neutral`. Family answers “which colour area?”; neutrality
answers “what palette role?”. Keeping those questions orthogonal avoids collapsing useful wardrobe
filters merely because the shades play the same capsule role.

### What this collapses

| today | after |
|---|---|
| `pieceReadsAsNeutral` — 19-entry list, substring matched | every colour's `neutrality` is `neutral` or `neutral-adjacent` |
| `accentList`, `MISSION_FOCAL_COLORS`, 2 inline duplicates | `neutrality === 'accent'` |
| no palette-breadth measure (had to invent one in a scratch script) | count distinct `family` values |
| no accent-connectivity check (the coral maxi) | accents are identifiable, so linkage is checkable |
| `capsuleSimilarityKey` on raw first colour | `family` |
| adding a shade means auditing engine lists | adding a shade means one table row |

## 5. Migration

**The database schema does not need to change.** `pieces.colors` stays a JSON array of shade names;
`family` and `neutrality` are *derived* by lookup. This is much cheaper than a schema migration and
it keeps the tagger's output human-readable.

Implementation status:

1. **Complete — reconcile the vocabulary.** `lib/colorTaxonomy.js` is the canonical table;
   `src/utils/colors.js` derives its UI values from it. Coral, gold, khaki, greige, and camel are
   expressible; silver is canonical; periwinkle is removed.
2. **Complete — fix the tagger prompt.** Every tagger surface derives the allowed shade names from
   the taxonomy.
3. **Complete — point the engine at the taxonomy.** Palette-neutral checks, family similarity,
   palette extraction, and focal-colour missions use exact taxonomy properties. The final surviving
   `MISSION_FOCAL_COLORS` copy was removed in the follow-up: it now aliases the derived
   `ACCENT_COLOR_NAMES`.
4. **Outstanding data work — targeted retag only.** Not the wardrobe. Only pieces whose true colour
   the old vocabulary could not express — the coral maxi is the known case; an owner-reviewed
   listing pass over `pink`/`orange`/`red` pieces would find the rest. This is a handful of pieces,
   not 243.
5. **Specified, not implemented — Wardrobe UI.** The four related surfaces and their shared
   interaction contract are recorded in
   [wardrobe-color-controls-spec.md](wardrobe-color-controls-spec.md). The mandatory expert-panel
   review still precedes material UI implementation.

**Ordering risk:** step 3 changes engine behaviour (which pieces read as neutral), so it should land
with its own before/after measurement on the capsule replay, exactly as the quota changes did.

**Follow-up measurement, 2026-07-30:** deriving mission focal colors from
`neutrality === 'accent'` produced zero roster or capacity differences across the provider-free
capsule A/B matrix. There were therefore no `EXPLAINED BY` stubs to resolve. Direct acceptance tests
cover the behavior the capsule matrix does not exercise: olive cannot be the focal accent of a
`color_anchor` mission, while burgundy can.

## 6. Owner rulings — 2026-07-30

These are settled product decisions, not open taxonomy questions:

- **Silver is metallic.** It does not earn the palette-neutral classification merely because its
  swatch is visually grey. Gold was added alongside it so metallic tagging is not silver-only.
- **Burgundy is an accent.** It remains in the red family and may satisfy focal-colour mission
  scoring.
- **Periwinkle is dropped.** It had no stored wardrobe usage and remains outside the canonical
  tagger vocabulary.
- **Sage and olive are neutral-adjacent.** They count as palette-neutral for recombination, but
  retain the green family for retrieval. They must not satisfy accent/focal-colour scoring.
- **Black, white, and grey remain separate families.** Their shared neutral role does not erase the
  retrieval distinction between them.

Additional implementation rulings from the same review:

- Exact canonical shades remain the persisted garment facts; families are derived for grouping and
  retrieval and are never saved in place of a shade.
- There is no wardrobe-wide retag. Only garments whose visible colour could not be represented by
  the old vocabulary are candidates for a later targeted retag. The known coral case remains
  outstanding data work.
- The Wardrobe filter, garment Add/Edit, Batch Add, and Lookbook “Link pieces” modal must be
  reviewed as one UI workstream before implementation; see
  [wardrobe-color-controls-spec.md](wardrobe-color-controls-spec.md).

## 7. Caveats

- **Google's taxonomy is a retail-search standard, not a fashion-styling one.** It exists to make
  products findable, not to decide what coordinates. The two-level *structure* is what is being
  borrowed; the specific family list is adapted, and the `neutrality` axis has no counterpart there.
- **Baymard's guidance is about shopping filters**, where the user is browsing inventory. This
  panel filters a wardrobe the owner already owns, which is a different task, and the guidance is
  taken as indicative rather than binding.
- **The neutral consensus is practitioner consensus**, same caveat as the other two documents.
  Convergence across independent sources is the evidence.
- **The family map above is a ratified product model, not a measured natural law.** Boundary
  placements such as cyan, coral, and rust remain explicit product choices and should be changed
  only through another owner ruling.

## Sources

- [ColorInfo — Google Cloud Retail API](https://cloud.google.com/php/docs/reference/cloud-retail/latest/V2.ColorInfo)
- [Color \[color\] — Google Merchant Center Help](https://support.google.com/merchants/answer/6324487?hl=en)
- [What Is an Ecommerce Filter? UI Best Practices — Baymard](https://baymard.com/learn/ecommerce-filter-ui)
- [Make All Color Swatches Available in Mobile List Items — Baymard](https://baymard.com/blog/mobile-interactive-color-swatches)
- [What Are Neutral Colors In Clothing — OGLmove](https://oglmove.com/blogs/knowledge/what-are-neutral-colors-in-clothing)
- [What are Neutral Colors in Clothing? — Dressarte Paris](https://www.dressarteparis.com/what-are-neutral-colors-in-clothing-neutral-style-guide/)
- [Neutral Colors Every Wardrobe Needs — LVLL](https://www.thelvll.com/blogs/colors/neutral-colors-every-wardrobe-needs)
