# Sleeve thickness audit

**Status:** active — audit complete 2026-10-21. **Owner ruling, same day: no sleeve-thickness field.**
"I'm not happy with solving this issue by adding more tags. The stylist should be smart enough to
not make such mistakes. Any human looking at these photos would not." The failure stands; the fix
must come from the stylist judging the photographs, not from more recorded fields.

## Why this exists

[garment-field-reference.md](garment-field-reference.md) ("Open: sleeve wall thickness is an
unresolved dimension") says a `sleeve_bulk` field may be proposed only after an audit of
representative straight-sleeved knits shows **recurring layering failures that are independent of
sleeve shape**. Live `thread_1792565763642` raised it again: the selected-piece composer put the
fine, semi-sheer plum cardigan (996887, 3/4 sleeves) over the charcoal ribbed sweater-knit sheath
(996791, long sleeves), and the owner asked "did you notice how thick the charcoal ribbed dress
sleeves are?". This is that audit.

Method: offline, on an isolated copy of the owner's `wardrobe.db` (2026-10-21), no model calls.
Every user-input store classified in `scratch/feedback_surface_inventory.json` was searched for
sleeve, bunching, bulk and thickness language (759 raw matches). Model-written text stored next to
feedback (card reasons copied into `stylist_feedback.note`/`payload`, `saved_boards`, conversation
state) was set aside; what remains is the owner's own words — chat messages, plus the 2026-09-14
owner rulings in [stage1-cause-matrix-2026-09-14.md](stage1-cause-matrix-2026-09-14.md). No stored
rule, rejection or owner constraint mentions sleeve thickness.

## Every owner-raised sleeve layering case

Inner garment first. Tags are as recorded on 2026-10-21.

| # | Source | Inner → outer | Owner's words / ruling | Tagged sleeves (inner; outer) | What explains it |
|---|---|---|---|---|---|
| 1 | `thread_1787728618995` | black turtleneck 144 → white lace-sleeve blouse 996781 | "look at the sleeves on that turtleneck - it can't work that way either" | extra_long `gathered_ruched`; long `straight`, light, semi-sheer | **Shape** (tagged) |
| 2 | `thread_1787733949661` | beige lace relaxed top 173 → lilac floral knit cardigan 224 | "how did you think it would fit under the tight-fitting thin cardigan?" | elbow `deep_armhole`; long, shape not recorded, `clings_stretchy` | **Shape** (tagged) |
| 3 | `thread_1788114275627` | olive textured mock neck top 140 → charcoal bouclé cropped jacket 250 | "Did you check the sleeves on the olive textured mock neck top?" | 3/4 `deep_armhole`; long `straight`, `structured` | **Shape** (tagged) |
| 4 | 2026-09-14 ruling | green floral knit cardigan 238 → navy puffer 996866 | Incompatible: "the real knit and sleeve are fairly thick", and do not compress | extra_long `voluminous`, medium cotton; long `straight` | **Thickness.** Shape cannot separate it from case 5 |
| 5 | 2026-09-14 ruling | patchwork knit top 184 → the same puffer | Wearable | 3/4 `voluminous`, medium cotton; same | Control for case 4: same shape tag, same weight tag, opposite outcome |
| 6 | 2026-09-14 ruling | black turtleneck 144 → the same puffer | Wearable | extra_long `gathered_ruched`; same | Control: a ruched sleeve that compresses |
| 7 | `thread_1792565763642` | charcoal ribbed knit sheath 996791 → plum cardigan 996887 | "did you notice how thick the charcoal ribbed dress sleeves are?" | long `straight`; 3/4 `straight`, light, semi-sheer | **Thickness.** Both sleeves are tagged `straight` |
| 8 | `thread_1787803856242` | grey striped cotton shirt 996795 → sheer silk shrug 141 | "so delicate, elbow-sleeved, sheer silk shrug over a cotton long-sleeved … shirt is fine?" | long `straight`, light; elbow `fitted`, ultralight, sheer | **Relative weight** (fine layer over a sturdier one); a skeptical question, not a ruling |

Set aside: `thread_1787989565632` (the complaint was that the cards were built without looking at
photos, not a sleeve outcome), `thread_1790924998519` (a waist tie, not a sleeve), and three
2026-10 threads asking which long-sleeve tops go under the cap-sleeve vibrant floral top
(questions, not failures).

## Findings

1. **Shape-explained failures exist and the shape tag already carries them** (cases 1–3). They are
   not evidence for a new field.
2. **Two owner-confirmed failures are independent of shape** (cases 4 and 7). In case 4 the shape and
   weight tags are identical to case 5's and the outcomes are opposite; in case 7 both garments are
   tagged `straight`. What separates them is how thick and compressible the sleeve is. Case 8 is a
   possible third, of a related kind: a much finer layer over a sturdier one.
3. **The model cannot recover it from what it is given.** In an exact replay of case 7's composer
   call (all 32 images byte-identical to the 2026-10-21 capture), both gemini-3.5-flash-lite and
   claude-sonnet-4-6 put the cardigan over the dress; Sonnet made it its top card. Sonnet *did*
   flag the turtleneck 144's ruched sleeve under the same cardigan, the case the shape tag records.
   One run each.
4. **The ambiguous bucket is large.** Of 95 active tops, dresses and outerwear with elbow-length or
   longer sleeves, 63 are tagged `straight` or `fitted`. 24 of those are knits (or bouclé/fleece)
   tagged `medium`, and that bucket holds both a ribbed crew-neck tee (996874) and cashmere
   sweaters, a waffle-knit sweatshirt and fleece jackets (996870, 996885, 996896, 996760–996762).
   Nothing recorded tells those apart at the sleeve.
5. **Garment-level weight is being used to say it anyway.** On 2026-10-21 the owner set 996791's
   `fabric_weight` to `heavy` (manual override, with `fit_on_body` → `clings_stretchy`). That is
   true of this dress as a whole. It also shows the pressure the 2026-09-14 direction warned
   about — "do not change a garment's whole `fabric_weight` to express a thick sleeve" — and the
   prompt still tells the model that whole-garment values are "not its sleeves".

## Verdict

By the field reference's own test, the audit **establishes** a recurring failure independent of
shape: two owner-confirmed cases five weeks apart, on different garments and different outer
layers, each with a same-shape control or a same-shape pair; plus one likely related case. It is
a small sample, and the wardrobe has few recorded owner judgments about sleeves at all (eight
cases in five months), so "recurring" rests on two clear instances.

If the owner wants the field, the reference's own constraints apply: an orthogonal nullable field,
never derived from length, never folded into `sleeve_shape`. It would need the tagger, PieceForm,
BatchAdd and the field reference like any tagged field, and would reach the composer on the shared
fact line. Without it,
the composer has no recorded way to see what the owner saw in case 7.

## Probe: can the model see it from the photographs? (2026-10-21)

After the ruling, one paid probe ($0.167, 20 calls, one per cell) asked whether the models miss this
because the text fact line overrides the photographs, or because they cannot see it. Each call showed
only the two garments (hanger and worn photos, 768px, high detail) and asked the same neutral
question: garment A is worn under garment B, both sleeves on; would you put B over A? Arm 1 gave
names and photos only; arm 2 added the fact lines as the composer saw them (996791 still `medium`,
`skims`, from a copy taken before the owner's retag).

| Pair (inner → outer) | Owner | flash-lite, photos | flash-lite, + facts | Sonnet 4.6, photos | Sonnet 4.6, + facts |
|---|---|---|---|---|---|
| charcoal sheath 996791 → plum cardigan 996887 | unworkable | workable ✗ | unworkable ✓ | workable ✗ | workable ✗ |
| green floral cardigan 238 → puffer 996866 | unworkable | ✓ | ✓ | ✓ | ✓ |
| patchwork knit top 184 → puffer | workable | ✓ | unworkable ✗ | unworkable ✗ | unworkable ✗ |
| black turtleneck 144 → puffer | workable | ✓ | ✓ | ✓ | uncertain |
| cream short-sleeve top 996793 → plum cardigan | workable | ✓ | ✓ | ✓ | ✓ |
| **Agreement** | | 4/5 | 4/5 | 3/5 | 2/5 + 1 uncertain |

What the answers show:

- **The text is not what misleads them.** Photos alone did no better than photos with facts.
- **They can see a chunky knit when it looks chunky.** 238 was called "chunky knit" from the
  photos alone by both models, 4/4 correct (Contract A had 0/3 on it in September, with a
  different prompt).
- **They do not see the charcoal sheath as thick.** Both models describe it as "sleek",
  "form-fitting", "moderate texture"; Sonnet misread its long sleeves as 3/4 and reasoned that an
  open, draped cardigan "will skim over" it. Neither judged the cardigan's sleeve as narrow. The one
  correct call (flash-lite with facts) reasoned from sleeve length and "a lightweight semi-sheer
  open cardigan over a fitted structured sheath dress creates a clash in … fabric weights".
- **Their reading of bulk is unreliable in both directions.** Sonnet called 184 "chunky … heavy knit
  panels" and rejected it; the owner rules it wearable.
- **The stronger model was not better** (3/5 and 2/5 against 4/5 and 4/5). One run per cell; small.

## Layer-order principle, tested locally (2026-10-21)

One sentence was added to the composer's system prompt in the replay only (no source change),
after "Layering & Sleeve Physics":

> Layer Order: Layer from finer to more substantial. Before putting one garment over another,
> compare their photographs: an outer layer that is visibly finer, lighter or sheerer than what it
> covers will cling to it, crowd at the sleeves and look like an afterthought.

The captured composer call (32 images byte-identical) was replayed 3 times on flash-lite ($0.023).
**The cardigan went over the charcoal sheath in all 3 runs** (rated signature, strong, strong), as it
did in both baseline runs. No card mentions the sleeves or the weight difference. Nothing else
moved in a consistent direction: the other cards drew from the same pieces as the baselines, and
run 2 repeated the dress-plus-trousers slot error. The sentence asks the model to act on a
difference it does not perceive (see the probe above), so it never applies.

**With the owner's current whole-garment tags** (996791 `weight heavy, fit clings_stretchy`, swapped
into the captured request) plus the same sentence, 3 more flash-lite replays ($0.013): the cardigan
went over the sheath in **2 of 3** runs (strong, signature). In one of them the model named the
difference, "the heavy black ribbed sheath dress … the semi-sheer plum cardigan", warned "make sure
the dress knit and cardigan knit don't cling awkwardly at the arms", and built the card anyway.
Two of the three runs also put the black turtleneck 144 (gathered extra-long sleeves) under the
same cardigan. Recorded weight plus the principle moves it a little, not reliably.

## Wearability-first composition (2026-10-21, implemented on the branch, not committed)

Owner direction: fix the composer's reasoning order, not add a gate, a tag or a sleeve heuristic.
Two prompt changes and one schema change, all in shared code, so every visual composer gets them
(Whole Wardrobe, selected piece, `/ask` multi-look):

- `NEUTRAL_SLEEVE_LAYERING_STATEMENT` reworded. The old sentence ("Sleeve shape and relative sleeve
  length alone do not establish…") read as a reason to distrust sleeve evidence. It now says not to
  decide from sleeve labels or lengths alone, to judge the two garments from their photographs and
  construction, and that an obvious conflict visible in the separate photographs counts.
- `layerWearabilityFirstPromptRule()` in the composer's composition rules: for every layered pair,
  name inner and outer, look at both, ask whether the inner fits inside the outer at sleeves, armholes
  and body, and only then judge colour, proportion, texture and the idea. A clear conflict rules the
  pair out however good it looks; when unsure, prefer a candidate that is clearly wearable.
- `layering_check` is now the **first** field of every card in `composerOutfitSlotsSchema`, so the
  check is written before the card's label and idea. Before, the label, strength, direction and
  silhouette came before the garment IDs.

Neither text names a sleeve shape, length or fabric (pinned in `test/sleeveGeometryLogOnly.test.js`).

**Composer replay** (the captured call from `thread_1792569468413`, 32 images byte-identical, owner's
current tags, flash-lite, 3 runs per arm, $0.049):

| Arm | Sheath dress 996791 under the cardigan | Other bases chosen under the cardigan |
|---|---|---|
| old prompt + old schema | **2 of 3 runs**, both "signature" | short-sleeve rib top ×3, striped button-up 133, turtleneck 144, colourblock sheath 996787 (with a dress+trousers slot error), rust 3/4-sleeve dress 996790 |
| new prompt + `layering_check` | **0 of 3** | short-sleeve rib top ×3, striped button-up 133, turtleneck 144, sleeveless sheath 996787, rust 3/4-sleeve dress 996790, lace-sleeve top 996873, short-sleeve wool dress 161 |

The checks are relational ("worn over sheath dress 996787; the fluid 3/4 sleeves layer smoothly over
the sleeveless shoulders"), but several still reason optimistically from tags about long-sleeved
bases ("3/4 fitted sleeves fit cleanly over the long fitted sleeves of the button-up shirt"), and
the owner rated five of six held-out long- or 3/4-sleeved tops unworkable under this cardigan. The
long-sleeved bases chosen in both arms (133, 144, 996873, 996790) are not yet owner-labelled.

**Pair probe** (only the two garments, the composer's layering instructions, 11 owner-labelled pairs
× 2 arms × 3 runs, $0.086): old 23/33, new 24/33. Asked directly, both arms reject the incident pair
3/3, so the composer's failure was not an inability to judge a named pair; it was never asking
while composing. The new wording got the 3/4-sleeve boat-neck top wrong 3/3, reasoning from the
cardigan's recorded light weight and stretch; both arms rejected the cream rib crew (owner: works,
not great) and the voluminous patchwork top under the puffer (owner: wearable). Samples are small.

## Missing-layer repair (2026-10-22, tested, no effect, reverted)

Live `thread_1792701395406` (Whole Wardrobe): the composer, on the new rule, built three cards with no
layer; the missing-layer repair then added one to each. Owner: card 4, the black and grey textured
cropped cardigan (135) over the long-sleeved emerald wool sweater (996904), is **wrong** ("the soft
delicate cardigan is put over a long sleeved wool sweater"); card 5, the structured bouclé cropped
jacket (250) over the 3/4-sleeve knit dress (996790), is **right**.

The repair prompt was given the same wearability-first rule, and its JSON example now asks for a
`layering_check` before `layerId` (repairs) and before `consideredLayerIds` (declines). Replay of the
captured repair call, 28 images restored byte-for-byte from the capture, 3 runs per arm ($0.038):

| Arm | Sweater card (owner: cardigan 135 wrong) | Dress card (owner: bouclé 250 right) |
|---|---|---|
| old | cardigan 131, cardigan 135, bouclé 250 | lambskin 207 ×3 |
| new | cardigan 131, cardigan 135, cardigan 131 | trench, lambskin 207, lambskin 207 |

No improvement: the new arm put a soft knit cardigan over the wool sweater in all 3 runs (131 is a
cashmere cardigan, not owner-labelled, same kind of pairing) and never declined. Its checks reason
from tags after the fact ("the fine cashmere fabric of the cardigan slides smoothly over the wool
knit sweater"). The repair's task — "add ONE layer from that card's candidate list" because the
conditions turn cool, with declines required to show their work — pushes it to pick some layer.

**Reverted (owner, 2026-10-22).** The repair prompt is back to its previous text; only the composer
change stays. The repair still states the reworded `NEUTRAL_SLEEVE_LAYERING_STATEMENT`, because that
sentence is shared. Whether the repair should force a layer onto cards the composer left without one
is an open design question.
