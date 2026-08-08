# Capsule roster selection — draft spec, awaiting ratification

**Status:** draft, 2026-07-28. Nothing here is implemented. Written after the capsule design
evaluation in this session; the correctness fixes that came out of the same evaluation are
already shipped and are **not** blocked on this spec.

**Start at [capsule-index-and-plan.md](capsule-index-and-plan.md)** for the full document map and
the sequenced plan; this spec is stage 1-3 of it.

**Read first:** `docs/stylist-session-handoff.md` → the 2026-07-28 capsule completion record (the
owner rulings this spec must not overturn), and `docs/stylist-bugfix-spec.md` → "Research done
2026-07-25 — what the capsule number should be" (the published-practice research this builds on).

**Before changing any category quota:** `docs/capsule-real-world-rules.md` (added 2026-07-30) —
what the published capsule frameworks actually specify per category, with citations. Every number
in `capsuleQuotas` predates it and was invented in code; the outerwear figure has since been
corrected against it. The remaining known divergence is the tops:bottoms ratio (this engine
~1.1:1, published guidance 3:1), which is **not** yet changed.

**Implementing steps 1–2?** Use `docs/capsule-bench-implementation-brief.md`, not this document.
This is a design doc; the brief carries the operating rules, the acceptance commands, and the test
baselines an implementer needs. Step 3 (the roster-selection model call) is deliberately not in that
brief — it needs review before it is written.

---

## 1. The problem, stated as the owner stated it

> "The point of 'give me the summer capsule from my wardrobe' is: give me the ideal combination the
> stylist looking at my closet would pick that I can use — not some random 24 pieces I can pick out
> without you."

The current engine cannot deliver that, and the reason is structural rather than a matter of tuning.

`selectCapsuleRoster` chooses the roster with `capsuleVersatilityScore`, which scores **each piece
in isolation**: +12 for a neutral color, +4 per occasion tag (max 4), +8 for a solid pattern, +10
for light fabric in summer, −24 for heavy/wool in summer, +4 for `trusted`. `capsuleQuotas` then
takes the top N per category, and a sequence of reserve passes repairs structural holes.

Nothing in that pipeline scores a **pair** or a **set**. The only set-level notions are
`capsuleSimilarityKey` (a coarse "two black tees collapse to one" dedup) and the coverage/reserve
passes, which check *structural capacity* — can this slot form a legal outfit — never taste,
palette, or whether two chosen pieces have anything to do with each other.

A capsule's entire value is a set property. The engine is optimising a per-piece proxy for
versatility and hoping the set falls out of it.

**And the proxy's biggest term barely discriminates.** Measured on the live wardrobe, **66% of all
colour mentions (309 of 466) match `CAPSULE_NEUTRAL_COLORS`** — so the +12 neutral bonus fires on
two-thirds of the population. It is close to a baseline offset, not a selector. See §7 for the full
colour measurement.

**Measured, 2026-07-28**, 24-piece summer capsule against the live 243-piece wardrobe, five lived
slots (At Home / Errands / City Outings / Brunch / Restaurant Dinner):

```
tops     Large flowers floral print tank · black blouson v-neck · white tie front blouse
         white scoop sleeveless · Whale stripe tee · floral long sleeve · lilac floral knit cardigan
         orange ribbed tank · black geometric tassel crop · abstract animal print top
bottoms  beige linen shorts · light beige linen wide-leg · wide leg trousers · beige twill cargo capri
         olive ruffle midi skirt · brown twill knee shorts · black/cream botanical midi · Apple skirt
         tan solid straight shorts
dress    coral solid maxi
shoes    navy canvas slip · black canvas sneakers · burgundy suede cork wedges · beige leather bow wedges
```

Lilac floral, coral, orange, burgundy, olive, black/cream botanical. There is no palette, because
no step ever asked for one. It is also worth noting what the roster is *not*: it is not bland —
6 of 24 are patterned, above the wardrobe's own 63% solid base rate — so "the score picks boring
basics" is the wrong diagnosis. The right one is that it picks 24 individually-defensible pieces
that were never compared to each other.

**Second structural fact:** roster selection is completely blind. No image is loaded anywhere in
`selectCapsuleRoster`. The atomic composer received 448px thumbnails for all 24 roster pieces this
session — so the *composition* stage now sees, while the *selection* stage, which is the more
aesthetic of the two, still does not. That is the visual-grounding principle
(`docs/stylist-session-handoff.md`, and the memory note of the same name) unapplied at the stage
that needs it most.

## 2. What this spec does not touch

Per the owner rulings already ratified this session:

- A person may ask simply for "a summer capsule". Intake stays as it is: at most one natural
  lifestyle question, no stylist questionnaire, no required piece count.
- The conversational model still decides that planning is needed and decomposes the request into
  slots. There is no client or server capsule pre-route, and this spec does not add one.
- `plan_kind === 'seasonal_capsule'` remains what activates capsule behavior. A budgeted trip is
  still a trip.
- The 24-piece default for an unnumbered capsule, and `min(piece_budget, 12)` for the initial
  representative rotation, both stand.
- Every deterministic gate (trust, register ceiling, weather, activity footwear) keeps its current
  authority. Nothing here weakens a gate.

## 3. The change: the model picks the roster, the engine validates it

Today: **engine picks 24 → model composes looks from them.**
Proposed: **engine benches → model picks the roster as a set → engine validates → model composes.**

### Stage 1 — the bench (deterministic, no model call)

The engine produces a *bench*: the candidate pool the roster will be chosen from.

- Union of pieces that pass at least one requested slot's real gates — the existing
  `capsulePiecesEligibleForAnySlot` logic, unchanged in meaning.
- Ranked by the existing `capsuleVersatilityScore`. It is a reasonable *ranking* heuristic; it was
  only ever wrong as a *decision*.
- Truncated to a bench size `B` (see §6) **with guaranteed minimums**: per category, and per
  requested slot, so no slot can be starved out of the bench by a global ranking. This guarantee is
  the whole reason the bench is not just "top B by score".
- Carries full `buildPieceText` truth per piece, plus a thumbnail where a photo exists.

### Stage 2 — roster selection (one structured model call)

One provider-enforced structured call, same shape as `composeCapsulePlanOnce`:

- **Input:** the bench (truth + thumbnails), the requested slots with their lived-context text, the
  piece budget, and the category quotas as *guidance with a stated tolerance* rather than as hard
  allocation.
- **Output schema:** `roster_piece_ids` (exactly `piece_budget` entries), a short `palette` string,
  and per piece one line naming the job it earns its place for. The rationale is not decoration: it
  is what makes a bad roster reviewable, and it is cheap.
- The call is bounded exactly like the composer: no tools, no search, one attempt.

### Stage 3 — deterministic validation (no model call)

The existing reserve/coverage machinery, repurposed from picker to checker. The roster is rejected
with **specific, structural** reasons if it fails any of:

- budget respected, and every id is a real active piece from the bench;
- every requested slot has ≥ 1 gate-valid outfit core;
- the plan's total distinct-core capacity is ≥ the number of cards the rotation will request
  (the global bound shipped this session — see `capsuleRotationFeasible`);
- category floors: enough tops/bottoms/shoes that the rotation is not carried by one piece;
- the winter layer roles (indoor cardigan + transition coat) when the capsule is winter;
- the casual/elevated shoe path both exist when the slots span both registers.

On failure: **one** bounded correction call, given the failed roster and the exact structural
reasons, asking for a repair rather than a fresh start. On a second failure, fall back to today's
deterministic `selectCapsuleRoster` and disclose in the plan notes that the engine chose the roster.
No third attempt, no loop.

### Stage 4 — composition

Unchanged. The existing atomic composer runs on the ratified roster.

## 4. Why validation must run before composition

The obvious failure mode of a model-chosen roster is a set that is coherent and capacity-poor: a
beautiful palette where Restaurant Dinner ends up with one bottom. Today that would surface as
missing cards after composition — which is exactly the shape of bug this session just spent its
time fixing. Catching it at stage 3 turns it into a repairable structural fact before a single
look is composed.

Current supply, same measured run, shows why the risk is real rather than theoretical: the engine's
own roster already leaves Restaurant Dinner with **4 shoes and 2 bottoms**. It bought shoe range
and left the core thin. A model optimising for a palette can do the same thing more confidently.

## 5. Risks, and what each one is answered by

| Risk | Answer |
|---|---|
| Model picks a pretty, unusable roster | Stage 3, before composition; one bounded repair; deterministic fallback |
| Model ignores the budget | Schema requires exactly `piece_budget` ids; stage 3 re-checks |
| Model picks outside the bench | Ids are validated against the bench set, not the wardrobe |
| Rationale becomes marketing copy | It is developer/owner-facing evidence, not production stylist prose — same rule as validator coaching |
| Cost grows unboundedly | Bench size is fixed, one call, one optional repair — see §6 |
| A thin wardrobe produces a thin bench | The bench's per-slot minimums make it visible as a wardrobe gap rather than a silent narrowing |

## 6. Cost

The current capsule turn is ~4 provider iterations, and the atomic composition call carries 24
thumbnails (measured: 14,603 input / 2,987 output / 71,443 cache-read / 47,351 cache-creation on
`thread_1785278212091`).

This spec adds **one** call whose payload is a bench of `B` pieces with thumbnails. The open
question is `B`. Measured eligible supply for the five-slot summer case is 95–137 pieces per slot,
so "the whole eligible union" is not affordable. Candidates:

- `B = 3 × piece_budget` (72 at the default) — generous, roughly 3× the composer's image payload.
- `B = 40`, matching the existing `PLAN_WORKBENCH_PIECE_LIMIT` — a precedent already in the engine.
- Two-tier: text truth for the full bench, thumbnails only for a top slice.

**Owner ruling 2026-07-28: start at `B = 40`**, matching `PLAN_WORKBENCH_PIECE_LIMIT`, with the
per-category and per-slot minimums above. Before stage 2 is built, run the free offline check that
says whether 40 is wide enough: how often does today's deterministic selector pick a piece that
falls outside the top 40 of the same bench ranking? A high rate means the ranking and the selection
disagree and the bench must widen; a low rate means 40 already contains the interesting choices.
Two-tier (text truth for all, thumbnails for a slice) remains the fallback if 40 proves narrow.

## 7. Palette as an input — how the person decides

**Owner ruling 2026-07-28: palette becomes an input.** The question this section answered was *how*
it arrives, given the standing ruling that intake must not become a stylist's questionnaire. The
original three arrival paths are preserved below for reference but are superseded — see the
2026-07-30 reassessment.

**First, a correction to an earlier draft of this section.** It claimed "nobody knows what palette
their closet can support until they see the capsule." That is wrong, and the owner caught it: the
Wardrobe already ships a color filter over a controlled vocabulary, and `availableColors` in
`PieceInventory.jsx` is derived from the actual wardrobe rather than a static list. The app knows
your colors and already shows them to you.

**Measured 2026-07-28, and the data holds up better than the draft assumed:**

- 243 active pieces, **2** with no color at all.
- **38** distinct color values stored; **37** are inside the picker vocabulary. Exactly **one**
  off-vocabulary mention in 466 (`silver`, one piece). There is no free-text drift to clean up.
- Top of the distribution: black 78, white 37, cream 35, brown 25, green 22, grey 22, orange 21,
  beige 20, red 18, pink 17, olive 15, navy 14.

**The caveat the owner attached to it — "at least we pretend to" — is also real, and provenance
names it:** `colors` is owner-corrected on **13 of 241** populated pieces. It is ~95% tagger-set.
That is weaker evidence than it looks in both directions: color is among the cheapest fields to
verify from a photo, so a low correction rate may mean the tagger is simply right — or it may mean
nobody ever checked. Do not treat these values as owner truth the way `formality` (86%
hand-corrected) can be treated.

**A related finding this measurement turned up, which belongs in §1:** `capsuleVersatilityScore`
gives +12 to any piece with a neutral color term, and **66% of all color mentions (309/466) match
that list.** A bonus that fires on two-thirds of the population barely discriminates. It is not
picking neutrals out of a colorful wardrobe; it is close to a baseline offset.

---

### 2026-07-30 reassessment: paths 1, 2, and 3 are the wrong framing

**The three paths below were the original plan. They are superseded by research findings
that did not exist when they were written. They are preserved for reference — do not implement them.**

Three arrival paths, in ascending cost to the person, none of them a new intake question.

**1. They already said it.** "A summer capsule in neutrals", "keep it to black, cream and olive."
Free — the words are already in `question` — and today silently dropped, because roster selection
reads structured columns and never the request text. Because the stored vocabulary is clean, this
is a *mapping* problem rather than a fuzzy-matching one: resolve the stated words onto the same
38-value vocabulary the filter uses, and report which ones the wardrobe actually has. "Mostly
neutrals plus one warm accent" resolves to a set of real column values, not a vibe. Cheapest win in
the spec; ship it before stage 2 exists.

**2. They redirect after seeing it.** The default path — the person knows which colors they own,
but not which of them cohere into a capsule until one exists. Two requirements, both of which fall
out of the vocabulary being real:

- The roster call **states its palette in that vocabulary** — "built on black, cream and olive,
  with the rust dress as the one warm note" — not in mood language like "warm earth tones". If the
  model names colors the filter doesn't use, nothing links its claim to the wardrobe.
- The correction is a **chip row over the colors present in this capsule's bench, with counts**,
  reusing the Wardrobe filter's own vocabulary and swatches. The person already knows this control.
  Free text still works; the chips make the common case one click, and showing bench counts means a
  color they expected to see missing is visible as a wardrobe fact rather than a silent omission.

This only works if the re-pick is cheap, which means reusing the saved bench and slots exactly the
way `/expand-capsule` reuses the saved roster: **one bounded re-pick call, not a fresh plan.** The
plan already paid to gate the wardrobe and resolve the slots; a palette change invalidates the
roster, not that work. Without this, "actually, less rust" costs a full capsule regeneration, and
the feature is too expensive to use twice.

The bench counts also mitigate the provenance gap above: if `colors` is wrong on a piece, it shows
up as a surprising count in a control the owner can see, instead of quietly skewing selection.

**3. They keep saying it, so it becomes a rule.** The mechanism already exists end to end:
`store_user_correction` writes an `owner_rule`, it is visible and retirable in Settings' "Learned
rules & preferences", and `getOwnerRuleNotes(8)` already splices owner rules into the plan
workbench. A palette preference stored there reaches roster selection with no new plumbing. Offer
this only after a repeat — a preference stated once is a mood, stated twice is a rule.

**Explicitly not proposed:** a palette question in intake, or a required color choice before the
capsule exists. Not because the app couldn't render the picker — it demonstrably can, it is on the
Wardrobe page today — but because it makes the person decide which of their colors *work together*
before anything has shown them, which is the same mistake as asking them to supply a piece count.
The same control after the fact is welcome; that is path 2.

---

### Why the three paths were retired

Researched 2026-07-30 against three external documents with cited sources
(`docs/capsule-palette-rules.md`, `docs/capsule-real-world-rules.md`,
`docs/color-taxonomy-rules.md`). Three findings, each with a source, each of which undermines a
different path.

**Finding 1 — the wardrobe's palette is already fixed.** Every palette framework studied assumes
you are building a wardrobe by shopping to a target palette
([Rue Sophie](https://ruesophie.com/blogs/the-style-edit/capsule-wardrobe-color-palette),
[A Considered Life](https://www.aconsideredlife.co.uk/2023/11/create-a-wardrobe-colour-palette.html),
[AI Color Analysis](https://aicoloranalysis.com/blog/capsule-wardrobe-color-palette)). In this
app, the closet already exists. Its palette is whatever it is — measured at 21 colour families,
60% pure neutral. A palette preference stated at intake does not change what the wardrobe contains;
it biases selection over a pool that was almost certainly going to produce a neutral-dominant result
anyway. `docs/capsule-palette-rules.md` records this directly: *"These frameworks assume you are
choosing a palette and then acquiring to it. This engine selects from a closet that already exists,
whose palette is whatever it is."*

This undermines path 1 (stated at intake). Mapping "neutrals plus warm accent" onto the vocabulary
adds one new bonused set of pieces. It does not change what the roster will look like at 60–70%
neutral — which it was going to be regardless — and it cannot supply a colour the wardrobe does not
hold.

**Finding 2 — the real palette problem is connectivity, not preference.** The one published colour
rule described as "directly testable against a roster" is the connectivity rule: *"each accent
should pair with every neutral and at least two main colors, so that a single accent sweater or
skirt links into several outfits instead of demanding new companion pieces"*
([AI Color Analysis](https://aicoloranalysis.com/blog/capsule-wardrobe-color-palette)). The live
run confirmed this finding directly: the coral maxi sat in the roster and appeared in zero looks
— the exact failure the rule describes. A palette preference (path 2's chip-row redirect) does not
fix a connectivity gap. What fixes it is the composition stage being explicitly told to demonstrate
each accent piece in a look — which is the extension to `capsuleFunctionalJobs` described below.

This undermines path 2 (redirect after seeing it). The re-pick addresses the wrong layer: if
the coral dress appeared in no looks, the problem is that the composer never got told to demonstrate
it, not that the palette should have been stated differently.

**Finding 3 — a palette preference repeated is a mood, not a rule; and the research draws no
distinction.** *"Palette is deliberately a preference, not a filter, and this research does not
overturn that"* (`docs/capsule-palette-rules.md`). The same document notes that the home-gate
precedent — *"hard filters on taste dimensions starve capacity"* — holds for colour. Encoding a
repeated palette preference as a permanent owner rule would inject it into every future capsule,
regardless of season or context, and would act as a soft filter on the roster — exactly the
mechanism the research argues against. A preference stated because you wanted a muted July palette
should not constrain a December capsule.

This undermines path 3 (stated twice becomes a rule). If someone has a genuine, long-standing
aversion to a specific shade (say, mustard on their skin tone), the right home for it is a
garment-level note on the specific pieces (`styling_rules_learned`), not a palette preference that
reaches roster selection.

---

### What the research supports instead

Three features grounded in the research findings, replacing the three paths.

**Feature 1 — Accent connectivity as a composition instruction** (replaces path 2's chip-row
redirect). The connectivity rule is the only published palette principle that is directly testable
against a roster. Its natural implementation is not a palette input but an extension of the
per-run `capsuleFunctionalJobs` clause in `buildPlanSlotWorkbench`: if the roster contains
accent-coloured pieces (identified via the `neutrality: 'accent'` property of the colour taxonomy
ratified in `docs/color-taxonomy-rules.md`), the composition brief names each one and asks the
rotation to demonstrate it in at least one look. This is the same mechanism as layers, dependent
tops, and specialized shoes — it derives from what the roster actually holds, not from a stated
preference, and it is a strict no-op when no accent piece is in the roster.

**Feature 2 — Colour-family breadth pressure in roster scoring** (supplements the neutral bonus).
Measured in `docs/capsule-palette-rules.md`: both rosters spanned 12–13 colour families against
a researched recommendation of 5–9 shades structured in tiers
([Rue Sophie](https://ruesophie.com/blogs/the-style-edit/capsule-wardrobe-color-palette),
[AI Color Analysis](https://aicoloranalysis.com/blog/capsule-wardrobe-color-palette)).
Nothing in the current engine pushes down on breadth because every lever is per-piece. A small
breadth pressure in `capsuleVersatilityScore` — prefer a piece whose colour family is already
represented in the selected roster, over a piece that adds a novel family when a comparable
represented-family piece exists — would reduce breadth from the scoring level without filtering
anything. This is not a gate; a piece from an unrepresented family is not excluded, it is scored
slightly lower. Correct implementation is a strict no-op when the wardrobe cannot fill a category
any other way.

**Feature 3 — Colour-story routing for large wardrobes** (new, not a replacement for any path).
When the wardrobe is large enough to support multiple accent identities — enough mustard/amber/yellow
pieces to build around, enough burgundy/wine/red pieces to build around separately — the meaningful
request is not "nudge this capsule toward yellow" but "build this capsule from my warm-tone
subset." That is a routing decision, not a preference nudge, and it is structurally different from
paths 1–3. The implementation would be:

1. **Bench pre-filter by accent family:** before roster selection, retain all pieces whose
   `neutrality` is `neutral` or `neutral-adjacent` (the connectors, always pass through), and all
   pieces whose primary colour family matches the requested story. Pieces from other accent families
   are excluded from the bench for this run only.
2. **Supply precondition first:** before committing to colour-story mode, verify the filtered bench
   can produce a valid capsule across all requested slots. If the yellow bench cannot fill the shoe
   quota with shoes that are plausibly yellow-compatible, report the gap rather than producing a
   capsule that misses a category.
3. **Colour theory research still required:** this feature depends on knowing which non-neutral
   colours pair with a given accent family — not just "what other colours does this person own" but
   "which other accent families are harmonious with yellow." Published colour theory (analogous,
   complementary, triadic relationships) could give this structure; it has not been researched for
   this codebase yet. The feature is **not buildable without that research**, because bench
   pre-filtering on family alone would exclude burgundy even if burgundy-and-yellow is a valid
   pairing. A future research document (`docs/capsule-color-harmony-rules.md`) is the correct
   prerequisite, not a spec-level assumption.

**One design constraint that survives from the original section.** Palette must remain an
*instruction to the selector*, not a deterministic filter over the pool — for the reasons the
original §7 stated and the research confirmed. `docs/capsule-palette-rules.md`: *"Palette is
deliberately a preference, not a filter, and this research does not overturn that. The project's
`home`-gate precedent is that hard filters on taste dimensions starve capacity."* Feature 3 is the
only proposed feature that pre-filters the bench; it does so at the accent-family level, not the
shade level, and only when the person has explicitly requested a colour story, not as a default.
Stage 3 validates capacity; it must not validate color.



## 7b. Pieces that cannot be worn alone — `needs_base`

**Owner ruling 2026-07-28: add `needs_base` as a structured field for this case, and accept that
other cases will have to come from stylist notes or other garment fields.** It is a hybrid on
purpose; do not try to make it one mechanism.

**The case that produced it.** A live summer capsule put garment 258 (`black geometric tassel hem
crop top`) into the 24-piece roster and then styled it over an orange tank for a dog walk. Layering
is fine — the owner's objection was narrower and sharper: *that top cannot be worn alone*, so it is
poor value in a finite reusable set. It costs two roster slots to produce one look.

**Why no existing column carries it.** Checked, and two candidates were withdrawn:

- `tuck_behavior: 'wear_over_only'` looks right and is not: **67 of 243** active pieces carry it,
  including a whale stripe tee, a maxi dress, and a white button-down. It means *worn untucked over
  the bottom*, not *needs something underneath*.
- `opacity` is `opaque` on this very piece — the exposure is construction (high-low handkerchief
  panels), not sheerness.

What the app *does* know is prose: `notes` ("the side panels sweep upward dramatically, exposing
most of the side of the torso"), `style_notes.best_use` ("statement hero top"), and the owner's own
`styling_rules_learned` entry recording that the orange tank "turns the side exposure into a warm
color pop rather than bare skin". The property is known, taught, and written down — and structurally
invisible to the roster selector, which reads columns.

**Rollout — owner ruling 2026-07-28, and it requires no re-tagging of any existing wardrobe:**

1. Add the column defaulting to **unset**, which the engine treats as "no dependency". Unset is a
   strict no-op, so every existing wardrobe behaves exactly as it does today on the day it ships.
2. The owner sets it by hand on the few pieces that need it (owner's estimate; deliberately not
   measured). That is the whole population step for this wardrobe.
3. The tagger learns to emit it **for pieces it tags anyway** — new imports, new users' cold starts.
   That is the only reason the field has to be structured rather than a note: a second user will
   never hand-set it, and their pieces are already being tagged on the way in. It costs nothing
   extra there.
4. **No re-tag of an already-tagged wardrobe, now or as a consequence of this field.** The ratified
   ordering (*raise the tagger's ceiling first, re-tag once after*) is untouched — `needs_base` does
   not trigger it, does not justify it, and does not wait for it.

Distinguish *unset* from an explicit *no*: unset means nobody has looked, explicit-no means the
piece was judged standalone. Both behave identically in the engine today; only the second is
evidence.

**Wiring.** Follow the new-tag-field checklist before adding it — `PieceForm` and `BatchAdd`
enumerate fields explicitly and silently drop unknown ones, which is how a previous field arrived
half-wired.

**What the capsule selector does with it.** A `needs_base` piece is a *dependent*: it may enter a
finite capsule roster only when a compatible base is also in the roster, and it never counts toward
the standalone-top floor. Unset stays unset — this must be a no-op for the whole wardrobe until the
field is populated, and it must never be inferred from prose by a regex.

**Everything else stays with stage 2.** "Is this a good capsule citizen" is not one property and
will not become one column. The model reads `buildPieceText`, the notes, and the photo; that is the
mechanism for the cases `needs_base` will not cover.

## 7c. Wardrobe-size sensitivity — this is not one wardrobe

**This app is multi-user.** Every number in this document was measured against one 243-piece,
heavily hand-corrected wardrobe. That wardrobe is the *least* representative case on the platform:
it is large, and `formality` is owner-corrected on 202 of 236 pieces. A new user arrives with a
small, entirely tagger-set wardrobe. Nothing below is a criticism of the measurements — it is a rule
about how to read them.

**Evidence we already have, from the wrong direction.** A fixture built to check disclosure copy ran
the real planner against the **23-piece** sandbox wardrobe — roughly a post-onboarding cold start —
requesting a 10-piece capsule across five lived contexts:

```
roster 9 of 10 requested · capacity 3 distinct cores · card cap 10
  At Home             target 1 of 3    slot capacity 1
  Errands / Weekends  target 0 of 3    slot capacity 0
  City Outings        target 2 of 2    slot capacity 3
  Restaurant Dinner   target 0 of 2    slot capacity 0
```

Two of five requested contexts uncoverable; the capsule renders as **one card**. The engine reasoned
correctly and disclosed honestly — and the product answer is still wrong. Accepting a capsule
request and returning a single look is worse than declining the frame and saying what is missing.

### Parameters that are constants and should be functions of supply

| today | why it is wrong away from a 243-piece wardrobe |
|---|---|
| bench `benchSize = 70` | at ~60 eligible pieces the bench is most of the wardrobe (no selection happens, and you pay for the thumbnails anyway). The ceiling is absolute, not a target — it scales down with supply and never up. **Ruled 40 on 2026-07-28; re-ratified at 70 on 2026-08-06** — see the amendments at the end of "Too much supply" below. |
| default capsule budget `24` | at 45 eligible pieces a 24-piece capsule is half the closet — an inventory, not a capsule |
| bench category floors `2 top / 2 bottom / 2 shoes` | unsatisfiable below a certain supply; must degrade to a stated gap, not a silent shortfall |
| `MIN_ENFORCED_CAPSULE_BUDGET = 6` | never revisited against small wardrobes; it decides whether capsule machinery engages at all |

Express each relative to eligible supply for the requested slots, clamped to today's values so the
243-piece behaviour is unchanged. Exact curves are a separate decision and should be measured on
more than one wardrobe before ratification — the sandbox's 23 pieces are a second data point and
still not a distribution.

### Too little supply: ask them to digitize more of the closet

**Owner ruling 2026-07-28.** Add a supply precondition ahead of composition: when eligible supply
cannot cover a meaningful share of the requested contexts, or cannot produce enough distinct cores
for a rotation to mean anything, the stylist says so *before* composing and asks the person to **add
more of their closet to the app**.

The framing is the whole ruling, and it is easy to get wrong:

- The constraint is **what has been digitized**, not what the person owns. A 23-piece wardrobe is
  almost never someone with 23 garments; it is someone who has photographed 23. Name that.
- **Never phrase it as a shopping recommendation.** "Your wardrobe is missing an elevated bottom"
  reads as *buy one*. "I can only see 23 pieces so far — add more of what you already own and I can
  build a real rotation" reads as *finish setup*. This project has an existing ruling in the same
  spirit: a thin roster was diagnosed as a selector problem, explicitly "not a buy-more-clothes one".
- Name **which contexts** could not be covered and **which category** was short, because that tells
  the person what to photograph next. That is a genuinely useful onboarding prompt rather than a
  failure message.
- Offer the smaller thing that *is* possible rather than nothing at all.

This is the shortfall disclosure moved one stage earlier, and it is the difference between a new
user's first capsule teaching them how the app works and looking broken.

### Too much supply: the bench needs an absolute ceiling, not just a ratio

**Owner ruling 2026-07-28: a large wardrobe must not turn one capsule request into a month's
budget.** Bench size therefore has a hard upper bound regardless of how much eligible supply exists
— it scales *down* for small wardrobes and never scales up past the ceiling for large ones:

```
benchSize = min(ABSOLUTE_CEILING, f(eligible supply, piece_budget))
```

The ceiling was ruled at 40 on 2026-07-28 and **re-ratified at 70 on 2026-08-06** — see the
amendments below. The principle is unchanged: the ceiling exists, it scales down and never up.
The cost driver is images: every bench piece with a photo carries a thumbnail into the
roster-selection call, and that is what would scale linearly and painfully with wardrobe size.

Consequences to design for, not discover:

- At 800 eligible pieces the bench is a **sample**, not the field. Per this project's no-silent-caps
  rule, say so — a bench that quietly ignores 95% of a large wardrobe while presenting itself as
  "your capsule" is the same defect class as a silently trimmed rotation.
- The seed (today's deterministic roster) is admitted first and is never dropped to hit the ceiling,
  so a large wardrobe still gets at least the quality the current engine produces.
- If 40 proves too narrow to compose well from a large wardrobe, the fix is the **two-tier** bench
  from §6 — full garment truth as text for a wider set, thumbnails only for a top slice — rather
  than raising the image count. Text is roughly an order of magnitude cheaper per piece than an
  image, so quality and cost are not actually in direct conflict here.
- BYOK means the user pays their own provider costs, which makes an unbounded request their bill
  rather than the platform's. That is a reason for the ceiling, not a reason to relax it.

#### Amendment, 2026-08-03: production runs 70, and the ceiling above is open

The 2026-07-28 ruling has not held in practice and is recorded here rather than
quietly left to rot. Since PR #196 (2026-07-31) `benchSize` defaults to **70**, and every
bench piece carries a thumbnail at up to 800px for hero/printed/textured pieces (448px
otherwise) — so both the count and the resolution moved, and the ruling above named the
image count as the thing not to raise.

**Why:** the capsules produced at bench 40 were not good enough. Owner, 2026-08-03:
going 40 → 70 was the response to that, benchmarked against the Visual Composer, which
shows up to 90 pieces at 768px. The motivation is real; what was missing was this note.

**What free measurement has since established** (`compare_capsule_rosters.js --bench-size N`,
no model calls, live 242-piece wardrobe, 4-slot summer capsule at budget 24):

- Bench **composition** was the larger defect, and it was independent of width.
  `capsuleVersatilityScore` ordered the bench globally across categories while ranking
  dresses at median 116 of 160 eligible and shoes at 113 against tops at 84. Widening
  40 → 70 therefore bought 15 tops, 8 bottoms and **zero** dresses. Fixed 2026-08-03 with
  per-category targets; at unchanged width and cost, dresses went 3 → 6 and shoes 9 → 14.
- Width still buys something after that fix, concentrated in footwear: dressy-capable
  shoes on the bench are 2 of 18 at benchSize 40 and 5 of 18 at 70. Against the recorded
  live failure that "sneakers carried almost every context and the brown wedges were the
  sole clearly elevated option," that is not cosmetic.
- Cost: roughly 22k image tokens per roster call at 40, 38k at 70.

#### Amendment, 2026-08-06: **70 is ratified**

The captured run the 2026-08-03 amendment was waiting for happened, and it settles the
question. The corrected real-lifestyle comparison
(`capsule-lifestyle-contract-2026-08-06.md` §6) ran at bench 70 against the four real
production use cases, resolved **all 70 bench photos**, and the model roster was accepted
on its **first** provider call with stronger measured per-slot capacity than the
deterministic roster for every use case. That is evidence about what the model *chooses*,
which is the gap the previous amendment named.

**`ABSOLUTE_CEILING` is 70.** It supersedes the 2026-07-28 ruling of 40, which had already
not held in practice since PR #196. Everything else in that ruling stands: the ceiling is
absolute, it scales down with supply and never up, and a larger wardrobe does not buy a
wider bench.

The two-tier bench proposed above — full garment truth as text for a wide set, thumbnails
for a top slice — remains untried. It is now a **cost optimisation** (roughly 38k image
tokens per roster call at 70) rather than an outstanding prerequisite. Revisit 70 if
per-run image cost becomes the binding constraint, or if a wardrobe materially larger than
this one changes the measurements above.

### How to read every measured number in this document

The measurements are evidence about **mechanisms**, not about magnitudes:

- "`capsuleVersatilityScore` cannot see loudness" — mechanism, true everywhere. "35 of 37 loud
  pieces take the neutral bonus" — this wardrobe.
- "the rank-only bench drops pieces the reserves exist to protect" — mechanism. "14.1%" — this
  wardrobe.
- "overlapping slots double-count shared cores" — mechanism. "253 vs 91" — this wardrobe.

Tune against the mechanism. Do not tune constants until a number exists for more than one wardrobe.
The same caution applies to `docs/tagger-cost-spec.md`, which is priced entirely off this wardrobe's
200-garment cold start.

## 8. Migration order

1. Bench builder + its guarantees, provider-free, with a script that prints the bench for a given
   season/budget/slot set. Free to inspect.
2. Stage 3 validator, extracted from the existing reserve passes, run against **today's**
   deterministic roster first. It must pass on the current output before it is allowed to judge a
   model's — if it fails there, the validator is wrong, not the roster.
3. Stage 2 call behind a flag, with the deterministic roster as fallback.
4. Offline comparison: deterministic roster vs model roster on the same wardrobe, judged by the
   owner on palette/usability, and by the validator on capacity. Not a live call.
5. Live acceptance run only after 1–4, explicitly initiated by the owner.

## 9. Open questions for ratification

1. ~~**Bench size `B`**~~ — **ruled 2026-07-28: start at 40**, with the offline width check first
   (§6). **Re-ratified 2026-08-06 at 70**, on the accepted live comparison run — see the
   amendments at the end of "Too much supply".
2. **Does the roster rationale reach the user?** **Ruled 2026-07-28: build it user-visible and
   judge it on the evidence.** Render the per-piece job lines and the palette statement in the
   result, review how they actually read on a real roster, and only then decide whether to demote
   them to owner-facing. The prior default (hide it) was a guess; this is checkable. The one firm
   constraint: whatever ships must not read as validator coaching or engine vocabulary — the same
   bar the plan notes now meet.
3. ~~**Should the palette be an input?**~~ — **ruled 2026-07-28: yes. Reassessed 2026-07-30: paths
   1, 2, and 3 are the wrong framing for an existing wardrobe.** The research-grounded replacement
   (accent connectivity as a composition instruction, colour-family breadth pressure, colour-story
   routing for large wardrobes) is documented in §7. Colour-story routing depends on colour harmony
   research not yet conducted; see `docs/capsule-color-harmony-rules.md` (to be written).
4. **What happens to `capsuleVersatilityScore` long-term?** This spec keeps it as the bench ranking.
   If a model roster consistently beats it, the score's remaining job is ordering, not selection —
   worth revisiting only with evidence.
5. **Does a ratified roster persist for reuse?** `capsulePlanContext` already saves the roster for
   expansion. If the model picks it, "regenerate the capsule" becomes a meaningfully different
   action from "show another look" — the boundary needs stating.
