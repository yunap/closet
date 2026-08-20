# Freeform prompt-cache levers

**Status:** lever 1 implemented 2026-08-20; levers 2–5 specified, not implemented
**Authority:** succeeds the cost work in `freeform-batched-discovery-spec.md`, which established what
actually drives spend. Read its "Measured cache shape" section before proposing anything here.

## The shape of every cache bug found so far

Two have been found and fixed in this arc, and they were the same bug twice:

- The current turn's user message carried a `Today is …` line that browser history never replays, so
  message 0 differed on every follow-up. Fixed: cache creation −89% on a consecutive turn.
- Tool descriptions were amended per turn mode, so the tool block differed between a new request and
  a follow-up (lever 1 below).

Neither was "the prompt is too long." Both were **a supposedly stable cached prefix containing
turn-variant text**. That is the shape to look for first, because a single varying byte early in the
prefix costs more than several thousand stable ones.

Anthropic's cached prefix is ordered **tools → system → messages**, so a `cache_control` breakpoint
on the system block covers the tools that precede it. **A byte that varies in the tools therefore
invalidates the entire prefix**, not just the tools.

## Measured composition of a freeform turn

Taken on the owner's wardrobe, 2026-08-20, with `scratch/` instrumentation:

| Component | Tokens | Cached? |
|---|---:|---|
| Tool schemas | 7,725 | yes — precede the system block |
| Stable system block | 27,736 | yes |
|  · wardrobe manifest | 15,698 (57%) | |
|  · aesthetic block | 9,382 (34%) | |
|  · occasion profiles | 1,462 (5%) | |
|  · style constitution | 1,142 (4%) | |
| Volatile system block | 2,788 | **no — full input price every call** |

## Lever 1 — tool schemas must be stable across turn modes · IMPLEMENTED

`stylistToolsForTurn` appended a bounded-multi-look exception to `declare_intent` and
`generate_outfits`, but only for `turnMode === 'new_request'`. Measured divergence:

```
new_request tools: 31,259 chars
followup    tools: 30,898 chars
diverge at char 695 of 31,259  →  97.8% of the block differs
```

Because tools precede the system block, a thread that moves from a new request to a follow-up
invalidated roughly **35k tokens** of otherwise-warm prefix — tools *and* system.

It was also a prompt-ownership violation. `docs/freeform-prompt-ownership.md` gives per-turn mode
behaviour to the volatile controller; putting it in a tool description made a stable, cached artefact
carry per-request policy.

### The contract

1. **Tool schemas are identical across turn modes.** Byte-for-byte.
2. **Tool descriptions carry no request-mode policy, routing policy, or "when in follow-up /
   new-request" behaviour.** They describe stable capability, input shape and invariants.
3. **Per-turn mode behaviour lives in one volatile controller block**, which is already below the
   cache breakpoint and already varies per turn, so it costs nothing in reuse.
4. A test serializes the tool schemas for `new_request` and `followup` and asserts equality.
5. This document is the note explaining why that test exists, so a future change that "just adds a
   line to a tool description" can see the cost before making it.

Note the exception that stays legitimate: `stylistToolsForTurn` still returns *fewer* tools once a
bounded path has completed (`capsuleAtomicCompleted`, `slotSwapCompleted`, `atomicMultiLookCompleted`),
and `allowedToolNames` still narrows the catalog. Those change **which** tools are offered, which is a
deliberate turn-ending boundary. The contract is about the *text of a tool's schema*, not about the
catalog being fixed.

## Lever 2 — the aesthetic block · SPECIFIED, NOT STARTED

9,382 tokens, 34% of the cached prefix, and never examined. Tiered discovery attacked the manifest
(57%) and was removed for being coupled to a failed loop; nobody has asked what the second-largest
section is doing.

**Risk: this is probably load-bearing taste substrate.** It is the material that makes the stylist
sound like this app rather than a generic assistant, and the founding lesson of the Visual Composer
redesign was that stripping context to save tokens produces confident, worse output.

So: audit, do not trim on sight. Compress only behind a byte or behaviour ratchet, or an A/B harness
that can show the styling did not get worse. `prompt_equivalence.test.js` is the existing mechanism —
it already freezes these strings and requires any change to be declared.

## Lever 3 — model tiering · SPECIFIED, POSTPONED BY OWNER

Everything runs on `claude-sonnet-4-6`. The pricing table already knows Haiku at a third of the cost,
and `askStylistStructuredWithUsage` already accepts a `model` parameter that nothing passes.

- **The execution router is the obvious candidate.** It is a pure classification, sees no wardrobe,
  writes no prose, and runs on essentially every turn.
- **Anything that writes styling prose or chooses garments stays on Sonnet until measured.** That is
  where judgment lives, and cheapening it is how a quality regression arrives quietly.

Postponed deliberately, not forgotten. Revisit only with a quality comparison, not a cost argument.

## Lever 4 — the volatile block · SPECIFIED, NOT STARTED

2,788 tokens paid at **full input price on every call**, because it sits below the breakpoint. Never
audited. The question is per-line: does this genuinely vary per turn, or is it stable text that
drifted below the breakpoint and could move above it?

Cheap and safe to examine, and best done *after* lever 1, since lever 1 moves text into this block.

## Lever 5 — image and roster tokens · MEASUREMENT TASK, NOT A REFACTOR

`WARDROBE_FREEFORM_ADAPTIVE_VISUALS` shipped and was made default-on without anyone quantifying what
the photo roster costs per composition turn. Images are input tokens; a bounded visual roster can
reach 90 pieces.

**Measure before touching it.** Visual grounding is a founding principle of this app, and the image
budget is already load-bearing for two commitments: per-category thumbnails under batching, and
unpictured candidates staying visible. Do not propose a cap before the number exists.

## What not to re-propose

`freeform-batched-discovery-spec.md` records four cost hypotheses. Three were disproven with data —
iteration count dominating, TTL expiry, and the moving cache breakpoint duplicating writes. The
fourth, whether the moving breakpoint earns its cost, was answered yes at 15% on a two-iteration turn
and is settled at current pricing.
