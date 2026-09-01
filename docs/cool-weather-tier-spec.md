# Spec — `needsRemovableCoolLayer`

**Status:** Implemented 2026-09-01. Threshold ruled **A (`lowF <= 55`)**; the two tightenings (§3,
§5.2) are in the shipped behaviour. **§8's `isCold` consumer audit remains outstanding.**
**Route:** [docs/README.md](README.md). Amends
[cold-severity-spec.md](cold-severity-spec.md), which introduced the severe tier and whose
2026-09-01 amendment surfaced this gap.

## 1. The gap

The numeric weather path has exactly **one** cliff:

```text
lowF <= 45   → isCold          (minimum-warmth floor)
lowF <= 45 AND highF <= 45  → isColdSevere   (heavy is what you want)
otherwise    → nothing at all
```

Between 45°F and 80°F the engine has **no opinion whatsoever**. No warmth floor, no layer
requirement, no footwear rule. A stated `52°F` produces neither hot nor cold handling. That band is
most of autumn and spring.

## 2. The evidence: one cliff produces both failures

Two live trips to the same place, a week apart in engine terms.

**Over-dressing** — `thread_1788247123543`, a 65°F/45°F week. `lowF` touched 45, so the whole trip
resolved as *severe* cold. The heavy-fabric `+10` relevance bonus and Contract C's outdoor-layer
requirement put a black puffer coat in **all five cards**, including a 65°F city walk. Fixed by
[cold-severity-spec.md](cold-severity-spec.md)'s amendment (severity now comes from the daytime
high).

**Under-dressing** — `thread_1788249273631`, the same prompt after that fix. Outerwear variety
returned, correctly. But the two Sightseeing cards, resolved at **65/48**, carry no outer layer at
all:

```text
Sightseeing #1   metallic stripe scoop tank (light) · light pants · ballet flats
Sightseeing #2   green button-down midi dress · sneakers
```

Verified against Contract C:

```text
tank card @ 65/48                 (no findings)
tank card if a cool tier existed  [error] outfit_no_warm_layer_for_cold
```

A sleeveless tank and no layer, for a day ending at 48°F. Nothing objects because 48 > 45.

**These are the same defect.** Not two bugs: one threshold, doing double duty as both "needs a
layer" and "needs a coat", with nothing in between. The severity amendment moved the upper boundary
correctly and left the lower one untouched.

## 3. What the tier requires — removability is structural

The signal is named **`needsRemovableCoolLayer`**, not `isCool`, and the name carries the contract.
This tier does not classify the weather. It answers one question: *does this outfit need something
the wearer can put on and take off?*

**Satisfied only by an actual layer.** An outerwear piece of any role — `indoor_layer` counts, a
cardigan counts — and nothing else.

**Explicitly NOT satisfied by a warm base.** An earlier draft allowed "a non-sleeveless base of
medium weight or heavier" as an alternative, and that was wrong in a way that inverts the tier's own
purpose. On a 72°F/55°F day it would approve a warm long-sleeved top worn straight through a 72°F
afternoon — the outfit is now uncomfortable for the part of the day the wearer is actually out in,
and still has nothing to add when the evening cools. The whole point of a removable layer is that a
*mild* base can stay mild.

Also not at this tier:

* **not** an outdoor-capable layer — that is the severe tier's requirement and must not migrate down.
* **not** a footwear rule. Mesh at 50°F is fine; that gating stays on severity.
* **not** a heavier base. See above; this tier must never push base warmth upward.

Severity: **hard** when the outfit has no layer at all, **advisory** otherwise, following the
measured/unmeasured discipline in
[outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) Appendix K.

### The resulting three-tier model

| Question | Signal | Requirement |
|---|---|---|
| What do I wear through the pleasant part of the day? | high, plus graded thermal evidence | an appropriate base |
| Might I get cool in the morning or evening? | low ≤ 55 *(see §5.2)* | a **removable** light/indoor/transition layer |
| Is the day itself genuinely cold? | high ≤ 45 | heavier thermal behaviour, severe-cold protections |

Each row asks a different question of a different signal. The current `isCold` cliff collapses rows
two and three into one threshold read off the low, which is why it produces both failures in §2.

## 4. Where `piece.season` finally fits

[piece-season-as-weather-evidence.md](piece-season-as-weather-evidence.md) left `season` unruled
because the severe tier already had better physical evidence. This tier is its natural home — with
that document's narrowness preserved exactly: **`season` is wearer-intent evidence, never physical
thermal evidence, and must never independently exclude a garment.**

It corroborates a shortfall the physical rule has already found. It never creates one:

```text
72/55 · warm-season lightweight base · + cardigan
  → fine. No shortfall to corroborate.

72/55 · warm-season lightweight base · no layer
  → physical layer shortfall (no removable layer)
     `season: warm` corroborates it — strengthens the finding, does not cause it

72/55 · year-round lightweight base · no layer
  → the SAME physical shortfall, no season corroboration
     the finding still fires; it is simply not reinforced
```

The third case is the test that keeps the hierarchy honest: remove the season signal entirely and the
rule still works. `season: warm` never becomes "this garment is thermally inadequate."

Both live incidents show the pattern — this trip's Nature Walks card pairs a `season: warm` tee and
`season: warm` pants under a light `indoor_layer` hoodie for a 45°F morning; the earlier Trail card
did the same under a puffer.

## 5. The ruling: which threshold

Measured against real and pinned ranges. `already` means `isCold` covers it now.

| range | h/l | isCold | A `lowF<=55` | B `highF<=65` | C `lowF<=50` | D `highF<=60` |
|---|---|---|---|---|---|---|
| this trip, sightseeing **(the bug)** | 65/48 | false | **COOL** | **COOL** | **COOL** | — |
| cool coastal summer *(pinned fixture)* | 58/55 | false | **COOL** | **COOL** | — | **COOL** |
| warm autumn day | 72/55 | false | **COOL** | — | — | — |
| mild spring | 70/50 | false | **COOL** | — | **COOL** | — |
| true summer *(must stay untouched)* | 85/68 | false | — | — | — | — |
| this trip, nature walk / evening | 62/45, 60/45 | true | already | already | already | already |

Reading:

* **D (`highF<=60`) fails the actual bug** — 65/48 stays uncovered. Rejected.
* **A (`lowF<=55`)** is the widest. It catches a 72°F/55°F day — a warm day with a cool evening.
  See the correction below: that is a feature, not a cost.
* **B (`highF<=65`)** catches the bug and the pinned coastal fixture and leaves a 72°F day alone —
  but calls a 65°F afternoon "cool", which it is not. **Rejected, see below.**
* **C (`lowF<=50`)** catches the bug narrowly but misses the pinned `cool coastal summer` (58/55),
  which is a case the codebase already treats as cool on the prose path.

### Correction, same day: B is wrong, and so was the reasoning behind it

The first version of this section recommended **B (`highF <= 65`)**, arguing it reused the severity
amendment's logic — *dress for the temperature you are outdoors in*.

The owner rejected it: **65°F as a HIGH is a pleasant afternoon, not a cool day.** That is right, and
the error underneath it is worth stating, because it is the same over-application that produced the
puffer incident in reverse.

**The two questions have different answers:**

```text
what should the BASE be made of?   → the HIGH   (when you are out; why #292 moved severity there)
do you need something to put ON?   → the LOW    (mornings and evenings; a layer is the removable
                                                 answer to a temperature that lasts part of a day)
```

A 65/48 day is **not a cool day**. It is a mild day with a cool evening, and the Sightseeing card's
defect is that it carries no layer for the part of the day that is cold — not that its base is too
light. Classifying the whole day is the wrong move; requiring a *removable* layer for the cold end
is the right one.

That also dissolves the objection to **A**. It was rejected above for catching a 72°F/55°F day —
"arguably right for an evening slot, likely wrong for a daytime one". But the requirement is a
removable layer, not a warm base: **carrying a light layer on a 72°F day that drops to 55°F in the
evening is correct advice.** A was being measured against a base-warmth requirement this tier never
imposes.

**Recommendation: A, `lowF <= 55`.** It covers the live bug (65/48), the pinned `cool coastal
summer` fixture (58/55), and the 72/55 evening case that A alone catches and that is genuinely a
layer day.

The number is still a ruling, not a derivation. It is recorded here rather than chosen in code
because this is the fourth threshold in this arc that consumers will treat as ratified once it
ships.

### 5.2 `lowF <= 55` is a fallback proxy, not an inherent truth about every slot

Ruled 2026-09-01. The low answers layer necessity **only when the wearing period is unknown or spans
the cold end of the day.** It is not an unconditional fact about every slot on that calendar date:

```text
72/55, all-day sightseeing   → layer, yes
72/55, dinner / evening      → layer, yes
72/55, 8am farmers' market   → layer, probably
72/55, 1-4pm museum visit    → a layer mandated by the 5am low is not obviously right
```

This is the same caution [cold-severity-spec.md](cold-severity-spec.md) already records: the daily
low tends to occur near dawn and can substantially overstate what the wearer actually experiences.
The correct contract is therefore two-armed:

```text
if the relevant wearing period is known:
    require a removable layer if THAT period reaches <= 55F
else if only the daily range is known:
    lowF <= 55  → require a removable layer, as conservative all-day coverage
```

**Only the second arm is in scope for v1.** The planner has no daypart or hourly weather: slots carry
`environment` (indoor/outdoor) and a transit profile, but no wearing-period clock, and the resolved
weather context is a daily high/low. Building the first arm means new weather infrastructure and is
deliberately out of scope.

What must be encoded now is the **framing**: `lowF <= 55` ships as a *range-level proxy for
unspecified or full-day exposure*, not as a claim that the daily low governs every slot. A future
daypart-aware arm should be able to narrow it without contradicting anything written here.

## 6. Blast radius

This tier **adds** requirements where the engine previously had none, so it can produce findings on
turns that used to pass silently. That is the point, but it is worth stating plainly: every request
resolving to a `cool` band gains a minimum-warmth check it did not have.

Untouched: `isCold` and `isColdSevere` keep their current meanings and thresholds; the prose path
(`weatherProfileFromContext`) already has its own mild-cool vocabulary and is not in scope; footwear
severity gating does not move.

## 7. Non-goals

* Not a new user-entered field.
* Not a change to `isCold`'s own `lowF <= 45` threshold — the open question raised in
  cold-severity-spec.md's amendment stands separately, and a cool tier may well retire it.
* Not a footwear rule at this tier.
* Not a coat requirement at this tier.


---

## 8. Required follow-up: audit `isCold`'s consumers

**This tier must not coexist indefinitely with the current `isCold` semantics.** With A shipped, the
continuum reads:

```text
low 56  → nothing
low 55  → removable layer required
  ...
low 46  → removable layer required
low 45  → isCold fires: stronger base exclusions, bare-piece rules, footwear
          consequences, the existing minimum-warmth floor — all at once, off one degree
```

That cliff is much harder to justify once a graded tier exists below it.
[cold-severity-spec.md](cold-severity-spec.md)'s amendment already records that `isCold` deriving
from the daily low is questionable. The honest reading is that **this tier is probably the conceptual
replacement for part of what `isCold` currently does**, not merely another tier beneath it.

Not expanded into this spec — the blast radius is genuinely larger, and `isCold` drives base
exclusions, bare-piece rules, footwear gates and plan slot construction. But it is a required
follow-up, not an optional one:

> After A is implemented, audit every `isCold` consumer and classify it: does it genuinely need
> `lowF <= 45`, or should it consume `needsRemovableCoolLayer` or `isColdSevere` instead?

Without that audit the engine carries two overlapping cold models, which is the condition the
consolidation arc exists to prevent.


---

## 9. Implementation (2026-09-01)

`COOL_LOW_F = 55` and `needsRemovableCoolLayerForRange` in `styling-engine/weather.js`, emitted by
`resolveTemperatureField` on all branches and by `BAND_FLAGS`, persisted as
`needs_removable_cool_layer`, and propagated through `profileFromResolvedWeatherContext`, the indoor
projection (`transitNeedsRemovableCoolLayer`) and the planner's slot profiles — at the source rather
than at a call site, per `[R1]`'s lesson.

Consumer: one branch in `evaluateOutfitEnvironmentalAdequacy`.

```text
85/68  isCold ✗  severe ✗  needsRemovableCoolLayer ✗
72/58  ✗ ✗ ✗
72/55  ✗ ✗ ✓        the evening-layer case only threshold A catches
65/48  ✗ ✗ ✓        the live bug
58/55  ✗ ✗ ✓        pinned cool coastal summer
65/45  ✓ ✗ ✓
45/45  ✓ ✓ ✓
```

Two decisions worth recording because neither is obvious from the spec text:

**Satisfied only by an actual layer, hard when there is none.** §3's tightening is structural: a
heavy long-sleeved base does not satisfy it. Verified — the tank card fails, the same card plus a
cardigan passes, and a heavy-wool-top version still fails.

**Fires only when `isCold` has not.** Below 45°F the minimum-warmth floor already owns the outfit and
accepts a heavy main where this tier would not; letting both fire produces two findings for one
outfit. The tiers are therefore disjoint by construction, which is a deliberate stopgap — §8's audit
is what actually resolves the overlap. Recorded here so the disjointness is not mistaken for the
final model.

Not implemented: a transit consumer. `transitNeedsRemovableCoolLayer` is propagated and available,
but no rule reads it yet — the existing transit floor still requires `transitIsCold` (≤45°F), so a
cool-but-not-cold transit to an indoor destination has no removable-coverage requirement. Recorded
as a gap rather than closed, since it wants the same daypart reasoning as §5.2.

Tests: 8 in `test/outfitEnvironmentalAdequacy.test.js`, including the warm-base control, the
disjointness check, and resolution/persistence round-trip against the real resolver.
