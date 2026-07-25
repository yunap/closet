# Spec — Stylist surface bug cleanup

**Status:** ready to implement. Written 2026-07-24 for a separate session.
**Scope:** defect cleanup only on the Stylist surface. No design changes, no new features.

## Why this exists

These defects were surfaced by an expert UI panel that should have been spending its budget on
product judgment instead. They are being cleaned up so the *next* panel cannot spend its budget
the same way. Treat that as the acceptance criterion: after this spec, a reviewer looking at the
Stylist surface should have nothing mechanical left to report.

**Scope discipline.** Every item below is a defect with a confirmed or clearly-stated mechanism.
Do not expand any of them into a redesign. If an item turns out to require a product decision,
stop and report it rather than deciding — several nearby questions are deliberately still open
and are listed in *Out of scope* at the bottom.

## Branch state — read first

The working branch `stylist-looks-count-diagnosis` has **uncommitted changes** in
`src/App.css`, `src/components/StylistChat.jsx`, `src/utils/threadGrouping.js`,
`test/threadRail.test.js`, and `docs/ui-v1-design-handoff.md` (the E9/E10 thread-rail fixes plus
docs). Do not discard them. `closet.db` and `scratch/build_dedup_fix_demo_thread.js` are
untracked; `closet.db` should not be committed.

Line numbers below are against that working tree and will drift — locate by symbol, not by line.

---

## 1. Raw gate vocabulary leaks onto diagnostic cards (highest priority)

**Confirmed by code inspection.** This is a genuine miss in PR A (#172): PR A gated the raw
internals on *one* render path, and the `ui-v1-design-handoff.md` entry claims the job is done. It
is not — the same raw string reaches the UI through three other fields that were never gated.

`routes/ai.js`, `buildBrokenModelCard` (~line 1728) sets all three of:

- `systemFlags: [{ type: 'rejected-model-card', message: rejectionReason }]`
- `watchFor: rejectionReason`
- `reason: "…Rejected because ${rejectionReason}."`

Its sibling `buildBrokenDiagnosticCard` (~line 1706) does the same shape with
`watchFor: reasonText` and a `systemFlags` message reading
`Diagnostic local-fill card. Violations: …`, plus `reason: "…Broken because …"`.

`src/components/StylistChat.jsx` renders `watchFor` (~2925) and `systemFlags` (~2930) inside the
**"Why this outfit"** disclosure, *outside* the `STYLIST_DEBUG_ENABLED` gate that begins a few
lines later — so expanding that disclosure on a rejected card shows a user text like
`Watch: structural: missing bottom` and `rejected-model-card: structural: missing bottom`.

**Required behavior.** The owner ruling already on record
(`ui-v1-design-handoff.md` → *Consensus theme A*, and *Issue 1* under the diagnostic-card
section) is: the owner sees the model's card plus **one** plain-language engine disclaimer naming
the piece and what didn't clear — currently rendered as `What didn't clear: …` — and raw internals
live behind `STYLIST_DEBUG_ENABLED`. Three competing copies of the same rejection string, two of
them in raw form, violates that.

**Fix direction.** Stop reusing the raw rejection string as user-facing card copy. On broken
cards, keep `rejectionReason` as the single structured field the disclaimer already renders, and
either omit `watchFor`/`systemFlags`/the `Rejected because …` suffix on `reason`, or route them
through the dev gate with the rest of the internals. Prefer fixing it in `routes/ai.js` at the
source rather than adding a `broken`-conditional to the renderer — a renderer-side special case
is the negation-test smell `AGENTS.md` warns about, and the fields are not needed by any other
consumer on these cards. Check both builders; they must end up consistent.

**Regression test.** Assert that for a broken/`diagnosticOnly` card, no ungated rendered field
contains the raw `rejectionReason` substring. Test the invariant, not the specific copy — the
existing per-string tests are what let this through.

---

## 2. `--text-light` is shadowed inside `.stylist-response-shell`

**Confirmed.** `src/App.css:11` defines the global `--text-light: #776958`, documented as the
app's lowest-contrast readable text color (≥4.8:1). `src/App.css:9559`, inside
`.stylist-response-shell` (opens at 9550), redefines it as
`color-mix(in srgb, var(--text) 62%, #fff)` — lighter than the global token.

The panel measured a `Suggested additions` label at 4.48:1, marginally under WCAG AA. That label
was moved onto `--text-light` by the small-mechanical batch *specifically because* the token
carried a ≥4.8:1 guarantee. The override silently breaks that guarantee — and not just for one
label: **every** `--text-light` consumer inside the Stylist response shell is affected.

**Fix direction.** Decide whether the local override is intentional, and treat that as the real
question. If the shell genuinely needs a quieter tone, it should be a *separate semantic token*,
not a redefinition of a global whose contract other code relies on — this is the same rule
`ui-v1-design-handoff.md` states for `--accent-light` ("do not globally change `--accent-light`
to fix one repeated surface; create a semantic surface token instead"). If it is not intentional,
remove it. Measure the resulting ratio before and after; do not assume.

---

## 3. Four async/paid indicators are silent to assistive technology

**Confirmed.** PR C added `role="status" aria-live="polite"` to the chat typing indicator and the
`chatAnnouncement` region, and the generating-state fix added `role="status"` to the three
landing panels. These four were missed — all in `src/components/StylistChat.jsx`, none carrying
`role="status"` or `aria-live`:

| Site | ~Line | Trigger |
|---|---|---|
| `isEvaluating` indicator ("Evaluating this outfit...") | 2976 | `Evaluate outfit` (paid) |
| Comparison-sheet skeleton (`imageStatusByKey[comparisonKey]`) | 2405 | whole-wardrobe comparison (paid) |
| Ideal-comparison skeleton (`imageStatusByKey[idealComparisonKey]`) | 2525 | `Preview all directions (~$0.07)` |
| Board render skeleton (`imageStatusByKey[boardKey]`) | 3069 | `Generate/Regenerate outfit image` (paid) |

Three of the four are the app's *paid* actions. A screen-reader user spends money and gets no
confirmation anything is happening.

**Fix direction.** Mirror the pattern PR C already established — `role="status"
aria-live="polite"` on the wrapper that holds the status text, so the timed `imageStatusByKey`
copy is what gets announced. Do not invent a second mechanism. Note that these skeletons *appear*
rather than change text, so appearance alone announces correctly; no separate "finished" region is
needed unless testing shows otherwise.

---

## 4. Ungated renderer/timing telemetry in the "Details" disclosure

**Confirmed.** `src/components/StylistChat.jsx` lines ~2455, ~2575, ~3119 render
`Render timing: … · renderer: {board.debug.renderer}` plus a cost line inside a
`<details>` labelled `ⓘ Details`, with **no** `STYLIST_DEBUG_ENABLED` check. PR A gated the
separate `Dev telemetry` disclosure and missed this one.

**Fix direction.** The owner ruling on record is that timing/token telemetry stays available but
behind the dev flag. `renderer` is an internal identifier and belongs there too. The **cost**
line is different — cost is deliberately always user-visible per the product's paid-action
honesty, so keep it outside the gate. Split the disclosure accordingly rather than gating the
whole block. All three sites.

---

## 5. `detectColor` misses colors that carry no base color word

**Confirmed mechanism.** `src/components/StylistChat.jsx` ~1979: `detectColor` word-boundary
matches against the `KNOWN_COLORS` map (~1942). The map has no `espresso` and no `tobacco`. A
piece named "deep espresso trouser" matches nothing and falls back to generic grey `#d0d2d4`;
"tobacco brown" renders correctly only because it happens to contain `brown`.

This is pre-existing logic that `ui-v1-design-handoff.md` explicitly deferred as out of scope.
It is in scope now for one reason: the E3 work promoted these swatches from per-card decoration
to the **Compare silhouettes** strip, whose entire purpose is free side-by-side comparison before
paying to render. A wrong color there is actively misleading, not merely unhelpful.

**Fix direction, and a caution.** `AGENTS.md` principle #2 says prefer structured data over text
inference. That principle **cannot** apply here: these are editorial ideal-additions directions
proposing pieces the owner does not own, so there is no DB row and no `color` field to read. Text
inference is the only available source on this surface, so extending the map is the correct fix
here and not a violation — say so in the commit message so it doesn't read as a regression against
the house rule. Add the shade terms the stylist actually emits (espresso, tobacco, oxblood, ink,
camel, sand, taupe, ecru, chocolate, etc.). Keep the word-boundary regex; never switch to
substring matching (`textu-red` matched "red"; "minimal" matched "mini").

Consider whether an unmatched color should fall back to grey at all, or should render as an
explicit "unknown" treatment — a confident wrong swatch is worse than a visibly absent one. If
that turns into a design question, stop and report it.

---

## 6. Lower priority, same surface

- **`GeneratedBoardLengthFeedback`** (`StylistChat.jsx:27`, used at ~3275 and ~5402) still uses
  the old raw inline-styled chips, missed by PR B's `.stylist-feedback-*` standardization. Port it
  to the shared classes with `aria-pressed`. Vocabulary unchanged — PR B's ruling was
  standardize-don't-unify.
- **Button height inconsistency**, 30px vs the 34px `.stylist-feedback-chip` floor, caused by CSS
  specificity. Still above the 24px WCAG floor, so cosmetic. Find the winning selector rather than
  adding `!important`.
- **`Board error: Model did not return JSON`** reaches the UI as raw text. Thrown at
  `styling-engine/core.js:62`. Give the user-facing path a plain-language message; keep the raw
  text in the server log.
- **Lookbook `BoardDetail` dialog is missing focus-return**, inconsistent with the pattern
  ratified on Stylist's lightbox, Calibration Boards, and garment detail. Outside the Stylist
  surface but the same defect class — include it if cheap, split it out if not.

---

## 7. Needs diagnosis before any fix

**Raw DB piece IDs in the stylist's own prose** — reported by the panel as output like
*"The tan leather tote (ID 12)…"* and *"ID 21 would pair better than ID 8."* **Not verified in
this session.** This is not a UI field; the model is echoing roster IDs out of its prompt context
into user-facing text, so any fix is prompt-side in `styling-engine/prompts.js`.

Per `AGENTS.md`'s *Consult before behavior fixes*: reproduce it first, identify which prompt puts
IDs in front of the model and whether they are load-bearing (ID validation is a real mechanism —
see `styling-engine/tools.js`), and report the root cause **before** editing a prompt. Do not
change prompt text speculatively.

---

## Out of scope — do not touch

These are settled or deliberately open. Re-opening any of them is scope creep, not diligence.

- **"N looks" count mismatch (5 vs 3).** **Not a bug.** Verified this session by running
  `getThreadOutcomeSummary` against both stored `Casual` threads in the sandbox DB — both return
  `"3 looks · …"`, matching the in-chat header. The panel's "5 looks" came from a client serving
  pre-E9 module code. Nothing to fix.
- **Cost-bearing actions on broken/"needs review" cards (A4).** Owner ruling: leave as-is, the
  cards are usually fine and the engine is what's flagged. The panel re-flagged this with sharper
  evidence; the owner has been asked to re-confirm and has not changed the ruling.
- **Illegible baked-in captions on the comparison sheet (E4b).** Owner ruling: the image model
  not complying with an already-correct "no text" instruction. Not a code bug.
- **Feedback controls on un-rendered preview cards.** A real open product question — what signal
  is even meaningful when the proposed pieces are not owned — deliberately unresolved. Do not
  add, remove, or gate feedback controls on preview cards.
- **The chat-vs-Visual-Lab board feedback state mismatch.** Diagnosed, owner-descoped, backlog.
- **The "negative feedback doesn't always reach the model" pipeline gap.** Owner-deferred
  explicitly ("not now"). Do not investigate.

---

## Verification protocol

- **Restart the sandbox unconditionally** before any live testing — kill whatever is on ports
  3098/5174 and relaunch both from `.claude/launch.json`. See `CLAUDE.md`; a process already
  listening there may be the owner's own unmocked server. This has already caused one incident of
  real billed calls.
- **No billed model calls.** The owner is on a constrained budget. `WARDROBE_MOCK_AI=true` covers
  single-shot calls; it cannot drive the freeform tool loop. For anything needing a real
  `propose_outfit` sequence, follow the pattern in `scratch/build_dedup_fix_demo_thread.js` —
  it calls `executeTool` directly against the sandbox DB, no model call, and inserts a browsable
  thread. That script also seeds a broken/deduped card, which is useful for items 1 and 4.
- `npm run build` and the full `node --test` suite. The baseline has **7 known pre-existing
  failures** unrelated to this work; confirm the count is unchanged via `git stash` rather than
  assuming.
- Record what was done in `docs/ui-v1-design-handoff.md` following that file's existing
  convention, including anything deliberately left undone.
