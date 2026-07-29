# Implementation brief — capsule bench + roster validator (spec steps 1–2)

**For:** an implementing agent starting cold on this repo.
**Scope:** migration steps 1 and 2 of `docs/capsule-roster-selection-spec.md` only.
**Explicitly out of scope:** step 3 (the roster-selection model call), any prompt or schema work,
any change to what the stylist says. Stop when steps 1–2 are green and report; do not continue into
step 3.

Both deliverables are deterministic code with free, offline acceptance criteria. If you cannot
verify a claim with a command in §6, you have not finished it.

---

## 1. Operating rules — read before writing code

These are project rules, not suggestions. Violating them has cost real money and real review cycles
in this repo before.

1. **Never make a billed model call.** Do not construct an AI client. Do not run anything that
   calls a provider. Everything in this brief is verifiable against the local `wardrobe.db`
   (243 active pieces, read-only) and the existing offline scripts. If you believe a task requires a
   model call, stop and say so instead of making one.
2. **Read `docs/app-surface-map.md` and `docs/engine-behaviour-map.md` before assuming anything
   about how the app behaves.** A previous agent spent an entire round proposing a mechanism that
   already existed, because it argued from absence without checking the maps.
3. **Before trusting any "still open", "not yet implemented", or `[known bug]` claim in these docs,
   grep the code it names and confirm it is still true.** Several such claims have gone stale after
   the fix landed elsewhere. A status tag is a claim about the code at the time it was written, not
   a live query.
4. **An absence is not automatically a defect.** This codebase has a documented history of
   deliberate omissions that look like bugs (see `docs/stylist-session-handoff.md` → "The recurring
   failure mode"). If something looks missing, check whether it was ruled out on purpose before
   filing or fixing it.
5. **Do not weaken any gate.** Trust, register ceiling, weather, and activity-footwear gates keep
   their current authority. Nothing in this brief changes what a gate excludes.
6. **Do not touch ports 3098/5174 without asking.** Not needed for this work.
7. **Report measurements, do not assert conclusions.** Where this brief asks for a number, the
   number is the deliverable. The owner decides what it means.

## 2. Where the code lives

Everything is in `styling-engine/outfitSetPlanner.js` unless noted.

| Existing thing | What it does | Your relationship to it |
|---|---|---|
| `capsulePiecesEligibleForAnySlot(pool, slots, {isSummer, isWinter})` | union of pieces passing ≥1 requested slot's real gates | **reuse as-is** — this is the bench's eligibility rule |
| `capsuleVersatilityScore(piece, {isSummer})` | per-piece heuristic | **reuse as the bench ranking**; do not retune it |
| `capsuleQuotas(budget, {isSummer, isWinter})` | category allocation | read it for the category minimums; do not change it |
| `selectCapsuleRoster(pool, {...})` | today's deterministic roster | **must keep working byte-identically** — the bench is additive |
| `capsuleOutfitCoreCapacity(roster, slots)` | distinct gate-valid cores | reuse in the validator |
| `allocateCapsuleRepresentativeRotation(slots, roster, {cap})` | card allocation, globally bounded | reuse to know how many cards a roster must support |
| `ensureCapsuleGroupReserve`, `ensureCapsuleGroupFloorReserve`, `ensureWinterIndoorTopBalance`, `ensureWinterLayerRole`, `ensureCapsuleShoeDemands`, `shoeReserveDemands`, `elevatedCapsuleDemands` | the reserve passes that repair structural holes today | **this is the material for the validator** — read each one and ask "what condition was this trying to guarantee?" |
| `MIN_ENFORCED_CAPSULE_BUDGET` (6), `PLAN_WORKBENCH_PIECE_LIMIT` (40) | existing constants | `PLAN_WORKBENCH_PIECE_LIMIT` is the precedent for bench size 40 |

## 3. Deliverable 1 — the bench builder

Add an exported function. Suggested shape; adjust names if the codebase argues otherwise, but keep
the guarantees.

```js
export function buildCapsuleBench(pool = [], {
  budget = 24, slots = [], isSummer = false, isWinter = false, benchSize = 40
} = {}) → { bench, diagnostics }
```

**Rules, in priority order:**

1. **Eligibility:** start from `capsulePiecesEligibleForAnySlot(pool, slots, {isSummer, isWinter})`,
   plus the existing winter warm-season exclusion that `selectCapsuleRoster` already applies. Same
   meaning as today; do not invent a new eligibility rule.
2. **Ranking:** `capsuleVersatilityScore`, descending. Ties broken stably (piece id ascending) so
   the bench is reproducible across runs — a bench that reshuffles is untestable.
3. **Guaranteed minimums, applied before the global truncation to `benchSize`:**
   - **per category** — at least what `capsuleQuotas(budget, …)` asks for, and never fewer than
     2 tops, 2 bottoms, 2 shoes when the pool contains them;
   - **per requested slot** — at least enough gate-eligible pieces for that slot to form one
     complete core (top+bottom or dress, plus shoes) if the wardrobe can supply one at all.
   These guarantees are the entire reason the bench is not just "top 40 by score". A slot that the
   wardrobe genuinely cannot cover stays uncovered — record it in `diagnostics`, do not fabricate.
4. **Truncation:** fill remaining places by rank until `benchSize`. If the guarantees alone exceed
   `benchSize`, keep the guarantees and let the bench exceed the target — record it in
   `diagnostics`. Never drop a guaranteed piece to hit a size number.
5. **Diagnostics:** return enough to inspect the result — final size, per-category counts, per-slot
   eligible counts, which pieces were admitted by guarantee rather than by rank, and any slot with
   no possible core.

**Do not** attach images, build prompts, or call anything model-facing. The bench is a data
structure.

## 4. Deliverable 2 — the roster validator

```js
export function validateCapsuleRoster(roster = [], {
  slots = [], budget = 24, isWinterCapsule = false, plannedCards = 0
} = {}) → { ok, failures: [{ code, message }] }
```

Each failure must be **structural and specific enough to repair from** — it will eventually be fed
back to a model as a repair instruction. "Roster is bad" is useless; "Restaurant Dinner has 4
eligible shoes but only 1 eligible bottom, so it supports 1 core" is repairable.

**Conditions to check** (derive the exact thresholds from the reserve passes named in §2 — do not
invent new taste rules):

| code | condition |
|---|---|
| `budget_exceeded` | roster size > budget, or a piece not active / not from the supplied pool |
| `slot_uncoverable` | a requested slot has no gate-valid core (top+bottom or dress, plus a shoe) |
| `capacity_below_rotation` | total distinct-core capacity < `plannedCards` — use `capsuleOutfitCoreCapacity` and the same feasibility logic `allocateCapsuleRepresentativeRotation` uses |
| `category_floor` | too few tops/bottoms/shoes for the rotation not to be carried by one piece |
| `winter_layer_role_missing` | winter capsule at budget ≥ 12 lacking the indoor cardigan or the transition coat/jacket role |
| `register_shoe_path_missing` | slots span casual and elevated but the roster has no legal shoe at one end |

**Hard constraint: the validator must never validate colour, palette, or aesthetic coherence.**
It validates *capacity*. A hard filter on a taste dimension starves the roster — this is settled in
this project (`docs/stylist-session-handoff.md`, the `home`-gate lifestyle-audit ruling). If you
find yourself writing a colour check, stop; that belongs to the model, per spec §7.

## 5. Deliverable 3 — the bench width check

A read-only script, `scratch/diagnose_capsule_bench.js`, plus an npm script
`test:capsule:bench`, following the pattern of `scratch/diagnose_capsule_scenario_matrix.js`
(read the header comment there first — it documents the no-AI-client, no-network contract).

It must answer one question across the existing scenario matrix (summer/winter × budgets
10/14/18/24 × the casual, mixed-register, and social slot sets):

> **How often does today's `selectCapsuleRoster` pick a piece that falls outside the top 40 of the
> same bench ranking?**

Print, per scenario: roster size, bench size, how many roster pieces are outside the bench, and
which ones by name. Then an overall rate.

**Do not** convert this into a pass/fail threshold and do not tune the bench until the number looks
good. A high rate means the ranking and the selection disagree and the bench must widen; a low rate
means 40 already contains the interesting choices. **Report the number; the owner rules on it.**

## 6. Acceptance — every claim needs one of these commands

```bash
node --test test/plan_outfit_set.test.js test/stylingIntent.test.js test/freeform_observability.test.js test/outfitChatLayout.test.js
```
Baseline **196/196 passing**. Your new tests add to this; nothing here may regress.

```bash
node --test test/aiEndpointContracts.test.js
```
Known baseline **136 pass / 7 pre-existing fail**. Seven failures is correct. Eight is yours.

```bash
npm run test:capsule:offline && npm run test:capsule:summer-replay && npm run test:capsule:roster-utility && npm run test:capsule:lifestyle-audit
```
`test:capsule:offline` must still report **no structural gaps**; the summer replay must stay
**11/11 accepted with 0 raw validator lines in production notes**.

```bash
node scratch/check_style_claims.js && node scratch/check_text_matching_ratchet.js && git diff --check && npm run build
```
All must pass. **Ratchet note:** the text-matching ratchet fails the build if you add a
garment-name regex. `outfitSetPlanner.js` has an allowance of 7 and is currently at 0 — any new
regex needs a trailing `// ratchet-allow: <why this is not garment matching>` comment, and it needs
to be *true*. Do not add keyword matching on garment names; every rule here reads structured
columns.

**The step-2 precondition, which is the whole point of the ordering:** run
`validateCapsuleRoster` against **today's** `selectCapsuleRoster` output across the full scenario
matrix. It must pass on all of them. If it fails, **the validator is wrong, not the roster** —
today's rosters are the ratified behaviour. Fix the validator.

## 7. Tests to add

In `test/plan_outfit_set.test.js`, matching the existing style (each test's comment says what real
failure it pins, not what the function does):

- bench honours per-category minimums when the global ranking would have starved a category;
- bench honours the per-slot minimum — a low-ranked piece that is the only thing covering a slot is
  admitted;
- bench is deterministic across two calls with identical inputs;
- guarantees win over `benchSize` rather than being dropped to hit the number;
- validator accepts today's deterministic roster for a representative scenario;
- validator produces a specific, repairable failure for each `code` in §4;
- validator does not reject a roster for colour or aesthetic reasons (pin the constraint).

## 8. What to report back

1. The bench width number from §5, per scenario and overall — the headline deliverable.
2. Any place where a reserve pass's intended guarantee was **unclear** rather than obvious. Those
   are design questions for the owner, not things to guess at. Say "I could not tell what
   `ensureCapsuleGroupFloorReserve`'s protected-count logic is guaranteeing" rather than inventing a
   validator rule for it.
3. Anything in `docs/capsule-roster-selection-spec.md` that turned out to be wrong about the code.
   The spec was written from a reading of the engine, not from implementing against it; it is
   expected to have at least one error. Finding it is useful work, not a complaint.
4. The exact command output for each acceptance check in §6.

Do not commit. Do not open a PR. Leave the worktree for review.
