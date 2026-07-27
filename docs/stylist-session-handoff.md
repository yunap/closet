# Stylist work — session handoff

**Last updated:** 2026-07-27. Branch `stylist-weather-provenance-and-labels`.

## 2026-07-27 session — board feedback desync fixed, plus three bugs found along the way

Picked up `docs/board-feedback-desync-spec.md` (previously "diagnosed, not implemented"). Now
**implemented and live-verified** — see that spec's "The display fix" section for the mechanism
(chat now indexes saved boards by `imageUrl` and branches reads/writes through the canonical
`saved_boards` record, same as Visual Lab). Full details, including what was deliberately left
alone, are in that spec; don't duplicate them here.

Three more bugs surfaced and were fixed in the same session, none of them things this session set
out to find:

1. **Wrong-length garment picker** (`GeneratedBoardLengthFeedback` in chat, its twin in Visual
   Lab) reset to the first piece on every open/close and never indicated which piece already had
   a saved correction — a correction on a second or third garment looked missing. Fixed by
   replacing the picker with one always-visible reason group per piece; also filtered which
   reasons apply by garment category (shoes/accessories get none). See
   `docs/app-surface-map.md`'s board-feedback-chips entry.
2. **Two chat board-rendering surfaces had no feedback UI at all** (`m.renderedBoards`/
   `render_preview`, and `boardResults[i]`/"wardrobe-board") — separate from the desync, since
   there was nothing to desync when one side had no chips to begin with. Given the desync fix's
   canonical helpers already existed, extended the same taxonomy to both. All four board surfaces
   in the Stylist now behave consistently.
3. **Thread-loading race**: opening a thread by direct URL could silently render a *different*
   thread's messages under the correct URL/title, survivably across a hard reload — a competing
   mount-time effect (`initAndMigrate`) picked its own thread from `localStorage`, independent of
   the URL, and reliably finished last. Fixed by making that effect's guard also skip when a
   thread was requested via the URL. See `docs/app-surface-map.md`'s thread-rail entry.

Also: Visual Lab's Calibration Boards "Needs review" filter was renamed to **"Flagged"** and no
longer includes `almost` ("Almost right"), which is a positive-leaning verdict and now counts as
Positive instead.

All fixes live-verified in the sandbox (feedback clicks are free, no billed calls). Build passes
throughout; suite held at the 7 pre-existing baseline failures the whole session (two test files
needed updates for refactors, not new failures).

## State

Two full days of work, and **the durable output is documentation, not code**. Stage 1 of the expert
panel ran; the more productive activity turned out to be mapping the app, which found four surfaces
the panel packet had missed and several behaviours nobody had written down.

**Docs that now exist, in the order a new session should read them:**

1. `docs/app-surface-map.md` — 33 entries. Every route, tab, mode-split and dialog. Plain English
   first, stores as a footnote, every observation tagged `[by design]` / `[known bug → ref]` /
   `[unverified]` / `[owner check wanted]`. **Read this before assuming anything about the app.**
2. `docs/engine-behaviour-map.md` — the non-UI companion, twelve passes and ~1,555 lines. Side-effect
   writes, thread state, retry loops, prompt splices, sweeps, **scoring weights with measured
   firing rates, caches, CI ratchets, the gates (every layer in order, with measured exclusion
   counts per context), the outfit-level pass after them (advisor-vs-gate mode, repair, diversity
   penalties), the full image-generation path including cost reporting, and the tagger prompt that
   populates every column the rest of it measures, the role vocabulary behind formula-family
   classification, a provenance table of which columns are yours vs the tagger's, and a swept
   singular/plural bug class.** Read its **Findings this map produced** section first: **33 things**
   that were not known before, including one unreachable code path, a billed render that reports no
   cost, a cost gate that under-quotes by 1.6x, and six garment keywords that never fire at all. No
   `[unverified]` tags remain in the body — anything answerable was answered.

   **Four findings withdraw or reorder recommendations made earlier in the same document**, each
   marked in place. All four were caught by the same two checks, which is the durable lesson:
   **check provenance** (owner-set or tagger-set? which prompt version?) and **check the keyword**
   (does the regex actually match real garment names?). Two scripts now do exactly that.
3. `docs/panel-stage1-findings.md` — the panel synthesis organised for triage by ID. Section A is
   ruled; B, C, D, E are not.
4. `docs/expert-panel-brief.md` — ratified protocol. **Part 4b lists six ways the implementing
   agent got this wrong**; read it before assembling a packet.
5. **`docs/tagger-cost-spec.md`** — **draft, awaiting ratification.** Cost-first tagger spec:
   cold-start onboarding is the primary case ($12.18 for 200 garments today, target <=$3.50).
   Four phases, one billed step (~$2.70), decision rule written down. Read §2 first — it lists the
   prior rulings that constrain it.
6. `docs/board-feedback-desync-spec.md` — **implemented and live-verified 2026-07-27.** Read for
   the mechanism if touching board feedback again; not an open item anymore.
7. `docs/ui-v1-design-handoff.md` — rulings, plus **Outstanding issues 1–8**.

**Ten derivation/measurement scripts**, all read-only and free — none constructs an AI client:

| script | answers |
|---|---|
| `derive_surface_skeleton.js` | every surface, diffed against the surface map |
| `derive_engine_behaviours.js` | writes, retry loops, prompt splices |
| `measure_scoring_terms.js` | how often each scoring term fires on the real 236-piece wardrobe |
| `measure_gate_impact.js` | what the hard gate excludes per context, by reason |
| `measure_diversity_classifiers.js` | the repeat-detection buckets diversity penalises on |
| `measure_image_path.js` | image payloads, prompt sizes, tagger cost vs the preflight estimate |
| `measure_roles.js` | the role vocabulary behind formula-family classification |
| **`measure_plural_gap.js`** | **which keyword rules never fire because names are plural** |
| **`measure_provenance.js`** | **which columns are owner-set vs tagger-set** (`<colA> <colB>` cross-tabs) |
| `measure_open_questions.js` | re-derives the findings the map turned up |

Run them to check the maps have not rotted. **The last two are the ones that stop wrong fixes** —
provenance caught three bad recommendations, and the plural sweep showed that several measured
distributions in the map are understated. Run both before acting on anything keyword- or
column-derived.

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
- **`explorationMode: 'aggressive'` is unreachable — needs a decision.** Six trust-relaxation
  clauses in `autoStylingTrustDecision` key on `explorationMode === 'aggressive'`, and **no call
  site anywhere passes that string.** The only non-default value produced is `'adventurous'`
  (`routes/ai.js:2158`, the saved-outfit *adjacent* variant), which fails the equality check. The
  two strings have separate origins (`c307a9b` vs PR #36) and were never reconciled. So "adjacent"
  mode changes prompt text only — it does not surface experimental or needs-fit-review pieces.
  **Decision needed:** align the strings, or delete the dead branch. Depends on whether adjacent
  mode is *meant* to loosen trust.
- **The import cost gate under-quotes tagging by ~1.6×.** `routes/importer.js` prices bulk tagging
  at **6,000** input tokens per garment — but `TAG_PIECE_PROMPT` alone is **6,097 tokens** before a
  single image is attached, and the real payload is **~9,880** (text + a ~2,220-token photo +
  ~1,557 tokens of anchor thumbnails). The output figure (1,400 vs a 2,500 cap) is only wrong if
  the tagger emits near its cap — unverified without a billed call, so treat input as the solid
  number. This is the one place the app asks permission before spending, and the gap **widens as
  you correct more pieces**, because the calibration anchor block grows with your corrections.
- **`casual` blocks 108 of 236 pieces on the register ceiling — 52 are also tagged `casual`, and
  provenance settles it.** ~~Earlier I suggested letting an explicit `casual` occasion tag override
  the ceiling.~~ **Withdrawn.** Of those 52 pieces, **49 have owner-corrected `formality`** and only
  **5 have owner-corrected `occasions`** — so for 47 of them the conflicting `casual` tag is
  auto-tagger output, and the override would let the tagger overrule you. `formality` is the most
  curated field in the wardrobe (**202 of 236** pieces hand-corrected); `elevated` has not drifted.
  What's actually left is the **5 pieces you tagged both ways** — a five-row list.
  ~~Raising `casual`'s ceiling to `elevated` remains a separate taste call.~~ **Also withdrawn** —
  `docs/occasion_profiles_ratification.md` shows you **ratified `casual → everyday` on 2026-07-05**,
  with the consequence written down at the time: *"the largest behavior change… would make
  park-friend, coffee, errands, and low-key social rosters reject `elevated` and `dressy` pieces."*
  The 108-piece exclusion is the intended, documented result of a decision you already made. The
  only live question is whether a given piece's `formality` is right — a tagging question.
- **`extract-pieces` output is trusted more than the tagger's, on less evidence.** The
  "identify every garment in this outfit photo" endpoint shares the tagger's schema but sends **no
  calibration anchors, no photo-authority rules, no `style_profile_json`, and no `_confidence`
  map** — so `getFieldConfidence` defaults its fields to **`medium`**, while the real tagger
  self-reports **`low`** on ~85% of the same fields. It also has no salvage on parse failure, logs
  the entire raw model response to the server log on every call, and instructs a shoe-only
  `delicate|slim|chunky` fabric-weight scale that `fabricWeight()` cannot read (returns `null`).
  That last one is **latent, not live** — no such value is in the DB, so it is being dropped before
  persistence.
- **[bug] The singular/plural gap — six core garment keywords never fire at all.** The engine tests
  word-boundaried **singulars** (`/\bloafer\b/`) against garment names that are overwhelmingly
  **plural** ("black slip-on loafers"). Swept across all 512 keyword literals in `styling-engine/`:
  **19 keywords miss 122 garments by name**, and `jean`, `sneaker`, `loafer`, `clog`,
  `pointed heel`, `tailored trouser` and `linen short` match **zero** pieces — while being
  referenced at 16, 8, 25 and 4 sites. `boot` is used at **28 sites** and matches **one** garment;
  `shoe` matches one while 33 garments are named "…shoes".
  **This understates numbers I reported earlier**: the "93% of outfits are shoe-shape `rounded`"
  result is largely this bug — 8 of 33 shoes leave the default bucket once plurals match. Profiles
  are unaffected (their lists are already plural and go through `pieceMatchesFootwear`); this is
  confined to hard-coded regexes. **Do not apply a blanket `s?` sweep** — measured both ways, it
  fixes shoe shape (93%→53% in the default bucket) but makes grounding strategy *worse*
  (47%→80%), because the newly-matching plurals all fall into one branch. The fix has to be
  judged per classifier, and `heel_height`/`walk_support` already exist as enums for the footwear
  question. **Re-measure any keyword-derived number with `node scratch/measure_plural_gap.js`
  before acting on it.**
- **Do NOT re-tag yet — owner ruling 2026-07-26, and I had this backwards.** I originally wrote
  "re-tag first, then fix the prompt." **Withdrawn.** This wardrobe has been re-tagged multiple
  times already; each pass is only as good as the tagger on that day, and the **167 unversioned
  pieces are the residue of previous re-tags**, not evidence one is overdue. Order is: **raise the
  tagger's ceiling first, re-tag once after.** The ~$11 cost is not the constraint — spending it on
  a tagger with known gaps is.
- **What would raise the tagger's ceiling** (full detail in the map → *Provenance → what would
  raise the tagger's ceiling*), all found by this mapping:
  1. **Anchors cover 2 of the gating fields.** `tagPieceWithProvider` anchors only `formality` +
     `fabric_weight` → 18 anchors. Adding **`occasions`** would give **49**, using **38 owner
     corrections that already exist and are currently unused**. One-line change — but two caveats:
     `occasions` is an array so each combination becomes its own bucket (38 corrections → 31
     near-unique anchors, which may read as noise not range), and more anchors means more tokens on
     a call already under-quoted 1.6×. Measure before shipping.
  2. **`heel_height` (0 corrections) and `walk_support` (4) can't be anchored at all** — both feed
     the activity footwear gate, and `heel_height` is 100% tagger-set. The missing input there is
     your corrections, not prompt text.
  3. **Only 8 of 18 anchors get a thumbnail**, and which 8 is bucket-iteration order, not
     importance. Worth making deliberate before a whole-wardrobe run calibrates against them.
  4. **The singular/plural gap is upstream of tagging** — the tagger writes `name`/`reads_as` and
     every keyword rule reads them; re-tagging into an engine where `jean`/`loafer`/`sneaker` never
     match spends money feeding classifiers that can't see the result.
  5. **`extract-pieces` emits no `_confidence` map**, so pieces added that way default to `medium`
     trust and undermine any confidence baseline a re-tag establishes.

  **Prior rulings checked across `docs/` before finalising any of this** (map → *Provenance →
  prior rulings a tagger spec must respect*). The load-bearing ones: optimising the tagger is
  **already owner-sanctioned as possibly the better first move**, framed as paying off across
  *every import path*, with the video-import decision downstream of it; *"AI retagging reports what
  changed, leaves results reviewable, and cannot race Save"* is **ratified**, so capture-then-apply
  is that principle at batch scale rather than a new idea; **nothing is retagged automatically, by
  design**; **worn-photo scope is an OPEN product decision** a spec must not quietly settle; and
  **any field change costs 9 wiring points with "tagger prompts x2" first** — which settles the
  scope question, `extract-pieces` travels with `tag-piece`.

  Evidence that the current prompt *does* work when it runs: where the photo-authority section ran,
  low-confidence `length_hits_at` falls from **81% (191/236) to 42% (24/57)**. And this is not
  "missing worn photos" — **176 of 236 pieces have one**, including 144 of the 191 low-confidence
  ones. The photos exist; the older tagger never classified them.
- **A provenance section and script now exist** (`node scratch/measure_provenance.js`, plus
  `measure_provenance.js <colA> <colB>` to cross-tab two columns). `formality` is 86% hand-corrected;
  `heel_height`, `recommendation_status` and `role_permission` are **100% tagger-set**. The tagger
  reports `low` confidence on ~85% of its own structural predictions, and low confidence doesn't
  suppress the value — it ships to the image prompt tagged `[low confidence - add worn photo]`.
  **Run this before resolving any conflict between two columns**; it is what caught all three of
  the recommendations I had to withdraw.
- **The editorial image prompt has no length clause — and "wrong length" is the top render
  complaint.** `anchorFidelityInstructions` derives every fidelity rule from `name + notes`, so:
  `length_hits_at` is populated on **207 of 236** pieces and produces **no length instruction at
  all** (the builder has no such clause); `sleeve_type` is populated on 207 and reaches 48;
  `pattern_type` on 228 and reaches 17 (stripe only — no floral/botanical clause). **49 pieces
  produce no anchor fidelity instruction whatsoever.** Meanwhile the renderer memory that gets
  appended to these prompts is *live and full of length corrections* ("prior render had … rendered
  too long"). The wardrobe knows the length, the prompt never states it, the correction arrives
  afterwards as feedback. Same shape as the Visual Composer athletic-pants incident. The
  whole-wardrobe path is fine here — `buildPieceText` carries these columns — so this is an
  asymmetry between the two prompts, and the fix is to build the editorial description from the
  same truth text. Also in that builder: it reads `selectedPiece.fabric`, **a column that does not
  exist**, so that line never renders.
- **The whole-wardrobe image prompt truncates piece truth text at 900 chars; the real median is
  1,130** — 169 of 236 pieces lose their tail, and the fields at the end of the string are
  `fit_on_body`, tuck behavior, occasions and trust status.
- **Image cost reporting has a hole, and A6 now has a factual answer.** The `~$0.07` figures are
  computed **client-side** (`StylistChat.jsx:315`), re-hard-coding the token rates and adding a
  **flat constant** for the image — `$0.08` at 1024x1536, `$0.04` at 1024x1024 — regardless of
  quality, model, or how many attempts the server made. The server's pricing table has **no image
  model in it at all**. And the editorial **`gpt-image-1` fallback renderer never sets
  `timings.usage`**, so the cost line returns null and a *billed* generation displays no cost
  whatsoever. Collage renders correctly show nothing (they are free), which is why the gap is easy
  to miss. Two small fixes: set `timings.usage` on the fallback branch, and either move pricing
  server-side or relabel "Measured cost" to reflect that the image term is an estimate.
- **A failing editorial render can attempt five billed generations.** `gpt-4o`, then the
  `gpt-image-1 → gpt-image-1.5 → gpt-image-1-mini → chatgpt-image-latest` chain, then an SVG
  placeholder. The other four image producers fall back to a free local collage after one attempt.
  Also worth deleting: a duplicate `photoPreservingVisualsEnabled` in `rules.js` that **ignores
  `WARDROBE_MOCK_AI`** — `routes/ai.js` imports that copy (never calls it, so mock protection holds
  today, but the image endpoints live in exactly that file).
- **The engine's strongest positive signals have never been switched on.** `pieces.favorite` is
  **0 of 236** and `saved_boards.favorite` (the Visual Lab's **"Use strongly"**) is **0 of 237**.
  That disables four scoring terms, including the `+45` high-authority board branch — against `18`
  for an ordinary positive board — and makes the `favorite = 1` clauses in two memory queries
  select nothing. Both controls are fully built and wired (heart on every PieceCard;
  `VisualLab.jsx:967`). **Not a code defect** — but worth knowing before concluding the memory
  system is weak, and a cheap experiment: marking a handful of boards "Use strongly" turns on the
  largest positive signal the engine has.
- **A five-outfit set cannot avoid the −45 formula-repeat penalty.** There are exactly four formula
  families for separates outfits (five archetypes, one dress-only), and two hold 82% of real
  combinations — so by the third look the selector is choosing which repeat is cheapest, not
  whether to repeat. Related: the pattern classifiers regex over piece *names* and never read the
  populated `pattern_type` column, so **30 of 90 patterned pieces read as solid** (`botanical`,
  `geometric`, `paisley`, `polka dot`, `lace` have no matching term). Fixing that would also lower
  the text-matching ratchet count.
- **Two `planWorkbenchPieceScore` weights are provably decoration** — removing the
  `role_permission` +20 gives a byte-identical top-40; removing the `trusted` +50 moves one piece
  of 40. Tested, not inferred (`scratch/measure_open_questions.js` Q3). No action needed unless the
  weights are being tuned; then start with the four that actually order it.
- Smaller: the `All looks distinct` label branch unverified (not worth a billed call).
