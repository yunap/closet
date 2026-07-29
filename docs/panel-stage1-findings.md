# Stage 1 panel — findings and triage

**Run:** 2026-07-25, Mode B direction review, three independent reviewers (styling competence;
human↔model interaction design; cost and economics honesty). Packet:
`docs/panel-packet-stage1.md`. Each read only the packet — no database, no browser, no model calls.

**Status, reconciled 2026-07-29 against the code and later capsule rulings.** Section A is ruled:
A1/A2/A5 are implemented; A3 was rejected; A4 was implemented as part of the later capsule
redesign; A6 remains a cost-instrumentation and monetization question. C3 and B2 are ratified. B1 is
substantially closed. Later owner rulings also answer or supersede the
original C1/C2/D1 capsule recommendations; their entries below state exactly which parts survived.
B3, C4, C5's wording, and the unresolved E propositions remain open. B2's presentation and
interaction model were ratified on 2026-07-29; provider-cost optimizations are tracked separately
and do not reopen that product ruling.

**Re-checked 2026-07-27: A1, A2, A5 were still unimplemented as of that check** — `git log`
between the panel commit and HEAD touched no file under `styling-engine/` or `routes/`, only docs
and one unrelated board-feedback UI session. **All three implemented same day**, as prompt-text
fixes in `styling-engine/prompts.js` (pattern discipline extended to shoes/accessories for A1; a
Scarcity Honesty rule for A2; a Pushback-on-a-Specific-Garment rule — re-read the garment record,
never return a byte-identical card — for A5). Safety-rail snapshot
`test/fixtures/prompts_yuna_snapshot.json` updated to match (deliberate content change, not
drift). **A4 was initially deferred, then implemented inside the 2026-07-28 capsule redesign** —
mixed-register rosters preserve both casual and elevated shoe paths; demanding-activity footwear
is protected alongside them; and recurring slots demonstrate a second eligible shoe when supply
supports it.

Work through remaining items by ID. Each item carries a **Ruling:** line to fill in; once ruled,
the outcome moves to `docs/ui-v1-design-handoff.md` (rulings) or `docs/stylist-bugfix-spec.md`
(implementation), and the entry here should be marked with where it went — that housekeeping step
was the one skipped for Section A, which is how the top-of-file status line went stale in the
first place.

**Confidence caveat, stated once:** all three read the same packet, so convergence is partly shared
evidence rather than three independent observations. Treat 3/3 agreement as strong but not as
replication.

**Before ruling on any B/C/D/E item below: grep `docs/app-surface-map.md` and
`docs/engine-behaviour-map.md` for its key nouns first.** The panel argued from the packet alone —
no code, no database — so an item filed here as a gap or a fresh proposal may already have a
shipped mechanism the reviewers couldn't see. B1 is the example: two "synthesis positions" were
written up as open design questions when both already existed, documented with exact code
locations in the maps. See `docs/stylist-session-handoff.md`'s recurring-failure-mode section
(third entry) for the full incident.

---

## A. Defects — wrong regardless of any design decision

These need no direction ruling. They are quality or correctness failures.

### A1 — Prints on shoes and accessories are not counted as prints
**Source:** styling. **Confidence: high, falsifiable, most actionable finding in the run.**

One-loud-print discipline holds *perfectly* across all 8 top/bottom pairs in Artifact A, and fails
three times when the second print is on a shoe or accessory:

- Artifact C — black-white abstract maxi **+ red paisley wrap shawl**, formal outdoor slot
- Artifact D turn 1 — Apple skirt (*"bold botanical sweep of green, orange, mustard, teal"*) **+
  black floral cutout mules**
- Artifact D turn 2 — cream botanical print tee **+ bold multicolor floral espadrilles**

So the model knows the rule; the rule is not reaching footwear and accessories. This is a ratified
`AGENTS.md` styling principle failing in production.

**Ruling (owner, 2026-07-25): ACCEPTED — fix.** **Implemented 2026-07-27** — `styling-engine/prompts.js`'s pattern-discipline and PATTERN MIXING instructions now explicitly state the one-loud-print budget covers shoes and accessories, not just top/bottom.

### A2 — Under scarcity the model writes confident rationale for a violated brief
**Source:** styling.

Artifact E is a *summer* capsule containing a **rust corduroy overshirt** (two looks), chunky
sneakers and ankle boots, under an engine line reading `Weather used: Casual Daytime — warm`. The
rationale advocates rather than discloses: *"the two rusts are close enough to read as intentional,
not accidental."* In a 23-piece wardrobe that overshirt is the only layer she owns, and the honest
sentence names that. Scarcity should degrade to **fewer looks**, never to confident wrong advice.

**Ruling (owner, 2026-07-25): ACCEPTED — fix.** **Implemented 2026-07-27** — new "Scarcity Honesty" instruction in `styling-engine/prompts.js`: on a wardrobe too thin to fill a slot/look-count without repeating a piece that violates the stated brief, drop the look and disclose the scarcity instead of writing rationale defending the violation.

### A3 — The stylist asked the owner to inventory her own wardrobe
**Source:** styling. Called "the one question this product must never ask."

Artifact B: *"Do you have proper hiking shoes or trail sneakers, or would you rely on athletic
sneakers from your wardrobe?"* The stylist has the wardrobe. Proposed rule: ask only what is not in
the database and not inferable from it — location, occasion formality, who you will be with, what
you are avoiding. Never ask what you own.

**Ruling (owner, 2026-07-25): REJECTED — not a defect. Do not "fix", do not re-file.**
The wardrobe is never guaranteed complete: users will not always have catalogued everything they
own. Asking is a deliberate, gentler way of surfacing a gap for a given occasion or activity than
asserting *"your wardrobe has a gap!"* — it leaves room for the item to exist uncatalogued, and it
does not accuse the owner of owning the wrong things. The reviewer's rule ("never ask what you
own") assumes a complete database, which is not this product's reality.

**Carried forward as a phrasing question, not a defect:** the reviewer's discomfort points at
something real — the question as worded gives no sign the stylist checked first. A form that keeps
the gap-flag while showing the wardrobe was consulted (*"I don't see hiking shoes in your wardrobe
— do you have a pair I haven't catalogued?"*) would satisfy both readings. Not ruled; noted.

### A4 — Shoe allocation ignores register span
**Source:** styling. Independent of the capsule-count question.

Artifact B spent one of three shoe slots on athletic sneakers for a single nature walk (correct),
and was then left with **navy canvas slip-ons as its dressiest option for the nice lunch out**,
while brown leather strap sandals already in the plan sat on casual days. Same shape in Artifact A
look 3: lace-trim wide-leg trousers on a smart-casual outing, grounded by canvas slip-ons.
Proposed rule: before buying a second shoe at any register, buy one at each end of the register
span the slot list demands. Derived from formality tags, so `AGENTS.md` #3 puts it in code.

**Ruling (owner, 2026-07-25): ACCEPTED — fix.** **Deferred 2026-07-27** — owner is planning a
capsule-logic redesign (see C1/C2/D1, which show the shoe concentration is partly a trim-objective
question, not only a quota one); register-span allocation should be designed as part of that
redesign rather than patched in isolation first.

**Implemented as part of that redesign, 2026-07-28.** `selectCapsuleRoster` now protects the
requested shoe-demand paths rather than allocating by quota alone, and the capsule validator
reports a specific `register_shoe_path_missing` failure. Composition also requires recurring use
cases to demonstrate a second gate-eligible shoe when one exists. This is supply-conditional and
does not impose a global shoe-count taste rule.

### A5 — A correction returned a byte-identical card
**Source:** all three, independently.

Artifact B turn 3: *"oh boy, why did you pick my nice dress for the Airplane travel?"* → two
sentences of defence, and `Travel Day (proposed): black abstract midi dress + navy solid canvas
slip shoes + multi-colored botanical scarf` — identical to the card being complained about. A
correction produced a UI event with zero content difference, which reads as a revision and is not
one. Cost reviewer rates this the worst money-per-value interaction in the packet and makes the
economic case for the plan-revision merge on these grounds.

**Ruling (owner, 2026-07-25): ACCEPTED — fix, and the owner sharpens the diagnosis.**
All three reviewers read this as an *interaction* failure — no revision mechanism, so a correction
had nowhere to land. That is real but secondary. **The primary failure is a reasoning one: the
model had the data to re-evaluate and did not consult it.** Fabric content is genuinely empty on
that dress, but formality, the AI styled read, and accumulated user feedback are all populated on
the garment record. The model defended a choice it could have re-examined from information it
already held, and answered a factual claim about the owner's own garment with an assertion
(*"unprecious"*) rather than a lookup.

So A5 has two halves, and the reasoning half is the one to fix first:
1. **Reasoning:** on pushback about a specific garment, re-read that garment's record before
   defending the choice. Absent fabric data is not absent data.
2. **Interaction:** a correction must produce either a changed card or an explicit "no change, and
   here is why" — never a byte-identical card presented as a response.

**Implemented 2026-07-27** — a "Pushback on a Specific Garment" instruction in
`styling-engine/prompts.js` covers both halves: re-read the garment's truth text (formality,
fabric, AI styled read, feedback) before defending a choice, say plainly when the record is silent
on the point raised, and either change the card or hold the line with a stated reason — never
re-render the identical card as if it were a response.

**Also worth knowing (2026-07-27):** the interaction half was never as broken as the packet made
it look. This exact incident's card already has a working, model-independent escape hatch — the
per-piece `Wrong for Travel` chip (`docs/app-surface-map.md` lines 133-153) immediately excludes
the dress from Travel Day regardless of what the model says next turn, and the owner's actual
chat correction on this thread landed as a durable, visible "Owner Rule" in Style Profile (see
B1's correction, above). The prose fix above still matters — a repeated byte-identical card is a
bad response on its own terms — but the user was never actually stuck the way the packet implied.

See also E1 (holding ground under pushback), which is the same incident viewed as a product bet.

### A6 — A 3× overpay is the default path on the direction surface
**Source:** cost.

`Preview all directions (~$0.07)` costs the same as rendering **one** direction. Rendering three
individually costs $0.21 for what $0.07 buys. The dominant option sits *below* the free compare
strip, priced identically, with nothing signalling the dominance — and it is the option carrying
the E4b baked-caption defect, so the economically correct choice has the degraded output. Proposed
fix: draw panel captions in HTML *under* the returned sheet rather than asking the image model to
bake them in. E4b ruled the image model won't comply; it did not rule against the app drawing its
own labels.

**Ruling (owner, 2026-07-25): MISFRAMED — not a defect as filed. Reopened as a product question.**

**The premise is wrong.** The `~$0.07` labels are **owner-facing instrumentation** — they exist so
the owner can see what a call costs during development. They were never a user-facing pricing
scheme. So "the product prices exactly one thing" is not a dishonesty finding; it is incomplete
dev instrumentation, and the reviewer had no way to know that from the packet.

**But the finding survives — redirected, not invalidated (owner, same day).** The reviewer's thesis
was *"careful cost hygiene around the most visible spend, none around the largest."* Read as a
claim about honesty toward end users, it rests on a false premise. Read as a claim about **the
owner's own instrumentation, it stands and matters more**, because the owner is also a user of
these numbers and is currently the one paying. Owner's framing: *"if I have hidden costs I am not
thinking about, that's a good thing to know."*

So the actionable half is intact and unblocked by the monetization question: a capsule plan running
a tool loop over 236 pieces, `Evaluate outfit`, and the direction generation behind Artifact F all
cost real money and none of them is measured. The reviewer's recommendation needs no model calls —
the usage numbers come back on every API response; converting them to per-action cost and a
per-thread running total is arithmetic over data already held. **E5 should be ruled on this
reading**, not the dishonesty one. Any future cost-focused packet must still state who the price
labels are for, since the reviewer had no way to know.

**The real question underneath, now open:** what a user sees, and what they pay for, is undecided —
free tier versus a basic paid plan versus BYOK. Cost boundaries in the UI cannot be designed before
that is. The batch-versus-individual dominance observation survives as an input to that decision
(a batch that costs the same as one render is a pricing fact worth keeping) but it is not a bug to
fix today.

**Filed as an open product question, out of Stage 1 scope.** Deciding it needs a monetization
decision, not a panel.

---

## B. Owner rulings needed — the three genuine disagreements

### B1 — Are chips a teaching mechanism? (proposition 4) — reviewers split 2–1
**Defend (cost):** chips are the only zero-cost teaching channel. When the meter is the owner's own
API key, a one-tap channel that gets used beats a rich channel that is metered per correction.
**Attack (interaction, styling):** chips carry verdicts, not teaching. Every rich signal in the
packet arrived as prose — *"not sure I want to wear a rayon top"*, and especially *"why did you
pick my nice dress for the Airplane travel?"*, which introduces **preciousness**, a dimension the
system has no field for. A closed chip set cannot carry dimensions owner taste generates
continuously.

**Two synthesis positions offered:**
- *Chips as index, not content* (interaction) — a chip marks the card and opens a prefilled
  one-line freeform field the owner may ignore.
- *Chip → tag edit* (styling, and the stronger of the two) — the model proposes a garment-attribute
  edit off a chat correction: *"Mark the black abstract midi as not-for-travel?"*, one click. That
  converts soft memory into a hard constraint and puts it in the layer `AGENTS.md` #3 specifies.

**Note:** interaction argues the known chip-delivery bug survived *because* nothing observable
changes when a chip is dropped — the channel is undebuggable by use. That reframes the deferred bug
from an accident into a design property.

**Correction, 2026-07-27 — both synthesis positions already exist; the panel argued from a packet
that didn't show them (same shape as the C4 correction below).**

- **"Chip → tag edit" is already shipped**, and goes further than the packet's proposal: the
  per-piece **`Wrong for <occasion>`** action is a one-click, immediate, garment-level hard edit —
  `toggleOccasionExclusion` → `POST /api/pieces/:id/occasion-exclusion` → `pieces.occasion_exclusions`.
  Documented at `docs/app-surface-map.md` lines 133-153 (**"one of the few places a chat interaction
  writes a hard constraint to a garment record rather than a soft memory the model may or may not
  weigh"**) and `docs/engine-behaviour-map.md` line 498.
- **"Chip as index, opens a freeform field" is also already shipped**, as the general (not
  per-garment) half: `store_user_correction` from chat prose lands as an `owner_rule` /
  `preference_reaction` row, surfaced with **Edit / Retire** in `StylistSettings.jsx`'s "Learned
  rules & preferences." Documented at `docs/app-surface-map.md` lines 860-882 and
  `docs/engine-behaviour-map.md` line 63. This also substantially closes **E4** ("memory should be
  a visible, editable object") — it already is, for chat-stated corrections.
- **A third, narrower mechanism** exists too: the `wrong_length` board-feedback chip writes a
  garment-linked **retag-suggestion Task** (reviewable, not auto-applied — "no tags were changed
  automatically") into Wardrobe → Tasks. Documented at `docs/app-surface-map.md` lines 577-590 and
  754, `docs/engine-behaviour-map.md` lines 68/166/1557.

So the actual open question for B1 is not "should we build a chip → structure mechanism" — narrower:
is this pattern consistent across every card surface, and does the owner ever get told **in the
moment** that a chip fired a hard edit or fed the negative-label scoring path (ties to C4's
`Noted:`/`Applied:` proposal)? That's a much smaller ruling than the packet implied.

**Checked 2026-07-27: the per-piece menu (`Edit item card` / `Swap this out` / `Wrong for
<occasion>`) is already consistent** — it lives in exactly one shared render block
(`StylistChat.jsx`, gated on `Array.isArray(outfit.pieces)`), so every outfit *card* (freeform,
whole-wardrobe, plan/trip) already gets it. It does not extend to the four rendered *visual board*
surfaces (Composer/editorial/whole-wardrobe renders), which only ever carry board-level chips — but
per the owner, rendered boards never appear without an accompanying outfit card in practice, so
this is not a live gap.

**Tried and reverted, 2026-07-27 — moment-of-firing disclosure for the structured feedback chips
(style_direction/shape_balance).** `toggleOccasionExclusion` already toasts on click; the "What
feels wrong?" / "Fit and shape" reason chips don't, even though they feed real negative-label
scoring in `rules.js`. Found that the infrastructure already existed and was simply never
rendered: `saveStylistFeedback` computes a per-board `learningMessage` into `boardLearningStatus`,
but no JSX read it. Wired it up as an inline line under the chip row at all four board-render
sites — but it surfaced two real problems, and the owner ruled the fix out rather than iterate on
it further:
1. **Not reason-specific.** Every "What feels wrong?" chip sends the same generic
   `feedbackType: 'style_direction'` (the specific reason travels separately as `feedback_reason`,
   never read by the copy lookup), so the line was identical regardless of which chip — or how
   many — were clicked.
2. **Wrong data model for multi-select.** These reason chips are independent toggles, not a single
   choice, but `boardLearningStatus` stores one last-written string per board — structurally
   incapable of representing "several things are currently noted," and going stale the moment one
   is toggled without the others.
A live-computed summary (derived from currently-checked reasons, not a stored last event) would
fix both, but the owner's ruling made that moot: **the chip's own active-state color change
(gray → lavender) is already sufficient confirmation** — no additional line needed for this
feedback type. Fully reverted (`git diff` on `StylistChat.jsx` confirmed clean); `node --test`
held at the 7 pre-existing baseline failures throughout. Occasion-exclusion's toast stands, since
that mechanism had no confirmation signal at all before the toast — the two cases aren't the same
shape and shouldn't be forced into the same fix.

**Partial ruling (owner, 2026-07-28): closed for immediate chip confirmation.** The shared
outfit-card action menu is consistent; occasion exclusions toast when written and are visible and
reversible in Style Profile; multi-select feedback chips confirm their state through their active
color. Do not add a second generic confirmation line for those chips. The separate C4 question —
whether a stored signal should be narrated when it changes a later result — remains open.

### B2 — What to do with the structured read (proposition 5) — three different answers
- **Cost:** stop generating it; make it opt-in *generation*, not opt-in disclosure. Highest-frequency
  action, tokens spent on fields most sessions never open.
- **Interaction:** keep it — it makes the critique falsifiable by exposing its own premise — but
  make `Intent` **editable**, so a wrong premise can be corrected instead of only disagreed with.
- **Styling:** keep `Intent` and `Success criteria`, **delete `Visible facts`** — it describes a
  photograph to the person who took it, and it is the bulk of the disclosure.

**All three land on the same counter-argument:** those fields may be functioning as chain-of-thought,
in which case removing them buys worse advice cheaply. Cost proposes settling it with ~10 paired
critiques as a one-time billed experiment — the one place any reviewer recommends spending money.

**Partial ruling (owner, 2026-07-29): do not delete `Visible facts`.** Although it repeats the
photograph back to the person who supplied it, it is useful diagnostic evidence: when a critique
is wrong, this field shows what the model believed it saw while producing that critique. That
falsifiability is worth preserving.

This did **not** ratify the current structured read unchanged. It was too long for an ordinary user
to read, even behind the existing disclosure. B2 therefore remained open on presentation: shorten
and layer the user-facing read while keeping the model-premise evidence available through a
secondary diagnostic expansion or debug surface. The ruled-out solution is deleting
`Visible facts`; the remaining question is how to separate the concise critique from its deeper
diagnostic record.

**Ratified 2026-07-29 after live testing.** Branch
`experiment/b2-readable-critique-clean`, rebased onto `origin/main` at `160d992`, implements a
three-layer answer without adding a second model call:

1. `userCritique` is the default read: answer, short reason, one action, and an observable check.
2. **More detail** is a purpose-written `detailedCritique` returned by the same evaluator as four
   connected client-facing paragraphs. It replaces the attempted formatter-only solutions, which
   either became too short or exposed the seams and repetition between independently written
   diagnostic fields.
3. The complete `visibleFacts` object remains in the stored evaluation for falsifiability and
   follow-up context; it is no longer copied wholesale into the ordinary disclosure.

The requested schema drops redundant prose fields (`summary`, roles, scores, `works`/`risks`,
`styleIdea`, `mainSuccess`, and `executionGap`) so the detailed explanation replaces output rather
than merely adding tokens. The UI renders the critique as Markdown, uses **More detail** rather
than **Full structured read**, and retains the old structured-field formatter only as a
backward-compatible fallback for saved evaluations without `detailedCritique`.

The live sequence established why each iteration changed:

- `thread_1785356337371`: deterministic headings were too short and too visibly structured.
- `thread_1785356838715`: unlabeled stitched fields still read as a slightly longer summary.
- `thread_1785357460237`: restoring all fields produced the right depth but repeated the same
  diagnosis because each field was written to stand alone.
- `thread_1785358062445`: a dedicated four-paragraph field reached the intended depth and flow
  without a parse failure or another provider call.

The owner accepted the current language level and provenance behavior for now; neither is a B2
ship blocker. `Visible facts` stays stored for debugging and is not exposed in the normal client
UI. `Intent` does not become a separate editable control: the user corrects or refines the read
through an ordinary follow-up, which preserves the conversational interaction rather than adding
a second correction surface. Older saved evaluations keep the structured-field fallback.

The cost acceptance criterion is architectural rather than a prerequisite telemetry study:
one provider call, a bounded response, and redundant generated prose removed. Formal before/after
token proof is not required to ratify B2. Usage and JSON-parse failures should still be monitored;
an observed regression is a tuning issue, not a reason to reopen the presentation decision.

**Cost follow-up, separate from B2:** the critique path should add provider prompt caching and
usage telemetry, then give follow-ups a lean answer-only response contract. Today the UI displays
only a short follow-up, but the backend still sends the full evaluator instructions and permits a
3,000-token response, so it may regenerate diagnostic fields and detailed prose that are discarded.
After measuring those changes, add a short-lived exact-request cache for retries/double submissions.
Cache stable image/evidence blocks only if telemetry shows that additional complexity is warranted.
None of this should shorten the ratified four-paragraph explanation or add a second model call.

### B3 — What the "needs review" card should be (proposition 3)
- **Cost:** near-null surface (zero in the last 150 real threads); don't spend engineering here.
  One string warning that a `missing bottom` render will invent a garment.
- **Interaction:** the card is the wrong *container*; the engine already ships the right one — the
  plan-line ledger form (`[coverage gap: "Evening" needed 1 look but only 0 valid outfits...]`)
  reads fine in the owner's language.
- **Styling:** keep the card, rewrite the text as a **wardrobe diagnosis** — *"I ran out of bottoms
  — you own one skirt that works at this register, so shirts stack up with nowhere to go."* Adds
  the fact that changes the calculus: this surface fires almost exclusively for **small wardrobes**,
  i.e. new users, who are least able to read `structural: missing bottom` and most in need of the
  insight.

**Partially checked against the maps, 2026-07-27:** `docs/app-surface-map.md` lines 480-500
confirms cost's near-null number exactly (0 in the last 150 real threads) and confirms raw gate
vocabulary/rejected-piece lists are already dev-only, behind `VITE_STYLIST_DEBUG` — real users
never see the literal engine trace. **Not fully checked:** whether the always-visible `What
didn't clear:` line (`outfit.rejectionReason`, built from `styling-engine/rules.js`'s
`exclude(piece, reason)` calls around line 2391) is itself already plain language or still carries
an internal reason string — didn't trace every `reason` argument passed to `exclude()`. So the
"raw jargon reaches real users" premise may be weaker than the packet assumed, but this one isn't
resolved the way B1 was — still worth a ruling on the copy, just a narrower one than "rewrite raw
gate vocabulary."

**Ruling:**

---

## C. Design questions with concrete recommendations

### C1 — The capsule redesign (proposition 7's open question)
**Convergence across all three, arrived at independently:** state capacity, curate the shown set.

> *"12 pieces → 24 valid outfits available; here are the 8 worth wearing."*

The 24 is already computed at zero cost. This delivers the honesty of the commercial
"15 pieces, 50+ outfits" claim — always a capacity claim, never a lookbook — without paying to
enumerate. All three also converge on **per-slot bounds instead of a global cap**, noting the trims
land on the *low*-capacity slots (`casual_city_day` 5 cores vs `smart_casual_outing` 21), so the
slot where the owner most needs help is squeezed by the slot that needed none.

**On whether a piece budget is the right ask:** keep accepting it (it is what owners type, and it
is the culture's language) but treat it as a **target to report against, not a bound to enforce**.
Styling adds: the coupling from piece budget → outfit count via `planTotalOutfitCapForBudget` is
what produced two hours of wrong hypotheses. Break the coupling.

**Superseded by later owner rulings and implemented 2026-07-28.** The surviving proposition was
“state capacity, curate the shown set”: the plan reports distinct gate-valid core capacity and
shows a representative rotation capped at `min(piece_budget, 12)`. Allocation is coverage-first:
each structurally coverable use case gets one card before recurring demand gets multiplicity, and
each slot is bounded by its own core capacity plus whole-plan distinct-core feasibility.

Two panel recommendations did not survive. The piece budget remains a real finite-roster bound,
not merely a reporting target. A global presentation cap also remains, but it no longer allocates
blindly: per-slot capacity and global matching decide which cards can be requested beneath it.

### C2 — Invert the capsule trim objective
**Source:** styling. **This partially overturns a by-design item — see D1.**

Current objective is *minimum pieces that cover the required looks* — a packing-list objective. A
capsule's objective is *maximum rotation from a fixed budget*. If 12 covers the looks and the
budget is 14, **generate more looks; do not shrink the roster.** Never buy a piece and then trim
it.

**Superseded by the same 2026-07-28 capsule rulings.** The engine now curates the finite roster
first and reports its full distinct-core capacity separately from the cards shown; it does not
trim the roster down to the minimum garments appearing in the representative rotation. It also
does not generate every additional valid combination merely to justify every roster piece:
`min(piece_budget, 12)` is the ratified initial lookbook cap, with same-roster expansion available
on demand. Thus “never buy a piece and then trim it” survived, while “generate more looks until
the budget is exhausted” did not.

### C3 — A decision rule for new structure (proposition 9)
All three produced rules; the cores agree. Merged, in the order they would be applied:

1. **Owner-falsifiable / free falsifiability.** Can the structure be wrong in a way someone can
   check without spending money — from a photograph, a forecast, or the database? Weather: yes.
   Garment-ID validation: yes. Register ceilings, piece budgets, outfit caps: **no**. A structure
   you cannot debug for free does not belong in deterministic code, because every future argument
   about it is billable.
2. **Speakable.** Can it state what it did in one sentence the owner would accept as a reason?
   *"Only 3 shoe slots fit a 14-piece budget"* passes. *"The register ceiling capped this slot"*
   does not.
3. **Does it decide, or only describe?** A structure that emits a line but binds no choice is
   prompt text at best. `Weather used: warm` decided nothing in Artifact E. **Bind it or kill it.**
4. **Cheap false positives.** Asymmetric downside → prompt, unless the failure being prevented is
   worse than over-blocking (a garment that does not exist; a coat at 105°F).
5. **The silence test.** If it fires and the owner is never told, it does not ship. This one alone
   would have prevented the entire capsule misdiagnosis at zero marginal cost.

**Styling's one-line version of the test for a *proposed* structure:** *name the artifact you would
have to see to know this structure fired wrongly. If you cannot name it, do not build it.*

**Observable signs scaffolding is costing more than it returns** — all present in the artifacts:
two structures narrating the same fact differently (E's trim vs coverage-gap; E9's two disagreeing
look counts); a declared constraint no output honours (`warm` + corduroy); debugging a *styling*
complaint requires reading code; the engine trims what it just bought; model prose contradicts the
structured result and the surface discards the prose.

**Amendments from running C3 against two already-shipped mechanisms, 2026-07-27** (the
`Wrong for <occasion>` chip → `pieces.occasion_exclusions`, and `store_user_correction` →
`owner_rule`, both found while checking B1 — see that section):

- **A failing test doesn't always mean "kill it" — the test result is a diagnosis, not a
  sentence.** The occasion-exclusion mechanism failed tests 1, 4, and 5 (no owner-facing view of
  what's excluded; the only undo path is a chip that, once excluded, never appears again for that
  piece/occasion; nothing narrates the exclusion later) — but it passed 2 and 3 cleanly, and the
  underlying idea (a garment can be permanently wrong for an occasion, and one click should record
  that) is sound. The fix is a missing surface (a view/undo list, a later "excluded" note), not a
  reason to remove the mechanism. **Read C3 as build / fix / kill, not build-or-kill**: test 3
  failing outright (nothing is bound, it's pure narration) points at kill; tests 1, 4, or 5 failing
  while 2 and 3 pass points at a completeness gap worth naming and fixing, not deleting.
  **Implemented 2026-07-27** — fixed tests 1 and 4 (test 5, the later narration, is still open,
  folds into C4): `GET /api/pieces/occasion-exclusions` (`routes/crud.js`, registered ahead of
  `GET /pieces/:id` so its own path isn't swallowed) lists every current exclusion, and a new
  "Occasion exclusions" section in Style Profile (`StylistSettings.jsx`, mode `style`) renders
  them with a **Restore** button that calls the existing `occasion-exclusion` endpoint with
  `excluded: false` — the same restore path the chip already supported, just newly reachable.
  Live-verified in the sandbox: excluding a piece from an occasion populates the list; Restore
  clears it and the piece becomes eligible again; the empty state renders correctly with nothing
  excluded. `node --test` held at the 7 pre-existing baseline failures throughout. **Also confirmed
  against the real `wardrobe.db`** (6 real exclusions existed already, including the black abstract
  midi dress from the A5 incident, `travel`) — the section first appeared empty on `wardrobe-web`
  because the already-running API process predated this change (plain `node server.js`, no
  watcher, so new routes don't load without a restart); after the owner restarted it, the section
  correctly listed all 6.
  **Test 5 (silence) is only partially closed.** The chip's own creation-time toast already
  disclosed the exclusion when it fires (*"won't appear for `<occasion>` again"*); the list above
  fixes discoverability after the fact (tests 1/4). What's still silent is the moment an existing
  exclusion actually **removes a candidate during composition** — the owner asks for travel
  outfits weeks later and the piece just isn't offered, with nothing said. That's C4's job, not a
  separate mechanism — but it must not be implemented as a copy of C4's own `owner_rule` example
  (*"Applied: no rayon — you said so Jul 25"*). That example is a **soft, weather-conditioned**
  signal the model applies by judgment — the `Applied:` line's job there is to confirm the model
  actually consulted and obeyed it, since compliance is never guaranteed. `occasion_exclusions` is
  the opposite shape: a **hard, code-level filter keyed to one exact occasion string**, applied
  every time with certainty — there is no "did it apply" question, only "does the owner know a
  candidate silently dropped out." So the trigger condition is different and must be exact: narrate
  only when (a) the current turn's occasion matches an exclusion on a piece, AND (b) that piece
  would otherwise have been a plausible candidate for this composition — never on a turn for a
  different occasion/activity than the one it was excluded from, and never as a blanket "you have
  N exclusions" notice unrelated to what's being composed right now. Getting this wrong either
  under-informs (silence persists) or over-attributes (claims a rule fired on a dimension —
  weather, activity — it was never scoped to).
- **Test 3 needs a third bucket: deliberately soft.** The `owner_rule` mechanism is written by its
  own code comment to be "prompt guidance, never a mechanical gate — the #44 memory-pollution
  lesson: stored text must never get absolute mechanical authority" (`styling-engine/rules.js`
  lines 1332-1338). That's a structure that mostly *describes* rather than mechanically *decides* —
  by design, after an earlier attempt at hardening it went wrong. C3's original phrasing ("bind it
  or kill it") has no room for "bind it softly, on purpose, having tried harder once and been
  burned." Add that case explicitly so it isn't mistaken for a test-3 failure.
- **C3 applies retroactively, not only to new proposals.** It was written for *proposed* structure
  ("name the artifact... if you cannot name it, do not build it"), but running it against something
  already shipped is exactly what surfaced the occasion-exclusion gap — a real defect the surface
  map's own "[owner check wanted]" note (menu styling) didn't catch, because that note was asking a
  different question. Treat the five tests as a standing audit tool for the existing inventory in
  `docs/engine-behaviour-map.md` (scoring weights, gates, caches, narrated lines), not just a gate
  on new work.

**What "having C3" would actually mean for this app:** there is no way to make these five questions
a runtime check — "is this speakable in one sentence" and "would the owner accept it as a reason"
are judgment calls, not predicates a linter can evaluate. So "implementing" C3 means two concrete,
human-run things, not new code:
1. **A required step before adding new scaffolding** — a score, gate, cap, or narrated line doesn't
   ship without its author (person or session) writing one line per test, in the spec doc that
   introduces it. This is process, not enforcement; the value is making the self-assessment
   mandatory and visible in the spec, not automatic.
2. **A periodic retroactive audit** of what already exists, prioritized by
   `docs/engine-behaviour-map.md`'s inventory (it already lists every scoring weight, gate, and
   cache with a measured firing rate) — pick the ones with the highest cost-to-understand-per-value
   (like the two Two `planWorkbenchPieceScore` weights already found to be decoration, or now this
   occasion-exclusion gap) and run the five tests, expecting a build/fix/kill verdict each time, not
   assuming clean passes because something already shipped.

**Ruling (owner, 2026-07-27): ACCEPTED.** Moved to `AGENTS.md` → Engineering Principles #7, as a
standing house rule (this is a process discipline, not a UI ruling or a one-off implementation
item, so it doesn't belong in `docs/ui-v1-design-handoff.md` or `docs/stylist-bugfix-spec.md`).
The five tests, the build/fix/kill trichotomy, and the soft-by-design carve-out all carried over;
this doc keeps the full derivation and the two case studies (occasion-exclusion, `owner_rule`) the
rule was tested against.

### C4 — Make the loop perceivable (proposition 6)
All three attack the proposition; all three note the engine narrates weather source, roster,
repeats, trims and budget, and **never narrates memory** — while a provenance channel with an
`(estimated)` / `(live forecast, City)` confidence convention already exists.

Proposed, zero marginal model cost, capped at **one line per response**, in the plan-lines channel
where provenance already lives, never woven into styling prose:

- `Noted: avoiding rayon (this thread)` — on the turn a preference is captured
- `Applied: no rayon — you said so Jul 25` — on any later turn where a stored signal changed output

Interaction argues this fixes P6, P4 and the deferred chip bug simultaneously: when a chip is
dropped, the expected `Noted:` line does not appear and the failure becomes visible in the same
second it happens.

### Evidence the panel did not have — the loop already pays off visibly, in Tasks

Found 2026-07-26 while mapping surfaces, after the run. **Proposition 6 was answered against a
packet missing the surface that answers it.**

Mark a rendered board **A garment is the wrong length** in Visual Lab, name the garment and the
issue, and the app writes a **retag-suggestion task** into Wardrobe → Tasks: garment-linked,
naming the field to review, worded *"Retag suggested for `<garment>`: `<issue>`. Review the garment
metadata; no tags were changed automatically."* Completion is remembered — each time that board's
feedback changes the sync rebuilds its incomplete suggestions but skips `piece:issue` pairs already
completed, so a suggestion you have dealt with never returns.

Separately, the styling engine writes `metadata` tasks naming garments a gate has excluded for
missing data, and why they are invisible to recommendations.

So a judgement about a rendered image becomes concrete, actionable, garment-linked work with
remembered state. That is the calibration loop closing where the owner can see it. Three reviewers
concluded it never visibly closes; none of them could see Tasks, the wrong-length capture flow, or
Style Profile, because the packet contained none of them.

**What survives of the reviewers' argument:** the loop does not close *in the chat*, which is where
they were looking and where the owner spends most time. `Noted:` / `Applied:` lines would still add
something. But the proposition as stated — *"every feedback control in the app is theater"* — is
false, and was falsifiable from surfaces that existed at the time.

**Partial factual correction; product ruling still open.** Tasks, editable learned rules,
occasion-exclusion toasts, exclusion restore, and chip active states already make several feedback
effects visible. Do not add a redundant generic confirmation line to multi-select feedback chips;
the owner ruled their active state sufficient. What remains open is later application: whether and
how to narrate when a stored soft rule changes a future result, or when a matching hard occasion
exclusion removes an otherwise plausible candidate.

### C5 — "This is a confirmed formula" (Artifact B, look 5)
Flagged independently by interaction and styling. Confirmed by whom, and when? Either it came from
learning memory — in which case the single instance of visible payoff in eight artifacts is
typographically indistinguishable from the model being emphatic — or it did not, in which case the
app's only apparent memory receipt is **hallucinated**, which trains the owner to discount real
ones. Needs checking against the memory store before it can be ruled.

**Checked against the actual source, 2026-07-27; wording still open.** This was not a hallucinated
memory receipt. The phrase is the model's paraphrase of the `PROVEN_FORMULAS` constitution layer,
whose framing says formulas are earned from confirmed outfits. It is not a citation either: it
does not name the formula or the confirmed outfit that supports it. The remaining owner decision
is whether that vague paraphrase is acceptable or should name its source more precisely.

---

## D. Challenges to settled ground

### D1 — The 3-shoe-slot explanation is incomplete
**Source:** styling, with a new argument, which is what the packet invited.

Artifact A's roster is **12 pieces, of which only 2 are shoes.** The quota bought 3; the **trim**
took it to 2. So the by-design entry — *"the 14-piece budget buys exactly 3 shoe slots... correct
behaviour"* — is not wrong but is incomplete: the 7-of-8 concentration owes as much to the trim as
to the quota. See C2, which is the proposed consequence.

**Resolved by the later capsule redesign, 2026-07-28.** The diagnosis was correct: quota alone did
not explain the observed shoe concentration. The replacement architecture protects register and
activity shoe paths in the roster and validates them explicitly, while the representative
rotation demonstrates available shoe range. The old post-selection trim explanation no longer
describes the current capsule path.

---

## E. Proposed additions to the proposition set

Seven were offered; these are the ones with artifact evidence behind them.

- **E1 — The stylist should hold its ground under pushback.** Currently done implicitly and badly:
  Artifact B held the *aesthetic* position correctly (an unprecious wrinkle-resistant midi *is*
  right for a plane) but flatly denied the owner's **factual** claim about her own garment by
  answering *"unprecious"*. Proposed shape: *"If it's precious to you that overrides my read — the
  [X] does the same job."*
- **E2 — Generation and critique reason differently.** The largest quality delta in the packet, and
  invisible because nobody named it. Artifact G reasons about a look as a system (hero / support /
  grounding, and defends a risky element with a structural reason). Artifacts A–E assemble slots and
  offer colour arguments as if they discharged a pattern obligation. This is the parent of A1.
- **E3 — Prose and cards can disagree.** The prose-discard bug was filed as rendering. It is not:
  prose and structured result are two independent artifacts that can contradict each other
  (Artifact E claims "7 outfits across 5 use cases" with Evening absent; Artifact A narrates a trim
  the cards never show). Fixing the rendering makes disagreements *visible*, not absent.
- **E4 — Memory should be a visible, editable object.** Nowhere can the owner see, edit or delete
  what the stylist has learned. Wrong learnings are inevitable; unfixable ones are corrosive.
- **E5 — Only image generation is priced.** Plan turns over a 236-piece wardrobe, `Evaluate
  outfit`, and direction generation carry no price. Cost argues the hygiene is pointed at the spend
  the owner can already see coming, and that the API usage numbers already returned would settle it.
- **E6 — A truncated paid turn is not acknowledged in cost terms.** Artifact C: a clarifying turn
  plus a plan turn spent, one of three looks delivered, and the only remedy is to pay again from
  zero.

**Ruling on which of these become propositions:**

---

## F. What each reviewer would protect

Worth keeping separate from the change list — these are the things a redesign could quietly lose.

- **Styling:** Artifact G's *fix form* — *"Try buttoning the jacket at the lowest button on your
  next wear — it narrows the center column visually."* Free, reversible, uses only what she owns,
  testable next wear, and preceded by a direct answer to the question asked. Every other output
  proposes a **look**; this one proposes an **adjustment**, which is the highest-leverage thing a
  stylist who knows your closet can do. Nothing in the 9 propositions protects it.
- **Interaction:** the clarifying question, specifically the model's habit of **saying why it is
  asking** — *"That affects footwear in particular"* bought a seven-word answer at exactly the right
  resolution. It is the only place in the app where the loop visibly closes inside the owner's
  attention span.
- **Cost:** the batch price on the direction surface (`Preview all directions` at the same price as
  one render — the best economic decision in the product), and the model's habit of volunteering
  alternatives inline, which is a paid turn the owner never has to buy.

---

## G. Instrument verdict — is Mode B worth keeping?

**Yes, on this evidence.** All three took positions with counter-arguments and falsification
conditions. Three reframed propositions rather than answering as posed (all three on proposition 1,
independently reaching the same conclusion by different routes). None produced a defect list. The
settled-ground lists held: nobody re-filed A4, and all three said so explicitly; the one challenge
to a by-design item (D1) came with a new argument, which is exactly what the packet invited.

**What made the difference from the two failed attempts:** a single self-contained packet instead
of ~3,000 lines across four documents. Capacity went to argument rather than orientation.

**Caveats for Stage 2:** shared-packet convergence is not replication (see the top of this file).
And the per-proposition depth varied — the styling reviewer flagged that propositions 2 and 4 were
its weakest answers for lack of the chip taxonomy and usage distribution, which is a packet gap
worth closing before any feedback-focused round.
