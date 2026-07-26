# Expert panel brief

**Status:** owner-ratified 2026-07-25. Mode A is proven on Wardrobe and Lookbook. Mode B is
ratified as a protocol but has never been run — treat its first outing as a test of the
instrument as well as of the surface, and revise this document afterward.

The standing brief handed to every expert reviewer, for every surface. `AGENTS.md`'s
**Mandatory UI expert panel** rule points here. Prior rulings and the durable visual rubric stay
in [`ui-v1-design-handoff.md`](ui-v1-design-handoff.md) — this document is about *how to convene
and brief a panel*, not what has already been decided.

Part 1 is copied verbatim into every reviewer's context regardless of surface or mode. A reviewer
who only knows the screen in front of them cannot assess whether that screen serves the product.

---

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

## Part 2 — Two panel modes

Pick the mode from the question being asked. Running the wrong one is what produces a defect list
where a product judgment was wanted.

### Mode A — Craft review

**Use when** the surface follows recognizable conventions and the question is whether it is
executed well: inventories, collections, detail views, forms, settings. Wardrobe and Lookbook are
the reference cases; this mode worked well on both.

**Question:** is this competently made, current, and consistent with the rest of the app?

**Inputs:** the shared app context, the surface's ratified rulings, live browser access at
1440/1024/768px, and populated, empty, long-content, and error states.

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

## Part 3 — Roles

### Mode A roles

**Product design.** Information hierarchy, interaction clarity, action priority, responsive
composition, and consistency with already-ratified surfaces. Does the visual structure match the
decision the person is making here?

**UX and accessibility.** Readable type and contrast, focus order and return, keyboard and Escape
behavior, touch targets, stable layout, scrolling, loading and empty states. Report the
user-task consequence, not just the violation.

**Fashion-product design.** Does the surface help a person understand a real garment or outfit,
compare styling evidence, reason about fit and wearability, and take the next useful wardrobe
action? Reject portfolio and catalog conventions that weaken the working styling task. Required,
never optional.

**Craft and currency** *(optional fourth lens; add when the question is "does this look dated?")*.
Give this reviewer **screenshots only, no browser tools** — removing the ability to measure
removes the pull toward measuring. Ask for: what genre and era does this read as, against what
current reference set, and the three structural tells driving that read. Then split the verdict
in two — *is the ratified direction executed competently?* and *has the ratified direction
itself aged?* Per-element findings are inadmissible in this report. Expect real signal on
conventions, eras, and structural tells (competing surface treatments, inconsistent radii, chrome
competing with content); do not expect art direction, spacing rhythm, or motion judgment.

### Mode B roles

**Styling competence.** Is the advice any good? Pointed at output quality — proposals, critiques,
rationales, the memory that accumulates — not at layout. Receives `AGENTS.md`'s *Styling
Principles* in full.

**Human↔model interaction design.** When does the system ask, what does it capture, what does it
do with what it captured, and does the owner ever see it pay off? This axis is the app's central
thesis and had no owner before this document.

**Cost and economics honesty.** Where the paid boundaries fall, whether free exploration is
genuinely sufficient to decide, and whether the product is honest about what a click costs.

---

## Part 4 — Evidence rules

**Data pre-flight, mandatory.** Any surface that renders stored data gets **freshly generated
data**, or that surface is excluded from the review. Threads, boards, and outfits created before
a recent fix will reproduce bugs that are already fixed, and the panel will spend its budget
rediscovering them. Check generation dates against the most recent relevant change before
handing anything over. Building deliberate scenarios costs real model spend — that is an argument
for doing it once, carefully, not for skipping it.

**Exclusion list, verbatim.** Copy both the *Resolved, not open* list and the *Deliberately not
built / by design* list from [`ui-v1-design-handoff.md`](ui-v1-design-handoff.md)'s **Outstanding
issues** section directly into the packet. Do not paraphrase either. The first section exists
precisely so a panel targets real gaps, and paraphrasing it once already inverted it; the second
exists because that same list of decided things said nothing about absences that look like bugs
but are intentional or simply unbuilt — a gap that let four such non-defects get independently
rediscovered and reported as bugs four times in one working session before anyone wrote them down.

**Rulings come with rationale, and are challengeable.** A reviewer may argue a ratified decision
is wrong; they must say so explicitly and give the reasoning, not smuggle a reversal into a
recommendation. A ruling re-flagged without a new argument is out of scope; a ruling re-flagged
because circumstances changed is a legitimate finding.

**States.** Populated, empty, long-content, error, and the narrow viewport — for every surface,
in both modes.

**Surface inventory, mandatory.** Before assembling a packet, list every surface the feature spans
— not just the one the question is about. For the Stylist that is: the chat thread, the per-piece
`…` menu, Settings → *Learned rules & preferences*, Visual Lab → *Calibration boards* and *Style
profile*, and the Lookbook entry points. Include each, or state in the packet that it was excluded
and why. Stage 1 shipped without four of those and a reviewer concluded a capability did not exist
when it did. A reviewer can only reason about what is in front of them, and a gap in the packet
reads to them as a gap in the product.

---

## Part 4b — How the implementing agent gets this wrong

Recorded from the Stage 1 run (2026-07-25/26). Every item below actually happened, most of them
more than once, and each produced either a false finding in a packet or a false correction to a
real one. Read this before assembling a packet and before synthesising results.

**1. Measuring one store and concluding a feature is broken.** The single most repeated error.
Board feedback lives in *two* stores — `stylist_feedback` (chat) and `saved_boards.payload`
(Visual Lab). Counting the second alone showed no writes for three days and produced a filed
regression against a feature that was being written to that same morning. Earlier in the same
session the same mistake produced "4 of 243 boards carry reason chips", which became the evidence
base for a whole proposition. **Before counting anything, read how the surface that displays it
persists it, and state which store you measured.** An empty table is not evidence of absence.

**2. Treating absence as defect.** Four separate times an absence was reported as a bug and turned
out to be deliberate or simply never built (garment IDs in prose; "city stroll" implying walking
shoes; one shoe carrying most of a capsule; plans not absorbing revisions). A fifth came from a
reviewer: *"nowhere can the owner see, edit or delete what the stylist has learned"* — there is a
Settings surface with Edit and Retire that the packet did not include. **Check the by-design list,
then check whether the thing has a different home, before writing the word "missing".**

**3. Shipping a packet that omits surfaces the feature spans.** Stage 1's packet transcribed chat
threads and nothing else — no Settings, no per-piece `…` menu, no owner-rule mechanism. Three
reviewers then reasoned about a teaching loop with its main capture channel and its entire
management UI invisible, and produced one dead finding and one inverted one. **Enumerate every
surface the feature touches and either include it or say explicitly that it was excluded.**

**4. Inferring causation from timestamp proximity.** An owner rule dated the same day as a
conversation was asserted to have come from that conversation. `context_id` was empty; the link did
not exist and could not be checked. The owner then supplied the actual sequence, which was
different in a way that mattered — the rule was captured on a second, differently-phrased attempt,
not the first. **If the link is not in the data, say so instead of inferring it.**

**5. Over-correcting when a premise is challenged.** Told that the `~$0.07` labels are owner-facing
instrumentation rather than user-facing pricing, the whole cost finding was discarded — when only
the honesty-to-users half died and the instrumentation half was, if anything, more useful. **When
a premise is corrected, isolate which half of the conclusion it kills.**

**6. Building an argument on an unvalidated metric.** Related to 1, but distinct and worth its own
line: a number was produced, not checked against the UI that renders the same data, and then used
to carry a proposition. **Validate any metric against the surface that displays it before reasoning
from it.**

The common root: reaching for a query before understanding the model. The corrective is cheap —
read the write path and the read path of the surface in question first, every time.

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

---

## Part 6 — What is not a panel's job

Bugs, typos, contrast measurements, missing ARIA attributes, leaked internal strings, and stale
counts. These are found more cheaply and more reliably by tests, a lint pass, or a single
low-cost QA agent, and every one of them found by an expert panel is budget spent at roughly ten
times the necessary rate.

An expert panel is convened for judgment that cannot be automated: whether the direction is
sound, whether the execution is competent, and whether the product is honest about what it does.
If a panel's output reads as a defect list, the brief was wrong — not the reviewers.
