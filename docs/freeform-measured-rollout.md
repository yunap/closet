# Freeform measured rollout

**Status:** active — 2026-08-19
**Authority:** Slice 10 of `freeform-followup-profiles-spec.md`

## What offline evidence can prove

`test/fixtures/freeform_execution_routing_corpus.json` is the permanent routing-contract corpus. It
contains 22 requests across composition, current-card explanation, garment fact, general advice,
inventory, discovery, correction/revision, photo/critique, plans and ambiguity. Every execution
profile appears, and unsafe or underspecified cases expect `full_stylist`.

`freeform_observability.test.js` runs every row through `routeFreeformExecutionProfile` with the
provider replaced by the hermetic structured-response hook. This proves the schema, question,
presence-only context, profile vocabulary and downstream contract remain wired for every class. It
does **not** prove that the live model will classify every sentence correctly; semantic routing is
model behavior and requires the small live sample below. Existing tests separately prove context
requirements, early-return boundaries, tool absence, image bounds, full-truth expansion, history
bounds, and deferred-tool compatibility fallback.

## Default-on thresholds

Evaluate flags independently. A flag passes only when its relevant rows show:

- no wrong compact-profile interception;
- no identity miss, false wardrobe gap, invented garment truth, or lost correction;
- no extra provider iteration caused by fallback or missed tools;
- styling specificity and conversational quality no worse than the accepted comparison;
- lower total estimated cost, including cache writes/reads and image input—not merely fewer prompt
  characters.

Compact profiles additionally require at most two provider iterations (router plus answer), except
`wardrobe_inventory`, which requires one. Full-stylist experiments must record tool sequence,
provider iterations, input/output/cache tokens, history reduction, deferred-tool counters and
whether the discovery index was used.

## Small owner-approved live matrix

Run only after all offline checks pass. Do not repeat a call merely to improve prose when its routing,
grounding and cost outcome are already known.

| Order | Request class | What it validates | Paid comparison |
|---:|---|---|---|
| 1 | General education (“What makes an outfit smart casual rather than casual?”) | `general_advice`; no wardrobe claim | one flagged call; compare with prior full-stylist cost floor |
| 2 | Follow-up on two existing cards (“Which of these is warmer, and why?”) | server-owned card continuity; `existing_card_explanation` | one flagged follow-up on an existing thread |
| 3 | Exact named garment mechanic with saved worn/hanger photos | `garment_fact`; visual feasibility versus quality; no repeated upload request | one flagged call only; prior `thread_1787117753981` is the comparison |
| 4 | Coverage judgment (“Do I have enough lightweight jackets for a cool rainy week?”) | tiered index does not fake sufficiency; coverage expands | matched tiered off/on only if no comparable recorded baseline exists |
| 5 | Sparse discovery request whose first search is insufficient | broadening, deferred tool discovery, no false gap | matched deferred/tiered off/on; this is the decisive full-stylist experiment |

Stop immediately after a wrong profile, identity miss, construction error, false gap or unreported
fallback. Diagnose offline before spending the next call. Default-on decisions are made per flag
after the relevant rows, not after the whole matrix as a bundle.

## Live results

1. **General education — stopped for quality, 2026-08-19.** `thread_1787119133701` correctly used
   `execution_router;compact_general_advice`: two iterations, 2,530 input / 522 output, zero cache,
   searches, tools, images or wardrobe claims. It nevertheless converted optional smart-casual
   signals into universal requirements and described casual dress as shapeless errand wear. The
   compact general-advice contract was amended and pinned offline before any next live row.
2. **General education correction — passed, 2026-08-19.** `thread_1787119607911` used
   `execution_router;compact_general_advice`, two iterations, 2,638 input / 525 output, zero cache,
   search or wardrobe access. It explicitly described tailoring as one pathway, offered several
   optional whole-outfit signals, and preserved context dependence. Some conventional polish bias
   remained, but it was no longer stated as a gate; no further paid prose tuning is warranted.
3. **Saved-photo garment mechanic — stopped for routing and evidence, 2026-08-19.**
   `thread_1787120404670` fell through to `execution_router;declare_intent,view_pieces`: three
   iterations, 1,595 input / 463 output, 23,903 cache read and 25,081 cache creation. The router had
   no saved-photo-presence signal, and the fallback guessed “cotton-blend” from appearance despite
   no stored fiber fact. Routing now exposes only a saved-photo subject count; saved configuration
   judgments may use `garment_fact`, and neither compact nor `view_pieces` may infer exact fiber from
   photos. The rerun must show `compact_garment_fact` and bounded image count before rollout resumes.

   The first rerun, `thread_1787121042557`, proved the model-only routing instruction was not a
   sufficient guarantee: the exact request still chose `full_stylist`, paid three calls, and called
   the top “cotton-feel.” Exact-name + saved-photo tuck/untuck questions now have a narrow
   deterministic handoff to `garment_fact`; pairing and broad fit critique remain full-stylist.
   The answer contract requires a direct styling judgment about the visible garment-and-body
   interaction when the image supports one. It may say the shown tuck fights the wearer’s
   proportions and recommend the likely stronger alternative; it may not invent an unseen cause,
   present the unseen alternative as proven, or turn one outfit interaction into a universal body rule.

   The next attempt reached the compact branch but failed before answering: compact images omitted
   Anthropic’s required `source.type: "base64"`. The broad router catch then mislabeled the answer-
   call error and paid for the full stylist. Compact visual blocks now include the discriminator.
   This exact narrow route also fails visibly instead of silently buying the full-manifest fallback
   when its router, serialization, or answer call fails.

   `thread_1787121983218` then passed the execution and cost contract: two calls, 4,124 input / 510
   output, zero cache, two saved images, and `execution_router;compact_garment_fact`. Its central
   judgment was direct and grounded, but it jumped from a photographed full tuck to an unsupported
   partial-front-tuck prescription. The compact contract now tests the simplest adjacent alternative
   first—fully untucked here—unless supplied evidence specifically supports a more elaborate treatment.

4. **Qualified coverage — stopped, then bounded, 2026-08-19.** `thread_1787122233484` used four
   calls and treated one ordinary search as complete. It mixed a heavy winter leather coat into a
   lightweight audit and inferred rain handling from material. The replacement profile supplies a
   complete category census plus no more than eight relevance-ranked saved visuals in one bounded
   answer call after routing. Primary matches must satisfy every qualifier; backups state what they
   miss. A visually obvious purpose-built raincoat remains valid evidence despite weak metadata.

   `thread_1787123008051` passed the two-call/no-cache architecture but exposed an over-literal
   contract: it audited sheer cardigans, printed database fields and treated `light` as the meaning
   of lightweight. Qualified coverage now scopes by centralized garment kind, treats practical
   weight as a tag-plus-visual judgment, evaluates weekly sufficiency by reuse and backup, caps prose
   at 350 words, and forbids IDs, enum syntax and visible self-correction.

   Owner rejected continuing this as a list of anticipated cases. The replacement router contract
   uses arbitrary dimension/target constraints and usage context; the bounded judge returns only a
   structured evidence classification. Code validates IDs against the complete census and renders
   names deterministically, so future questions reuse provenance rather than gaining another branch.

   `thread_1787123957953` proved provenance must be enforced, not merely requested: visible utility
   details became “confirmed” rain performance and duration again became quantity. Constraints now
   carry observability, classifications carry evidence basis, and code downgrades visual-only latent
   claims. An explicit minimum defaults to one absent a stated rotation/simultaneous-use need. The
   renderer computes the headline, strips IDs/internal fields, and caps reasons and total length.
