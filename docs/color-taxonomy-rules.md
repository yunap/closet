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

## 4. Proposed model

Two derived properties per shade, kept orthogonal:

- **`family`** — the hue group, for grouping and breadth. What the filter swatches collapse to.
- **`neutrality`** — `neutral` | `neutral-adjacent` | `accent` | `metallic` | `multi`. The role the
  colour plays in a palette.

Keeping them separate is what lets navy be *blue* and *neutral* at once, which a single-axis family
list cannot express and which every fashion source treats as essential.

| shade | family | neutrality |
|---|---|---|
| black, charcoal, dark grey, grey, light grey | `achromatic` | neutral |
| white, ivory, cream | `achromatic` | neutral |
| oatmeal, beige, tan, taupe, *camel*, *khaki*, *greige* | `beige` | neutral |
| brown | `brown` | neutral-adjacent |
| navy, dark blue | `blue` | neutral |
| denim | `blue` | neutral-adjacent |
| blue, light blue, *periwinkle* | `blue` | accent |
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

*Italic* entries are shades to add. 11 families, close to Google's 13, with `beige` added and
`achromatic` merging White/Gray/Black — appropriate here because the distinction that matters for a
wardrobe is neutral-vs-accent, not white-vs-black.

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

What does need doing, in order:

1. **Reconcile the vocabulary** in `src/utils/colors.js`: add `family` and `neutrality` to each
   entry, add the missing shades (`coral`, `gold`, `khaki`, `greige`, `camel`), and resolve `silver`
   (in data, undeclared) and `periwinkle` (declared, unused).
2. **Fix the tagger prompt** so it emits only vocabulary terms, and can now say `coral`. Per the
   standing rule — fix the tagger first, retag once afterwards — this precedes any retagging.
3. **Point the engine at the taxonomy**, deleting the four hardcoded lists and the two inline
   duplicates, and replacing substring matching with exact lookup.
4. **Targeted retag only.** Not the wardrobe. Only pieces whose true colour the old vocabulary
   could not express — the coral maxi is the known case; a listing pass over `pink`/`orange`/`red`
   pieces would find the rest. This is a handful of pieces, not 243.
5. **Panel UI**: swatch chips grouped by family, per Baymard, with the long tail reachable but not
   listed as top-level peers.

**Ordering risk:** step 3 changes engine behaviour (which pieces read as neutral), so it should land
with its own before/after measurement on the capsule replay, exactly as the quota changes did.

## 6. Open questions for the owner

- **Silver.** Modelled as `metallic` per published practice, but a silver knit reads as grey in
  wear. `metallic` or `achromatic`/neutral?
- **Burgundy.** Listed as `accent` above. Some fashion sources treat deep burgundy as a dark
  neutral. Two pieces, so low stakes either way.
- **Periwinkle.** Declared and unused — drop it, or keep it available?
- **Sage and olive as `neutral-adjacent`.** Sources support "soft olive" as a modern neutral. This
  makes 17 olive/sage pieces count toward the neutral proportion, which moves capsule scoring.

## 7. Caveats

- **Google's taxonomy is a retail-search standard, not a fashion-styling one.** It exists to make
  products findable, not to decide what coordinates. The two-level *structure* is what is being
  borrowed; the specific family list is adapted, and the `neutrality` axis has no counterpart there.
- **Baymard's guidance is about shopping filters**, where the user is browsing inventory. This
  panel filters a wardrobe the owner already owns, which is a different task, and the guidance is
  taken as indicative rather than binding.
- **The neutral consensus is practitioner consensus**, same caveat as the other two documents.
  Convergence across independent sources is the evidence.
- **The family map above is a proposal, not a measurement.** Hue grouping is a judgement call at
  the boundaries — teal/turquoise between blue and green, coral between pink and orange, rust
  between orange and brown. Those placements should be reviewed before they are encoded.

## Sources

- [ColorInfo — Google Cloud Retail API](https://cloud.google.com/php/docs/reference/cloud-retail/latest/V2.ColorInfo)
- [Color \[color\] — Google Merchant Center Help](https://support.google.com/merchants/answer/6324487?hl=en)
- [What Is an Ecommerce Filter? UI Best Practices — Baymard](https://baymard.com/learn/ecommerce-filter-ui)
- [Make All Color Swatches Available in Mobile List Items — Baymard](https://baymard.com/blog/mobile-interactive-color-swatches)
- [What Are Neutral Colors In Clothing — OGLmove](https://oglmove.com/blogs/knowledge/what-are-neutral-colors-in-clothing)
- [What are Neutral Colors in Clothing? — Dressarte Paris](https://www.dressarteparis.com/what-are-neutral-colors-in-clothing-neutral-style-guide/)
- [Neutral Colors Every Wardrobe Needs — LVLL](https://www.thelvll.com/blogs/colors/neutral-colors-every-wardrobe-needs)
