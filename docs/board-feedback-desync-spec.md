# Spec — board feedback desync between chat and Visual Lab

**Status:** diagnosed, not implemented. Ready to hand to a separate session.
**Owner-reported** during taxonomy-unification testing (2026-07-24), re-raised 2026-07-26.
**Prior context:** `docs/ui-v1-design-handoff.md` — the original diagnosis under *"Data-hygiene fix
found and fixed while testing this: Visual Lab's structured-reason sync"*, plus Outstanding issues
1 and 2.

## The symptom

The same generated board shows **different selected feedback chips** depending on where you look
at it. Give a board feedback in the Stylist chat, open it in Visual Lab → Calibration Boards, and
the chips you picked are not selected. The reverse also holds.

## Why — two stores, two readers, no shared truth

| | writes to | reads from |
|---|---|---|
| **Stylist chat** | `stylist_feedback` rows via `POST /api/stylist-feedback` (`StylistChat.jsx:3460`) **and** a per-thread snapshot `thread.payload.feedbackSaved` (a `Set` of composite keys, `StylistChat.jsx:621/698/873`) | the **frozen snapshot**, restored on thread load — never refreshed against anything |
| **Visual Lab** | `saved_boards.payload.feedback_labels` / `.feedback_details` via `PATCH /api/saved-boards/:id` (`VisualLab.jsx:424`) | `saved_boards.payload`, live |

Neither reads the other's store. The chat's chip state is a local snapshot captured at the moment
feedback was given and stored inside that specific thread; Visual Lab's is the canonical
saved-board record. They can only agree by coincidence.

**Measured 2026-07-26** against the real 236-piece wardrobe (`wardrobe.db`, read-only):

- `stylist_feedback`: 367 rows, actively written (most recent `2026-07-26 08:30:10`)
- `saved_boards`: 243 rows; 55 carry `feedback_labels`; 5 carry grouped `feedback_details`
- **`stylist_feedback` rows carrying `payload.feedback_reason`: 0**

## The second, deeper problem — specific reasons may reach nothing

`syncFeedbackFromSavedBoard` (`routes/crud.js:569`) mirrors *group-level* labels from a saved board
into `stylist_feedback` so the model can read them. It has no concept of the *specific reason*
nested inside a group, so a Visual-Lab-picked `weak_structure` became one reason-less
`feedback_type: 'style_direction'` row.

`syncStructuredReasonsFromSavedBoard` (`routes/crud.js:527`) was added to fix that — one row per
reason, each carrying `payload.feedback_reason` — and `syncFeedbackFromSavedBoard` now skips the
two grouped categories to avoid duplicate reason-less rows. Three regression tests in
`test/savedBoardMemorySemantics.test.js` cover add / add-second / remove.

**But it was found to be inert, and still is.** `getStylistFeedbackMemory`'s reactionLines builder
— the one place that reads `payload.feedback_reason` — deliberately **excludes any row whose board
already exists in `saved_boards`**, to avoid double-counting with `getSavedBoardMemory` (which
reads structured reasons straight from `saved_boards.payload` and was already correct). Visual Lab
only ever operates on already-saved boards, so every row that fix produces is excluded from that
prompt path. Nothing else in `styling-engine/rules.js` reads a grouped `feedback_type` with a
nested reason either — `getFeedbackInfluenceForPair` expects an older flat scheme neither sync
produces.

Combined with the measurement above (zero rows carry a reason key anywhere), the open question is:
**does the specific reason inside a grouped chip ever reach the model, on either path?**

## Start here — a free trace, no model call

Before writing any code, settle whether the reason survives. Pick one `style_direction` row (e.g.
`2026-07-23 00:11:59`) and one saved board carrying `feedback_details.shape_balance`, and trace
each to the text the model actually receives:

- `getSavedBoardMemory` (`styling-engine/rules.js`) — reads `saved_boards.payload` directly. Does a
  Visual-Lab-picked reason appear in its output?
- `getStylistFeedbackMemory` (`styling-engine/rules.js:~1262`) — builds the "Saved reactions" block
  from `feedback_type` / `payload.feedback_reason`. Confirm the already-saved-board exclusion, and
  what a chat-written row produces.
- Splice sites: `styling-engine/core.js:~3685` and `routes/ai.js:~1106`.

This is read-only and answers the question that decides how much the display fix is worth. If
specific reasons already reach the model via `getSavedBoardMemory`, the desync is cosmetic-only. If
they reach nothing, the richest part of the feedback vocabulary has never influenced anything, and
that is a far larger finding.

## The display fix, when it is wanted

Already diagnosed, not implemented: index full saved-board records by `imageUrl` on load, and
branch the chat's board-feedback reads and writes through the canonical `saved_boards` record once
a board is saved, instead of trusting the local snapshot. The per-thread snapshot can stay as an
offline fallback for boards that were never saved.

**Do not start with this.** Run the trace first — it may reclassify the whole item.

## Constraints for whoever picks this up

- **Never make a billed model call.** Diagnose against read-only `wardrobe.db` or with scratch
  scripts calling real engine functions — see `scratch/diagnose_capsule_shoe_roster.js`.
- **Do not kill anything on ports 3098/5174 without asking.** Port 3098 is frequently the owner's
  own un-mocked server; a previous session killed it mid-generation.
- Clicking a verdict or reason chip is **feedback-only and never calls the model**, so live
  click-through testing in the sandbox is free and is the right way to verify a fix.
- Baseline is **7 pre-existing test failures**; confirm with `git stash` before attributing a new
  one.

## Recorded measurement error — do not repeat it

Counting `saved_boards.payload` alone showed no writes after 2026-07-23 and zero `style_direction`
values ever, which looked like the taxonomy unification (#173, 2026-07-24) having broken feedback
capture. **It had not.** The chat writes to `stylist_feedback`, which was being written the same
morning the conclusion was drawn. Counting one of two stores and concluding the feature was broken
is precisely the failure this desync sets up for anyone investigating it. **State which store you
measured, every time.**
