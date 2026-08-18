# Spec archive — historical design specs

Written 2026-07-30. **Amended 2026-08-16: the specs now live in the repo at
[`docs/specs/`](specs/), copied from `~/Downloads/spec_*.md`.** This file remains the *rationale* —
the authority order and the method below are the owner ruling that governs them.
[`docs/specs/README.md`](specs/README.md) is the operational front page for the archive itself.

The move raises a risk this file was written to prevent: previously the specs were invisible to
search, so they could not mislead; now they are greppable and will surface in future sessions. The
mitigation is that **every spec file carries a banner declaring it historical and its `Status:`
line untrustworthy**, enforced by `npm test` — because a search hit opens the file, not this page.

## What this archive is — and is not

35 specs, now at **[`docs/specs/`](specs/)**.

**They are historical.** The app has been redesigned several times since most of them were written
— the legacy pre-compose stack was deleted, de-Yunafication landed, the whole thing became a
multiuser platform. Much of what these specs describe is about an architecture that no longer
exists. They are **not** a design authority and must not be treated as one.

**Authority order, when they disagree:**

1. **The code** — what actually runs.
2. **`docs/occasion_profiles_ratification.md` and the owner rulings in
   `docs/stylist-session-handoff.md`** — what has been ratified.
3. **This archive** — why something was once done that way.

What the archive is genuinely good for is **research and provenance**: when live code does
something odd and no comment explains it, a spec may say why. That is worth real money
occasionally, and it is the only claim this index makes for it.

### How to use it when a spec contradicts a current decision

**Nothing here has been vetted against the current codebase.** Which parts survived the redesigns
and which are dead is simply unknown, file by file, until someone checks. So "an old spec decided
otherwise" is an *unverified claim*, not a finding.

The method, set by the owner on 2026-07-30 after exactly this situation:

- A decision made from **fresh evidence** — a live run, a measurement — **stands.** It is not
  reverted because an unvetted historical document disagrees.
- The disagreement is **recorded** (with the quote, so the reasoning is not lost) and the decision
  is **marked to revisit in testing.**
- **Testing settles it, not archaeology.** If the old reasoning was right, a live run will show it,
  and the fallbacks are already written down.

The failure mode this avoids is deferring to a document that describes an architecture that may no
longer exist — which would let stale specs quietly veto decisions made against the system as it
actually is.

The concrete case that prompted this file: on 2026-07-30 a session reversed two decisions that were
**still live in the code that morning** — verified, not assumed — without knowing they had been
made deliberately. The specs did not make those decisions binding; they explained them. Knowing the
reasoning first would have changed how the reversal was proposed, not necessarily whether it
happened.

## Every claim here needs checking against the code

**The status lines are stale and cannot be trusted**, and given the redesigns, neither can the
contents. Most specs read `Proposed … Not implemented` while their contents are in the code:

- `spec_17_indoor_weather_regression.md` says *"Proposed (2026-07-15). Not implemented."* Both its
  Part 1 (`environment` implies stated weather) and Part 2 (`restaurant` → `restaurants?`) are in
  `outfitSetPlanner.js` today.
- `spec_30_composer_register_hint_lines.md` says the same and genuinely is not implemented — no
  `registerHint` anywhere.

So the status line tells you what someone intended to do when they wrote the file, not what shipped.
**Verify against the code before concluding anything is or is not implemented.**

## Deliberate decisions that a later session can reverse without noticing

The dangerous entries are not the unimplemented proposals — they are decisions that were *made*,
argued for, and left in the code with no comment and no test naming them. Everything below was
found by reading the archive after the fact.

### Declared slot fields beat inference from the label — decided twice, reversed 2026-07-30

**`spec_12_structured_slot_semantics.md`:**

> "The one behavioral edge: a model that declares `environment` *wrongly* (e.g. `beach_coastal` on
> a dinner slot) now beats the prose. **That is the correct trade** — it's the same trust we already
> extend to `occasion`/`register`/`weather` args, and the constraint gates still apply regardless."

**`spec_17_indoor_weather_regression.md`, Part 1, "One deliberate behavior change":**

> "an explicit `environment:"outdoor"` now suppresses the `isIndoorPlanSlot` text default … **If the
> model says a slot is outdoor, its declaration should beat a keyword inference from the label.**
> Pin with a test."

Both specs chose declared-wins, and spec 12 explicitly anticipated the failure mode — a model
declaring an environment wrongly — and accepted it as the price of trusting structured fields.

**Owner ruling 2026-07-30 reverses this, marked to revisit with fresh testing.** The anticipated
failure occurred: on live `thread_1785380251549` the model declared `environment: 'outdoor'` for
both "Restaurants / Social Events" and "City Outings / Museums", and the engine dressed each slot
for the weather outside the room. A slot's own label now wins where it unambiguously reads indoor;
declarations still win everywhere else, and `beach_coastal` stays authoritative.

**The pin spec 17 asked for existed but was vacuous.** Its fixture label was `"Outdoor Office
Picnic"` — the word *Outdoor* trips the classifier's own exclusion list, so the text default never
fired and the declaration was never exercised. It passed identically before and after the reversal,
which is why 934 tests raised nothing. Now rewritten to test what it names.

### Indoor vocabulary was withheld pending an owner decision — shipped 2026-07-30

**`spec_17`, "Owner decision — NOT included, ask first":**

> "Extending `isIndoorPlanSlot`'s vocabulary (brunch, gallery, museum, dinner) would change
> **engine-mode** defaults for slots with no declaration at all. Per the gate-history discipline
> (missing gate ≠ bug — could be Decision A or B), this is flagged as a question, not shipped …
> Only worth deciding if live runs show the model omitting both fields on indoor-ish slots."

`museum` and `gallery` were added on 2026-07-30 without that question being asked. The trigger
condition spec 17 named was not strictly met — the model **declared** `outdoor` rather than omitting
both fields. **Owner ruling 2026-07-30: keep, revisit with fresh testing.** `brunch` and `dinner`
remain unshipped and still need the same decision.

## The archive

| spec | subject | stated status (**unreliable**) |
|---|---|---|
| 1 | Gate parity for `search_wardrobe` | Ready for implementation |
| 2 | Structured outfit proposals | Design review complete — building |
| 3 | Observability parity for freeform chat | Implemented 2026-07-09 (two copies of this file exist) |
| 4 | Live weather for grounding gates | Implemented 2026-07-09 |
| 5 | Register-ceiling gate for the trip pre-compose path | Implemented 2026-07-09 |
| 6 | Occasion/weather/activity doctrine for editorial prompts | Implemented 2026-07-09 |
| 7 | "Vague trip" vs "single occasion elsewhere" | Ready for implementation |
| 8 | Retire `wholeWardrobePieceTrustDecision`'s weak gate | Ready for specification review |
| 9 | Extend advisor mode to `/ask` pre-compose fallbacks | Ready — sequence after spec 8 |
| 10 | `classifyChatTurn` content-blind follow-up | Needs owner input on a judgment call |
| 12 | **Structured slot semantics — the model declares** | Proposed. **Contains the declared-wins decision.** |
| 13 | `plan_outfit_set` model-composition mode | Proposed — "the big one" |
| 14 | Retire the taste-scorer layer | Proposed, **blocked** on spec 13 |
| 15 | Model-plan friction fixes | Proposed |
| 16 | Conversation prompt caching for the tool loop | Proposed |
| 17 | **Indoor slots lost their stated indoor weather** | Proposed — **but Parts 1 and 2 are in the code** |
| 18 | Follow-up gate context, trip-scope, plan polish | Implemented 2026-07-15 |
| 19 | Register floor/ceiling reconciliation, mode flip | Proposed |
| 20 | Cleanup inventory (read-only) | Proposed |
| 21 | Delete the legacy pre-compose stack (v2) | Proposed — supersedes v1 |
| 22 | Tagger Anthropic image-detail hotfix | Proposed |
| 23 | Partial re-plan merge, register anchor | Proposed |
| 24 | Packing enforcement, weather parse, layer parity | Proposed |
| 25 | Office competence, owner-rule delivery | Proposed |
| 26 | Revision validator, footwear cap, outdoor-social mapping | Proposed |
| 27 | Sight for visual judgment (print pairing) | Proposed |
| 28 | Full-codebase cleanup inventory | Proposed, read-only |
| 29 | Post-audit fixes and cleanup | Proposed — all owner rulings captured |
| 30 | Composer register-hint lines | Proposed — **genuinely not implemented** |
| 31 | Batch wardrobe onboarding | Proposed, reviewed with owner |
| 32 | De-Yunafication: profile and constitution | Reviewed 2026-07-18 with rulings |
| 33 | Multiuser web platform | Written 2026-07-19, open questions ruled |
| 34 | Public front door and admin | Written + reviewed 2026-07-20, ruled |
| — | Chat markdown rendering | Ready for implementation |

Specs 11 and any gaps are absent from the directory, not omitted here.

## Notes

- **Specs 12, 19, 23, 26 and 30 concern register or slot semantics.** If register work turns up
  behaviour in the code that no comment explains, they may hold the reasoning. Read them for
  *provenance only* — several predate the redesigns, and any claim must be checked against the code
  before it is acted on. Do not treat an old spec as a reason not to change something.
- **Two files named `spec_3_freeform_observability`** exist, one suffixed `(1)`, with different
  statuses. Neither is known to be current.
- The archive is in `~/Downloads`, not backed by the repository. Whether it is worth moving into
  the repo depends on how much of it is still true, which is an owner call — a large archive of
  obsolete design docs inside `docs/` would create exactly the false-authority problem this section
  is warning about.

## Related

- [capsule-index-and-plan.md](capsule-index-and-plan.md) — capsule work, and the live-run findings
  that triggered both 2026-07-30 reversals.
- [occasion_profiles_ratification.md](occasion_profiles_ratification.md) — authoritative for
  occasion behaviour: register ceilings and their amendments.
