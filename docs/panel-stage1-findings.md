# Stage 1 panel — findings and triage

**Run:** 2026-07-25, Mode B direction review, three independent reviewers (styling competence;
human↔model interaction design; cost and economics honesty). Packet:
`docs/panel-packet-stage1.md`. Each read only the packet — no database, no browser, no model calls.

**Status: nothing here is ruled yet.** This is the raw synthesis, organised for triage. Work
through it by ID. Each item carries a **Ruling:** line to fill in; once ruled, the outcome moves to
`docs/ui-v1-design-handoff.md` (rulings) or `docs/stylist-bugfix-spec.md` (implementation), and the
entry here is marked with where it went.

**Confidence caveat, stated once:** all three read the same packet, so convergence is partly shared
evidence rather than three independent observations. Treat 3/3 agreement as strong but not as
replication.

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

**Ruling (owner, 2026-07-25): ACCEPTED — fix.**

### A2 — Under scarcity the model writes confident rationale for a violated brief
**Source:** styling.

Artifact E is a *summer* capsule containing a **rust corduroy overshirt** (two looks), chunky
sneakers and ankle boots, under an engine line reading `Weather used: Casual Daytime — warm`. The
rationale advocates rather than discloses: *"the two rusts are close enough to read as intentional,
not accidental."* In a 23-piece wardrobe that overshirt is the only layer she owns, and the honest
sentence names that. Scarcity should degrade to **fewer looks**, never to confident wrong advice.

**Ruling (owner, 2026-07-25): ACCEPTED — fix.**

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

**Ruling (owner, 2026-07-25): ACCEPTED — fix.**

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

**Ruling:**

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

**Ruling:**

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

**Ruling:**

### C2 — Invert the capsule trim objective
**Source:** styling. **This partially overturns a by-design item — see D1.**

Current objective is *minimum pieces that cover the required looks* — a packing-list objective. A
capsule's objective is *maximum rotation from a fixed budget*. If 12 covers the looks and the
budget is 14, **generate more looks; do not shrink the roster.** Never buy a piece and then trim
it.

**Ruling:**

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

**Ruling:**

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

**Ruling:**

### C5 — "This is a confirmed formula" (Artifact B, look 5)
Flagged independently by interaction and styling. Confirmed by whom, and when? Either it came from
learning memory — in which case the single instance of visible payoff in eight artifacts is
typographically indistinguishable from the model being emphatic — or it did not, in which case the
app's only apparent memory receipt is **hallucinated**, which trains the owner to discount real
ones. Needs checking against the memory store before it can be ruled.

**Ruling:**

---

## D. Challenges to settled ground

### D1 — The 3-shoe-slot explanation is incomplete
**Source:** styling, with a new argument, which is what the packet invited.

Artifact A's roster is **12 pieces, of which only 2 are shoes.** The quota bought 3; the **trim**
took it to 2. So the by-design entry — *"the 14-piece budget buys exactly 3 shoe slots... correct
behaviour"* — is not wrong but is incomplete: the 7-of-8 concentration owes as much to the trim as
to the quota. See C2, which is the proposed consequence.

**Ruling:**

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
