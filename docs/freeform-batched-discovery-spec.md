# Freeform batched discovery

**Status:** specified, not implemented — 2026-08-19
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

## The primitive

One batched retrieval returns, in a single operation, what five sequential searches returned
separately: broadened anchor candidates plus every requested support category — bottoms, shoes,
layers, accessories — with the evidence needed to judge them.

Target shape for an ordinary composition turn:

1. router
2. batched wardrobe discovery
3. optionally one composition/submission or correction call

Code owns completeness, IDs, physical eligibility and truthful uncertainty. The model owns
contextual, aesthetic and stylistic judgment over the bounded result. This is the division that made
bounded multi-look work, applied to discovery.

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
