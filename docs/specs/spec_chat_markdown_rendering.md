# Spec: Chat message markdown rendering (facelift, independent of the gate-parity sequence)

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


**Status:** Ready for implementation. Fully decoupled from specs 1-3 of the freeform-chat sequence — safe to ship first, in parallel, or whenever convenient. Pure rendering-layer change, no backend/gate logic touched.
**Priority:** Medium — cosmetic but highly visible; every assistant message with any markdown currently renders broken
**Files touched:** `StylistChat.jsx` (message render, ~line 4204 and the sibling render at ~4233), `package.json` (+`react-markdown` or equivalent), `App.css`, tests

---

## Finding

Assistant messages render via `{m.text}` — a raw string, auto-escaped by JSX, with zero markdown parsing. `STYLIST_SYSTEM` explicitly instructs the model to produce `### Outfit N`, `**Pieces**`, numbered lists, etc. — all of it prints literally (`###`, `**`) instead of rendering as headers/bold/lists. Confirmed live in this session's screenshots.

## Scope note (relative to the freeform-chat sequence)

Spec 2 of that sequence moves outfit *structure* into `propose_outfit` tool calls, rendered as cards — but the conversational prose around those calls (intros, follow-up questions, corrections, numbered option lists like "Here are a couple of options: 1. ... 2. ...") stays free text regardless, and still deserves to render cleanly. This spec is useful whether or not spec 2 ever ships, and doesn't need to wait for it.

## Part 1 — Add a markdown renderer

Add `react-markdown` (small, well-maintained, no HTML-injection risk since it doesn't render raw HTML by default — appropriate here since content is model-generated, not user-authored-and-trusted). Apply to assistant message text at both render sites (~4204 primary chat, ~4233 secondary/summary context — check for other raw `{m.text}`/`{message.text}` sites during implementation, there may be more than these two).

## Part 2 — Style overrides matching the app's visual language

Default markdown styling (browser/library defaults) will look jarring against the app's warm, editorial aesthetic. Custom component overrides needed for:
- Headers (`###`) → styled consistent with existing card titles, not generic bold-large text
- Bold (`**`) → app's existing emphasis color/weight, not default browser bold
- Lists (numbered/bulleted) → spacing and marker style matching the app's chip/card rhythm, not default browser list indentation
- Keep it restrained — this is chat prose, not a rendered document; avoid heavy visual weight that competes with outfit cards below it

## Part 3 — User messages: plain text, unchanged

Only assistant messages need markdown rendering (the model produces structured markdown per its prompt; the user doesn't). User message bubbles stay exactly as they render today — no scope creep into input formatting.

## Part 4 — Error bubbles: unaffected

The error-bubble styling (from the earlier error-boundary spec) already renders distinctly and correctly — confirmed in code, untouched by this change. Don't route error text through the markdown renderer; it's already correctly separated.

## Tests

1. ✗ A message containing `### Header`, `**bold**`, and a numbered list renders as actual HTML elements (heading, strong, ordered list) — not literal `#`/`*` characters in the DOM text content.
2. Style overrides applied — spot-check that rendered headers/bold don't inherit unstyled browser defaults (visual/snapshot test or explicit class assertion).
3. User messages unaffected — same plain-text rendering as before.
4. Error bubbles unaffected — still use the distinct error styling, not the markdown path.
5. No HTML injection: a message containing literal `<script>` or other HTML tags renders as inert text, not executed (react-markdown's default safe behavior — assert it holds).

## Out of scope

- Any change to what the model is instructed to produce (`STYLIST_SYSTEM`'s format stays as-is).
- The `propose_outfit`/structured-proposal work (spec 2 of the other sequence) — independent.
- Rich embeds (images inline in markdown, etc.) — plain markdown text formatting only, this pass.
