# App surface map

**FORMAT SAMPLE — three entries only.** Written 2026-07-26 for the owner to react to before the
remaining ~30 are filled in. If the format works, the first full slice is Stylist + Visual Lab +
Settings (~15 entries), then Wardrobe, Lookbook, import, auth and admin.

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

> **Stores.** Panel state is component-level; the resulting brief becomes the first user message
> and `queryOptions` on the reply. `StylistChat.jsx:578-597`.

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
- **[known bug → `docs/board-feedback-desync-spec.md`]** The same board's chips will not match what
  the Stylist chat shows for it.

> **Stores.** `saved_boards.payload.feedback_labels` / `.feedback_details` via
> `PATCH /api/saved-boards/:id`; `favorite` carries *Use strongly*. Read to the model by
> `getSavedBoardMemory`. `VisualLab.jsx:662-666`, `:781-784`.

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

**[by design]** Video import samples frames and needs `ffmpeg`; without it videos are skipped and
counted separately (`videos skipped (no ffmpeg)`) rather than failing silently. Video import is
gated off for users generally — owner-flagged only — on cost/value grounds already decided.

> **Stores.** `pieces` plus the upload pipeline. `WardrobeImport.jsx`, `routes/importer.js`
> (11 endpoints).

---

## Auth (`/login`, `/register`) and Admin (`/admin`)

**What actually happens.** **[by design]** Multi-user with per-user data: each user gets their own
SQLite database, uploads directory, and optionally their own provider keys (BYOK). Admin manages
**users and invites** — registration is invite-based rather than open.

**[known bug → memory: session cookie cross-tab collision]** Unconfirmed but recorded: one shared
session cookie may let a stale tab write to the wrong user's database after a second sign-in
elsewhere. Needs reproduction before fixing.

> **Stores.** `system.db` for accounts and invites; per-user `wardrobe.db`. `routes/auth.js` (7
> endpoints), `routes/admin.js` (12).

---

## Dialogs — the shared pattern

**Where.** Fourteen dialogs across six components: `OutfitLookbook` (5), `PieceDetail` (2),
`PieceForm` (2), `StylistChat` (2), `VisualLab` (2), `ThreadRail` (1).

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

- **Tasks modal** (Wardrobe) — covered in one line inside the garment-surfaces entry. It never
  received the dialog audit the others did, so it deserves its own entry once someone looks at it.
- **Calibration boards detail sheet** — the review workflow is recorded; the detail sheet's own
  progressive-disclosure structure is summarised rather than described.
- **Admin** — described from its data (users, invites) rather than from its screens.
- **Per-endpoint mapping** — 106 endpoints exist; entries name the ones that matter per surface,
  not all of them.

**To check this map is still true:** `node scratch/derive_surface_skeleton.js`. It lists every
surface it can find and flags those with no entry. It cannot tell you an entry has gone *wrong* —
only that one is missing.
