# Freeform prompt and tool ownership

> **Amendment 2026-08-20 — cache stability is part of ownership.** A tool description is a *cached*
> artefact: Anthropic orders the prefix tools → system → messages, so the breakpoint on the system
> block covers the tools ahead of it. Per-turn policy in a tool description therefore does not merely
> sit in the wrong owner's block — it invalidates the entire cached prefix whenever the turn mode
> changes. Measured: a per-mode amendment moved 97.8% of a 31,259-character tool block, discarding
> ~35k tokens of warm prefix on the first follow-up. The volatile controller varies for free.
> Enforced by `tool schemas are byte-identical across turn modes` in `aiEndpointContracts.test.js`.
> See [freeform-prompt-cache-levers.md](freeform-prompt-cache-levers.md).


**Status:** first ownership pass implemented; deeper cached-prefix audit remains evidence-gated — 2026-08-19
**Scope:** `/api/ai/ask` full-stylist controller and its tool catalog

## Rule

Every instruction has one primary owner. A prompt may name a cross-component boundary, but it does
not restate a tool's arguments or mechanical contract. Tool descriptions own tool-local eligibility,
arguments and output behavior; the system prompt owns styling policy, conversation behavior and
relationships spanning several tools.

This is a cost and cache document, not permission to weaken behavior. A duplicate is removed only
when a contract test proves the surviving owner still states it.

## Ownership map

| Instruction family | Primary owner | Cache segment | Ruling |
|---|---|---|---|
| Style Constitution and conversational voice | `styling-engine/prompts.js` → `STYLIST_SYSTEM` | stable prefix | Keep intact; not a schema concern. |
| Occasion/climate rule data | `styling-engine/core.js` → `buildStylistConversationPayload` | stable prefix | Keep intact; code supplies current profiles. |
| Wardrobe existence/index and verification boundary | manifest block in `buildStylistConversationPayload` | stable prefix | Keep intact until bounded discovery is separately ruled. |
| Current conversational mode | `buildStylistConversationDirective` | volatile tail | One `Turn directive` only. The removed `modeDirectiveText` and four unconditional mode reminders duplicated it. |
| Tool eligibility, arguments and mechanical result | each entry in `styling-engine/tools.js` → `STYLIST_TOOLS` | provider tool schema | Tool-local authority. The controller names ownership but does not repeat schemas. |
| Bounded multi-look exception attached to tools | `styling-engine/provider.js` → `stylistToolsForTurn` | provider tool schema | Dynamic `declare_intent`/`generate_outfits` descriptions own skip-declaration behavior. |
| Cross-tool choice: one vs same-context batch vs multi-context plan vs existing-card revision | `freeformToolRoutingInstruction` | volatile tail | Remains in the controller because no single tool can own the relationship. |
| Current cards, established context and resolved weather | structured `THREAD STATE` in `buildStylistConversationPayload` | volatile tail | Structured authority; older prose loses conflicts. |
| Durable owner correction storage contract | `store_user_correction` tool description/schema | provider tool schema | Tool authority; feedback content itself remains in the memory block. |

## First removal

The 2026-08-19 pass removes only proven volatile duplication:

- the second mode paragraph (`Mode instructions`) and four always-present per-mode reminders;
- the controller's restatement of `declare_intent`, `suggest_slot_swaps`, and `render_preview`
  arguments;
- the long bounded-multi-look restatement already owned by dynamically amended tool descriptions.

The replacement controller keeps a short ownership statement and the irreducibly cross-tool
decision: one/best uses the verified serial path, a fresh same-context 2–5 batch may use bounded
generation, multi-context work uses `plan_outfit_set`, and existing-card revisions use
`suggest_slot_swaps`.

Source-level runtime-string measurement against the branch baseline: ordinary full-stylist turns
remove **1,181–1,267 characters** (roughly 295–317 tokens, depending on conversation mode) from
every provider iteration. With the bounded-multi-look controller enabled, the removal is
**1,859–1,945 characters** (roughly 465–486 tokens) per iteration. These are payload estimates, not
billed-cost claims; actual tokenizer usage and cache accounting remain part of Slice 10.

## Acceptance

1. Every removed behavior phrase has a surviving owner asserted in tests.
2. Flag-off tool availability and execution are unchanged.
3. The Style Constitution, profile data, wardrobe manifest, thread state and feedback memory are
   byte-unchanged by this slice.
4. The bounded exception remains present only when its existing feature flag is on.
5. Prompt/style/docs/text-matching guards remain green before any live measurement.

## Deferred

The large stable `STYLIST_SYSTEM` contains older tool-routing prose too, but it also carries mature
quality constraints and forms the provider-cache prefix. It is not changed in this first pass.
Deleting from it requires a separate semantic inventory plus live quality evidence; nominal token
reduction can lose to cache recreation or styling regression.
