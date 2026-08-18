# Spec 10: `classifyChatTurn`'s content-blind `followup` branch

> ## ⚠️ HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The `Status:` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.


**Status:** Needs your input on one judgment call (bias direction, see below) before implementation — everything else is ready.
**Priority:** Medium — low-risk, fully separable from specs 8/9's gate work; this is about which server-side function handles a turn, not about gate coverage within either function.
**Files touched:** `src/components/StylistChat.jsx` (`classifyChatTurn`), tests.

---

## Finding

`classifyChatTurn` (StylistChat.jsx:153) classifies every `/ask` turn client-side, in order: `correction` → `explanation` → `preference_reaction` → `followup` → `new_request` (default). The `followup` check is:

```js
if (/\b(last|previous|above|earlier|that one|first one|second one|third one|those outfits|these outfits|this outfit|that outfit)\b/.test(q) || hasThreadMemory) {
  return 'followup'
}
```

The `|| hasThreadMemory` means: once a thread has *any* established memory, **every** subsequent message is classified `followup`, with no check of the message's actual content. A genuinely new, unrelated request mid-thread ("actually, what should I wear to my sister's graduation next month?" after a conversation about a completely different occasion) still gets classified `followup`.

This matters because `conversationMode` directly gates which server-side precompose function runs: `maybePrecomposeStructuredOutfitsForAsk` requires `requestedMode === 'new_request'` (ai.js:1191); `maybePrecomposeStructuredFollowupForAsk` requires the opposite (ai.js:1296). A message misclassified `followup` never reaches the new-request precompose path at all — it's confined to the followup path (the one spec 5 had to separately patch for its own register-ceiling gap), regardless of whether the request is actually a fresh planning ask that the new-request path is built for.

## Why this needs a judgment call, not just a smarter regex

This is the same *class* of problem spec 7 just fixed for destination questions: a content-blind heuristic (or, in spec 7's case, an unreliable model judgment) misclassifying a message shape it wasn't built to distinguish. Spec 7's lesson was explicit: don't trust a single heuristic (or the model's self-report) — add a mechanical check. But unlike spec 7, there's no clean structural signal to check *after the fact* here (no equivalent of "zero search calls" or "the answer looks like a question") — this is a dispatch decision made *before* the server does anything, so there's nothing yet to verify against.

The actual fix is narrower than it sounds: stop letting `hasThreadMemory` alone force `followup`. Widen the referential-word regex to catch the bare pronoun/demonstrative cases `hasThreadMemory` was probably added to compensate for in the first place (bare "it", "that", "these", "those" — the current pattern only catches compound phrases like "that one", "these outfits", not standalone "it" or "that"), and let a message with **no referential cue at all** default to `new_request` even with thread memory present.

**The judgment call:** a genuinely ambiguous message — topically related to the thread but with no explicit referential word ("what about something warmer?" with no "it"/"that") — has to default one way or the other, and both directions have a real cost:
- Default to `followup` (current behavior): risks the same class of gap specs 5/7 fixed — a message that should get fresh new-request treatment stays trapped in the followup path.
- Default to `new_request`: risks losing legitimate thread context on a message that was relying on `hasThreadMemory` to carry it — the user has to re-state context they'd already established.

This isn't derivable from the code or from this session's context — it's a call about which failure mode you'd rather have, and how often you expect genuinely-ambiguous-but-related messages to come up in practice. Worth a quick decision before implementation rather than guessing.

## Approach (once the bias direction is decided)

1. Widen the referential-word pattern to include bare pronouns/demonstratives, not just the existing compound phrases: `it`, `that`, `these`, `those`, `them`, `again` as standalone word-boundary matches.
2. Remove `hasThreadMemory` as an unconditional OR — it should only tip an already-close call, not override content entirely. Concretely: keep `hasThreadMemory` as a fallback *only* for the decided bias direction from the judgment call above (e.g. if defaulting to `followup`-biased, `hasThreadMemory` alone still returns `followup`, same as today; if defaulting to `new_request`-biased, `hasThreadMemory` alone falls through to the `new_request` default at the bottom of the function).
3. No change to the `correction`/`explanation`/`preference_reaction` branches — these already check content, not memory presence, and aren't implicated in this finding.

## Tests

1. A message with an explicit referential word ("what about swapping the shoes on that one?") + thread memory → `followup` (unchanged from today).
2. A genuinely new, unrelated topic with no referential word + thread memory present → `new_request` — this is the regression case this spec exists to fix; currently returns `followup` incorrectly.
3. The bare-pronoun cases the widened regex adds ("is it warm enough for that?", "show me those again") + thread memory → `followup`.
4. Existing `correction`/`explanation`/`preference_reaction` test cases unchanged.
5. Full existing suite green — check `test/` for any existing `classifyChatTurn` coverage first (this function may not have direct unit tests yet, given it's client-side JSX-adjacent logic; if so, this spec is also the first to add them).

## Out of scope

- Any server-side change — `isTravelOrPackingRequest`, `maybePrecomposeStructuredOutfitsForAsk`, `maybePrecomposeStructuredFollowupForAsk` are all unaffected; this spec only changes which of the last two gets called, not what either does once called.
- `isBroadOutfitPlanningText`, `editorialRequestPattern`, `OUTFIT_FOLLOWUP_PATTERN` — other regex-based dispatch in the same file, out of scope unless a future review finds the same content-blind pattern there too.
