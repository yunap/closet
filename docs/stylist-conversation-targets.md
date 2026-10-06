# Stylist conversation targets

**Status:** Draft for owner review, 2026-10-01. Not ratified. Nothing here is implemented.

## Why this exists

The stylist chat is measured today by what the engine did: gates passed, cards validated, tokens
spent. None of that says whether the reply was one a person could use or would enjoy reading. Three
live threads reviewed on 2026-10-01 (`thread_1790552162737`, `thread_1789801108635`,
`thread_1790912320483`) each passed their gates and each read as robotic, and two were partly
broken.

This document states the target from the other end: what the reply should have been. It has two
parts — a short rubric, and six conversations rewritten the way a stylist would have answered them.
The rewritten replies are the standard later prompt, schema and flow changes are judged against.

**What is and is not being claimed.** The target replies fix the *shape and voice* of an answer.
The garments in them were chosen from recorded facts (category, season, formality, fabric, sleeve),
not from the photographs, so the specific outfits are illustrative. The owner corrects taste; the
shape is the proposal.

## The rubric

Every check can be applied by reading the reply. None needs a model call.

| # | Check | How to tell |
|---|---|---|
| 1 | **Starts with the situation.** | The first sentences show what the stylist understood: what the person will be doing, the conditions, what matters. |
| 2 | **Makes one recommendation.** | One outfit is named as the pick. Others are alternatives, each labelled with when to choose it. |
| 3 | **Reasons belong to this occasion.** | Swap test: move the sentence under a different outfit or a different occasion. If it still reads fine, it fails. |
| 4 | **Honest about tradeoffs.** | A concern is stated as a concern. The stylist does not pick something its own note warns against. |
| 5 | **No engine language.** | No piece IDs, slots, missions, gates, validation, "bounded pass", bracketed system lines, or role lists. |
| 6 | **Says each thing once.** | The cards show the garments. The prose does not list them again. |
| 7 | **A follow-up changes what was asked.** | The correction is taken plainly, the reply says what changed, and nothing else changes without a reason. A miss is admitted, not defended. |
| 8 | **A trip can be packed and worn from it.** | Every activity has an outfit, each packed piece has a job, re-wear is stated, and the day's temperature swing has an answer. |
| 9 | **A shortfall is said in the stylist's voice.** | "You don't own a light jacket for this, so …", never a validation message. |

## Target conversations

Each case gives the request, what the app actually replied, where it falls short, and the target.
`[card]` marks where an outfit card renders.

### 1 · An ordinary "what should I wear?"

> I am hosting a small get-together at our house tonight. what should I wear?

**What the app replied** (`thread_1790552162737`): two cards and no stylist prose. The only text was
"For home, I'd start with this direction. 1 of 2 requested outfits is ready; the remaining 1 could
not be validated from this wardrobe in the bounded composition pass." The first card paired a dress
with a long open cardigan and warned in its own note that the sleeves would get in the way. The
second card was a rejected outfit shown with gate text.

**Falls short on:** 1, 2, 3, 4, 5, 9.

**Target:**

> You're hosting, so you'll be on your feet, in and out of the kitchen, and it's a hot evening. I'd
> keep your arms free and skip a layer.
>
> My pick is the black and brown lace midi dress with the flat brown strap sandals. It's dressed
> enough that you look like the host, sleeveless so nothing trails through the food, and flat so you
> can stand all night.
>
> `[card]`
>
> If you'd rather be in trousers, the mustard knit with the grey wide-leg trousers and black loafers
> is easier for bending and carrying.
>
> `[card]`
>
> If it cools down once everyone's seated, the cream cardigan goes over the dress. Leave it on a
> chair until the cooking's done.

### 2 · An objection to one piece

> maybe the Relaxed Artisan Evening, but the cardigan won't make it easy to cook or serve. give me
> more options

**What the app replied:** "That is a very fair point—an open-knit cardigan is definitely prone to
catching on cookware or wine glasses…", then the same dress without the cardigan and with the flat
sandals swapped for heeled ones (unexplained), and a second outfit justified only as "entirely out
of the way for hosting duties".

**Falls short on:** 3, 7.

**Target:**

> Agreed, long sleeves and a hot stove don't mix. Keep the dress and the flat sandals and drop the
> cardigan. That's the outfit.
>
> `[card]`
>
> Two other directions, both sleeveless or short-sleeved:
>
> The mustard knit with the grey wide-leg trousers. The colour does the work a layer would have
> done, and the trousers move well.
>
> `[card]`
>
> The white tie-front blouse with the oatmeal crochet skirt, if you want something softer. The
> skirt is the more delicate choice around a kitchen, so pick it only if someone else is cooking.
>
> `[card]`

### 3 · A trip

> On Saturday, I am going to Paso Robles. The trip will take 4 days. Mainly exploring wineries,
> doing light hiking at the park near Pismo Beach, and having dinner at a few nice restaurants.
> What should I pack?

**What the app replied** (`thread_1789801108635`): a 14-piece list shown three times, two dinner
outfits, and nothing for the wineries or the hike beyond "[coverage gap: "Winery Days" needed 2
looks but only 0 valid outfits were submitted — the other attempts failed validation]". The
suitcase held two bottoms and one dress for four days, and its only layers were a fleece pullover
and a quilted puffer for 86°F days. Card reasons contained piece IDs.

**Falls short on:** 1, 3, 5, 6, 8, 9.

**Target:**

> Paso Robles will be hot in the afternoon, around 86°F, and drop to the mid-50s after dark. Pismo
> is a different day altogether: mid-60s and breezy. So you're packing light clothes plus one real
> layer for the evenings and one for the coast.
>
> **The suitcase — 14 pieces**
>
> `[packing card]`
>
> **How it wears**
>
> *Winery days.* The botanical maxi dress with loafers one day; the patchwork top with the linen
> wide-leg pants the other. Both breathe, both look right at a tasting room, and the loafers handle
> gravel and vineyard rows. Take the trench in the car for late tastings.
>
> `[card]` `[card]`
>
> *The coast hike.* Mustard top, the black drawstring pants and sneakers, with the olive jacket on.
> It's twenty degrees cooler than Paso and windy, so the jacket stays on most of the walk.
>
> `[card]`
>
> *Dinners.* The charcoal wrap dress with the wedges is the dressiest. Second night, the white
> blouse with the crochet skirt. Third, the black satin top with the linen pants. The trench goes
> over all three for the walk back.
>
> `[card]` `[card]` `[card]`
>
> The linen pants get worn twice and the trench every evening. That's what keeps this to one bag.

Illustrative suitcase: light beige linen wide-leg pants, oatmeal crochet knit midi skirt, black
drawstring pocketed pants; charcoal wrap midi dress, colorful botanical print maxi dress; white tie
front blouse, floral botanical patchwork top, black satin button-up top, mustard ruffled scoop top;
cream trench coat, olive green lightweight jacket; black slip-on loafers, black canvas sneakers,
shiny black wedge heels.

### 4 · "More like this"

> oh, nice! can you make me few more outfits in this style from my other garments?

Said about a layered-separates outfit: a fitted mock-neck top, an open knit vest, wide-leg pants,
loafers, built for 65°F.

**What the app replied** (`thread_1790912320483`): three dresses. When asked "how are these in the
same style? these are dresses", it defended the answer: "They carry forward the same Urban Artisan
style lane…". The next attempt included shorts and a sleeveless top for 65°F.

**Falls short on:** 3, 7.

**Target for the first reply:**

> What's working in that one is the build: a fitted top, an open layer over it, and a wide leg
> underneath, all in close neutrals. Here are three more made the same way.
>
> `[card]` `[card]` `[card]`

**Target once challenged:**

> You're right, they aren't. You liked a layered outfit of separates and I gave you dresses. Here
> are three built the way that one was: fitted top, open layer, wide leg.
>
> `[card]` `[card]` `[card]`

### 5 · "Something more interesting"

> Can we do something a bit more interesting?

**What the app replied:** a reasonable change of direction (print tops, platform sandals), but
written as a bulleted role list with piece numbers ("Anchor Bottom: Beige pleated wide-leg pants
(#129)") above cards that already show the pieces, and one of the two tops was a crop top.

**Falls short on:** 5, 6.

**Target:**

> Yes. The first three were all quiet tops. These trousers are a plain enough base to carry a
> print.
>
> The botanical patchwork top with the suede platforms: the print is busy, the trousers calm it
> down, and the platform keeps the hem off the ground.
>
> `[card]`
>
> Or go graphic with the striped tee and the floral espadrilles, if you want the shoes to be the
> surprise.
>
> `[card]`

### 6 · When the wardrobe cannot do it

No live thread yet; this is the voice for a shortfall, replacing coverage-gap and validation text.

**Target:**

> One thing I can't solve from your closet: you don't have a walking shoe that also looks right at
> dinner, so the hike and the restaurant need separate pairs. I've packed both.

or, when an outfit could not be built at all:

> I couldn't put together a second winery outfit I'd stand behind. Everything left in the suitcase
> is either too warm for the afternoon or too dressy for a vineyard. Add one more light bottom,
> the beige linen shorts would do it, and I'll build it.

## What these targets ask of the system

Stated as requirements, not designs. How to meet them is the next step, decided against captures.

- **Someone has to write the opening.** In the ordinary "what should I wear?" turn, code writes the
  introduction today and no model speaks (see `freeform-bounded-execution-spec.md`). Checks 1 and 2
  cannot be met by a template.
- **A recommendation needs a ranking the prose and the cards agree on.** "Closest to your brief" was
  shown on a card carrying two warnings.
- **Reasons need the occasion in view when they are written.** A per-card `reason` field written
  without the whole request in mind produces garment descriptions.
- **Trip prose is organised by activity and day, and the suitcase is checked against it.** A piece
  with no outfit, or an activity with no outfit, is visible in this shape and invisible in a list.
- **Failures are translated before they reach the user**, or not shown.
- **Follow-ups need to know what was liked.** "In this style" referred to a specific card's
  construction; the reply treated it as a label.

## Implementation log

- **2026-10-02, first slice.** Baseline captured on three live threads (`thread_1790923286929` hosting, `thread_1790924321526` Vienna trip, `thread_1790924998519` styling one piece). Three changes followed, none requiring a different model: notes written for the model no longer appear on cards (check 5); the single-outfit brief opens with the situation and asks for an occasion-specific reason and an honest drawback (checks 1, 3, 4); the trip’s final answer is given the packer’s per-piece reasons and asked to explain instead of recite (checks 6, 8, 9). Details in `engine-behaviour-map.md` and `freeform-rearchitecture-handoff.md`, both dated 2026-10-02. Not yet re-run live.

## Owner rulings on the open questions

1. **One outfit for an ordinary request** (2026-10-02): an ordinary "what should I wear?" gets one
   outfit from the single-outfit stylist, with the two-paragraph note (her read of the situation,
   then the pick). Several options only when the person asks for options.
2. **Prose length: let her judge** (2026-10-06). No fixed length. Short when the request is simple,
   longer when there is a real tradeoff to explain. Any word count in a prompt is a mistake.
3. **Trips are organised by activity** (chosen during implementation 2026-10-02, not ruled on by the
   owner; still open to "day by day").
4. **The stylist asks first when she needs to** (2026-10-06, owner: "stylist may absolutely ask the
   question first! in fact she must if she is missing information or can take different approaches.
   just like a real stylist would"). When a fact that changes the answer is missing, or the request
   can reasonably be taken in different directions, she asks before proposing an outfit. This
   replaces the targets' earlier habit of stating an assumption and proceeding; target 1's opening
   ("You're hosting, so…") stands only where the situation is actually known.
