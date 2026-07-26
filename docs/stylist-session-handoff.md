# Stylist work — session handoff

**Last updated:** 2026-07-26. Branch `stylist-weather-provenance-and-labels`, committed through
`0c934ed` plus the mapping work committed after it.

## State

Two full days of work, and **the durable output is documentation, not code**. Stage 1 of the expert
panel ran; the more productive activity turned out to be mapping the app, which found four surfaces
the panel packet had missed and several behaviours nobody had written down.

**Docs that now exist, in the order a new session should read them:**

1. `docs/app-surface-map.md` — 33 entries. Every route, tab, mode-split and dialog. Plain English
   first, stores as a footnote, every observation tagged `[by design]` / `[known bug → ref]` /
   `[unverified]` / `[owner check wanted]`. **Read this before assuming anything about the app.**
2. `docs/engine-behaviour-map.md` — the non-UI companion: side-effect writes, server-side thread
   state, retry loops, prompt splices, sweeps. First pass; "still to map" section is honest.
3. `docs/panel-stage1-findings.md` — the panel synthesis organised for triage by ID. Section A is
   ruled; B, C, D, E are not.
4. `docs/expert-panel-brief.md` — ratified protocol. **Part 4b lists six ways the implementing
   agent got this wrong**; read it before assembling a packet.
5. `docs/board-feedback-desync-spec.md` — self-contained, ready for a separate session.
6. `docs/ui-v1-design-handoff.md` — rulings, plus **Outstanding issues 1–8**.

**Two derivation scripts**, both read-only and free:
`node scratch/derive_surface_skeleton.js` (surfaces, diffed against the map) and
`node scratch/derive_engine_behaviours.js` (writes, retries, splices). Run them to check the maps
have not rotted.

## What is decided vs open

**Ruled (panel findings section A):** A1 prints on shoes/accessories, A2 confident rationale under
scarcity, A4 shoe register span, A5 reasoning-then-interaction — all **accepted, not yet
implemented**. A3 rejected (asking what you own is deliberate). A6 reframed — the `~$0.07` labels
are owner-facing instrumentation, not user pricing, so the question is tiers, not honesty.

**Not ruled:** B1 chips, B2 structured read, B3 diagnostic cards, C1–C5, D1, and which of E1–E6
become propositions. Recommended order is in the findings doc: **C3 (the decision rule) before the
B items**, because it is upstream of them.

**Stage 2** (Mode A craft review, per flow) not started. It should use the surface map's inventory.

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

## Before generating panel evidence

**Clear the whole-wardrobe session recency memory**, unless the artifact is meant to show the
rotation mechanism — in which case declare it, with the skip count. The memory silently narrows the
pool (observed: 10 of 23 pieces skipped), and the only sign is one line in the composer footer.
**Include them again**, or `DELETE /api/ai/whole-wardrobe-session-memory`. Full rule in
`docs/expert-panel-brief.md` → Part 4.

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

- **Plan outfit cap does two jobs.** Approach decided — split by plan shape. **The research the
  number was waiting on is done (2026-07-25); the implementation still waits for Stage 1.** Full
  writeup in `docs/stylist-bugfix-spec.md` ("Research done 2026-07-25 — what the capsule number
  should be"); measurement scripts `scratch/diagnose_capsule_outfit_capacity.js` and
  `scratch/diagnose_capsule_supply_vs_selection.js` (real `selectCapsuleRoster` + real per-slot
  gate, read-only, no model call). Headlines:
  - **Pass `targetOutfits` on the slots** in any capsule diagnostic — it drives
    `capsuleDemandReserve`, and omitting it makes every low-register slot read about half as
    capable as the live plan is. This already produced one wrong set of numbers.
  - Real gate-valid capacity at budget 14 is **24** distinct cores against a naive 26, so the
    original "~25 combinations presented as 8" framing is **confirmed** — the cap undersells a
    14-piece capsule by roughly 3×.
  - **The wardrobe is not thin.** At the weakest slot (`casual_city_day`) supply is 44 eligible
    tops and 35 eligible bottoms; the roster bought 2 and 2. This is entirely a
    `selectCapsuleRoster`/`capsuleQuotas` question, not a "buy more clothes" one.
  - Capacity is **non-uniform per slot** (5 cores at `casual_city_day` vs 21 at
    `smart_casual_outing`), so a bigger total alone deepens the rich slots and makes the thin one
    repeat.
  - Capsule practice presents a **rotation, not an enumeration** — 10×10 is 10 pieces/10 outfits,
    3-3-3 is 9 pieces/9 base outfits, Project 333 lists no outfits at all; the big numbers
    ("15 pieces, 50+ outfits") are capacity claims, never lookbooks. All of these are *seasonal*
    capsules, and none varies its outfit count by season — supports a season-invariant cap.
  - Recommended, unratified: capsule cap = `min(piece_budget, 12)`; trips keep the day curve.
  - **New, unfiled defect signal:** winter at budget 14 with `targetOutfits` set leaves
    `evening_out` with 4T **0B** — zero possible looks. The everyday-tier demand reserve appears
    to crowd evening-capable bottoms out of the roster. Summer does not show it. Not investigated.
- **Lossy plan overview:** `getTripPlanOverviewRows` recognises only four line patterns, so the
  piece roster, budget verdict, and `plan trimmed` notices never reach the structured summary.
- **Revised plans unfindable in the rail — investigated, not fixed.** `threadMemory` is a single
  blob overwritten each turn (`StylistChat.jsx`'s `nextThreadMemory`); the rail's
  `getThreadOutcomeSummary` only ever sees the latest snapshot, so a plan revision (a lone
  `proposed` card) genuinely erases the prior plan's outfits from what the rail can summarize.
  There is no narrow fix available without first building the plan-revision merge itself, which is
  the deliberately-unbuilt feature above — do not attempt a rail-only patch here.
- Smaller: the `All looks distinct` label branch unverified (not worth a billed call).
