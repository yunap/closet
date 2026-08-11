# Item 13 panel findings — owner review required

**Status:** panel complete; recommendations are not ratified until Yuna reviews them.

The Mode B panel reviewed the complete packet and all ten fresh fixture captures through the three
required lenses: fashion-product competence, human↔model interaction design, and cost/product
economics. All three independently rejected the current single-scroll, store-shaped Style Profile
and called for a concrete task-based replacement.

## Consensus

### 1. Replace the mixed ledger with three owner tasks

The primary hierarchy should be:

1. **What the stylist uses / Active guidance** — constitution, standing guidance, accepted scoped
   lessons and hard limits. Generated-image problem reports remain a separate review concern rather
   than personal style guidance.
2. **Review feedback / Needs review** — unprocessed reactions that still support an action,
   product issues, and links to garment-detail review tasks.
3. **History** — retired guidance, processed source reactions, and resolved or dismissed findings.

Chronology belongs inside History and each record's lineage, not as the page's organizing model.

### 2. Every active card must answer the same five questions

1. What recognizable rule, reaction, correction, or issue is this?
2. What does it change: guidance, hard eligibility, generated images, nothing yet, or history only?
3. When does it apply?
4. How does the owner correct or undo it?
5. What is its exact source, and which garments, boards, outfits, or tasks are merely related?

Dates, IDs, storage types, raw evidence, and destination enums belong behind **Source & history** or
**Technical details**.

### 3. Hard limits must read as eligibility

A limit should lead with a consequence such as:

> Panel beige linen shorts will not be suggested for Home. They remain available elsewhere.

The editor should show plain structured conditions, make AND/OR semantics explicit, and provide a
free deterministic matching/non-matching example. Original prose remains evidence, not a second
authority.

### 4. Provisional reactions stay visible only while actionable

Unprocessed reactions belong in **Review feedback → Teach the stylist** while they can be inspected,
removed, or selected for the explicit paid synthesis flow. After processing, they collapse beneath
the accepted lesson/finding as source evidence and remain searchable in History.

### 5. Product failures are not personal memory

General styling/model failures should say **Nothing changes yet**, preserve the evidence snapshot,
and offer explicit resolution destinations. No reviewer supported putting them into personal style
memory or letting the model silently choose their destination.

### 6. Management remains free

Search, edit, scope, check-context, restore, retire, dismiss, resolve, inspect, and undo remain local
and free. The only paid operation is explicitly authorized lesson drafting from selected eligible
evidence, after a free preview names the model, evidence, estimated cost, and API-key use. Nothing
becomes active until the owner accepts the draft.

### 7. Origin surfaces show projections, not duplicate authority

Chat, Visual Lab, Lookbook, garments, and Tasks may show lightweight receipts and deep links. They
must use **Source** only for the originating action and **Related** for later matched objects. Each
projection opens the one canonical record or exact source context and carries no independent state.

### 8. The replacement must be responsive by construction

- Wide: a focused working column with optional scope/evidence inspector.
- Medium: one column with section tabs and focused inline/drawer editing.
- Narrow: authority → content → reason → scope → actions → source/history; stacked full-width
  actions; focused edit sheet; no preserved desktop row layout.

The current 768px reaction row is accepted as evidence of the design problem, not a direction to
polish.

## Shared wireframe direction

```text
STYLE PROFILE
Control what the stylist follows and review what still needs a decision.

[What the stylist uses] [Review feedback 3] [History]

WHAT THE STYLIST USES
  Your style & needs
  Always remember / Standing guidance
  Limits
  Specific situations / Scoped guidance

REVIEW FEEDBACK
  Teach the stylist
  Product issues
  Garment checks (link to canonical Wardrobe Task)

HISTORY
  Stopped guidance and limits
  Processed source reactions
  Resolved/dismissed findings
```

Cards default to readable statements, consequence, scope, and undo. Textareas and raw applicability
forms appear only after **Edit**. Accepted lessons remain compact until opened in a focused editor.

## Owner decisions

### A. Navigation home — ratified

- Human↔model reviewer: move Style Profile conceptually under **Stylist**; Visual Lab links directly
  to generated-image guidance.
- Economics reviewer: retain **Visual Lab → Style profile**.
- Fashion-product reviewer: keep Style Profile as the trust hub but did not require a primary-nav
  move.

**Owner ruling, 2026-08-11:** Style Profile remains in **Visual Lab**. Stylist is the busy working
conversation surface; Visual Lab is where the owner teaches, evaluates and configures the stylist.
Stylist may deep-link to a relevant record but is not the profile's navigation home. A possible
future rename of Visual Lab is a separate information-architecture decision.

### B. Canonical home for product issues — ratified

- Economics reviewer: **Wardrobe Tasks → Product fixes** is canonical; Style Profile only links.
- Human↔model and fashion-product reviewers: **Style Profile → Review feedback → Product issues** is
  the primary review surface, while garment metadata checks remain canonical Wardrobe Tasks.

**Owner ruling, 2026-08-11:** the primary review surface is **Style Profile → Review feedback →
Product issues**. A field-specific garment-data check may link to Wardrobe Tasks, but the product
issue and its evidence remain visible in the feedback review flow.

### C. Generated-image problem reports — clarified follow-up

The panel used the misleading shorthand **renderer correction**. The actual flow is:

- the owner reports that a generated image depicted a garment incorrectly;
- the rejected generated image is retained as evidence and is **never supplied as a future visual
  reference**;
- image-fidelity types have no styling-selection authority;
- when the same identified garment is rendered again, the image prompt may receive a short
  piece-scoped textual fidelity reminder, such as matching its saved reference length;
- a field-specific wrong-length reason may independently create a garment-review task; no garment
  metadata changes automatically.

The Style Profile should therefore not present these as personal **Image guidance**. An unresolved
report belongs in **Review feedback → Product issues**, where the card states both effects plainly:
the piece-scoped text reminder sent during a relevant render, and any separate garment-data review
task. The source board remains the only place to edit or clear the image report; the Style Profile
record is a read-only projection of that one canonical state.

## Suggestions that do not reopen settled direction automatically

1. The economics reviewer proposed direct free **Add guidance** / **Add limit** authoring. A generic
   “Save as styling rule” action was deliberately rejected earlier. Any direct-authoring proposal
   must be narrower, structured, and separately owner-approved; it is not part of this panel result.
2. The fashion-product reviewer proposed promoting positive outfits to bounded **Reference looks**.
   Positive learning is deliberately paused because garment or formula reinforcement can defeat
   closet rediscovery. This is a future hypothesis only and must not enter the Item 13 implementation.

## Additional consensus recommendation: visible participation receipts

Reviewers want a free, evidence-honest **What influenced this result?** disclosure on later outputs:

- hard gate: “Prevented Panel beige linen shorts for Home”;
- prompt guidance: “Warm-travel guidance was sent to the stylist”;
- image fidelity: “A text reminder to match the cardigan's saved reference length was sent; the
  rejected generated image was not reused.”

The product must not claim prompt guidance caused a model choice merely because it was included.
This recommendation is adjacent to the Style Profile redesign and needs explicit owner scope before
implementation.
