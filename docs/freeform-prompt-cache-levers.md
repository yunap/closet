# Freeform prompt-cache levers

**Status:** lever 1 implemented, lever 4 examined and declined, both 2026-08-20; levers 2, 3, 5 specified
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
|  · instruction block (see lever 2) | 9,382 (34%) | |
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

## Lever 2 — the big instruction block · AUDITED; part C DONE 2026-08-20

**First, a correction.** This was originally recorded here as "the aesthetic block, probably
load-bearing taste substrate." That label was wrong, and came from a marker-matching heuristic that
swept from an `AESTHETIC` heading to the next heading it recognised.

The section is `AESTHETIC NEUTRALITY & CONVERSATIONAL CONSTRAINTS` — 8,099 tokens, 95 bullets — and
it is not taste. It is the accumulated operating manual: how to speak, when to call which tool, how
to handle anchor pieces, hard garment constraints, photo honesty. The genuine taste material (body
contract, proven formulas, aesthetic gravity, style lanes) is about **812 tokens**, not 9,382.

That matters for scoping. The block is not delicate substrate to compress carefully; it is a rulebook
to audit. Four categories:

| | Content | Verdict |
|---|---|---|
| **A · tool-mechanics duplication** | "call `propose_outfit` once per outfit", "use `plan_outfit_set` when…", capsule intake, re-rendering, storing corrections | largest share; `freeform-prompt-ownership.md` already rules this belongs to tool descriptions, and explicitly deferred this cached block to "a separate quality-and-cache review" — this is it |
| **B · generic knowledge** | office = quiet and structured; hikes need durable shoes; don't wear two vests | trim last and least; several exist because a model once face-planted confidently |
| **C · global false law** | material absolutes | **done, below** |
| **D · app-specific** | photo honesty, no hallucinated garments, verification contract, scarcity honesty, voice/avoid-words | keep |

### Part C — global absolutes removed (owner ruling)

Three rules read as authoritative while being globally false. Ordered first, ahead of the larger
token win in A, because **A is a cost question and C was a correctness one**: a rule that looks
authoritative and is wrong silently damages outfit quality.

The worst was self-contradiction. `Silk, satin, chiffon → always wear_over_only regardless of notes`
overrode **the owner's own note about their own garment** — the strongest rung on the evidence
provenance ladder ratified the day before, and contradicted by two other passages in the same prompt
saying `tuck_behavior` is evidence rather than infallible truth. Silk blouses are tucked routinely;
this was an incident generalised to a material name and shipped to every user of a multiuser app.

| Was | Now |
|---|---|
| "Silky or satin fabrics cannot hold a tuck — never suggest tucking them" | slippery/drapey fabrics *may be less stable*; check `tuck_behavior`, owner notes, hem, length and the receiving waistband. **Do not infer "wear over only" from the material name alone** |
| "Silk, satin, chiffon → always wear_over_only regardless of notes" | a reason to check, not a verdict; **where material and owner notes conflict, the owner's note wins** |
| "Never recommend heels, wedges, or delicate shoes for walking-heavy days" | avoid high, slender or unstable heels; **a low block heel may be acceptable where saved comfort evidence supports it** (the body contract already allowed low block heels — the absolute contradicted the constitution) |
| "Never pair two 'loud' pieces" | don't pair two focal pieces **without a clear unifying relationship**; deliberate mixing is allowed when hierarchy, palette and scale are controlled |

The general case stays with structured truth (`tuck_behavior`); the specific case belongs to
per-piece `RULES (authoritative)`, a mechanism that already exists in this same prompt under
`EARNED WISDOM OVERRIDE`. Pinned by `the stylist prompt states no global material absolutes`, which
asserts the absolutes are gone *and* that the override mechanism survives.

### Part A — ATTEMPTED AND REVERTED; it is not a bulk removal

17 of the 95 bullets name a tool, totalling ~6,346 tokens. The two largest —
`Planning a Coordinated Multi-Outfit Set` (1,693 tok) and `Seasonal Capsule Intake` (395 tok) — were
removed after verifying that `plan_outfit_set`'s description **and its per-argument schema docs**
carry the same content: `constraints` says "packing wants reuse maximized; an at-home work week wants
looks diversified", `location` says "slots inherit it unless they set their own", `plan_kind` says
"use 'trip' for destination packing even when the trip has a piece limit" — which is the
capsule/budget independence rule stated as an argument doc.

**The removal was reverted.** The bullets are not duplication with some behaviour attached; they are
duplication *interleaved* with unique behaviour, and the unique parts only surface one failing
assertion at a time:

- `Do NOT stall a multi-day plan with a weather question when no place is named` — a clarification
  rule, owned by nothing else
- the shoes-role contract in `Proposing Outfits` — "every outfit MUST include a shoes-role piece…
  do not use missing_gaps as a shoe substitute" is **not** in `propose_outfit`'s description
- `cover each stated occasion/use case as a separate proposed outfit` and
  `Do not collapse distinct stated needs into one generic list`

Also: the bullet is what makes the tool *reachable*. Its own test comment records that before it
existed "the tool was live but unreachable — nothing in the prompt named it." Deleting the pointer
risks recreating that, and a tool nobody calls describes itself to no one.

**So part A needs a clause inventory, not bulk deletion.** Estimated prize is real — most of
~6,346 tokens — but it is not the mechanical win it looked like.

### Blast radius — which flows read this block

Checked 2026-08-20, because a clause that looks duplicated for freeform may be another flow's only
copy. **It is narrower than it looks: every other named flow has its own system prompt.**

| Flow | Its prompt | Reads this block? |
|---|---|---|
| Selected piece builder | `STYLE_SELECTED_ITEM_SYSTEM` | no |
| Visual composer | `OUTFIT_COMPOSER_SYSTEM`, `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` | no |
| Capsule | `capsuleRosterSelectionSystemPrompt`, `capsulePlanCompositionSystemPrompt`, `capsuleExpansionSystemPrompt` | no |
| Outfit critique | `COMPARE_OUTFITS_SYSTEM`, `VISUAL_WARDROBE_CRITIC_SYSTEM`, `criticSystem` | no |
| Tagger / importer / feedback synthesis | `TAG_PIECE_SYSTEM`, `EXTRACT_PIECES_SYSTEM`, `FEEDBACK_SYNTHESIS_SYSTEM` | no |
| **Freeform stylist** | `STYLIST_SYSTEM` | **yes** |
| **Freeform plan** (`plan_outfit_set`) | runs inside the freeform loop | **yes** |

The freeform plan flow is the one most at risk from a careless trim, not an innocent bystander: it is
the flow whose 6,800-character bullet Part A is about.

**Two prerequisites before the inventory starts.**

1. **`/evaluate-piece` inherits `STYLIST_SYSTEM` by omission.** `routes/ai.js` calls
   `askStylist({ maxTokens, messages })` with no `system`, so it silently picks up the default — the
   whole stylist manual, including outfit-proposal rules, slot semantics and capsule budgets, to
   evaluate one piece. Every other call site passes an explicit prompt. Decide whether that is
   deliberate; if not, give it a narrow prompt and it leaves Part A's blast radius entirely.
2. **The text is duplicated inside `prompts.js`.** `Seasonal Capsule Intake` appears in
   `stylistSystemTemplate` once and `currentStylistSystemTemplate` twice. Resolve which template is
   live before removing anything, or an edit to one leaves the others stale.

### Where owner rules actually belong

The global absolutes removed in part C were doing a job that four real channels already do, and doing
it for every user at once. Ownership per `feedback-and-memory-map.md`:

| Channel | Store | Authority | Right home for |
|---|---|---|---|
| A · tagged garment truth | `pieces.tuck_behavior` and siblings | **hard gate** in composition | the physical general case — what my part-C replacement text now points at |
| B · per-garment user memory | `pieces.styling_rules_learned` | renders as `RULES (authoritative)`, overrides generic principles | "*this* silk top will not hold a tuck" |
| E · standing prose rules | `stylist_feedback` owner-rule rows | relevance-selected **prompt** authority, with a validated applicability envelope | "I do not tuck silk" — and the envelope takes **`materials:[silk]`**, conjunctive with context |
| — · structured hard constraint | `owner_constraints` | **hard authority**, hard-blocks and emits its constraint ID in suppression reasons | standing constraints whose context is occasion / activity / season / weather |

**The point:** "silk does not tuck" is a channel-E statement — a standing preference over a material
class — and channel E is *per user* and takes a `materials` selector. Writing it into the shared
prompt made one user's rule into everyone's physics. Channel C (`occasion_exclusions`) is explicitly
not the home: the map states its "only axis is occasion — it cannot express season, weather or
material." `owner_constraints` is also a poor fit for tucking, since its context axis is
occasion/activity/season/weather rather than a wear mechanic.

So a clause in this block that reads like an owner preference has a destination, not just a deletion:
per-piece to B, per-material or per-context to E, and the physical case stays in A where the gates
already read it.

### The method: assign every clause exactly one disposition

Work clause by clause, not bullet by bullet. The bullets are single 6,800-character lines with
duplication and unique behaviour braided together mid-sentence; there is no line boundary to cut on.

| # | Disposition | Action |
|---|---|---|
| 1 | Already owned by a tool description or schema | remove from the prompt |
| 2 | Should move to a tool description or schema | move, then remove |
| 3 | Prompt-owned routing or clarification policy | keep |
| 4 | Stale or contradictory | remove as a correctness fix, not a token one |
| 5 | Unknown — needs live failure history | leave until the history is found |

Category 5 is not a parking space for anything awkward. Several of these clauses exist because a
model once failed confidently, and `git log` plus the surrounding test comments usually say which
failure. Find the reason before deciding.

### The reachability principle

**A tool description cannot make a tool reachable if the model never gets a routing pointer to it.**
Argument semantics belong in the schema; "when to reach for this tool" may still need one compact
line in the prompt. `plan_outfit_set`'s own test comment records the precedent: before the prompt
named it, "the tool was live but unreachable". So a clause can be category 1 for its *details* and
category 3 for its *pointer* — the inventory should split those rather than forcing one verdict.

### Seed inventory — clauses with evidence already gathered

From the reverted attempt. Everything here was verified against the current tool surface, so the
next pass starts from these rather than re-deriving them.

| Clause | Disposition | Evidence |
|---|---|---|
| Slot decomposition ("YOU decompose the request into slots") | **1** | verbatim in `plan_outfit_set`'s description |
| Constraint vocabulary (`reuse`, `no_repeat`, `allow_repeat`) | **1** | `constraints` schema doc: "packing wants reuse maximized; an at-home work week wants looks diversified" |
| Per-slot forecast inheritance | **1** | `location` schema doc: "slots inherit it unless they set their own" |
| Capsule intent vs piece budget independence | **1** | `plan_kind` schema doc: "use 'trip' for destination packing even when the trip has a piece limit" |
| Shoes-role contract ("every outfit MUST include a shoes-role piece… not `missing_gaps` as a shoe substitute") | **2** → `propose_outfit` | checked: absent from that description |
| "Do NOT stall a multi-day plan with a weather question when no place is named" | **3** | clarification policy; owned by nothing else |
| "Cover each stated occasion/use case as a separate proposed outfit" | **3** | cross-tool coverage policy |
| One-line pointer to `plan_outfit_set` for multi-use-case requests | **3** | reachability; see above |
| "Do not call `generate_outfits` for ordinary styling advice" | **4** | **done** — contradicted bounded multi-look; fixed 2026-08-20 |

Unstarted: the remaining ~12 tool-naming bullets, and the `Proposing Outfits` line beyond its shoes
clause.

One correctness fix from that pass was kept: `Do not call 'generate_outfits' for ordinary styling
advice` contradicted the shipped architecture, where bounded multi-look routes an ordinary
"what should I wear?" *to* `generate_outfits`. The cached prompt was telling the model the opposite of
its tool description and its own turn controller.

### Part B — not started

Needs a stated bet per line: name the behaviour you expect the model to preserve unaided, rather than
trusting a reader's sense of what is obvious.

## Lever 3 — model tiering · SPECIFIED, POSTPONED BY OWNER

Everything runs on `claude-sonnet-4-6`. The pricing table already knows Haiku at a third of the cost,
and `askStylistStructuredWithUsage` already accepts a `model` parameter that nothing passes.

- **The execution router is the obvious candidate.** It is a pure classification, sees no wardrobe,
  writes no prose, and runs on essentially every turn.
- **Anything that writes styling prose or chooses garments stays on Sonnet until measured.** That is
  where judgment lives, and cheapening it is how a quality regression arrives quietly.

Postponed deliberately, not forgotten. Revisit only with a quality comparison, not a cost argument.

## Lever 4 — the volatile block · EXAMINED 2026-08-20, DECLINED

Audited line by line across six turns varying only turn-level inputs (mode, question, date, session,
weather) with the wardrobe held constant, since the prefix is already per-wardrobe.

| Portion of the ~2,844-token block | Tokens | Verdict |
|---|---:|---|
| Varies per turn (date, turn mode, turn directive, thread state, bounded exception) | ~550 | must stay below |
| Stable but **user data** — feedback memory, saved corrections | ~1,158 | **must stay below** |
| Stable **policy** text | ~1,400 | the only cacheable part |

**The trap this audit exists to record:** "stable across turns" is not "safe to cache." Feedback
memory reads as perfectly stable turn to turn, and it is the single most tempting block to move —
but it changes whenever the user rates an outfit, and above the breakpoint each rating would
invalidate the entire ~35k prefix. Caching it would cost far more than the full-price reads it saves.

### Why it was declined

Moving the ~1,400 cacheable tokens is worth:

| Thread length | Now | Cached | Saving |
|---|---:|---:|---:|
| 2 turns | $0.0084 | $0.0057 | $0.0027 |
| 3 turns | $0.0126 | $0.0061 | $0.0065 |
| 5 turns | $0.0210 | $0.0069 | $0.0141 |

That is **~2% of a full-stylist turn** ($0.15–$0.21), and it touches nothing else: compact profiles
never send this block at all, so the cheap paths are unaffected.

Against that, the failure mode is asymmetric. Any line moved above the breakpoint that turns out to
vary — because it is conditional on an input the six probes held constant — invalidates ~35k tokens
of prefix rather than saving 1,400. A 2% prize with a 25× downside on a mistake is a bad trade, and
the restructuring required is not trivial: the volatile array interleaves conditional and
unconditional strings.

**Do not re-propose without new pricing or a much larger volatile block.** The audit is the
deliverable; the numbers above are why the answer is no. If the block grows substantially — for
instance if a future change moves more policy text down here — re-run
`scratch/volatile-audit` reasoning before assuming the answer is still no.

One caveat on the figures: the policy/user-data classifier is approximate — two `catalog_like`
feedback lines were counted as policy, so the genuinely cacheable share is slightly under 1,400.

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
