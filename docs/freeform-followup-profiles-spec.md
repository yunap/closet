# Freeform follow-up execution profiles

**Status:** all ten slices implemented behind flags; measured rollout in progress — 2026-08-19
**Authority:** extends `freeform-bounded-execution-spec.md` and `freeform-rearchitecture-handoff.md`

## Objective

Reduce the cost of freeform requests that do not require whole-wardrobe visual composition while
preserving the architecture's central division: a model owns intent and advice; code owns garment
truth, identifiers, weather physics, scope, and bounded failure.

This spec covers ten independently shippable slices, ordered by implementation effort and risk. It
does not change the philosophy of wardrobe-aware chat.

## Baseline

The accepted bounded multi-look path handles fresh same-context outfit requests in two model calls,
but all explanations and text-only requests still fall through to the full stylist payload. That
payload includes the stable wardrobe manifest and general tool catalog even when the answer concerns
only two existing cards, one garment fact, or no owned garment at all.

The latest accepted live runs used roughly 32–33k cache-creation tokens for the photograph-aware
composer. Compact text profiles are not expected to eliminate that cost for composition; they avoid
paying it on turns that do not need composition.

## Slice 1 — provider-key test hermeticity

Add a runtime fail-closed boundary plus a structural test analogous to the database hermeticity
guard. Under `NODE_ENV=test`, every provider entry point rejects network access even if dotenv or
the operator environment supplied a real key. Test fixtures still short-circuit through the mock
response hook before this boundary. Only a deliberately commissioned provider integration test may
set `WARDROBE_ALLOW_TEST_PROVIDER_NETWORK=true`; the ordinary suite never does. The dedicated
API-key behavior test may still use fake keys to test resolution without constructing a request.

Acceptance:

- a provider-reaching test that misses its mock fails with `no_api_key` before request construction;
- the ordinary `npm test` command cannot opt into provider network access;
- no runtime provider behavior changes.

## Slice 2 — resolved weather physics in thread state

Persist resolved weather independently from human-facing `season` and `weather` strings:

```json
{
  "weather_profile": {
    "source": "live|stated|heuristic|unavailable",
    "high_f": 78,
    "low_f": 56,
    "is_hot": false,
    "is_cold": false,
    "is_extreme_heat": false
  }
}
```

On a follow-up, explicit weather stated in the new turn still wins. Otherwise the stored profile
owns physical hot/cold gates; composite display text such as `summer; mild weather; forecast high
78°F, low 56°F` cannot be reparsed into hot weather merely because it contains `summer`.

Acceptance:

- bounded state stores the normalized profile;
- payload restoration carries it separately from display season;
- a 78°F/56°F live profile remains non-hot on a follow-up without a new forecast;
- a follow-up that explicitly states different weather supersedes it.

## Slice 3 — existing-card explanation profile

Examples:

- “Why did you choose these shoes?”
- “Which option is warmer?”
- “Is the second one dressier?”

A compact model-owned router may select `existing_card_explanation` only when a current verified
outfit set exists and the request asks to explain, compare, or clarify it without changing pieces.
The answer model receives the current cards, rehydrated structured facts for their piece IDs,
established context, the Style Constitution, and bounded recent conversational context. It receives
no wardrobe-wide manifest, photographs, or composing tools.

Requests to replace, add, render, or restyle pieces fall back to the full stylist.

## Slice 4 — garment-fact/text-advice profile

Examples:

- “Can this blouse be tucked?”
- “Which of these jackets is warmer?”
- “Why isn’t this dress suitable for hiking?”

The profile is eligible only when code can resolve the subject unambiguously from an active piece,
current verified cards, or an exact unique wardrobe match. The answer model receives compact
structured truth for only those pieces plus applicable owner guidance and Style Constitution.
It may explain or compare; it cannot create outfit cards. Ambiguous identity or requests requiring
discovery fall back to the full stylist.

**Saved-visual amendment — 2026-08-19.** Garment mechanics cannot safely be reduced to tags alone:
fields may be missing, low-confidence, or wrong, while the app already owns direct hanger and worn
evidence. `compactGarmentVisualEvidence` therefore gives this profile the resolved pieces' saved worn
and hanger photographs, worn first, capped at four 640px low-detail images. A worn photograph that
clearly demonstrates the requested configuration is direct practical evidence and outranks a weak
or missing tag, but proves possibility only—not that the shown configuration is successful or
preferred. The model judges the visible result separately and cannot claim an unseen alternative
would look better. It must not infer tuckability from hem shape alone or ask the owner to upload a
photograph already supplied. This remains bounded—no wardrobe-wide roster or composing tools—and
`compactVisualImages` records how many images entered the answer call.

**Routing/fiber amendment — 2026-08-19.** `thread_1787120404670` asked whether an exact named top
looked good tucked, but the router still treated all visual-fit language as full-stylist work. It
paid three calls plus ~25k cache creation, then `view_pieces` guessed “cotton-blend” from photographs
although no stored fiber fact supported that claim. The router now receives a presence-only count of
saved-photo subjects and may select `garment_fact` for a resolved garment's visibly shown
wear-mechanics result. No identity or image enters the router. Both compact answers and
`view_pieces` define photographs as evidence for visible drape, bulk, texture and behavior—not exact
fiber composition. The absence of a stored viscose/modal fact is not recast as model disobedience;
the defect was claiming that photographs could fill it.

## Slice 5 — lightweight general styling conversation

Examples:

- “What does smart casual mean?”
- “How can an outfit feel less formal?”
- “What colors generally work with olive?”

This profile is for advice that does not claim to inspect or select the owner's garments. The answer
model receives the Style Constitution and the user's question, but no wardrobe rows, images, memory
stores, or tools. It must say when a wardrobe-specific answer would require looking at owned pieces.
Any ownership phrase (“my blouse”, “which of mine”), named garment requiring identification, outfit
request, image request, critique, packing/capsule/plan, or ambiguity falls back conservatively.

**Live quality amendment — 2026-08-19.** `thread_1787119133701` passed routing and cost—two
provider iterations, 2,530 input / 522 output tokens, no cache or wardrobe access—but failed the
quality threshold by turning common smart-casual signals into requirements: fitted/structured shape,
a structured layer/accessory/upgraded shoe, and a status-loaded “real bag,” while characterizing
casual as shapeless errand wear. General advice now presents several valid pathways, distinguishes
tendencies from requirements, treats garment signals as whole-outfit-dependent options, and cannot
denigrate casual dress or rank accessories by status-coded language.

### Exact wardrobe inventory profile — added 2026-08-19

The first tiered-discovery live test proved that an exact active-category-count question was
factually answerable from the identity index but still paid three provider iterations: execution
router, `declare_intent`, and full-stylist answer. Under the same compact-answer flag, the router may
now select `wardrobe_inventory` only for exact active inventory counts or a category breakdown. Code
queries and formats the active database counts and returns immediately; there is no answer-model
call, full stylist payload, tool catalog, or intent declaration. Questions asking whether coverage
is *enough*, what is missing, which pieces qualify, or any styling judgment remain `full_stylist`.

This is not a keyword pre-route: the existing model router owns the classification. Code owns only
the exact factual result after that decision. Acceptance requires one provider iteration, exact
agreement with the active database, and conservative fallback for judgment-bearing questions.

**Garment-fact voice amendment, 2026-08-19.** The corrected compact run
`thread_1787117547066` made the right judgment at low cost but opened with the internal enum
`tuck_behavior is tucks_anywhere (manual confidence)`. Compact facts may use field confidence for
reasoning but must translate it into natural stylist language. Field names, snake_case keys, enum
values, JSON/backticks and confidence labels are not user-facing unless the user explicitly asks to
inspect metadata. This is a presentation contract, not a change to the evidence hierarchy.

## Shared execution contract

1. The compact router classifies; it never writes advice.
2. Each selected profile makes at most one bounded answer call and then returns.
3. Compact profiles have no composing or mutation tools.
4. They may not invent garment facts or cite piece IDs outside their supplied scope.
5. Router failure, answer failure, ambiguous identity, or insufficient context falls through to the
   existing full stylist unchanged.
6. Usage for the router and answer call is persisted in the parent freeform run, with an explicit
   profile diagnostic and tool-sequence marker.
7. No paid live tests are run without owner approval. Provider-free fixtures must establish routing,
   payload scope, fallback behavior, and state precedence first.

## Slice 6 — bounded history for the full stylist

The remaining general tool loop currently receives every prior user/assistant text message even
though established context, resolved weather physics, and the current verified outfit set now have
server-owned structured homes. Bounded history is default-on since 2026-08-19 (flag removed): keep at most the
four most recent exchanges (eight messages), at most 12,000 characters in total, and at most 3,500
characters per message. Oversized individual messages retain their beginning and end with an
explicit omission marker. The duplicate current question is removed before applying the window.

This is a prose-history bound, not a memory deletion: current cards, established occasion/activity/
weather, active context, durable owner corrections, and the wardrobe manifest remain supplied by
their existing authoritative paths. No model-generated summary is introduced. Diagnostics persist
received/included message counts and removed character count, never conversation text.

Acceptance:

- flag off preserves the pre-existing history payload;
- flag on includes no more than eight prior messages or 12,000 characters;
- the current question appears exactly once and remains the final user turn;
- server-owned current cards and established context survive removal of old prose;
- the retained sequence starts on a user message when possible;
- history reduction is visible in generation-run diagnostics.

## Slice 7 — prompt and tool-schema ownership

Inventory every instruction duplicated across the stable system prompt, volatile controller tail,
and tool descriptions. Assign one byte-level owner for each rule before removing duplicates. Preserve
provider-cache prefix stability and prove prompt equivalence for every moved instruction. This slice
does not change routing, tool availability, or styling policy.

**First pass implemented 2026-08-19.** `docs/freeform-prompt-ownership.md` is the ownership table.
The volatile controller now carries one mode directive rather than two plus four unconditional
restatements. Tool descriptions own their local eligibility/arguments; the controller retains only
the cross-tool choice among serial composition, bounded same-context generation, multi-context
planning and existing-card revision. The stable prefix is deliberately unchanged.

## Slice 8 — deferred tool loading

Measure provider-native deferred tool loading against the cached full-tool baseline. It ships only
if total cost falls without increasing wrong-profile fallbacks, iterations, or tool-selection errors.
Compact profiles remain tool-free regardless. Provider support and cache behavior must be verified
before implementation; a smaller initial schema that later destroys a useful cache hit is not a win.

**Implemented behind flag 2026-08-19.** `docs/freeform-deferred-tools-spec.md` records the provider
decision and acceptance matrix. Anthropic Sonnet/Haiku/Opus 4.5+ receives BM25 tool search with five
eager and nine deferred client tools; unsupported/small catalogs and the OpenAI Chat Completions path
remain unchanged. Compatibility errors fall back once to the full catalog. This remains an
experiment until owner-approved live comparisons show a real total-cost win without tool misses.

## Slice 9 — bounded wardrobe discovery

**Owner-ratified and implemented behind flag 2026-08-19.** Preserve omniscience at identity and
discovery level, not at full-detail prompt level. `docs/freeform-tiered-discovery-spec.md` is the
implementation and acceptance contract. Every active ID/name/category plus a brief visual identity
remains in the prompt; full construction, fit and suitability truth is retrieved automatically from
the database for named-piece, composition and coverage needs. The lightweight index is never treated
as permission to trim detailed search rows. Current-wardrobe measurement reduced this block 72.4%
without dropping any of 251 active identities. Paid live validation remains owner-approved only.

## Slice 10 — measured rollout

Create an offline routing corpus spanning composition, follow-up explanation, garment facts, general
advice, corrections, photos, plans, and ambiguous requests. Then run a small owner-approved live A/B
set. Compare total/cache/input/output tokens, iterations, fallback rate, factual grounding, styling
specificity, conversational quality, and continuity. Enable each flag by default only after its own
quality and cost threshold passes; do not treat aggregate savings as permission for a weak profile.

**Offline corpus implemented 2026-08-19.** The 22-row permanent fixture at
`test/fixtures/freeform_execution_routing_corpus.json` spans all six profiles and ten request
classes, with correction, photo, plan, discovery and ambiguous cases conservatively assigned to the
full stylist. The hermetic test proves structured-call wiring and presence-only context for every
row; it deliberately does not pretend a mocked provider proves live semantic classification.
`freeform-measured-rollout.md` defines per-flag thresholds and a five-row, stop-on-first-failure live
matrix that reuses recorded comparisons where valid to protect the owner's API budget.

## Still out of scope for slices 1–6

- deterministic taste answers;
- lossy model-written conversation summaries;
- changing the accepted visual-composer roster or styling rules while measuring execution cost.

The deeper stable-prefix audit plus slices 9–10 remain later, separately measured phases.
