# Sleeve room: a tag for how much fits inside a layer's sleeve

**Status:** historical — a proposed design, 2026-11-01. Not built. **Tested the same day and not supported:** with both cardigans recorded `thin_sleeves` and the values defined, the two failing cards were still kept (engine map 96). Also corrected the same day by the owner: the black top 996913 is a fine knit; its bulk is the finished sleeve cuff, which no recorded field describes. Owner direction the same day: "Design a sleeve-fit tag".
Related: [sleeve-thickness-audit-2026-10-21.md](sleeve-thickness-audit-2026-10-21.md) (owner ruling: no
sleeve-*thickness* field), [research-layering-fit-2026-11-01.md](research-layering-fit-2026-11-01.md),
[garment-field-reference.md](garment-field-reference.md), engine map item 96.

## The problem it answers

Every layering failure in the 2026-10-30/31 guest-morning plans was a sleeved base under a knit cardigan whose
sleeve narrows below the elbow: the olive sweater 996875 under #88, the black ponte top 996913 under the cream
cardigan 990362, and in Vienna the navy wool turtleneck 146 under #88 ("workable, but not great"). Nine replays
(engine map 96) showed the models never doubt the outer sleeve's room: they read #88's `deep_armhole` and
990362's `flared` as "roomy", and every correction to the *inner* garment (type, fabric, the owner's own
`voluminous`) was argued away against that premise. The one statement of the real fact is the owner's note on #88
("the sleeves have deep armholes but become fitted below the elbows"), in a field no styling call receives.

`sleeve_shape` cannot carry this. It records *where a sleeve carries extra volume* (the 2026-08-26 functional
taxonomy), so a sleeve roomy at the armhole and close at the forearm is `deep_armhole`, and one close along the arm
that opens at the cuff is `flared`: both true, both read as roomy. The research note gives the reason a separate
fact is needed: what fits inside a sleeve is decided by its **narrowest section between shoulder and wrist**
(Ysolda; Knit Picks; dolman "fitted at wrist but cut with a deep armhole").

## The field

`sleeve_room` — how much another garment's sleeve can fit inside this one, at its narrowest point between the
shoulder and the wrist, as the photos show it.

| Value | Meaning | Examples from this wardrobe (owner to confirm) |
|---|---|---|
| `none` | Close to the arm at some point along its length; another sleeve, even a thin one, crowds it | — |
| `thin_sleeves` | Room for a thin sleeve (a tee, a fine-gauge knit, a blouse), not for a sweater or a firm knit | #88 striped cardigan, #990362 cream cardigan |
| `any_sleeve` | Cut to go over a sleeved base, sweaters included: room along its whole length | cream trench, black wool coat |
| `unknown` | Not determinable from the photos | — |

Why this shape:
- **It describes one garment, not a pairing.** It is a property of the layer, the way `needs_base` is. It is not the
  inner garment's thickness, which the 2026-10-21 ruling kept out; the inner side is carried by what is already
  recorded and now sent (`top (sweater)`, `fabric ponte`, `sleeves 3/4`).
- **It names the decision-relevant fact in the stylist's own terms** — what can go in — instead of geometry the model
  has to combine (where the volume is, overall fit, silhouette), which is where it went wrong.
- **It is checkable by eye.** Like `top_subtype` ("a type must be visible in the photo"), the owner can confirm it on
  a page of similar layers side by side.

**Applies to:** `outerwear` with sleeves (cardigans, jackets, coats, blazers, shrugs, hoodies). Sleeveless
outerwear (vests) stores `NULL`, as `sleeve_shape` does. Tops worn open over another (a shirt as a layer) are left
for a later step; none were in these failures.

## How it reaches the models

- **Fact line** (`sharedGarmentEvidenceLine`): `sleeve room thin_sleeves`, placed after `sleeve shape`.
- **Conventions** (`GARMENT_FACT_CONVENTIONS`): one sentence defining the values — what fits inside the sleeve at
  its narrowest point. A definition of a recorded value, not a styling instruction (plan audit rulings).
- **Authority:** an owner-set value stands over a photo (item 95's tightened rule); a tagger value marked
  low-confidence gives way to a clear photo.
- No gate. No rule that a sweater may not go under a `thin_sleeves` layer: the models judge with the fact in front
  of them (owner rulings 2026-09-14 and 2026-10-02 on sleeve gates).

## How it gets filled

1. **Tagger:** the tag prompt asks for it with the definition above, from the photos (worn photo first when there
   is one: the sleeve on the arm shows the narrow point). Confidence recorded as for other fields.
2. **Existing pieces:** a one-time backfill of this field only, on the subtype-backfill engine
   (`lib/subtypeBackfill.js`, as `outerwearSubtypeBackfill.js` did): a tagger read per sleeved outerwear piece,
   then owner tasks showing similar layers side by side where the read is unclear. Not a wardrobe retag
   (owner: don't retag the wardrobe again): one field, sleeved outerwear only (about 30 pieces).
3. **Owner edits** in PieceForm and BatchAdd like any chip field; `manual_overrides` protects them on retag.

Caveat: the tagger reads the same photos the composers misread. Whether it gets this field right is untested;
the backfill's owner pages exist for that reason.

## Wiring (new-tag-field checklist)

1. `styling-engine/prompts.js` tag schema + guidance line; 2. `routes/ai.js` extract-pieces schema; 3. `db.js`
column; 4. `routes/crud.js` POST and PUT; 5. `taggerMerge.js` validation set and confidence field; 6.
`PieceForm.jsx` state, both retag-apply paths, a chip control (outerwear only); 7. `BatchAdd.jsx`; 8. truth
surfaces: `sharedGarmentEvidenceLine`, conventions, manifest/`buildWardrobePieceTruthText`, `search_wardrobe`;
9. `dist/` rebuild; plus `garment-field-reference.md` row and the backfill module.

## Test before building (≈ 2–3¢)

Replay the captured Saturday cards on gemini-3.7-flash with the value and its definition injected into the
request only (database copy, `COPY_SQL`, a temporary fact-line entry): olive 996875 under #88 and black ponte
996913 under 990362, both layers `thin_sleeves`; and, as a control, the cream short-sleeved mock-neck 996793 under
#88 (Sunday of `thread_1793438265365`, which the owner said fits), also `thin_sleeves`, which should be kept. Build
only if the two failures are rejected and the control is kept.
