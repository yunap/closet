# Guidance from chat and from evidence — review copy

**Status: settled and shipped 2026-08-12.** Four flows can create durable stylist memory. Two were
stable before this work and are included only so the picture is complete; two were under review and
both have now landed — as **read-only**, after two editing designs were built and rejected. Each
section says which is which. Pulled out of the full engineering docs
(`feedback-routing-proposal.md`, `app-surface-map.md`) so it can be read on its own.

## The four ways something becomes durable memory

| | Trigger | Where it lives | Authority | Status |
|---|---|---|---|---|
| **Piece-scoped correction** | Owner says something about one exact garment in chat | `pieces.styling_rules_learned` | Prompt guidance, shown whenever that garment is in play | Stable, unchanged |
| **Direct guidance** | Owner says a wardrobe-wide preference in chat | `stylist_feedback`, `owner_rule` | Prompt guidance, sent only when saved garment/situation matches the request | **Read-only 2026-08-12** |
| **Firm-rule proposal** | Owner states an explicit prohibition in chat; confirmed later in Style Profile | `owner_constraints` | Hard gate — garment is removed from consideration outright | Stable, unchanged |
| **Synthesized lesson** | Stylist notices a pattern across several past reactions; owner authorizes a paid review call | `feedback_synthesis_drafts` | Prompt guidance, sent only when saved garment/situation matches the request | **Read-only 2026-08-12** |

The bottom two rows are what the rest of this document is mostly about — specifically, how each
decides *when* it applies, and what the owner can do to correct that. The two stable rows are
described briefly because they're also things freeform chat can record, but their editing surfaces
are pre-existing and this work didn't touch them.

## The two stable flows (not part of this review)

**Piece-scoped correction.** When the owner says something about a garment the stylist can verify
in the current conversation (just retrieved, in the outfit under discussion, or the selected piece),
the correction is written directly onto that garment's record rather than as wardrobe-wide guidance.
There's no "applicability" question here at all — it's scoped to exactly one garment by
construction, and it's shown whenever that garment's full details are shown to the stylist. It's
editable as plain text in Conversation Memory, kept in sync with the garment card in both
directions; if the garment card was independently edited since, the edit is refused with a
conflict rather than guessing which version to keep.

**Firm-rule proposal.** When the owner's words are an unambiguous, structured-enough prohibition —
today, only a supported garment/footwear/material term crossed with a supported occasion, season,
activity, or weather term — the same chat call can attach a proposal alongside the ordinary
guidance. Style Profile shows **Make this a firm rule** only when that proposal is complete, previews
the exact consequence ("Your stylist will not suggest X for Y"), and writes a real hard gate only
after the owner explicitly confirms — never automatically. This is the one flow in this document
that removes a garment from consideration outright rather than just influencing the prompt.

## The two flows this work covers

| | Direct guidance | Synthesized lesson |
|---|---|---|
| **What it is** | A wardrobe-wide preference the owner said directly to the stylist in chat | A pattern the stylist noticed across several outfit reactions, turned into a lesson via a paid review call the owner explicitly authorized |
| **Example** | *"For office and client days: structured silhouettes only, no dressy maxi skirts."* | *"Olive suede slip-on shoes are fall shoes, not suitable for summer outings."* |
| **Where it's stored** | `stylist_feedback` table, tagged `owner_rule` | `feedback_synthesis_drafts` table, `disposition = 'personal_contextual_lesson'` |
| **Who's the authority on scope** | The owner — she's the author of her own words | The evidence — the lesson can never claim more than what the reviewed reactions actually showed |
| **Can it be broadened later** | Yes — she can say more in a follow-up edit | No — broadening requires new evidence and a new review call |

Both feed into one shared runtime check — a request only receives a given piece of guidance when
its saved garment and/or situation actually matches what's being styled right now. That's the
"applicability" the rest of this document covers.

### What "applies" actually means, in plain terms

Every saved instruction can be scoped to:
- **a garment** (a category like dresses, a footwear type, a material — plumbed to categories, not
  literal garment names; exact-piece scoping belongs to the piece-scoped-correction flow above, not
  this one),
- **a situation** (occasion, activity, season, weather, or an explicit context like "office days"),
- **both**, or
- **everything** ("universal" — sent on every request, reserved for guidance that's explicitly
  general).

Style Profile shows this back as one sentence, e.g. *"Applies for office, client."* or *"Applies
when the saved garment and summer both match."* — never as raw field names.

### The editing surfaces — what shipped, and what didn't

**What was tried first, and rejected the same day:** a form — a dropdown for scope, checkbox groups
labelled Occasion / Activity / Season / Weather / Situation, category and footwear checkboxes. It
worked, it was safe against silent data loss, and it was wrong: it asked the person styling her own
clothes to understand internal routing vocabulary that nothing else in this app exposes. Everywhere
else, structure is derived from what she says or does and shown back as a sentence — never
constructed by hand.

**What's live now: neither card can be edited.** Both show the sentence, one plain line saying when
it is used, and a single action — **Forget this**:

> Canvas sneakers are not suitable for rainy or foggy beach weather.
> Used when: canvas sneakers and rainy weather
> `Forget this`

Correcting a preference means telling the stylist again in chat, which writes its own record through
the normal capture path. Nothing on this page rewords a stored memory in place.

### Why editing was removed rather than refined

Two editing designs were built, tested in the sandbox, and withdrawn:

1. **A structured scope form** (reach dropdown, checkbox groups for occasion / activity / season /
   weather / garment category). It worked and was safe against data loss, and it was still wrong: it
   asked the person styling her own clothes to understand internal routing vocabulary that nothing
   else in the app exposes.

2. **Removable scope tags** — and this one was actively misleading. A lesson's conditions are
   **ANDed**, so removing one *widens* where it fires. Verified against the live matcher: a lesson
   scoped `olive suede shoes AND summer`, with the summer tag removed, begins firing in **winter and
   fall** whenever those shoes are candidates; removing the garment tag instead makes a lesson about
   one pair of shoes colour **every summer request**. The control read as "stop using it here" and
   did the opposite — and broadening a synthesized lesson past its evidence is exactly what the
   synthesis guardrails exist to prevent.

The second finding is the general one: **a comma-separated list of conditions reads as alternatives
when it is really a conjunction.** Scope is therefore now stated as a sentence with the conjunction
spelled out (*"Applies when styling cream cotton button-up shirt for casual summer"*,
*"For canvas sneakers and rainy weather"*) and never offered as something to edit.

### Guardrails found and fixed while building this

Four real defects surfaced during this work, all independent of which UI ships:

1. **A checkbox editor can silently break a working lesson.** If the client's "is this a valid
   submission" check doesn't match the server's validation exactly, a save can succeed while
   quietly zeroing out what the lesson matches — no error, lesson still shows as active, just stops
   firing. Fixed with a server-side backstop: any save that would leave an *already-accepted* lesson
   with zero delivery scope is now rejected outright (the owner sees an error and has to either fix
   it or explicitly Retire), rather than silently accepted.

2. **Evidence itself could carry an unresolved placeholder instead of a real value.** The season a
   reaction was recorded under could literally be the string `"current season"` — the composer's
   default when no season was explicitly chosen — rather than an actual season name. This meant a
   lesson correctly scoped to "summer" could, on the first attempt to edit it, look like it had no
   real seasonal evidence at all. Fixed at the source: evidence now resolves that placeholder against
   the date the reaction was actually recorded, not "now." This bug predates this pilot and would
   affect any future surface that reads evidence context, not just this one.

3. **Occasion exclusions had no timestamp at all.** `pieces` carries only `date_added` (when the
   *garment* was added), and `GET /pieces/occasion-exclusions` returned rows alphabetically, so
   "show the 4 most recently changed" was not answerable. The only record of *when* is the prose
   receipt the writer already stores — `Excluded from <occasion> by <name> (YYYY-MM-DD)` — so the
   route now parses it and returns a real `changedAt`. Day precision only, and an exclusion written
   by migration rather than the UI has no receipt: it returns `null` and sorts last. Verified
   against the real wardrobe, where 7 of 8 carry a parseable date.

4. **A build that passes is not evidence this page works.** Two breakages in this session — a
   removed `visibleLearnings` reference that blanked the entire Style Profile, and a firm-rule button
   stretching to 819px because its row had no thumbnail to fill a fixed grid column — both passed
   `vite build` cleanly. One was a runtime reference, one was pure layout. Only rendering the page
   and measuring the DOM caught them. Treat browser verification as required for this surface, not
   optional.

## Decided 2026-08-12 — read-only for both reviewed flows

| flow | editing |
|---|---|
| **Piece-scoped correction** | Editable as ordinary garment guidance (unchanged) |
| **Direct guidance** | **Read-only.** Correct it by telling the stylist again in chat |
| **Firm rule** | No text editing; stop using it and make a new one if the meaning changes |
| **Synthesized lesson** | **Read-only.** Forget it; a better lesson comes from new feedback |

The governing principle: **records open as explanations, not forms.** This area should read like
*"what my stylist remembers about me"*, never like a memory-management console. A pending synthesis
draft remains authorable — she may reword what the stylist proposed before accepting it — but its
applicability is not owner-editable either.

## Also settled in the same session

- **Style Profile is two tabs**, Active guidance | Review feedback. History was removed from primary
  navigation: it carried equal weight to the two tabs the owner works in while offering **zero
  actions**. It is now **Past decisions**, a recovery archive behind a quiet link, where every row
  leads somewhere — *Start using again*, *Reconsider*, *Reopen*.
- **An unusable synthesis result is no longer queued as a decision.** `insufficient_evidence` drafts
  were created as `draft`, so they sat in *Waiting on your decision* with Accept / Reject — and the
  only way to clear one was **Reject**, which then filed it as a suggestion the owner had declined.
  That single defect produced all three visible wrongs. They now insert as terminal `reported`, their
  rationale is surfaced as an outcome (it explains what a reaction needs before it can teach
  anything), and they can be deleted outright so they do not accumulate.

## Still to build

1. **Firm-rule cards** — *"Boots / Never suggested in summer / Restore"*, no database language, and
   an explicit consequence preview at creation time.
2. **Feedback capture in chat** — say what was done, immediately and in plain language: *"Got it —
   I won't suggest this piece for Travel"*, versus the softer *"Got it. I saved that feedback about
   this pairing"* for a one-off reaction. This is what keeps a reaction visibly distinct from a
   durable rule, and is probably the highest-leverage item remaining.
