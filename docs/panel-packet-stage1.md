# Stage 1 panel packet — Stylist direction review

**Self-contained. Everything you need is in this file — do not go reading the wider docs tree.**
Generated 2026-07-25 from `docs/expert-panel-brief.md` (ratified), `docs/ui-v1-design-handoff.md`
(owner rulings) and the live database. If you find yourself wanting more context, say so in your
answer rather than hunting for it; that gap is itself a finding.

## What this review is

A **direction** review of the Stylist feature, not a defect hunt. You are asked whether the product
bets embodied in this feature are sound. Bugs, typos, contrast ratios, missing ARIA and stale
counts are explicitly **not** your job — they are found more cheaply by tests and a low-cost QA
pass, and an expert panel that returns a defect list has been briefed wrong.

## Hard rules

- **Never make a model or AI call, and never touch the network.** The owner brings their own API
  key and is budget-constrained; a previous session wasted real money.
- **Do not open a browser.** `localhost:5173` proxies to a live, billed API, and a single click on
  `Generate outfit image` or `Evaluate outfit` spends the owner's money.
- You do not need the database. Every artifact you need is transcribed into this packet.
- Read the *whole* packet before writing anything.

## The recurring failure mode — read before calling anything a defect

Four separate times in one working session, an absence was reported as a defect and turned out to
be deliberate or simply never built. A reviewer, the implementing agent, and in one case two hours
of investigation were all wrong. Assume the trap is set for you too.

The canonical list is reproduced under **Settled ground** below, in the owner's own words. Read it
before writing any finding. If you want to argue one of those decisions is wrong, do — but engage
its stated reasoning; a restatement that it looks wrong is not an argument.
## Part 1 — The app (shared context, given to every reviewer)

**What it is.** A wardrobe and personal-styling workspace. A person catalogs the clothes they
actually own, saves outfits, and works with an AI stylist that evaluates outfits, styles a
selected garment, proposes directions from the wardrobe, and renders visual outfit boards. A
learning memory accumulates what the owner says works and doesn't, and feeds it back into later
styling.

**Who it's for.** One person dressing themselves from a real closet — not a shopper, not a
retailer, not a content creator. The owner already has taste; the product's job is to help them
apply it faster and more consistently to the clothes they own. It is a working tool used
repeatedly, not a showcase visited once.

**The core loop.** Catalog garments → get styling proposals or critique → judge them → the
judgment persists as memory → later proposals reflect it. Every surface either feeds that loop
or gets out of its way. A surface that collects a signal the loop never uses is decoration; a
surface that makes judging harder is a regression regardless of how it looks.

**Planning, not just single outfits.** A large part of freeform stylist chat is multi-event and
multi-day planning: a wedding weekend, a four-day trip, a work week, a seasonal capsule. The
output is a **plan** — sectioned by event or day, one look per section, carrying explicit
*coverage* (which events are dressed), *conditions* (weather, indoor vs. outdoor, per event), and
*repeats* (which pieces recur across days, or an assertion that none do). Packing economy is part
of the job: wearing the same sunglasses on three of four days is a correct answer, not a variety
failure. The stylist may also spend a conversational turn asking a clarifying question — where
the event is, so it can pull a live forecast — before producing anything. None of this is a
separate wizard or mode; it emerges from ordinary conversation in the same chat that critiques a
single outfit.

**The four product areas.**

- **Wardrobe** — the garment inventory and garment detail/edit. Recognition and comparison.
- **Lookbook** — saved outfits (owner truth) and generated outfits (stylist hypotheses). These
  two are deliberately different kinds of record and must not borrow each other's language.
- **Stylist** — chat-based styling: critique, style-a-piece, whole-wardrobe directions, visual
  boards. The most novel and least conventional surface in the app.
- **Visual Lab** — calibration: reference photos, saved boards, and the feedback that teaches
  the renderer and the stylist.

**Economic shape — this is a product constraint, not an implementation detail.** Model calls cost
real money and the owner brings their own API key. Text styling is cheap; image rendering is
roughly $0.07 per board. Every paid action is labelled and opt-in, and the product deliberately
offers free ways to evaluate a direction before paying to render it. Any recommendation that adds
model calls, or that moves a decision behind a paid render, has to justify the spend.

**Deliberately not.** Not a shopping app, not a trend feed, not an editorial portfolio, not a
moodboard tool, not an analytics dashboard about clothes. Outfit imagery is evidence, not
decoration. The product optimizes for lived personal style over trend optimization — see
`AGENTS.md`'s *Product Goal* and *Styling Principles*, which are handed to reviewers in full for
any surface where styling quality is in scope.

**Ratified visual direction.** Warm, quiet, contemporary, functional over decorative. Muted
aubergine accent for actions and state, never washing large regions. Cormorant Garamond for short
identity text only; DM Sans for everything read or worked with. A 12px floor for meaningful UI,
15px for sustained reading. Images lead where visual comparison is the task. These are decisions,
not defaults — a reviewer may argue one is wrong, but must argue it explicitly rather than
recommend a generic modernization that silently reverts it.

**Technical shape,** for reviewers who need it: React 18 + Vite frontend, Express + SQLite
backend, per-user database, authenticated multi-user web app, local image processing, Anthropic
or OpenAI models via the owner's own key.
---

### Mode B — Direction review

**Use when** the surface invents its own mechanics and there is no established convention to
assess against — the Stylist is the standing example. Also use it whenever the real question is
"should this work this way at all?" rather than "is this built well?"

**Question:** are the product bets embodied in this surface sound?

**Inputs:** the shared app context, the relevant flow doc in `docs/flows/`, the ratified rulings
*with their rationale*, and a set of propositions (below). Browser access is optional and
secondary; the argument is the deliverable.

**Propositions.** Mode B reviewers are not asked to review a screen. They are given the bets the
surface has already placed, stated as flat claims, and asked to attack or defend each one. Write
them by naming what the surface assumes without proving — one sentence, falsifiable, no hedging.
The current Stylist set, as a worked example:

1. A schematic croquis is a sufficient basis for choosing between styling directions before
   paying to render one.
2. Feedback vocabulary should scale with render stage rather than being uniform across surfaces.
3. Showing a gate-rejected proposal as a "needs review" card serves the owner better than
   suppressing it.
4. Chip-based feedback is a workable way for an owner to teach a stylist at all.
5. The structured read is the right output form for a critique — a dozen diagnostic fields behind
   a disclosure, rather than a shorter judgment or a different shape entirely.
6. The owner can perceive the calibration loop paying off — that judging a proposal today visibly
   changes what gets proposed later. If it is not perceivable, every feedback control in the app
   is theater.
7. A plan must **declare the constraints it imposed**, not merely present the result. A plan that
   silently spends its budget is a report; one that names the tradeoff and offers the lever is a
   decision aid. (Folds in the earlier framing — the plan, not the individual look, is the unit of
   value, and repeats across days are a feature to surface and reason about, not a variety failure
   to hide.)

   Evidence, and it is sharper than it first appeared. The 14-piece capsule spends 3 of its 14
   slots on shoes (a fixed quota: any budget from 12 to 23 buys exactly 3), so a single flat
   carries 7 of 8 looks. Every reader read that as a styling failure — including the implementing
   agent, for two hours, across four wrong hypotheses. It is not a failure; it is the budget
   working.

   And the model **said so**. It wrote *"the canvas slip-ons do heavy duty there; the burgundy cork
   wedges carry the one evening look"*, plus the piece roster, the budget verdict, and the route to
   a true 14. The Tucson plan likewise opened *"6 looks, 3 pairs of shoes, built for the heat"*.
   **None of it reached the screen** — plan responses rendered only their structured cards and
   discarded the prose entirely (fixed 2026-07-25; see `stylist-bugfix-spec.md` item 11). The
   owner's reaction before that was found: *"on one hand it's the right decision, on the other — it
   should have told the user 14 pieces is too tight, so I'm limiting the shoes."* It did. The
   surface built to present plans threw it away.

   So the question is not whether plans should explain themselves. It is: **is a card grid the
   right container for styling advice at all, or does it systematically privilege what is
   enumerable over what is reasoned?** The same instinct left the roster, budget verdict, and trim
   notices computed and still unshown.

   **The capsule is open for redesign, and the research is already done — your job is to break it
   or confirm it.** `capsuleQuotas` gives a 14-piece budget 5 tops / 5 bottoms / 1 dress / 3 shoes,
   and `planTotalOutfitCapForBudget` caps the result at 8 outfits. Measurement against the real
   wardrobe (read-only, no model calls) established three things:

   - **Capacity is real and the cap wastes it.** Gate-valid distinct outfit cores at budget 14 is
     **24**, against a naive 26 — the validity ceilings cost almost nothing. A cap of 8 undersells
     a 14-piece capsule by roughly threefold.
   - **The wardrobe is not the constraint.** The weakest slot draws on 44 eligible tops and 35
     eligible bottoms in supply; the roster bought two of each. This lives entirely in
     `selectCapsuleRoster`/`capsuleQuotas`, not in what the owner owns.
   - **Established practice contradicts the combinatorial reading.** 10×10 is 10 pieces → 10
     outfits; 3-3-3 is 9 pieces → 9 base outfits with layered variants named as an extension;
     Project 333 publishes no outfit list at all. Commercial "15 pieces, 50+ outfits" numbers are
     always *capacity claims*, never enumerated lookbooks — nobody ships 50 cards. So practice
     presents roughly **one look per piece at the small end, with the ratio falling as the capsule
     grows**, because a capsule exists to reduce decision load rather than to enumerate. Practice
     also does not vary the count by season, which argues for a season-invariant cap.

   That last finding inverts the premise this decision started from: the capsule axis is **rotation,
   not combinatorial reach**. A fourth finding complicates it — per-slot capacity is wildly uneven
   (5 cores for `casual_city_day` against 21 for `smart_casual_outing` at the same budget), so a
   single total-outfit number is a blunt instrument regardless of where it is set.

   **Open questions, wanted as concrete recommendations:** Is rotation the right frame, or does the
   one-look-per-piece convention reflect the limits of publishing a lookbook rather than what an
   owner actually wants from a tool that can generate on demand? Given uneven per-slot capacity,
   should the bound be a total at all, or per-slot? And is a piece budget even the right thing to
   ask an owner to specify? Argue from practice and from the artifacts, not from this summary.
8. Spending a conversational turn on a clarifying question — and a live weather lookup — before
   producing a plan is worth the delay it costs.
9. **Scaffolding needs a stopping rule, and this product does not have one.**

   The Stylist is meant to be a stylist who knows the owner's wardrobe — familiar with their
   preferences without being mechanically bound by them. On top of the model sits a growing layer
   of structure: trip and capsule planners with slot systems, piece budgets and outfit caps;
   per-slot weather resolution; register ceilings; activity profiles; hard validity gates; and
   structured cards as the response format. Each was added because it made one use case
   demonstrably better. None can be removed casually. And no finite set of them can anticipate the
   use cases nobody has thought of yet.

   `AGENTS.md` already draws a line: *"Code constrains, the model judges. Deterministic code
   enforces hard constraints from structured data. The LLM performs aesthetic judgment. A keyword
   rule that encodes taste is in the wrong layer."* Some existing structures are verifiable physics
   (weather, garment-ID validation); others encode judgment (register ceilings, piece budgets,
   outfit caps). The question is whether that line sits where it should — and, harder, what test
   tells you a **proposed** structure falls on the wrong side of it *before* it is built.

   **Open question — answer with a decision rule, not an opinion.** What test should this product
   apply to a proposed new structure to decide whether it belongs in deterministic code, in the
   prompt, or nowhere at all? And what are the observable signs that scaffolding has begun to cost
   more than it returns? Draw your evidence from the artifacts rather than from this framing.

**Settled, with rationale — do not spend a slot on it.** *Proposing pieces the owner does not own
is a legitimate stylist function, not a shopping feature in disguise.* Owner ruling, 2026-07-24:
true for now, because styling an item sometimes requires seeing how it was **intended** to be
styled, and the owner's wardrobe may hold nothing that accomplishes that. A reviewer may still
challenge this, but only with an argument that engages that rationale.

Each reviewer must, per proposition: take a position, state the strongest counter-argument to
their own position, and name **what would have to be observably true for them to be wrong**. That
last clause is the control that keeps the answer tethered to something the code or behavior can
settle.

---

---

## Settled ground — owner rulings you may not re-litigate

Decided by the owner after earlier review. Each may be challenged, but only with a NEW
argument engaging its stated reasoning — not a restatement that it looks wrong. The first
list covers things that were built and then decided; the second covers absences that look
like bugs but are intentional or simply never built.

**Resolved, not open:**
- "Recommended design direction" feedback, points #3 and #4 (visual-thesis line, strength-label
  rename) — implemented, see entry above. Points #1, #6, #7 were already satisfied by
  pre-existing code or this session's earlier E3 work. Point #5 (telemetry/vocabulary
  disclosure) confirmed mostly already done, with the one named term (`artistic_minimal`)
  confirmed clean of any client-side leak.
- E3 (editorial shop-the-gap silhouette comparison) — implemented (free `visualPrompt` text +
  compare-silhouettes strip).
- **Garment IDs in stylist prose** ("The tan leather tote (ID 12)…") — owner ruling 2026-07-25:
  **deliberate and requested**, not an internals leak. The IDs are there so a recommendation that
  exposes a mistagged garment leads straight to the record that needs fixing — and because garment
  names collide constantly, especially auto-tagger-written ones, so the ID is what makes a
  recommendation point at one unambiguous record. Not a defect, so it belongs on every future
  exclusion list. **But the presentation is open:** the owner invites panels to propose
  alternatives, provided they actually solve garment disambiguation rather than just hiding the
  number.
- A4 (cost-bearing actions on broken/"needs review" cards) — owner ruling: leave as-is, cards
  are usually fine, the engine is what's broken. Not a bug.
- E4b (comparison-sheet illegible baked-in captions) — owner ruling: leave alone, it's the image
  model not complying with an already-correct "no text" instruction, not a fixable prompt bug.
- PR B follow-on (post-render board taxonomy unification) — implemented, then partially
  superseded by the message-level feedback removal above; what remains (three new shared
  reasons, crud.js sync correctness) is ratified.
- Message-level feedback under plain text — removed entirely, ratified.
- Diagnostic-card disclaimer specificity + double-card dedup broadening — implemented, ratified.
- E1 (critique buries the answer) — implemented, ratified: the actionable answer now leads the
  collapsed "Full structured read" details instead of trailing the diagnostic dump.
- E9 (unstable "N looks" counts) — implemented. Root cause: two independent, disagreeing
  counting rules for the same data. The in-chat header (`StylistChat.jsx`'s
  `lookCount = visible.length || outfits.length`) already excluded `diagnosticOnly` cards; the
  thread-rail sidebar subtitle (`threadGrouping.js`'s `getThreadOutcomeSummary`) counted
  `memory.latestOutfits.length` raw, diagnostic cards included — so a thread with any lingering
  diagnostic card showed a different count in the sidebar than in the chat itself. Confirmed via
  `git blame`/diff review that PR 174 (E1) didn't touch this — different function, different
  file, no overlap. Fix: `getThreadOutcomeSummary` now filters `diagnosticOnly` outfits before
  counting/deriving themes, with the same empty-set fallback (count everything if the filtered
  set is empty) the header already uses, so an all-diagnostic thread still shows a real number
  instead of falling through to the no-outfits branch. Verified via two new precise assertions
  in `test/threadRail.test.js` (mixed diagnostic+real, and all-diagnostic) using the actual
  function's real output, not hand-derived expected strings. `npm run build` passed; full
  relevant suite passed with no new failures. Live-verified in a freshly-restarted mocked
  sandbox that the sidebar renders normally with no regressions for ordinary threads — the
  specific mixed-diagnostic scenario itself wasn't reproduced live, since (like the PR A-follow-
  on dedup fix) that requires an uncontrollable real model response the mock can't produce; the
  unit test's use of real function output is the verification for that part.
- E10 (lossy thread-rail subtitles) — implemented. Root cause: critique, similar-variants,
  creative-alternatives, adjacent-variants, and comparison threads all share
  `activeContext.type === 'outfit'` and `thread.kind === 'outfit_critique'`, and
  `getThreadDisplayTitle`/`getThreadOutcomeSummary` (the flat "Recent" list — the default rail
  view) both collapsed every one of them to the same generic `"<name> critique"` title /
  `"Outfit critique"` subtitle regardless of which action it actually was. The differentiation
  logic already existed and worked correctly — `outfitSubjectActionTitle`, pattern-matching the
  turn's prompt/title/source text for creative/adjacent/similar/comparison/critique keywords —
  but was only wired into `getThreadSubjectChildTitle` (the "By outfit/piece" clustered view's
  child rows), not the default flat list. Fix: both flat-list functions now call
  `outfitSubjectActionTitle`, falling back to the old generic text only if it can't tell (empty
  prompt/title/source). Added `SHORT_OUTFIT_ACTION_LABELS` so the title's terse
  `"<name> · <action>"` suffix convention (already established for Similar/Creative at thread-
  creation time in `StylistChat.jsx`'s `send()`) extends to the two actions that convention never
  labeled (comparison, adjacent variants); the subtitle uses the full descriptive form directly
  since it reads naturally as a standalone summary line. Verified via 8 new precise assertions in
  `test/threadRail.test.js` (four action categories × title + subtitle) using real function
  output. `npm run build` passed; full relevant suite passed with no new failures. Live-verified
  in a freshly-restarted mocked sandbox against real existing threads: confirmed genuinely
  differentiated output across both the flat list (`"Boston bench · Critique"` / `"Outfit
  critique"`, `"Whole-wardrobe comparison sheet · Compari…"` / `"Outfit comparison"`, `"with my
  camera · Creative"` / `"Creative alternatives"` — previously all identical) and the clustered
  view (no regression: `getThreadSubjectChildTitle`'s internal call to `getThreadDisplayTitle`
  still correctly separates "Outfit critique" and "Creative alternatives" as distinct child rows
  under the same "with my camera" subject).

**Deliberately not built / by design — not defects, do not re-file:**

This list exists because the *Resolved, not open* list above only covers things that were built
and then decided; it says nothing about absences that look like bugs but are either intentional
behaviour or simply never built. That gap let the same four non-defects get independently
rediscovered and reported as bugs four times in one working session (2026-07-25) before anyone
wrote them down in one place. If a panel or a future session finds an absence that isn't on this
list, that is a real finding — but check here first.

- **"City stroll" implying comfortable walking shoes.** Owner ruling 2026-07-25: by design. A slot
  described as a city stroll should get walking-suitable footwear; the inference already fires
  only on the `smart_casual_outing` slot whose `bestFor` names it, not on the other four slots.
  Full trace in `docs/stylist-bugfix-spec.md`.
- **One shoe carrying 7 of 8 looks in a 14-piece capsule.** Diagnosed, not a variety failure: the
  budget buys exactly 3 shoe slots (`capsuleQuotas`), one of which the register-floor guarantee
  spends on an evening-capable shoe. Correct behaviour given the current shoe-quota math. The
  underlying "is 3 shoe slots the right number for a 14-piece capsule" question is still open —
  see item 2 above (plan outfit cap) — but the 7-of-8 distribution itself is not a bug.
- **Plans not absorbing their own revisions.** Never built. Ask a plan for a change and the
  revision arrives as a separate `proposed` card beside the plan rather than folding in — a second
  cost of the same gap is that a revised plan gets progressively harder to find in the thread rail
  the more it's refined, since the rail summarises from only the latest turn's outfits. Judge
  whether the merge *should* exist; its absence is not itself a defect to report. Full detail in
  `docs/stylist-bugfix-spec.md`.
- **Garment IDs in stylist prose** — also listed under *Resolved, not open* above; repeated here
  because it is the paradigm case (an absence-of-obfuscation that reads as an internals leak but is
  a deliberate, requested disambiguation mechanism).


---

## The artifacts

Real stylist output, transcribed verbatim. Indented text is what the model wrote; the
notes beneath describe what the UI actually displayed. A–E are plans and conversation;
F–H cover the un-rendered direction surface, the critique form, and a gate-rejected card.

**Two things every artifact predates, both since fixed — do not report either:**

1. **The prose was discarded entirely for plan responses.** The owner saw only the cards.
   The gap between what the model wrote and what was shown is visible below, and bears
   directly on propositions 7 and 9.
2. **Heuristic weather carried no marker.** Lines like `Weather used: Casual Days — hot,
   highs 100-105F` were estimates shown with the same confidence as a resolved forecast.
   They now read `(estimated)`; the `(live forecast, City)` marker in Artifact C was and
   remains genuine. Judge proposition 8 on the mechanism, not these stale labels.

### Artifact A — 14-piece summer capsule (236-piece wardrobe)

*Thread `thread_1784970885986` — central to propositions 1, 6 and 7*

**OWNER ASKED:** Build me a 14-piece summer capsule

**STYLIST WROTE:**

> Here's your **14-piece summer capsule** — 12 pieces the engine confirmed within budget (it noted 2 pieces from the original pool weren't needed to complete all 8 looks), yielding 8 outfits across every summer use case. The wedge heels flagged out of the walking slots, so the canvas slip-ons do heavy duty there; the burgundy cork wedges carry the one evening look.
>
> ---
>
> **The 12-piece roster:**
> 1. White scoop neck sleeveless top
> 2. White tie front blouse
> 3. White ruffled long sleeve top
> 4. Large flowers floral print tank
> 5. Black blouson v-neck top
> 6. Black cream botanical tiered midi skirt
> 7. Light beige linen wide-leg pants
> 8. Wide leg trousers (lace-trim)
> 9. Oatmeal crochet knit midi skirt
> 10. Blue botanical sleeveless dress
> 11. Navy canvas slip-on shoes
> 12. Burgundy suede cork wedge sandals
>
> *(The black open-toe wedge sandals and beige twill capris are the 2 pieces trimmed — the 12 above cover all 8 looks without them. Add them back if you want more shoe variety or a casual shorts option.)*
>
> ---
>
> **The 8 outfits:**
>
> **— CASUAL CITY DAY —**
>
> **1 · Botanical Canvas** — White scoop tank + black cream botanical tiered midi skirt + navy canvas slip-ons. The graphic black-and-cream print does all the work; the tank stays clean and quiet beneath it.
>
> **2 · Blue Botanical Drift** — Blue botanical sleeveless dress + navy canvas slip-ons. A one-piece day — the vivid turquoise botanical print carries it solo; the dark navy slip-ons echo the dress's outline tones.
>
> ---
>
> **— SMART CASUAL OUTING —**
>
> **3 · Lace Tier, Tied Front** — White tie-front blouse (worn loose, not tucked) + wide-leg lace-trim trousers + navy canvas slip-ons. The blouse's soft tie detail and the trouser's lace waistband read as deliberate echo rather than accident.
>
> **4 · Linen & Large Flowers** — Large flowers floral tank + beige linen wide-leg pants + navy canvas slip-ons. Warm neutral linen base, bold print on top — exactly the one-loud-one-quiet formula at its most summery.
>
> **5 · Dark Drape + Botanical Hem** — Black blouson v-neck + black cream botanical tiered skirt + navy canvas slip-ons. The dark top skims the waist; the botanical movement below reads as the reveal. Dark column, expressive hem.
>
> ---
>
> **— EVENING OUT —**
>
> **6 · Floral Tank + Crochet Midi** — Large flowers floral tank + oatmeal crochet knit midi skirt + burgundy cork wedge sandals. Warm cream-and-black print tones land right inside the crochet's natural palette; the burgundy wedge is the one-color hit.
>
> ---
>
> **— OUTDOOR DAYTIME SOCIAL —**
>
> **7 · Ruffled White + Botanical Ground** — White ruffled top + black cream botani
>
> [truncated]

**UI DISPLAYED 8 structured card(s):**
- Casual City Day (casual_city_day): white scoop neck sleeveless top + black cream botanical tiered midi skirt + navy solid canvas slip shoes
- Casual City Day (casual_city_day): blue botanical sleeveless dress + navy solid canvas slip shoes
- Smart Casual Outing (smart_casual_outing): white tie front blouse + wide leg trousers + navy solid canvas slip shoes
- Smart Casual Outing (smart_casual_outing): Large flowers floral print tank + light beige linen wide-leg pants + navy solid canvas slip shoes
- Smart Casual Outing (smart_casual_outing): black blouson v-neck top + black cream botanical tiered midi skirt + navy solid canvas slip shoes
- Evening Out (evening_out): Large flowers floral print tank + oatmeal crochet knit midi skirt + burgundy suede cork wedge sandals
- Outdoor Daytime Social (outdoor_daytime_social): white ruffled long sleeve top + black cream botanical tiered midi skirt + navy solid canvas slip shoes
- City Gallery (city_gallery): black blouson v-neck top + light beige linen wide-leg pants + navy solid canvas slip shoes

**Engine plan lines attached to this response:**
- `Plan length: Summer capsule`
- `Coverage: Casual days + smart casual outings + evenings + outdoor socials + gallery visit — all warm summer weather`
- `2 Casual City Day looks cover errands, coffee, weekend wandering`
- `Weather used: Casual City Day — warm; Smart Casual Outing — warm; Evening Out — warm; Outdoor Daytime Social — warm; City Gallery — warm`
- `Piece roster (12): white scoop neck sleeveless top, black cream botanical tiered midi skirt, navy solid canvas slip shoes, blue botanical sleeveless dress, white tie front blouse, wide leg trousers, Large flowers floral print tank, light beige linen wide-leg pants, black blouson v-neck top, oatmeal crochet knit midi skirt, burgundy suede cork wedge sandals, white ruffled long sleeve top`
- `12 pieces → 8 outfits`
- `Within the 14-piece budget.`
- `[plan trimmed: "Evening Out" reduced from 2 to 1 look — the plan asked for more outfits than the 8-outfit total across the set allows]`
- `[plan trimmed: "Outdoor Daytime Social" reduced from 2 to 1 look — the plan asked for more outfits than the 8-outfit total across the set allows]`

**Engine piece-reuse record:** 12 distinct pieces; repeats: black cream botanical tiered midi skirt -> Casual City Day, Smart Casual Outing, Outdoor Daytime Social; navy solid canvas slip shoes -> Casual City Day, Smart Casual Outing, Outdoor Daytime Social; Large flowers floral print tank -> Smart Casual Outing, Evening Out; light beige linen wide-leg pants -> Smart Casual Outing, City Gallery

### Artifact B — Tucson, 6 days (236-piece wardrobe)

*Thread `thread_1785005174812` — clarify-before-planning, declared shoe economy, owner pushback*

**OWNER ASKED:** I am going to Tucson in a week. I'll be there for 6 days, not counting travel days. I'll mainly be hanging out with my four-year-old nephew and visiting my mom. Maybe a hike in the park, plus some comfortable airplane clothes.

**STYLIST WROTE:**

> Tucson in late July is serious desert heat — we're talking highs of 100–105°F most days, with monsoon afternoon thunderstorms possible. That's the most important constraint here. Before I build the plan, I want to make sure I cover the right things.
>
> Here's what I'm hearing:
>
> - **Casual days** — hanging with your nephew and visiting your mom (mostly outdoor or in-and-out)
> - **A hike** — in the park (Saguaro? Sabino Canyon?)
> - **Travel days** — comfortable airplane outfit each way
>
> A few quick questions to nail the plan:
>
> 1. **How dressy do the family visits get?** Is your mom a "let's go out to a nice lunch" person, or purely relaxed home/backyard time? That tells me whether to include a smart-casual look or keep everything casual.
> 2. **The hike** — is this a real trail hike (sun exposure, rocky terrain, serious walking) or more of a nature walk? That affects footwear in particular. Do you have proper hiking shoes or trail sneakers, or would you rely on athletic sneakers from your wardrobe?
>
> Once I know that, I'll build the full 6-day plan — I want to make sure the heat layering, shoe choices, and outfit count are actually right for Tucson in July rather than guessing.

**OWNER ASKED:** A hike is more of a nature walk. Yeah, "let's go out to a nice lunch" might happen once.

**STYLIST WROTE:**

> Here's your Tucson plan — 6 looks, 3 pairs of shoes, built for the heat.
>
> ---
>
> **Tucson · August 1–6 · Highs 100–105°F**
>
> ---
>
> **CASUAL DAYS (3 looks for the family days)**
>
> **1 — Desert Botanical** · blue botanical sleeveless dress + brown leather strap sandals + black sunglasses
> The technical performance fabric on that dress is genuinely the right call for 100°F — it breathes and moves, and the bold botanical print does all the visual work so you're not thinking about the outfit while chasing your nephew.
>
> **2 — Coral Float** · coral solid maxi dress + brown leather strap sandals + amber pendant necklace
> The maxi length actually keeps sun off your legs, and the jersey is as close to wearing nothing as the wardrobe gets. The amber pendant is just enough to make it feel intentional rather than purely off-duty.
>
> **3 — Tropical Easy** · orange ribbed tank + tropical pants + navy canvas slip shoes + black sunglasses
> One bold piece (the tropical pants), one quiet piece (the fitted orange tank). The cotton pants are lightweight enough for the heat and the print is lively without requiring any effort.
>
> ---
>
> **NATURE WALK (1 look)**
>
> **4 — Park Walk** · turquoise sleeveless dress + grey orange mesh athletic sneakers + black sunglasses
> The turquoise performance dress is the best heat-and-movement combo you own — it wicks and moves freely. The athletic sneakers are the right call for uneven desert terrain over any sandal. Sunglasses are non-negotiable in Tucson sun.
>
> ---
>
> **NICE LUNCH OUT (1 look)**
>
> **5 — Botanical Garden Lunch** · colorful botanical print maxi dress + navy canvas slip shoes + amber pendant necklace
> This is a confirmed formula — the botanical maxi reads dressed-up without requiring heels or fuss, which is exactly right for a nice lunch in a hot climate. The amber pendant pulls the warm tones from the print.
>
> ---
>
> **TRAVEL DAY (1 look)**
>
> **6 — Transit Easy** · black abstract midi dress + navy canvas slip shoes + multi-colored botanical scarf
> The abstract midi is wrinkle-resistant and airport-smart. The canvas slip-ons clear security with zero drama. The scarf folds to nothing in your bag and handles plane A/C when you need it.
>
> ---
>
> **Shoes: 3 pairs total**
> - Brown leather strap sandals → casual days
> - Grey athletic sneakers → nature walk only
> - Navy canvas slip shoes → tropical outfit + nice lunch + travel
>
> **A heads-up on the monsoons:** Tucson's afternoon storms in August can roll in fast. If you're out with your nephew and it starts raining, the botanical dress (technical fabric) and the canvas slip shoes handle light rain fine — but avoid t
>
> [truncated]

**UI DISPLAYED 6 structured card(s):**
- Casual Days (casual_days): blue botanical sleeveless dress + brown leather strap sandals + classic oversized black sunglasses
- Casual Days (casual_days): coral solid maxi dress + brown leather strap sandals + amber pendant necklace
- Casual Days (casual_days): orange ribbed tank top + Tropical pants + navy solid canvas slip shoes + classic oversized black sunglasses
- Nature Walk (nature_walk): turquoise sleeveless straight mid-thigh dress + grey orange mesh athletic sneakers + classic oversized black sunglasses
- Nice Lunch Out (nice_lunch_out): colorful botanical print maxi dress + navy solid canvas slip shoes + amber pendant necklace
- Travel Day (travel_day): black abstract midi dress + navy solid canvas slip shoes + multi-colored botanical scarf

**Engine plan lines attached to this response:**
- `Plan length: 6 days`
- `Coverage: 4-5 casual family days, 1 nature walk, 1 nice lunch, travel days each end`
- `3 Casual Days looks cover Hanging with nephew, visiting mom, errands around Tucson`
- `Weather used: Casual Days — hot, highs 100-105F, sunny, humid monsoon possible; Nature Walk — hot, highs 100-105F, sunny; Nice Lunch Out — hot, highs 100-105F, indoor restaurant likely air-conditioned; Travel Day — indoor`
- `Repeat schedule: brown leather strap sandals (Casual Days); classic oversized black sunglasses (Casual Days, Nature Walk); amber pendant necklace (Casual Days, Nice Lunch Out); navy solid canvas slip shoes (Casual Days, Nice Lunch Out, Travel Day)`

**Engine piece-reuse record:** 13 distinct pieces; repeats: brown leather strap sandals -> Casual Days; classic oversized black sunglasses -> Casual Days, Nature Walk; amber pendant necklace -> Casual Days, Nice Lunch Out; navy solid canvas slip shoes -> Casual Days, Nice Lunch Out, Travel Day

**OWNER ASKED:** oh boy, why did you pick my nice dress for the Airplane travel?

**STYLIST WROTE:**

> That's the right call for a travel day — unprecious, functional, and you won't arrive wrinkled. The botanical maxi stays pristine for the nice lunch out. 
>
> The rest of the plan (outfits 1–5) stays exactly as is.

**UI DISPLAYED 1 structured card(s):**
- Travel Day (proposed): black abstract midi dress + navy solid canvas slip shoes + multi-colored botanical scarf

### Artifact C — wedding weekend (236-piece wardrobe)

*Thread `thread_1784240128734` — the one case where a live weather forecast actually resolved*

**OWNER ASKED:** I have a wedding weekend coming up: dressy rehearsal dinner Friday, formal outdoor ceremony Saturday afternoon, casual farewell brunch Sunday — one look each.

**STYLIST WROTE:**

> Before diving in — where is the wedding? I want to pull the actual forecast for Saturday's outdoor ceremony (and Friday/Sunday too), since outdoor formal in July can swing a lot by location.

**OWNER ASKED:** Tahoe

**STYLIST WROTE:**

> I found 1 verified outfit card for this request. I couldn't complete all 3 requested looks before the tool loop stopped.

**UI DISPLAYED 1 structured card(s):**
- Outdoor Ceremony (outdoor_ceremony): black white abstract maxi dress + beige leather chunky heel sandals + amber pendant necklace + red paisley patterned wrap shawl

**Engine plan lines attached to this response:**
- `1 Outdoor Ceremony look covers Outdoor Ceremony`
- `Weather used: Outdoor Ceremony — hot (live forecast, South Lake Tahoe, CA)`
- `Packing reuse: 4 distinct pieces; no repeated pieces needed.`

**Engine piece-reuse record:** 4 distinct pieces; no repeated pieces needed.

### Artifact D — today / dinner (236-piece wardrobe)

*Thread `thread_1785003920853` — multi-turn refinement; unprompted alternatives; a correction landing next turn*

**OWNER ASKED:** What should I wear today? Not doing anything special till the evening. Then dinner with friends.

**STYLIST WROTE:**

> Two looks for the day —
>
> **Daytime** is effortless: the floral botanical patchwork top does all the talking against the quiet sage linen, with navy slip-ons that echo the print's dark outlines. Grab it, go, no thought required.
>
> **For dinner**, the Apple skirt is the whole story — that bold botanical sweep of green, orange, mustard, and teal is plenty. The black blouson top keeps everything above the waist clean and out of the way. The cutout mules and the orange crossbody both pull from the skirt's own colors, so it feels pulled together without trying.
>
> One easy swap if you want: if you'd prefer flats over the mules for dinner, the black slip-on loafers (ID 196) work just as cleanly with that skirt.

**UI DISPLAYED 2 structured card(s):**
- Lazy Saturday (proposed): floral botanical patchwork top + sage cropped pants + navy solid canvas slip shoes + amber pendant necklace
- Dinner With Friends (proposed): black blouson v-neck top + Apple skirt + black floral cutout mules + bold orange leather crossbody bag

**OWNER ASKED:** Dinner outfit is good for the restaurant, but we might be doing it at our place. Give me some other options for a lazy Saturday too. Not sure I want to wear a rayon top.

**STYLIST WROTE:**

> Three directions, all cotton or jersey knit, all properly hot-weather. A quick note on the dinner outfit — if it ends up at your place, you might want something a touch more relaxed than the Apple skirt + mules. The Dinner With Friends look still works beautifully at home, but let me know if you'd like a more laid-back version of it.

**UI DISPLAYED 3 structured card(s):**
- Saturday A.M. Ease (proposed): mustard ruffled scoop top + Tropical pants + brown leather strap sandals
- Bright + Breezy Saturday (proposed): cream botanical print t-shirt + orange cotton casual shorts + bold multicolor floral espadrille shoes
- Low-Key Warm Tones (proposed): orange ribbed tank top + textured mauve relaxed pants + brown suede platform sandals

### Artifact E — same capsule request, 23-piece wardrobe

*Thread `thread_1784969942592` — scarcity contrast with Artifact A*

**OWNER ASKED:** Build me a 14-piece summer capsule

**STYLIST WROTE:**

> Here's your 14-piece summer capsule — 7 outfits across 5 use cases, all built from a tight 7-piece roster that mixes and recombines cleanly. Let me walk you through it.
>
> ---
>
> ## 🌿 14-Piece Summer Capsule
> **Piece roster (7 core pieces):** rust floral wrap dress · cream cotton button-up · rust corduroy overshirt · black A-line midi skirt · cream leather sneakers · cream chunky sneakers · black ankle boots
>
> ---
>
> ### Casual Daytime · Look 1 — *Easy Sunday*
> Rust floral wrap dress + cream chunky sneakers. The warm terracotta of the dress and the aged cream of the chunky sole are in the same tonal family — effortless and warm without trying.
>
> ### Casual Daytime · Look 2 — *Rust Overshirt Day*
> Rust floral dress + rust corduroy overshirt (open/unbuttoned) + cream chunky sneakers. Tonal earthy layering — the two rusts are close enough to read as intentional, not accidental.
>
> ### City Outing · Look 1 — *Market Morning*
> Rust corduroy overshirt + black A-line midi skirt + cream leather sneakers. The earthy rust over a clean black column is a strong contrast pair. Slim cream sneakers keep the formality light for a walking day.
>
> ### City Outing · Look 2 — *Clean Brunch*
> Cream cotton button-up + black A-line midi skirt + black ankle boots. The cream shirt brightens a tonal black bottom half — quiet, clean, and walks well.
>
> ### City Outing · Look 3 — *Rust in the City*
> Rust floral wrap dress + cream leather sneakers. Same dress, different shoe — the slimmer leather sneaker reads a notch more city-intentional than the chunky pair.
>
> ### Outdoor Daytime Social · Look 1 — *Garden Afternoon*
> Cre
>
> [truncated]

**UI DISPLAYED 7 structured card(s):**
- Casual Daytime (casual_daytime): rust floral wrap short-sleeve dress + cream chunky lace-up sneakers
- Casual Daytime (casual_daytime): rust corduroy button-up shirt + rust floral wrap short-sleeve dress + cream chunky lace-up sneakers
- City Outing (city_outing): rust corduroy button-up shirt + black A-line midi skirt + cream leather lace-up sneakers
- City Outing (city_outing): cream cotton button-up shirt + black A-line midi skirt + black lace-up ankle boots
- City Outing (city_outing): rust floral wrap short-sleeve dress + cream leather lace-up sneakers
- Outdoor Daytime Social (outdoor_daytime_social): cream cotton button-up shirt + black A-line midi skirt + cream leather lace-up sneakers
- Smart Casual / Dinner (smart_casual_dinner): rust floral wrap short-sleeve dress + black lace-up ankle boots

**Engine plan lines attached to this response:**
- `2 Casual Daytime looks cover errands, coffee, weekend ease`
- `Weather used: Casual Daytime — warm; City Outing — warm; Outdoor Daytime Social — warm; Smart Casual / Dinner — warm; Evening — warm`
- `Piece roster (7): rust floral wrap short-sleeve dress, cream chunky lace-up sneakers, rust corduroy button-up shirt, black A-line midi skirt, cream leather lace-up sneakers, cream cotton button-up shirt, black lace-up ankle boots`
- `7 pieces → 7 outfits`
- `Within the 14-piece budget.`
- `[plan trimmed: "Outdoor Daytime Social" reduced from 2 to 1 look — the plan asked for more outfits than the 8-outfit total across the set allows]`
- `[plan trimmed: "Smart Casual / Dinner" reduced from 2 to 1 look — the plan asked for more outfits than the 8-outfit total across the set allows]`
- `[coverage gap: "Evening" needed 1 look but only 0 valid outfits were submitted — the other attempts failed validation]`
- `[plan trimmed: "Evening" reduced from 2 to 1 look — the plan asked for more outfits than the 8-outfit total across the set allows]`

**Engine piece-reuse record:** 7 distinct pieces; repeats: rust floral wrap short-sleeve dress -> Casual Daytime, City Outing, Smart Casual / Dinner; cream chunky lace-up sneakers -> Casual Daytime; rust corduroy button-up shirt -> Casual Daytime, City Outing; black A-line midi skirt -> City Outing, Outdoor Daytime Social

### Artifact F — ideal-additions directions, un-rendered (236-piece wardrobe)

*Thread `thread_1783803763847` — the free-before-paid surface. Central to proposition 1.*

**OWNER ASKED:** Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.

**STYLIST WROTE:**

> Here are three styling directions for bold purple floral sleeveless top. Review them and click "Generate image (~$0.07)" on any you want to render.

**UI DISPLAYED 3 un-rendered direction card(s).** Each carries a free CSS
croquis sketch (garment-shaped colour blocks), a plain-language thesis line, a
'Full look:' description, and a `Generate outfit image (~$0.07)` button. A free
'Compare silhouettes' strip shows all of them side by side, above a paid
`Preview all directions (~$0.07)` action.

- **Tailored Elegance**
  - Full look: Fitted dark top, deep charcoal structured wide-leg trousers, sleek black leather loafers. Matte textures, dark neutral palette with a bold top as the focal point. Relaxed confident stance.
  - Ideal additions the owner does not own: deep charcoal structured wide-leg trousers, sleek black leather loafers
- **Artisan Flair**
  - Full look: Fitted top with bold pattern, camel-toned flowing midi skirt, and brown strappy sandals. Textural contrast with earthy tones grounding the vibrant top. Relaxed, effortless posture.
  - Ideal additions the owner does not own: camel-toned flowing midi skirt, brown strappy sandals
- **Urban Explorer**
  - Full look: Bold printed top, black high-waisted cargo pants, lightweight canvas sneakers. Matte, practical textures with a mix of utility and bold accents. Confident, dynamic posture.
  - Ideal additions the owner does not own: black high-waisted cargo pants, lightweight canvas sneakers


### Artifact G — outfit critique (236-piece wardrobe)

*Thread `thread_1784620777062` — the structured-read output form. Central to proposition 5.*

**STYLIST WROTE** (visible prose first, then a collapsed 'Full structured read'):

> This outfit is working on its own terms — the folk-geometric jacket is the clear hero, and everything around it plays a supporting role correctly: the taupe knit base stays quiet, the beige wide-leg pants give it a neutral ground, and the woven straw bag and jute-platform espadrilles form a natural-material echo that reads like an intentional artisan detail rather than an accident. The bold floral shoe is actually the bravest move here, and it lands because the jute sole connects directly to the bag's woven texture.
>
> The one thing to test is the waist transition — with the top untucked at hip level over a relaxed wide-leg pant, both volumes are similar width, so the silhouette flattens into one continuous soft column rather than the compact-top-wide-bottom read the pants are designed for. To answer your question directly: no, the pants are not the problem. Try buttoning the jacket at the lowest button on your next wear — it narrows the center column visually and gives the proportion a cleaner break without changing anything else.
>
> Verdict: keep
>
> --- Full structured read ---
>
> Intent: folk-artisan casual with earthy texture layering
> Success criteria: The jacket pattern reads as the textural hero, not as casual noise The wide-leg pant grounds the look without competing with the jacket The espadrilles connect to the folk/artisan register without introducing a third competing pattern register The overall palette stays in an earthy warm lane: taupe, beige, cream, dark floral The bag's woven texture closes the artisan loop at the accessory level
>
> Visible facts:
> Floor line: The wide-leg beige pants fall to full length, grazing the floor or just above. The platform espadrille sole is visible beneath the hem — the chunky jute platform peeks out but the pant leg is wide enough tha
>
> [truncated]


### Artifact H — a gate-rejected proposal shown as 'needs review' (23-piece sandbox)

*Thread `thread_1784876334282` — central to proposition 3. Note: no diagnostic card appears*
*in the last 150 real-wardrobe threads, so this surface is rare in live use.*

**UI DISPLAYED 5 cards, 2 of them 'needs review':**

- **Rust Shirt Day: standard wear** — engine verdict `structural: missing bottom`
  - shown to the owner as: "What didn't clear: structural: missing bottom"
  - the card still offers `Generate outfit image (~$0.07)` and `Evaluate outfit`
- **White Shirt, Where Are You: standard wear** — engine verdict `structural: missing bottom`
  - shown to the owner as: "What didn't clear: structural: missing bottom"
  - the card still offers `Generate outfit image (~$0.07)` and `Evaluate outfit`


---

## Part 5 — Output contract

Mode A reviewers return **blocking issues**, **important refinements**, and **what is already
working**, separately, each with its user-task consequence.

Mode B reviewers return a **position per proposition**, each with its counter-argument and its
falsification condition, plus any product bet they think is missing from the list.

Where a proposition carries an **open redesign question** (marked as such in its text), answer it
with a concrete recommendation and the reasoning behind it — not only a position on the existing
behaviour. Those are the places the owner has already decided the current shape is wrong and wants
outside judgment on what replaces it, drawn from practice rather than from this codebase.

The implementing agent synthesizes agreement, reports genuine disagreement to Yuna rather than
resolving it silently, and records the owner-reviewed outcome in
[`ui-v1-design-handoff.md`](ui-v1-design-handoff.md). Nothing is described as ratified until Yuna
has reviewed the result.

For this Stage 1 run specifically, return:

1. **A position on each of the 9 propositions** — defend or attack, the strongest
   counter-argument to your own position, and what would have to be observably true for
   you to be wrong. Cite specific garments, looks or lines from the artifacts.
2. **Concrete recommendations** on the open questions in proposition 7 (the capsule
   redesign — research exists and wants breaking or confirming) and proposition 9 (a
   decision rule for when to add structure).
3. **Any product bet missing** from the list of 9.
4. **One change you would make and one thing you would protect**, in your own lens.

Be blunt. Hedged prose is useless here. If a proposition is wrongly framed, say so and
reframe it — that is more valuable than a position on a bad question.
