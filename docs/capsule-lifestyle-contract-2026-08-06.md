# Capsule lifestyle contract — session record and requirement correction

Written 2026-08-06. This is the durable record of the engine/model comparison arc that began with
PR #206, the live comparison runs that followed, and the resulting correction to capsule roster
requirements.

> **Status:** the corrections described here are merged through PR #213. For the concise canonical
> description of production behavior, read
> [capsule-current-behaviour.md](capsule-current-behaviour.md). This document preserves the detailed
> reasoning and live-run sequence.

## Decision in one sentence

A capsule is selected for the life the user described. Published category formulas are useful
starting shapes for the roster model, but they are not universal validity rules, and the number of
outfit cards shown is not a garment quota.

## 1. What production already did correctly

Before proposing a new intake flow, we inspected the actual saved production conversation
`thread_1785272841293`.

For the request “I want a summer capsule,” the stylist did **not** assume a generic hot-weather or
home-only life. It asked one natural follow-up:

> What does your summer mainly look like this year?

The owner answered that it included casual days at home, errands, weekends out, museums, city
outings, restaurants, social events, and nature walks with the dog. Production translated that
answer into four use cases:

| use case | representative looks |
|---|---:|
| Casual / Home / Errands | 3 |
| Nature Walk | 2 |
| City Outing / Museum | 3 |
| Restaurant / Social | 3 |

That intake is the correct source of truth. No new questionnaire or dress-preference question is
needed for a normal seasonal-capsule request. The roster model should infer whether a dress earns a
place from the elicited activities, owner rules, climate, candidates, and the garment's usefulness.

## 2. What the comparison harness had wrong

The first version of `scratch/compare_capsule_rosters.js` used a synthetic summer scenario:

- At Home
- City Outings
- Brunch
- Restaurant Dinner

It omitted errands, weekends/social events, and—most importantly—nature walks. Therefore it was
not comparing engine and model rosters against the life the user had actually described. Its shoe
judgments could prefer an all-sandal collection while never testing the walking/outdoor job.

The harness now uses the four production use cases above. The existing command and scenario filter
remain unchanged:

```bash
WARDROBE_ALLOW_LIVE_DB=1 node scratch/compare_capsule_rosters.js --with-model --dry-run --scenario "summer · mixed"
```

The explicit database flag is a repository safety requirement. `--dry-run` still stops before the
first paid provider call.

## 3. What the live comparisons established

The first visual comparison showed that the roster model could make a more aesthetically coherent
selection, but it returned the wrong category counts and then repeated the same invalid roster on
repair. The root cause was not necessarily insufficient garments: the model had never been shown
the category shape against which code was grading it.

The chooser and harness were extended to expose:

- both model attempts rather than only the deterministic fallback;
- each attempt's visual roster sheet;
- the model's category counts and category-shape reasoning;
- repair changes and reasons;
- the actual failure codes and provider usage.

After the category shape was included in the prompt, the model filled the 8/7/3/2/4 example shape
exactly. A later comparison still failed because code demanded two elevated shoe paths. The model
correctly explained that one pair of black wedge heels covered the restaurant/social job. This
made the deeper defect visible: code had converted the number of representative outfit cards into
duplicate garment requirements.

## 4. Corrected capsule requirements

### 4.1 Starting guidance, not hard validity

For a 24-piece capsule, the current example shape remains:

| tops | bottoms | dresses | layers | shoes |
|---:|---:|---:|---:|---:|
| 8 | 7 | 3 | 2 | 4 |

The roster model sees this as a **category starting shape**. It must explain departures, which
preserves useful bookkeeping and makes unusual choices reviewable. The validator does not reject a
roster solely for departing from these counts.

This corrects the earlier interpretation of the external research. The sampled capsule formulas
show common shapes, but they disagree; Project 333 has no category split, and flexible capsule
frameworks explicitly adapt to the wearer. The sources do not prove universal requirements for a
fixed number of dresses, layers, shoes, statement pieces, or sleeve-covered tops.

### 4.2 Current hard checks

Hard validation is now limited to facts that make the capsule operationally wearable:

- the roster has exactly the requested total number of owned, bench-eligible pieces;
- selected IDs and model bookkeeping are internally valid;
- the capsule has a usable low-register separates path when the elicited lifestyle includes one;
- a garment that requires a base has a genuine standalone base that is valid in the same use case;
- footwear covers materially distinct lifestyle jobs actually present in the plan, including an
  elevated path only when an elevated use case exists;
- an activity-specific job such as nature walking retains suitable footwear rather than being
  absorbed by an unrelated sandal or evening-shoe path;
- owner rules and deterministic weather, occasion, suppression, and garment-validity gates remain
  binding.

One versatile garment may cover more than one compatible job. Conversely, genuinely different
jobs—nature walking and a polished social occasion, for example—must not be collapsed merely to
hit a small shoe count.

### 4.3 Requirements removed as universal hard rules

The following no longer invalidate a roster by themselves:

- exactly two layers or outerwear pieces;
- at least one dress;
- at least one statement piece or loud print;
- fixed winter indoor and transition layers;
- a fixed winter sleeve-covered-top ratio;
- category ceilings derived from the example formula;
- multiple low-register or elevated shoes derived from `targetOutfits`;
- enough distinct outfit cores to equal the number of presentation cards requested.

These can still be good stylistic choices. The roster model may select them and explain their jobs;
they are simply no longer manufactured by deterministic code without lifestyle evidence.

### 4.4 Cards are presentation, garments are the product

`targetOutfits` says how many representative examples the app should show for a use case. It does
not mean the capsule needs that many tops, bottoms, or shoes at that register. The wardrobe's
underlying mix-and-match capacity remains useful diagnostic evidence, but a request for three
restaurant cards does not create a hard requirement for two or three dressy shoes.

## 5. Code changed in this correction

- `scratch/compare_capsule_rosters.js` now reproduces the real production summer lifestyle.
- `routes/ai.js` presents category counts as a starting shape, asks the model to cover distinct
  footwear jobs, and forbids manufacturing duplicates from card counts.
- `styling-engine/outfitSetPlanner.js` validates lifestyle jobs instead of formula counts, removes
  the obsolete layer-gap exception, and lets an incoming shoe preserve the outgoing shoe's real
  job during deterministic repair.
- `test/plan_outfit_set.test.js` permanently covers the corrected boundary: formula departures do
  not cause repair, card multiplicity does not multiply reserves, distinct activities still matter,
  and genuine structural failures still repair or fall back.
- `docs/capsule-real-world-rules.md` and `docs/capsule-step5-evaluation.md` now identify the earlier
  fixed-formula conclusions as superseded.

The production lifestyle-elicitation reply itself was not changed because inspection showed it was
already doing the right job.

### 5.1 Composition integrity follow-up

An offline replay of thread `thread_1786036700758` found a separate composition defect in the
saved card titled “White Tank + Black-Brown Lace Floral Dress.” Its prose corrected itself and
said the tank was excluded, but the structured `piece_ids` still contained the tank. Because the
capsule composer previously treated any visually seen top and dress as a permissible pairing, the
stale IDs survived validation.

The composition validator now rejects a top-plus-dress look unless garment truth supports one of
the two legitimate directions: the top is an overlay worn over the dress, or the top is a base
layer worn under a compatible dress. Both pieces must still have been viewed. The self-revision
detector also recognizes “Correcting:” so prose that contradicts its own submitted IDs is sent
back for repair. The exact saved-card shape is covered by an offline regression test; explicit
overlay and explicit base-layer combinations remain valid.

## 6. Verification and merged status

The corrected real-lifestyle comparison resolved all 70 bench photos and the accepted model roster
passed on its first provider call. It contained 24 pieces, matched the example 8/7/3/2/4 shape, and
reported stronger measured capacity for all four real use cases than the deterministic roster.

The later yellow-palette app run exposed two additional defects now included in the merged
contract: the first-turn palette was lost when the next turn answered lifestyle intake, and the
closing response inferred shortage and prior rejection without evidence. Palette context is now
preserved across the clarification turn; fallback obeys the same requested-family boundary; and
shortage/bad-piece claims require explicit evidence.

The exact stale “White Tank + Black-Brown Lace Floral Dress” card is now an offline regression.
The focused composition suite passed **274/274** after adding it, including positive cases for both
an overlay over a dress and a base layer under a compatible dress. Style-constitution and
text-matching ratchets also passed. At that checkpoint the repository-wide suite still contained
11 unrelated existing failures; no capsule composition test failed.

## 7. Reproducing the comparison

Use a dry run first when the goal is to verify paths, photos, scope, and estimated cost:

```bash
WARDROBE_ALLOW_LIVE_DB=1 node scratch/compare_capsule_rosters.js --with-model --dry-run --scenario "summer · mixed"
```

Use the billed command only when another visual roster comparison is actually needed:

```bash
WARDROBE_ALLOW_LIVE_DB=1 node scratch/compare_capsule_rosters.js --with-model --scenario "summer · mixed"
```

The comparison is not required after every documentation or offline-validator change. Run it when
the question is again whether model selection is aesthetically better than deterministic selection,
or when a roster-prompt change needs visual evidence. Interpret validation narrowly: a failure
should name a real lifestyle or wearability defect, not disagreement with a generic formula.
