# App surface map

**Status:** first pass complete, 2026-07-26. 28 entries covering every route, tab, mode-split and
dialog group found by `scratch/derive_surface_skeleton.js`. Thin spots are listed at the bottom
rather than hidden. Owner review welcome — an entry that reads wrong probably *is* wrong.

## What this is for

Three readers, one document:

1. **The owner**, to check it. If a feature is missing here it is probably missing from every
   panel packet too. If an entry says something surprising, that is the point — several behaviours
   below do not work the way they look like they work.
2. **Panel packets**, which must state which surfaces they included and which they excluded. Stage
   1 shipped without Settings, the per-piece menu, and Style Profile, and three reviewers
   concluded a capability did not exist when it did.
3. **Any agent working here**, so that "where does this data live" is a lookup rather than a guess.
   Every measurement error in the 2026-07-25/26 session came from not knowing a capability had two
   stores.

Each entry: what it is in plain English, then what *actually* happens, then the stores it touches.
Read the plain-English part; the store block is a footnote for whoever is writing code.

**Every observation carries a tag, and the tags are the point:**

- **[by design]** — intended, ruled on, or a deliberate tradeoff. Surprising is not the same as
  wrong. Do not "fix" these; see the *Deliberately not built / by design* list in
  `ui-v1-design-handoff.md`.
- **[known bug → ref]** — a real defect, already diagnosed, with a pointer to where it is tracked.
  It behaves this way today and is not meant to.
- **[unverified]** — measured or inferred but not confirmed, with what would settle it.

Untagged prose is description, not judgement. This matters in both directions: a session once
reported four intended behaviours as defects, and this document then described a deferred bug in
the same neutral voice as design. Both errors are cheap to make and expensive to act on.

**Not** a replacement for `docs/flows/` (model-facing flows as Mermaid) or `AGENTS.md`'s project
shape. This is *what exists, how you reach it, and where its data lives*.

---

## Stylist → board feedback chips

**How you get there.** Inside a Stylist chat thread, under any generated visual board, **on all
four surfaces that can render one** (as of 2026-07-27 — two of the four had no feedback UI at all
until that date; see the surface table below): a verdict row (*Signature / Works / Almost / Not
me*) and, behind **More feedback**, grouped reason chips (*What feels wrong?*, *Fit and shape*,
*Problems in the generated image*).

**What you are doing.** Telling the stylist whether a rendered look worked, and why not.

**Four rendering surfaces, previously two of them silent — now consistent:**

| surface | how you get one | chips? |
|---|---|---|
| Structured outfit card's rendered image (`boardResults[boardKey]`) | "Generate outfit image" on a direction/plan card | yes — full taxonomy |
| `editorialVisualResults` | "ideal pieces" suggestions | yes — full taxonomy |
| `m.renderedBoards` | the model's own `render_preview` tool call mid-answer | **[fixed 2026-07-27]** — was Save-button-only |
| `boardResults[i]` ("wardrobe-board") | the ad hoc **Generate visual boards** button under plain prose | **[fixed 2026-07-27]** — was Save-button-only. Failure text on this surface is already translated to plain language by `friendlyBoardErrorMessage` (shipped in #175, before this fix) — corrected here 2026-07-28 after wrongly re-flagging it as raw/open, see `docs/stylist-bugfix-spec.md` §6 |

There was never a `[by design]` ruling for the old split — the existing "no chips on plain-text
replies" ruling (see the message-level-actions entry below) is about judging *prose*, not about
the rendered *image* that appears after you act on it. The two silent surfaces now use the exact
same `GENERATED_BOARD_FEEDBACK_LABELS` taxonomy and the same canonical-board read/write path
(below) as the two that already had it — same keying pattern, one feedback card per rendered
board, keyed off that surface's own save key (`render-preview:${i}:${boardIdx}` /
`wardrobe-board:${i}:${idx}`).

**What actually happens:**

- **[fixed 2026-07-27, was: known bug]** Chat and Visual Lab used to show different selected
  chips for the same board — Visual Lab always read the canonical `saved_boards` record live;
  chat read a snapshot frozen into the thread at the moment feedback was given, restored on load
  and never re-checked, so editing a board's feedback in Visual Lab was invisible to any chat
  thread showing that board. Full writeup and fix in `docs/board-feedback-desync-spec.md`. Chat
  now indexes saved boards by `imageUrl` on mount and on every thread load/save
  (`refreshSavedBoards`, `StylistChat.jsx:1389`), and once a board is saved, both reads and writes
  for its chips branch through the canonical `saved_boards` record via `PATCH /api/saved-boards/:id`
  — the same mechanism Visual Lab itself uses — instead of the old `stylist_feedback`/thread-
  snapshot path. Unsaved boards keep using that old path, since there's no canonical record yet.
  Verified live both directions: a verdict set in Visual Lab appears in chat on next thread load
  with no chat-side click, and un-toggling it in chat deletes it from `saved_boards.payload` too,
  not just the local snapshot.
- **[fixed 2026-07-27]** The wrong-length correction widget (`GeneratedBoardLengthFeedback`,
  `StylistChat.jsx:27`) used to make you pick a garment first, then pick what was wrong with it —
  a single shared pointer that silently reset to the first piece every time and never indicated
  which piece actually had a saved correction, so a correctly-stored correction on a second or
  third garment looked missing unless you happened to click through to it. Now every piece on the
  board gets its own always-visible reason group, each showing a `(n)` count when it already
  carries corrections, driven directly by `feedback_details.wrong_length` — no picker, nothing to
  reset. Same fix applied to the matching widget in Visual Lab (see that entry below). Reason
  options are also filtered by `piece.category` now (`lib/feedbackTaxonomy.js`'s
  `wrongLengthReasonsForCategory`) — shoes and accessories get no length options at all, tops/
  outerwear get sleeves + their own hem, bottoms get only the skirt/pants hem, dresses get sleeves
  + the skirt/dress hem (not "jacket hem").
- **[by design] Feedback given in Visual Lab reaches the model in full — verdicts *and* specific
  reasons.** Traced end to end 2026-07-26 by running the real builder against the real wardrobe.
  A board carrying `feedback_details.shape_balance` renders into the prompt as:
  *"Winery Chic Escape [not_me, shape_balance] | pieces: … | **shape and balance issue: too much
  overall volume; waist or shape was lost; top and bottom felt unbalanced**"*. Positives arrive
  under *"Bias future outfit suggestions toward these successful formulas"*, negatives under
  *"Avoid repeating these drift/problem patterns"*. About 3.2 KB of memory text on the current
  wardrobe. **This is the working path — feedback given here is not lost.**
- **[by design]** The `stylist_feedback` mirror is **not** how reasons arrive, which is why it does
  not matter that none of the 367 rows carries a reason key. `getSavedBoardMemory` reads
  `saved_boards.payload` directly. The mirror written by `syncStructuredReasonsFromSavedBoard` is
  redundant for exactly this reason and was correctly found inert.

**[by design] Costs nothing.** Feedback actions never call a model.

> **Stores.** For an unsaved board: writes `stylist_feedback` (via `POST /api/stylist-feedback`)
> and `thread.payload.feedbackSaved`, a `Set` of composite keys inside the thread row; reads only
> the latter. For a board already in `saved_boards` (post 2026-07-27 fix): reads/writes
> `saved_boards.payload.feedback_labels` / `.feedback_details` directly via
> `PATCH /api/saved-boards/:id`, mirroring Visual Lab's own write path.
> `StylistChat.jsx:3460` (unsaved-board path), `refreshSavedBoards`/`canonicalBoardFor`/
> `toggleCanonicalBoard*` helpers around `:3467-3546` (canonical path).
>
> **Delivery to the model.** `getSavedBoardMemory` (`styling-engine/rules.js:660`) reads
> `saved_boards.payload` and renders verdicts plus specific reasons into plain language. Spliced at
> `styling-engine/core.js:2683` → used at `:2737`, and `routes/ai.js:1108-1109` → used at `:1116`
> (per-garment, "high-authority outfit memory") and `:1119` (global, "should bias ranking").

---

## Stylist → per-piece `…` menu

**How you get there.** The `…` button under any garment thumbnail on an outfit card.

**What you are doing.** Correcting the stylist at the level of one garment in one outfit, rather
than judging the whole look.

**What actually happens.** **[by design]** Three options, and they are three genuinely different
mechanisms with three different blast radii:

- **Edit item card** — opens the garment editor. Changes the wardrobe record itself, so it affects
  every future outfit, not just this one.
- **Swap this out** — records that this piece was the wrong choice *in this outfit*. Scoped to the
  look; does not change the garment.
- **Wrong for `<occasion>`** — a hard, durable exclusion: this garment will not be offered for this
  occasion again, anywhere. A toggle, so clicking again removes it, and it confirms with a toast
  reading *"won't appear for `<occasion>` again"*.

**[by design]** The occasion exclusion is one of the few places a chat interaction writes a **hard
constraint** to a garment record rather than a soft memory the model may or may not weigh.

**[fixed 2026-07-27, was: three actions with radically different permanence, styled identically]**
Menu items are now two-line (bold label + a plain-language consequence sentence), and a divider
separates the two per-outfit-scoped actions (*Edit item card*, *Swap this out*) from the one
cross-context hard edit (*Wrong for `<occasion>`*), which also gets a slightly bolder label. No
change to the card itself — the explanation only exists inside the already-hidden `···` menu, so
resting-state density is unaffected. Owner ruling: keep all three together (they're all genuinely
piece-level actions; splitting into separate menus would add clicks for no reason) but make the
consequence legible at the point of choice rather than only via native `title` hover-tooltips,
which the menu relied on before and which don't work on touch and are easy to miss.

**[fixed 2026-07-27, was: trigger easy to miss, and both the trigger and the panel could be
clipped]** Two more owner-caught defects on this same control:
1. **The trigger read as an ellipsis, not a button.** Three literal periods (`...`) look like a
   truncation mark, not a "more actions" affordance — both the expert panel and the earlier
   mapping session missed that this menu existed at all, which is a stronger discoverability
   signal than any usability heuristic. Swapped for the vertical-dots kebab (`⋮`), the standard
   overflow-menu glyph, with slightly stronger border/color contrast at rest (previously
   `--text-light`, the palest token in the app, doing double duty as "quiet" and "invisible").
2. **The panel could be clipped on every edge.** It rendered as an absolutely-positioned child of
   the outfit card, which uses `overflow: hidden` for its rounded corners — so a piece near the
   left, right, *or bottom* edge of a card had its menu cut off, regardless of any centering math.
   Rewritten as `PieceActionMenu` (`StylistChat.jsx`), a small controlled component that portals
   the panel into `document.body` and positions it from the trigger's real `getBoundingClientRect()`,
   clamped to the viewport on every side and flipped above the trigger when it doesn't fit below.
   Also closes on outside click, Escape, and scroll/resize, and (since each instance owns its own
   outside-click listener) opening a second menu closes any other one already open — no explicit
   shared state needed. Verified live in the sandbox: leftmost/rightmost pieces no longer clip
   horizontally, a trigger placed within a few px of the viewport bottom now opens upward and
   stays fully on-screen (confirmed by measuring the rendered panel's rect), and outside-click/
   Escape/second-trigger-closes-first all behave correctly. `node --test` held at the 7
   pre-existing baseline failures throughout.

**[fixed 2026-07-27, was: three flat, unlabeled actions]** Owner mocked up a categorized version
and it shipped, with two adjustments made before building it:
- **Grouped under three quiet section headers** — Piece information / Outfit pairing / Occasion
  rule — each item now has a small line icon (pencil / swap-arrows / circle-slash) plus its label
  and explanation. *Edit item card* → **Edit piece details**; *Swap this out* → **Replace in this
  outfit**.
- **The occasion-rule item is not styled as an alert.** The mockup used a solid red/pink alarm box
  with a prohibit icon; that reads as an error state (something went wrong) rather than a
  deliberate, intentional action, and would be the only red anywhere in an otherwise uniformly
  quiet UI. Kept as a labeled section with a bolder label instead — same distinction, no alarm
  tone.
- **The "Replace in this outfit" copy was corrected against the actual mechanism before shipping.**
  The mockup read *"avoid suggesting this same pairing again"* — traced the code
  (`getWholeWardrobeFeedbackMemory` in `rules.js`, `wrong_item_read` branch) and confirmed
  `focusedPieceId` is set on this payload, so the penalty lands on **the piece itself** (with an
  extra 1.35× weight, stronger than ordinary feedback) and its formula-family combination — not
  specifically "this pairing." Corrected to *"steers your stylist away from choosing it as often"*,
  which is what the scoring code actually does. Shipping the mockup's literal wording would have
  been a real, if small, overclaim — the same class of honesty problem as under-narrating a hard
  edit, just in the other direction.
- The **onboarding coach-mark tip** and the **hover/keyboard-focus tooltip states** from the same
  mockup are not built — they need real state (has this user seen it, which piece/card triggers
  it, dismissal persistence) and are tracked as a separate follow-up, not bundled into this pass.
- Verified live in the sandbox by reading the rendered panel's `innerText` directly (screenshot
  timing in the test harness was unreliable mid-session, so this was the load-bearing check): all
  three section headers, icons, and the corrected copy render exactly as authored. `node --test`
  held at the 7 pre-existing baseline failures — two transient overshoots during this pass (a
  reverted rename check, a hard-coded sub-12px group-label font-size) were both caught and fixed
  before landing.

**[fixed 2026-07-27, owner-caught, two rounds]**
1. **The occasion-rule active state was still red.** The categorized menu used the same shared
   `.active` class (danger red/pink) as *Replace in this outfit* for its toggled-on state — same
   alarm-reads-as-error problem as the mockup's box, just carried over from pre-existing styling
   instead of introduced by the redesign. Gave it its own accent-toned active class instead.
   **Owner asked for `Replace in this outfit`'s active state to match** — both now share
   `piece-action-menu-item-quiet-active` (renamed from the occasion-rule-specific name once it
   applied to both). Live-verified: both read `rgb(104, 77, 98)` (the app's accent color) when
   toggled on, no red left on either.
   - **While checking where a "Replaced in this outfit" flag shows up afterward** (asked directly):
     Visual Lab → Style profile → **Outfit & styling feedback**, filterable by type. Found the
     entry existed but under the raw engine label `wrong item read` — a second small instance of
     the jargon-leak this whole session has been chasing. Added `FEEDBACK_TYPE_DISPLAY_LABELS` in
     `StylistSettings.jsx` so it reads **"Replaced in this outfit"**, matching the chat menu's own
     words, in both the card label and the type filter dropdown.
   - **Owner follow-up: the row's "Open garment" link isn't useful for this correction type** —
     it lands on the piece in isolation, no outfit, no "why." Every `wrong_item_read` row already
     carries a `threadId` in its payload (`saveStylistFeedback` auto-attaches
     `currentThreadId`) and the backend already derives `referenced_thread_id` from it generically
     (`referencedThreadForFeedback` in `routes/crud.js`) — the data existed, `canOpenGarment` was
     just unconditionally winning over `canOpenThread` in the button-choice logic. Reordered so
     the thread link (labeled "Open source chat") wins whenever one survives; garment is now only
     the fallback for rows with no reachable thread (e.g. an archived/deleted one). Live-verified:
     triggered a real "Replace in this outfit" from the chat, confirmed the resulting row's
     `referenced_thread_id` populated correctly and the Style Profile card showed "Open source
     chat" with no "Open garment" button.
   - **Owner caught a second bug in the same flow, immediately after**: the label was fixed but
     the *click* still opened the garment editor. Root cause: `canOpenThread`/`canOpenGarment`
     only controlled which **button text** rendered — the actual handler,
     `openFeedbackContext`, had its own independent priority order that still checked
     `wrong_item_read` → garment **before** checking `referenced_thread_id`, so clicking
     "Open source chat" ran the garment branch anyway. Classic label-fixed-but-action-didn't
     bug — the two lived in different functions and only one got reordered. Reordered
     `openFeedbackContext` to match: thread first, garment fallback second. Confirmed the
     inconsistent buttons visible on real rows (`wardrobe.db`, read-only check: rows from
     2026-07-18 and earlier have no `threadId` in payload at all, predating when
     `saveStylistFeedback` started attaching it; rows from 2026-07-26 on do) are not a bug —
     that's the correct, honest fallback for corrections made before thread-linking existed.
     Live-verified the actual navigation this time, not just the label: clicking "Open source
     chat" now lands on `/stylist/thread_...`, no garment modal.
   - **Owner follow-up: for the threadless rows, prefer the saved Visual Lab board over the bare
     garment page too.** `wrong_item_read` payloads carry no board image (they're feedback on the
     outfit card, not a rendered board), so the existing imageUrl-based board match
     (`matchedFeedbackBoard`) never applies to them — but `GET /saved-boards` already returns
     `linked_piece_ids` per board (via `collectPieceIdsFromSavedBoardRow`, used elsewhere for the
     piece-scoped board query), so a saved board's piece set is a free, already-computed
     fingerprint for "this exact look." Added `matchedBoardByPieceSet` in `StylistSettings.jsx`:
     compares the row's `payload.pieceIds` (sorted) against each saved board's `linked_piece_ids`
     (sorted), client-side, no backend change. **Only trusted on an exact, unambiguous match** — if
     more than one saved board has the identical piece set (the same look saved twice), it falls
     through to garment rather than guessing, the same caution `referencedThreadForFeedback`
     already applies server-side for its own fallback case. New priority: thread → piece-matched
     board → bare garment. Live-verified both branches: a threadless row whose piece set matched
     a real saved board ("Friends Hangout", id 14) showed "Open board" and navigated to
     `boardId=14`; a threadless row with a piece set matching nothing correctly still fell back to
     "Open garment."
   - **Owner found two more gaps, on the real `wardrobe.db`, immediately after.** First: many
     contextual-feedback rows have **no button at all** — `bad_occasion` and similar
     `whole_wardrobe_outfit`-scoped types, `context_type: 'wardrobe'` (no single piece/outfit to
     jump to), old enough to predate thread-linking, and with a `textOnly: true` payload meaning
     no board was ever rendered for them either — genuinely nothing left to link to. Broadened
     `matchedBoardByPieceSet` from `wrong_item_read`-only to any `target_type:
     'whole_wardrobe_outfit'` row (helps some, not all — the specific row checked, id 232, has no
     matching board because none was ever saved for it). For the remainder, added a **Remove**
     button (reuses the existing `DELETE /api/stylist-feedback/:id`, same endpoint already used
     elsewhere) always present alongside whatever Open-X button does or doesn't apply — matches
     the "Retire" affordance already standard on Learned rules. Live-verified: created a row with
     an unmatchable piece set, confirmed only "Remove" rendered (no Open-anything), clicked it,
     confirmed the row vanished from the list **and** from a fresh `GET /api/stylist-feedback`
     (hard-deleted, not just hidden).
   - **Second: what is the "dark grey gathered mini dress" / `Works · Gold` entry?** Traced on
     `wardrobe.db` (id 340): `feedback_type: 'works'`, `target_type: 'message'`, `context_type:
     'piece'` (257) — a different shape entirely from the whole-wardrobe-outfit rows above. Its
     "Open garment" comes from the generic `canOpenContext` path (context is a piece), not from
     any wrong-item/board logic. Genuinely interesting finding while tracing it: the row's raw
     note has the rendered image embedded as inline markdown
     (`![Belted Definition](sandbox:/uploads/generated-boards/whole-wardrobe-1784018070308-...)`)
     rather than a structured `payload.board.imageUrl` — and **both a matching saved board (id
     224, "Belted Definition") and a matching thread (`thread_1784016944304`) actually exist**,
     found by grepping the embedded filename against `saved_boards.image_url` and
     `chat_threads.payload`. Neither is linked today because `matchedFeedbackBoard` and
     `referencedThreadForFeedback` only look at structured fields
     (`payload.board.imageUrl`, `payload.threadId`), not text embedded in `payload.text`. Real,
     larger gap — extracting the embedded image path from legacy `message`-type feedback and
     matching it the same way would recover thread/board links for a whole class of old rows —
     but scoped as a follow-up, not bundled into this pass.
2. **"Edit piece details" stopped opening the editor** — a real regression, and a genuinely
   interesting one: it only reproduced under a **real, physically-dispatched click**, not a
   synthetic `dispatchEvent`, which is why the first verification pass missed it. Root cause: the
   portal panel closed itself via an `onClickCapture` on its wrapper — a capture-phase side effect
   racing the target button's own bubble-phase `onClick` under genuine pointer input. Fixed by
   removing the capture-phase auto-close entirely; `PieceActionMenu`'s children are now a render
   prop (`{ close }`) and each action calls `close()` itself, in its own handler, before doing its
   real work — no race, no ambiguity about ordering. Re-verified with an actual dispatched click
   (not scripted) this time. `node --test` held at 7 throughout both rounds.

**[fixed 2026-07-27, was: no visibility anywhere]** Until this date, `occasion_exclusions` had no
view or undo path outside the chip itself — and the chip stops appearing for that exact
piece/occasion once excluded, so a false positive was effectively unreachable through normal use.
Visual Lab → Style profile → **Occasion exclusions** now lists every current exclusion with a
**Restore** button. See `docs/panel-stage1-findings.md` → C3 for how running the decision rule
against this already-shipped mechanism (rather than a new proposal) is what surfaced the gap.

> **Stores.** *Edit item card* → `pieces` via the editor. *Swap this out* → `stylist_feedback`
> (`feedback_type: 'wrong_item_read'`, scoped to the piece and outfit). *Wrong for X* →
> `POST /api/pieces/:id/occasion-exclusion` → `pieces.occasion_exclusions`.
> `StylistChat.jsx:2962`, `:2994`, `:2998`, `:3515`.

---

## Visual Lab → Style profile

**How you get there.** Visual Lab → **Style profile** tab (`/visual-lab?section=profile`).

**What you are doing.** Reading and correcting the stylist's working understanding of you, in
plain text. Four layers, each expandable, each editable, each with **View history**: Body &
Comfort Contract, Proven Formulas, Aesthetic Gravity, Style Lanes. Layer 3 also offers **Redo
interview**.

**What actually happens.**

- **[by design]** **These are prompt text.** What you type here is interpolated into the system
  prompts that compose outfits and images. Editing a layer changes future recommendations
  directly — the most powerful control surface in the app, presented as a settings page.
- **[by design]** **Layer 2 is descriptive, not prescriptive.** Its own heading says so, and the
  unpersonalised default reads *"No proven formulas recorded yet — formulas are earned from
  confirmed outfits, not assumed."* Yours is personalised and contains real formulas.
- **[by design] All four layers reach every composition prompt, not just the image prompt.**
  Traced 2026-07-26. Layer 2 is interpolated into eight templates —
  `STYLIST_SYSTEM` (freeform chat), `STYLE_SELECTED_ITEM_SYSTEM`, `GENERATE_OUTFIT_IDEAS_SYSTEM`,
  `OUTFIT_COMPOSER_SYSTEM`, `OUTFIT_BOARD_PLANNER_SYSTEM`, `EDITORIAL_NEW_PIECES_SYSTEM`, and
  `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM` (twice) — plus the editorial image prompt at
  `core.js:3035`. So editing a layer changes outfit *composition*, not only how images are drawn.
  Layers are loaded per user and cached, invalidated on any write (`promptRuntime.js`), so an edit
  takes effect on the next request.
- **[by design] "This is a confirmed formula" is the model's phrasing, not a quotation.** Neither
  the owner's Layer 2 nor any prompt template contains the phrase. What Layer 2 *does* supply is
  the vocabulary: it is headed *Proven Formulas*, the unpersonalised default says formulas are
  *"earned from confirmed outfits, not assumed"*, and it defines *"Confirmed Outfit Lookbook =
  saved/confirmed outfits in the app DB"*. So the model is paraphrasing Layer 2's own framing
  correctly rather than inventing a memory receipt — but it is a paraphrase, and it names neither
  which formula nor where it came from. **Not a hallucination; not a citation either.**
- **[unverified]** Across 154 recent outfits, bottoms were ~70% relaxed or A-line and the most
  common pairing was a *drapey* top over a relaxed bottom — not the fitted-over-flowing shape Layer
  2 describes, and the shape the critique surface flags as flattening the silhouette. **27% of tops
  had no fit attribute**, and whether `skims` counts as fitted is a judgement call, so this is a
  signal to chase, not a finding.

> **Stores.** Reads `GET /api/settings/constitution`; writes `PUT /api/settings/constitution/:layer`
> with history at `GET /api/settings/constitution/:layer/history`. Layer text is exported to prompts
> as `BODY_CONTRACT`, `PROVEN_FORMULAS`, `AESTHETIC_GRAVITY`, `LANE_NEUTRALITY`
> (`styling-engine/prompts.js:1237`, defaults in `constitutionSeed.js`).
> `routes/crud.js:1437/1455/1477`, `VisualLab.jsx:557`.

---

## Stylist → the four entry points

**How you get there.** Four routes in, and which one you used changes what the stylist starts with:

- **New chat** (`/stylist`) — the landing page, with the Visual Composer brief.
- **Ask stylist about this piece** — from a garment card or garment detail in Wardrobe.
- **Ask stylist about this outfit** — from an outfit in Lookbook.
- **Generated Outfits → Visual Composer** — from Lookbook's generated collection.

**What actually happens.** **[by design]** Each seeds a different `activeContext` (`piece`,
`outfit`, or wardrobe-level), and the landing panel, the available actions, and the thread's title
and rail grouping all follow from it. The outfit and piece panels differ because the starting
object and available decisions differ — do not assume every thread began with an outfit.

> **Stores.** `App.jsx:134/139/144` hand the context to `AskClaude` → `StylistChat`. Persisted in
> `chat_threads.payload.activeContext`.

---

## Stylist → outfit direction card, and its paid actions

**How you get there.** Every generated look renders as a card: garment thumbnails, a rationale
behind **Why this outfit**, and an action row.

**What actually happens.**

- **[by design] Cost is opt-in.** Nothing renders an image until you ask. A card shows real
  wardrobe photos and, on editorial ideal-additions cards, a free CSS croquis sketch, a
  plain-language thesis line, and a **Full look:** description — all free, all intended to let you
  choose a direction before paying.
- **[owner check wanted] Price labelling is inconsistent across the three render-button variants.**
  One reads `Generate outfit image (~$0.07)` (`:3129`); the other two read `Generate outfit image`
  with no price (`:3098`, `:3143`). Same action, same cost, three labels.
- **[owner check wanted] `Evaluate outfit` is a paid model call and is never priced anywhere.**
  Neither is the generation that produced the card. The `~$0.07` labels were added as owner-facing
  instrumentation, not as a user pricing scheme — see outstanding issue on cost visibility.
- **[by design] `Preview all directions (~$0.07)` costs the same as rendering one card.** So
  rendering three directions individually costs three times as much as the batch. The batch sits
  below the free compare strip.

> **Stores.** Rendered boards land in `saved_boards`; evaluation results in the thread payload
> (`evaluationResultsByKey`, `evaluatedKeys`). `StylistChat.jsx:3098/3105/3129/3143/3154`, `:2619`.

---

## Stylist → critique and "More detail"

**How you get there.** `Evaluate outfit` on any card, or *Ask stylist about this outfit* → review.

**What actually happens (B2 ratified 2026-07-29).** The default reply is `userCritique`: a
plain answer, short reason, one action, and an observable check. The internal marker remains
`--- Full structured read ---` for saved-text compatibility, but the UI labels the disclosure
**More detail** and renders it as Markdown.

For new evaluations, that disclosure is a purpose-written `detailedCritique`: four connected
paragraphs produced in the same evaluator call. It explains intent and occasion, fit and
proportion, relevant visual relationships, then the diagnosis and recommendation. It is not a
formatter concatenation of the diagnostic fields. Older saved evaluations without
`detailedCritique` still fall back to the prior structured-field read.

**[owner ruling 2026-07-29]** Keep `Visible facts`: it records what the model believed it saw and
makes a wrong critique diagnosable. It remains in the stored `evaluation` object rather than being
repeated wholesale in **More detail**. The owner accepts the current occasional stylist shorthand
and internal-provenance language for now. Corrections happen through follow-up conversation;
`Intent` is not a separate editable control.

> **Stores and follow-ups.** The evaluation object stores `visibleFacts`, `userCritique`, and
> `detailedCritique`. Immediate follow-ups receive the recent critique through chat history plus a
> compact evaluation memory (intent, verdict, floor line, fit placement, shoe read, first issue,
> recommendation) and display an ordinary short chat answer. The current backend nevertheless
> runs those turns through the full evaluator contract; an answer-only follow-up contract is a
> pending cost optimization. Built by `formatSharedOutfitEvaluation`.

> **Cost boundary.** B2 is one provider call. It removes redundant generated prose rather than
> adding a rewrite call, and formal before/after token proof is not a ratification gate. Pending
> optimization work: cache the stable evaluator prompt, expose input/output/cache usage, use the
> lean follow-up contract above, and protect exact retries with a short-lived result cache. Cache
> stable image/evidence blocks only if measurements justify it.

---

## Stylist → plan responses (trips, capsules) and Stylist's notes

**How you get there.** Ask for a trip, a capsule, or any multi-occasion set. The reply renders as a
plan: a header, an overview block, then looks grouped by slot.

**What actually happens.**

- **[by design]** Plans are exempt from the "Show N more outfit results" fold — a plan is one
  artifact and renders whole. Ordinary multi-result replies still fold at four.
- **[by design] Stylist's notes** below the cards carries the model's own written answer — the
  declared constraints, the piece roster, the budget verdict, the honest gaps and the levers for
  changing them. For plan and whole-wardrobe replies this prose was previously discarded entirely;
  it is now rendered below the cards so comparison imagery still leads.
- **[known bug → outstanding issue, lossy plan overview]** The structured overview shows only a
  subset of what the engine computed. The piece roster, the budget verdict (`Within the 14-piece
  budget`), and `[plan trimmed: …]` notices are all present in the response data and never
  rendered — `getTripPlanOverviewRows` recognises only four line patterns.
- **[by design]** Plan revisions are **not** merged back into the plan. Ask for a change and the
  revision arrives as separate cards beside it. Never built; judge whether it should exist rather
  than reporting its absence.

> **Stores.** `chat_threads.payload.messages[].structuredOutfits`, with `tripPlanLines` and
> `pieceReuse` attached per outfit by `styling-engine/outfitSetPlanner.js`.

---

## Stylist → response chips and the thread header

**How you get there.** The chip row under each structured reply, and the subtitle beside the page
title.

**What actually happens.**

- **[by design] The chips are the brief, played back.** Occasion, season, style direction, activity,
  *New-piece ideas*, *Wardrobe only* — drawn from the reply's stored `queryOptions`, deduplicated,
  capped at four. They are a record of what the request was interpreted as, which is the only place
  that interpretation is visible.
- **[by design]** Activity is shown **only when it is not `none`**, so a chip row without one means
  no activity gate was applied. Absence is information here.
- **[owner check wanted]** Because unset selectors still carry their defaults, a freeform ask
  displays chips it never chose — most visibly `Casual` on a capsule request. The chips look like a
  summary of your intent and are partly a summary of untouched form state.
- **[by design]** The header subtitle counts **exchanges** — `ceil(chatHistory.length / 2)`, i.e.
  user/assistant pairs — and only on wardrobe-level threads, not ones anchored to a piece or
  outfit. The piece count beside it is the whole wardrobe, not what the stylist can currently see;
  the recency memory can be skipping a large share of it (see the composer footer entry).

> **Stores.** `message.queryOptions`; `getResponseChips` (`StylistChat.jsx:1726`); subtitle at
> `:5078`.

---

## Stylist → thread rail (chat history)

**How you get there.** The left column of the Stylist page. On mobile it is a drawer behind
**History**.

**What actually happens.** **[by design]** Two views of the same threads — **Recent** (flat, newest
first) and **By outfit/piece** (clustered under the subject) — plus **Archived conversations** as a
separate mode.

- **[by design]** Row titles and subtitles are *derived*, not stored: `getThreadDisplayTitle` and
  `getThreadOutcomeSummary` (`src/utils/threadGrouping.js`) build them from the thread's own
  memory. A thread has no title of its own unless you rename it.
- **[by design]** The subtitle counts *looks*, excluding diagnostic "needs review" cards, and
  matches the count in the chat header. Both derive from the same filtered set.
- **[known bug → outstanding issue: plan revisions not merged]** The subtitle describes the
  **latest turn**, not the thread. Revise a plan and a six-look trip is summarised as *"1 direction
  · travel"*, because the revision arrived as one card outside the plan. Plan threads get harder to
  find in history the more you refine them.
- **[fixed 2026-07-27, was: known bug]** Opening a thread directly by URL (`/stylist/:threadId`,
  e.g. from a rail row, a deep link, or a page reload) could silently render a **different**
  thread's messages under the correct thread's URL and title — the URL-driven load rendered first,
  then got overwritten moments later by whatever thread `localStorage`'s `stylist_current_thread_id`
  pointed to, from a completely independent mount-time effect (`initAndMigrate`) that never checked
  whether a specific thread had already been requested. Survived a hard reload, since both effects
  re-ran fresh in the same order every time. Fixed by making that effect's guard also skip when a
  thread was requested via the URL (`StylistChat.jsx:1259`, `isLaunchingAction`).

> **Stores.** Reads `chat_threads` rows and `payload.threadMemory.latestOutfits`. Titles/subtitles
> computed at render — nothing is persisted. `ThreadRail.jsx:502/511/645`.

---

## Stylist → composer landing panels

**How you get there.** The panel shown before you have asked anything: the wardrobe-builder brief
on a new chat, or the piece/outfit panel when you arrived from a garment or an outfit.

**What actually happens.** **[by design]** Three panels, one per entry context
(`wardrobeBuilderOpen`, `pendingPiece`, `pendingOutfit`), each collecting a different brief. The
outfit panel offers three independent actions — review, similar looks, restyle — plus a free-text
question.

**[by design]** While generating, the panel stays open in a disabled state with a contextual status
line, rather than collapsing to the empty "Ask anything" hero. The clicked action re-labels itself
(*Reviewing…*, *Finding similar looks…*). **Back to chat** stays enabled as an escape hatch.

**[by design] The panel footer is a memory control, and it is the only one in the app that shows
its own state and offers a reset.** It reads *"Skipping N recently used pieces · **Include them
again**"*. Whole-wardrobe generation keeps a **session recency memory** so repeated asks do not
return the same garments; that memory both **penalises** recently used pieces in scoring and
**reorders** the roster (`sessionInfluence.pieceRecency`, `styling-engine/rules.js:2836`, `:2967`).

This matters for two reasons:

- **It silently narrows the pool.** In the screenshotted state, 10 of 23 pieces were being skipped —
  the model was composing from 13. Nothing else in the app tells you a memory is shrinking what the
  stylist can see, and the count is easy to read past.
- **It is the model for what other memory surfaces lack.** Compare it with taste memory, which
  reaches every prompt and never announces itself. This footer names the mechanism, quantifies its
  effect, and gives a one-click undo. Any *"make the calibration loop perceivable"* work should copy
  this pattern rather than invent one.

> **Stores.** `whole_wardrobe_sessions`. `GET /api/ai/whole-wardrobe-session-memory` returns the
> summary (`itemCount`, `formulaCount`, `recentSessionCount`); `DELETE` clears the table and is what
> *Include them again* calls. Refreshed after each whole-wardrobe generation.
> `StylistChat.jsx:4799`, `:1369`, `:3989`; `routes/ai.js:1291-1300`.

> **Stores.** Panel state is component-level; the resulting brief becomes the first user message
> and `queryOptions` on the reply. `StylistChat.jsx:578-597`.

---

## Stylist → the brief controls, and what each one actually does

**How you get there.** The **Shape the brief** row on any composer landing panel: *Occasion*,
*Activity*, *Season*, *Style direction*, plus free-text *Mood* and *Styling request*.

**Why this has its own entry.** They present as five equivalent dropdowns. They are not — two are
**hard gates** that remove garments from consideration, and the rest are soft. Nothing in the UI
distinguishes them, and a reviewer looking at the panel cannot tell which is which.

| control | what it does | strength |
|---|---|---|
| **Occasion** | selects an occasion profile, which sets the **register ceiling** — garments above it are excluded outright | **hard gate** |
| **Activity** | `No special activity` / `Lots of walking` / `Hiking / Outdoor active` — the walking and hiking profiles exclude heel heights and low walk-support outright, and impose their own `everyday` register ceiling | **hard gate, the strongest control here** |
| **Season** | eight values from *Current season* to *Very hot/cold weather*; drives the weather gate (insulating fibres in heat, bare pieces in cold) | **hard gate** |
| **Style direction** | `Mix` plus six named lanes (*Controlled Print*, *Monochrome Texture*, *Structured + Soft*, *Color Anchor*, *Unexpected Pairing*, *Soft Architecture*) | **soft** — lanes are open and never gatekept |
| **Mood**, **Styling request** | free text, folded into the prompt; also scanned for activity and register hints | soft, but see below |

**[by design]** The comment above `ACTIVITY_OPTIONS` states the rule the list follows: *"Only
values with real enforcement appear here."* So every activity in that dropdown hard-gates
something — the list is short because it is honest.

**[by design]** Free text is not inert. Mood and request text are scanned for activity and register
implications, which is why *"city stroll"* in a slot description can install the walking profile.
Ruled correct: a stroll should get comfortable shoes.

**[owner check wanted]** `Occasion` defaults to **Casual**, and a freeform ask that never touches
the selector still carries it — so a request like *"build me a 14-piece summer capsule"* is labelled
`Casual` in the response chips. On plans the per-slot occasion governs the actual gating, so the
default is mostly cosmetic there; on single-outfit asks it is not.

> **Stores.** `queryOptions` on the reply message. `OCCASION_OPTIONS` (`:88`), `ACTIVITY_OPTIONS`
> (`:98`), season sets (`:104`, `:116`), `STYLE_DIRECTION_OPTIONS` (`:125`). Profiles resolved in
> `styling-engine/occasions.js` and `styling-engine/footwear-comfort.js`.

---

## Stylist → weather location

**How you get there.** Top right of the Stylist header: *Weather location · `<city>`* with a
dropdown holding a free-text field.

**What actually happens.** **[by design]** This is the home city used to resolve a **live forecast**
when a request needs weather and no destination is given. It is one input box in a header, and it
determines whether the plan you get is built against real conditions or an estimate.

**[by design]** When a request names a destination, that wins — the wedding plan resolved
`(live forecast, South Lake Tahoe, CA)` regardless of home location. When it does not, and the home
city is set, the forecast comes from here.

**[by design]** A resolved forecast is marked `(live forecast, City)`; a heuristic guess is marked
`(estimated)`. The distinction is visible in the plan lines.

> **Stores.** Saved to the user profile via the header control (`StylistChat.jsx:5103-5130`). Used
> by `resolveSlotWeather` (`styling-engine/outfitSetPlanner.js`).

---

## Stylist → comparison sheet and the free compare strip

**How you get there.** Below a multi-direction result.

**What actually happens.** Two different things that sit next to each other:

- **[by design] Compare silhouettes** — free. Renders every direction's CSS croquis side by side so
  you can narrow down before paying. No model call.
- **[by design] Preview all looks / Preview all directions (~$0.07)** — one paid image containing
  every direction as a panel. Costs the same as rendering a single card.
- **[by design, not fixable in code]** Baked-in captions in that sheet are often illegible. The
  prompt already forbids text in the image; the image model does not always comply. Ruled: not a
  prompt bug.
- **[by design, ruled 2026-07-27]** These sheets carry **no feedback chips at all** — Save only.
  Found by `scratch/derive_board_producer_fanout.js` while checking whether the two no-chip bugs
  fixed the same day (`m.renderedBoards`, `boardResults[i]`) recurred elsewhere; this pair looked
  identical at first (same "silent" symptom) but isn't the same defect. A sheet composites
  **multiple outfits into one image**, so a single verdict/reason chip set would be attached to no
  specific outfit — the same reasoning the owner gave in conversation 2026-07-26 for why
  "Creative outfit alternatives" (a different multi-outfit collage board, `boardResults[i]`) can't
  take per-outfit feedback either. That reasoning was never written down anywhere until now; this
  is its first appearance in the docs. Owner-ruled: silence here is correct, not a bug.

  **Open, unscoped:** *how* a multi-outfit sheet could take feedback at all — per-panel chips
  keyed by position, a coarser "which one, if any, looked right" prompt, or something else — is an
  unanswered product question, not a code question. No proposal exists yet; flagging so it isn't
  rediscovered as "missing chips" again before anyone has thought about what the right shape is.

> **Stores.** Sheets land in `saved_boards` like any other render. `StylistChat.jsx:2492/2501/2589`.

---

## Stylist → "needs review" diagnostic cards

**How you get there.** They appear inline when the model proposes an outfit that fails a hard gate.

**What actually happens.**

- **[by design]** The card is shown rather than suppressed, so you can see what was proposed and
  why it was refused — this is the advisor-mode "we don't repair, we show the rejected proposal"
  behaviour. It carries an `is-broken` style and a plain-language line: **What didn't clear:**
  followed by the piece and the reason.
- **[by design]** Raw gate vocabulary, the rejected-piece list and the engine trace are dev-only,
  behind `VITE_STYLIST_DEBUG`.
- **[by design]** Cost-bearing actions are still offered on these cards. Ruled: the card is usually
  fine, the engine is what flagged it.
- **[by design]** A corrected retry supersedes its own rejected attempt rather than rendering twice;
  the surviving card carries an engine note naming the substitution.
- **Rare in practice:** no diagnostic card appears in the last 150 real-wardrobe threads. It fires
  mostly for small wardrobes.

> **Stores.** Built server-side by `buildBrokenModelCard` / `buildBrokenDiagnosticCard`
> (`routes/ai.js`); deduped in `styling-engine/tools.js`. `StylistChat.jsx:2812/2831`.

---

## Stylist → message-level actions under a plain reply

**How you get there.** Under any ordinary prose reply.

**What actually happens.** **[by design]** Two buttons, and no feedback chips:

- **Save as styling rule for `<subject>`** — writes a durable owner rule.
- **Generate visual boards** — a paid render of the described look.

**[by design]** Verdict and reason chips were **removed** from plain-text replies deliberately: a
text description cannot be judged as precisely as an image, so feedback captured there is not
reliable data. Chips remain on anything attached to an actual visual. Do not re-add them.

> **Stores.** Rules → `stylist_feedback` (`owner_rule`); boards → `saved_boards`.
> `StylistChat.jsx:5403/5408`.

---

## Visual Lab → References

**How you get there.** Visual Lab → **References**, plus **+ Add reference** which swaps in an
upload panel.

**What you are doing.** Teaching the image generator what you actually look like, and what to move
toward or away from. This is **identity calibration**, not outfit judgement — a different job from
Calibration boards despite sitting one tab away.

**What actually happens.** **[by design]** Three reference kinds, each with a different role:

- **Good reference** — something to move toward.
- **Drift reference** — something to avoid.
- **Real outfit photo** — how looks actually appear on you.

**[by design]** Real photos are load-bearing rather than decorative: when a rendered board is
marked with identity or body-proportion drift, the corrections fed back into the renderer cite them
explicitly — *"preserve the person's facial identity and resemblance from the supplied real-photo
calibration references; do not substitute a generic model"* and the equivalent for body
proportions. Without real photos those corrections have nothing to anchor to.

> **Stores.** Reference rows carry a `kind` of `good_reference` / `bad_reference` / `real_photo`.
> Correction text built in `styling-engine/rules.js:859-860`. `VisualLab.jsx:596-602`.

---

## Visual Lab → Calibration boards

**How you get there.** Visual Lab → **Calibration boards**.

**What you are doing.** Judging generated looks as evidence for future styling — an evidence inbox,
not a gallery.

**What actually happens.**

- **[by design] Two independent filter rows, deliberately separate.** **Review** (`Not reviewed` /
  `Positive` / `Flagged` / `Image issues`) asks *have I judged this*; **Status** (`Use
  strongly` / `Hidden` / `Ignored`) asks *how should it be used*. They are different questions and
  were split on purpose — do not merge them back into one chip row.
- **[fixed 2026-07-27, was mislabeled]** The Review filter was named `Needs review` and grouped
  `almost` ("Almost right") in with true negatives (`not_me` and every structural critique reason).
  `almost` is a positive-leaning verdict — close, not rejected (see `getSavedBoardMemory`'s
  close-bucket handling, which preserves the outfit formula rather than avoiding it) — so it now
  counts as `Positive`, alongside `signature`/`works`. The filter is renamed `Flagged` and scoped
  to genuine negative/critique labels only.
- **[by design] A bad render does not reject the outfit.** Image-fidelity problems surface as a
  separate `Image issue` signal beside the verdict, so a good direction rendered badly is not
  recorded as a bad direction.
- **[by design] The card verdict is the board's stored overall verdict**, not whichever feedback
  label happens to sort first.
- **[by design] `Use strongly` is high-authority memory.** Boards marked this way are labelled to
  the model as *"high-authority outfit memory"* and bias ranking.
- **[by design] Feedback given here reaches the model in full** — verdicts and specific reasons, in
  plain language. Traced; see the board-feedback entry above.
- **[fixed 2026-07-27, was: two-step capture]** Marking **A garment is the wrong length** used to
  open a picker — *which garment?* then *what was wrong?* — driven by a single shared pointer that
  reset to the first piece on every open/close of the board and never indicated which piece
  actually had a saved correction, so a correction on a second or third garment looked missing
  unless you happened to click through to it. Now every piece on the board gets its own always-
  visible reason group (sleeves too long/short, hem too long/short, pants-skirt-dress too
  long/short — filtered by the piece's own category: shoes/accessories get none, tops/outerwear
  get sleeves + their own hem, bottoms get only the skirt/pants hem, dresses get sleeves + the
  skirt/dress hem), each correction still writing a **retag-suggestion task** into Wardrobe →
  Tasks, linked to the garment and naming the field to review. The sheet states at the point of
  capture that nothing is retagged automatically. This is the one place a judgement about a
  *rendered image* turns into a concrete, garment-linked to-do — see the Tasks entry for the full
  lifecycle, including that completed suggestions are never regenerated.
- **[fixed 2026-07-27, was: known bug]** The same board's chips used to not match what the Stylist
  chat showed for it. Full writeup in `docs/board-feedback-desync-spec.md`; see the board-feedback
  entry above for what changed.

> **Stores.** `saved_boards.payload.feedback_labels` / `.feedback_details` via
> `PATCH /api/saved-boards/:id`; `favorite` carries *Use strongly*. Read to the model by
> `getSavedBoardMemory`. `VisualLab.jsx:662-666`, `:781-784`.

---

## Visual Lab → Calibration board detail sheet

**How you get there.** **Review board →** on any card.

**What you are doing.** Judging one board in depth: verdict first, then optional diagnosis, then
deciding what the board is *for*.

**What actually happens.** **[by design]** Verdict-first with progressive disclosure. The overall
verdict is mutually exclusive and re-selectable; specific diagnosis sits behind **Add specific
feedback**, which auto-opens only when such feedback already exists. Three labelled groups, and the
separation is deliberate:

- **What feels wrong?** — styling direction
- **Fit and shape** — proportion and silhouette
- **Problems in the generated image** — prefaced *"These report rendering accuracy only. The outfit
  direction can still be useful."* A bad render must not be recorded as a bad direction.

**[by design] Three status actions, all reversible, none of them deletion:**

| action | effect |
|---|---|
| **Use strongly** / Use normally | marks the board `favorite`; it becomes high-authority outfit memory in the prompt |
| **Hide from Lookbook** / Show | `hidden_from_lookbook` — presentation only |
| **Ignore board** / Restore | `archived` — **excluded from every memory query**, so the model stops seeing it entirely |

**[by design]** *Ignore* is the strong one: archived boards are filtered out of the queries that
build stylist memory, so it is the only control here that removes a board from the model's view.
*Hide* only affects where it appears.

**[by design] View generating chat** jumps back to the thread that produced the board, when one
exists. **Delete board** is separate, styled as destructive, and confirms with *"Delete … from
everywhere?"*.

**[by design]** Saving shows `Saving…` / `Feedback saved` / error through a polite live region, and
controls disable while a write is in flight.

> **Stores.** `saved_boards` via `PATCH /api/saved-boards/:id` — `favorite`,
> `hidden_from_lookbook`, `archived`, `feedback_labels`, `feedback_details`. Memory queries filter
> `COALESCE(archived,0) = 0` (`styling-engine/rules.js:611`). `VisualLab.jsx:909-929`, `:967-978`.

---

## Visual Lab → the four sections

**How you get there.** `/visual-lab`, tabs: **References**, **Calibration boards**, **Style
profile**, plus an upload section.

**What actually happens.** **[by design]** Three different jobs that look like one page:
References is identity calibration (what you actually look like); Calibration boards is an evidence
inbox for judging generated looks; Style profile is the editable prompt text. Feedback given in
Calibration boards reaches the model in full — see the board-feedback entry above.

> **Stores.** `VALID_SECTIONS = ['references','saved','profile','upload']`, `VisualLab.jsx:130`.

---

## Wardrobe → index (`/wardrobe`)

**How you get there.** The default route.

**What you are doing.** Recognising and comparing what you own. A working index, not an ecommerce
catalogue or a gallery.

**What actually happens.** All ratified 2026-07-23 — **do not "improve" these without a new ruling:**

- **[by design]** Every card uses the same stable `4:5` image stage with `object-fit: scale-down`.
  Garments are never cropped to make the grid look tidier. Four columns at 1440px, three at 1024,
  two at 768.
- **[by design]** The card payload is deliberately thin: garment name plus at most two colour
  swatches. Brand, database ID, wear count, occasion, season and fabric are **deliberately absent**
  — they belong in search, filters or detail. Badges are reserved for actionable states (repair,
  donate, retag).
- **[by design]** Sort labels describe *styling activity*, not wear: **Balanced mix**, **Recently
  styled**, **Most styled**, **Ready to rediscover**. The app does not claim you wore something.
- **[by design]** Search language describes what a person knows about clothing — name, colour,
  fabric, shape — never database identifiers.

> **Stores.** `pieces`, with display derivatives and lazy loading preserved. Ruling in
> `ui-v1-design-handoff.md` → *Wardrobe inventory index*.

---

## Wardrobe → sort, and what "styled" means

**How you get there.** The **Sort:** control in the Wardrobe toolbar. Default is **Balanced mix**.

**What actually happens.** **[by design] The vocabulary is deliberately precise and the precision is
the point.** Every label says *styled*, never *worn*:

| label | sorts by |
|---|---|
| **Balanced mix** *(default)* | `wardrobeMixSort` — a deliberate spread rather than any single axis |
| **Recently added** | `date_added` |
| **Recently styled** | last time the app used the piece in a look |
| **Most styled** | how many times the app used it |
| **Ready to rediscover** | fewest uses first, oldest last-use as tiebreak |
| **Name A–Z** | name |

**[by design]** The source comment states the reason outright: usage counts reflect *"app usage,
not real-world wear — the app has no way to observe that."* So *Most styled* means the stylist
reached for it often, not that you wore it often, and *Ready to rediscover* surfaces what the
**engine** has been neglecting.

That is a quiet but real product position: the app refuses to claim knowledge it does not have.
Worth protecting — a future "Most worn" label would be a lie the codebase currently avoids telling.

**[by design]** `Balanced mix` is the default and is not a sort in the ordinary sense; it is a
spread. It was flagged for reconsideration only if usability testing showed the meaning unclear.

> **Stores.** `usageStats` derived from outfit and board links, not from any wear log.
> `PieceInventory.jsx:40-46`, `:205-228`.

---

## Wardrobe → garment detail, edit, add, Tasks

**How you get there.** Click a card (detail) → **Edit**; **Add pieces** from the header; **Tasks**
from the header badge.

**What actually happens.** **[by design]** Four distinct surfaces with deliberately different
scope:

- **Detail** *(ratified)* — a working garment record. Identity and useful metadata before system
  details; real linked outfits before generated boards, because lived evidence beats speculation.
  Offers **Add worn photo** when there is none, **Review fit details** when there is. *Ask stylist
  about this piece* is primary, Edit secondary, Delete quiet and isolated.
- **Edit** *(implemented, not ratified)* — the full management form. Construction metadata under
  *Garment character*, recommendation permissions under *Stylist controls*, accumulated guidance
  under *What the stylist should remember*. Missing metadata appears as neutral completion help,
  never as a validation error.
- **Add** *(reviewed, not ratified)* — deliberately **not** the Edit form. A short intake: photos,
  recognisable identity, essential context. No status, permissions, engine notes or styling-memory
  administration. AI prepares a reviewable draft and never saves automatically.
- **Tasks** — repair/donate/retag queue. Never received the dialog audit the other surfaces did.

> **Stores.** `pieces` and its upload/thumbnail pipeline. Rulings in `ui-v1-design-handoff.md` →
> *Wardrobe garment-detail ruling*, *Wardrobe Edit Piece direction*, *Wardrobe Add Piece direction*.

---

## Wardrobe → Tasks

**How you get there.** The **Tasks** chip in the Wardrobe header, carrying a count badge of
incomplete items. A modal, deliberately **not** URL-backed — it opens fresh each visit rather than
being linkable.

**What you are doing.** Working a queue of wardrobe chores, grouped into five types:
**repair**, **donate**, **shopping**, **metadata**, and **retag-suggestion**.

**What actually happens.**

- **[by design] Two of the five types are machine-generated, and this is the app's main
  garment-data repair loop.** `repair`, `donate` and `shopping` you create. The other two arrive on
  their own:

  **`retag-suggestion` — created from Visual Lab board feedback.** When you mark a rendered board
  as **A garment is the wrong length**, the detail sheet asks *which* garment and *what was wrong*
  (sleeves too long/short, hem too long/short, pants-skirt-dress too long/short). Saving that
  writes one task per correction: *"Retag suggested for `<garment>`: `<issue>`. Review the garment
  metadata; no tags were changed automatically."* The task carries the garment link and the
  **field** to review — `sleeve_type` for sleeve issues, `length_hits_at` for hem issues. Nothing
  is retagged automatically, by design, and the sheet says so at the point of capture.

  **`metadata` — created by the hard gates themselves, when one excludes a garment for missing
  data.** All of these fire inside `buildVisualComposerRoster`, i.e. while assembling the roster the
  model is allowed to compose from — so the task is written at the moment the garment is silently
  dropped from consideration. Three gates do it:

  | gate | missing field | wording |
  |---|---|---|
  | **register** | `formality` | *"…missing formality — retag to restore register-gated visibility"* |
  | **activity** | `footwear-comfort` | *"…missing footwear-comfort — retag to restore activity-gated visibility"* |
  | **weather** | whichever field the weather gate needed | *"…missing `<field>` — retag to restore weather-gated visibility"* |

  This is the queue's most useful property and it is invisible from the UI: **the Tasks list is
  partly a record of which garments the engine could not consider, and why.** A garment missing
  `formality` is not merely under-tagged — it is being excluded from register-gated composition
  every time, and the task is the only place that surfaces. Deduplicated against open tasks for the
  same piece and field, so a repeatedly-excluded garment produces one task, not one per generation.

- **[by design] Resolution is a plain done-toggle, and it is remembered.** `PATCH
  /api/todos/:id/toggle` flips `completed`. For retag suggestions this matters more than it looks:
  each time a board's feedback changes, the sync **deletes and rebuilds that board's incomplete
  suggestions** — but first collects the `piece:issue` pairs you already completed and skips them.
  So a suggestion you have dealt with never comes back, while ones you have not are kept current
  with the board.
- **[by design]** Tasks link back to a garment: clicking one closes the modal and opens that
  garment's detail — so "review the metadata" is one click from the suggestion.
- **[by design]** Generated `metadata` tasks are swept rather than accumulating —
  `POST /api/todos/clear-orphaned` deletes any whose linked piece is gone or no longer active. Only
  `metadata` is swept; user-created and retag tasks are never auto-deleted.
- **[owner check wanted]** This surface never received the dialog audit the other modals did. It
  uses a plain overlay with click-outside-to-close, and has not been checked for focus trapping,
  Escape handling, or focus return. It is the one modal in the app outside the ratified dialog
  contract.

> **Stores.** `todos` (`type`, `description`, `linked_piece_id`, `field`, `source_type`,
> `source_id`, `payload`). Endpoints `GET/POST /api/todos`, `POST /api/todos/clear-orphaned`,
> `PATCH /api/todos/:id/toggle`, `DELETE /api/todos/:id` (`routes/crud.js:1152-1211`). Badge count
> via `usePendingWardrobeTaskCount`, shared across mounts so it stays in sync.

---

## Lookbook → My Outfits and Generated Outfits (`/outfits`)

**How you get there.** The Outfits route; two collections behind one header.

**What actually happens.** **[by design]** Two collections that must not borrow each other's
language:

- **My Outfits** is **owner truth**. `Confirmed` means you asserted you wore it or chose to wear
  it, and must not be downgraded because a record lacks linked pieces. `Trying` is for an outfit
  used as evidence before you decide. There is **no archive lifecycle** — the legacy `Archived`
  choice was removed and must not return.
- **Generated Outfits** are **stylist hypotheses**, and use proposal language throughout: a review
  signal (`Signature` / `Works` / `Needs review` / `Not reviewed`), the board's scope, and honest
  composition counts that separate wardrobe pieces from ideal additions. Owner-truth labels like
  *Confirmed* or *Trying* must never be attached to a generated idea.
- **[by design]** `Pinned first` is an **ordering preference, not a filter**. The label was
  corrected to match the behaviour; if a true pinned-only collection is ever wanted, change both
  together.
- **[by design]** Occasion and season controls are omitted from Generated Outfits until briefs
  persist those fields — they are not inferred from garment metadata.

**[by design, deferred]** Promoting a generated idea into My Outfits is deliberately unbuilt. It
would need an explicit owner action and probably a real photo; it must never be a status toggle.

> **Stores.** `outfits` and `saved_boards`. Rulings in `ui-v1-design-handoff.md` →
> *Lookbook — My Outfits* and *Generated Outfits panel ruling*.

---

## Lookbook → filters, sort and search

**How you get there.** The toolbar above either collection.

**What actually happens.**

- **[by design] Filters are URL-backed** — occasion, season, sort and collection all live in query
  params, so a filtered view is linkable and survives reload. The Wardrobe Tasks modal deliberately
  is *not* (it opens fresh); these deliberately are.
- **[by design] `Pinned first` is an ordering toggle, not a filter.** It reorders; it does not
  restrict. The label was corrected to match the behaviour after previously reading `Pinned`, which
  implied filtering it never did. If a true pinned-only collection is ever wanted, **change the
  behaviour and the label together.**
- **[by design] Sort is deliberately dull** — newest, oldest, A–Z, Z–A, most pieces, fewest pieces.
  No wear-based or score-based ordering. Consistent with the Wardrobe ruling that the app does not
  claim knowledge of real-world wear.
- **[by design] Piece-count sorting exists here and is deliberately absent from Generated
  Outfits**, because a generated board mixes owned pieces with ideal additions and the two are not
  comparable.
- **[by design] Search covers pieces, not just outfit names**, and the placeholder says so —
  *"Search outfits or pieces…"*. Honest labelling of a garment-aware search rather than implying
  a name-only match.
- **[by design]** Empty states distinguish a genuinely empty collection from a filtered-empty
  result, each with its own recovery action — *"Save a complete look…"* versus *"Clear the search
  and filters…"*.

> **Stores.** `outfits` / `saved_boards`, filtered client-side; state in `searchParams`
> (`OutfitLookbook.jsx:1512-1514`). `SORT_OPTIONS` at `:32`.

---

## Settings — and why it is two different pages

**How you get there.** `/settings`, *or* Visual Lab → **Style profile**.

**What actually happens.** **[by design]** One component, `StylistSettings`, rendered in two modes,
each showing a disjoint set of sections. Nothing is duplicated — the halves never overlap:

| `/settings` (`mode='account'`) | Visual Lab → Style profile (`mode='style'`, embedded) |
|---|---|
| Profile & location | How your stylist understands you *(constitution layers 1–4)* |
| Provider keys (BYOK) | How generated looks represent you *(image layers)* |
| Administration | Learned rules & preferences *(Edit / Retire)* |
| Security & sessions | Outfit & styling feedback |

**[owner check wanted]** Everything that shapes stylist behaviour lives under **Visual Lab**, and
everything under **Settings** is account administration. That is a defensible split, but "Settings"
is where most people look for "what does my stylist know about me" — and it is not there.

> **Stores.** `style_constitution` via `GET/PUT /api/settings/constitution[/:layer]`, history at
> `/:layer/history`. Learned rules read `stylist_feedback` filtered to
> `LEARNING_TYPES = ['owner_rule','preference_reaction','correction']` (`StylistSettings.jsx:32`);
> **Retire** sets an archived flag rather than deleting. Mode is set by the caller —
> `App.jsx:168` (account) and `VisualLab.jsx:647` (style, embedded).

---

## Onboarding (`/onboarding`)

**How you get there.** First run, or `/onboarding?step=<name>` directly.

**[owner note] Onboarding never went through the UI/UX modernisation phase.** Every other surface in
this map was reviewed and in most cases ratified during the V1 visual work; this one was not. It is
therefore expected to look and behave older than the rest. **A craft panel should either exclude it
explicitly or be told this before reviewing it** — otherwise it will produce a long list of
findings the owner already knows about, at the cost of attention better spent elsewhere.

**What actually happens.** **[by design]** Six steps — `welcome`, `profile`, `comfort`,
`aesthetic`, `working`, `done` — and the middle four *build the Style Constitution*. This is where
the layers you later edit in Style profile come from.

Two rules baked into the flow and worth not breaking:

- **[by design]** Every constitution step shows the assembled layer text in an **editable textarea
  before it is saved**. Nothing is written to your profile that you have not seen.
- **[by design]** The aesthetic step records colours **exactly as stated** and never synthesises a
  favourite, signature or "best" colour. That prohibition is repeated inside Layer 3's own text.

> **Stores.** Writes `style_constitution` layers and the profile row. `Onboarding.jsx:14`.

---

## Import (`/import`)

**How you get there.** Wardrobe → import, or the route directly.

**What actually happens.** **[by design]** A pipeline with a review gate:
upload (folder / ZIP / Google Takeout / video) → analyse (classify → detect → cluster → match) →
**review** → commit. Nothing enters the wardrobe unreviewed.

**[owner note, 2026-07-26] Video import is prohibitively expensive for what it returns and will
probably be disabled** — already hidden from users and owner-flagged only. Reviewed before removal
in case it can be optimised; see outstanding issue on the cost drivers.

**[by design]** Video needs `ffmpeg`; without it videos are skipped and counted separately
(`videos skipped (no ffmpeg)`) rather than failing silently.

**Why it costs what it does — and the expensive part is not the API bill.** *(Owner, 2026-07-26:
the real cost is false positives that then have to be looked through and possibly tagged.)*

The pipeline is precision-poor by construction:

- **Sampling is `fps=1`** — one frame **per second** of footage. A two-minute closet walkthrough
  yields ~120 images before any filtering.
- **The only automatic filter is a blur check** (`FRAME_MIN_STDDEV = 10`). Nothing deduplicates
  near-identical consecutive frames, so a slow pan over one rail survives as dozens of near-copies.
- **Video frames are inherently weak evidence.** A garment glimpsed at an angle, half-occluded, on
  a rail, in motion — the classifier sees something garment-shaped and proposes it. Each proposal
  becomes a cluster the owner must judge in the review gate.

**The single most expensive step is AI tagging** — a model call per garment — so spend scales with
*proposals carried forward*, not with frames. False positives therefore cost twice: once in review
attention, once in tagging whatever is mistakenly accepted. Optimising tagging would pay off across
every import path and the wardrobe generally, and may be worth doing before this decision.

So the dominant costs are **owner attention in review** and **tagging**, not classification. A hundred frames producing
sixty proposals of which a handful are real is expensive even when the model spend is trivial, and
it gets worse: anything mistakenly accepted then needs tagging, and a badly-tagged garment is
exactly what the gates exclude silently (see the Tasks entry).

**[unverified] The number that decides this is precision, not yield.** `import_clusters` carries a
`status` that reaches `accepted` when a cluster becomes a real piece, so **accepted-vs-proposed for
video-origin sessions is measurable from past imports** — no new video, no model call. If precision
is low, sampling tuning cannot save it, because the problem is the evidence quality rather than the
frame count.

> **Stores.** `import_images`, `import_sessions`. `routes/importer.js:100-130` (sampling),
> `:180-212` (classification, `CLASSIFY_BATCH_SIZE = 10`).

> **Stores.** `pieces` plus the upload pipeline. `WardrobeImport.jsx`, `routes/importer.js`
> (11 endpoints).

---

## Auth (`/login`, `/register`)

**What actually happens.** **[by design]** Multi-user with per-user data: each account gets its own
SQLite database and uploads directory, and optionally its own provider keys (BYOK). Registration is
**invite-gated**, not open — you need a minted code, or you submit an invite request an admin
approves.

**[known bug → memory: session cookie cross-tab collision]** Unconfirmed but recorded: one shared
session cookie may let a stale tab write to the wrong user's database after a second sign-in
elsewhere. Needs reproduction before fixing.

> **Stores.** `system.db` for accounts, invites and sessions; per-user `wardrobe.db`.
> `routes/auth.js` (7 endpoints).

---

## Admin (`/admin`)

**How you get there.** Admin-flagged accounts only. Replaced what used to be standalone scripts
(`create-invite.js`, `reset-password.js`).

**What actually happens.** **[by design]** Three sections — **Users**, **Invites**, **Invite
requests** — with the destructive paths deliberately guarded:

- **Users** — toggle active/suspended status, grant or revoke admin, **revoke all sessions**,
  approve use of the operator's API key (so a user can run without their own BYOK key), and
  **delete permanently**. Deletion requires typing the account's email to confirm.
- **Password reset issues a one-time code** shown once in a dialog, rather than mailing anything or
  setting a password directly.
- **Invites** — mint a code, revoke an unused one. Used codes record who consumed them and cannot
  be revoked.
- **Invite requests** — approve or decline requests from people without a code.

**[by design]** Every user-facing action here is administrative rather than stylistic — nothing on
this page touches wardrobes, prompts or memory.

> **Stores.** `system.db`. `routes/admin.js`: `GET /users`, `PATCH /users/:id/status`,
> `/users/:id/admin`, `/users/:id/operator-key-approval`, `POST /users/:id/reset-password`,
> `/users/:id/revoke-sessions`, `DELETE /users/:id`, `GET|POST /invites`,
> `DELETE /invites/:code`, `GET /invite-requests`, `PATCH /invite-requests/:id`.

---

## Dialogs — the shared pattern

**Where.** Fourteen dialogs across six components. Each pair is a sheet plus its own full-image
preview, which is why the counts are mostly even:

| component | dialogs |
|---|---|
| `OutfitLookbook` | `OutfitForm` (add/edit), `OutfitDetail` + its image preview, `BoardDetail` + its image preview |
| `PieceDetail` | garment detail sheet + full-photo preview |
| `PieceForm` | add/edit sheet + photo preview |
| `StylistChat` | image lightbox, mobile history drawer |
| `VisualLab` | calibration detail sheet + full-image preview |
| `ThreadRail` | mobile drawer |

**What actually happens.** **[by design]** A ratified dialog contract that every one of them is
expected to meet:

- `role="dialog"`, `aria-modal="true"`, and a labelled title
- initial focus on a predictable control (usually Close)
- Tab focus trapped inside, wrapping first↔last
- Escape dismisses
- document **and** `.app-main` scroll locked while open — the page behind must never move
- focus returns to the **exact** element that opened it, not merely "some element"

**[by design]** The Stylist image lightbox deliberately focuses synchronously rather than via
`requestAnimationFrame`, unlike VisualLab's dialogs. `useEffect` already runs after commit, and the
deferred version was untestable in automation. Not an inconsistency to "fix".

**[owner check wanted]** Lookbook's `BoardDetail` was reported as missing focus-return. Recorded but
never confirmed or fixed.

> **Detail.** Pattern established in `VisualLab.jsx` and mirrored in `StylistChat.jsx` and
> `ThreadRail.jsx`. Rulings in `ui-v1-design-handoff.md` → *Lookbook — detail-view completion* and
> *Visual Lab — Calibration Boards review workflow*.

---

## Still to write

First pass complete — every route, tab, mode-split and dialog group from
`scratch/derive_surface_skeleton.js` now has an entry.

**Known thin spots, listed rather than hidden:**

- **Per-endpoint mapping** — 106 endpoints exist; entries name the ones that matter per surface,
  not all of them. `routes/crud.js` alone has 56.
- **Onboarding steps** — the six steps are named and the two invariants recorded, but each step's
  own content is not described.
- **Import** — the pipeline stages are named; the review-gate UI is not described in detail.
- **Individual dialogs** — enumerated and their shared contract recorded, but each one's content
  lives in its parent surface's entry rather than having its own.

**To check this map is still true:** `node scratch/derive_surface_skeleton.js`. It lists every
surface it can find and flags those with no entry. It cannot tell you an entry has gone *wrong* —
only that one is missing.
