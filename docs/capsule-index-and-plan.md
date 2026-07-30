# Capsule work — index, live-run findings, and the plan out

Written 2026-07-30. **Start here** for anything capsule-related. This is the map and the sequence;
the detail lives in the documents linked below.

## 1. How we got into this

The capsule feature was built correct-by-construction in its mechanics — global core allocation,
post-conditions, atomic composition, honest shortfall disclosure — on top of **category and colour
constants that were invented in code**, each with a plausible comment and no source. That was not
visible until someone asked where the numbers came from.

Once asked, the answers were uncomfortable:

- the ratified Style Constitution contains **zero** mentions of capsule, outerwear or quota
- a summer capsule was allotted **zero** layers, which no published framework supports
- the dress quota of 1 was silently capping the *bench*, so a stage whose entire purpose is letting
  the model choose the roster was showing it **1 of 10 eligible dresses**
- **18 colour entries across four engine lists can never match anything**, because they were written
  against a vocabulary that does not exist
- the wardrobe's colour vocabulary cannot express `coral`, so the coral maxi dress is tagged `pink`

None of this was reachable by reading the code, which is why the research documents exist. The rule
going forward: **a constant that shapes output needs a source, an owner ruling, or a measurement —
a comment explaining the reasoning is not one of those.**

## 2. The documents

**Research — what the outside world says.** New 2026-07-30, all with citations.

| document | what it settles |
|---|---|
| [capsule-real-world-rules.md](capsule-real-world-rules.md) | Category counts. Six frameworks compared; layer allowance is season-invariant at 2; dresses 2–3; the tops:bottoms question and **why changing it was reverted**. |
| [capsule-palette-rules.md](capsule-palette-rules.md) | Palette. 2–4 neutrals + 1–2 secondary + 1–2 accents; 60–70% neutral; the accent-connectivity rule; the 60/30/10 misattribution. |
| [color-taxonomy-rules.md](color-taxonomy-rules.md) | The colour model itself. Google's family/display-name split, Baymard on swatches, the dead-entry audit, the proposed family + neutrality model and migration. |

**Design and history.**

| document | what it holds |
|---|---|
| [capsule-roster-selection-spec.md](capsule-roster-selection-spec.md) | The three-stage roster-selection design (bench → model chooses → engine validates). Stage 3 is built and behind `WARDROBE_MODEL_CAPSULE_ROSTER`, default off. |
| [capsule-bench-implementation-brief.md](capsule-bench-implementation-brief.md) | Operating rules and acceptance commands for spec steps 1–2. Delegation brief. |
| [stylist-bugfix-spec.md](stylist-bugfix-spec.md) | "Research done 2026-07-25 — what the capsule number should be": the *outfit-count* axis. Solid capacity measurements; its published-practice claim cites no source. |
| [occasion_profiles_ratification.md](occasion_profiles_ratification.md) | **Authoritative for occasion behaviour.** The register ceilings (ratified 2026-07-05, a month of testing), the occasion profiles, and the amendments since. **Read before changing any ceiling, profile keyword, or slot-occasion guidance.** |
| [stylist-session-handoff.md](stylist-session-handoff.md) | Running record of owner rulings. **Read before overturning anything.** |
| [engine-behaviour-map.md](engine-behaviour-map.md) | Measured behaviour of the engine's paths, including the editorial-prompt findings. |
| [spec-archive-index.md](spec-archive-index.md) | **35 specs live outside the repo in `~/Downloads/spec_*.md`.** Their decisions exist nowhere in `docs/`. Records what is in them, which decisions are load-bearing, and warns that their status lines are stale. |

## 3. Findings from the live run that are in no other document

From `thread_1785380251549` (2026-07-30, budget 24, 5 slots, stage 3 enabled). These came from
*observing a real run*, not from research, so they are the least reconstructible material here.

### 3a. The engine trusts model-declared slot facts that were wrong

| slot | environment declared | weather |
|---|---|---|
| At Home / Errands | indoor | `stated`, not hot |
| Weekends Out | outdoor | `isHot: true`, **heuristic** |
| City Outings / **Museums** | **outdoor** | `isHot: true`, **heuristic** |
| **Restaurants** / Social Events | **outdoor** | `isHot: true`, **heuristic** |
| Nature Walks | outdoor | `isHot: true`, **heuristic** |

Museums marked outdoor. Evening restaurants marked outdoor. Four of five slots stamped hot by
heuristic rather than from stated weather. **The two slots that most obviously need a layer are the
two labelled as not needing one.**

These feed the gate, the layer decision and the register ceiling simultaneously. Related: the slot
schema's `register` field is described as an event-weekend escalation tool — *"Omit for ordinary
slots (the occasion carries the register)"* — so the model omitted it on "Weekends Out", which
inherited a casual register from a neighbouring context.

**Status: partly fixed 2026-07-30 — the weather half.** The blanket `isHot` did not come from the
model at all; it came from the engine inferring heat from the word "summer" in the request.
`weatherProfileFromContext` now takes `seasonIsCalendarOnly`, set for a seasonal capsule, and a bare
season word no longer produces a hot profile. An explicit signal ("it's 95 here", "heatwave") still
wins, and cold is untouched.

Measured on the live plan: the hot gate had been removing **17-26 outerwear pieces from every
slot**, leaving **two of five slots unable to admit any layer**. After the fix every slot can reach
a layer and the two most indoor slots can reach both — which is what makes the outerwear quota
correction real rather than cosmetic, since the quota was buying layers the gate then discarded.

**Corrected 2026-07-30 by the owner — the occasion was not an error.** This section previously
called the model's `smart casual` choice for the restaurant slot a failure to follow schema
guidance. That was wrong, and the contradiction is inside this codebase, not in the model:

- `city_smart_casual`'s own keywords are `city, museum, shopping, **dinner**, brunch, office,
  everyday` — ceiling `elevated`.
- `evening_social`'s are `evening, dinner date, wine bar, theater, evening drinks, night out` —
  ceiling `dressy`.
- **Owner's semantics:** evening has historically been dressier than a restaurant; a restaurant
  usually reads smart casual, or maybe city.

So the model matched both the profile taxonomy and the owner's mental model. The `occasion` field
description telling it to *"map dinner/evening-restaurant/night-out use cases to 'evening'"* is what
disagrees — unratified scaffolding from PR #58, not an owner ruling, and it would have pushed the
restaurant slot to a `dressy` ceiling the owner does not want.

**Also corrected: occasion profiles do encode setting**, just not as a queryable field.
`outdoor_daytime_social` is outdoor by name; `gallery_art_event` and `home_loungewear` are indoor by
nature. A structured `climate_controlled` property would formalise what the ids and keywords already
imply rather than invent something new.

**Genuinely still open — `environment`.** Museums and evening restaurants were declared `outdoor`,
which is wrong. Its practical bite has shrunk, though: `environment: 'indoor'` mostly fed
`season: 'indoor'` to neutralise hot/cold gating, and for a seasonal capsule the
`seasonIsCalendarOnly` fix now neutralises heat anyway. What remains is its effect on winter capsule
indoor slots and on `beach_coastal` handling.

### 3b. The composer omits shoes when the roster has them

2 of 10 cards came back with no shoes, and in both cases the slot's own gate-allowed list had
plenty:

| slot | gate-allowed shoes | card |
|---|---|---|
| Restaurants / Social Events | **4** | "Tie-Front Blouse + Cream Linen Pants + Ribbed Cardigan" |
| Nature Walks | **3** | "White Tank + Tan Shorts + Navy Hoodie" |

Not supply, not the gate. **Pattern worth testing:** in both slots the *first* card had shoes and
the *second* did not. The atomic composer returns the whole rotation in one response under a prompt
that says "keep titles and reasons concise so the complete rotation fits comfortably" — consistent
with output-budget pressure, the model economising on later outfits.

**Status: open, and it is the recommended next piece of work** — see §4.

### 3c. What the run cost, and what stage 3 cost

Measured: 32,580 input / 3,726 output / 72,088 cache-read / 48,804 cache-creation ≈ **$0.358**,
against a $0.288 baseline without stage 3. The roster call is **~$0.075**, matching the pre-run
estimate of $0.075. Stage 3 fired cleanly: 1 call, 0 repairs, 0 fallbacks.

Its roster scored **71% pure-neutral against published guidance of 60–70%**, closer than the
deterministic roster's 79% — but spent 4 slots on outerwear (2 unused) and 1 on an accessory that
the composition prompt forbids, and covered **12 colour families against a recommended 5–9**.

## 4. The plan

Sequenced by dependency, not by appeal.

### Done — 2026-07-30

Accessories removed from the bench; explicit occasion tags now beat the register ceiling; summer
outerwear corrected from 0 to the season-invariant 2; quota **ceilings** added (quotas had only ever
declared floors); dress quota 1 → 2–3, which also unblocked the bench; season eligibility made
non-symmetric so a summer capsule drops cool-season cores but keeps a cool-season layer; the neutral
bonus restricted to pieces that introduce no colour; `taupe`/`oatmeal` added; roster utilization
disclosed.

### Step 1 — composition auto-complete *(no dependencies, recommended next)*

When a submitted look is missing a structural piece and its slot roster can supply one, complete it
at composition time instead of rejecting it to a needs-review card. The logic already exists:
`repair-capsule-look` does exactly this at `providerCalls: 0`, using `describeOutfitStructureGap`.

On the live run this converts **7 good + 3 needs-review into 9 good + 1**, at no model cost.
Testable offline against the saved thread.

### Step 2 — slot facts *(weather half done; declared-facts half still design work)*

The weather half is fixed and the occasion half turned out not to be a defect at all — see §3a.
What remains:

1. **The `occasion` field description contradicts the engine's own profile keywords** and the
   owner's register semantics. It should stop routing ordinary restaurant dinners to `evening`, and
   reserve `evening` for the dressy night-out contexts `evening_social` actually lists.
2. **`environment` is still model-declared and was wrong**, though the weather fix has removed most
   of its bite. A `climate_controlled` property on the occasion profiles would let the engine
   default it rather than trust it.
3. **The `register` guidance** — *"omit for ordinary slots"* — still lets adjacent contexts inherit
   one another's register, which is how "Weekends Out" ended up casual.

### Step 3 — colour taxonomy *(blocks step 4)*

Execute [color-taxonomy-rules.md](color-taxonomy-rules.md) §5. **The database schema does not need
to change** — family and neutrality are derived by lookup from the shade name. Order: reconcile the
vocabulary, fix the tagger, repoint the engine and delete the four hardcoded lists, then a
*targeted* retag of only the pieces whose colour the old vocabulary could not express. Not a
wardrobe-wide retag.

Four judgement calls need owner rulings first — silver, sage/olive, burgundy, periwinkle
(§6 of that document).

### Step 4 — palette cohesion *(blocked on step 3)*

Set-level breadth control and accent connectivity. Both are properties of colour *families*, so
neither can be built before step 3. Must be scoring pressure or disclosure, **not a hard filter** —
the `home`-gate precedent is that hard filters on taste dimensions starve capacity.

### Step 5 — decide stage 3 *(owner cost decision, not engineering)*

The roster the model sees is now materially different: no accessories, 3 dresses instead of 1,
layers capped at 2. Whether it earns its ~$0.075 needs one re-run at ~$0.33. Until then it stays
default-off.

### Deferred with reasons

- **tops:bottoms ratio.** Attempted, measured, reverted — see
  [capsule-real-world-rules.md](capsule-real-world-rules.md). It needs reserve-aware quotas, and its
  payoff is realism rather than capacity. Capacity is not the binding constraint: the engine never
  presents more than 12 looks against ~58 cores.
- **Bare `'blue'` in the neutral list.** The owner is correcting colour tags at the garment level;
  the auto-tagger's colour recognition is unreliable under varying lighting.

## 5. Standing constraints

- **Design decisions may predate this repo's docs.** 35 specs live in `~/Downloads/spec_*.md`;
  see [spec-archive-index.md](spec-archive-index.md). Two deliberate decisions were reversed on
  2026-07-30 without anyone knowing they existed. Check it before changing slot semantics,
  register handling, or gate trust boundaries.
- **Occasion behaviour is ratified.** `occasion_profiles_ratification.md` holds a month of
  testing. Do not change a register ceiling, an occasion profile, or the guidance that routes a
  slot to an occasion without reading it first, and record any amendment there rather than only in
  code comments.
- Never make a billed model call without explicit owner approval.
- Do not retag the wardrobe. Fix the tagger first, then retag once, narrowly.
- Palette is a preference, not a filter.
- Read `stylist-session-handoff.md` before overturning an owner ruling; several rulings here look
  like bugs and are not.
