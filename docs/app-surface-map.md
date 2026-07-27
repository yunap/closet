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

**How you get there.** Inside a Stylist chat thread, under any generated visual board: a verdict
row (*Signature / Works / Almost / Not me*) and, behind **More feedback**, grouped reason chips
(*What feels wrong?*, *Fit and shape*, *Problems in the generated image*).

**What you are doing.** Telling the stylist whether a rendered look worked, and why not.

**What actually happens — three things worth knowing:**

- **[known bug → `docs/board-feedback-desync-spec.md`, outstanding issue 1]** **This does not
  update Visual Lab.** The same board opened in Visual Lab → Calibration boards shows *different*
  selected chips. The chat writes its chip state into the thread it happened in; Visual Lab reads
  the canonical saved-board record. Neither reads the other. Diagnosed, fix deferred.
- **[known bug → same root]** **The chat's chip state is frozen at the moment you clicked.**
  Restored from the thread's own stored snapshot on load and never re-checked. Change the same
  board's feedback elsewhere and this thread will not notice. This is the same defect as above
  seen from the read side, not a separate design decision.
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

> **Stores.** Writes `stylist_feedback` (via `POST /api/stylist-feedback`) and
> `thread.payload.feedbackSaved`, a `Set` of composite keys inside the thread row. Reads only the
> latter. Does **not** touch `saved_boards.payload`.
> `StylistChat.jsx:3460`, `:621`, `:698`, `:873`.
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

**Owner check wanted.** Three actions with radically different permanence sit in one menu, styled
identically. Whether that is a problem is a design judgement, not a defect — flagged here for the
owner rather than assumed either way.

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

## Stylist → critique and the "Full structured read"

**How you get there.** `Evaluate outfit` on any card, or *Ask stylist about this outfit* → review.

**What actually happens.** **[by design]** The reply is prose first — a direct answer, a named
first issue, one concrete adjustment, then a verdict. Everything after the marker
`--- Full structured read ---` is collapsed behind a disclosure: intent, success criteria, visible
facts, tension, scores, roles.

**[by design]** Inside that disclosure the actionable fields lead — `First visible issue:` then
`Next:` / `Avoid for now:` / `Try next:` — ahead of the diagnostic dump. That ordering was a
deliberate fix; do not "tidy" it back into field order.

> **Stores.** Delimiter shared between `StylistChat.jsx:464` and `styling-engine/core.js`. Built by
> `formatSharedOutfitEvaluation`.

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
  `Positive` / `Needs review` / `Image issues`) asks *have I judged this*; **Status** (`Use
  strongly` / `Hidden` / `Ignored`) asks *how should it be used*. They are different questions and
  were split on purpose — do not merge them back into one chip row.
- **[by design] A bad render does not reject the outfit.** Image-fidelity problems surface as a
  separate `Image issue` signal beside the verdict, so a good direction rendered badly is not
  recorded as a bad direction.
- **[by design] The card verdict is the board's stored overall verdict**, not whichever feedback
  label happens to sort first.
- **[by design] `Use strongly` is high-authority memory.** Boards marked this way are labelled to
  the model as *"high-authority outfit memory"* and bias ranking.
- **[by design] Feedback given here reaches the model in full** — verdicts and specific reasons, in
  plain language. Traced; see the board-feedback entry above.
- **[by design] Wrong-length feedback creates work, not just memory.** Marking **A garment is the
  wrong length** opens a two-step capture — *which garment?* then *what was wrong?* (sleeves too
  long/short, hem too long/short, pants-skirt-dress too long/short) — and each correction writes a
  **retag-suggestion task** into Wardrobe → Tasks, linked to the garment and naming the field to
  review. The sheet states at the point of capture that nothing is retagged automatically. This is
  the one place a judgement about a *rendered image* turns into a concrete, garment-linked
  to-do — see the Tasks entry for the full lifecycle, including that completed suggestions are
  never regenerated.
- **[known bug → `docs/board-feedback-desync-spec.md`]** The same board's chips will not match what
  the Stylist chat shows for it.

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
