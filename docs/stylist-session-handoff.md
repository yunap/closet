# Stylist work — session handoff

**Last updated:** 2026-07-28. Branch `stylist-docs-staleness-fixes`.

## 2026-07-28 session, part 2 — Remove button didn't clear the board-feedback chip

The new Style Profile **Remove** button (added earlier the same session, see below) called the
existing `DELETE /api/stylist-feedback/:id` endpoint, which archives the row and correctly
re-syncs `saved_boards.payload.feedback_labels` for canonical (saved-to-Visual-Lab) boards. But an
unsaved board has no `saved_boards` row — `StylistChat.jsx`'s `boardFeedbackActive` falls back to
a per-thread snapshot (`chat_threads.payload.boardFeedbackLabels`), and **nothing had ever cleared
that snapshot**, not even the chat's own pre-existing "un-toggle a chip" flow. So deleting the
feedback row (via Remove, or by un-toggling the chip in chat) left the chip showing active again
next time the thread loaded, from either surface.

Fixed both sides that write into this snapshot:
- `routes/crud.js`: new `clearThreadBoardFeedbackSnapshot(row)`, called from the DELETE route —
  this is the one place both surfaces converge, since Style Profile has no access to the chat's
  live React state.
- `StylistChat.jsx`'s `toggleStylistFeedback`: the removal branch now also strips the type from
  local `boardFeedbackLabels` state, mirroring what the add branch (`saveStylistFeedback`) already
  did.

Live-verified in the sandbox (`thread_1784969252663`, "Friends Hangout" board, `generated_visual_board:4:0`
bucket): clicked "Looks good" for real, confirmed the bucket held `["works"]`; clicked it again to
un-toggle, confirmed the DELETE fired against the correct feedback row, the chip un-highlighted,
and the bucket came back `[]`. `npm test` still at the established 7-failure baseline.

**Caught a testing-process mistake worth flagging for next time:** an early verification pass used
`computer` click coordinates read off an 800×450 screenshot while `read_page`'s returned
coordinates were relative to the actual 1280×720 viewport — clicks landed on nothing, no network
request fired, and a stale leftover DB value made the follow-up check look like a pass. Caught by
cross-checking `read_network_requests` for the expected DELETE call before trusting a "looks
fixed" API read. Always click via `ref`, not raw screenshot-derived coordinates, when the two
differ.

## 2026-07-28 session — A1/A2/A5 shipped, C3 ratified, piece-action-menu rebuilt end to end

Re-verified panel-stage1-findings.md's Section A against the code (per its own "recurring failure
mode" warning) before trusting the "accepted, not yet implemented" status line — confirmed it was
still accurate, then implemented and shipped:

- **A1, A2, A5** — all three as `styling-engine/prompts.js` instruction fixes (this is
  chat-composed styling, not a deterministic gate): pattern discipline now explicitly covers
  shoes/accessories (A1); a new "Scarcity Honesty" rule degrades look count instead of writing
  confident rationale for a violated brief (A2); a new "Pushback on a Specific Garment" rule
  requires re-reading the garment record and forbids a byte-identical card in response to a
  correction (A5). A4 deferred at the owner's request — belongs with the capsule redesign.
  Safety-rail snapshot `test/fixtures/prompts_yuna_snapshot.json` updated to match (deliberate
  content change, confirmed via diff that only the touched keys moved).
- **C3 ratified** as `AGENTS.md` Engineering Principle #7 (the five-question decision rule for new
  structure), amended twice from running it for real: added a build/fix/kill trichotomy (a failing
  test names what's missing, doesn't always mean delete) and a "deliberately soft" carve-out for
  test 3 (the `owner_rule` case, soft by design after the #44 memory-pollution incident). Full
  derivation stays in `docs/panel-stage1-findings.md` → C3.
- **B1 corrected** — the panel's two "chip → structure" proposals both already existed
  (`Wrong for <occasion>` hard edit; `store_user_correction` → editable Style Profile rule), same
  shape as the earlier C4 correction: argued from a packet without code access. Running C3 against
  the *existing* mechanism (not just proposals) is what surfaced the real, previously-unknown gap:
  `occasion_exclusions` had no view or undo path anywhere outside the chip itself.
- **The piece action menu (`···` on any outfit-card garment) rebuilt across several owner-caught
  rounds** — full derivation and every live-verification step in `docs/app-surface-map.md`'s
  occasion-exclusion entry, this is the summary:
  - Added the missing **Occasion exclusions** view (Style Profile) so the hard exclusion from
    above is checkable and reversible.
  - Trigger changed from literal `...` (reads as truncation, not a button — probably why two
    review passes missed this menu entirely) to the standard `⋮` kebab, better contrast.
  - Panel rewritten as a `document.body` portal (`PieceActionMenu` in `StylistChat.jsx`) — the
    old absolutely-positioned version was silently clipped on every edge (left/right/bottom) by
    the outfit card's own `overflow: hidden`.
  - Categorized into Piece information / Outfit pairing / Occasion rule (owner mockup), each with
    an icon and a plain-language consequence line; copy corrected against the actual scoring code
    before shipping (traced `getWholeWardrobeFeedbackMemory` — the "Replace" action penalizes the
    piece itself, not "this pairing," which is what the mockup's text claimed).
  - Two real regressions caught and fixed **in the same review, both by the owner, neither by
    me first**: a capture-phase auto-close raced the button's own click under genuine pointer
    input (synthetic `dispatchEvent` testing didn't reproduce it — real clicks did), breaking
    "Edit piece details"; and a button-label fix that didn't touch the actual click handler,
    so "Open source chat" kept opening the garment editor regardless of what it said.
  - Style Profile's "Outfit & styling feedback" list: raw `wrong item read` label → "Replaced in
    this outfit" (matches the chat's own words); its "Open garment"/"Open thread" choice reordered
    to prefer the thread (garment shows the piece in isolation, no outfit, no "why"); added a
    piece-set board-match fallback (`matchedBoardByPieceSet`) for threadless rows, generalized
    beyond just this one feedback type; added a **Remove** button (existing delete endpoint,
    previously unexposed here) for the rows that have no board, no thread, and never did.
  - **New, unfiled defect found while answering "what is this other entry":** legacy
    `message`-type feedback embeds its board image as markdown text instead of a structured field,
    so it can't be linked even when a matching board and thread both still exist — see `## Open`
    below.

## 2026-07-27 session — board feedback desync fixed, plus three bugs found along the way

Picked up `docs/board-feedback-desync-spec.md` (previously "diagnosed, not implemented"). Now
**implemented and live-verified** — see that spec's "The display fix" section for the mechanism
(chat now indexes saved boards by `imageUrl` and branches reads/writes through the canonical
`saved_boards` record, same as Visual Lab). Full details, including what was deliberately left
alone, are in that spec; don't duplicate them here.

Three more bugs surfaced and were fixed in the same session, none of them things this session set
out to find:

1. **Wrong-length garment picker** (`GeneratedBoardLengthFeedback` in chat, its twin in Visual
   Lab) reset to the first piece on every open/close and never indicated which piece already had
   a saved correction — a correction on a second or third garment looked missing. Fixed by
   replacing the picker with one always-visible reason group per piece; also filtered which
   reasons apply by garment category (shoes/accessories get none). See
   `docs/app-surface-map.md`'s board-feedback-chips entry.
2. **Two chat board-rendering surfaces had no feedback UI at all** (`m.renderedBoards`/
   `render_preview`, and `boardResults[i]`/"wardrobe-board") — separate from the desync, since
   there was nothing to desync when one side had no chips to begin with. Given the desync fix's
   canonical helpers already existed, extended the same taxonomy to both. All four board surfaces
   in the Stylist now behave consistently.
3. **Thread-loading race**: opening a thread by direct URL could silently render a *different*
   thread's messages under the correct URL/title, survivably across a hard reload — a competing
   mount-time effect (`initAndMigrate`) picked its own thread from `localStorage`, independent of
   the URL, and reliably finished last. Fixed by making that effect's guard also skip when a
   thread was requested via the URL. See `docs/app-surface-map.md`'s thread-rail entry.

Also: Visual Lab's Calibration Boards "Needs review" filter was renamed to **"Flagged"** and no
longer includes `almost` ("Almost right"), which is a positive-leaning verdict and now counts as
Positive instead.

All fixes live-verified in the sandbox (feedback clicks are free, no billed calls). Build passes
throughout; suite held at the 7 pre-existing baseline failures the whole session (two test files
needed updates for refactors, not new failures).

## State

Two full days of work, and **the durable output is documentation, not code**. Stage 1 of the expert
panel ran; the more productive activity turned out to be mapping the app, which found four surfaces
the panel packet had missed and several behaviours nobody had written down.

**Docs that now exist, in the order a new session should read them:**

1. `docs/app-surface-map.md` — 33 entries. Every route, tab, mode-split and dialog. Plain English
   first, stores as a footnote, every observation tagged `[by design]` / `[known bug → ref]` /
   `[unverified]` / `[owner check wanted]`. **Read this before assuming anything about the app.**
2. `docs/engine-behaviour-map.md` — the non-UI companion, twelve passes and ~1,555 lines. Side-effect
   writes, thread state, retry loops, prompt splices, sweeps, **scoring weights with measured
   firing rates, caches, CI ratchets, the gates (every layer in order, with measured exclusion
   counts per context), the outfit-level pass after them (advisor-vs-gate mode, repair, diversity
   penalties), the full image-generation path including cost reporting, and the tagger prompt that
   populates every column the rest of it measures, the role vocabulary behind formula-family
   classification, a provenance table of which columns are yours vs the tagger's, and a swept
   singular/plural bug class.** Read its **Findings this map produced** section first: **33 things**
   that were not known before, including one unreachable code path, a billed render that reports no
   cost, a cost gate that under-quotes by 1.6x, and six garment keywords that never fire at all. No
   `[unverified]` tags remain in the body — anything answerable was answered.

   **Four findings withdraw or reorder recommendations made earlier in the same document**, each
   marked in place. All four were caught by the same two checks, which is the durable lesson:
   **check provenance** (owner-set or tagger-set? which prompt version?) and **check the keyword**
   (does the regex actually match real garment names?). Two scripts now do exactly that.
3. `docs/panel-stage1-findings.md` — the panel synthesis organised for triage by ID. Section A is
   ruled; B, C, D, E are not.
4. `docs/expert-panel-brief.md` — ratified protocol. **Part 4b lists six ways the implementing
   agent got this wrong**; read it before assembling a packet.
5. **`docs/tagger-cost-spec.md`** — **draft, awaiting ratification.** Cost-first tagger spec:
   cold-start onboarding is the primary case ($12.18 for 200 garments today, target <=$3.50).
   Four phases, one billed step (~$2.70), decision rule written down. Read §2 first — it lists the
   prior rulings that constrain it.
6. `docs/board-feedback-desync-spec.md` — **implemented and live-verified 2026-07-27.** Read for
   the mechanism if touching board feedback again; not an open item anymore.
7. `docs/ui-v1-design-handoff.md` — rulings, plus **Outstanding issues 1–8**.

**Eleven derivation/measurement scripts**, all read-only and free — none constructs an AI client:

| script | answers |
|---|---|
| `derive_surface_skeleton.js` | every surface, diffed against the surface map |
| `derive_engine_behaviours.js` | writes, retry loops, prompt splices |
| **`derive_board_producer_fanout.js`** | **for each image-producer function: its server call sites, and which frontend render block consumes the result — flags any board-rendering block with no feedback-chip UI.** Neither the surface map (UI-structure-first) nor the engine map (producer-function-first) tracks this fan-out axis; this is what caught the two no-chip surfaces fixed 2026-07-27. |
| `measure_scoring_terms.js` | how often each scoring term fires on the real 236-piece wardrobe |
| `measure_gate_impact.js` | what the hard gate excludes per context, by reason |
| `measure_diversity_classifiers.js` | the repeat-detection buckets diversity penalises on |
| `measure_image_path.js` | image payloads, prompt sizes, tagger cost vs the preflight estimate |
| `measure_roles.js` | the role vocabulary behind formula-family classification |
| **`measure_plural_gap.js`** | **which keyword rules never fire because names are plural** |
| **`measure_provenance.js`** | **which columns are owner-set vs tagger-set** (`<colA> <colB>` cross-tabs) |
| `measure_open_questions.js` | re-derives the findings the map turned up |

Run them to check the maps have not rotted. **The last two are the ones that stop wrong fixes** —
provenance caught three bad recommendations, and the plural sweep showed that several measured
distributions in the map are understated. Run both before acting on anything keyword- or
column-derived. **Run `derive_board_producer_fanout.js` too** before touching any board-rendering
surface — it's the one that catches a shared function with inconsistent frontend consumers (see
the recurring-failure-mode entry below); nothing else here checks that axis.

## What is decided vs open

**Ruled (panel findings section A):** A1 prints on shoes/accessories, A2 confident rationale under
scarcity, A4 shoe register span, A5 reasoning-then-interaction — all **accepted**. **A1, A2, A5
implemented and shipped 2026-07-28** (see this date's session entry above). **A4 deferred** —
owner is planning a capsule-logic redesign; register-span allocation belongs with that, not patched
separately first. A3 rejected (asking what you own is deliberate). A6 reframed — the `~$0.07`
labels are owner-facing instrumentation, not user pricing, so the question is tiers, not honesty.

**C3 ratified 2026-07-28** — now `AGENTS.md` Engineering Principle #7, not an open item.

**B1 partially ruled 2026-07-28** — the per-piece menu consistency question and the
occasion-exclusion visibility gap are closed (see session entry above); the remaining half
(narrating a chip's effect at the moment it fires) was tried, found to have real problems for the
structured-feedback-chip case, and the owner ruled the chip's own active-state color is sufficient
— not pursued further for that case.

**Not ruled:** B2 structured read, B3 diagnostic cards, C1, C2, C4, C5, D1, and which of E1–E6
become propositions. Recommended order is in the findings doc: **C3 was upstream of the B items,
now ratified — B2/B3 are next in that original order.**

**Stage 2** (Mode A craft review, per flow) not started. It should use the surface map's inventory.

## Read first, in order

1. **`docs/expert-panel-brief.md`** — the ratified panel protocol. Two modes: Mode A is craft
   review (proven on Wardrobe and Lookbook), Mode B is direction review over propositions (new,
   untested). Stage 1 for the Stylist is Mode B over the whole feature; Stage 2 is per-flow Mode A
   on whichever flows survive.
2. **`docs/stylist-bugfix-spec.md`** — everything found, fixed, and deliberately not fixed, with
   the owner rulings attached.
3. **`docs/ui-v1-design-handoff.md`** — the **Outstanding issues** and **Resolved, not open**
   sections. The second is copied verbatim into any panel packet; never paraphrase it (paraphrasing
   it once inverted it and cost a panel run).

## Hard rules

- **Never make a billed model call.** The owner is budget-constrained. Diagnose against the
  read-only database (`wardrobe.db`, 236 pieces) or with scratch scripts that call the real engine
  functions directly — see `scratch/diagnose_capsule_shoe_roster.js` and
  `scratch/build_dedup_fix_demo_thread.js` for the pattern. Both produce real engine behaviour with
  no AI call.
- **Do not kill anything on ports 3098/5174 without asking.** A previous session followed
  `CLAUDE.md`'s unconditional-restart rule and killed the owner's server mid-generation. That rule
  is still unamended and is what caused it. Port 3098 is frequently the owner's own **un-mocked**
  server.
- **`sandbox-web-asuser` (port 5176)** is the sandbox web server without `VITE_STYLIST_DEBUG` —
  use it for any "what does the owner actually see" question. `sandbox-web` (5174) has the dev flag
  on and shows engine internals no user ever sees.
- **`wardrobe-web` (5173) proxies to the live un-mocked API.** Browsing stored threads is free;
  clicking `Generate outfit image`, `Evaluate outfit`, or `Preview all directions` spends real
  money. Keep review agents off it entirely.

## Before generating panel evidence

**Clear the whole-wardrobe session recency memory**, unless the artifact is meant to show the
rotation mechanism — in which case declare it, with the skip count. The memory silently narrows the
pool (observed: 10 of 23 pieces skipped), and the only sign is one line in the composer footer.
**Include them again**, or `DELETE /api/ai/whole-wardrobe-session-memory`. Full rule in
`docs/expert-panel-brief.md` → Part 4.

## The recurring failure mode — read before reporting anything as a bug

Four times in one session, an absence was reported as a defect and turned out to be deliberate or
simply unbuilt:

- **Garment IDs in stylist prose** ("the tan leather tote (ID 12)") — requested, because garment
  names collide constantly, especially auto-tagger-written ones. The *presentation* is open to
  redesign; the disambiguation problem is not negotiable.
- **"city stroll" implying walking shoes** — by design.
- **One shoe carrying 7 of 8 capsule looks** — the 14-piece budget buys exactly 3 shoe slots
  (`capsuleQuotas`), one of which the register-floor guarantee spends on an evening-capable shoe.
  Correct behaviour.
- **Plans not absorbing their own revisions** — never built.

For any capsule- or plan-shaped question, start at `capsuleQuotas` / `selectCapsuleRoster`, **not**
at the per-slot gate. The gate, `PLAN_WORKBENCH_PIECE_LIMIT`, `planWorkbenchPieceScore`,
`fit_confidence`, and feedback influence all operate *after* the roster is chosen — an entire
investigation was spent in the wrong layer.

### A second failure mode, distinct from the one above — doc status claims go stale too

The four cases above are about *product behaviour* looking like a bug when it wasn't. This one is
about *a doc's own claim that something is still a bug* being wrong. Found 2026-07-28: an entire
section of `docs/stylist-bugfix-spec.md` ("§6, lower priority, same surface") listed four items as
open — a raw error string reaching the UI, a button-height CSS inconsistency, a missing
focus-return, and a styling gap in a chat component — and **all four had already shipped in
earlier PRs**. Nobody had gone back to update that spec once the fixes landed elsewhere. Worse:
the session immediately before this one **repeated one of those stale claims into new doc text**
(a "deliberately left unfixed" note in `docs/app-surface-map.md`) without checking the code first
— the exact same failure this project's docs keep warning about (measure one source, don't verify
against the current state), just applied to a doc's bug-status tag instead of a product behaviour.

**Before trusting any `[known bug]`, "still open", "not yet implemented", or similar status claim
in these docs — especially one you're about to cite, repeat, or build on — grep the code it names
and confirm the claim is still true.** A status tag is a claim about the state of the code *at the
time it was written*, not a live query. The docs get long-lived precisely because they're mostly
right; the failure mode is trusting the 5% that quietly went stale.

### A third failure mode — proposing structure that already exists, because the maps went unread

Found 2026-07-27, working panel finding B1 ("are chips a teaching mechanism"). The panel's packet
had no code access, so it argued from absence: chips "carry verdicts, not teaching," and offered
two synthesis proposals — a chip that opens a freeform note, and a chip that proposes a garment tag
edit. **Both already existed**, in a stronger combined form: the per-piece `Wrong for <occasion>`
chip is a one-click hard edit to `pieces.occasion_exclusions` (`docs/app-surface-map.md` lines
133-153), and `store_user_correction` from chat prose already surfaces as an editable, retirable
`owner_rule` in `StylistSettings.jsx`'s "Learned rules & preferences" (same doc, lines 860-882).
Neither is a secret — both are documented, with exact code locations, in the surface/engine maps.
An entire round of B1 analysis was written and delivered to the owner before either was checked.

That is a different mistake from the two above: not trusting a stale claim, but **skipping the
maps entirely when reasoning about what the product does or doesn't do.** The read-first list at
the top of this doc already says to read `app-surface-map.md` and `engine-behaviour-map.md` "before
assuming anything about the app" — this incident is what skipping that instruction looks like in
practice, mid-session, on a task that felt like open design discussion rather than "assuming."

**Before ruling on, redesigning, or filing as "missing" any B/C/D/E item in
`docs/panel-stage1-findings.md` (or any other proposition that claims the product lacks a
mechanism) — grep both maps for the item's key nouns first**: the feedback-taxonomy label, the
chip text, the tool name, the endpoint. If a mechanism doing roughly the job already exists, the
real question shrinks to whether it's complete/consistent/visible enough, not whether to build it.
This applies even mid-conversation, not just at session start — the maps don't go stale between
your first Read and your fifth tool call in the same session, so re-check them, don't rely on
memory of having glanced at the table of contents once.

## What shipped in PR #176

Legacy diagnostic cards leaking raw gate vocabulary; the `Useful repeats` label read from
structured `pieceReuse` instead of a keyword guess; look counts describing the plan rather than the
collapsed viewport; plan and whole-wardrobe responses no longer discarding the model's entire prose
answer; the canned "Outfit ideas for X…" line removed; engine field dumps kept out of the notes
disclosure; plans exempted from the outfit fold; raw slot ids removed from rail subtitles along
with a latent regex-alternation bug. Each has a regression test. Build passes; the suite sat at 6
known pre-existing failures at merge time — now 7 (see this session's note above; confirm with
`git stash` before attributing any new one).

## Panel artifacts

Real wardrobe (236 pieces): `thread_1784970885986` (14-piece capsule — the budget/declaration
case), `thread_1785005174812` (Tucson trip — clarify-then-plan, declared shoe economy),
`thread_1784240128734` (wedding — the one case where a live forecast actually resolved),
`thread_1785003920853` (today/dinner — conversational levers, and a within-session correction
landing next turn). Sandbox contrast (23 pieces): `thread_1784969942592`, `thread_1784969252663`.

## Open

- **Plan outfit cap does two jobs.** Approach decided — split by plan shape. **The research the
  number was waiting on is done (2026-07-25); the implementation still waits for Stage 1.** Full
  writeup in `docs/stylist-bugfix-spec.md` ("Research done 2026-07-25 — what the capsule number
  should be"); measurement scripts `scratch/diagnose_capsule_outfit_capacity.js` and
  `scratch/diagnose_capsule_supply_vs_selection.js` (real `selectCapsuleRoster` + real per-slot
  gate, read-only, no model call). Headlines:
  - **Pass `targetOutfits` on the slots** in any capsule diagnostic — it drives
    `capsuleDemandReserve`, and omitting it makes every low-register slot read about half as
    capable as the live plan is. This already produced one wrong set of numbers.
  - Real gate-valid capacity at budget 14 is **24** distinct cores against a naive 26, so the
    original "~25 combinations presented as 8" framing is **confirmed** — the cap undersells a
    14-piece capsule by roughly 3×.
  - **The wardrobe is not thin.** At the weakest slot (`casual_city_day`) supply is 44 eligible
    tops and 35 eligible bottoms; the roster bought 2 and 2. This is entirely a
    `selectCapsuleRoster`/`capsuleQuotas` question, not a "buy more clothes" one.
  - Capacity is **non-uniform per slot** (5 cores at `casual_city_day` vs 21 at
    `smart_casual_outing`), so a bigger total alone deepens the rich slots and makes the thin one
    repeat.
  - Capsule practice presents a **rotation, not an enumeration** — 10×10 is 10 pieces/10 outfits,
    3-3-3 is 9 pieces/9 base outfits, Project 333 lists no outfits at all; the big numbers
    ("15 pieces, 50+ outfits") are capacity claims, never lookbooks. All of these are *seasonal*
    capsules, and none varies its outfit count by season — supports a season-invariant cap.
  - Recommended, unratified: capsule cap = `min(piece_budget, 12)`; trips keep the day curve.
  - **New, unfiled defect signal:** winter at budget 14 with `targetOutfits` set leaves
    `evening_out` with 4T **0B** — zero possible looks. The everyday-tier demand reserve appears
    to crowd evening-capable bottoms out of the roster. Summer does not show it. Not investigated.
- **Lossy plan overview:** `getTripPlanOverviewRows` recognises only four line patterns, so the
  piece roster, budget verdict, and `plan trimmed` notices never reach the structured summary.
- **Revised plans unfindable in the rail — investigated, not fixed.** `threadMemory` is a single
  blob overwritten each turn (`StylistChat.jsx`'s `nextThreadMemory`); the rail's
  `getThreadOutcomeSummary` only ever sees the latest snapshot, so a plan revision (a lone
  `proposed` card) genuinely erases the prior plan's outfits from what the rail can summarize.
  There is no narrow fix available without first building the plan-revision merge itself, which is
  the deliberately-unbuilt feature above — do not attempt a rail-only patch here.
- **`explorationMode: 'aggressive'` is unreachable — needs a decision.** Six trust-relaxation
  clauses in `autoStylingTrustDecision` key on `explorationMode === 'aggressive'`, and **no call
  site anywhere passes that string.** The only non-default value produced is `'adventurous'`
  (`routes/ai.js:2158`, the saved-outfit *adjacent* variant), which fails the equality check. The
  two strings have separate origins (`c307a9b` vs PR #36) and were never reconciled. So "adjacent"
  mode changes prompt text only — it does not surface experimental or needs-fit-review pieces.
  **Decision needed:** align the strings, or delete the dead branch. Depends on whether adjacent
  mode is *meant* to loosen trust.
- **The import cost gate under-quotes tagging by ~1.6×.** `routes/importer.js` prices bulk tagging
  at **6,000** input tokens per garment — but `TAG_PIECE_PROMPT` alone is **6,097 tokens** before a
  single image is attached, and the real payload is **~9,880** (text + a ~2,220-token photo +
  ~1,557 tokens of anchor thumbnails). The output figure (1,400 vs a 2,500 cap) is only wrong if
  the tagger emits near its cap — unverified without a billed call, so treat input as the solid
  number. This is the one place the app asks permission before spending, and the gap **widens as
  you correct more pieces**, because the calibration anchor block grows with your corrections.
- **`casual` blocks 108 of 236 pieces on the register ceiling — 52 are also tagged `casual`, and
  provenance settles it.** ~~Earlier I suggested letting an explicit `casual` occasion tag override
  the ceiling.~~ **Withdrawn.** Of those 52 pieces, **49 have owner-corrected `formality`** and only
  **5 have owner-corrected `occasions`** — so for 47 of them the conflicting `casual` tag is
  auto-tagger output, and the override would let the tagger overrule you. `formality` is the most
  curated field in the wardrobe (**202 of 236** pieces hand-corrected); `elevated` has not drifted.
  What's actually left is the **5 pieces you tagged both ways** — a five-row list.
  ~~Raising `casual`'s ceiling to `elevated` remains a separate taste call.~~ **Also withdrawn** —
  `docs/occasion_profiles_ratification.md` shows you **ratified `casual → everyday` on 2026-07-05**,
  with the consequence written down at the time: *"the largest behavior change… would make
  park-friend, coffee, errands, and low-key social rosters reject `elevated` and `dressy` pieces."*
  The 108-piece exclusion is the intended, documented result of a decision you already made. The
  only live question is whether a given piece's `formality` is right — a tagging question.
- **`extract-pieces` output is trusted more than the tagger's, on less evidence.** The
  "identify every garment in this outfit photo" endpoint shares the tagger's schema but sends **no
  calibration anchors, no photo-authority rules, no `style_profile_json`, and no `_confidence`
  map** — so `getFieldConfidence` defaults its fields to **`medium`**, while the real tagger
  self-reports **`low`** on ~85% of the same fields. It also has no salvage on parse failure, logs
  the entire raw model response to the server log on every call, and instructs a shoe-only
  `delicate|slim|chunky` fabric-weight scale that `fabricWeight()` cannot read (returns `null`).
  That last one is **latent, not live** — no such value is in the DB, so it is being dropped before
  persistence.
- **[bug] The singular/plural gap — six core garment keywords never fire at all.** The engine tests
  word-boundaried **singulars** (`/\bloafer\b/`) against garment names that are overwhelmingly
  **plural** ("black slip-on loafers"). Swept across all 512 keyword literals in `styling-engine/`:
  **19 keywords miss 122 garments by name**, and `jean`, `sneaker`, `loafer`, `clog`,
  `pointed heel`, `tailored trouser` and `linen short` match **zero** pieces — while being
  referenced at 16, 8, 25 and 4 sites. `boot` is used at **28 sites** and matches **one** garment;
  `shoe` matches one while 33 garments are named "…shoes".
  **This understates numbers I reported earlier**: the "93% of outfits are shoe-shape `rounded`"
  result is largely this bug — 8 of 33 shoes leave the default bucket once plurals match. Profiles
  are unaffected (their lists are already plural and go through `pieceMatchesFootwear`); this is
  confined to hard-coded regexes. **Do not apply a blanket `s?` sweep** — measured both ways, it
  fixes shoe shape (93%→53% in the default bucket) but makes grounding strategy *worse*
  (47%→80%), because the newly-matching plurals all fall into one branch. The fix has to be
  judged per classifier, and `heel_height`/`walk_support` already exist as enums for the footwear
  question. **Re-measure any keyword-derived number with `node scratch/measure_plural_gap.js`
  before acting on it.**
- **Do NOT re-tag yet — owner ruling 2026-07-26, and I had this backwards.** I originally wrote
  "re-tag first, then fix the prompt." **Withdrawn.** This wardrobe has been re-tagged multiple
  times already; each pass is only as good as the tagger on that day, and the **167 unversioned
  pieces are the residue of previous re-tags**, not evidence one is overdue. Order is: **raise the
  tagger's ceiling first, re-tag once after.** The ~$11 cost is not the constraint — spending it on
  a tagger with known gaps is.
- **What would raise the tagger's ceiling** (full detail in the map → *Provenance → what would
  raise the tagger's ceiling*), all found by this mapping:
  1. **Anchors cover 2 of the gating fields.** `tagPieceWithProvider` anchors only `formality` +
     `fabric_weight` → 18 anchors. Adding **`occasions`** would give **49**, using **38 owner
     corrections that already exist and are currently unused**. One-line change — but two caveats:
     `occasions` is an array so each combination becomes its own bucket (38 corrections → 31
     near-unique anchors, which may read as noise not range), and more anchors means more tokens on
     a call already under-quoted 1.6×. Measure before shipping.
  2. **`heel_height` (0 corrections) and `walk_support` (4) can't be anchored at all** — both feed
     the activity footwear gate, and `heel_height` is 100% tagger-set. The missing input there is
     your corrections, not prompt text.
  3. **Only 8 of 18 anchors get a thumbnail**, and which 8 is bucket-iteration order, not
     importance. Worth making deliberate before a whole-wardrobe run calibrates against them.
  4. **The singular/plural gap is upstream of tagging** — the tagger writes `name`/`reads_as` and
     every keyword rule reads them; re-tagging into an engine where `jean`/`loafer`/`sneaker` never
     match spends money feeding classifiers that can't see the result.
  5. **`extract-pieces` emits no `_confidence` map**, so pieces added that way default to `medium`
     trust and undermine any confidence baseline a re-tag establishes.

  **Prior rulings checked across `docs/` before finalising any of this** (map → *Provenance →
  prior rulings a tagger spec must respect*). The load-bearing ones: optimising the tagger is
  **already owner-sanctioned as possibly the better first move**, framed as paying off across
  *every import path*, with the video-import decision downstream of it; *"AI retagging reports what
  changed, leaves results reviewable, and cannot race Save"* is **ratified**, so capture-then-apply
  is that principle at batch scale rather than a new idea; **nothing is retagged automatically, by
  design**; **worn-photo scope is an OPEN product decision** a spec must not quietly settle; and
  **any field change costs 9 wiring points with "tagger prompts x2" first** — which settles the
  scope question, `extract-pieces` travels with `tag-piece`.

  Evidence that the current prompt *does* work when it runs: where the photo-authority section ran,
  low-confidence `length_hits_at` falls from **81% (191/236) to 42% (24/57)**. And this is not
  "missing worn photos" — **176 of 236 pieces have one**, including 144 of the 191 low-confidence
  ones. The photos exist; the older tagger never classified them.
- **A provenance section and script now exist** (`node scratch/measure_provenance.js`, plus
  `measure_provenance.js <colA> <colB>` to cross-tab two columns). `formality` is 86% hand-corrected;
  `heel_height`, `recommendation_status` and `role_permission` are **100% tagger-set**. The tagger
  reports `low` confidence on ~85% of its own structural predictions, and low confidence doesn't
  suppress the value — it ships to the image prompt tagged `[low confidence - add worn photo]`.
  **Run this before resolving any conflict between two columns**; it is what caught all three of
  the recommendations I had to withdraw.
- **The editorial image prompt has no length clause — and "wrong length" is the top render
  complaint.** `anchorFidelityInstructions` derives every fidelity rule from `name + notes`, so:
  `length_hits_at` is populated on **207 of 236** pieces and produces **no length instruction at
  all** (the builder has no such clause); `sleeve_type` is populated on 207 and reaches 48;
  `pattern_type` on 228 and reaches 17 (stripe only — no floral/botanical clause). **49 pieces
  produce no anchor fidelity instruction whatsoever.** Meanwhile the renderer memory that gets
  appended to these prompts is *live and full of length corrections* ("prior render had … rendered
  too long"). The wardrobe knows the length, the prompt never states it, the correction arrives
  afterwards as feedback. Same shape as the Visual Composer athletic-pants incident. The
  whole-wardrobe path is fine here — `buildPieceText` carries these columns — so this is an
  asymmetry between the two prompts, and the fix is to build the editorial description from the
  same truth text. Also in that builder: it reads `selectedPiece.fabric`, **a column that does not
  exist**, so that line never renders.
- **The whole-wardrobe image prompt truncates piece truth text at 900 chars; the real median is
  1,130** — 169 of 236 pieces lose their tail, and the fields at the end of the string are
  `fit_on_body`, tuck behavior, occasions and trust status.
- **Image cost reporting has a hole, and A6 now has a factual answer.** The `~$0.07` figures are
  computed **client-side** (`StylistChat.jsx:315`), re-hard-coding the token rates and adding a
  **flat constant** for the image — `$0.08` at 1024x1536, `$0.04` at 1024x1024 — regardless of
  quality, model, or how many attempts the server made. The server's pricing table has **no image
  model in it at all**. And the editorial **`gpt-image-1` fallback renderer never sets
  `timings.usage`**, so the cost line returns null and a *billed* generation displays no cost
  whatsoever. Collage renders correctly show nothing (they are free), which is why the gap is easy
  to miss. Two small fixes: set `timings.usage` on the fallback branch, and either move pricing
  server-side or relabel "Measured cost" to reflect that the image term is an estimate.
- **A failing editorial render can attempt five billed generations.** `gpt-4o`, then the
  `gpt-image-1 → gpt-image-1.5 → gpt-image-1-mini → chatgpt-image-latest` chain, then an SVG
  placeholder. The other four image producers fall back to a free local collage after one attempt.
  Also worth deleting: a duplicate `photoPreservingVisualsEnabled` in `rules.js` that **ignores
  `WARDROBE_MOCK_AI`** — `routes/ai.js` imports that copy (never calls it, so mock protection holds
  today, but the image endpoints live in exactly that file).
- **The engine's strongest positive signals have never been switched on.** `pieces.favorite` is
  **0 of 236** and `saved_boards.favorite` (the Visual Lab's **"Use strongly"**) is **0 of 237**.
  That disables four scoring terms, including the `+45` high-authority board branch — against `18`
  for an ordinary positive board — and makes the `favorite = 1` clauses in two memory queries
  select nothing. Both controls are fully built and wired (heart on every PieceCard;
  `VisualLab.jsx:967`). **Not a code defect** — but worth knowing before concluding the memory
  system is weak, and a cheap experiment: marking a handful of boards "Use strongly" turns on the
  largest positive signal the engine has.
- **A five-outfit set cannot avoid the −45 formula-repeat penalty.** There are exactly four formula
  families for separates outfits (five archetypes, one dress-only), and two hold 82% of real
  combinations — so by the third look the selector is choosing which repeat is cheapest, not
  whether to repeat. Related: the pattern classifiers regex over piece *names* and never read the
  populated `pattern_type` column, so **30 of 90 patterned pieces read as solid** (`botanical`,
  `geometric`, `paisley`, `polka dot`, `lace` have no matching term). Fixing that would also lower
  the text-matching ratchet count.
- **Two `planWorkbenchPieceScore` weights are provably decoration** — removing the
  `role_permission` +20 gives a byte-identical top-40; removing the `trusted` +50 moves one piece
  of 40. Tested, not inferred (`scratch/measure_open_questions.js` Q3). No action needed unless the
  weights are being tuned; then start with the four that actually order it.
- Smaller: the `All looks distinct` label branch unverified (not worth a billed call).
- **Legacy `message`-type feedback can't find its own thread or board, even when both still
  exist.** Found 2026-07-28 tracing a real Style Profile row (`wardrobe.db` id 340, a `works` /
  `Gold` entry on "dark grey gathered mini dress"). Its `target_type` is `message` (a thumbs-up on
  a chat reply, not a whole-wardrobe-outfit correction), and the rendered image is embedded as
  **inline markdown in `payload.text`**
  (`![Belted Definition](sandbox:/uploads/generated-boards/whole-wardrobe-...png)`) rather than in
  a structured `payload.board.imageUrl` field. Both `matchedFeedbackBoard` and
  `referencedThreadForFeedback` (`routes/crud.js`) only ever look at the structured fields, so they
  come up empty — even though grepping the embedded filename against `saved_boards.image_url` and
  `chat_threads.payload` found an exact match on both (board id 224 "Belted Definition", thread
  `thread_1784016944304`). The links exist; nothing extracts them. Likely affects a whole class of
  older `message`-type feedback rows saved before the app started writing structured board/thread
  references. Fix shape: extract the image filename from `payload.text` via regex (same style as
  `readableFeedbackNote`'s own markdown-stripping regex, which already parses this exact pattern
  for *display*, just discards the match instead of using it to look anything up) and match it the
  same way `matchedBoardByPieceSet` matches on piece sets. Not started.
