# Stylist work — session handoff

**Last updated:** 2026-07-25. Branch `stylist-looks-count-diagnosis`, committed through `cbebe3c`
(PR #176), plus uncommitted work from this session (see below). Working tree also has an untracked
`closet.db` (0 bytes, should be gitignored or deleted) predating this session.

**This session (uncommitted):**
- Fixed the `nature_walk` → "city walk" mislabel: `compactOutcomePhrase`
  (`src/utils/threadGrouping.js`) now special-cases `nature` + `walk`/`walking`/`stroll` to
  `"nature walk"`, ahead of the generic city-walk branch, mirroring the existing `mountain` +
  `hike` special case. Regression test added in `test/threadRail.test.js`
  (`nature_walk keeps its own phrase instead of collapsing into city walk`). Full suite run:
  795 tests, 7 pre-existing failures (unchanged from a `git stash` baseline check — none are new,
  none touch `threadGrouping.js`; the "6 known failures" figure in PR #176 and below is stale by
  one). No UI verification needed — pure string-mapping change, covered by the unit test, no
  billed call warranted per the hard rule below.
- Added a **"Deliberately not built / by design"** section to `docs/ui-v1-design-handoff.md`'s
  **Outstanding issues** (right after *Resolved, not open*), covering "city stroll" → walking
  shoes, one shoe carrying 7 of 8 capsule looks, and plans not absorbing revisions — the three
  remaining items from the recurring-failure-mode list below that hadn't been written into the
  canonical doc yet (garment IDs was already there). Updated `docs/expert-panel-brief.md`'s Part 4
  to require copying this new list verbatim into future packets, same as the existing one. This
  closes the "Open" item below about the panel packet lacking an unbuilt-things section.
- **Fixed weather-provenance invisibility, owner-directed.** `resolveSlotWeather`
  (`styling-engine/outfitSetPlanner.js`) now appends `" (estimated)"` to both heuristic branches
  (the coarse hot/cold/mild descriptor and the model's own free-text weather guess), so a heuristic
  guess no longer reads with the same confidence as the existing `"(live forecast, City)"` marker
  on the live branch. The `stated` branch (explicit per-slot weather, e.g. `indoor`) is untouched —
  that's known information, not a guess. Regression test in `test/plan_outfit_set.test.js`
  (`plan slot weather label marks a heuristic guess as an estimate, not a live forecast`), covering
  generic-heuristic, worded-heuristic, and live-forecast cases via `buildPlanSlotWorkbench` directly
  — no model/network call. **Note:** `docs/stylist-bugfix-spec.md` had framed this as a
  panel-judgment question ("the packet should say so") rather than a plain defect — the owner
  chose to fix it directly this session rather than defer it. One consequence: the Tucson artifact
  quote in `docs/panel-packet-stage1.md` (`Weather used: Casual Days — hot, highs 100-105F, sunny…`
  with no marker) now describes stale pre-fix behavior; regenerate or annotate that quote before
  using the packet, per the evidence-rules data pre-flight in `expert-panel-brief.md`.

Paste-able starting context for a new session picking this up.

## Read first, in order

1. **`docs/expert-panel-brief.md`** — the ratified panel protocol. Two modes: Mode A is craft
   review (proven on Wardrobe and Lookbook), Mode B is direction review over propositions (new,
   untested). Stage 1 for the Stylist is Mode B over the whole feature; Stage 2 is per-flow Mode A
   on whichever flows survive.
2. **`docs/stylist-bugfix-spec.md`** — everything found, fixed, and deliberately not fixed, with
   the owner rulings attached.
3. **`docs/ui-v1-design-handoff.md`** — the **Outstanding issues** and **Resolved, not open**
   sections. The second is copied verbatim into any panel packet; never paraphrase it (paraphrasing
   it once inverted it and cost a panel run).

## Hard rules

- **Never make a billed model call.** The owner is budget-constrained. Diagnose against the
  read-only database (`wardrobe.db`, 236 pieces) or with scratch scripts that call the real engine
  functions directly — see `scratch/diagnose_capsule_shoe_roster.js` and
  `scratch/build_dedup_fix_demo_thread.js` for the pattern. Both produce real engine behaviour with
  no AI call.
- **Do not kill anything on ports 3098/5174 without asking.** A previous session followed
  `CLAUDE.md`'s unconditional-restart rule and killed the owner's server mid-generation. That rule
  is still unamended and is what caused it. Port 3098 is frequently the owner's own **un-mocked**
  server.
- **`sandbox-web-asuser` (port 5176)** is the sandbox web server without `VITE_STYLIST_DEBUG` —
  use it for any "what does the owner actually see" question. `sandbox-web` (5174) has the dev flag
  on and shows engine internals no user ever sees.
- **`wardrobe-web` (5173) proxies to the live un-mocked API.** Browsing stored threads is free;
  clicking `Generate outfit image`, `Evaluate outfit`, or `Preview all directions` spends real
  money. Keep review agents off it entirely.

## The recurring failure mode — read before reporting anything as a bug

Four times in one session, an absence was reported as a defect and turned out to be deliberate or
simply unbuilt:

- **Garment IDs in stylist prose** ("the tan leather tote (ID 12)") — requested, because garment
  names collide constantly, especially auto-tagger-written ones. The *presentation* is open to
  redesign; the disambiguation problem is not negotiable.
- **"city stroll" implying walking shoes** — by design.
- **One shoe carrying 7 of 8 capsule looks** — the 14-piece budget buys exactly 3 shoe slots
  (`capsuleQuotas`), one of which the register-floor guarantee spends on an evening-capable shoe.
  Correct behaviour.
- **Plans not absorbing their own revisions** — never built.

For any capsule- or plan-shaped question, start at `capsuleQuotas` / `selectCapsuleRoster`, **not**
at the per-slot gate. The gate, `PLAN_WORKBENCH_PIECE_LIMIT`, `planWorkbenchPieceScore`,
`fit_confidence`, and feedback influence all operate *after* the roster is chosen — an entire
investigation was spent in the wrong layer.

## What shipped in PR #176

Legacy diagnostic cards leaking raw gate vocabulary; the `Useful repeats` label read from
structured `pieceReuse` instead of a keyword guess; look counts describing the plan rather than the
collapsed viewport; plan and whole-wardrobe responses no longer discarding the model's entire prose
answer; the canned "Outfit ideas for X…" line removed; engine field dumps kept out of the notes
disclosure; plans exempted from the outfit fold; raw slot ids removed from rail subtitles along
with a latent regex-alternation bug. Each has a regression test. Build passes; the suite sat at 6
known pre-existing failures at merge time — now 7 (see this session's note above; confirm with
`git stash` before attributing any new one).

## Panel artifacts

Real wardrobe (236 pieces): `thread_1784970885986` (14-piece capsule — the budget/declaration
case), `thread_1785005174812` (Tucson trip — clarify-then-plan, declared shoe economy),
`thread_1784240128734` (wedding — the one case where a live forecast actually resolved),
`thread_1785003920853` (today/dinner — conversational levers, and a within-session correction
landing next turn). Sandbox contrast (23 pieces): `thread_1784969942592`, `thread_1784969252663`.

## Open

- **Plan outfit cap does two jobs.** Approach decided — split by plan shape — number deliberately
  unresolved pending research into real capsule practice. Deferred behind Stage 1.
- **Lossy plan overview:** `getTripPlanOverviewRows` recognises only four line patterns, so the
  piece roster, budget verdict, and `plan trimmed` notices never reach the structured summary.
- **Revised plans unfindable in the rail — investigated, not fixed.** `threadMemory` is a single
  blob overwritten each turn (`StylistChat.jsx`'s `nextThreadMemory`); the rail's
  `getThreadOutcomeSummary` only ever sees the latest snapshot, so a plan revision (a lone
  `proposed` card) genuinely erases the prior plan's outfits from what the rail can summarize.
  There is no narrow fix available without first building the plan-revision merge itself, which is
  the deliberately-unbuilt feature above — do not attempt a rail-only patch here.
- Smaller: the `All looks distinct` label branch unverified (not worth a billed call).
