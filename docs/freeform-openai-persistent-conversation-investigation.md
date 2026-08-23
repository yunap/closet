# Investigation: current `/ask` architecture vs. an OpenAI persistent-conversation hybrid

**Status: CLOSED, no migration.** Investigation plus a minimal live benchmark (§8, amended
2026-08-23) resolved the two unknowns that were left open; both landed against Architecture B.
Nothing here was ever implemented or proposed as a migration, and the full-scale replay the
original recommendation reserved as a fallback is no longer needed — see §8 for why.

Written 2026-08-22. Traced against `fix/freeform-compact-profile-and-outfit-set-history` @ `ad176d6`.
Benchmark run 2026-08-23; raw results in `scratch/openai_persistence_benchmark_output/`.

---

## 0. Headline finding

The premise worth checking before anything else: **does moving conversation state server-side to
a provider save money?** No — not on the numbers OpenAI documents. `conversation` /
`previous_response_id` are engineering-convenience features (Closet stops having to assemble and
truncate the messages array itself); they are **not** a caching mechanism. OpenAI states plainly
that "even when using `previous_response_id`, all previous input tokens for responses in the chain
are billed as input tokens in the API" — the same is implied, not contradicted, for `conversation`.
Cost is still governed by OpenAI's own separate automatic prompt-caching layer, which requires the
same kind of prefix-stability discipline Closet already built for Anthropic. So the two
architectures are not "stateless-and-expensive" vs. "stateful-and-cheap" — they are two different
places to put the *same* bounded-history-and-caching problem Closet has already spent several specs
solving (`freeform-prompt-cache-levers.md`, `freeform-batched-discovery-spec.md`).

Where the hybrid *could* genuinely win: lower base per-token rates (GPT-5 input $1.25/MTok vs.
Sonnet's $2/MTok intro rate) and, on models before GPT-5.6, an apparently fee-free cache write
(vs. Anthropic's 1.25×/2× write premium). Where it could lose badly: an unbounded persisted
conversation re-bills full prior-turn history as input on every call unless Closet re-implements
its own truncation on top of it — which would undercut the "simpler" pitch. Both of these are
estimates from partial documentation, not measurements — see §8.

---

## 1. Current `/ask` flow (Architecture A)

*(Traced by an Explore agent against docs/message-lifecycle.md, docs/freeform-prompt-cache-levers.md,
docs/freeform-rearchitecture-handoff.md, and the live code; all file:line citations verified against
current HEAD.)*

**Turn 1.** `POST /api/ai/ask` (`routes/ai.js:3902`) receives the question, the client's full
wardrobe array (used only for card-thumbnail lookups — server truth comes from SQLite), history,
and thread/context blobs. A free local check (`detectExplicitProhibition`) may resolve trivial
turns with no model call. Otherwise a cheap **execution router** call runs first
(`routeFreeformExecutionProfile`, `styling-engine/provider.js:1116`) — 350 max tokens, no wardrobe
in its own context — and picks one of 6 profiles: `wardrobe_inventory`, `existing_card_explanation`,
`garment_fact`, `general_advice`, `bounded_multi`, `full_stylist`. Four of six exits never touch
the full stylist payload.

Only `full_stylist` (or router failure) builds the full turn via `buildStylistConversationPayload`
(`styling-engine/core.js:3877`):

- **Tools** (cached prefix, first block Anthropic hashes): 14 schemas, measured 7,725 tokens.
- **Stable system block** (cached, `ttl: "1h"`): system prompt + occasion/climate profiles +
  full active-wardrobe manifest (`SELECT * FROM pieces WHERE status='active'`, deterministically
  ordered for byte-stability). Measured 27,736 tokens (manifest 57%, instructions 34%, occasion
  profiles 5%, style constitution 4%).
- **Volatile system block** (never cached, full price every call): mode directive, date, thread
  state JSON, feedback/guidance, generated-outfit context. Measured 2,788 tokens.
- **Messages**: bounded history (empty turn 1) + current message.

First-turn cost ≈ 35,461 cached-prefix tokens (billed at the 1h write multiplier) + 2,788 volatile
input + output.

**Follow-ups.** If the message-array prefix still matches byte-for-byte, tools + stable system are
served from cache at 0.1× the base input rate. `boundFreeformConversationHistory`
(`styling-engine/core.js:32`) caps prior turns at 8 messages / 12,000 chars total / 3,500 chars per
message — and coerces content to string, so images from earlier turns are gone by turn 2 (a
documented, accepted discontinuity). `stylist_conversation_state` (keyed by session id, in SQLite)
supplies `current_outfit_set` and resolved weather physics server-side, independent of what the
browser sends, and is declared authoritative over prose in the prompt.

A real bug (found and fixed this cycle) is worth naming here because it's the load-bearing example
for §0's caution: a `Today is …` line embedded in the *current user message* — rather than the
volatile system block — made message-index-0 differ from the cached copy on every follow-up,
invalidating the entire cached prefix every single turn. Fixing it (moving the date to the volatile
half) cut second-follow-up cache-creation tokens from 43,191 → 4,730 (**-89%**) and cache cost per
turn from $0.1749 → $0.0418 (**-76%**). This is the exact class of problem a provider-managed
conversation does not automatically solve — OpenAI's caching is also a byte-exact prefix match.

**Thread persistence.** `stylist_conversation_state` (structured: current outfit set, resolved
weather) lives in SQLite, keyed by session. `chat_threads.payload` is one JSON blob per thread —
messages, board results, thread memory, evaluated keys — not normalized per-message rows. This
branch's newest commit (`ad176d6`) added `extractHistoricalOutfitSets` /
`resolveHistoricalOutfitContext` (`core.js:3948-4060`), which re-derives addressable prior outfit
sets by scanning that client-held blob every turn — it is not a server-queryable index.

---

## 2. Hybrid OpenAI flow (Architecture B, hypothetical)

Assume: one OpenAI `conversation` per Closet thread; Closet remains authoritative for wardrobe
facts, `current_outfit_set`, historical-set identity, corrections, occasion/weather/activity, and
deterministic app state; wardrobe/tool facts are supplied fresh each turn rather than trusted from
provider memory (per the spec's own stated assumption — and per §0, this assumption turns out to be
load-bearing, not optional, because Closet cannot verify garment truth from provider-side memory).

**Turn 1.** Closet creates a `conversation` object, sends system instructions + tool declarations +
wardrobe manifest (functionally the same ~35–42k-token payload Architecture A sends, modulo
tokenizer differences) as the first item(s), plus the user's question. OpenAI's automatic prompt
caching applies to this request the same way it always does — the `conversation` object does not
itself grant a cache discount, it is a separate, orthogonal mechanism.

**Follow-ups.** Closet sends `conversation=<id>` plus only the new user turn (and, per the stated
design, a refreshed/supplied wardrobe fact block if anything changed). OpenAI appends this to the
stored conversation and **re-bills the full prior conversational history as input tokens on this
call** — the documentation is explicit that this is not free. If the growing prefix (old turns +
Closet's re-supplied wardrobe context) still matches byte-for-byte what was cached last time,
the matching portion gets the 0.1× cache-read discount; anything that changed (a new date stamp, a
reordered fact, a different wardrobe snapshot) does not, for the same reason the Anthropic bug
above bit Closet.

**What's retained provider-side vs. what Closet still resends.** The provider retains the
*message objects* (including tool calls/results — the docs state conversations "store items, which
can be messages, tool calls, tool outputs, and other data") indefinitely (conversation objects are
explicitly exempt from the 30-day response TTL). But retention ≠ free re-use: every subsequent call
still pays input-token price for that stored history unless it happens to land inside the *separate*
prompt-cache TTL window (30 minutes by default on GPT-5.6+; up to 24h "extended retention" or as
short as 5–10 minutes in-memory on earlier models, org-dependent — genuinely ambiguous from the
docs for a plain "GPT-5" call, flagged as unverified). Wardrobe/tool facts are still Closet's job to
supply or refresh every turn, same as today, because provider memory cannot be trusted as a source
of garment truth.

**Tool loop.** Functionally unchanged — Closet still declares its 14 tools, still needs
`declare_intent`-style gating, still needs to execute `search_wardrobe`/`view_pieces`/etc. against
its own DB and return results. The Responses API is a request/response loop like Anthropic's; a
`conversation` id doesn't change how tool calls are dispatched, only how the transcript is stored
between calls.

**Friday continuation after a multi-day gap.** The `conversation` object itself has no documented
expiration — it would still exist. But the *cached prompt discount* almost certainly does not
survive multiple idle days on any tier (30 min / up to 24h at best), so the first call back is a
cold, full-price re-bill of whatever context Closet supplies plus (per the billing quote above)
however much of the stored prior conversation OpenAI includes by default in that first re-engaged
call. This is a real unknown: does OpenAI resend the *entire* stored history as billed input on
resume, or does the caller control how much of the conversation is "in scope" for a given response?
The documentation excerpts we could reach did not resolve this — it is the single highest-leverage
unknown for the "Resume later" and "Long thread" scenarios, and is exactly the kind of thing a small
benchmark (§8) would settle cheaply.

**Provider conversation unavailable.** Closet's own DB (`chat_threads.payload`,
`stylist_conversation_state`) remains the source of truth regardless of architecture — the spec
explicitly requires this, and Architecture A already works this way (the "provider" is never
Closet's own persistence layer). Recovery path is identical in shape to what Architecture A already
does every cold start: reconstruct a compact working context from Closet's stored thread state,
open a new provider conversation, continue. The delta versus today is just *which provider call*
opens the new session — `conversations.create()` instead of a bare `messages.create()` — the
reconstruction logic (turning stored `current_outfit_set` + bounded prose + resolved weather into a
fresh prompt) is work Closet already has to do and would not shed.

---

## 3. State ownership comparison

| State | Architecture A (today) | Architecture B (hybrid) |
|---|---|---|
| Wardrobe manifest / garment facts | Closet, re-sent every `full_stylist` turn, cached prefix | Closet, re-sent every turn, cached prefix (same shape) |
| `current_outfit_set` | Closet SQLite (`stylist_conversation_state`), authoritative over prose | Unchanged — still Closet's job; provider transcript is not a substitute for a gate-checkable structured record |
| Historical outfit-set identity | Re-derived per turn from the client-held `chat_threads.payload` blob | Same re-derivation still needed for *deterministic* garment-name disambiguation (§4 row 5); provider's long context might additionally help resolve loose ordinal/keyword references, unverified |
| Bounded conversational prose | Closet truncates to 8 msgs / 12k chars (`boundFreeformConversationHistory`) | Provider stores full history; Closet either trusts unbounded re-billing (§0 risk) or re-implements its own truncation on top, which erodes the simplification |
| Thread recoverability | Closet DB only; provider is stateless | Closet DB still required as the recovery source of truth (spec's own requirement) — provider conversation is convenience, not backup |
| Weather/occasion/activity resolution | Closet, structured, stored server-side | Unchanged |
| Tool declarations / gating | Closet (`STYLIST_TOOLS`, `declare_intent`) | Unchanged — provider doesn't own tool semantics |

The provider conversation object, in this design, only ever holds a *copy* of what Closet already
persists more precisely (structured `current_outfit_set` vs. raw transcript). It is not proposed as
a replacement source of truth anywhere in the spec, and nothing in OpenAI's docs would make that
safe — there's no documented way to guarantee an old item is excluded or corrected once wrong
information has entered a persisted conversation (§6).

---

## 4. Cost comparison by usage pattern

All Architecture A figures are Closet's own measured numbers (`freeform-prompt-cache-levers.md`,
`freeform-batched-discovery-spec.md`) at current Sonnet intro pricing ($2/$10 per MTok). Architecture
B figures are **estimates**, built from OpenAI's documented GPT-5 rates ($1.25 input / $0.125 cached
/ $10 output per MTok) and the mechanics in §2, assuming the same ~38k-token wardrobe+tools+system
payload (not measured against GPT-5's tokenizer — flagged). **Do not treat the B column as
measured — it is the estimate the recommendation in §8 says is worth testing for real.**

| Scenario | Architecture A (measured) | Architecture B (estimated) | Note |
|---|---|---|---|
| One-shot generation, no follow-up | ≈ $0.16 (cold 1h-TTL cache write ~35.5k tok + 2.8k volatile + output) | ≈ $0.06 (no documented cache-write premium on plain GPT-5, lower base rate) | B's lower estimate rests entirely on "no cache-write fee below GPT-5.6," unconfirmed for the exact model Closet would target |
| + 1 follow-up | ≈ $0.18 | ≈ $0.06 + (full prior turn re-billed as input, ~1–2k tok) ≈ **$0.065–0.08** | Both still cheap; gap is small |
| + 2 follow-ups | ≈ $0.20 | ≈ **$0.09–0.13**, growing faster than A per turn because prior turns compound as re-billed input | Growth rate matters more than any single turn |
| + 5 follow-ups | ≈ $0.27 (bounded history caps growth at 8 msgs) | Unbounded without Closet-side truncation: could exceed A by the 4th–5th follow-up, because A's history cap holds turn-over-turn cost flat while B's naive re-billing does not | This crossover is the single most decision-relevant number in the whole report, and it is not verifiable from documentation alone |
| Resume Friday after Monday | Cold cache write again (TTL expired days ago) — same cost shape as a fresh one-shot | Conversation object persists (no TTL), but prompt cache almost certainly does not (30 min–24h at best) — cold re-bill on first call, **and it is unknown whether that call re-bills the entire stored history or only what Closet explicitly includes** | Unresolved unknown, §2 |
| Many dormant threads, occasional resume | $0/turn while dormant either way; per-resume cost = one-shot cost | Same — dormant conversation objects cost nothing per OpenAI's docs (no storage fee mentioned) | No material difference |
| Long thread (many generations + critiques, current + historical sets) | Cost stays roughly flat per turn because history is capped at 8 msgs regardless of thread age | Cost likely **rises** turn over turn unless Closet imposes its own cap — at which point Architecture B has re-invented `boundFreeformConversationHistory` inside OpenAI's system instead of removing it | This scenario is where "hybrid simplifies the architecture" is most directly contradicted by the billing model |

Two of the six patterns the spec asked about (`long thread`, `resume later`) are exactly the ones
where the cost model is least certain and most likely to favor Architecture A as currently built.
The two most favorable to B (`one-shot`, `many dormant threads`) are also the two the owner's own
prior instinct flagged as the likely dominant real usage pattern — worth weighing against how much
engineering effort a migration would cost for scenarios that may not be where most usage lives.

---

## 5. What current machinery remains / shrinks / goes

*(Full inventory with file:line citations in the appendix, §9 — this is the summary.)*

**Genuinely obsoleted by provider-side persistence:**
- `boundFreeformConversationHistory` — the truncation *policy* goes away only if Closet accepts
  unbounded re-billing (§4); if it doesn't, the logic just moves, not disappears.
- The moving 5-minute cache breakpoint (`withMovingCacheBreakpoint`) — this exists specifically
  because Closet re-sends a growing message array within one tool-loop; a provider that holds the
  loop state server-side wouldn't need it.

**Shrinks but does not disappear:**
- Thread-state persistence — the *structured* half (`current_outfit_set`, resolved weather) stays
  exactly as-is; only the *prose blob* half becomes partially redundant with what the provider
  stores, and Closet's own reconstruction/recovery path (§2, last paragraph) needs it to survive
  provider outages regardless.
- Historical-set resolution — deterministic garment-name matching stays (a provider's fuzzy recall
  is not a correctness guarantee); only loose ordinal/keyword resolution might lean on provider
  context instead.
- Prompt assembly — still needs to inject volatile per-turn state and the wardrobe manifest every
  turn; only the *prior-turn prose* portion of assembly moves server-side.

**Unaffected — these solve problems orthogonal to who stores conversation history:**
- The execution router and compact follow-up profiles (cost control over *how much wardrobe/tool
  context a turn needs*, not over *how much conversation history it carries*).
- `current_outfit_set` as a structured, gate-checkable record (a provider transcript is not a
  substitute for this — nothing in OpenAI's docs proposes structured extraction from a stored
  conversation).
- Tool discovery, intent declarations, output guards — domain-correctness machinery, unrelated to
  transport.
- Telemetry — still needed, and would need new columns for provider conversation ids/costs; note
  `executionProfile` is *already* computed but not persisted to `freeform_generation_runs`
  (`routes/ai.js:583`), an existing gap this investigation surfaced independent of the OpenAI
  question.

Net: this is not "delete a subsystem," it's "relocate roughly a third of one subsystem
(conversation-prose bookkeeping) and keep the rest." The spec's own instruction not to assume
persistent conversation eliminates these responsibilities was correct to include — it does not.

---

## 6. Failure / recovery comparison

| | Architecture A | Architecture B |
|---|---|---|
| Provider call fails mid-turn | Closet retries from its own DB state; nothing provider-side to lose | Same, plus: does a failed call still get appended to the stored conversation? Undocumented — a partial/errored turn polluting future re-billed context is a real risk, unverified |
| Provider is unreachable entirely | Closet's thread reconstructs fully from `chat_threads.payload` + `stylist_conversation_state`; this is the *only* path today | Same recovery machinery required (spec's own reliability requirement) — Closet must still be able to rebuild a compact working context and open a fresh session. This is not new work Architecture B avoids; it's work Architecture A already does, that B inherits unchanged |
| Old/bad information needs correcting mid-thread | Closet edits its own DB; next prompt build reflects it (deterministic, code-controlled) | No documented way to exclude, delete, or replace an individual item in a persisted OpenAI conversation. If the model was told something wrong on turn 2, there is currently no confirmed mechanism to make it "unsay" that for turn 9 other than starting a new conversation object — a meaningful reliability gap for a stylist that has to honor corrections (`docs/feedback-and-memory-map.md`'s corrections channel exists precisely because users do this) |
| Compaction under long threads | N/A — Closet's own bounded window is the compaction | OpenAI's server-side compaction (`context_management.compact_threshold`, standalone `/responses/compact`) exists but its token cost is undocumented in what we could reach, and the compaction artifact is explicitly "opaque and not intended to be human-interpretable" — meaning Closet could not verify what garment facts survived compaction, a real tension with the "wardrobe facts must be Closet-supplied, not trusted from provider memory" design principle |

The item-deletion gap and the opaque-compaction gap are the two sharpest reliability risks specific
to Architecture B, and neither is a documentation-reading problem — OpenAI's own docs simply don't
cover them, which is itself informative.

---

## 7. Main risks

1. **The core cost thesis may be backwards.** §0/§4: persistent conversation is convenience, not a
   discount. Migrating on the assumption it saves money, without the small benchmark in §8, risks
   shipping a "simpler" architecture that costs more on exactly the long-thread pattern this app's
   power users hit (per `docs/freeform-batched-discovery-spec.md`'s own telemetry, iteration/turn
   count already dominates spend more than any single prompt's size).
2. **No documented way to correct or exclude a bad item from a persisted conversation.** Given this
   app's corrections/preferences channel is a named, authoritative feedback surface
   (`feedback-and-memory-map.md`), losing the ability to cleanly overwrite a stale fact mid-thread
   is a functional regression, not just a cost question.
3. **Opaque compaction conflicts with the "wardrobe facts are Closet-supplied, never trusted from
   provider memory" design principle** that this very spec states as a requirement for Architecture
   B. If compaction runs and Closet can't inspect what it kept, that principle becomes unenforceable
   past the compaction threshold.
4. **Vendor concentration.** Today, Anthropic outage or pricing change affects the stylist chat;
   Architecture B would still need Anthropic (or another model) for anything Closet doesn't want to
   route through OpenAI, or it becomes a full second-provider integration — doubling the surface
   this codebase's caching, gating, and telemetry work has to cover, not replacing it.
5. **Real numbers are genuinely thin.** Several of the most cost-relevant facts (whether a
   `conversation`'s full history is auto-included in every response and billed regardless of what
   Closet explicitly attaches; the effective cache TTL for a non-5.6 GPT-5 call; compaction's token
   cost) were not resolvable from the documentation this pass could reach. Recommending a
   directional decision on partial numbers is itself the risk, independent of which way it points.

---

## 8. Recommendation

**CLOSED 2026-08-23 — no migration, and no full-scale replay needed.** The minimal benchmark this
section originally called for was run live against GPT-5 (raw results:
`scratch/openai_persistence_benchmark_output/2026-08-23T08-00-25-635Z__test_a_billing_scope.json`
and `..._test_b_cache_ttl.json`; script: `scratch/openai_persistence_benchmark.mjs`). Both of the
unknowns below resolved, and neither resolved in Architecture B's favor.

The two questions this report originally could not settle from documentation:

1. **On a `conversation`-backed follow-up call, is the entire stored history always billed as
   input, or can Closet scope what's "in" for a given response?** — **Resolved: billed, not
   scoped.** A 5-turn synthetic thread (one `conversation`, ~5.7k-token stable context, same
   context resent every turn per the spec's own "always supply wardrobe facts fresh" design) showed
   `usage.input_tokens` holding at the full stable-context size on every turn (5,743 → 5,757 →
   5,771 → 5,785 → 5,799), never shrinking to just the new message. Nothing is scoped down
   automatically — the provider bills what's sent every time, with the repeated portion
   cache-discounted (not free). This confirms §0's headline finding rather than overturning it.
2. **Does the effective prompt-cache TTL for a plain GPT-5 (not 5.6) call behave like the 24-hour
   "extended retention" tier, or something much shorter?** — **Resolved: short, not long.** The
   identical ~5.7k-token prefix was re-sent at 0/4/10/20/30/40-minute gaps. `cached_tokens` held at
   5,632 through the 30-minute checkpoint, then dropped to **0 at 40 minutes** — a clean bracket
   between 30 and 40 minutes, consistent with the documented ~30-minute default tier and nowhere
   near 24h. That's *shorter* than the 1-hour TTL Closet already runs in production on Anthropic
   (§1) — the hybrid's cache would go cold more often than Architecture A's does today, not less.

**Applying the standing decision rule** (set before the benchmark ran): if Test A showed
full-history rebilling and Test B showed only short-lived caching, the OpenAI-persistence idea
could be closed without the larger, real-corpus replay this section originally proposed as a
fallback. Both conditions landed. The replay is no longer warranted — it would spend more to
re-confirm a direction two cheap, decisive data points already point away from.

**Actual cost:** ≈ $0.022 across all 11 calls (both tests combined) — under the $0.06–0.11 estimate,
because every call returned `output_tokens: 0` (see caveat below).

**Caveats on this result, so it isn't over-read:**
- The per-turn additions in Test A were deliberately tiny (~14 tokens each, single-word answers) to
  keep the run cheap. OpenAI's cache hits land in 128-token increments, so this run cannot
  distinguish "growing conversation history never caches" from "these additions were individually
  too small to ever register as a hit." It answers the *billing* question (nothing is dropped) but
  not whether a realistically-sized follow-up (hundreds of tokens, like Closet's real turns) would
  itself become cacheable on turn 3+.
- Every call returned `output_tokens: 0` — plausibly GPT-5's hidden reasoning consuming the
  `max_output_tokens: 50` budget before any visible text, a known GPT-5-family behavior. The script
  only persisted the `usage` object, not the full response body, so `status`/`incomplete_details`
  weren't captured to confirm this. It doesn't affect the input/cache-token findings above, which
  were the actual target, but it means this run says nothing about answer quality.
- Single run, single model (`gpt-5`), one geography/account. Not repeated for variance.

None of these caveats point toward Architecture B — they only bound how far this specific result
generalizes. Given Architecture A's already-measured, continuously-improving caching strategy
(three specs deep, up to -89% cache-creation tokens on the exact cross-turn-invalidation case that
tripped up this benchmark's own design), the bar for migrating was "clearly and measurably better,"
not "plausibly comparable." This investigation did not clear that bar, and the live data now says
it is unlikely to.

---

## 9. Appendix — 12-piece machinery inventory (verified file:line)

| # | Machinery | Where | Still necessary under B? |
|---|---|---|---|
| 1 | `boundFreeformConversationHistory` | `styling-engine/core.js:32` | Mostly obsolete, *if* unbounded re-billing is accepted (§4 risk) |
| 2 | Execution router | `styling-engine/provider.js:1116` | Still needed — orthogonal cost control |
| 3 | Compact follow-up profiles | `docs/freeform-followup-profiles-spec.md` | Still needed, same reasoning |
| 4 | `current_outfit_set` | `stylist_conversation_state` table; `routes/ai.js:4385` | Still needed — structured, gate-checkable |
| 5 | Historical-set resolution | `styling-engine/core.js:3948-4060` | Partially obsolete — deterministic name-matching stays |
| 6 | Thread-state persistence | `db.js:311-326` | Structured half stays; prose-blob half partially redundant |
| 7 | Prompt assembly | `buildStylistConversationPayload`, `core.js:3877` | Shrinks, doesn't disappear |
| 8 | Provider prompt caching | `provider.js:907` | Still relevant, different mechanics |
| 9 | Moving cache breakpoint | `provider.js:937` | Likely obsolete |
| 10 | Tool discovery | `provider.js:758`, `tools.js:586` | Still needed |
| 11 | Intent declarations | `tools.js:1497` | Still needed |
| 12 | Output guards | `provider.js:132` | Still needed, unchanged |
| — | Telemetry | `routes/ai.js:580` | Still needed, new columns required |

**Not independently verified this pass:** `docs/freeform-deferred-tools-spec.md` and
`docs/freeform-tiered-discovery-spec.md` (named historical/removed elsewhere, not read in full);
OpenAI's Conversations API item-level CRUD (create-with-up-to-20-items is documented; list/delete/
retrieve individual items is not, per direct doc fetch); OpenAI compaction's token billing;
whether a failed/errored turn is appended to a persisted `conversation`.
