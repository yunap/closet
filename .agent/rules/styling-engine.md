# Rules: styling-engine/

Scope: changes under `styling-engine/` and scoring-related code in `routes/ai.js`.
These extend the Engineering Principles in `AGENTS.md` with engine-specific mechanics.

## Attribute layer authority

- `attributes.js` is the ONLY file that may interpret garment text. Everything else consumes
  its typed readers (`fabricWeight`, `bottomKind`, `colorFamily`, `patternLoudness`,
  `groundingLevel`, `pieceSoftness`, `garmentKind`, ...). Adding `textIncludesAny` /
  `.includes()` / name-regex outside `attributes.js` fails the ratchet — do not try to work
  around it; add or extend a reader instead.
- Readers return enums or numbers, not clusters of booleans. Mutually exclusive states are one
  function returning one value (`bottomKind() -> 'pants'|'shorts'|'skirt-mini'|...`), which
  structurally prevents `isX && !isY && !isZ` chains.
- Reader priority: structured DB field → `style_profile_json` → word-boundary text fallback
  with `// TODO: backfill <field>`. A new attribute need = a new reader, never an inline match.
- Keyword vocabularies (color families, delicacy signals, fabric weights) are defined ONCE in
  `attributes.js`. Do not re-declare keyword lists anywhere else.
- When a reader's output looks wrong for a specific garment, fix that piece's metadata in the
  DB, not the reader — unless the diagnostic distributions show the reader is wrong in general.

## Scoring rules (`rules.js`)

- Every score adjustment pushes a reason string. A term that doesn't explain itself in
  `reasons` doesn't ship.
- Selectivity check for new bonuses/penalties: if a "discriminating" term fires for the large
  majority of candidates, it's a constant offset plus a punishment for the remainder —
  rethink the gate. Print firing rates in a `scratch/` diagnostic when in doubt.
- Context terms (weather, occasion mood, future dimensions) are single self-contained blocks,
  symmetric (both boost and penalty sides, mirrored for the opposite context), and provable
  no-ops when the context is absent.
- Magnitudes matter relative to each other: before adding/raising a term, check which existing
  terms it must outweigh or must not drown (e.g. weather terms vs. the ±14/−12 anchor swing).
  State the intended ordering in the PR.
- Validity belongs in pool filters (suppression, weather physics, roster building), not in
  large penalties. Preferences belong in scores, not filters.
- Occasion-profile prohibitions are validity-only; anything debatable is a discouraged/preferred soft signal. New entries are [proposed] until Yuna ratifies.
- occasions.js is frozen — do not add profiles or extend its lists except by Yuna's ratification; prefer piece-level metadata and the exclusion feature for occasion corrections.


## Prompts and providers

- All system prompts and prompt fragments live in `prompts.js` as named exports — no inline prompt strings in routes or core pipelines.
- **Style Constitution constraints**: All system prompts must quote or reference the ratified Style Constitution layers exported from `prompts.js` (`BODY_CONTRACT`, `PROVEN_FORMULAS`, `AESTHETIC_GRAVITY`, `LANE_NEUTRALITY`, `WORKING_STYLE`). Models/agents must not invent style preferences, signature colors, or unratified drift labels. Style lanes are open and never gatekept. The `check_style_claims.js` script automatically guards against regression of unauthorized taste terms.
- The model is never asked to honor constraints that code can enforce (ID validity, suppressed pieces, image budgets): enforce structurally, instruct only for judgment. Soft "do not use X" prompt guards are a last resort, not a design.
- Garment images for composition go at high/auto detail. Low detail strips the texture, weave, drape, and construction cues the composer depends on; do not lower it for cost without an explicit product decision.
- Mandatory output slots create improvisation: if an element becomes optional (shoes, accessories), update the prompt's composition rules AND the validation/repair layer AND the renderer expectations together.
- Provider limits are guarded in code (Claude: max 100 images/request; budget rosters to ≤90). A request must never be able to fail on a provider limit that was knowable beforehand.

## Verification workflow for engine changes

1. Diagnose with a `scratch/` script; paste distributions into the walkthrough.
2. Implement at the layer the data indicates (data fix vs. attributes.js vs. rules.js).
3. Re-run `scratch/rankings_ab_diff.js` against the recorded baseline commit hash; fill every
   `EXPLAINED BY` stub; new diffs in previously-stable scenarios are explained, not suppressed.
4. `npm test` (includes ratchet). If counts dropped, tighten `scratch/ratchet_baseline.json`.
5. Acceptance criteria from the task become permanent tests in `test/`.
