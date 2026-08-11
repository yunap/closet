# Active memory surface — implementation spec

## Outcome

Style Profile must answer, for every active user-feedback memory it displays:

1. What did the stylist learn?
2. Is it global, garment-scoped, context-scoped, or renderer-only?
3. What does it influence: a hard gate, a soft ranking adjustment, a styling prompt, image
   generation, or display only?
4. Where did it come from?
5. How can the owner edit, retire, restore, or inspect its source?

This is an operational surface, not a second memory store. It projects the canonical stores named
in `feedback-and-memory-map.md` and uses their existing mutation endpoints.

## V1 boundary

V1 extends the existing Style Profile sections rather than creating a new page:

- **Learned rules & preferences:** global owner rules and verified garment-rule receipts.
- **Occasion exclusions:** canonical structured hard gates.
- **Outfit & styling feedback:** contextual styling evidence and renderer corrections.

Each feedback row receives server-derived `memory` metadata. The client does not infer behavioural
authority from labels. A single page-level disclosure explains the available authority levels;
that explanation is not repeated under every record. Saved-board mirrors and garment-rule receipts
are projections; they are displayed once and never described as an additional prompt reader.

Rows whose registered behaviour is retired or display-only historical provenance are not presented
as active memory. Legacy `preference_reaction` is treated as standing only when its target is a chat
message; piece- or outfit-scoped records remain contextual.

The first implementation does not expose model-authored garment intelligence, raw telemetry,
thread state, or recency caches as user feedback. Confirmed outfits and the Style Constitution keep
their existing dedicated surfaces until transferable-learning work gives them a coherent summary.

## Projection contract

`GET /api/stylist-feedback` adds:

```json
{
  "memory": {
    "destination": "owner_prompt | styling_prompt | provisional_context | renderer | display_only",
    "source": "Stylist chat | Outfit feedback | Generated-board feedback | Saved-board feedback",
    "scope": "Every styling request | Garment: … | Occasion/activity: … | This styling context | Image generation only",
    "effect": "one plain-language sentence",
    "strength": "hard | standing | contextual | weak | renderer-only | none"
  }
}
```

The destination comes from `feedbackBehaviour`; special display-only receipts describe the effect
of their canonical garment rule, not an invented effect of the receipt itself.

## Mutation rules

- Owner rules and garment-rule receipts remain editable and retireable through
  `PATCH /api/stylist-feedback/:id`.
- Accepted personal/contextual synthesis lessons remain visible with their source reactions. The
  owner can edit their prompt text, explanatory boundary, and executable garment/context scope or
  retire them; retirement removes their prompt authority while keeping the reviewed provenance
  record. Applicability edits remain constrained to IDs and terms supported by the source reaction.
  Save is enabled only for a changed, usable card and confirms beside that card.
- Accepted synthesis lessons carry source-validated structured applicability. Styling retrieves
  them before applying the eight-line cap: piece-scoped lessons require a matching active garment,
  context-scoped lessons require matching request context, and piece-and-context lessons require
  both. The editable boundary sentence is explanation, not a text rule the application parses.
- Contextual reactions remain removable through `DELETE /api/stylist-feedback/:id`.
- Occasion exclusions remain restorable through the structured occasion-exclusion endpoint.
- A stale garment receipt returns `409 Conflict`; un-archiving restores its canonical rule.
- No action on this screen writes a new prompt rule or changes a score implicitly.
- A feedback reaction already represented by any synthesis result is no longer selectable for a
  second paid synthesis call. It remains visible as source evidence marked “Included in synthesis
  review.” Empty draft sections are not rendered.
- Structured `signature`, `works`, and `almost` reactions and classified legacy board snapshots are
  selectable for the same authorized synthesis lifecycle. Structured input carries transferable
  `outfit_logic`; legacy input carries bounded generated description, context and anonymous garment
  attributes as explicitly lower-confidence clues. Neither carries garment identity. A lone
  `almost` stays qualified. Once a personal lesson is accepted, its source reaction remains visible
  provenance but pauses its direct prompt authority; retiring the lesson restores that source reader.

## Prompt and diversity safeguards

- The surface reads metadata; it adds nothing to prompts.
- Positive evidence describes transferable outfit logic and never promotes original garment IDs.
- Contextual garment evidence is provisional and creates no candidate or roster score.
- Any future score change requires ranking and diversity A/B verification.

## Acceptance criteria

- Every active feedback type has a registered behavioural destination.
- The API explains source, scope, effect, and strength for owner, garment, contextual, and renderer
  examples.
- Renderer feedback is never described as styling authority.
- A version-2 `wrong_item_read` envelope is surfaced as “Wrong choice for this outfit”: provisional
  context, not a garment rejection, renderer correction, or score. Older unstructured rows that
  reused `wrong_item_read` for other meanings are display-only historical evidence and do not enter
  active memory or prompts. The live non-v2 legacy rows were removed on 2026-08-10 after the owner
  confirmed they were ambiguous test history not worth retaining; display-only routing remains a
  defensive fallback for stale imports.
- New writes also carry a version-2 `feedbackEvidence` envelope. It records the explicit garment,
  outfit context (including available weather), action, source thread/card location, scope and
  authority. “Wrong choice for this outfit” offers an optional reason field; that text is stored
  verbatim as `explicitReason`. The envelope deliberately contains no app-inferred formula,
  silhouette diagnosis, garment role or reason.
- Source navigation is literal. “Open source chat/board” appears only when that surface wrote the
  reaction. A board or garment found later by matching IDs is labelled “related,” never “source.”
- A `piece_rule_receipt` is described as garment prompt guidance and not as a second reader.
- Existing edit, retire, restore, source-navigation, and filtering actions continue to work.
- Semantic audit, focused behavioural tests, and production build pass.

## Later work

After this surface works with real records:

1. Run a small owner-authorized synthesis batch and evaluate the actual draft quality, routing and
   cost before expanding the mechanism.
2. Review the functioning UI and real generated drafts with the expert panel, then obtain owner
   ratification. Do not convene the panel around an empty or hypothetical draft surface.
3. During UI/UX review, consider making calibration-reference priority wording reflect its existing
   kind-specific meaning (`real_photo` identity/proportion versus `good_reference` taste/aesthetic).
   Do not change the working starred-first rotation or treat it as garment-selection authority.
4. Use accepted personal/contextual lessons to discover different closet combinations while testing repetition and
   recency diversity. The app governs scope and authority; it does not encode a fashion ontology.

## Provisional feedback and authorized synthesis ruling

“Wrong choice for this outfit” evidence begins as `provisional`. Saving it never calls a model.
Provisional evidence may be delivered, in compact verbatim form, inside an already-requested
styling call only when its subject garment is under consideration. It is not a standing preference,
generic garment penalty or transferable lesson; delivery is capped and explicitly labelled.
When the optional reason is empty, the record still means “do not blindly repeat this garment in
this exact outfit,” but nothing broader may be inferred and the record is not eligible for paid
synthesis.

The historical −6/−12 occasion/activity scorer is retired because it discards weather, construction
relationships and the owner's reason. Exact stored evidence remains the authority until the owner
chooses whether to synthesize it.

Style Profile lets the owner select provisional reactions and request one synthesis call.
The UI previews the compact payload, a conservative maximum token/cost budget and selected model
before explicit authorization. The input maximum covers the complete locally known request —
system instructions, evidence, structured schema and tool metadata — plus a provider-framing
allowance; it is not extrapolated from evidence text alone. No preview, classification,
consolidation or synthesis call may use a personal API key automatically.

The preview's output estimate is also the enforced worst-case output-token cap, so the displayed
cost bounds the authorized call rather than presenting an average as a maximum. Completed and
failed paid calls retain any provider usage returned before parsing or validation failed.

One authorized call returns drafts, never immediate authority. Draft dispositions are: personal or
contextual lesson, garment-fact correction, general styling failure, duplicate/refinement, or
insufficient evidence. The owner accepts, edits, defers or rejects each draft. General styling
failures do not become personal memory, and garment facts do not silently edit garment metadata.
Only an accepted `personal_contextual_lesson` is read into styling prompts; accepted general
failures and garment corrections remain visible reviewed records with no prompt authority. Accepted
personal lessons can be edited and retired from Style Profile; retired lessons are excluded from
prompt memory.
