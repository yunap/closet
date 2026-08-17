# Closet docs — index and routing

**Start here.** This app's behaviour is documented before it is coded: the maps and ratified
documents below state *intent*, and the code implements it. Reading code without reading intent
reliably produces confident wrong conclusions — a deliberate design decision looks identical to a
missing feature from the inside.

Written 2026-08-16, after a debugging session that reached the wrong answer three times by
inferring intent from implementation. See §"How to use this index" at the bottom.

---

## Route your question

| If you are asking… | Read first |
|---|---|
| Why did the engine allow / block / rank this garment? | [engine-behaviour-map.md](engine-behaviour-map.md) |
| What did the user tell the app, where did it go, who reads it, with what authority? | [feedback-and-memory-map.md](feedback-and-memory-map.md) |
| Where in the UI does this happen, and what can the user actually touch? | [app-surface-map.md](app-surface-map.md) |
| Which model calls does this flow make, in what order? | [flows/README.md](flows/README.md) — the flow atlas, all 16 model-facing flows |
| What does this `pieces` field mean / who fills it in? | [garment-field-reference.md](garment-field-reference.md) |
| Is this style claim legitimate? | [style_constitution.md](style_constitution.md) — single authority for style claims |
| What is allowed for this occasion? | [occasion_profiles_ratification.md](occasion_profiles_ratification.md) |
| How does the freeform stylist chat (`/ask`) work, and what has already been tried? | [freeform-rearchitecture-handoff.md](freeform-rearchitecture-handoff.md) |
| Anything about capsules | [capsule-index-and-plan.md](capsule-index-and-plan.md) — the capsule index |
| Can I run this script against the real DB? | [database-safety.md](database-safety.md) |
| Where is the spec for X? | [specs/README.md](specs/README.md) — 35 historical specs, **archive only**. Their `Status:` lines are frozen at authoring and often wrong; authority order is code > ratified docs > archive |

---

## 1 · The three maps — ratified descriptions of the current system

These describe; they do not propose. Each carries a status line, amendment dates, and inline
markers: **[by design]** · **[unverified]** · **[owner check wanted]** · **[bug]** ·
**[latent inconsistency]**.

| Doc | Covers | Status |
|---|---|---|
| [engine-behaviour-map.md](engine-behaviour-map.md) | Gates, scores, ceilings, caches, retry loops, owner-constraint gate, capsule composition | 12th pass 2026-07-26, amended 2026-08-12 |
| [feedback-and-memory-map.md](feedback-and-memory-map.md) | 12 store categories × writer / user action / reader / **authority**; the four persistence media | Ratified 2026-08-09, amended 2026-08-12 |
| [app-surface-map.md](app-surface-map.md) | Every route, tab, mode-split and dialog group | First pass 2026-07-26 |

**The authority column is the point of the feedback map.** *hard gate* · *score* · *prompt* ·
*thread-only* · *display* are not interchangeable, and most misdiagnoses come from treating a
soft, deliberately-scoped channel as if it should have prevented a hard failure — or vice versa.

**These maps are verifiable, not just readable.** They cite runnable scripts and print the searches
that produced their enumerations:

```bash
node scratch/measure_feedback_surface.js              # regenerates every count in the feedback map
node scratch/audit_feedback_surface_completeness.js   # fails if a store exists that the inventory does not classify
```

`scratch/feedback_surface_inventory.json` classifies every store explicitly. **Enumerate with it;
do not sample tables by guessed name.** If a figure in a map disagrees with its script, trust the
script.

## 2 · Ratified authorities — quote these, do not re-derive them

| Doc | What it settles |
|---|---|
| [style_constitution.md](style_constitution.md) | Single authority for all style claims. No model may add to it |
| [occasion_profiles_ratification.md](occasion_profiles_ratification.md) | Occasion profiles + register ceilings. Not a draft — the title said DRAFT for months while the body was ratified, and a later session spent a day changing occasion behaviour because nothing linked here |
| [garment-field-reference.md](garment-field-reference.md) | Every `pieces` field: meaning, accepted values, whether tagging fills it, where it is editable |
| [color-taxonomy-rules.md](color-taxonomy-rules.md) | Colour taxonomy research, audit, proposed redesign |
| [database-safety.md](database-safety.md) | How a script may touch the live DB. Non-optional |

## 3 · Active work — proposals, handoffs, plans

Read the status table at the top of each before assuming a capability is missing. "Open" in a
proposal is not evidence the capability is absent.

| Doc | What it is |
|---|---|
| [freeform-rearchitecture-handoff.md](freeform-rearchitecture-handoff.md) | The `/ask` "router → stylist" migration, spec by spec, with the live failures that motivated each. **The record of what has already been tried and why** |
| [feedback-routing-proposal.md](feedback-routing-proposal.md) | Five destinations, one primary reader each. Proposes; cites the feedback map rather than restating it |
| [capsule-index-and-plan.md](capsule-index-and-plan.md) | Capsule index and sequence → [current behaviour](capsule-current-behaviour.md), [roster selection](capsule-roster-selection-spec.md), [real-world rules](capsule-real-world-rules.md), [palette rules](capsule-palette-rules.md), [lifestyle contract](capsule-lifestyle-contract-2026-08-06.md), [step 5 evaluation](capsule-step5-evaluation.md), [bench brief](capsule-bench-implementation-brief.md) |
| [card-consistency-spec.md](card-consistency-spec.md) | A card and its own words disagreeing — the fourth turn-contract clause, and the single dress archetype. Owner-ruled 2026-08-16, not implemented |
| [active-memory-surface-spec.md](active-memory-surface-spec.md) · [guidance-applicability-review.md](guidance-applicability-review.md) | Owner-guidance surface and applicability |
| [feedback-audit-backlog.md](feedback-audit-backlog.md) | Hardening the verification tooling itself |
| [cleanup-inventory.md](cleanup-inventory.md) | Dead-code / duplicate-authority sweep (spec 20), with an explicit scope note |

## 4 · Flow atlas

[flows/README.md](flows/README.md) — every model-facing flow as a diagram, grouped A–F (intake ·
wardrobe composition · editorial · image rendering · evaluation · the `/ask` chat brain).
Rectangles are app code, hexagons are model calls. Complete: all 16 flows mapped.

## 5 · Review records and panels — historical, still binding where marked ratified

| Doc | |
|---|---|
| [expert-panel-brief.md](expert-panel-brief.md) | The panel protocol. Owner-ratified 2026-07-25 |
| [panel-packet-stage1.md](panel-packet-stage1.md) · [panel-stage1-findings.md](panel-stage1-findings.md) | Stage 1 stylist-direction review |
| [item13-feedback-panel-packet.md](item13-feedback-panel-packet.md) · [findings](item13-panel-findings.md) · [walkthrough](item13-feedback-panel-presenter-walkthrough.md) | Feedback-memory panel. Findings owner-ratified |
| [ui-v1-design-handoff.md](ui-v1-design-handoff.md) | UI V1 design and readability rulings |
| [stylist-session-handoff.md](stylist-session-handoff.md) | Long-running stylist work handoff |
| [tagger-audit-plan.md](tagger-audit-plan.md) · [findings](tagger-audit-findings.md) · [cost spec](tagger-cost-spec.md) | Tagger audit and cost work |

## 6 · The spec archive — historical only

[specs/](specs/) holds 35 design specs (2026-07-08 → 07-20), copied in on 2026-08-16 from outside
the repo. **They span several generations of this app and their decisions have been revisited,
reversed and deleted since.** Every file carries a banner saying so; `npm test` enforces it.

> **Authority order (owner ruling, 2026-07-30):** code > ratified docs > archive. A decision made
> from fresh evidence stands; *"an old spec decided otherwise" is an unverified claim, not a
> finding.* Record the disagreement, let testing settle it.

Deliberately no shipped/not-shipped table — see [specs/README.md](specs/README.md) for why, and for
how to check a given spec against the sources that *are* maintained.

## 7 · Point specs

[stylist-bugfix-spec.md](stylist-bugfix-spec.md) ·
[board-feedback-desync-spec.md](board-feedback-desync-spec.md) ·
[compact-wardrobe-filters-v1.md](compact-wardrobe-filters-v1.md) ·
[usage-tracking follow-up](compact-wardrobe-filters-followup-usage-tracking.md) ·
[wardrobe-color-controls-spec.md](wardrobe-color-controls-spec.md)

---

## How to use this index

1. **Route the question through the table above before opening the code.** The maps answer most
   "why did it do that" questions outright, and answer them with stated intent rather than with an
   inference you would have to make yourself.
2. **Check authority before calling a channel broken.** A soft, scoped reaction store is not
   failing when it does not block a garment — that is its design. Look for the *hard* channel that
   owns the question (`owner_constraints`, `occasion_exclusions`, the structured gates).
3. **A missing gate may be deliberate.** This codebase contains both "not yet reached" and
   "intentionally loosened", and they are indistinguishable from the code. The maps mark the
   difference; `git log` and the handoff docs carry the rest.
4. **Enumerate, do not sample.** Use the inventory and the measurement scripts.
5. **Update the doc in the same change as the code.** A map that has drifted is worse than no map,
   because it is still trusted. When you change gate, memory, or surface behaviour, amend the
   relevant map in the same commit and date the amendment inline, as the existing ones do.
