# Spec — activity fidelity, and what the roster tells the model

**Status:** active — diagnosed 2026-08-16 from live threads, not implemented
**Last verified:** 2026-08-17 — every claim below re-checked against current code and the live wardrobe

Route: [docs/README.md](README.md). Sources this spec must not restate:
[engine-behaviour-map.md](engine-behaviour-map.md) (gates and scoring today),
[freeform-rearchitecture-handoff.md](freeform-rearchitecture-handoff.md) (the model/tool boundary and
its precedents), [occasion_profiles_ratification.md](occasion_profiles_ratification.md) (ratified
ceilings — read before touching one), [card-consistency-spec.md](card-consistency-spec.md) (the
sibling spec; Part 2 here reuses its shape).

---

## 1. What happened

`thread_1786908272853`, 2026-08-16: *"I am going to go on a nature walk today at San Anselmo, CA.
what should I wear?"* Three cards came back — brown leather strap sandals, taupe knit sneakers, navy
canvas slip-ons, with tailored linen shorts and a sheer black cardigan.

Six minutes later, `thread_1786908644157`, the same wardrobe through the builder with the activity
dropdown set to **Hiking / Outdoor active**: graphic tees, cargo and utility bottoms, athletic shoes
and canvas sneakers. 150 pieces suppressed, including *"owner constraint 2: prohibited for activity
hiking"* ×10.

Same wardrobe, same day, opposite answers. **The whole difference is one enum value.**

## 2. It is not a comprehension failure

The stylist's own reply: *"If the trail has any rocky or uneven sections, go with Look 2's taupe knit
sneakers — they'll give you the most grip and support."* It knew the terrain, knew grip mattered, and
ranked its own three shoe options by support.

**The understanding stayed in prose and never became the structured `activity` value, and only the
structured value reaches the gates.** That is the documented model/tool boundary class: the 2026-07-15
Bay Area retest found a slot with `best_for: "walking around the city"` and no `activity: "walking"`,
so the footwear gate never activated. That was fixed — for **plan slots only**, by inferring activity
from slot prose. The freeform single-turn path never received the same treatment.

## 3. Measured consequences

`profileRuleFit` over the eleven proposed pieces, casual occasion, hot weather:

| piece | `walking` | `hiking` |
|---|---|---|
| brown leather strap sandals | neutral | **prohibited** — owner constraint 2 |
| taupe knit lace-up sneakers | preferred | **prohibited** — medium support unsuitable |
| navy canvas slip-ons | preferred | **prohibited** — medium support unsuitable |
| the 8 tops/bottoms/layers | preferred | preferred |

All three shoes in all three looks would have been blocked. The wardrobe holds three shoes that clear
the hiking footwear gate (213, 214, 215), so it would not have starved.

## 4. Root causes — four, each verified in current code

### 4a. Nothing tells the model which value to pick

The tool schema says only *"Established activity (walking/hiking)"* (`tools.js`). Nothing states that
a trail, a nature walk, or uneven terrain is `hiking`. The enum is `['none', 'walking', 'hiking']`.

### 4b. A model-supplied activity is final

`resolveActivityProfile` returns the walking profile immediately when `activity === 'walking'`, before
any request text is examined. The *"hiking matches first (more restrictive)"* precedence below it only
runs when activity is empty or `'none'`. So once the model says `walking`, no later signal can correct
it.

### 4c. And the text fallback would also say walking

Hiking's keywords are `["hike", "hiking", "trail"]`; walking's include `walk`, `walking`, `stroll`.
"Nature **walk**" matches walking on the only path that inspects text.

### 4d. Activity can remove pieces but can never promote one

This is the deep one. The walking profile's own `preferred_materials` and `preferred_footwear` are
both `[]`. Every `preferred` label on that roster came from the **casual occasion profile**
(`[cotton, linen, denim, jersey, knit]`, `[sneakers, flats, slip-ons, loafers]`).

The shoe roster the model actually received under `walking` — 15 shoes, of which nine tie at
`preferred / preferred material`:

```
169 navy canvas slip shoes      preferred     190 espadrilles          preferred
195 olive suede slip-ons        preferred     196 black loafers        preferred
198 taupe knit lace-up sneakers preferred     213 grey athletic shoes  preferred
214 black canvas sneakers       preferred     217 pink ballet flats    preferred
990397 mesh athletic sneakers   preferred     222 leather sandals      neutral   ← proposed
NOTE: (7 piece(s) filtered out as prohibited for this occasion/activity)
```

Under `hiking`: three shoes, exactly the right ones.

Three compounding facts:

1. **The roster is an assertion of suitability, and the prompt says so.** `prompts.js`: *"results are
   already filtered to what is wearable for the requested occasion/activity — `prohibited` pieces are
   removed for you, so compose freely from what comes back without self-rejecting anything."* The
   trailing note confirming 7 were filtered reinforces it. Sandals arrived at `neutral` — legal,
   unremarkable.
2. **The labels carry no activity information.** Ballet flats and trail-capable sneakers are labelled
   identically. Activity contributed only exclusions.
3. **The discriminating tag is computed and then discarded.** `footwearComfortVerdict` reads
   `walk_support` and `heel_height` to exclude pieces — and neither field appears anywhere in
   `search_wardrobe`'s returned rows. **The model cannot see which surviving shoe has more support.**
   It reconstructed that judgment in prose from garment names, which is exactly what structured tags
   exist to prevent.

Given fifteen equally-blessed shoes and fifty equally-blessed bottoms, the model optimised on the only
axis left: aesthetics. Its `why` lines say so — *"a cohesive, nature-ready palette."* It composed for
the *look* of nature.

### 4e. Owner constraints cannot fire at retrieval

`owner_constraints` holds *"Don't suggest sandals for hiking"* (footwear × activity) and *"Don't
suggest boots in summer"* (footwear × season) — hard authority, and the builder run shows constraint 2
suppressing 10 pieces. `propose_outfit`'s gate does pass activity, but `search_wardrobe`'s occasion
filter calls `wholeWardrobePieceTrustDecision(p, { occasion })` — **no activity, no season**. Both
stored constraints are activity- or season-scoped, so **neither can reach the roster the model
composes from**; they can only reject afterwards.

### 4f. Gate parity: `required_occasion_tags` is composer-only

Hiking declares `required_occasion_tags: ["outdoor", "outdoor active", "hiking"]`, enforced in the
composer roster path (`rules.js`) and **not** in `profileRuleFit`. Confirmed by measurement: under
`hiking`, every top and bottom still returned `preferred` on the freeform path. So even a correct
activity would gate the shoes and leave city-only garments untouched.

## 5. Design

### 5.0 Design constraint — this app has more than one wardrobe

**Owner correction, 2026-08-17: "mine is not the only wardrobe this app is for."** Since spec 33 the
app is a multiuser platform with per-user databases, so every rule here ships to instances whose
tagging density, owner constraints and garment mix are unknown.

This has a specific methodological consequence, and an earlier draft of this spec got it wrong twice:

- **A measurement on the owner's wardrobe is evidence of FEASIBILITY, never of SAFETY.** "15 of 88
  tops are tagged outdoor, so enforcement is fine" is an argument about one database. Another
  instance may have zero.
- **A rule may not lean on a per-user record to be correct.** The first draft justified relaxing the
  footwear gate on the grounds that the owner's `owner_constraints` row keeps sandals out of hikes.
  A new instance has no such row, and the relaxation was measured to make sandals `neutral` — fully
  legal — for a hike there. Related: [[owner-rules-must-be-per-user-not-global]].

**Test for every change below: state it for a wardrobe you have never seen, and for a user who has
never given the app a single instruction.** Where a rule cannot hold on its own, it needs a
structured garment fact, or a supply-aware fallback that discloses — not a healthy wardrobe.

### 5.1 Principles this inherits, not invents

- **Structured data over text inference** (AGENTS.md). `walk_support` exists precisely so grip is not
  guessed from a garment name. Showing it to the model is giving it truth, not taste.
- **Code constrains, the model judges.** Which shoe is right for a trail is judgment; how much support
  a shoe has is a fact. Supply the fact.
- **Prompt guidance alone is not reliable** — capsule criterion 8 (*"Instruction present, behaviour
  unchanged"*) and freeform specs 3/7/11. 5.2 fixes the schema wording **and** adds the mechanical
  fallback; neither alone.
- **Hard filters on taste dimensions starve capacity** (the `home`-gate precedent). Nothing here adds
  a taste filter; every change is either classification, structured truth, or ordering.
- **Additive, provable no-ops** (AGENTS.md #6). Every part must be a measured no-op for requests that
  do not name an activity.

### 5.2 Part 1 — the activity must be able to become `hiking`

1. **Schema wording.** State the boundary in the `activity` description: trails, nature walks, hikes
   and uneven terrain are `hiking`; pavement, sightseeing and all-day city walking are `walking`.
2. **Keywords.** Add `nature walk`, `trail walk`, `trailhead`, `hiking trail` to the hiking profile.
3. **Escalation, not override.** `resolveActivityProfile` must consult the request text even when an
   activity was supplied, and allow it to escalate `none`/`walking` → `hiking`. **It must never
   de-escalate**, and an explicit user statement to the contrary ("just a gentle stroll", "paved
   path") blocks escalation — reuse `hasAffirmedActivityKeyword`'s existing negation handling.

Escalation is one-directional because the failure is asymmetric: treating a city walk as a hike costs
comfortable shoes the person did not need; treating a hike as a city walk costs grip on a trail.

### 5.3a The hiking profile itself — ruled 2026-08-17

*"A nature walk is a hike — not climbing a mountain, but a hike."* One profile, not a new enum value:
a third activity would add exactly the classification choice that caused this bug.

**Relax the support floor.** `excluded_walk_support` goes from `['low', 'medium']` to `['low']`.
Medium-support sneakers and slip-ons are right for a nature walk and for most day hikes. On the
owner's wardrobe this moves 3 eligible shoes to 10; the general claim is about what a hike needs,
not about that count.

**And close the hole that relaxation exposes.** The support floor was masking a dead rule. Hiking
declares `discouraged_footwear: ["sandal", "sandals", "mule", …]` and `prohibited_footwear:
["heel", "wedge", "dress shoe", "flip-flop"]`, and **both lists sit behind `if (isShoe &&
!activityProfile)` — skipped exactly when an activity IS set.** The enum gate replaced them and never
absorbed their content. Measured consequence of relaxing support without fixing this: on an instance
with no owner constraints, `brown leather strap sandals` scores **`neutral`** for a hike.

Fix it structurally, not by reviving the phrase lists. `shoe_type` is a populated enum
(`sandal` 8, `sneaker` 5, `pump` 5, `slip_on` 3, `loafer` 3, `flat` 3, `mule` 2, `boot` 2). Add
**`excluded_shoe_types`** to the activity profiles and enforce it in the enum gate beside
`heel_height` and `walk_support`. For hiking: `sandal`, `mule`, `pump`, `flip_flop`.

This is the next room in a renovation already in progress — chapter 6 replaced leaky footwear
phrase-matching with structured `heel_height` / `walk_support` enums, and `shoe_type` never got the
same treatment. It holds for a wardrobe nobody has seen and a user who has given no instructions,
which is the §5.0 test.

**Ranking, not exclusion, carries the rest.** A steep hike is better served by surfacing
`walk_support` (§5.3(1)) and ordering on it (§5.3(2)) than by excluding every medium-support shoe
from every outdoor request.

### 5.3 Part 2 — the roster must be able to promote, not only remove

1. **Surface the discriminating tags.** Add `walk_support` and `heel_height` to `search_wardrobe`
   result rows. Cheapest and most principled step: the gate already reads them, and the model
   currently reconstructs the judgment from names.
2. **Order within tier by activity fitness** when an activity is set, instead of the current
   effectively-by-id ordering. Ordering is not filtering — nothing is removed.
3. **Give the activity profiles real `preferred_footwear` / `preferred_materials`**, so `preferred`
   means something different on a trail than on a coffee run. Walking's are empty today.

Items 1 and 2 are mechanical. **Item 3 needs owner input**: these are styling constants, and
`capsule-index-and-plan.md` §1 is explicit that *"a constant that shapes output needs a source, an
owner ruling, or a measurement — a comment explaining the reasoning is not one of those."*

### 5.4 Part 3 — reachability

1. Pass `activity`, `season` and `weatherProfile` into `search_wardrobe`'s trust call so owner
   constraints apply to the roster, not only to the proposal.
2. **Gate parity for `required_occasion_tags`, with a supply-aware fallback.** `profileRuleFit` should
   apply the activity's required tags on the freeform path as the composer already does — but it must
   not depend on the wardrobe being well tagged (§5.0). `search_wardrobe` already has the pattern: when
   an occasion filter empties the result set it falls back to the unfiltered pool and says so
   (*"No active pieces are explicitly tagged for X; showing flexible active wardrobe pieces instead,
   with ruleFit/weatherFit annotations"*). Reuse it verbatim — enforce, and when enforcement would
   leave a role unfillable, fall back and disclose, so a sparsely-tagged instance degrades to
   annotated guidance instead of an empty roster. Capsule's `describeCapsuleLayerSupplyGap` is the
   same shape.

### 5.5 Part 4 — the reply that lost its narration (independent)

`provider.js` returns `response.content?.[0]?.text`, so text the model writes **alongside** its tool
calls is discarded — only the final tool-call-free message survives. That is why the nature-walk reply
began with a bare `---` and referred to "Look 1/2/3", labels no card carries: the per-look prose was
written in the same messages as the `propose_outfit` calls. `prompts.js` explicitly asks the model to
write *"intro, the 'why it works' framing, transitions"* **around** those calls, so the prompt and the
transport disagree.

Collect text blocks from every iteration and join them; take **all** text blocks from the final
message, not `[0]`. The OpenAI branch drops `message.content` the same way.

Included here because it is the same turn and the same reply, but it is independent of Parts 1–3 and
can ship alone.

## 6. Acceptance

1. *"nature walk at San Anselmo"* resolves `activity: hiking` — by the model, or by escalation.
2. With hiking resolved, the sandals do not reach the roster: owner constraint 2 fires at retrieval,
   not only at proposal.
3. The three trail-capable shoes (213, 214, 215) are the roster's top-ranked footwear, and every
   returned shoe row carries `walk_support`.
4. *"a walk around the city"* still resolves `walking`. *"just a gentle stroll on a paved path"* is
   not escalated.
5. **No-op proof:** the 30-scenario candidate A/B and the whole-wardrobe scenario matrix are
   byte-identical for every request that names no activity.
5b. **Wardrobe-independence (§5.0), proved on fixtures, not on the owner's database:**
   - an instance with **zero** `owner_constraints` rows still excludes sandals, mules and heels from a
     hike — the §5.3a regression that motivated `excluded_shoe_types`;
   - an instance where **no garment** carries an `outdoor` tag still returns a usable roster, via the
     §5.4 fallback, and says why;
   - an instance where every shoe is untagged for `walk_support` degrades to `unknown` and annotates,
     rather than emptying the roster.
6. `npm test` green; `docs/engine-behaviour-map.md` amended in the same commit.
7. Part 4: a reply whose narration was written beside its tool calls arrives complete, with no
   orphan leading `---`.

## 7. Out of scope

Retagging. Changing any ratified register ceiling. Taste filters of any kind. Moving footwear or
occasion judgment into code beyond the structured tags that already exist. Restructuring the tool
loop — see §9.

## 8. Open — owner rulings needed

1. ~~Is a nature walk a hike?~~ **RULED 2026-08-17: yes.** *"It's not climbing a mountain hike, but
   it's a hike."* Implemented as §5.3a — one `hiking` profile, with the support floor relaxed and the
   open-footwear exclusion made structural.
2. ~~Gate parity for `required_occasion_tags`~~ **RESOLVED 2026-08-17 — but not the way it was
   asked.** The question was whether an enforced tag requirement would starve the roster. On the
   owner's wardrobe it would not (15/88 tops, 17/61 bottoms, 3/33 shoes tagged outdoor — and the
   shoes agree exactly with the independent footwear gate). But per §5.0 that measures feasibility on
   one database, not safety on all of them, so enforcement ships with the supply-aware fallback in
   §5.4 rather than on the strength of that count.
3. **§5.3(3)** — the activity profiles' `preferred_footwear` / `preferred_materials`. Still open, and
   still styling content: it must be stated for any wardrobe, not fitted to this one.

## 9. Deferred — the cost argument this shares a root with

The nature-walk turn cost **$0.433** over 6 iterations; the builder produced more and better cards in
one call for **$0.097**. Of the freeform turn, **7% was the model's output** — 71% cache creation, 22%
prompt replay, ~52,800 tokens of context re-sent per iteration, ~$0.067 marginal cost per iteration
before a single token is emitted.

The four `search_wardrobe` calls were the model *discovering* things the app already held. Parts 2 and
3 make each discovery worth more; the larger move — resolve activity, weather and a scoped roster
server-side and hand the model one workbench, as `plan_outfit_set` already does for multi-slot — would
remove most of the discovery entirely, without relocating a single taste decision into code.

That is a separate spec and a separate decision. It is recorded here because the same work improves
both, and because capping iterations would treat the symptom rather than the cause.
