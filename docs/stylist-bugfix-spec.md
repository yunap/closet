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

- ~~`GeneratedBoardLengthFeedback` still uses the old raw inline-styled chips, missed by PR B's
  `.stylist-feedback-*` standardization.~~ **Stale even before today** — it already used the
  shared `.stylist-feedback-chip` class (see `docs/ui-v1-design-handoff.md`'s item 6.1, which
  recorded that porting as done). What it actually had, found and fixed 2026-07-27: the "which
  garment" picker was a single shared pointer that reset to the first piece on every open/close
  and never indicated which piece already had a saved correction. Replaced with one always-visible
  reason group per piece, in both this component and Visual Lab's matching widget. Same fix used
  the occasion to also unify board feedback onto two other chat surfaces that had no feedback UI
  at all — see `docs/board-feedback-desync-spec.md` and `docs/app-surface-map.md`.
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

## 7. Raw DB piece IDs in stylist prose — **NOT A BUG. Do not fix.**

The panel reported output like *"The tan leather tote (ID 12)…"* and *"ID 21 would pair better
than ID 8"* as an internals leak. It is not. **Owner ruling 2026-07-25: this was explicitly
requested.** The owner asked for garment IDs to appear in the stylist's prose so that when a
recommendation exposes a mistagged or otherwise broken garment, they can find and fix that exact
record instead of hunting for it by name.

The rationale, expanded 2026-07-25: garment names collide constantly — especially ones written by
the AI auto-tagger — so the ID is what makes a recommendation point at one unambiguous record.

Do not remove the IDs, do not gate them, and do not rewrite the prompt to suppress them **as a
defect**. But the owner has explicitly opened the *presentation* to redesign: a panel is welcome
to propose alternatives that solve garment disambiguation some other way. Anything proposed has to
solve the collision problem, not just hide the number.

This is exactly what `AGENTS.md`'s *Consult before behavior fixes* rule exists to prevent, and
what the project's gate history keeps re-teaching: an apparent leak is often a deliberate
decision. Diagnose and ask before assuming a defect.

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

---

# Addendum — found after PR 175 merged (2026-07-25)

Items 1–6 above landed in `44c2a01`. **Items 8 and 9 below were implemented and verified
2026-07-25** (see status notes on each) — they are recorded here for the audit trail, not as
open work. Item 7 (raw piece IDs in stylist prose) remains open and still needs diagnosis first.

## 8. Legacy stored diagnostic cards still render the raw gate vocabulary — **DONE 2026-07-25**

**Implemented:** `stripEngineRejectionSuffix` (module scope, `StylistChat.jsx`) strips the legacy
`Rejected/Broken because …` suffix from a broken card's `reason` when the dev flag is off, and
returns empty when only the builder's `"… shown for debugging."` placeholder survives.
`outfit.watchFor` and `outfit.systemFlags` are now guarded by
`(!isBrokenCard || STYLIST_DEBUG_ENABLED)`.

**Verified live, both paths,** against both legacy `Casual` threads. As a regular user
(`sandbox-web-asuser`, flag off): zero matches for `Watch: structural`, `rejected-model-card`,
`Rejected/Broken because`, `not found in roster`, or `shown for debugging`; the model's own prose
survives intact and `What didn't clear: structural: missing bottom` still shows. On the dev path
(`sandbox-web`, flag on): all internals still present. Non-broken cards in the same thread keep
their `Watch:` line — the guard is scoped to broken cards only. Regression test:
`StylistChat suppresses raw gate vocabulary on legacy stored diagnostic cards`.

Original diagnosis follows.


Item 1's fix was applied **source-side only** — `routes/ai.js` no longer *sets* `watchFor`,
`systemFlags`, or the `Rejected because …` suffix on broken cards. The renderer was not changed:
`src/components/StylistChat.jsx` ~2972 and ~2977 still render `outfit.watchFor` and
`outfit.systemFlags` inside "Why this outfit" with no `isBrokenCard` guard.

New cards are clean. **Cards already stored in a thread payload before the fix still carry those
fields and still render the leak.** In the sandbox that is both `Casual` threads
(`thread_1784876334282`, `thread_1784923674907`) — the only two threads there with broken cards.
Anyone reviewing the diagnostic-card surface against existing data will see the bug the fix was
supposed to remove and reasonably conclude it didn't work.

**Fix direction.** Add the render-side guard as defence in depth: suppress `watchFor` and
`systemFlags` on `isBrokenCard` cards, or route them through `STYLIST_DEBUG_ENABLED` with the
other internals. The variable already exists at ~2711. This is not a redundant belt-and-braces
fix — thread payloads are durable and there is no migration, so without it the leak persists in
history indefinitely.

**Regression test.** The item-1 test asserts the invariant against a freshly built card. Extend it
to a card fixture that *does* carry the legacy fields, asserting they are not rendered ungated.

## 9. "Useful repeats" label is regex-derived and contradicts its own content — **IMPLEMENTED 2026-07-25, not live-verified**

**Implemented:** `getTripPlanOverviewRows` now takes the plan outfits, reads
`pieceReuse.repeated` off the first outfit carrying it, and labels `Useful repeats` vs.
`All looks distinct` from that. The old keyword guess survives only as a fallback for payloads
predating `pieceReuse`, tagged `// TODO: backfill`. The value also stops restating its own label
(`Repeat schedule:` / `Packing reuse:` prefixes stripped). Confirmed `pieceReuse` survives to the
client — `routes/ai.js:2733` passes `toolContext.generatedOutfits` through whole, no whitelist.
Regression test: `trip plan repeat label is derived from structured pieceReuse, not a keyword
guess`.

**Live-verified 2026-07-25 (repeats branch only)** against `thread_1784969252663`, a real 3-day
LA trip plan: the overview row renders `Useful repeats` — correct, that plan repeats one piece —
with the value `woven straw tote bag with leather handles (Friends Hangout)`, i.e. the
`Repeat schedule:` prefix correctly stripped. **The `All looks distinct` branch is still
unverified**; it needs a plan whose looks share no pieces.

Original diagnosis follows.


`styling-engine/outfitSetPlanner.js:149` emits one of two plan lines: `Repeat schedule: …` when
pieces recur across days, or an "every look is distinct — no piece repeats" sentence when they do
not. `src/components/StylistChat.jsx:1838` then labels the row by keyword-matching the rendered
prose (`/repeat|reuse|packing/i`). **Both branches contain the word "repeats," so both render under
the header `Useful repeats`** — a plan with zero repeats announces "Useful repeats: Every look is
distinct."

The structured answer is already available and discarded: `describeTripPieceReuse` computes
`pieceReuse` and `outfitSetPlanner.js:243` attaches it to every plan outfit, including
`pieceReuse.repeated`. This is `AGENTS.md` principle #2 exactly — text inference standing in for
structured data that is already present on the object.

**Fix direction.** Label from `outfit.pieceReuse.repeated.length`, not from a regex over prose.
`Useful repeats` when there are repeats; a distinct label such as `No repeats` or
`All looks distinct` when there are none. While in there, collapse the redundancy in the populated
case — the header reads `Useful repeats` above a value that opens `Repeat schedule:`.

Keep the regex only as a fallback for plans whose payload predates `pieceReuse`, and tag it
`// TODO: backfill` per house convention.

**Note for whoever picks this up:** the sandbox has **no** plan/trip threads, and mock mode cannot
produce one (the tool loop never dispatches `plan_outfit_set` / `trip_precompose` under
`WARDROBE_MOCK_AI`). Verify the way item 1's dedup fix was verified — call the planner directly
against the sandbox DB following `scratch/build_dedup_fix_demo_thread.js`, exercising both
branches (a plan with repeats and one without). Do not spend a real model call on this.

## 10. Look counts changed when the collapsed results disclosure was expanded — **DONE 2026-07-25**

Owner-reported. `renderStructuredAdvice` truncates `outfits` to `INITIAL_SAVED_OUTFIT_COUNT` (4)
while the `Show N more outfit results` disclosure is collapsed, then passed that **slice** into
`buildStylistPresentation` and `buildResponseSections`. So every count described the rendered
subset: an 8-look plan announced itself as `4 looks`, and a slot group printed `2 LOOKS` directly
above cards the server had badged `1 OF 3`. Expanding changed the input and the numbers moved.

Third instance of the invariant E9 established — one count, one meaning — this time between the
response header and its own collapsed view.

**Fix:** `buildStylistPresentation` now receives `allOutfits`; `buildResponseSections` takes it as
a third argument and derives each slot's `countLabel` from a full-set title→count map, falling
back to rendered items when it isn't passed. Rendering still uses the truncated array, so the
disclosure behaves as before.

**Verified live** (`sandbox-web-asuser`, `thread_1784969942592`, 7 outfits so it collapses):
header reads `7 looks` both collapsed and expanded; `City outing` reads `3 LOOKS` while collapsed,
matching its own `1 OF 3` / `2 OF 3` badges; expanding adds cards and the remaining slots without
any number changing. Regression test: `response look counts describe the whole response, not the
collapsed slice`. Build passes; suite at the same 6 pre-existing failures.

**Also verified against real data** (`wardrobe-web`, 236-piece wardrobe, `thread_1784970885986`,
8 outfits — the same thread the owner screenshotted reading `4 looks` before the fix): the header
now reads `8 looks · casual city day, smart casual outing, evening out` both collapsed and
expanded, and slot counts read 2/3/1/1/1, matching the `1 OF 3` / `2 OF 3` badges while collapsed.

**Remaining nuance, not fixed:** while collapsed, slots with no rendered card yet (here `Outdoor
daytime social` and `Smart casual / dinner`) don't appear at all, so the slot *list* is partial
even though every number shown is now true. Whether a plan should preview all its slots up front
is a design question, not a defect.

---

# 11. Plan and whole-wardrobe responses dropped the model's entire prose answer — **FIXED 2026-07-25**

The largest finding of this phase, and the explanation for several others.

**Symptom.** For `plan_outfit_set` / `trip_precompose` responses and whole-wardrobe responses, the
UI rendered *only* the structured cards. The model's own written answer never appeared anywhere.
On the 14-piece capsule that silently discarded the budget declaration (*"12 pieces the engine
confirmed within budget"*), the numbered 12-piece roster, the route to the full 14 (*"add the
black wedge sandals and capris… they slot in cleanly as a 3rd shoe option"*), and — most
pointedly — the sentence explaining the shoe concentration: *"The wedge heels flagged out of the
walking slots, so the canvas slip-ons do heavy duty there; the burgundy cork wedges carry the one
evening look."* On the Tucson trip it discarded *"6 looks, 3 pairs of shoes, built for the heat"*,
every look's name, every per-look rationale, and a closing offer to check for a rain layer.

**Root cause.** Two independently reasonable conditions that together left `m.text` with no render
branch: `isPreviewResponse` is false for plan responses (plan cards aren't `previewOnly`), and
`getCompactOutfitIntro` (`StylistChat.jsx:1636`) returns `''` for `wholeWardrobe` or planned-set
messages. The intent was to suppress a *canned* intro line because the structured header already
does that job — correct for the generic string it was written for, wrong once the prose became the
substantive answer.

**Why it mattered beyond the missing text.** The owner's complaint that started the shoe
investigation — *"it should have told the user 14 pieces is too tight, so I'm limiting the
shoes"* — was already answered by the model. Every reader, including the implementing agent for
two hours, judged the shoe concentration a styling failure using a screen that had thrown away the
explanation.

**Fix.** A `Stylist's notes` disclosure (`.stylist-plan-notes`, open by default) renders the full
`m.text` **below** the cards for exactly the responses that previously dropped it
(`hasStructuredIdeas && !isPreviewResponse && !compactIntro`). Below rather than above so
comparison imagery still leads, per the ratified image-first ruling. Nothing is parsed out of the
prose — the model's structure survives intact. `getCompactOutfitIntro` is untouched; the canned
intro stays suppressed.

**Verified live** against both real-wardrobe threads (`wardrobe-web`, as-user): on the capsule the
budget declaration, roster, route-to-14, and shoe explanation all render (3393 chars vs 3555
stored — the delta is markdown syntax, ending at the identical sentence); on Tucson the
declaration, look names, per-look rationale, and closing lever all render. Clarifying-turn and
revision-turn prose still render as before, and the structured cards are unchanged. `npm run
build` passes, `typographySystem`/`outfitChatLayout` at 16/16, `aiEndpointContracts` at the same 6
pre-existing failures, no console errors. Regression test: `plan and whole-wardrobe responses
still render the model's own prose answer`.

**Extended the same day, after the owner asked whether other response types were affected —
they were, in three different ways:**

- **Selected-piece / generic outfit ideas** showed a canned line (*"Outfit ideas for X… image
  generation is optional"*) *instead of* the answer — worse than dropping it, since nothing looked
  missing. **Canned line and its helper `getCompactOutfitIntro` removed entirely** (owner ruling).
- **But their `m.text` must not be surfaced either:** `formatStructuredOutfitFeedback`
  (`styling-engine/core.js:908`) builds that body server-side by dumping each outfit's
  `Label`/`Strength`/`Direction`/`Silhouette`/`Pieces`/`Watch for` fields — the same data the cards
  render, in the field-dump register PR #142 moved the critique surface away from. It is not the
  model talking. Guarded by `isEngineFieldDump`, which matches our own deterministic
  `**Generated outfit ideas for:**` header (our format, not garment text). Genuine prose that
  happens to share this code path — e.g. a conversational whole-wardrobe reply — still renders.
- **Plans are no longer split by the outfit fold.** `INITIAL_SAVED_OUTFIT_COUNT = 4` (from #162's
  load work) cut a plan in half behind `Show N more outfit results`, hiding whole slots and making
  the counts describe the viewport — the source of item 10. A plan is one artifact, so
  `isSinglePlanArtifact` (planned-set source or `wholeWardrobe`) now exempts it. Ordinary
  multi-result replies, which genuinely are a list, still fold.

Verified live on both: the capsule renders all 8 cards with no fold button, groups 2/3/1/1/1, the
budget declaration and shoe explanation present; the selected-piece thread shows neither the field
dump nor the canned line. Build passes, suites at the same 6 pre-existing failures.

**Still open, same disease, smaller:** `getTripPlanOverviewRows` recognises only four line
patterns, so the piece roster, budget verdict, and `plan trimmed` notices in `tripPlanLines` still
never reach the overview. Less urgent now that the prose carries the same information in the
model's own words.

**Three more found while verifying, none fixed, none urgent:**

- **A revised plan becomes unfindable in the rail.** `threadMemory.latestOutfits` holds the *latest*
  turn's outfits. Revise a plan and the revision arrives as one `proposed` card outside the plan
  (the unbuilt merge, above), so the rail summarises a 6-look Tucson plan as
  *"1 direction · travel"*. A second cost of the missing merge, not a separate bug — but it means
  plan threads get progressively harder to find in history the more you refine them.
- **`nature_walk` maps to "city walk"** in `compactOutcomePhrase`'s keyword branches
  (`/\b(city|walking|walk|stroll)\b/` catches it). Semantically wrong in the rail; a vocabulary
  call rather than a defect, so left alone.
- **Weather provenance is invisible and inconsistent.** The wedding plan resolved a real forecast
  (`Weather used: … (live forecast, South Lake Tahoe, CA)`); the Tucson plan a week out asserted
  100–105°F from model knowledge with no marker and an empty `weatherSource`. Both are presented
  with identical confidence and the owner cannot tell which is which. Relevant to panel
  proposition 8 — the packet should say so, so reviewers assess the bet as it actually behaves
  rather than as advertised.

**Found while verifying, not fixed:** thread-rail subtitles emit raw slot ids —
*"3 looks · outdoor_daytime_social"*. `getThreadOutcomeSummary`'s `outfitTheme`/`compactOutcomePhrase`
(`src/utils/threadGrouping.js`) never humanise underscores. Pre-existing, cosmetic, visible in the
sidebar of every screenshot.

## Owner questions answered 2026-07-25 (no code change)

- **"Who told it there should be 8 looks?"** Nobody. `PLAN_TOTAL_OUTFIT_CAP = 8` with
  `planTotalOutfitCapForBudget`: budget <18 → 8 outfits, 18–23 → 12, 24–29 → 16, 30+ → 20. The
  engine capped the plan; the model described what it was handed. **OPEN ISSUE — deferred to the
  panel, do not implement yet.** One cap serves two different jobs. For a trip, 8 outfits over 6
  days is sensible; the axis is days. For a capsule it is the wrong axis — 5 tops × 5 bottoms is
  ~25 combinations, so capping the presentation at 8 undersells the budget the owner just spent.
  It is also binding in practice: both capsules examined carried `plan trimmed` notices, meaning
  the model asked for more looks and was cut.

  **Owner decision on approach (2026-07-25): split the cap by plan shape** — trips keep the
  day-driven curve, capsules get their own sized to combinatorial reach. Framed as the general
  rule *"a plan's cap comes from its own shape"*, not a `&& !isCapsule` special case (negation
  test). **The number is deliberately unanswered:** it should come from what real capsule-wardrobe
  practice actually promises for an N-piece capsule, not from a guess — research that before
  picking a figure. Note the tradeoff: more looks means more model output per plan, so this is a
  cost/latency decision as well as a presentation one.

  **Status: on the issues list, pending the panel.** The panel may conclude the capsule flow
  shouldn't exist in this shape at all, which would make the number moot — so the research and the
  implementation both wait for Stage 1. **The research half is now done — see below. The
  implementation still waits for Stage 1.**

### Research done 2026-07-25 — what the capsule number should be

Two strands: what capsule practice actually publishes, and what this engine can actually produce.
Measurement script: `scratch/diagnose_capsule_outfit_capacity.js` — runs the real
`selectCapsuleRoster` plus the real per-slot gate against the 236-piece wardrobe, over the five
slots from `thread_1784970885986`. Read-only, no model call, no network.

**Method warning, learned the hard way:** the slots handed to `selectCapsuleRoster` must carry
`targetOutfits`. It feeds `capsuleDemandReserve`, which is what reserves roster places for the
strictest register tier. A first pass of this script omitted it and every low-register slot came
out roughly half as capable as the live plan actually is (`casual_city_day` read 2 cores instead
of 5; whole-plan capacity at budget 14 read 20 instead of 24). Any future capsule diagnostic must
pass it.

**Measured capacity by budget** (distinct top×bottom-or-dress "cores" across the whole plan —
shoe swaps re-skin a core rather than making a new look, so they are not counted as capacity):

| budget | roster | naive combos | gate-valid distinct cores | current cap |
|---|---|---|---|---|
| 10 | 3T 3B 1D 1O 2S | 10 | 10 | 8 |
| 12 | 4T 4B 1D 3S | 17 | 17 | 8 |
| 14 | 5T 5B 1D 3S | 26 | **24** | 8 |
| 16 | 7T 5B 1D 3S | 36 | 30 | 8 |
| 18 | 8T 6B 1D 3S | 49 | 41 | 12 |
| 20 | 9T 7B 1D 3S | 64 | 41 | 12 |
| 24 | 10T 9B 1D 4S | 91 | 62 | 16 |
| 30 | 13T 11B 1D 5S | 144 | 105 | 20 |

Results:

1. **The "~25 combinations" figure in the framing above is confirmed, not overturned.** Real
   gate-valid capacity at budget 14 is **24** against a naive 26 — the ceilings cost almost
   nothing at the whole-plan level. (An earlier draft of this section claimed 20 and called the
   original estimate optimistic. That was the missing-`targetOutfits` artifact described above,
   not a real effect.) So the cap of 8 does undersell a 14-piece capsule by roughly a factor of
   three, exactly as originally argued.
2. **Capacity is non-uniform across slots, and the total cap is not what binds the thin ones.**
   At budget 14 `casual_city_day` supports 5 cores against `smart_casual_outing`'s 21 — the
   `everyday`-ceiling-versus-`elevated`-roster interaction documented in `outfitSetPlanner.js`'s
   comment above `effectiveSlotRegisterCeilingRank`. Raising the total cap alone would deepen the
   already-rich slots and leave the thin one repeating. A total-outfit number is a blunt
   instrument here; per-slot capacity is the real ceiling. (One wardrobe, one slot set — re-run
   against another thread's slots before generalising the specific figures.)
3. **The wardrobe is not the limitation** — see the supply/selection split below.

### Is the wardrobe thin, or is the roster picking badly? — measured 2026-07-25

Second script, `scratch/diagnose_capsule_supply_vs_selection.js`: for each slot it prints
**supply** (pieces in the whole 236-piece wardrobe that pass that slot's real gate — the ceiling on
what any roster could have bought) beside **roster** (how many of those the capsule actually
bought). Budget 14, summer, `targetOutfits` set:

| slot | supply | roster |
|---|---|---|
| `casual_city_day` | 44T 35B 4D 15S — 1544 cores | 2T 2B 1D **1S** — 5 cores |
| `smart_casual_outing` | 67T 45B 11D 27S — 3026 cores | 5T 4B 1D 3S — 21 cores |
| `evening_out` | 22T 6B 8D 26S — 140 cores | 3T 2B 0D 3S — 6 cores |
| `outdoor_daytime_social` | 78T 52B 11D 28S — 4067 cores | 5T 4B 1D 3S — 21 cores |
| `city_gallery` | 67T 45B 11D 27S — 3026 cores | 5T 4B 1D 3S — 21 cores |

**Unambiguous: this wardrobe is nowhere near thin for a summer capsule.** The weakest slot draws
on 44 eligible tops and 35 eligible bottoms; the roster bought two of each. Nothing here is a
supply problem, so no amount of adding garments fixes it — the whole question lives in
`selectCapsuleRoster`/`capsuleQuotas`, which is where the recurring-failure-mode note already
says to start. Note also `casual_city_day` gets exactly **one** eligible shoe out of 15 in supply:
that is the 7-of-8 shoe concentration below, seen from the supply side rather than the plan side,
and it confirms the "budget working correctly" reading — three shoe slots, one spent on evening.

**Seasonal check (same script).** Winter at budget 14 gives a 5T 4B 1D 1O 3S roster — one bottom
traded for the outerwear `capsuleQuotas` adds when `isSummer` is false — and whole-plan capacity
holds up. **One winter result looks like a genuine defect and is not yet filed:** with
`targetOutfits` set, `evening_out` comes out at 4T **0B** 0D, i.e. **zero possible looks**. The
everyday-tier demand reserve appears to crowd evening-capable bottoms out of the roster entirely.
Summer does not show this (3T 2B). Not investigated further — flagged here so it is not lost.

**What capsule practice publishes.** The established conventions are unanimous, and they
contradict the combinatorial reading the approach decision was built on:

- **10×10 challenge** — 10 pieces, **10 outfits**, 10 days. One look per piece.
- **3-3-3 / 333 method** — 9 pieces, **9 base outfits** presented; the 27+ layered variants are
  named as an extension, not as the deliverable.
- **Project 333** — 33 items for three months, **no outfit list at all**.

**On seasonality:** every convention above is a *seasonal* capsule by construction — Project 333
is explicitly one season (three months), 10×10 and 3-3-3 are run as seasonal mini-capsules. So the
research is seasonal research; there is no separate "annual capsule" literature it missed. What
the sources notably do **not** do is vary the outfit count by season: a 10×10 is 10 looks in
January and 10 looks in July, with the *pieces* changing and layering absorbing the difference.
That supports a **season-invariant cap**, with `capsuleQuotas`'s existing `isSummer` handling of
outerwear carrying the seasonal difference — which is where it already lives.
- Commercial guides do quote large numbers ("15 pieces, 50+ outfits"; a 20-item capsule ≈ 30–50
  combinations) — but always as a **capacity claim**, never as an enumerated lookbook. Nobody
  ships 50 cards.

So real practice presents ≈ **one look per piece at the small end**, and the ratio *falls* as the
capsule grows, because the point of a capsule is reduced decision load rather than enumeration.
**This inverts the premise of the approach decision above:** the capsule axis is not
"combinatorial, therefore show more". It is *rotation* — and the trip axis, days, is also
rotation. The two plan shapes want the same kind of number from different sources, which the
"a plan's cap comes from its own shape" rule still expresses correctly.

Note also that today's curve is already ≈ 0.67 looks per piece above 18 (12/18, 16/24, 20/30). It
falls to 0.57 at 14 and rises to 0.8 at 10 — so it is not really "day-driven" versus
"combinatorial", it is an unlabelled looks-per-piece ratio with a discontinuity exactly where
capsules live.

**Recommended number (not implemented, not ratified):** capsule cap = `min(piece_budget, 12)`.
A 14-piece capsule shows 12 looks — one per piece per the 10×10 convention, saturating where a
viewer stops distinguishing cards — against a measured capacity of 24, so the cap sits below the
ceiling instead of above it. Trips keep the day-driven curve. Season-invariant, per the
seasonality note above.

**The number is not the whole item.** Raising the cap to 12 at budget 14 is well within capacity
(24) and clearly right, but it will land unevenly: `smart_casual_outing` can absorb 21 while
`casual_city_day` tops out at 5, so a bigger total needs the per-slot ceiling respected or the
thin slot just repeats more visibly. And the felt problem stays unaddressed either way — the
engine knows all of this exactly and never states it as a decision the owner can contest, the same
gap as the shoe-concentration finding below. The output that would actually fix it is *"your 14
pieces combine about 24 ways across these five use cases; the casual-day slot only supports 5, so
I'm showing 12 and doubling up there — say the word and I'll take it to 16."* Same declaration
fix, same two layers (stylist prompt, `getTripPlanOverviewRows`).
- **"Why do we fold chat messages?"** A genuine load optimisation, not a UX opinion —
  `701690b`, *"Speed up garment and chat loading (#162)"*, 2026-07-22, alongside
  `chatThreadCache.js` and relationship prefetching. It is a *render* optimisation; all the data
  arrives regardless, so it cuts DOM and image work on photo-heavy threads. The 8-message fold is
  left as-is. **Not the only option:** `content-visibility: auto` lets the browser skip layout and
  paint for offscreen content with essentially no JS and nothing hidden; windowing is the heavier
  alternative. Worth revisiting if the message fold becomes annoying too.

---

# Diagnosed 2026-07-25, NOT fixed — one shoe carried 7 of 8 looks

Owner-reported on the real-wardrobe capsule (`thread_1784970885986`, 236 pieces): `navy solid
canvas slip shoes` appeared in 7 of 8 looks. Diagnosed with
`scratch/diagnose_capsule_shoe_roster.js` (re-runnable, replays the real per-slot gate against the
real wardrobe, no model call). **Nothing changed — the owner has not ruled on any of it.**

Three separate mechanisms, not one:

1. **BY DESIGN — not a defect. Owner ruling 2026-07-25: "city stroll is comfortable walking shoes
   by design."** A slot described as a city stroll should get walking-suitable footwear, and the
   inference is already correctly scoped: it fired only on `smart_casual_outing`, whose `bestFor`
   contained the phrase, and not on the other four slots. The owner's earlier remark that a
   summer capsule shouldn't be assigned "lots of walking" was about the capsule as a whole, not
   about a stroll slot preferring flats. **Do not change this, and do not re-file it.** The
   mechanism is recorded below only because the trace is useful. The planner builds
   each slot's gate input from the slot's own description (`outfitSetPlanner.js:1010`:
   `slot.label`, `bestFor`, `coverage`, `planNote`). `resolveActivityProfile` keyword-scans that
   text and fires the **walking** profile on the phrase `"city stroll"` alone — verified in
   isolation: `city stroll` fires it; `museum`, `brunch`, `winery`, and empty text do not. That
   profile carries `excluded_heel_heights: ['low','mid','high']`, `discouraged_footwear:
   [sandal, sandals, mule, mules]`, and its own `register_ceiling: 'everyday'`. So on
   `smart_casual_outing`, whose `bestFor` the model wrote as *"brunch, city stroll, museum,
   winery"*, the gate dropped 181/197/199 with `activity profile: mid|high heel unsuitable`.
   **Two words the model chose to describe its own proposal silently reconfigured that slot's hard
   gate.** Note a trip plan legitimately *wants* this on a "city walking day" slot, so the fix is
   not a special case bolted onto the existing condition — see `AGENTS.md`'s negation test. The
   candidate general rule: activity is a property of what the owner asked for, not of prose the
   model generated. An implementation sketch (an `options.activityProfile` override in
   `wholeWardrobePieceTrustDecision`, mirroring the existing `options.registerCeiling` override
   pattern, fed from owner-intent text) was discussed and **deliberately not written**.

2. **Register ceilings behaved exactly as tagged — not a bug.** `city_smart_casual` and
   `outdoor_daytime_social` cap at `elevated`; `evening_social` at `dressy`; `casual` at
   `everyday`. So `elevated` wedges were eligible on most slots, and the one slot admitting
   `dressy` (`Evening Out`) is precisely where a wedge appeared. `black floral cutout mules` (181)
   was `dressy`, one rank over the line — **the owner retagged it to `elevated` on 2026-07-25**;
   re-run the diagnostic to confirm it now passes city/smart-casual.

3. **RESOLVED — the shoe concentration is the capsule budget working correctly, not a defect.**
   Owner's hypothesis, confirmed: *"14 is a pretty tight capsule, it might have been budgeting for
   other garments."* `capsuleQuotas(14, { isSummer: true })` returns
   `{ top: 5, bottom: 5, dress: 1, outerwear: 0, shoes: 3 }` — a top or bottom multiplies into more
   looks per slot than a third pair of shoes, so a 14-piece capsule buys **three** shoes. Running
   the real `selectCapsuleRoster` against the 236-piece wardrobe at budget 14 returns navy canvas,
   black canvas sneakers, and taupe knit sneakers. `brown leather strap sandals` (222) and every
   wedge are **outside the capsule roster entirely** — not gated, not out-scored per slot, just not
   affordable. The live plan then spent one of the three on the burgundy cork wedges via the
   register-floor guarantee (the `evening` slot needs a shoe clearing its ceiling), leaving two
   flats to cover seven non-evening looks. One of them carrying most of the plan is the budget
   doing its job.

   **Product finding, owner 2026-07-25 — the real gap here.** *"On one hand it's the right
   decision, on the other — it should have told the user 14 pieces is too tight, so I'm limiting
   the shoes."* The engine knows the constraint exactly (`capsuleQuotas` → 3 shoe slots,
   `Within the 14-piece budget`, two `plan trimmed` notices) and never states it as a **decision
   the owner can contest**. The prose came close — *"the canvas slip-ons do heavy duty there"* —
   but that reports an outcome, not the tradeoff that caused it or the lever to change it. What's
   missing is something like *"a 14-piece budget buys about three pairs of shoes, so I concentrated
   footwear and spent the rest on tops and bottoms — say the word and I'll take it to 16 with a
   second sandal."* Two layers, both open: the stylist prompt doesn't ask the model to declare
   budget-driven category limits, and `getTripPlanOverviewRows` drops the roster/budget/trim lines
   that would show it (see the lossy-overview finding above). This is the reason the concentration
   reads as a failure to every reader — it is correct and undeclared. Not scheduled; needs an owner
   decision on scope.

   **Method note worth keeping:** the per-slot gate, `PLAN_WORKBENCH_PIECE_LIMIT`,
   `planWorkbenchPieceScore`, `fit_confidence`, and feedback influence were all investigated at
   length and are all the *wrong layer* — they operate after `selectCapsuleRoster` has already
   chosen the capsule. For any capsule-shaped request, start at `capsuleQuotas`/
   `selectCapsuleRoster`, not at the slot gate.

Owner's framing to preserve: *smart-casual never capped below elevated, neither did city, and a
"lots of walking" activity should not be assigned to a summer capsule at all.*

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
