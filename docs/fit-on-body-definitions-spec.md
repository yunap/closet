# Spec — defining `fit_on_body`

**Status:** Implemented 2026-09-02, **with its diagnosis corrected during implementation** — see
§1. One live retag remains to confirm the model acts on the change. Proposed 2026-09-02. Written after a live retag tagged a visibly waisted quilted
jacket (`996866`) as `hangs_straight`. **Route:** [docs/README.md](README.md). Follows the
house pattern set by the sleeve taxonomy — see
[garment-field-reference.md](garment-field-reference.md) → *"Sleeve taxonomy: functional volume,
not fashion names (2026-08-26)"*.

## 1. The cause — corrected during implementation

**This spec was first written on a false premise, and the correction is the useful part.**

The original §1 said `fit_on_body` was asked for as a bare pipe-list with *no definitions at all*,
and proposed adding some. That was wrong. Implementing it surfaced two guidance blocks the survey
had missed, and the second is the actual cause:

```text
- Fit on Body: Select clings_stretchy, clings_drapey, skims, hangs_straight, drapes, or structured.

2. Fabric & Drape:
   - Structured/Stiff (denim, twill, canvas, heavy cotton): Holds its own shape away from the body.
     Fit matches: "structured" or "hangs_straight".
   - Fluid/Soft (ribbed knit, silk, gauze): Conforms to body contours. Fit matches: "skims" or "drapes".
```

The first line is a bare restatement carrying no semantics — and it silently omits `none`, which
the enum has. But the second **maps fabric stiffness directly onto a fit value.** A quilted nylon
shell reads as a stiff fabric, so `hangs_straight` was the answer the prompt asked for. **The model
obeyed a wrong rule rather than misreading a photo.**

Fabric stiffness and body relationship are different axes. A stiff fabric can be cut to the waist —
a tailored wool coat, a denim jacket with darts, this quilted jacket with shaped side panels. The
old rule made that combination unreachable.

This is why the repo's standing habit is to check intent before calling something a gap: the fix
for "no guidance exists" (add some) is not the fix for "the guidance is wrong" (correct it, then
add). Both are now done, but only the second addresses the incident.

## 2. What it produced

`996866 navy quilted puffer jacket with ribbed side panels`, tagged 2026-09-02:

```text
silhouette   structured
fit_on_body  hangs_straight       ← contradicted by both photos
```

Both the hanger and worn photos show a **waisted** jacket: ribbed knit side panels that visibly
pull it in at the waist, curved quilting following that line, and a slight flare over the hip. It
is shaped to the body. `hangs_straight` is the one value in the enum that actively contradicts
what the photographs show.

The failure is not perception. The model **saw the panels** — `reads_as` names them — and its own
notes classify them as *"ribbed knit side panels for texture contrast"*. It registered the feature
and misread its function: those panels are a waist-shaping device, not a texture detail.

Corroborating inconsistency across the wardrobe's three structured heavy coats:

```text
207     black leather zip jacket    silhouette structured   fit_on_body structured
996765  brown long leather coat     silhouette structured   fit_on_body hangs_straight
996866  navy quilted puffer         silhouette structured   fit_on_body hangs_straight
```

`structured` is used **6 times in 268 pieces** — the rarest non-null value in the field.

## 3. Why it matters — two different consequences

### 3.1 For tops, it is gate-critical

`outfitValidation.js` reads it directly:

```js
const BASE_LAYER_CLOSE_FITS        = new Set(['clings_stretchy', 'clings_drapey', 'skims'])
const BASE_LAYER_INCOMPATIBLE_FITS = new Set(['hangs_straight', 'drapes', 'structured', 'none'])
```

A top wrongly placed on the incompatible side is **rejected as a base layer** under any
`needs_base: yes` garment, however well it otherwise fits. The error direction is false negatives:
valid pieces silently excluded. This gate applies only when `categoryGroup === 'top'`, so it does
not touch the jacket that prompted the spec — but it does touch three of §4's candidates.

### 3.2 For everything else, it is fed to the model as fact

Two projections state the value to the model verbatim:

```text
core.js:2042   "render its fit as hangs straight"                                  image generation
core.js:3536   "Anchor fit: it hangs straight on the body — keep that
                relationship to the body."                                          anchor column
```

So a generated image of `996866` is instructed to render a waisted, hip-flared coat as a straight
boxy puffer, and explicitly told not to change that relationship. This is the
[visual grounding](engine-behaviour-map.md) failure mode in its purest form: a text tag overriding
what the photograph plainly shows.

Note what is **not** affected. `softScoreFloors.js`'s loungewear floor also reads the field, but
only for `fleece`/`sweatshirt fleece` pieces with a `relaxed`/`oversized` silhouette. And
`structured` vs `hangs_straight` is a distinction **no consumer draws** — both sets that mention
them contain both. The consequential boundary is between the body-following values
(`skims`, `clings_*`) and the rest.

## 4. Measured candidate yield

Pieces in `top`/`dress`/`outerwear` tagged non-body-following whose own `name`/`reads_as`/`notes`
describe body shaping (`nipped`, `cinched`, `belted`, `princess seam`, `peplum`, `fit-and-flare`,
`waist-defining`, `darted`, `ribbed side`):

```text
60 tagged non-body-following
 7 whose own text describes body shaping

 98      drapes          relaxed      olive gold silk blouse
 118     drapes          relaxed      bold multicolor dot peplum top      ← a peplum IS a waist
 154     drapes          relaxed      white ruffled long sleeve top
 996763  hangs_straight  relaxed      pink raincoat
 996765  hangs_straight  structured   brown long leather coat
 996767  hangs_straight  relaxed      olive green lightweight jacket
 996866  hangs_straight  structured   navy quilted puffer                 ← confirmed by photo
```

Three of those (98, 118, 154) are tops, so they carry the §3.1 gate consequence as well.

**An earlier, looser version of this query returned 46 and was wrong.** It matched the word
"waist" anywhere, which every bottom's text contains structurally — a waistband is not body
shaping. The number is 7, not 46, and the difference is the whole point of scoping the signal.

## 5. Proposed definitions

The axis, stated once: **how does this garment relate to the body's contours?** Not how loose it
is, not what shape it is — `silhouette` already owns outline.

| value | means |
|---|---|
| `clings_stretchy` | follows the body closely because the fabric stretches onto it — jersey, rib, knit. The body's outline reads through. |
| `clings_drapey` | follows the body closely because a fluid non-stretch fabric falls onto it — a silk slip, a bias cut. Outline reads through from drape, not stretch. |
| `skims` | **shaped to the body and following its line without gripping.** There is ease, but the garment's own construction references the body — a defined waist, darts, princess seams, shaped side panels, a belt or drawstring that is part of the design. |
| `hangs_straight` | falls from the shoulders or waistband in a straight line, **ignoring the body's contours**. No waist definition anywhere in the construction. |
| `drapes` | falls in soft folds *away* from the body; the fabric's weight and fluidity govern the shape rather than the body does. |
| `structured` | **holds its own architectural shape independently of the body** — it would keep that shape off the body, through canvas, interfacing, boning, or tailoring. |
| `none` | the garment has no meaningful relationship to body contours. |

### 5.1 The three disambiguations that would have prevented this

These are the load-bearing sentences; the table alone would not have fixed `996866`.

**`skims` vs `hangs_straight` — ask whether there is waist definition.** Any shaping device
(darts, princess seams, shaped or elasticated side panels, a peplum, a belt or drawstring built
into the design) means the garment references the body: `skims`, not `hangs_straight`. Choose
`hangs_straight` only when the garment falls straight from the shoulders or waistband with nothing
drawing it in.

**Padding is not structure.** A quilted or filled garment is padded, not architecturally
structured. Judge a puffer by whether it is shaped to the waist, not by its bulk. Bulk is
`fabric_weight` and `visual_weight`; it is not this field.

**`fit_on_body` is not `silhouette`.** `silhouette` describes the garment's outline;
`fit_on_body` describes its relationship to the body. They are independent, and
`silhouette: structured` + `fit_on_body: skims` is a normal, correct combination — a tailored
waisted coat. Do not copy one field into the other.

### 5.2 Photo authority

The worn photo, where present, is the authority for this field — it is the only view that shows the
relationship to an actual body. `/extract-pieces` already states this for its own schema; the main
tagger says nothing, and should.

## 6. Cost and verification

**Prompt change — done.** Four accepted deltas recorded in `prompt_equivalence.test.js` with their
rationale, leaving `prompts_yuna_snapshot.json` frozen: the two Fabric & Drape lines (stiffness
becomes a stated default that shaping overrides), the `Fit on Body` guidance line, and the schema
description. Recorded as: *`fit_on_body` gains definitions; the value list is unchanged.*

**Ownership.** `FIT_ON_BODY_VALUES` and `FIT_ON_BODY_SCHEMA_DESCRIPTION` live in `attributes.js`,
and both photo-derived producers project them — the tagger and `/extract-pieces`, which keeps its
own worn-photo authority sentence on top. A test fails if either restates the definitions inline.

**Tests.** Every value must be defined, not merely listed; the three disambiguations must survive;
and stiffness must no longer decide the fit value outright.

**No migration, no backfill.** The enum is untouched — only its description. Existing rows keep
working, and nothing is retagged automatically.

**Verification is cheap and judgeable by eye**, unlike the fibre work. Retag `996866` and `996765`
— both heavy coats the owner can assess from their own photos — and check:

```text
996866  navy quilted puffer, visibly waisted   → skims        (currently hangs_straight)
996765  brown long leather coat                → owner's call; the test is that it stops
                                                 disagreeing with 207 for no stated reason
```

Two billed tags, **still outstanding.** If `996866` still returns `hangs_straight`, the problem is
neither the vocabulary nor the fabric rule, and this spec is wrong about the cause — which is a
clean falsification rather than an ambiguous one.

## 7. Not proposed

- **No retagging of the wardrobe.** Fix the tagger first, retag once afterwards if ever — the
  standing rule in this repo, and §4's seven candidates are a review list, not a migration.
- **No new consumer.** Nothing should start distinguishing `structured` from `hangs_straight`
  until the values mean something reliable; today no consumer does, and that is fine.
- **No change to `silhouette`.** Its outerwear vocabulary already includes `structured` and is
  working as intended.
