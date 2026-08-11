# Item 13 presenter walkthrough — owner preflight

**Status:** approved by Yuna; reproducible evidence capture complete. This comprehension check is
intentionally separate from the reviewer packet.

## What the panel is deciding

The routing behavior is not up for invention. The panel is deciding how the owner should see and
operate it:

- distinguish active personal guidance from a hard constraint;
- understand why and where a rule applies;
- inspect and undo what has authority;
- review product/model failures without turning them into personal style memory;
- keep provenance available without making Style Profile read like a database or audit log.

This is Mode B because two of the owner-facing workflows do not exist yet. It is a direction
review of their home and interaction model, not a craft critique of imaginary screens. After the
direction is owner-ruled and implemented, ordinary visual QA—not another broad product debate—can
check responsive execution.

Positive board learning is also not being presented as shipped. Today, **Works**, **Signature**
and **Almost** preserve visible and organizational provenance, but they do not teach the stylist or
enter synthesis while a non-reinforcing destination remains unresolved. Reviewers may evaluate how
that boundary should be communicated; they must not assume the controls already create lessons.

## What exists in the current UI

Style Profile currently contains:

1. a page-level memory legend;
2. Learned rules & preferences;
3. Occasion exclusions with Restore;
4. Outfit & styling feedback eligible for owner action or lesson synthesis;
5. explicit paid-synthesis preview/authorization;
6. draft synthesis review;
7. collapsed accepted personal lessons with editable text, boundary and structured applicability;
8. reviewed non-personal synthesis conclusions retained as provenance;
9. source and related-record navigation for contextual reactions.

Generated-image problem reports remain managed at their originating image-feedback controls. The
rejected generated image is retained as evidence but is never supplied as a future visual reference.
When the same garment is rendered again, the image prompt may receive only a short piece-scoped
textual fidelity reminder. Wardrobe Tasks separately contains the image-report-to-metadata-review
precedent: a wrong-length report may propose a
field review, but no garment tag is silently changed. Resolving that task does not silently clear
the generated-image report, and clearing the report does not silently approve a metadata edit.

## What exists in the backend but not the UI

### Product-quality findings — item 11

An accepted general styling failure or an explicitly confirmed no-cost report creates one durable
`product_quality_findings` record. It snapshots the source feedback, thread, board image, garment
IDs/photos and structured attributes. Deleting the original reaction does not destroy that
evidence. The finding has no styling authority. It stays open until resolved to one explicit
destination—shared rule, model instruction, garment metadata, renderer, or no change—or dismissed.

The panel must recommend where this work queue belongs, what evidence is visible before resolution,
and how status/history should read. It must not recommend storing the finding as an owner
preference merely to reuse the existing memory cards.

### Structured owner constraints — item 12

An explicitly confirmed constraint can select verified piece IDs, category or structured material,
then one context dimension: occasion, activity, season or weather. The matching garment is removed
before roster assembly and independently for each capsule-plan slot. Missing context is a no-op.
The suppression reason records the constraint ID and dimension. Converting a linked prose owner
rule archives that prose so the same instruction is not also broad prompt authority. Retirement
lifts the gate.

The panel must recommend how an owner reviews the proposed selector/context, sees where it is active,
and retires it. It must not broaden selectors from garment names or prose, and it must not turn an
owner preference into a gate without confirmation.

## The seven examples, in plain language

1. **Global owner rule:** the model is reminded on styling requests. The engine does not remove a
   garment. Edit or Retire changes that prompt guidance.
2. **Occasion exclusion:** one garment is mechanically unavailable for one occasion. Restore lifts
   it. This does not mean the garment is unavailable for every casual use.
3. **Wrong choice for this outfit:** weak evidence about one garment in one outfit/context. It has
   no score and does not mean the owner dislikes the garment. A paid lesson may be proposed only
   after separate preview and authorization.
4. **Accepted personal lesson:** prompt guidance only when its owner-reviewed structured garment
   and/or context applicability matches. Boundary prose explains; structured applicability decides.
5. **Generated-image problem report:** may send a piece-scoped textual fidelity reminder only when
   that garment is rendered again. It never reuses the rejected image and never changes styling
   selection. Any proposed metadata edit remains a review task rather than an automatic
   garment-truth change.
6. **Product-quality finding:** a product repair record with durable evidence and no styling
   authority. Resolution changes the product only through a named destination.
7. **Owner constraint:** a structured hard gate, confirmed by the owner, applied before selection
   and per plan slot. Retire is the undo.

## Fresh fixture verification

`scratch/build_item13_feedback_panel_fixture.js --reset --with-auth` creates isolated temporary
wardrobe and system databases with a disposable user-1 login on
2026-08-11. The fixture builder has no provider import or provider-call path; it writes local fixture
records directly and contains:

- three fictional panel garments;
- one long owner rule;
- one home occasion exclusion;
- one version-2 wrong-choice reaction with an explicit wet-weather reason and literal source thread;
- one second, unprocessed version-2 wrong-choice reaction that visibly remains eligible for synthesis;
- one generated-image problem report and linked review task;
- one accepted, piece-and-context scoped personal lesson;
- one open product-quality finding with one preserved evidence snapshot;
- one active wet-exposure owner constraint whose duplicate prose source is archived.

The generated fixture manifest verifies one product-evidence row, archived duplicate prose, an
active constraint, and an accepted personal lesson. No record came from the owner's legacy testing
account.

## Reproducible visual evidence

Ten screenshots at 1440px, 1024px and 768px are stored in `docs/item13-panel-captures/` and included
in the packet. `scratch/capture_item13_panel_evidence.js` regenerates them from the isolated fixture
with cached Playwright Chromium, device scale factor 2 and stylist debug disabled. The script
asserts that the wrong-length renderer control is active and that no populated textarea clips at
768px. Its final empty-state capture removes one fixture reaction, so the fixture must be rebuilt
after every capture run.

Backend-only product findings and owner constraints must not receive fabricated UI mockups presented
as shipped behavior. They are described as direction artifacts, and the panel is explicitly asked
to recommend their owner-facing workflow.

The archived duplicate owner-rule prose is intentionally absent from the Style Profile query. A
screenshot can show that it is absent but cannot prove why; its caption must identify the archived
source row as a fixture/database assertion rather than invite reviewers to infer archival from the
screen.

## Presenter self-check

Before dispatch, the presenter must answer all of these from the trace—not from memory:

- Which records change candidate eligibility?
- Which records reach prompts, and under what applicability?
- Which records guide only image generation?
- Which records have no behavioral authority?
- Which store is canonical when a board has a mirrored feedback receipt?
- What happens to duplicate prose when it becomes a structured constraint?
- Which actions are free, and which single action may authorize a paid model call?
- What survives if the original product-issue reaction is deleted?

If any answer changes, update the manifest, regenerate the packet, and re-run packet preflight
before convening reviewers.
