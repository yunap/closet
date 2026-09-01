# Spec — a `cool` tier between mild and cold

**Status:** Proposed 2026-09-01, not implemented. **One owner ruling required: the threshold (§5).**
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

## 3. What the tier must require

Deliberately modest. This is the *"a layer, not a coat"* tier:

* **at least one of**: an outerwear layer of any role — `indoor_layer` counts — **or** a
  non-sleeveless base of medium weight or heavier.
* **not** an outdoor-capable layer. That is the severe tier's requirement and must not migrate down.
* **not** a footwear rule. Mesh at 50°F is fine; that gating stays on severity.

A `cool` finding should be **hard** when the outfit has *no* layer and a *sleeveless or light* base
— the Sightseeing card — and **advisory** otherwise, following the measured/unmeasured discipline
already established in
[outerwear-weather-consolidation-spec.md](outerwear-weather-consolidation-spec.md) Appendix K.

## 4. Where `piece.season` finally fits

[piece-season-as-weather-evidence.md](piece-season-as-weather-evidence.md) left `season` unruled
because the severe tier already had better physical evidence. The cool tier is its natural home: a
base tagged **entirely `season: warm`** in resolved cool weather is exactly the corroboration role
that document proposed — strengthening an existing shortfall, never creating one alone.

Both live incidents show the pattern. This trip's Nature Walks card pairs a `season: warm` tee and
`season: warm` pants under a *light* `indoor_layer` hoodie for a 45°F morning; the earlier Trail card
did the same under a puffer. Neither is caught today.

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
* **A (`lowF<=55`)** is the widest. It catches a 72°F/55°F day as cool, which is a warm day with a
  cool evening — arguably right for an evening slot, likely wrong for a daytime one.
* **B (`highF<=65`)** is consistent with the severity amendment's own logic: the **high** is the
  temperature the wearer is actually out in. Catches the bug and the pinned coastal fixture, leaves
  a 72°F day alone.
* **C (`lowF<=50`)** catches the bug narrowly but misses the pinned `cool coastal summer` (58/55),
  which is a case the codebase already treats as cool on the prose path.

**Recommendation: B, `highF <= 65`.** It is the same reasoning that fixed severity — dress for the
temperature you are outdoors in — and it is the only candidate that covers both the live bug and the
existing pinned fixture without reaching into genuinely warm days.

The number is a ruling, not a derivation. It is recorded here rather than chosen in code because
this is the fourth threshold in this arc that consumers will treat as ratified once it ships.

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
