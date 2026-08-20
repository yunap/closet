# Freeform prompt-cache levers

**Status:** lever 1 implemented; lever 2 audited in full (part C done, part A swept and declined); lever 4
examined and declined; levers 3 and 5 specified. All 2026-08-20.
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
| **A · tool-mechanics duplication** | "call `propose_outfit` once per outfit", "use `plan_outfit_set` when…", capsule intake, re-rendering, storing corrections | *originally estimated as the largest share* — **the inventory falsified that**; see tranche 3. Most tool-naming bullets state turn policy and merely mention a tool |
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

1. ~~`/evaluate-piece` inherits `STYLIST_SYSTEM` by omission.~~ **RESOLVED 2026-08-20 (owner ruling:
   accidental, not deliberate).** It now passes `EVALUATE_PIECE_SYSTEM` — **502 tokens against
   10,377**, a 95% cut for that endpoint, and it leaves Part A's blast radius entirely.

   The prompt carries what the ruling specified: garment truth, evidence provenance, no hallucinated
   facts, owner/manual facts outranking inference, and answering the question asked. It carries no
   outfit-set policy, capsule rules, proposal mechanics or trip planning — and the call passes **no
   tools at all**, so those instructions were unreachable as well as irrelevant.

   Guarded by `a one-piece evaluation gets its own narrow prompt, not the stylist manual`, which
   asserts both halves and, source-side, that the route passes the prompt explicitly. That last
   assertion matters because **the bug was an omission**: the call works fine without the argument,
   which is exactly why it went unnoticed.
2. **The prompt is built in two layers, and the second one fails silently.** *(Corrected — this was
   first recorded here as "the text is duplicated". It is not duplication.)*
   `stylistSystemTemplate` holds the base text; `currentStylistSystemTemplate` applies **five
   `.replace()` patches** that supersede specific strings in it, and `STYLIST_SYSTEM` is the patched
   result. Verified: the old capsule wording is absent from the built prompt and the new wording
   present, so the patches do apply today.

   `String.replace` is a **silent no-op when its needle is not found.** Editing a base line that a
   patch targets does not error, does not fail a build, and quietly reverts that correction to the
   older wording. That is the single largest hazard standing between here and any clause-level edit,
   because the clause you edit and the clause that breaks are in different functions.

   Guarded by `every currentStylistSystemTemplate patch still finds its target`
   (`prompt_equivalence.test.js`), which parses the patch pairs out of the source rather than listing
   them — so a patch written tomorrow is covered the day it is written. Verified by editing a base
   line a patch targets and watching three tests fail.

### Where owner rules actually belong

The global absolutes removed in part C were doing a job that four real channels already do, and doing
it for every user at once. Ownership per `feedback-and-memory-map.md`:

| Channel | Store | Authority | Right home for |
|---|---|---|---|
| A · tagged garment truth | `pieces.tuck_behavior` and siblings | **hard gate** in composition | the physical general case — what my part-C replacement text now points at |
| B · per-garment user memory | `pieces.styling_rules_learned` | renders as `RULES (authoritative)`, overrides generic principles | "*this* silk top will not hold a tuck" |
| E · standing prose rules | `stylist_feedback` owner-rule rows | relevance-selected **prompt** authority, with a validated applicability envelope | "I do not tuck silk" — and the envelope takes **`materials:[silk]`**, conjunctive with context |
| — · structured hard constraint | `owner_constraints` | **hard authority**, hard-blocks and emits its constraint ID in suppression reasons | standing constraints whose context is occasion / activity / season / weather |

**Owner ruling, 2026-08-20 — channel E is the home for material-class rules.** "Silk does not tuck"
is a channel-E statement: a standing preference over a material class, stored as an owner-rule row
with an envelope like `materials: ["silk"]` and wording scoped to the mechanic — *"I don't like
tucking silk pieces"*, *"don't suggest tucking silk unless I ask"*. One garment instead goes to
per-piece `styling_rules_learned`; observed physical truth about one garment goes to that garment's
`tuck_behavior`.

Ruled out explicitly: `occasion_exclusions`, and `owner_constraints` unless a true wear-mechanic axis
is added to it later. Channel E is the right balance — per user, envelope-scoped, authoritative in
prose, **without pretending a material name equals physics**.

Channel E is *per user* and takes a `materials` selector. Writing it into the shared
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

### Inventory tranche 1 — `Proposing Outfits (default)` (3,592 chars, 17 clauses)

Split on sentence boundaries and checked clause by clause against the live tool surface.

| # | Clause | Disposition |
|---|---|---|
| 1 | propose each outfit via `propose_outfit`, prose around the calls | **1** — verbatim in the tool description |
| 2 | every outfit MUST include a shoes-role piece | **2 → `propose_outfit`** |
| 3 | shoe gap: say so plainly, don't use `missing_gaps` as a substitute | **2 → `propose_outfit`** |
| 4 | when to use `generate_outfits` vs `propose_outfit` | **3** — cross-tool routing (already corrected in part C) |
| 5 | a packing list is a secondary recap, never a replacement | **3** — output-shape policy, owned by nothing else |
| 6 | call `search_wardrobe` with `visual:true` before composing | **1** — the tool documents its visual mode |
| 7 | narrow each visual search by category/occasion/activity/weather | **1** — argument docs |
| 8 | a follow-up with a new need gets a fresh scoped search | **3** — turn policy, not an argument |
| 9 | sparse/imageless search → say what you can and cannot see | **3** — honesty policy; pairs with the no-hallucination rule |
| 10 | multi-occasion requests get one outfit per stated use case | **3** — coverage policy |
| 11 | do not collapse distinct needs into one generic list | **3** — same policy as 10 |
| 12 | honour `weatherFit` / `ruleFit` flags on results | **2 → `search_wardrobe`** — the flags are returned but their *semantics* are not documented |
| 13 | `compose` mode already filtered prohibited pieces; don't self-reject | **1** — documented on the `intent` argument |
| 14 | filtering is per-search, so scope each call to that outfit | **1** — argument docs |
| 15 | `intent:'explain'` to show and explain prohibited pieces | **1** — documented |
| 16 | in a multi-outfit set, treat assigned pieces as occupied | **3** — cross-outfit policy |
| 17 | if a correction needs a repeat, offer it as a tradeoff | **3** — same policy as 16 |

**Tally: 6 already owned (1), 3 should move (2), 8 stay (3).** Roughly a third of the line is
removable once clauses 2, 3 and 12 are moved to their tools — not the whole bullet, and not nothing.

**A false positive worth recording.** A first pass probed `propose_outfit`'s description for
`/shoes/i` and reported clause 2 as already covered. It is not: the description says "at most one
primary_top (or one dress), one primary_bottom, and one shoes" — a **cap**, not a requirement.
Deleting the clause on that evidence would have removed the rule that every outfit needs footwear.
Probe for the semantic, never for the noun.

### Inventory tranche 2 — anchors, rendering, corrections (5,583 chars across 6 bullets)

| Bullet | Clause | Disposition |
|---|---|---|
| **[5]** rendered card | roles enumerated (`primary_top`/`layer_top`/…) | **1** |
| | one `propose_outfit` call per outfit | **1** |
| | give the outfit a title and a "why it works" **in prose**, since the card shows the pieces | **3** — output-shape policy, absent from the tool |
| **[6]** precise garment naming | never offer generic placeholders ("a dark top", "a lightweight scarf"); name an owned garment for every slot | **3** — prose policy; absent from every tool |
| **[7]** anchor recomposition | `anchor:true` locks a piece the user asked to wear | **1** — documented on the argument |
| | compose *fresh* outfits around the anchor rather than substituting it into prior ones | **3** — turn policy |
| **[8]** top-layer anchors | `layer_top` role exists and means intentional layering | **1** |
| | find a plausible base underneath — a fitted/smooth `primary_top` or simple dress, unless notes say otherwise | **2 → `propose_outfit`** |
| **[15]** re-rendering | render/show an already-discussed outfit | **1** |
| | resolve plural references ("these", "all of them") against the Current outfit set | **3** — thread-state policy |
| **[18]** storing corrections | `piece_id` for a single garment; `guidance_applicability` envelope; `universal` only when meant | **1, 1, 1 — fully covered** |

**[18] is the first bullet removable in full** (855 chars): every clause is documented on
`store_user_correction`'s arguments, including the applicability envelope and the caution about
`universal`.

**Running tally across tranches 1–2:** 12 clauses already owned, 4 to move, 13 staying.

### Inventory tranche 3 — clarification, pushback, layering (7,450 chars across 6 bullets)

| Bullet | Clause | Disposition |
|---|---|---|
| **[9]** proactive alternatives | on a stated objection, search immediately for named replacements | **3** — absent from `search_wardrobe`; turn policy |
| **[13]** current outfit set | maintain the set, one card per entry, stable labels, revise in place | **3** — `label` is only "Creative outfit title"; set maintenance is prompt policy |
| **[17]** pushback on a garment | re-read that garment's own record before defending the choice | **3** — the *mechanism* is `get_garment_details`; the *policy* of using it on pushback is not in any tool |
| **[19]** destination & weather | a named place resolves weather live instead of asking | **1** — documented on `search_wardrobe`'s `location` |
| | when a destination is required, and when never to ask about weather | **3** — clarification policy, the bulk of these 2,221 chars |
| **[23]** no garment hallucination | verify existence before suggesting; never invent a garment | **D — keep**; overlaps the VERIFICATION CONTRACT elsewhere in the same cached block, so a *consolidation* candidate rather than a move |
| **[26]** layering logic | a warm layer must be real outerwear, not a tank/tee/dress | **3** — the role enum merely lists `outerwear`; the rule is absent |

**Running tally, tranches 1–3: 13 clauses already owned, 4 to move, 18 staying.**

### The estimate was wrong — Part A's prize is much smaller than "the largest share"

The category table above calls A "the largest share" of ~6,346 tokens. Three tranches in, that looks
wrong. Of roughly 16,600 characters audited, about **2,600 (~650 tokens) are actually removable** —
around 16%, not most.

The reason is now obvious in hindsight: **a bullet that names a tool is not thereby about the tool.**
Most of these mention `search_wardrobe` or `propose_outfit` in passing while stating turn policy —
when to search again, when to ask a clarifying question, what to re-read before defending a choice,
what counts as a layer. Tools own *mechanism*; the prompt owns *when and whether*. The bullets are
mostly the second kind.

Extrapolated across the remaining bullets, Part A is plausibly worth **1,000–1,500 tokens**, against
a cached prefix of 27,736. That is real but small, and it should be weighed against the risk
demonstrated below before anyone spends a session on it.

**This is what the inventory was for.** The bulk removal would have been justified by an estimate the
inventory has now falsified.

### Method note — four false positives, one cause

Every one came from probing for a **word** rather than a **meaning**, and each would have deleted
live behaviour with a green suite:

| Probe | What matched | What the clause actually said |
|---|---|---|
| `/shoes/i` on `propose_outfit` | "at most one shoes" — a **cap** | every outfit must **include** one |
| `/base layer/` on `propose_outfit` | the `role` argument's "a base layer under a sheer top" — **role semantics** | which garment to **choose** as that base |
| `/label/` on `propose_outfit` | `label`: "Creative outfit title" | maintain a **Current outfit set** with stable per-entry labels |
| `/verif/` on the volatile block | "verified search + propose path" in the bounded exception | **never invent a garment**; verify existence first |

**Print the matching context and read it; never trust the boolean.** A probe answers "does this
string appear"; the question is always "does the tool actually say this".

### Inventory tranche 4 — the remainder, and the sweep is complete

80 remaining lines, 12,807 characters. Only two still name a tool, and both are dialogue examples.

| Section | Size | Disposition |
|---|---|---|
| Conversational styling examples (4 worked dialogues, incl. the 2 tool-naming lines) | 1,412 chars / ~353 tok | **B** — teaches one behaviour: don't ask for weather when a place is named. The `location` argument documents the mechanism; the examples exist because the model asked anyway. **Bet before trimming:** that it now resolves a named place without being shown a transcript |
| Scarcity honesty [14] | 1,024 | **D — keep.** App-specific: what to say when the wardrobe cannot fill a slot without violating the brief |
| Trip scope / material override / context persistence [20–22] | 1,895 | **3** — clarification and context policy, owned by nothing else |
| Established styling context [16] | 443 | **3** — overlaps THREAD STATE in the volatile block; consolidation candidate, and the *cached* copy is the cheap one to keep |
| Occasion realism [24], professional context [25] | 989 | **B** — "hikes need durable shoes", "office defaults to quiet and structured". The clearest generic-knowledge candidates in the block |
| Aesthetic neutrality: don't treat style lanes as bad; the drift failure modes | ~400 | **D — keep.** This is the actual taste guardrail |
| Avoid-words / voice list | 569 | **D — keep.** House voice; a model will not infer "never say elevated, cohesive, visual interest" |
| Hard constraints, photo visibility, evidence provenance, tuck compatibility, pattern mixing, earned wisdom | 5,509 / ~1,377 tok | **D — keep.** Verification, honesty and provenance contracts, plus the per-piece override mechanism that part C's demotions depend on |
| Correcting gracefully [4] | 276 | **B** — generic conversational competence |

### Final tally — the sweep, complete

| Disposition | Clauses | Approx. chars |
|---|---:|---:|
| **1** · already owned by a tool description or schema | 13 | ~2,600 |
| **2** · should move to a tool | 4 | ~600 |
| **3** · prompt-owned routing / clarification policy | 18 | ~6,900 |
| **B** · generic knowledge, trimmable with a stated bet | ~7 lines | ~2,700 |
| **D** · app-specific, keep | — | ~8,000 |

**Removable without a behavioural bet: ~2,600 characters, roughly 650 tokens — 2.3% of the cached
prefix.** Adding every category-B trim, on the bet that a current model no longer needs to be told
that offices are quiet or that hikes need real shoes, reaches perhaps 1,300 tokens, 4.7%.

### Verdict — Part A is declined as a token exercise, with two carve-outs

At ~650 tokens for the safe subset, four near-misses across four tranches, and each removal needing
its own semantic check, the token case does not justify the risk. **Declined on the same basis as
lever 4: measured, and the number is too small.**

Two pieces were done standalone, as correctness rather than cost:

1. **The four category-2 clauses moved to their tools** — the shoes-role requirement and shoe-gap
   behaviour and the base-under-overlay guidance to `propose_outfit`, the `weatherFit` guidance to
   `search_wardrobe`. Each had lived *only* in a prompt other flows do not read, so a composer
   calling `propose_outfit` never learned that an outfit needs shoes. The tool had capped an outfit
   at one shoes piece without ever requiring one.
2. **The `Storing User Corrections` bullet removed** (855 chars) — the one bullet the inventory found
   fully covered, applicability envelope included.

Net 1,545 characters out of the cached prompt, and four contracts now readable by every caller of
those tools rather than by one flow.

**A self-inflicted duplication, caught in verification.** The first version of the `search_wardrobe`
addition also restated the `preferred`/`discouraged`/`unknown` tier semantics — which are clause 13,
a category-1 clause deliberately left in the prompt. That would have created in the tool exactly the
duplication this exercise exists to remove. The addition was trimmed to carry only what the removed
clause 12 actually said. **When moving a clause, move that clause — not the paragraph around it.**

Category B stays untouched until someone wants to state the bet per line, per the standing rule that
several of these exist because a model once face-planted confidently.
