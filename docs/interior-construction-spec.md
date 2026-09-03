# Spec — interior construction as an independent physical fact

**Status:** Implemented and verified 2026-09-02. All ten steps of §10 complete; the eleven
calibration rows are repaired in the live wardrobe and every invariant in §11–§13 holds against
them. Owner removed the calibration stop/go gate, so the calibration stage ran as verification
rather than as a decision gate. Verifiers, both deterministic and free to re-run:

```bash
node --test test/interiorConstruction.test.js                     # acceptance cases A-J
node scratch/verify_interior_construction_calibration.mjs         # real repaired rows
node scratch/verify_interior_construction_50f.mjs                 # the 50°F question, end to end
```

## 0. What changed, architecturally

Three results, in the order a future reviewer needs them. The file list is in the diff; this is
what the diff *means*.

**1. `non_insulating` became reachable for real wardrobe pieces for the first time.** It was
unreachable for the app's entire history — the branch required `fiber_content_completeness ===
'complete'`, which was set on zero of 268 pieces (§5.2). Three garments now carry the wardrobe's
first genuine negative verdicts: `207` (leather, lined, no fill), `996759` (cotton/poly trench,
lined, no fill), `996767` (cotton jacket, unlined, no fill). This is an **activation**, not a
refactor: a reviewer comparing before/after will see verdicts appear where there were none, and
that is the intended behaviour.

**2. Ordinary construction contributes graded thermal evidence, independently of insulation.** A
lining or a second fabric face is real thermal mass and now scores as such in `thermal.js` — its own
term, never folded into the insulating-material signal, weighted strictly below it:

```text
unlined 6  <  lining 8  <  full second face 10  <  true insulation 12   (cold score, all else equal)
```

`thermalMaterialVerdict` does not read `interior_construction` at all, in either direction. That is
asserted, not merely intended: removing the field from all eleven calibration pieces changes no
verdict.

**3. An insulating face fabric stays insulating regardless of lining or fill status.** `250`
(tweed, unlined, no fill), `996762` (fleece, unlined, no fill) and `996867` (wool, lined, no fill)
all remain `insulating`. The verdict is pinned to face material and fill; construction moves warmth
only. Cases I and J exist to keep it that way.

**4. Footwear follows the same material-role ownership as outerwear.** Found in review of this
change, not before it: both tagger schemas still told the model to record a warm boot lining in
`fiber_content` and called that field *"the only place a boot's warmth is recorded"* — the same
role confusion being fixed for coats, left alive for shoes, and directly contradicting
`insulating_layer_materials`' own contract, which names *"a warm boot's pile/shearling lining"*.

```text
upper / face material         → fiber_content / fabric_category
warm fleece/shearling lining  → insulating_layer_materials
ordinary lining               → no thermal-material claim
```

The warmth signal survives the move: a non-empty layer settles `thermalMaterialVerdict`, so a lined
boot is still excluded from hot weather via `hotWeatherInsulationReason`. **Existing rows were not
migrated** — two active shoes still carry a lining fibre in `fiber_content`, and the standing rule
is to fix the representation and retag once afterwards rather than bulk-inferring.

**Writer authority is enforced at the boundary, in both photo-derived producers.**
`/extract-pieces` normalized `fiber_content` and `interior_construction` but not
`insulating_layer_materials`, so that second producer could emit `[]` — the human-only "there is no
insulating layer" claim — and have it survive. It is now normalized at `source: 'tagger'` like the
main path, with a test asserting the conversion end to end rather than asserting the call is
present. Prompt compliance is not a writer rule.

**One canonical owner, checked by ratchet.** `INTERIOR_CONSTRUCTION_VALUES`, its writer rules,
owner-facing labels and editor options all originate in `fiberTaxonomy.js`; the writer rules are
*derived* from the value list rather than re-listed, and the editor projects the options rather than
keeping its own. `test/interiorConstruction.test.js` fails if any surface re-lists the vocabulary,
if a value lacks a label, or if a value lacks a thermal degree — the last of which would otherwise
leave a new value stored, shown, and silently inert.



---

## 1. The defect

`996764 navy plaid jacket` is a reversible jacket built from two full fabric faces. It has no
insulating layer at all. It currently reads:

```text
insulating_layer_materials  ["unknown"]
thermalMaterialVerdict      insulating
pieceWeatherEvidence        insulatingMaterial: true   → heat -6, cold +6
proposed warmth             warm
```

The tagger saw a second interior fabric face and had nowhere to record it. The only field that
accepts "there is substantial material inside this garment" is the insulating-layer field, and any
non-empty value there means *insulating* by design — correctly, for that field's purpose. So an
ordinary construction observation was promoted to a thermal claim.

`insulating_layer_materials`' own contract already anticipates this: *"ORDINARY LINING DOES NOT
BELONG HERE."* That rule is right and must stay. The consequence is that Closet has **no
representation for ordinary interior construction at all**, and observations of it land in the one
field that misreads them.

The model already owns shell substance (`fabric_weight`), material evidence (`fiber_content` /
`fabric_category`), rain/wind capability (`weather_protection`), thermally functional lining and
fill (`insulating_layer_materials`), and coverage. Ordinary interior assembly is the gap.

## 2. Goal and scope

Give Closet enough physical information to support judgments like *"can this jacket plausibly work
around 50°F with this outfit"* without asking users to understand apparel manufacturing or to
assign warmth ratings themselves.

The representation must distinguish the real constructions in the calibration wardrobe:

```text
unlined jacket
ordinary lightweight-lined jacket/coat
reversible two-full-fabric-layer jacket
warm/fuzzy-lined jacket
filled/insulated jacket
warm lining + fill
```

It must **not** collapse:

```text
ordinary lining   ==  insulation
second fabric face ==  insulation
heavy fabric      ==  insulation
weather barrier   ==  insulation
```

**Non-goals.** Do not add: an `outerwear_role` replacement, a winter/spring/fall coat class, a
stored temperature rating or comfort temperature, clo values, GSM, fill power, lining fibre
percentages, an interlining taxonomy, or anything else resembling a factory BOM. Closet needs
enough physics to course-correct styling advice, not enough to manufacture the garment.

Also non-goals by name — these are derived judgments and belong downstream, not on the piece:
`winter_coat`, `cold_weather_outerwear`, `50_degree_jacket`, `warm_enough`.

## 3. The new stored fact

Canonical internal field: **`interior_construction`**.

```text
unknown             interior construction not established (NOT equivalent to unlined)
unlined             confirmed: no separate ordinary lining and no second fabric face
partial_lining      an ordinary non-insulating lining covers part of the garment
full_lining         an ordinary lightweight non-insulating lining covers most of it
full_second_face    two substantial faces cover the same body area, neither being an
                    insulating lining or fill — includes reversible construction
```

**One canonical state model.** Missing, `null`, and invalid all collapse to `unknown`. There is no
useful distinction here analogous to `null` vs `[]` on the insulating-layer field: that field's `[]`
is a strong human assertion of absence, whereas "no lining" and "nobody has said" differ only in
provenance, which the writer rules already handle.

**The fibre identity of an ordinary lining is not required and must not be asked.** Whether it is
polyester, acetate, silk or viscose is thermally irrelevant. Do not add a lining-fibre field unless
some later non-thermal feature genuinely needs one.

**`full_second_face` is deliberately separate from `full_lining`.** The second face is part of the
garment's primary fabric construction, not a thin conventional lining, and it carries more thermal
capacity. `partial_lining` has no calibration example today but is common enough that omitting it
would force incorrect `full_lining` — see §7 for how it is scored.

### 3.1 The axes coexist

Ordinary lining and insulation are independent. A garment may legitimately carry:

```text
interior_construction: full_lining      insulating_layer_materials: ["down"]
interior_construction: unlined          insulating_layer_materials: []      + insulating face fabric
interior_construction: full_second_face insulating_layer_materials: []
```

There is **no** one-of enum such as `unlined | lined | insulated`. A thermal lining does not imply
an ordinary lining; an ordinary lining does not imply insulation; and neither implies anything
about the face fabric.

## 4. `insulating_layer_materials` — one vocabulary correction

The field, its states, and its writer rules are unchanged. One value is missing.

`996868 tan suede shearling-lined zip jacket` is recorded as `["fleece"]` because the canonical
fibre vocabulary has no shearling token. `shearling` exists in `INSULATING_FABRIC_CATEGORIES`
(`attributes.js`) as a *fabric category* but not in `FIBER_FAMILIES.insulating`
(`fiberTaxonomy.js`), which is what `normalizeInsulatingLayerMaterials` validates against.

**Add `shearling` to the canonical insulating fibre family.** Do not treat it as a synonym for
fleece. Both intake surfaces project `FIBER_FAMILIES`, so the editor and tagger pick it up without
further wiring.

> **Silent-failure trap.** Until this token exists, `normalizeInsulatingLayerMaterials(["shearling"])`
> drops it as out-of-vocabulary and collapses to `["unknown"]`. A layer still exists, so the verdict
> is still `insulating` and a verdict-only test **passes for the wrong reason**. The 996868 fixture
> must assert the stored value round-trips as `["shearling"]`, not merely that the verdict is
> insulating.

## 5. Retiring `fiber_content_completeness`

§12 of the original proposal made removal conditional on a consumer census finding no live
consumer needing exhaustive composition. The census was run, and the measurement is decisive.

### 5.1 The census

`compositionEvidenceState()` has exactly **one** behavioural consumer in production:
`thermalMaterialVerdict()` at `attributes.js:585`, testing `=== 'complete'`. Everything else is
plumbing — `crud.js` persistence, `taggerMerge.js` normalization, the tagger schema, one editor
control, one `FIELD_CONSEQUENCE` string.

### 5.2 The measurement

Counted on the live wardrobe (read-only copy, per [database-safety.md](database-safety.md)):

```text
fiber_content_completeness   unknown   258
                             partial    10
                             complete    0
```

**No piece has ever been marked `complete`.** The negative branch of `thermalMaterialVerdict` has
therefore never executed on a real garment: `non_insulating` is currently unreachable. The field is
not protecting live behaviour; it is protecting a hypothetical path.

**`partial` has zero semantic readers.** Every production reference is vocabulary definition,
prompt text, the editor control, or the one-time seed migration — nothing branches on it. It is
write-only data. It is also a lagging duplicate: all 10 `partial` rows carry a literal `"unknown"`
inside `fiber_content`, while **33** active pieces carry that marker and were never marked partial.

### 5.3 Why the new fields make the question moot

Material can hide in exactly two places:

- **inside the garment** — lining or fill. Now fully owned by `interior_construction` +
  `insulating_layer_materials`.
- **in the face fabric's own blend** — owned by nothing but a care label.

The incident that created the completeness field was the black puffer: a hidden *fill*. That is the
first case, and it now has a dedicated field. The second was never the real risk — a face fabric
that is substantially wool or fleece is visible, and `fabric_category` is tagged independently and
already feeds `hasPositiveInsulatingEvidence()`. A garment whose face is insulating, whose
`fabric_category` is *also* wrong, and whose owner states there is no fill is a tagging bug, not a
completeness gap.

The deeper point: this is not "completeness became derivable." It is that **one unanswerable
question is replaced by two answerable ones.** *"Is this the complete material composition?"* needs
a care label, which is why nobody ever answered it. *"Is there a lining? Is there padding?"* is
answered by opening the coat.

### 5.4 What to remove

```text
REMOVE FROM ACTIVE SEMANTICS:
  - PieceForm completeness question
  - tagger completeness schema/output (both photo producers)
  - completeness prompt text (prompts.js §5 paragraph)
  - confidence bookkeeping for completeness
  - compositionEvidenceState() as a thermal dependency
  - FIELD_CONSEQUENCE entry
  - any projections/cache semantics that expose it

KEEP:
  - dormant DB column, if physical removal is not worth the migration risk
```

### 5.5 Do not build a replacement `partial` abstraction

Do **not** create a general-purpose `partialComposition()` from:

```text
fiber_content contains "unknown"  OR  insulating layer exists  OR  interior construction exists
```

Those are three different facts with three different consequences, and recombining them into
"partial" recreates precisely the abstraction being removed. Consumers read the specific evidence
they need. This costs nothing: as §5.2 establishes, `partial` has no consumers to migrate.

## 6. `thermalMaterialVerdict` — construction never gates the verdict

The verdict answers one narrow question: *what does the recorded material evidence establish
thermally?* Construction is not part of that answer, **in either direction**.

```text
positive insulating-layer evidence                     → insulating
positive insulating face/fabric evidence               → insulating
insulating_layer_materials === []  AND  no positive face evidence  → non_insulating
otherwise                                              → unknown
```

Written against the canonical readers (`insulatingLayerMaterials()`,
`hasPositiveInsulatingEvidence()`), never against raw fields.

**Why construction is absent from the negative branch.** An earlier draft required "explicit enough
construction evidence to know there is no hidden thermal layer" as a precondition for
`non_insulating`. That is both unwritable — a coder must invent what "enough" means — and
self-contradictory: it forbids construction from producing `insulating` while making it a gate on
`non_insulating`, re-coupling the two axes this spec exists to separate. It is also unnecessary.
`insulating_layer_materials: []` is already documented as *"explicitly verified: there is no
insulating layer"* and is already human-only, since a tagger `[]` is downgraded to `null`. **That
is the hidden-thermal-layer answer.** Requiring a second construction answer on top would leave a
garment whose owner answered the insulation question but skipped the lining question at `unknown`
for no physical reason.

Ordinary lining and `full_second_face` affect overall thermal capacity. They do that in `thermal.js`
(§7), and nowhere else.

### 6.1 This is an activation, not a refactor

> **This change intentionally makes `non_insulating` reachable for the first time in the real
> wardrobe.** Today it is unreachable (§5.2). After this change, `insulating_layer_materials: []`
> with no positive face evidence will produce genuine negative verdicts. The first real negative
> verdicts are **generated and checked automatically** against the verified calibration facts in
> §12 — any contradiction is a test failure, not a reason to pause for human judgment.

## 7. Thermal integration — `thermal.js`, not `warmthCalibration.js`

**`warmthCalibration.js` is not on the live production path.** `proposedWarmthLevel()` is called
only by tests and `scratch/export_outerwear_calibration.mjs`; `warmthCalibrationEvidenceState()`
has one display-only use in `PieceForm.jsx:1524`. Integrating construction there would produce **no
behavioural change whatsoever** for the 50°F question.

The live path is `thermal.js` → `pieceWeatherEvidence()` → `pieceWeatherScores`, which today reads
`pieceHasInsulatingMaterial(piece)` — **a boolean**, weighted 6/6.

Required dependency chain:

```text
stored interior_construction
  → canonical normalized reader          interiorConstruction(piece)
  → construction thermal evidence        thermal.js, its own graded term
  → pieceWeatherScores
  → outfit / environmental adequacy
  → flow policy
```

`warmthCalibration.js` may be updated for diagnostic consistency, but **it cannot be the
authoritative integration target.**

### 7.1 Requirements on the thermal term

- Construction gets **its own graded contribution**, separate from the existing insulation signal.
  It must not be folded into `insulatingMaterial`, or `full_second_face` becomes "insulating" again
  by a different route.
- The insulation signal itself must stop being one bit if construction is to be orderable against
  it; a boolean term leaves construction nowhere to land that is not the insulating flag.
- Required monotonic ordering, all else equal:

  ```text
  unlined < partial ordinary lining < full ordinary lining < full second face < actual insulation
  ```

- This ordering is a **calibration hypothesis, not permission to make each step equal** — and not
  permission to invent coefficients either. Use the verified wardrobe cases to select magnitudes.
- **`partial_lining` and `full_lining` contribute identically for now.** Store the distinction
  because it is a real physical fact; do not invent a thermal magnitude for it until a real garment
  demonstrates the need. Representation may be finer than scoring.
- Do **not** invent a Fahrenheit conversion or a "full lining = +4 points" rule at this stage.

The acceptance result is that the engine can distinguish 996767 (unlined light jacket) from 996764
(reversible double layer) from 996868 (shearling-lined) from 996866 (polyester fill) from 996775
(down fill) **without lying about why each is warmer.**

## 8. Owner UI

The owner UI must never expose `interior_construction` terminology, nor the words `interlining`,
`material assembly`, `facing`, or `batting`. One compact **Inside construction** section, shown
where relevant — outerwear above all.

**What is the inside construction?**

```text
Unlined                                    → unlined
Regular lining — part of the garment       → partial_lining
Regular lining — most/all of the garment   → full_lining
Reversible / two full fabric layers        → full_second_face
Not sure                                   → unknown
```

Immediately beneath it, the existing insulation concept:

**Is there an insulating layer inside — fill or a warm lining?** — Yes / No / Not sure.
If **Yes**: *What is the insulating material?* — Down · Polyester / synthetic fill · Fleece ·
Shearling · Wool · Other · Not sure.

This screen **must permit ordinary lining and insulation together**; 996765 establishes that as a
real case.

> **Accepted limitation, recorded deliberately.** The initial owner UI treats ordinary lining and
> reversible / full-second-face construction as mutually exclusive. A garment could theoretically
> have both; no real Closet garment currently does. **Do not generalize to independent lining +
> second-face controls unless a real garment requires it.** The data model should not be
> complicated for a hypothetical garment.

## 9. Writer authority

### `interior_construction`

```text
tagger may emit:      unknown, partial_lining, full_lining, full_second_face
tagger may NOT emit:  unlined
manual/owner:         every state
```

The tagger may write positive visible construction evidence only. **Absence of a visible lining is
not evidence of no lining**, so `unlined` cannot come from an exterior photograph. A reversible
garment may be tagged `full_second_face` only when the construction is actually visible enough to
establish it; otherwise `unknown`.

A tagger emitting `unlined` is **normalized to `unknown`** — downgrade, not reject, following the
repo's existing convention (`normalizeFiberCompleteness`, and `normalizeInsulatingLayerMaterials`
turning a tagger `[]` into `null`).

### `insulating_layer_materials`

Unchanged, and the asymmetry is preserved. A photo may establish insulation **presence** — visible
loft, baffles, quilting with evident fill, a pile/fleece/shearling lining. A photo may never assert
`[]`; only manual or care-label evidence establishes absence.

## 10. Implementation order

**Scoped `outerwear_role` constraint — not a blocker.** `outerwear_role` retirement is 31
references across 11 files including `outfitEnvironmentalAdequacy.js`, `automaticUsePool.js` and
`outfitSetPlanner.js` — a real migration, and 996764's false `insulating` verdict is affecting
recommendations now, so this work does not wait on it. The collision is narrow: per
[outerwear-role-ontology-spec.md](outerwear-role-ontology-spec.md),
`outfitEnvironmentalAdequacy.js` is the **sole** consumer of the role gate. Therefore: **do not
wire construction evidence into `outfitEnvironmentalAdequacy.js` while that role gate exists.**
Everything else proceeds.

```text
1. representation + canonical reader/normalizer
2. shearling vocabulary
3. completeness retirement
4. owner UI + tagger writer rules
5. thermal.js integration
6. deterministic fixtures
7. repair current real rows, read from current DB state
8. real-garment calibration
9. end-to-end weather / 50°F verification
10. finish only when all acceptance criteria pass
```

**The contract is verification, not approval.** Run the deterministic fixtures, repair the real
rows, run the calibration set, run the end-to-end weather scenarios. A failed invariant, a
calibration mismatch, a stale-row difference, or a coefficient that needs adjusting is resolved
inside the implementation. Escalate only a genuine contradiction in the requirements.

Row repair (7) precedes real-garment calibration (8) deliberately: deterministic fixtures belong
in step 6, and anything reading real rows belongs after the repair.

## 11. Acceptance cases

Deterministic fixtures for each.

**A — ordinary lining does not become insulation.** Medium cotton coat, `full_lining`,
`insulating_layer_materials: []` → `thermalMaterialVerdict !== 'insulating'`, and warmer
construction evidence than the equivalent unlined coat.

**B — reversible double layer does not become insulation.** 996764-equivalent: light/medium shell,
`full_second_face`, no insulating layer → not insulating, and warmer than a comparable single-face
garment.

**C — polyester is warm only by role.** Polyester shell with no insulation must differ from
polyester shell with `insulating_layer_materials: ["polyester"]`.

**D — shearling lining.** `insulating_layer_materials: ["shearling"]` is positive insulating
evidence, **and round-trips as `["shearling"]` in storage** (§4's silent-failure trap).

**E — ordinary polyester lining.** `full_lining` whose lining happens to be polyester must not
become equivalent to polyester fill.

**F — lining and fill coexist.** 996765-equivalent must be representable without discarding either
fact.

**G — unknown stays unknown.** No visible interior and no owner answer must never become `unlined`.

**H — no flow-specific reinterpretation.** Source-level grep ratchet: no production file outside the
ownership layer may read `interior_construction` directly. Search, composer, outfit validation,
capsule code and planning consume derived thermal evidence.

```text
allowlist: the canonical reader module, attributes.js, thermal.js, crud.js,
           taggerMerge.js, prompts.js, routes/ai.js, PieceForm.jsx, BatchAdd.jsx
```

Write the allowlist into the test. Without it the ratchet is authored too tight, fails on the
editor, and gets suppressed on first run.

**I — unlined *and* insulating.** The direction A–H never tests, and the one the rejected §6
predicate would have broken:

```text
996762  grey fleece      fabric_category=fleece   unlined, no fill  → insulating
250     charcoal jacket  fabric_category=tweed    unlined, no fill  → insulating
```

Both are genuinely warm through the face fabric with no lining and no fill. This is the case that
proves the axes are independent in both directions.

**J — lined, no fill, insulating through the face fabric alone.** The owner-verified third
independence case:

```text
996867  wool coat   interior_construction=full_lining   insulating_layer_materials=[]   → insulating
```

Ordinary lining present, fill explicitly absent, and still insulating because the outer material is
wool. Together with I this pins the verdict to face material and fill only: construction moves
warmth, never the verdict.

## 12. Correcting the calibration pieces

Repair **only** these known pieces. Do not bulk-infer the wardrobe: the standing practice here is
to fix the representation first and retag once afterwards, never to re-tag ahead of a taxonomy
change.

| Piece | `interior_construction` | Insulation |
|---|---|---|
| 996767 olive lightweight jacket | `unlined` | none |
| 996762 grey fleece | `unlined` | none *(insulating via face fabric — see §12.2)* |
| 250 charcoal cropped jacket | `unlined` | none *(insulating via tweed — see §12.2)* |
| 207 black leather jacket | `full_lining` | none |
| 996759 cream trench | `full_lining` | none |
| 996867 wool coat | `full_lining` | `[]` *(insulating via wool face — see §12.2)* |
| 996764 navy plaid jacket | `full_second_face` | **`[]` — explicitly cleared** |
| 996868 shearling-lined jacket | as applicable | `["shearling"]` |
| 996866 quilted puffer | as applicable | `["polyester"]` |
| 996775 black puffer | as applicable | `["down"]` |
| 996765 brown leather coat | lined as applicable | down + warm-lining representation |

### 12.1 Role-confused materials must leave `fiber_content`

This is the step that cannot be skipped: three pieces carry the insulating material in the **face
fabric field**, which is the exact semantic contamination the field split exists to prevent.

```text
996775   fiber_content: remove "down"          insulating_layer_materials: ["down"]
996868   fiber_content: remove "fleece" if it represents only the lining
                                                insulating_layer_materials: ["shearling"]
996765   fiber_content: keep only actual shell/face material evidence
                                                insulating_layer_materials: include down;
                                                include warm-lining material only if actually known
996764   interior_construction: full_second_face
                                                insulating_layer_materials: []
```

**996764's correction is the load-bearing one.** Adding `full_second_face` without clearing the
existing `["unknown"]` leaves the false `insulating` verdict fully intact — the bug this spec exists
to fix would survive its own fix.

For 996765, inspect the actual garment and label before deciding whether the fuzzy lining needs a
separate insulating material alongside down. **Do not manufacture a material token from the word
"fuzzy."**

**`pieceFiberBreathability()` values will move for these pieces. That is a correction, not a
regression.** Record before/after explicitly so nobody later "fixes" the corrected behaviour back.

### 12.2 Three pieces stay `insulating`, and that is right

The table's construction and fill columns describe **assembly, not verdict.** Three pieces have
genuinely warm face fabrics and correctly remain `insulating` after repair:

```text
250     unlined,     no fill   fabric_category tweed    → insulating
996762  unlined,     no fill   fabric_category fleece   → insulating
996867  full_lining, no fill   fiber_content wool       → insulating
```

`tweed` and `fleece` are in `INSULATING_FABRIC_CATEGORIES`; `wool` is in `INSULATING_FIBERS`. A
coder who reads the fill column as a verdict target will try to force `non_insulating` on these and
break correct physics.

### 12.3 Read current row state, do not trust the export

`wardrobe.db` and `scratch/outerwear-calibration/` disagree: 996764 is `["cotton"]` with no layer
value in the 2026-09-01 database, but `["cotton","unknown"]` with layer `["unknown"]` in the
2026-09-02 export. Rows were edited between. **Re-read current state as the "before" side of the
migration** rather than trusting the export's values.

## 13. The two regression tests that matter

If these come out right **through the live weather path** — not through `warmthCalibration.js` —
the representation is doing the job:

```text
996764   reversible / double-layer
         NOT insulated
         warmer than a comparable unlined jacket

996868   shearling-lined
         genuinely insulating
         not represented as generic fleece shell material
```
