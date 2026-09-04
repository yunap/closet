# Spec — trip composition is missing capsule's composition environment, not its intelligence

**Status:** Proposed 2026-09-04, not implemented. One design question open (§6) before build.
**Route:** [docs/README.md](README.md). Continues the facts-not-judgments doctrine established by
[model-facing-signal-inventory.md](model-facing-signal-inventory.md) and
[search-propose-signal-inventory.md](search-propose-signal-inventory.md); consumes the trip-roster
architecture landed across the `fix/plan-roster-thermal-evidence` arc (bench diversity, roster-level
cold-floor feasibility, the `assigned_layer_piece_ids` relation, season/shoe evidence, and the
capsule-visual-role evidence split — see that branch's commits for the incremental fixes this spec
does not re-litigate).

## 1. The question this answers

Live capsule output is noticeably more stylistically differentiated than live trip output,
including a Sonnet trip run against an 18-piece roster — a strictly bigger, richer roster than most
of the capsule runs it was compared against. Roster size and provider strength do not explain the
gap. **What is capsule composition being given that trip composition is not?**

## 2. Finding: they are not the same call

Capsule and trip composition are not two configurations of one call. They are architecturally
different mechanisms:

- **Capsule**: `composeCapsulePlanOnce()` (`routes/ai.js:4599`) — a dedicated, single-shot,
  schema-enforced provider call, invoked *from inside* `plan_outfit_set` itself, before any card
  reaches the conversational turn. "Enforced capsules are composed atomically inside this tool from
  their fixed roster and return finished cards" (existing code comment, `routes/ai.js`).
- **Trip**: no equivalent exists. `plan_outfit_set` returns slot rosters, and the **general
  conversational stylist** — the same `stylist_tool_loop` that also handles `search_wardrobe`,
  `propose_outfit`, pushback, anchor-piece requests, and every other flow — composes the cards
  itself and calls `submit_plan_outfits`, as an ordinary tool-loop iteration.

Every difference below follows from that one structural fact, not from a prompt-wording gap.

## 3. The three deltas, with evidence

### 3.1 Images

Capsule attaches **every roster piece's photo, unconditionally**, at `maxPx: 800, detail: 'auto'` —
not filtered through `pieceVisualDetailPolicy` at all, so it isn't even gated by the pattern/texture
heuristic used elsewhere. The prompt states why: *"Judge silhouette, volume, texture, and physical
layering by sight."*

Trip attaches **zero images automatically**. The only way a trip-composing turn ever sees a photo is
if the model spends a `view_pieces` tool call on it — optional, model-initiated, and frequently
skipped. Confirmed directly from raw provider captures this session: multiple real trip threads
(e.g. `thread_1788508369689`) composed and submitted every card with zero `view_pieces` calls —
the model never saw a single photo of what it assembled.

### 3.2 Garment truth

Capsule composition reads the **full** `buildPieceText` truth catalog. Existing code comment states
why explicitly: *"Full garment truth is intentional here. The ordinary workbench's compact line
omits garment-intelligence pairing requirements and do-not-pair rules; that omission allowed a
relaxed hoodie under a relaxed cardigan even though both records explicitly prohibit another loose
top."*

Trip composition reads the **compact** `planWorkbenchPieceLine` form always — no pairing
requirements, no do-not-pair rules, no style notes/risk text. Same wardrobe, strictly less evidence
per piece.

### 3.3 Prompt environment

Capsule's `capsulePlanCompositionSystemPrompt()` is ~20 lines: compose this fixed roster now,
demonstrate every piece's job, plus the style constitution immediately adjacent. Nothing else is in
the prompt.

Trip composition runs inside `stylistSystemTemplate` — the same ~5,000-word general-purpose system
prompt used for every `/ask` flow the app has: `search_wardrobe`, anchor-piece recomposition,
pushback handling, destination clarification, capsule intake, dozens of worked examples. The style
constitution is present in both prompts (`BODY_CONTRACT`/`PROVEN_FORMULAS`/`AESTHETIC_GRAVITY`/
`LANE_NEUTRALITY`/`WORKING_STYLE`) — this is **not** a content gap. It is a delivery gap: the same
guidance, competing for attention with unrelated instruction, at the exact moment the model needs
to be focused on composing from a fixed roster.

### 3.4 What is *not* a delta

`preferred`/`workable`/`discouraged`, thermal demand labels, and season verdicts are **diagnostics
only**, present in neither path's actual model contract — confirmed by the existing test
`'no thermal or season verdict crosses into the model contract'`. Those columns, wherever they
appear in review tooling (including this branch's own `scratch/capture_thread_for_review.mjs`
output), describe what the *engine* computed for a human reviewer's benefit, not evidence the model
saw or a verdict it overrode. Do not read a "discouraged" placement in a delivered card as the model
ignoring guidance — that column was never sent to it. This closes that line of investigation from
earlier in the arc; it is not an open question for this spec.

## 4. Non-goals

- **Not "reuse capsule composition."** Capsule composition proves a seasonal wardrobe system: fixed
  budget, palette contract, category-shape reasoning, rotation-demonstrates-every-job framing. Trip
  composition packs a compact suitcase against an itinerary, weather, and activity requirements —
  no palette contract, no fixed piece budget, no "every piece must prove its job" framing (a trip
  roster's `assigned_layer_piece_ids` relation, landed this arc, already depends on trip cards being
  *representative*, not exhaustive, of the packed roster). The target below reuses the
  **infrastructure** (image attachment, full truth catalog, a dedicated single-purpose system
  prompt, schema-enforced completeness) with a trip-specific **objective**.
- **Not a roster-selection change.** The bench, `tripRosterFailures`, `assigned_layer_piece_ids`,
  and everything upstream of composition are out of scope — this spec starts from "a fixed trip
  roster already exists" and ends at "cards enter the existing `submit_plan_outfits` validator,"
  unchanged.
- **Not a provider-capability investigation.** This finding supersedes that framing for trip
  composition specifically: until the environment is at parity, provider comparisons on this path
  are comparing composition quality under materially different evidence conditions, not model
  quality.
- **Not another round of prompt nudging.** The three deltas in §3 are structural (call boundary,
  image attachment, catalog function called), not instruction wording. A wording fix inside the
  current `stylist_tool_loop` composition would leave all three deltas in place.

## 5. Target architecture

```text
trip roster selection                          (existing, unchanged)
  → fixed trip roster

dedicated trip composition call                 (new)
  → whole roster visible at once
  → full garment truth (buildPieceText, not planWorkbenchPieceLine)
  → automatic roster images (same unconditional attachment capsule uses)
  → trip-specific composition prompt (style constitution adjacent, no
    unrelated routing/search/pushback instructions competing for it;
    trip's own objective — itinerary/weather/activity coverage, reuse
    discipline, cold-floor/assigned-layer awareness — not capsule's
    palette/budget/rotation-demonstrates-every-job framing)
  → same slot/workbench constraints (occasion, activity, register,
    cold_layer_required, target_outfits — all already carried by the
    existing workbench, unchanged)
  → schema-enforced complete rotation                (existing
                                                        submit/validation
                                                        contract, unchanged)
```

The composition-time prompt should state the trip's actual objective in its own terms rather than
capsule's: cover every stated use case with a compact, reusable set of pieces against the resolved
weather/activity/cold-floor facts already computed for each slot; a shared packed layer may be
declared via `assigned_layer_piece_ids` rather than forced into every card's `piece_ids`. It should
NOT carry capsule's palette contract, category-shape reasoning, or "every piece must prove its job"
framing — none of which describes what a trip roster is for.

## 6. The one open design question

**Does trip composition stay inside the conversational stylist for follow-up flexibility, or does
only the *initial* plan become atomic, with later edits continuing through the existing tool loop?**

Owner's stated leaning: the latter. Initial composition deserves the same focused environment
capsule gets; a follow-up edit ("swap the hiking shoes," "I don't like the wrap dress for evening")
is a bounded, single-card operation that doesn't need the same whole-roster visual/textual context
an initial 6-card rotation does, and keeping edits in the tool loop preserves the conversational
flexibility (pushback handling, anchor-piece requests, mid-conversation constraint changes) that an
atomic call doesn't offer.

This needs an explicit ruling before implementation because it determines the call boundary: an
atomic-initial/tool-loop-edits split means the dedicated composition call only ever runs once per
plan (matching capsule's `composeCapsulePlanOnce` shape almost exactly, parameterized by objective),
while a fully-atomic design would need its own edit/expansion path analogous to capsule's
`/expand-capsule` endpoint. The former is the smaller, more precedented change and is what §5 above
assumes; recorded here as the leaning, not yet an owner ruling.

## 7. What already exists to build on

Nothing in this spec requires new lower-level primitives. Everything the dedicated call needs
already exists and is already exercised by capsule's own atomic path:

- `buildPieceText` (full truth catalog) — `styling-engine/rules.js`
- Unconditional thumbnail attachment at `maxPx: 800, detail: 'auto'` — pattern already implemented
  in `composeCapsulePlanOnce`, `routes/ai.js:4628-4645`
- `askStylistStructuredWithUsage` with a schema enforcing exact `target_outfits` totals — pattern
  already implemented via `capsulePlanCompositionSchema`
- The trip workbench's own slot/constraint shape (`cold_layer_required`, `target_outfits`,
  `allowed_piece_ids`, `assigned_layer_piece_ids` eligibility) — unchanged, already flows through
  `buildPlanSlotWorkbench` regardless of which call ultimately composes from it
- `submit_plan_outfits`'s existing validation contract — unchanged; a dedicated composition call
  still produces `outfits` that pass through the identical structural/environmental checks a
  tool-loop-composed trip currently does

The work is wiring a trip-specific sibling of `composeCapsulePlanOnce` — same shape, different
objective and prompt — not inventing new machinery.
