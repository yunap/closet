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
7. **New structure must earn its keep.** Before adding a new score, gate, cap, or narrated line,
   check: (1) free falsifiability — can it be checked wrong from a photo, a forecast, or the DB,
   without a paid model call? (2) speakable — can it be stated in one sentence the owner would
   accept as a reason? (3) decides, or only describes — a line nothing downstream reads is prompt
   text at best. (4) cheap false positives — reversible, low-cost when it fires wrongly? (5) the
   silence test — if it fires, is the owner ever told? A failure on (1), (4), or (5) is usually a
   missing surface (a view, an undo path, a narrated line) — fix it, don't delete the structure.
   A failure on (3) alone, with no deliberate soft-by-design reason behind it, means kill it. A
   structure that decides only softly *on purpose* (e.g. `owner_rule`, kept as prompt guidance
   after the #44 memory-pollution incident) is not a (3) failure — name that choice, don't conflate
   it with dead scaffolding. Applies to existing structure, not only new proposals — periodically
   run it against `docs/engine-behaviour-map.md`'s inventory of weights, gates, and caches. Full
   derivation and case studies: `docs/panel-stage1-findings.md` → C3.

## Documentation Rules

This app documents behaviour before coding it, so the docs are load-bearing: a session that reads
a stale map reaches a confident wrong answer and acts on it. Read `docs/README.md` first — it
routes a question to the doc that answers it.

- **Amend the matching doc in the same commit as the code.** Not "later", not a follow-up issue.
  The trigger is mechanical:

  | You changed | Amend, same commit |
  |---|---|
  | a gate, ceiling, score, cache or retry loop in `styling-engine/` | `docs/engine-behaviour-map.md` |
  | a feedback writer/reader, a store, or a store's authority | `docs/feedback-and-memory-map.md` **and** `scratch/feedback_surface_inventory.json` |
  | a route, tab, dialog or mode-split | `docs/app-surface-map.md` |
  | the model-call sequence of a flow | that flow's `docs/flows/*.md` |
  | a tool schema or prompt block used by `/ask` | `docs/freeform-rearchitecture-handoff.md` |

  Amendments stay **inline and dated**, as the existing ones do — the history of a decision is
  usually more useful than its current state. Precedent for why this is a rule: the
  owner-constraint gate "shipped with item 12 and had never been recorded here" (engine map's own
  words), and it is exactly the gate a later debugging session then missed.

- **Cite code by file and function name, never line number.** Line numbers rot silently — every
  reader citation in the feedback map's §4 had drifted ~100 lines while still looking
  authoritative. `npm test` warns when a cited function name no longer exists.

- **Never delete a doc — leave a tombstone.** Three lines naming what replaced it and when.
  References live outside this repo (agent memories, PRs, notes) and a rename cannot fix them.
  `docs/garment-memory-and-feedback-audit.md` was deleted on supersession and pointed at nothing
  for nine days.

- **A doc claim that cites a script must cite a *tracked* one.** `scratch/*` is gitignored with an
  allowlist; a claim backed by an untracked script cannot be reproduced from a clean checkout.
  Enforced by `npm test`.

- **`docs/specs/` is a historical archive, not an authority.** Authority order (owner ruling,
  2026-07-30): the code > ratified docs > the archive. Those specs span several generations of a
  repeatedly-redesigned app and their own `Status:` lines are frozen at authoring time — spec 29,
  32 and 33 all read "Proposed. Not implemented." and all shipped. A decision made from fresh
  evidence stands; *"an old spec decided otherwise" is an unverified claim, not a finding.*
  Every archived spec carries a banner saying so, enforced by `npm test`.

- `npm test` runs `scratch/check_docs_health.js`: broken repo-relative links, dangling `docs/*.md`
  references and missing spec banners are **errors**; missing status headers, stale function
  citations and untracked cited scripts are **ratcheted warnings** against
  `scratch/docs_health_baseline.json` — the count may only go down.

## Operational Rules

- **Mandatory UI expert panel.** Before materially redesigning a user-facing page or component,
  convene a panel. The standing brief — shared app context, the two panel modes (craft review vs.
  direction review), role definitions, evidence rules, and the output contract — lives in
  `docs/expert-panel-brief.md`. Read it, and the prior rulings in `docs/ui-v1-design-handoff.md`,
  before convening. Non-negotiables: fashion-product review is required, not optional; every
  reviewer gets the shared app context, not just the screen; stored-data surfaces get freshly
  generated data or are excluded; the prior-rulings exclusion list is copied verbatim, never
  paraphrased; bugs and typos are not a panel's job. The implementing agent synthesizes areas of
  agreement, reports genuine disagreements to Yuna, and does not describe a visual decision as
  ratified until Yuna has reviewed the result.
- **Consult before behavior fixes.** When debugging a user-reported styling or product behavior,
  diagnose first and report the suspected root cause before changing code. Do not rush into
  speculative fixes, especially changes to ratified styling/register/weather/activity behavior, without
  confirming the intended behavior with Yuna. If a live repro appears to contradict a prior
  ratification, ask before changing the ratified rule.
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
- Keep diffs small and reviewable; one concern per commit; new features additive behind their own routes/flags rather than modifying working flows in place.
- **Prompt-Layer Style Constitution constraints**: All style/taste claims and constraints in system prompts must interpolate the ratified Style Constitution layers exported from [prompts.js](file:///Users/yuna/Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/styling-engine/prompts.js) (`BODY_CONTRACT`, `PROVEN_FORMULAS`, `AESTHETIC_GRAVITY`, `LANE_NEUTRALITY`, `WORKING_STYLE`). Models and agents must not invent style preferences, signature colors, or unratified drift labels. Style lanes are open and never gatekept. The [check_style_claims.js](file:///Users/yuna/Documents/Codex/2026-05-16/repo-yunap-closet-branch-fix-stylist/scratch/check_style_claims.js) script automatically guards against regression of unauthorized taste terms.
- **CLI Script Safety**: Any script that runs batch calls or executes third-party LLM/image-generation APIs must implement a `--dry-run` or `--preview` mode that short-circuits *before* initiating any paid API network requests. The dry run must only validate inputs, display the targeted scope, and estimate potential costs without consuming active billing tokens.
- **Form State Mapping Discipline**: When adding, modifying, or refactoring fields in garment metadata, the agent must ensure the field is fully wired up across all four layers of the React lifecycle:
  1. Component state initialization constructors (e.g. `useState` defaults matching database types).
  2. The `handleSubmit` payload serialization.
  3. The `setForm` callback handlers that merge incoming AI tagging API responses.
  4. The DOM elements rendering the toggles/chips.
- **Mandatory E2E Handoff Verification**: Before declaring a UI or form state change complete, the agent must perform a manual E2E check: load an existing item, verify pre-populated toggles, trigger AI Retag to verify real-time visual updates, click Save, and query the local SQLite database to confirm the changes and overrides are persisted cleanly.
