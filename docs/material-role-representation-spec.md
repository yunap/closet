# Spec — recording the material that actually insulates

**Status:** Implemented 2026-09-02. Owner ruled: no temporary guard, fix the representation. **Route:**
[docs/README.md](README.md). Completes
[fiber-evidence-completeness-spec.md](fiber-evidence-completeness-spec.md), whose §1 diagnosed this
as a *completeness* problem when it is also a *role* problem.

## 1. The defect

`996765 brown long leather coat` is lined and filled with 100% polyester. Its composition is
already recorded:

```text
fiber_content              ["polyester","nylon","leather"]
fiber_content_completeness unknown
thermalMaterialVerdict     unknown
```

Nothing is missing from that list. The problem is that `polyester` there could be the shell, the
lining, or the fill, and those are thermally opposite — and `polyester` is not in
`INSULATING_FIBERS`, which contains only `wool, merino, cashmere, alpaca, mohair, fleece, down`.

**So marking this coat's composition `complete` — which would be truthful — turns
`thermalMaterialVerdict` into `non_insulating`.** A confidently wrong answer about an insulated
coat, strictly worse than today's honest `unknown`, produced by machinery merged the same morning.
The completeness work makes this case worse, not better, and it does so precisely when the owner
does the right thing.

**Synthetic insulation is unrepresentable today.** Polyester wadding, PrimaLoft, Thinsulate are all
`polyester`. The black puffer reads `insulating` only because the owner hand-added `down`.

Restating the fibre spec's founding observation correctly: the care label's `SHELL / LINING / FILL`
split having nowhere to land is not only about *how much* was recorded. Knowing polyester is
present says nothing thermally; knowing it is the **fill** says everything. Completeness was
necessary and is not sufficient.

## 2. Audit — does any other material role matter?

The ruling was to prefer a narrow fill-specific fact *unless the audit shows other roles matter
elsewhere*. It shows one does, and it is already live in the data.

### 2.1 A second role is already smuggled into `fiber_content`

The tagger prompt instructs, for footwear:

> *"include the LINING/interior material alongside the upper when it is visible… **This is the only
> place a boot's warmth is recorded**: fabric_weight is null for shoes and fabric_category describes
> the UPPER."*

Two real pieces already carry it:

```text
996864  brown leather shearling-lined winter boots   ["leather","wool"]   upper: leather
996862  black wool lace-up sneakers                  ["wool"]             upper: textile
```

The `wool` there is the **lining**, not the upper. So `fiber_content` is already a mixed-role list
for footwear, for exactly the same reason as garment fill: the warmth lives in a layer the face
material does not describe.

**The concept needed is therefore not "fill" but "the insulating layer that is not the face
material"** — fill in a coat, lining in a boot. One field, two garment types.

### 2.2 Roles must NOT be merged into `fiber_content`

`fiber_content` has a second consumer that wants the *face* materials specifically:
`pieceFiberBreathability` and `pieceFiberIsAllNonBreathable` ask what the fabric does against
skin. Adding fill materials to the same array corrupts it — **14 outerwear pieces have breathable
shell fibres today** that a fill entry would dilute or flip:

```text
996867  black wool coat        ["wool","silk"]
996759  cream trench coat      ["cotton","polyester"]
996763  pink raincoat          ["cotton","polyester"]
996764  navy plaid jacket      ["cotton"]
   …and 10 more
```

That settles the shape question in favour of a **separate field** rather than the general
`{fiber, role}` structure: the existing array already has a well-defined meaning its other
consumers depend on, and widening it would make every reader role-aware at once.

## 3. Proposed representation

One new field, narrow, alongside the existing one:

```text
fiber_content    materials of the FACE fabric — unchanged, all existing consumers unaffected
insulating_layer_materials   materials of the interior insulating layer: a coat's fill, a boot's lining
```

Both are presence lists, both use the same canonical vocabulary from `fiberTaxonomy.js`, and
`insulating_layer_materials` accepts `unknown` for the common case where quilting is visible but its contents
are not.

**Named `insulating_layer_materials`** (owner ruling, 2026-09-02). An earlier draft called it
`fill_materials`; the audit had already shown the semantic owner is not "fill" but *a thermally
functional internal layer whose material may differ from the face material* — puffer fill and warm
footwear lining alike. Naming it for one of its two cases would have baked the wrong ontology into
the schema and produced exceptions like "a shearling lining counts as fill".

The name also makes §3.1's rule true **by definition** rather than by assertion: the engine is not
claiming polyester is intrinsically insulating, it is reading that polyester *occupies the
insulating-layer role*. That is the distinction the old schema could not express.

### 3.0 States

```text
NULL           presence/composition of an insulating layer is unrecorded
[]             explicitly verified: there is no insulating layer
["unknown"]    an insulating layer definitely exists; material unidentified
["polyester"]  an insulating layer exists, of polyester
["wool"]       an insulating layer exists, of wool/shearling/etc.
```

`NULL` and `[]` are different facts and must stay different end to end — the same distinction §10
had to repair for `fiber_content` after two write paths disagreed about it.

### 3.0.1 What must NOT go in this field

**Only materials forming a thermally functional fill or insulating lining.** An ordinary
lightweight garment lining — a plain polyester or acetate lining in a blazer or a dress — is
**not** an insulating layer and must not be recorded here. Without this, every lined garment would
trigger `insulating`, which is the failure this field exists to prevent, inverted.

### 3.1 The verdict rule

```text
insulating_layer_materials non-empty   → insulating, whatever the fibres are
```

**Fibre identity is irrelevant in this layer.** Nobody fills a garment with a material chosen not
to insulate — loft is the mechanism, and a polyester wadding insulates for the same structural
reason down does. This is the rule that fixes `996765`, and it needs no new fibre values.

The negative branch tightens correspondingly:

```text
non_insulating requires: composition complete AND insulating_layer_materials explicitly recorded as empty
```

Absent is not empty — the same distinction §10 drew for `fiber_content` itself. A piece nobody has
answered the fill question for stays `unknown`.

### 3.2 Writer rules

Photo tagging **can** see that a fill layer exists — quilting, baffles, visible loft, a pile lining
— and usually **cannot** identify what it is made of. So:

```text
tagger may write   insulating_layer_materials: ["unknown"]   when construction shows a fill it cannot identify
tagger may write   insulating_layer_materials: ["wool"]      for a visible shearling/fleece lining
tagger may NOT     assert []                     — "no fill" is not observable from a photo
manual/care label  may write anything, including []
```

`["unknown"]` is therefore a *positive* claim — "there is a fill layer, contents unidentified" —
and under §3.1 it yields `insulating`. That is the correct reading: a quilted coat is insulated
whether or not we know the fill's fibre.

## 4. What this fixes, concretely

```text
996765  brown leather coat   insulating_layer_materials ["polyester"]  → insulating   (today: unknown; complete would give non_insulating)
996866  navy quilted puffer  insulating_layer_materials ["unknown"]    → insulating   (today: unknown)
996775  black puffer         insulating_layer_materials ["down"]       → insulating   (today: insulating, via a hand-added fibre)
996864  shearling boots      insulating_layer_materials ["wool"]       → insulating   (today: insulating, via a smuggled lining)
996867  black wool coat      insulating_layer_materials []             → unchanged; wool in fiber_content already carries it
```

## 5. Migration

**None automatic.** Existing footwear linings stay in `fiber_content` where they are; nothing is
retagged, per the standing rule. The two smuggled-lining shoes keep working through
`INSULATING_FIBERS` exactly as now, and gain nothing until re-tagged. New tagging populates
`insulating_layer_materials`; old rows are `NULL`, which reads as unrecorded, which is honest.

The footwear prompt instruction should be updated to write the lining into `insulating_layer_materials`
instead — but only forward, and the `fiber_content` path must keep working for existing rows.

## 6. Acceptance

1. `996765` with `insulating_layer_materials: ["polyester"]` and completeness `complete` returns
   **`insulating`**, not `non_insulating`. This is the case that motivated the spec.
2. A piece with no `insulating_layer_materials` recorded and completeness `complete` still returns
   `non_insulating` only when `insulating_layer_materials` is explicitly `[]`.
3. `pieceFiberBreathability` is unchanged for every existing piece — verified across the wardrobe,
   not argued.
4. The tagger cannot assert `insulating_layer_materials: []`.

## 7. Implementation results

Verified against a WAL-inclusive copy of the live wardrobe, 270 active pieces:

```text
column added, every existing row NULL          270/270   (unrecorded, which is honest)
thermal verdict distribution                   unknown 232 · insulating 38 · non_insulating 0
pieces whose breathability changed                 0/270   (acceptance 3)

996765 as stored                               unknown
996765 + completeness complete                 unknown       ← was non_insulating this morning
996765 + insulating_layer_materials ['polyester']  insulating
```

Acceptance 1 and 3 met directly. `non_insulating` is now doubly gated — complete face composition
**and** an explicit `[]` — and is therefore unreachable until someone answers the layer question,
which is the honest position rather than a regression: nothing in the wardrobe has had that
question put to it.

Wired: `db.js` (column), `fiberTaxonomy.js` (normalizer, reader, schema description),
`attributes.js` (`thermalMaterialVerdict`), `prompts.js` + `routes/ai.js` (both photo schemas, one
projected description), `taggerMerge.js` (writer rule at the boundary), `routes/crud.js`
(NULL-preserving write), and both intake forms carry it.

Two of §12's own tests in the fibre spec had to change: they asserted `complete` alone produced
`non_insulating`, which was the contract this spec replaces. Updated with the reason recorded in
place rather than silently adjusted, and four new tests added — the layer verdict, the
absent-vs-empty gate, the tagger's inability to assert `[]`, and breathability isolation.

### 7.1 Editor control — **DONE 2026-09-02**

The gap this section recorded is closed. `PieceForm` now asks, on outerwear and shoes:

> **Is there an insulating layer inside — fill or a warm lining?**
> `Yes` · `No, nothing inside` · `Not sure`
>
> and when Yes: **What is it made of? Leave blank if you can't tell.**

The question deliberately does **not** say "padding". Padding is construction, not necessarily
insulation — a padded shoulder or a quilted decorative panel is neither a fill nor a warm lining,
and offering it as a reason to answer Yes would manufacture false positives in the field's own
terms. The tagger may still *use* visible quilting and loft as evidence that an insulating layer
exists (§3.2); the owner-facing question asks about the fact being stored, not the evidence for it.

The three choices map to the three stored states — `["unknown"]` or named materials · `[]` ·
`NULL` — and the second row's options are projected from `FIBER_FAMILIES.insulating` plus
`FIBER_FAMILIES.synthetic`, so **polyester is offerable**, which is the case the field exists for.

Transition behaviour, pinned by test: choosing *Yes* with nothing named stores `["unknown"]` (the
honest positive, and the common answer); switching back to *Yes* keeps materials already named;
choosing *No* discards them, as it must, since it is an assertion that there is nothing there.

**This is what makes `non_insulating` reachable at all.** A tagger may never assert `[]`, so until
a person could say "nothing inside", the negative branch had no route in production.

Scoped to outerwear and shoes — the two cases §2 identifies. A quilted top or vest in another
category cannot be answered yet; noted rather than silently unsupported. `BatchAdd` does not carry
the control either, matching how the completeness control was scoped.
