# Wardrobe App ("Closet") — Agent Instructions

Product and engineering principles for contributors and coding agents. They guide decisions —
do not repeat them verbatim in user-facing AI responses. Precedence: task-specific user
instructions > existing code patterns > this file. Detailed engine rules live in
`.agent/rules/styling-engine.md`; long-form rationale lives in `docs/`.

## Project Shape

- Frontend: React 18 + Vite (`src/`), vanilla CSS
- Backend: Express (`server.js` is bootstrap-only; routes in `routes/`), SQLite via
  better-sqlite3 (`db.js`), Sharp for local image processing
- AI: `styling-engine/` — `attributes.js` (garment attribute readers — the ONLY place garment
  text is interpreted), `rules.js` (deterministic scoring/filters), `core.js` (composition,
  formatting, rendering pipelines), `prompts.js` (all system prompts), `provider.js`
  (Anthropic/OpenAI abstraction + tool loop), `tools.js` (agent tool schemas)
- Verification: `test/` (run via `npm test`, includes the text-matching ratchet),
  `scratch/` (diagnostics, A/B diff harness, backfill scripts)

## Product Goal

Build an AI stylist focused on lived personal style rather than trend optimization.

Optimize for: artistic individuality, operational ease, realistic wearability, silhouette
intelligence, emotional coherence, grounded femininity when relevant, integrated garment
structure, low-maintenance dressing.

Avoid optimizing toward: generic minimalism, influencer styling, excessive layering,
editorial-only solutions, novelty without quality, random trend injection. Do not force every
outfit into artistic minimalism.

## Styling Principles

Evaluate outfits as lived systems rather than static images. Important concepts: productive
tension vs incoherent competition; hero / support / grounding garments; operational complexity
and maintenance burden matter; realistic movement matters; "different" does not equal "better".
Hierarchy means one element leads — not that only one element may be expressive. Multiple
expressive pieces sharing a register are richness; the failure mode is competition for the
same job. Pattern discipline (one loud print per outfit) is a separate, stricter rule.

Outfit generation modes — Similar Variants: preserve style DNA, maintenance level, silhouette
logic, emotional tone (same person, different day). Creative Alternatives: allow silhouette
experimentation and larger aesthetic shifts; maintain styling quality; novelty alone is
insufficient.

Quality bar — prefer proportion intelligence, restraint, coherent visual hierarchy,
emotionally believable styling. Reject catalog drift, costume drift, over-styling, weak
grounding, generic safe solutions.

## Engineering Principles

1. **The negation test.** Adding `&& !X` to an existing condition is a special case — redesign
   it as an independent rule or an attribute read. Special cases compound; if a plan contains
   more than one new negation, stop and propose the general rule.
2. **Structured data over text inference.** Garment semantics come from structured fields
   (`reads_as`, `fabric_weight`, `pattern_complexity`, `bottom_kind`, `style_profile_json`).
   Text matching is a fallback for missing data only — word-boundary regex, never substring
   `.includes()`, always tagged `// TODO: backfill <field>`. When a bug traces to text
   inference, prefer backfilling metadata over improving the regex. (History: `textu-red`
   matched "red"; "Pencil jeans" matched pencil-skirt rules; "minimal" matched "mini".)
3. **Code constrains, the model judges.** Deterministic code enforces hard constraints from
   structured data (suppression, occasion validity, weather physics, ID validation). The LLM
   performs aesthetic judgment. A keyword rule that encodes taste is in the wrong layer.
4. **Hard filters vs. soft scores.** Validity constraints filter the candidate pool before
   scoring; preferences adjust scores. Never express validity as a large penalty, never
   hard-filter a preference.
5. **Symmetry and observability.** Context-conditional logic gets both sides (boost the
   appropriate, penalize the inappropriate) in one block with magnitudes visible side by side.
   Every score adjustment pushes a human-readable reason string; the debug payload is the
   contract that makes tuning possible.
6. **Additive, provable no-ops.** New context dimensions (weather, formality, ...) must be
   no-ops when their context is absent — provable by diffing rankings with the context empty.
   Prefer additive changes; do not refactor unrelated rules in the same change.

## Operational Rules

- Run `npm test` before every commit. It includes the text-matching ratchet
  (`scratch/check_text_matching_ratchet.js`); the baseline only tightens. Never weaken or skip
  a test to make a change pass — a failing acceptance test is a finding, not an obstacle.
- Any change to scoring or attribute classification requires re-running
  `scratch/rankings_ab_diff.js` against the recorded baseline commit and filling every
  `EXPLAINED BY` stub. Every ranking difference must be attributed to an intentional change;
  an unexplained diff is a bug.
- Acceptance criteria become permanent tests (e.g. `test/hot_weather_ranking.test.js`), so the
  next refactor cannot silently regress them.
- Garment-specific judgment is data, not code: if a rule would mention a specific garment,
  write it to that piece's metadata (`reads_as`, `styling_rules_learned`) instead. No piece
  names or IDs in engine code.
- Diagnose before changing: when classification looks wrong, extend/run the diagnostics in
  `scratch/` and let the printed distributions choose the fix (data fix vs. code fix).
- Unit/contract tests run offline and deterministic — no LLM calls; same inputs, same outputs.
- Be cost-conscious with generation: preview-before-render patterns, log `response.usage`
  where available, print cost estimates and require explicit confirmation before batch API
  runs (e.g. vision re-tagging the whole wardrobe).
- Keep diffs small and reviewable; one concern per commit; new features additive behind their
  own routes/flags rather than modifying working flows in place.
