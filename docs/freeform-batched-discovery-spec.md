# Freeform batched discovery

**Status:** implemented 2026-08-19 by promoting `search_wardrobe`, not by adding a primitive
**Authority:** succeeds the deleted `qualified_coverage` profile; inherits its acceptance cases.
Supersedes the qualified-coverage sections of `freeform-tiered-discovery-spec.md`.

## Why this exists

Tiered discovery preserved wardrobe reach and did not bound the composition loop. The gallery
request in `thread_1787128902650` produced a good, wardrobe-aware outfit — the model broadened after
a zero-result anchor search, found the sparse piece, and submitted one valid structured outfit — but
took nine provider iterations and five sequential searches.

The failure is mechanical, not aesthetic: nine sequential round-trips to produce one outfit. Each
iteration re-reads the cached prefix, and the turn spent 60,532 cache-creation and 212,147 cache-read
tokens for a single card.

Be careful about *why* that is expensive — the first three explanations tried here were all wrong.
See "Measured cache shape" below for what the recorded data actually supports. In particular, do not
repeat the claim that iteration count is the dominant cost driver: iterations drive cache reads,
which are only 13.2% of recorded spend. Reducing round-trips is still the right goal for batched
discovery, but justify it by latency and by the compounding of *writes* across turns, not by an
iteration-cost model that the data does not support.

## The primitive — `search_wardrobe`, promoted

**No new tool was built.** `search_wardrobe` already accepted `category` as an array, built
`category IN (...)`, and budgeted thumbnails *per category rather than per call* — with a comment
already in the code saying batching three category searches into one must not hand the model a third
of the photos. The multi-category batch existed; nothing told the model to use it.

The gallery run's five sequential searches were therefore never five *necessary* searches. Three
things were missing, none of them a primitive:

| Gap | Fix |
|---|---|
| Batching was never taught | the tool description now says `category` takes an array and that the image budget is per category, so batching costs no photographs |
| No automatic broadening | a request that finds nothing climbs a fixed relaxation ladder in code instead of costing a round-trip |
| No shortfall reporting | a `retrieval` entry states what was relaxed and which categories are genuinely empty |

This follows the precedent set by bounded multi-look, which refused to "build a second composer" and
promoted `generate_outfits` instead. Duplicating `search_wardrobe` would have meant re-implementing
its filters, gating, weather resolution, truth rows and image budget, then maintaining both.

Target shape for an ordinary composition turn:

1. router
2. one batched wardrobe search
3. optionally one composition/submission or correction call

Code owns completeness, IDs, physical eligibility and truthful uncertainty. The model owns
contextual, aesthetic and stylistic judgment over the bounded result. This is the division that made
bounded multi-look work, applied to discovery.

### The relaxation ladder

Broadening is where code could quietly become the stylist, so the order is fixed, mechanical, and
reported rather than applied silently:

1. **free text** (`query`) — a name or phrase that matched nothing is likeliest to be too narrow
2. **soft descriptive filters** — `color`, `pattern_type`, `silhouette`, `fabric_weight`,
   `fabric_category`, `neckline`: how a piece looks, not what it is or whether it is allowed
3. **occasion tag confidence** — last, and only as tag confidence

**Never relaxed at any rung: category, active status, and owner or request exclusions.** Those are
truth, not preference; relaxing them would let code overrule the owner to avoid an empty list.

A request that found something is never second-guessed — "enough" is the stylist's judgment, not
code's. Only an empty result triggers a rung.

The result carries `requestedCategories`, `returnedByCategory`, `shortfalls`, `broadened`,
`relaxedFilters` and a plain-language `note` — **and only when there is a compromise to report.** A
search that found what it asked for returns exactly the piece list it always did, so the 37 existing
callers see no shape change. That is what kept this a promotion rather than a breaking API change.

Two properties worth keeping: internal re-entry does not inflate `searchCalls` (one search the model
made stays one search recorded), and a narrow query that returned nothing is still recorded in
`zeroResultQueries` even when broadening then finds other pieces — otherwise the answer could
describe a garment the wardrobe does not have, which is the failure that guard exists for.

### Why this is worth doing — corrected justification

Not primarily cost. Iterations drive cache *reads*, 13.2% of recorded spend; collapsing nine
iterations to about three saves roughly 20% on a composition turn, which is real but secondary.

The case is **latency** — nine sequential round-trips is a long wait for one card — and
**consistency**: every extra step is another chance to drift, and the sparse run leaked search
narration, duplicated its own card and contradicted itself about a piece it never used.

## Coverage is a use case, not an architecture

Coverage remains a product capability. `qualified_coverage` as a *separate execution architecture* is
abandoned — five versions each moved the same problem rather than solving it:

| Version | Failure |
|---|---|
| Full stylist | expensive and non-exhaustive |
| Census plus selected photographs | visually anchored; unpictured candidates dropped |
| Text census plus visual refinement | still incomplete, and more expensive than the single judge |
| Strong deterministic constraints | trends toward an expanding rules engine |
| Loose model judgment | misses owner-valid contextual options |

An arbitrary coverage question combines physical fact, owner experience, missing or wrong metadata,
visual judgment, contextual styling judgment, and quantity/reuse requirements. That is the whole
stylist problem. A separate generic coverage pipeline becomes a second stylist architecture.

Coverage questions therefore route to `full_stylist` until they can be asked of the batched
primitive: request all relevant candidates and evidence in one operation, let the stylist judge
contextual qualification over that bounded result.

## Inherited acceptance cases

These were learned from paid live calls. They are requirements for the batched implementation and
must become tests when it exists — they are not prose principles.

1. **Unpictured candidates cannot become invisible.** A candidate without a saved photograph stays in
   scope through every stage. (`thread_1787127928718` discussed only the four visually sampled shoes;
   `thread_1787128659041` dropped deserving candidates before refinement.)
2. **Contextual qualities cannot be reduced to enum equality.** "Dressy" is model judgment about the
   garment in the requested use, not equality against `formality`, `occasions` or a style label.
3. **Latent performance requires evidence for that exact dimension.** Waterproofing, breathability,
   comfort and durability need same-dimension evidence. An explicit weight fact cannot authorize a
   visual-only claim about weather performance.
4. **Duration alone does not imply one garment per day.** A week does not mean seven pieces. Minimum
   quantity is one unless the request states simultaneous use, rotation, maintenance, drying or
   backup.
5. **Visual evidence cannot prove waterproofing or comfort.** Visible utility hardware is not
   confirmed rain performance. Purpose-built visual design may establish function where metadata is
   weak; material alone (leather, cotton, twill, nylon) never proves weather protection.
6. **Owner-confirmed facts outrank visual inference.** Provenance order: explicit/owner fact > clear
   observation > provisional inference > unknown. Inference may never silently become verified fact.
7. **Final prose exposes no machinery.** No IDs, database field names, enum syntax, evidence labels,
   confidence values, visible self-correction, or truncated reasoning.

### Status of each case — 2026-08-19

They were written as coverage-judge contracts. `qualified_coverage` is gone and coverage now routes
to `full_stylist`, so each landed in a different place: retrieval enforces some mechanically, and the
rest became general reasoning rules in the stylist prompt. **Their deletion alongside the profile was
a real regression** — the arc paid live calls to learn them, and for a period coverage questions
reached the full stylist with none of them.

| # | Case | Where it now lives |
|---|---|---|
| 1 | Unpictured candidates stay visible | **Enforced.** The visual cap limits thumbnails, never rows; tested directly, plus a guard that the budget stays per category |
| 2 | Contextual qualities are not enum equality | **Prompt rule.** Retrieval was never the offender — `pieceOccasionCompatible` already passes untagged pieces and uses an adjacency map, not equality |
| 3 | Latent performance needs same-dimension evidence | **Prompt rule**, stated generally |
| 4 | Duration does not multiply quantity | **Prompt rule**, stated generally |
| 5 | Sight cannot prove waterproofing or comfort | **Prompt rule**, folded into 3 |
| 6 | Owner-confirmed facts outrank inference | **Prompt rule** — the provenance ladder |
| 7 | Final prose exposes no machinery | **Enforced.** `applyAcceptedCardAuthority`, extended to cover the broadening report this work introduced |

The prompt rules sit in `STYLIST_SYSTEM` under `EVIDENCE PROVENANCE`, above the tuck rule, which is
one instance of the same authority. They are declared as an explicit delta in
`prompt_equivalence.test.js` — that fixture is a byte-level ratchet on the owner's prompts, so any
future edit to them has to be stated rather than absorbed.

Cases 3–6 are model behaviour and cannot be asserted offline. They remain the live-validation set if
coverage is ever measured again.

### The known shoe case

`thread_1787126412249` found only two elevated-labelled flats and called both unverified, while two
pieces with owner-confirmed medium walk support could participate in polished dinner outfits, and a
third was contextually plausible.

Express this as a **held-out fixture wardrobe keyed on garment properties, never on those piece
IDs.** The literal IDs are one owner's wardrobe: asserting them would fail the hermeticity guard
(`test/hermeticity_guard.test.js`), and encoding them in production logic would violate the standing
ruling that owner-specific facts must not become shipped platform rules. The spec's own
wardrobe-independence clause already requires a held-out multi-wardrobe recall test.

The fixture needs shoes that are:

- owner-confirmed for medium walk support, **without** an elevated/dressy formality label → must
  remain eligible and be discussed;
- contextually plausible for a polished use without confirmation on either dimension → must be
  surfaced as plausible, not silently dropped;
- labelled dressy but unverified on the latent dimension → must not be promoted to verified.

Acceptance: no garment-kind-, occasion- or category-specific branch may exist in production logic to
produce this result.

## Measured cache shape — 2026-08-19

Three cost hypotheses were tested against the 102 recorded turns in `freeform_generation_runs` and
against offline block instrumentation. Two died; recording all three so they are not re-proposed.

| Hypothesis | Verdict |
|---|---|
| Iteration count dominates | **No.** Iterations drive cache *reads* — 13.2% of spend |
| Cold prefix writes / TTL expiry between turns | **No.** Only 12.7% of cache-bearing turns show zero read |
| The moving cache breakpoint duplicates writes | **No.** The breakpoint moves correctly; within-turn growth is append-only |
| **Cross-turn message-prefix invalidation** | **Confirmed by instrumentation** |

Recorded spend across 102 turns: **~$27.35**, averaging **$0.2682/turn** — cache write 72.1%, cache
read 13.2%, output 10.1%, uncached input 4.6%.

**What was wrong.** The stable system prefix is 27,350 tokens and byte-identical across turns, so it
caches correctly. The *message array* did not: the current turn's user message carried a
`Today is …` line that browser history never replays, so message 0 differed on every follow-up.
Anthropic matches cache on exact prefix, so one difference at index 0 invalidated the entire message
array, and every turn rewrote the conversation instead of reading it.

The bounded-history live test is the clean example: 43,085 created / 42,960 read / **4 uncached input
tokens**. Iteration 1 rewrote the conversation prefix; iteration 2 reused what iteration 1 had just
written. Within-turn caching was working extremely well. The waste was entirely cross-turn.

**Fixed** by removing the duplicate date from the user turn — it already sits in the volatile system
half with its usage instruction, so nothing is lost. Guarded by
`the message array stays a cacheable prefix across turns until the history window slides` in
`freeform_observability.test.js`.

### The bounded-history interaction

Normalization does not buy unlimited reuse. Once the history window is full, every new turn drops the
oldest exchange, message 0 changes again, and append-only growth necessarily ends. Both are still
worth having, for different reasons:

- **Normalization** removes unnecessary misses in short and not-yet-sliding conversations.
- **Bounded history** caps the worst-case size of a rewrite when a miss does occur.
- **Structured thread state** keeps cards and durable context outside the prose window entirely, so
  bounding prose does not lose them.

The test asserts the tradeoff rather than assuming it: a slid window is expected to change message 0,
and that is recorded as accepted behaviour, not a regression.

**Design option not yet taken:** step the window instead of sliding it. Dropping the oldest exchange
every turn breaks the prefix every turn; dropping N exchanges every N turns keeps the prefix stable
between steps, at the cost of a window that varies between N and 2N messages. That converts "miss
every turn" into "miss every Nth turn" and needs no new model call. Worth measuring before batched
discovery fixes the message shape for other reasons.

### Live confirmation — `thread_1787128902650`, 2026-08-19

Two consecutive follow-ups on one thread. The first turn after the change is necessarily cold; the
second is the measurement.

| Metric | First follow-up | Second follow-up |
|---|---:|---:|
| Cache creation | 43,191 | **4,730** |
| Cache read | 43,065 | 80,220 |
| Uncached input | 4 | 4 |
| Provider iterations | 2 | 2 |
| Searches / proposals | 0 | 0 |

**Cache creation fell 89.0%.** Priced at the repo's own table, cache cost per follow-up turn goes
**$0.1749 → $0.0418, a 76.1% reduction** — against a recorded baseline of $0.2682/turn across 102
turns, of which cache write was 72.1%.

This settles four things:

- Removing the duplicated date restored the cross-turn prefix.
- **The residual uncertainty is resolved:** Anthropic does treat the plain string and the single
  text-block representation compatibly for caching. No further normalisation of wire shape is needed.
- The second turn reused both the previous turn's prefix and the first iteration's extension.
- No sliding occurred — history grew from two to four messages with zero characters removed — so this
  measures the pre-slide case the fix targets. The post-slide case remains the accepted tradeoff.

Bounded history is proven for both trimming and pre-slide cache reuse. `4` uncached input tokens on
both turns confirms within-turn caching was already working; the waste was entirely cross-turn.

### Closing prose drifting from the accepted card

The second follow-up called the loafers the grounding finishing piece while the original card's prose
called the earrings its "single finishing detail." The full exchange was present, so this is not a
history-truncation failure — it is the outer model re-describing an accepted card and drifting from
it. The same pattern produced the sparse run's duplicated composition and its self-contradiction
about piece 359.

**Acceptance case for batched discovery:** closing prose must not re-describe a card the turn already
accepted. Either say nothing about its contents or render from the accepted card deterministically —
the precedent is `boundedAtomicMultiLookResponse`, which generates the closing line in code rather
than letting the model narrate a card it has already submitted.

## Live findings — 2026-08-19/20

Three owner-approved turns on the real wardrobe, measured with
`scratch/measure_freeform_turns.js`.

### Ordinary composition never reaches this work

`thread_1787188241277` — "I have a gallery opening tonight, what should I wear?" — routed to
`bounded_multi` and produced two looks in **2 iterations with zero searches, $0.1613**. Two
follow-ups on the same thread took `compact_existing_card_explanation` at $0.0175 and $0.0211; one
correctly asked *which* card rather than guessing across two. The closing line was the
code-generated bounded ending, so there was no model narration to drift from the cards.

That is the already-merged bounded architecture working, **not this work**. Batching and broadening
were never exercised, because no search happened.

The distinction is in the request shape, and the router is right about it:

| Request | Route | Iterations |
|---|---|---:|
| "what should I wear?" | `bounded_multi` | 2, no searches |
| "Build me **one** outfit around a polished sleeveless top…" (`thread_1787128902650`) | `full_stylist` | 9, five searches |

Batching therefore only applies to the one/best/anchored path. **Whether the model actually batches
is still unverified**, and deliberately so: it is a latency and consistency change, not a cost one,
and paying for a turn to measure it is a poor trade. `tool_sequence` and `search_calls` record it on
every turn, so the next naturally occurring one/best request answers it for free. If several
sequential `search_wardrobe` entries still appear, the tool-description change was inert and the
instruction should become structural instead.

### Coverage got more expensive, and the recorded miss survived

`thread_1787188412205` — "Do I have enough dressy flats I can actually walk in for a week of city
dinners?" — reached `full_stylist` (`wardrobe_coverage;search_wardrobe;view_pieces`), **4 iterations,
$0.2138**, against the deleted profile's $0.0708–$0.1012. Removing `qualified_coverage` made coverage
**two to three times more expensive**. The direction was predicted; this is the number.

The cost is 4 iterations re-reading ~125k cached tokens — which is precisely what round-trip
reduction targets. **The coverage regression is an argument for finishing this work, not against it.**

Answer quality was judged sound by the owner. Two gaps remain against the acceptance cases:

- **Latent claims from appearance.** Piece 217 was called "low support… knit construction" and piece
  190 "wears you down over distance… platform sole", while both carry `walk_support: medium`.
  Appearance is not same-dimension evidence (both are `conf: medium` rather than `manual`, so the
  model had some latitude, but the claims are still inferred from looks).
- **Owner-confirmed pieces still absent.** 169 and 361 both carry `walk_support: medium` at
  `conf: manual` — the strongest rung — and neither appears at all, not judged and excluded. This is
  the same miss `thread_1787126412249` recorded. Piece 190 *was* surfaced this time, where the staged
  run had dropped it before sight, and owner-confirmed 194 was used correctly.

**The lesson is about where the boundary sits.** The original fix for this class was *code* that
downgraded visual-only latent claims; it was deleted with the profile. Restoring the *instruction*
without the enforcement reproduced the original behaviour. That is the second time in this arc that
prompt-only provenance has proved insufficient — `thread_1787123957953` was the first. Treat
enforcement as code work when batched discovery takes coverage on.

### Next lever, visible in the same turn

The coverage turn spent three retrieval steps — `wardrobe_coverage`, then `search_wardrobe`, then
`view_pieces` — before answering. That is the same "one call, not three" problem solved here for
categories, one level up at the *tool* level. Collapsing it is description-level and offline
testable; it needs no new architecture.

## Open question carried forward

Whether the moving cache breakpoint earns its cost. Writing a new entry per iteration at 1.25× may be
worse than caching only the stable prefix and letting messages ride as ordinary input at 1×. This is
computable from the recorded token counts before any paid call.

## Related

- `freeform-bounded-execution-spec.md` — bounded multi-look, the accepted precedent
- `freeform-tiered-discovery-spec.md` — the identity index and expansion contract this builds on;
  its qualified-coverage sections are historical
- `freeform-measured-rollout.md` — default-on thresholds and the live matrix; **row 5's OFF arm was
  never run**, so tiered discovery has no measured baseline
