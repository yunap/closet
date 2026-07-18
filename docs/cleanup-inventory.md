# Cleanup inventory (spec 20)

**Status:** Complete for the seeded scope; a full line-by-line pass of `rules.js`, `core.js`, `attributes.js`, `occasions.js`, `weather.js`, `taggerMerge.js`, `softScoreFloors.js`, and `routes/crud.js` was **not** performed this round (see "Scope note" at the end). Everything below is verified by reading the actual call path, not grep-count, per the spec's hard rule.

**Baseline used:** originally `origin/main` @ `ce2adc5` — "Spec 14: retire the taste-scorer layer of outfitSetPlanner.js (#106)", merged 2026-07-16. **Re-verified 2026-07-17 against `origin/main` @ `1c9ce67`** (specs 22, 23, 24, 25, 26, 27 plus four UI-only PRs landed in between). **All findings and dispositions below still hold** — re-checked each one directly against current code, not assumed:

- The deleted scorer/pre-route/diagnostics family (census 1 & 3) was not reintroduced by any of the six new specs — confirmed zero hits for `tripSlotFitScore`, `composeOutfitSet` (as code, not comment), `isOfficePlanSlot`, `maybePrecomposeUseCasesForAsk`, `shouldEngageAskPrecompose`, `planFreeformUseCases`, `classifyPlanPath`, `recordPlanPathDiagnostics`, `WARDROBE_PLAN_PREROUTE`, `WARDROBE_PLAN_COMPOSE` across `outfitSetPlanner.js`/`tools.js`/`routes/ai.js`.
- All four still-open findings are unchanged in current code: the dead `tripRequestNeedsScopeClarification` import (`routes/ai.js`), the 23-line dead `WARDROBE_PLAN_COMPOSE` test scaffolding (`test/plan_outfit_set.test.js`), the four DB-unisolated test files (`occasion_exclusion`, `hot_weather_ranking`, `freeform_observability`, `visual_composer_roster`), and the still-unresolved `parseStructuredOutfitsFromAssistantText` ambiguity (same regex gate, same stale-format comment in `provider.js`, unchanged) — none have been touched or fixed by the intervening specs.
- `scratch/diagnose_anchor_selectivity.js` is still tracked and still referenced nowhere.
- `npm test` re-run fresh against current code: **577/577 pass, 0 fail** (up from 517 — specs 22-27 added real test coverage). Ratchet: still fully green (`outfitSetPlanner.js` still 0/7, `tools.js` still 0/10 — no new text-matching debt from the new specs).
- New, not audited by this inventory (out of scope, flagged for awareness only): `outfitSetPlanner.js` grew from 1451 to 1679 lines with legitimate new exports (`mergePendingPlanForReplan` — spec 23, `reasonRevisesMidSentence`/`REASON_REVISION_MESSAGE` — spec 26, `printedMainPieceIds`/`printPairingSightIssue` — spec 27), and two new diagnostics counters appeared (`proposeReasonRevisionBlocks`, `proposeUnseenPrintPairingBlocks`). These are new live features from specs 26/27, not carried-forward dead weight — they'd need their own reachability check only if a future cleanup pass wants to extend census 1/3's coverage forward in time.
- **Spec 22** (the Anthropic tagger `detail`-field 400 hotfix) merged as PR #110 in this same window — unrelated to this inventory's scope, but noted since it was flagged as unimplemented in an earlier check this session.

Original 2026-07-16 pass details below, unedited except for this note.

Practical effect on this inventory: most of what spec 14's own proposal doc marked "delete in spec 21" **is already deleted**. What's left is thinner — vestigial flags/imports/test-scaffolding that spec 14's deletion made unreachable as a side effect, plus the pre-existing items spec 14 never touched (the tripScope clause, the destination clause, `parseStructuredOutfitsFromAssistantText`, scratch/ hygiene).

---

## Census 1 — export/function reachability

Scope actually walked: `styling-engine/outfitSetPlanner.js`, `styling-engine/tools.js`, `styling-engine/provider.js`, `routes/ai.js` (precompose/flag surface), `src/components/StylistChat.jsx` (the one named seed). Entry points used: `server.js` route registrations → `routes/ai.js` `/api/ai/ask` → `styling-engine/provider.js`'s tool loop → `executeTool`'s switch in `styling-engine/tools.js`.

| Symbol | File:Line | Classification | Evidence | Notes |
|---|---|---|---|---|
| `tripSlotFitScore` + family (`tripOutfitDinnerRegisterScore`, `tripOutfitOfficeRegisterScore`, `tripOutfitSmartCasualRegisterScore`, `tripOutfitRegisterEscalationScore`, `tripOutfitBeachCoastalScore`, `tripOutfitElevatedOccasionShoeScore`, `tripOutfitAestheticGravityScore`, `tripShoeSeasonScore`, `tripPieceFabricBreathabilityScore`, `tripPieceWalkabilityScore`, `tripDaytimeBottomScore`, `tripPieceIsDelicateForDay`) | — | **DELETED** (confirmed gone) | `git show ce2adc5 --stat` (outfitSetPlanner.js 2756→1451 lines); repo-wide grep for every name returns zero matches | Spec 14 executed. Not present to classify — historical only. |
| `isOfficePlanSlot`, `isClientPlanSlot`, `isOutdoorActivePlanSlot`, `isBeachCoastalPlanSlot`, `chooseEveningLayerForOutfit`, `chooseBeachCoastalLayerForOutfit`, `withEveningLayerIfUseful`, `withBeachCoastalLayerIfUseful`, `beachCoastalNeedsLayer`, `tripStructuredValueSet`, `tripPieceHasStructuredValue`, `tripShoeMatchesAny`, `buildCapsuleStructuralSeparateOutfits`, `composeOutfitSet` | — | **DELETED** (confirmed gone) | Same as above; `composeOutfitSet` repo-wide grep hits only comments in `outfitSetPlanner.js:12` and three test-file comments (`test/plan_outfit_set.test.js`, `test/hot_weather_ranking.test.js`, `test/spec9_advisor_mode_precompose_fallbacks.test.js`) — not live code | `tripStructuredValueSet`'s two real keeper-side call sites were rewritten to read tags directly per the handoff doc's spec-14 section. |
| `isSmartCasualPlanSlot`, `textLooksLikeEveningPlanSlot`, `textLooksLikeCoastalPlanSlot`, `isIndoorPlanSlot`, `normalizePlanSlotEnvironment`, `normalizePlanEnvironment`, `normalizePlanSlotOccasion`, `slotWantsElevatedShoe`, `beachCoastalStatedWeather`, `normalizeRegisterLevel`, `inferPlanSlotActivity`, `hasDeclaredPlanSlotActivity`, `inferPlanSlotActivityFromProse` | `styling-engine/outfitSetPlanner.js` (various, 263–433) | **LIVE** | Called from `normalizePlanSlots` (outfitSetPlanner.js:1353), which `tools.js:9` imports and the `plan_outfit_set` handler (`tools.js:1387`) calls every turn | Spec 14's own commit message calls this out as an "audit surprise" — the spec's draft expected these deleted, but they're load-bearing for slot normalization. Confirms these were reclassified correctly during the real deletion, not left dead by accident. |
| `normalizeTripPieceName`, `normalizePlanConstraints`, `selectCapsuleRoster`, `describeOutfitStructureGap`, `validateSlotOutfitConstraints` | `styling-engine/outfitSetPlanner.js` (exported, also called internally) | **LIVE** | Called inside `buildPlanSlotWorkbench` (outfitSetPlanner.js:997), which `tools.js` imports and calls at `tools.js:1456` per `plan_outfit_set` turn | Exported AND internally consumed — reachable both ways. |
| `buildPlanSlotWorkbench`, `validateSubmittedPlanOutfits`, `assembleSubmittedPlanOutfits`, `normalizePlanSlots`, `planTotalOutfitCapForBudget`, `PLAN_TOTAL_OUTFIT_CAP` | `styling-engine/outfitSetPlanner.js` | **LIVE** | Directly imported by `styling-engine/tools.js:9-15` and called in the `plan_outfit_set`/`submit_plan_outfits` handlers | The engine's real, generalizing surface — matches spec 14's own "Keep" list. |
| `maybePrecomposeUseCasesForAsk` / `maybePrecomposeStructuredOutfitsForAsk`, `maybePrecomposeStructuredFollowupForAsk`, `shouldEngageAskPrecompose`, `planPrerouteEnabled`, `followupPrerouteEnabled`, `isBroadOutfitPlanningText`, `structuredOutfitContextText`, `planFreeformUseCases`, `USE_CASE_PLANNER_SYSTEM`, `normalizePlannerSlots`, `normalizePlannerTripSummary`, `tripCitySlotImpliesWalking` | — | **DELETED** (confirmed gone) | Repo-wide grep for every name: zero matches. `git show ce2adc5` commit body explicitly lists all of these as deleted from `routes/ai.js` | The "Remaining work" item from `docs/freeform-rearchitecture-handoff.md` ("Deletion candidates once evidence accumulates... `USE_CASE_PLANNER_SYSTEM`, `planFreeformUseCases`, both `maybePrecompose*` functions") is **resolved** — this is the same item, now done. |
| `classifyPlanPath`, `classifyFollowupPath`, `recordPlanPathDiagnostics`, `planComposeMode` | — | **DELETED** (confirmed gone) | Repo-wide grep: zero matches in `styling-engine/tools.js` or anywhere else | These existed solely to gather pre-route retirement evidence; the retirement is now permanent, so the evidence machinery was deleted with it. See census 3. |
| `tripRequestNeedsScopeClarification` | `styling-engine/stylingIntent.js:97` | **FLAG-ONLY**, off by default | Called from `styling-engine/provider.js:177`, gated by `tripScopeClarificationEnabled()` (provider.js:36-37, reads `WARDROBE_TRIP_SCOPE_CLARIFICATION === 'on'`) | Unaffected by spec 14 (provider.js diff for spec 14 was a 2-line comment fix only). tripScope retirement was DONE in spec 18 Part 2 per the handoff doc — this is the enforcement clause staying flag-preserved, not dead. |
| import of `tripRequestNeedsScopeClarification` in `routes/ai.js:55` | `routes/ai.js:55` | **DEAD IMPORT** | `grep -c "tripRequestNeedsScopeClarification" routes/ai.js` → 1 (the import line only); real call site is `provider.js:177`, not `routes/ai.js` | Minor: an unused import, likely a leftover from when routes/ai.js's own precompose logic (now deleted) referenced it directly. Harmless, but a genuine dead-code line. |
| `parseStructuredOutfitsFromAssistantText` | `src/components/StylistChat.jsx:1321` | **LIVE call path, functionally inert** | Call site at `StylistChat.jsx:3913` fires whenever `replyStructuredOutfits` is empty and (`replyConversationMode === 'new_request'` or `OUTFIT_CARD_RESPONSE_PATTERN.test(q)`) — a real, frequently-hit condition. But the function's own hard gate (`StylistChat.jsx:1323`: `if (!/###\s+...Outfit\b/i.test(raw)) return []`) requires a `### Outfit N` / `**Pieces**:` prose format that `STYLIST_SYSTEM` has explicitly instructed the model NOT to produce since the `propose_outfit` migration — confirmed via `styling-engine/provider.js:108-121`'s own comment ("that fallback silently never fires against current prose. There is no reliable local reconstruction path anymore.") | **Ambiguous — owner ruling needed.** Not DEAD by the letter (call path exists, function is reachable, would produce a real return value if the format ever appeared), but the codebase's own contemporaneous comment says it can't match current output. Two ways to resolve: (a) delete it and simplify the `3911-3914` empty-check to skip straight to whatever the "no outfits" fallback is, or (b) leave it as a defensive net in case the model ever regresses to old-style prose. This is exactly the spec-20 "ambiguous row is a question, not a deletion" case — flagged, not resolved here. |

---

## Census 2 — env-flag census

| Flag | Default | Gates | Read sites | Evidence status | Evidence pointer |
|---|---|---|---|---|---|
| `WARDROBE_PLAN_PREROUTE` | n/a — **no longer read anywhere** | Used to gate the broad-planning/travel keyword pre-route | none (repo-wide grep: zero production reads; only appears in a `docs/` retrospective sentence) | **retired with evidence, now fully dead** (do-nothing flag) | `docs/freeform-rearchitecture-handoff.md` spec-14 section: "`WARDROBE_PLAN_PREROUTE`, `WARDROBE_BROAD_PLAN_PREROUTE`, and `WARDROBE_FOLLOWUP_PREROUTE` no longer do anything (left in any local `.env` files harmlessly)." |
| `WARDROBE_BROAD_PLAN_PREROUTE` (legacy alias) | n/a — no longer read | Same as above | none | **retired with evidence, now fully dead** | Same pointer as above |
| `WARDROBE_FOLLOWUP_PREROUTE` | n/a — no longer read | Used to gate the follow-up replan pre-route | none | **retired with evidence, now fully dead** | Same pointer as above |
| `WARDROBE_PLAN_COMPOSE` | n/a — **no longer read by production code** | Used to switch `plan_outfit_set` between `'engine'` (deterministic `composeOutfitSet`) and `'model'` (workbench) composition | **zero production reads** (confirmed: `grep -n "PLAN_COMPOSE" styling-engine/tools.js` → no output). Still referenced 23× in `test/plan_outfit_set.test.js` as save/restore ceremony around tests whose outcome no longer depends on it (only `'model'`-mode assertions remain; the `'engine'`-mode branch it used to select is gone) | **retired with evidence, now fully dead in production; vestigial in tests** | `docs/freeform-rearchitecture-handoff.md` spec-14 section: "the `plan_outfit_set` handler's engine-mode branch (`WARDROBE_PLAN_COMPOSE=engine` no longer restores anything — it always returns the model-mode workbench now)" |
| `WARDROBE_TRIP_SCOPE_CLARIFICATION` | unset → off (`=on` restores) | Whether `tripRequestNeedsScopeClarification`'s output is enforced in `applyFreeformOutputChecks` | `styling-engine/provider.js:37` | **retired with evidence (dated, spec 18 Part 2)** — untouched by spec 14 | `docs/freeform-rearchitecture-handoff.md` lines ~159-170: "tripScope — DONE (2026-07-15, spec 18 Part 2), evidence-backed" |
| `PHOTO_PRESERVING_VISUALS` | unset → `'false'` | Whether AI visual renders are skipped for local photo-preserving collages | `styling-engine/core.js:1825`, `styling-engine/rules.js:3796` | **live config** | Actively branches render behavior; used deliberately in test setup (`test/aiEndpointContracts.test.js`) |
| `AI_PROVIDER` | unset → `'anthropic'` | Anthropic vs OpenAI provider selection | `styling-engine/provider.js:281` | **live config** | Core provider switch |
| `ANTHROPIC_STYLIST_MODEL` / `OPENAI_STYLIST_MODEL` | model-specific defaults | Model ID override per provider | `provider.js:282-283` | **live config** | — |
| `AI_INPUT_USD_PER_MTOK` and 4 sibling pricing overrides | unset → built-in pricing table | Cost-accounting override | `provider.js:303-308` | **live config** | Ops/cost-accounting knob |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IDENTITY_IMAGE_SIZE`, `OPENAI_EDITORIAL_IMAGE_SIZE`, `OPENAI_IMAGE_SIZE` | model/size defaults | AI-rendered visual generation params | `core.js:1454,1468,1469` | **live config** | — |
| `WARDROBE_DB_PATH` | unset → `'wardrobe.db'` (repo-root relative) | Which SQLite file the app opens | `db.js:12` | **live config** | Overridden per-test-file for isolation; see census 4 for tests that fail to override it |
| `WARDROBE_UPLOADS_DIR` | unset → `<repo>/uploads` | Garment photo storage directory | `db.js:9` | **live config** | — |
| `WARDROBE_MANIFEST_MAX_PIECES` | unset → `400` | Piece-count cap for the whole-closet prompt manifest | `core.js:3713` | **live config** | Production tuning knob |
| `WARDROBE_TEST_MAX_WHOLE_WARDROBE_CANDIDATES` / `WARDROBE_TEST_MAX_WHOLE_WARDROBE_REVIEW_CANDIDATES` | unset → no override (only read when `NODE_ENV==='test'`) | Test-only candidate-pool size overrides | `rules.js:3538`, `core.js:1404` | **live config (test harness knob)** | — |
| `STYLIST_CRITIC_DISABLED` | unset → critic runs | Kill-switch for the post-generation critic pass | `core.js:438,469` | **live config, unused by any test** | Not `WARDROBE_*`-prefixed but same class of flag; no retirement evidence exists because it's never been a candidate — genuinely a live ops kill-switch. Flagging only because no test exercises the disabled path — an untested flag, not a dead one. |

---

## Census 3 — diagnostics-counter census

**Whole families deleted alongside the pre-routes they measured:** `planKeywordMatched`, `planPrerouteComposed`, `planModelCalled`, `planPathOutcome`, `followupEligible`, `followupPrerouteComposed`, `followupPathOutcome`, and their producer `classifyPlanPath`/`classifyFollowupPath`/`recordPlanPathDiagnostics` apparatus — confirmed zero matches repo-wide. This is the single cleanest instance in this whole audit of the spec's stated pattern: "a counter whose question is answered... is a deletion candidate WITH its plumbing" — and it already happened, atomically, in the same PR that made the underlying retirement permanent. No follow-up needed.

`freeform_generation_runs.plan_compose_mode` (DB column): stays as an inert additive column — the `INSERT` no longer writes to it, per the handoff doc's own note ("this codebase's migrations are additive-only"). Not a code deletion candidate (would need a real migration decision), flagging for awareness only.

Remaining live counters, all produced by `bumpFreeformDiagnostic` (`styling-engine/tools.js:134`):

| Counter | Written at | Read at | Question / purpose | Settled? | Disposition |
|---|---|---|---|---|---|
| `searchCalls`, `gateExcludedTotal`, `proposeCalls`, `proposeValidationFails` | `tools.js` various | **UI**: `StylistChat.jsx:4520-4536` renders these in the "Search & validation details" panel; **DB**: `routes/ai.js`'s `persistFreeformGenerationRun` | Ongoing per-turn health monitoring | N/A — ongoing | **keep** |
| `outfitProseWithoutToolCall`, `zeroResultContradictionBlocks`, `destinationClarificationRetries` | `tools.js` / `provider.js`'s `fail()` helper | **UI** (same panel) + **DB** | Ongoing guard-rail monitoring | N/A — ongoing | **keep** |
| `planSlotEnvironmentInferred`, `planSlotActivityInferred` | `outfitSetPlanner.js:1382,1390` (`onDiagnostic` callback into `buildPlanSlotWorkbench`) | **DB only** (`persistFreeformGenerationRun`, `routes/ai.js:533-534`) — **not rendered in the UI panel** | Whether the model is reliably declaring structured `activity`/`environment` vs. leaving it to prose inference | Question is live/ongoing (measures prompt-compliance drift), not a one-time retirement question | **keep** — DB-queryable, still answering an open question, but note the UI gap below |
| `submitPlanCalls`, `submitPlanValidationFails`, `submitPlanResubmits`, `submitPlanPartialAccepts` | `tools.js:1474-1520` | **DB only** (`persistFreeformGenerationRun`) — **not rendered in UI panel** | Whether `submit_plan_outfits` resubmits are converging (spec 19's flip criterion literally required watching `submitPlanValidationFails` converge) | The flip already happened (spec 19 Part 4) using this evidence, but the counters remain useful ongoing signal for regressions | **keep** |
| `tripScopeClarificationRetries` | `tools.js:146` (init), bumped via `provider.js:179` | **DB only** — **not rendered in UI panel** | Retry cost of the still-flag-preserved tripScope clause | Not settled — clause is off by default but code-preserved; counter would matter again if the flag were flipped on | **keep** |
| `intentDeclared`, `viewCalls`, `renderCalls`, `coverageCalls`, `composeWithoutDeclaredIntent`, `proposeAfterPlanOutfitSetBlocked`, `proposeUnverifiedPieceBlocks`, `proposeUnseenLayerBlocks`, `planOutfitSetCalls` | `tools.js` various | **Neither the UI panel nor `persistFreeformGenerationRun`** — but the *entire* `freeformDiagnostics` object is sent to the client as `debug` (`routes/ai.js:2740`), so these ARE inspectable via browser devtools/network tab even though `StylistChat.jsx`'s rendered panel only cherry-picks a subset | The handoff doc's own testing protocol ("expand 'Search & validation details'... the freeformDiagnostics counters... are the evidence") assumes a developer reads these via devtools during live-testing, not via the rendered panel | Ongoing / live-testing tool, not a settled retirement question | **keep**, but flag as **UI gap, owner ruling optional**: these are functioning as a devtools-only debug surface, not a documented user-facing feature. If that's intentional (a developer-only channel), no action; if the intent was always for the visible panel to show all of them, that's a small missed-wiring bug, not a cleanup item. Not resolving here — orthogonal to deletion audit. |

---

## Census 4 — test and scratch hygiene

### Part A — tests whose subject is now flag-only or dead

| Test file | Subject | Gating flag / state | Disposition |
|---|---|---|---|
| `test/plan_outfit_set.test.js` | `plan_outfit_set` / `submit_plan_outfits` tool flow | Live (model-mode only) — but contains 23 references to `WARDROBE_PLAN_COMPOSE` save/restore ceremony (lines ~35, 147-207, 517-627) guarding a config knob `tools.js` no longer reads | **keep the tests, delete the dead scaffolding** — a small, low-risk mechanical cleanup: remove the env-var save/restore blocks and the module-level `process.env.WARDROBE_PLAN_COMPOSE = 'engine'` baseline (line 35) and its explanatory comment, since there is no longer a second mode to be hermetic against. Every assertion the scaffolding wraps already only checks `composedBy === 'model'`. |
| `test/hot_weather_ranking.test.js`, `test/spec9_advisor_mode_precompose_fallbacks.test.js` | Contain comments referencing `composeOutfitSet`/pre-routes | Historical comments only, not live assertions on dead code (confirmed: no assertions reference deleted symbols, only prose) | **keep as-is** — these are retrospective comments explaining why a related fallback tier doesn't need re-testing, not tests of dead code. No action. |
| `test/ask_precompose_gate.test.js` | `shouldEngageAskPrecompose` / `followupPrerouteEnabled` | Already deleted in spec 14 | **already deleted** — confirmed via spec-14 commit body ("`test/ask_precompose_gate.test.js` deleted outright"); verified the file no longer exists in the working tree. No action needed. |

### Part B — non-hermetic tests

| Test file | Issue | Evidence |
|---|---|---|
| `test/occasion_exclusion.test.js`, `test/hot_weather_ranking.test.js`, `test/freeform_observability.test.js`, `test/visual_composer_roster.test.js` | Import `db` from `../db.js` **without setting `process.env.WARDROBE_DB_PATH`** first, unlike every other DB-touching test file in the suite. `db.js`'s default (`db.js:12`) is `'wardrobe.db'` — the real repo-root file, i.e. the developer's actual closet data (confirmed no `.env` override: `.env` exists but does not set `WARDROBE_DB_PATH`) | Confirmed via direct grep of each file's top-of-file setup; confirmed each file does `INSERT`/`UPDATE`/`DELETE` against `db` (e.g. `visual_composer_roster.test.js:324-328` inserts/deletes real `pieces`/`outfits` rows). All four clean up their own inserted rows inline (not via `try/finally`, so a mid-test assertion failure could leak orphan rows into the live DB) |
| `test/recall_at_cap.test.js` | Writes to `scratch/recall_at_cap_report.json` (a real repo-relative path, not a tmpdir) as a side effect, then reads it back in the same test | Not a stale-fixture hazard (the file is generated fresh every run, confirmed via `test/recall_at_cap.test.js:96-98`), but it does leave a modified file in the working tree after every test run — a git-diff-noise hygiene issue, not a correctness one |
| Everything else | 517/517 pass on a **fresh** run against this exact baseline; the "9 known env-dependent failures" from the PR #105 report are **confirmed fixed** by Step 0 (`ensureFixturePieces`, the `db.js` seed-race fix, and `--test-concurrency=1`) | Ran `npm test` directly this session: `# tests 517 / # pass 517 / # fail 0`. Ratchet: 238/238 unchanged. |

**Note:** the four files in the first row above are a genuine, previously-undocumented finding — none of the retrospective docs (handoff doc, PR #105 report, Step 0 commit) mention them. They were not part of the "9 known failures" (those were about *missing* fixture data on a fresh clone; these four are about *writing to real data* on any clone that already has a `wardrobe.db`, fresh or the developer's own). They currently pass clean because they clean up after themselves, but they're one failed `assert` away from leaking rows into real closet data.

### Part C — scratch/ scripts not referenced by package.json or docs

`.gitignore` whitelists 9 scratch files individually (`scratch/*` then explicit `!scratch/<name>` exceptions); `git ls-files scratch/` shows 11 tracked (two more — `apply_soft_score_floors.js`, `inspect_piece.js` — added directly, not via the `.gitignore` exception list, but still tracked).

| Tracked scratch/ file | Referenced by package.json? | Referenced by tests? | Referenced by docs? | Disposition |
|---|---|---|---|---|
| `check_style_claims.js` | Yes (`npm test` prerequisite chain) | Yes (`test/occasion_exclusion.test.js` reads its source as text) | — | keep |
| `check_text_matching_ratchet.js` | Yes (`npm test` prerequisite chain) | — | — | keep |
| `inspect_piece.js` | Yes (`inspect:piece` script) | — | — | keep |
| `apply_soft_score_floors.js` | Yes (`apply:soft-score-floors` script) | — | — | keep |
| `backfill_retagger.js` | No | Yes (`test/gateMetadataPhase1.test.js:169` reads its source as text) | — | keep |
| `backfill_gate_metadata.js` | No | Yes (`test/gateMetadataPhase1.test.js` imports + reads source) | — | keep |
| `audit_gate_metadata.js` | No | Yes (`test/gateMetadataPhase1.test.js` reads source as text) | — | keep |
| `recall_at_cap.js` | No | Yes (`test/recall_at_cap.test.js`, `test/gateMetadataPhase1.test.js` import it directly) | — | keep |
| `ratchet_baseline.json` | No (read by `check_text_matching_ratchet.js` directly, not via package.json) | Yes (`test/gateMetadataPhase1.test.js:26`) | — | keep |
| `rankings_ab_diff_report.md` | No | No | Yes (`AGENTS.md`, `.agent/rules/styling-engine.md`) | keep |
| **`diagnose_anchor_selectivity.js`** | **No** | **No** | **No** | **hygiene deletion candidate** — tracked, whitelisted in `.gitignore`, but genuinely orphaned: zero references anywhere in `package.json`, `test/*`, or `docs/*.md`. Confirmed via targeted grep, not assumed from the name. |

Untracked-and-gitignored scratch/ contents (`.DS_Store`, ~30 one-off `check_*`/`test_*`/`view_*`/`dump_*` scripts, JSON/CSV output files, a `formality_contact_sheets/` directory, and **three live `.db`/`.db-shm`/`.db-wal` files including `wardrobe.db` itself**) are correctly excluded from version control already — no action needed, they're working files by design, not a hygiene problem. Flagging only that `scratch/wardrobe.db` existing at all is worth the owner's awareness if it's meant to be a scratch copy rather than the real live DB reachable by the untested-path tests in Part B above — not verified which one it is this pass.

---

## Proposed deletion-spec sequence

Because spec 14 already executed the large deletion this inventory was meant to scope, what's left is small enough that a single follow-up spec (call it **spec 21**) can cover all of it in one PR, grouped by family:

1. **Dead-flag/import cleanup** (mechanical, zero behavior change): remove the unused `tripRequestNeedsScopeClarification` import in `routes/ai.js:55`; remove the 23-line `WARDROBE_PLAN_COMPOSE` save/restore scaffolding in `test/plan_outfit_set.test.js` (keep the tests themselves, just the env-var ceremony around them); delete `scratch/diagnose_anchor_selectivity.js` (confirmed unreferenced).
2. **Non-hermetic test fix** (correctness, not just hygiene): give `test/occasion_exclusion.test.js`, `test/hot_weather_ranking.test.js`, `test/freeform_observability.test.js`, and `test/visual_composer_roster.test.js` the same `WARDROBE_DB_PATH` tmpdir isolation every other DB-touching test file already has. This is the highest-priority item in this whole inventory — it's the one live risk (not just dead weight) found this pass.
3. **`parseStructuredOutfitsFromAssistantText`** — **owner ruling needed**, not a mechanical deletion. Flagged prominently in census 1: the code path is reachable but the codebase's own contemporaneous comment says the format it looks for can no longer occur. Resolve the ruling before scoping a spec around it.
4. **`WARDROBE_PLAN_PREROUTE` / `WARDROBE_BROAD_PLAN_PREROUTE` / `WARDROBE_FOLLOWUP_PREROUTE` / `WARDROBE_PLAN_COMPOSE`** — no code action needed (already fully dead in production), but worth a one-line note in `.env.example`/README if one exists, so a developer doesn't waste time setting a flag that silently does nothing. Not code cleanup, documentation hygiene only.

Everything else audited this pass (census 3's remaining counters, census 2's live config flags, the `isSmartCasualPlanSlot`-family "audit surprise" keepers) is **keep, no action** — verified live and load-bearing, not carried-forward dead weight.

## Scope note

This inventory covers the areas spec 20 explicitly seeded (the plan/precompose/scorer surface spec 14 touched) plus the four census categories applied to that surface, at high confidence (every claim traced to an actual call site or a `git show`/`npm test` run, not grep-count). It does **not** cover a fresh line-by-line reachability pass of `styling-engine/rules.js` (3800+ lines), `styling-engine/core.js` (3700+ lines), `styling-engine/attributes.js`, `styling-engine/occasions.js`, `styling-engine/weather.js`, `styling-engine/taggerMerge.js`, `styling-engine/softScoreFloors.js`, or `routes/crud.js` — those are large, mostly-unrelated-to-spec-14 surfaces that would need their own scoped pass rather than being rushed here. If a future cleanup spec wants that ground covered, it should be commissioned as its own audit rather than assumed clean by omission from this one.

---

# Spec 28 audit (2026-07-17) — whole-app cleanup inventory, all three phases

**Status:** Complete, all three phases. Read-only — zero code changes; this append is the entire deliverable. Baseline: `origin/main` @ `7912ed9`/`79d592a` (post-spec-21, current at audit time). Method identical to spec 20: reachability verified by walking actual call paths from the entry points named in the spec (never grep-count as final evidence), four censuses per phase where applicable, every row gets a disposition (`delete in next spec` / `keep` / `owner ruling needed`).

**Why this pass exists:** the freeform arc's deletions (specs 14, 21) changed the call graph INTO the surfaces below — branches that only the deleted engine composer called are now unreachable with nobody having audited them — and the pre-inversion pipelines (older routes, `rules.js`/`core.js`, most of the frontend) had never had a reachability pass at all before this.

**Top-line result: two independent live-risk findings, no large dead-code caches.** Every route handler in Phase 2's scope came back LIVE (zero orphaned/dead routes). Phase 3 closed both of its carried-forward open items cleanly (one confirmed intentional-by-design, one confirmed a fully clean deletion with zero residue). Phase 1 found the single most consequential issue in this whole pass — see P0 below. The dead-code actually found is small and mechanical (unused imports, a handful of unreferenced functions, one abandoned early feature never wired up) — consistent with this codebase's established pattern of catching orphaned code quickly rather than letting it accumulate.

## P0 findings — data-safety / data-quality, fix ahead of any cosmetic cleanup

1. **(Phase 1) The `rehydrateOutfitPieces` bug class reproduces, live, in `/evaluate-piece`.** `normalizeWholeWardrobeOutfitObject` (`styling-engine/rules.js:3782`) resolves each outfit piece against the full, fully-tagged candidate pool and then unconditionally re-trims the result to `{id, name, category, photo, worn_photo}` before handing it to `locallyGateWholeWardrobeOutfits`. Every structured gate downstream (`registerCeilingVerdict`, `footwearComfortVerdict`, `pieceMatchesMaterial`/`pieceMatchesFootwear`) reads `undefined` for `formality`/`heel_height`/`walk_support`/`fabric_category`/etc. and silently degrades to matching on the piece's literal name text — the same failure class the handoff doc already found and fixed once in `outfitSetPlanner.js`'s `composeOutfitSet`, but this is a second, independent occurrence rooted in `rules.js` itself, currently live on both call paths inside the `/evaluate-piece` route handler (`routes/ai.js:1804`, `1816`). Full trace, evidence, and two candidate fix directions in Phase 1's section below. **This is not the documented "repair skipped in advisor mode" ruling** (that's a separate, correct, deliberate decision) — this is an antecedent trim that runs regardless of the repair setting.
2. **(Phase 2) `test/threadRail.test.js` is a fifth non-hermetic DB test — same hazard class spec 21 Part 1 already fixed for four other files, missed here.** It statically imports `routes/ai.js` → `db.js` with no `WARDROBE_DB_PATH`/`WARDROBE_UPLOADS_DIR` override. Unlike the four files spec 21 fixed, the exposure here is a `db.js` module-load side effect (the unconditional `tag_state` lifecycle backfill, `db.js:291-316`) rather than explicit test-body `INSERT`/`DELETE` calls — but it's a real, ungated `UPDATE` against any real closet DB with genuinely-untagged pieces. Confirmed this session that `wardrobe.db`'s mtime was unchanged after a full `npm test` run (no rows currently match the backfill's `WHERE` clause on this checkout's data) — that's a property of current data, not of the test file; the exposure is structural. Fix: apply the same dynamic-import-after-env-var pattern already proven in spec 21 Part 1.

---

## Phase 1 — `styling-engine/rules.js` + `styling-engine/core.js`

**Scope walked:** `styling-engine/rules.js` (4,617 lines), `styling-engine/core.js` (3,956 lines), `styling-engine/softScoreFloors.js`, `styling-engine/attributes.js`, `styling-engine/occasions.js`, `styling-engine/weather.js`, `styling-engine/taggerMerge.js`. Entry points: `routes/ai.js`/`routes/crud.js` handlers, `executeTool`'s switch (`styling-engine/tools.js`), `styling-engine/outfitSetPlanner.js` as a Phase-1-adjacent consumer.

### P0 — live data-quality bug: the `rehydrateOutfitPieces` bug class reproduces in the LIVE `/evaluate-piece` Visual Composer flow

**This is not the same instance the handoff doc already fixed (that one was in the now-deleted `outfitSetPlanner.js` `composeOutfitSet` path). This is a second, independent, still-live occurrence of the identical bug class, rooted in `styling-engine/rules.js` itself, and it is currently running in production on every `/evaluate-piece` turn.**

**Root cause — `styling-engine/rules.js:3782-3815`, `normalizeWholeWardrobeOutfitObject`.** This function receives an outfit whose `pieces` may already be full DB objects (with `formality`, `heel_height`, `walk_support`, `fabric_category`, `pattern_type`, `colors`, `occasions`, etc.), resolves each piece id against the full `candidatePieces` pool it's given (`ownedPieces = ids.map(id => candidateById.get(id))` — genuinely full objects), and then **deliberately re-trims them on the way out**:
```js
pieces: ownedPieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null }))
```
Every structured tag is discarded even though the full object was sitting right there a line earlier.

**Confirmed live call chain, walked end to end (`routes/ai.js`, `/evaluate-piece` handler, `POST /api/ai/evaluate-piece`, hardcoded `mode: 'advisor'`):**

1. `routes/ai.js:1620-1636` — the model's own proposed outfits (`resolved`) are piece-resolved against `allowedPieces` (the **full**, fully-tagged DB piece pool). At this point `resolved[i].pieces` are full objects.
2. `routes/ai.js:1638` — `normalizedModelOutfits = resolved.map(o => normalizeWholeWardrobeOutfitObject(o, allowedPieces))` — **the full data is thrown away right here.** `modelOutfits` derived from this (line 1666) now carry pieces trimmed to `{id, name, category, photo, worn_photo}`.
3. `routes/ai.js:1804-1808` — `gatedModel = locallyGateWholeWardrobeOutfits(modelOutfits, ..., { mode: 'advisor', candidatePieces: allowedPieces, ... })` — no `repair: true` passed.
4. Inside `locallyGateWholeWardrobeOutfits` (`rules.js:4349`): `shouldRepair = repair !== undefined ? repair : !advisorMode` → `false` here (advisor mode, no override). This particular skip **is** the documented deliberate decision ([[yunap-closet-no-repair-in-advisor-mode]]) — not itself a bug.
5. But even where `shouldRepair` were `true`, `repairWholeWardrobeOutfit` (`rules.js:3954`) does **not** restore full pieces onto the outfit's own `.pieces` array for the general case — it only rehydrates on-demand internally via `wholeWardrobeFullPieces()` for specific sub-checks (footwear swap, boho-mood reason text) and only overwrites `.pieces` in the footwear-swap and boho-mood branches. Every other consumer downstream still sees the outfit object's `.pieces` as trimmed.
6. `rules.js:4377` — `const pieces = Array.isArray(repaired?.pieces) ? repaired.pieces : []` — trimmed.
7. `rules.js:4433` — `const profileFits = pieces.map(piece => profileRuleFit(piece, mergedRules, { ...registerCeiling }))` — **gates every piece on trimmed data.**

**What actually breaks, confirmed by reading each downstream function:**
- `registerCeilingVerdict` (`rules.js:1784`) calls `pieceFormality(piece)` → `attributes.js:87` reads `p.formality`, which is `undefined` on a trimmed piece → `formalityRank(undefined)` returns `null` → verdict is **always `'unknown'`**, never `'exclude'`. The register-ceiling gate (dressy piece for a `casual`/`everyday`-ceiling ask, etc.) cannot fire; in advisor mode `'unknown'` only appends a soft "verify manually" flag instead of rejecting.
- `footwearComfortVerdict` (`rules.js:1772`) reads `pieceHeelHeight`/`pieceWalkSupport` → `p.heel_height`/`p.walk_support` undefined on trimmed shoes → verdict `'unknown'` instead of a real comfort exclusion.
- `pieceMatchesMaterial`/`pieceMatchesFootwear`/`pieceMatchesPieceName` (`attributes.js:441-460`) all run against `pieceTextBlob(p)` (`rules.js:353`), which concatenates `fabric_category`, `pattern_type`, `colors`, `occasions`, `notes`, etc. — all `undefined` on a trimmed piece, leaving only `name`+`category`. **Prohibited-material and prohibited-footwear checks silently degrade to matching the piece's literal name text** — the same "test passes for the wrong reason" failure mode already documented once (#86, the "jersey" incident, see [[dont-overgeneralize-incident-into-material-rule]]).

This affects **both** paths in the route: the model-composed outfits (`gatedModel`, step 2-3 above) **and** the locally-generated fallback candidates (`buildVisualLocalBackfill()` → `wholeWardrobeOutfitsFromCandidates` → same `normalizeWholeWardrobeOutfitObject` trim → `gatedLocal` at `routes/ai.js:1816-1820`, also no `repair: true`).

**Why this wasn't caught by tests:** `test/formality_gate.test.js:128`, `test/spec9_advisor_mode_precompose_fallbacks.test.js` (all three tests) hand-construct outfit objects with **already-full** `pieces` arrays (`{id, name, category, formality, heel_height, walk_support}` supplied directly) and call `locallyGateWholeWardrobeOutfits` **directly**, bypassing `normalizeWholeWardrobeOutfitObject`/`wholeWardrobeOutfitsFromCandidates` entirely. None of the three exercises the real production sequence (`resolved` → `normalizeWholeWardrobeOutfitObject` → `locallyGateWholeWardrobeOutfits`), so the trim is invisible to the suite.

**Standing-caution check:** this is **not** the "repair skipped in advisor mode" deliberate decision — that's a documented, correct ruling and untouched by this finding. This finding is about the antecedent trim in `normalizeWholeWardrobeOutfitObject`, which runs unconditionally, upstream of and independent from the repair skip, and defeats `profileRuleFit`'s structured gates regardless of `repair`/`advisorMode` settings. It reproduces for **every** caller of `locallyGateWholeWardrobeOutfits` in production — currently that's only the two `/evaluate-piece` call sites (`routes/ai.js:1804`, `1816`), confirmed by repo-wide grep.

**Recommended fix direction (not implemented, per read-only scope):** either (a) stop re-trimming inside `normalizeWholeWardrobeOutfitObject` — keep the full `ownedPieces` objects on `.pieces` and trim only at the JSON-response boundary if payload size is the original reason for trimming, or (b) add a universal `rehydrateOutfitPieces`-equivalent call inside `locallyGateWholeWardrobeOutfits` itself (mapping `repaired.pieces` back to `candidatePieces` by id) before the `profileFits` computation, so every caller gets it automatically regardless of `repair`/`advisorMode`. Owner ruling needed on which.

### Census 1 — reachability

| Symbol | File:Line | Classification | Evidence | Notes |
|---|---|---|---|---|
| `buildWholeWardrobeCandidateOutfits` — 3rd `routes/ai.js` call site (spec's own seed) | was inside `maybePrecomposeStructuredOutfitsForAsk` | **ALREADY RESOLVED — deleted, not carried-forward risk** | `git log -S"buildWholeWardrobeCandidateOutfits" -- routes/ai.js` → last touched by `ce2adc5` (spec 14); `git show ce2adc5 -- routes/ai.js` shows the 3rd call site deleted wholesale along with its enclosing (also-deleted) `maybePrecomposeStructuredOutfitsForAsk` pre-route function | The handoff doc's "3 call sites, NOT touched or audited" note (2026-07-14) predates spec 14 (2026-07-16). Only 2 real call sites remain, both investigated for the P0 finding above. |
| `buildWholeWardrobeCandidateOutfits` — remaining 2 call sites | `routes/ai.js:1738`, `routes/ai.js:1765` | **LIVE**, and both are on the P0 bug's path | Called inside `buildVisualLocalBackfill()`/`buildDiagnosticLocalBackfill()`, both nested in the `/evaluate-piece` handler | `buildDiagnosticLocalBackfill()` is explicitly `diagnosticOnly: true` (shows why local candidates fail gates — lack of repair looks intentional). `buildVisualLocalBackfill()`'s output is a real user-facing fallback and is in scope for the P0 finding. |
| `buildWholeWardrobeCandidateOutfits` import in `styling-engine/core.js:86` | `core.js:86` | **DEAD IMPORT** | Zero calls anywhere in `core.js` | One of ~60 unused imports, see below. |
| `candidateObjectFromPieces` | `rules.js:3420` | **LIVE, internal-only** | Called once, inside `buildWholeWardrobeCandidateOutfits` itself | Correctly not exported for outside use beyond the trimming behavior documented in the P0 section. |
| `qualifiesWholeWardrobeMission` | `rules.js:1497` | **LIVE** | Called inside `buildWholeWardrobeCandidateOutfits`'s `addCandidate` gate and directly from `routes/ai.js:184`/`1903` | Confirmed NOT era-orphaned — the mission-qualification gate for the still-live whole-wardrobe candidate generator, unrelated to the deleted `composeOutfitSet` era. |
| `capsuleVersatilityScore` and the `composeOutfitSet`/capsule-allocator family | N/A to Phase 1 | **out of file scope** | These live in `styling-engine/outfitSetPlanner.js`, not `rules.js`/`core.js` | The spec's named "cousins" hunting ground isn't present in this phase's files. |
| `wholeWardrobeSelectionScore` | `rules.js:3010` | **DEAD — delete in next spec** | Zero calls anywhere in the repo, including within `rules.js` itself | Superseded by `wholeWardrobeDiversitySelectionScore` (`rules.js:4073`, live, called from `applyWholeWardrobeDiversity`). Never covered by any test. |
| ~60 unused `rules.js`-sourced imports into `core.js` | `core.js:41-122` | **DEAD IMPORTS — delete in next spec** | Each name in the `from './rules.js'` import block searched against the rest of `core.js` with a word-boundary check; zero hits. Spot-checked 4 by hand to rule out a check bug. | Full list: `idealAdditionAnchorConstraint, wholeWardrobeFeedbackInfluenceForCandidate, wholeWardrobePieceBucket, wholeWardrobePieceTrustDecision, wholeWardrobeBohoSignalScore, wholeWardrobeMissesMood, inferOutfitArchetype, wholeWardrobeFormulaFamily, wholeWardrobeFormulaType, wholeWardrobeArchetypeFor, wholeWardrobeFullPieces, wholeWardrobePieceByGroup, wholeWardrobeHeroPieceId, wholeWardrobeIsExploratory, wholeWardrobeHasPrintOrStripe, wholeWardrobeHasGraphicTop, wholeWardrobeHasNonGraphicTop, wholeWardrobeHasDress, wholeWardrobeTopBottomKey, wholeWardrobeDirectionFromPieces, wholeWardrobeSilhouetteFromPieces, wholeWardrobeGroundingStrategy, wholeWardrobeShoeShape, wholeWardrobeVisualRhythm, pieceNameBlob, pieceStyleProfile, normalizeStyleProfileList, pieceGarmentIntelligence, inferWholeWardrobePieceRoles, inferWholeWardrobeOutfitRoles, occasionBiasForArchetype, occasionScoreForOutfit, wholeWardrobeCandidateFormulaCounts, buildWholeWardrobeCandidateOutfits, normalizeWholeWardrobeOutfitObject, candidateObjectFromPieces, scoreWholeWardrobeCandidate, textIncludesAny, visualWeightProfile, buildVisualWeightText, hasPairingReference, hasRejectedReference, collectPieceIdsFromFeedbackPayload, feedbackWeight, getFeedbackInfluenceForPair, buildGoldStandardFeedbackMemory, collectPieceIdsFromSavedBoardRow, getSavedBoardInfluenceForPair, explicitOccasionsForPiece, profileOccasionConfidence, pieceMatchesOccasion, styleLaneScore, garmentProfileText, compatibilityScoreForSelectedItem, rankedComplementaryWardrobeFor, complementaryWardrobeFor, buildRankedCandidateText, selectCandidatesForOutfitGeneration, getOutfitsForPieceMemory, buildWholeWardrobeFeedbackInfluence, saveWholeWardrobeSession, getRecentWholeWardrobeSessionInfluence, mergeStyleProfilePatch`. Suggests `core.js` used to own whole-wardrobe candidate/scoring logic directly before it moved to `routes/ai.js` calling `rules.js` directly — the import list was never pruned to match. Mechanical, zero-behavior-change. |
| `buildCompactPieceText` | `core.js:209` | **DEAD — delete in next spec** | 1 self-match only (its own def line), zero test coverage | Superseded by `rules.js`'s live `buildPieceText`. |
| `getPiecePhotoPath` | `core.js:3359` | **DEAD — delete in next spec** | 1 self-match only, zero test coverage | `imageUrlToUploadPath` (nearby, live) does similar work; this one looks abandoned. |
| `getCalibrationSourcePhotoPath` | `core.js:3374` | **DEAD — delete in next spec** | 1 self-match only, zero test coverage | Reads `calibration_images` directly; no caller anywhere. |
| `setPath` | `taggerMerge.js:168` | **DEAD — delete in next spec** | Zero calls anywhere, including within `taggerMerge.js` itself | Its sibling `getPath` (line 164) IS live. Looks like unused write-side scaffolding for a feature that never landed. |
| `hasFitVisiblePhoto`, `hasPhotoPropertyJudgment`, `pathIsProtected` | `taggerMerge.js` (various) | **LIVE, internal-only** | Each called within `taggerMerge.js` itself; zero external imports | Correctly private-by-convention, not dead. No action. |
| `pieceTextBlob` — duplicate implementation | `attributes.js:33` vs. `rules.js:353` | **owner ruling needed** (consistency hazard, not a deletion) | `rules.js` defines and uses its own local `pieceTextBlob` (with a `WeakMap` cache) throughout; does not import `attributes.js`'s version. `attributes.js`'s own `pieceTextBlob` (line 33) is a second, independently-written implementation, used only internally within `attributes.js`. | The two have already diverged — `attributes.js`'s version includes `season`/`fiber_content`; `rules.js`'s does not. Both are live for their own callers, so neither is a deletion candidate, but the identical naming across two files that behave differently is a real footgun. Flagging for an owner decision: rename one, or consolidate. |
| `qualifiesWholeWardrobeMission`, mission-scoring family (`scoreWholeWardrobeCandidate`, `selectDiverseWholeWardrobeCandidates`, `wholeWardrobeCandidateAxes`) | `rules.js` (various) | **LIVE** | Directly reachable from `buildWholeWardrobeCandidateOutfits` and `routes/ai.js`'s own direct calls | Predates and survives the freeform arc entirely — the mission-candidate machinery for the Visual Composer selected-item flow. Standing caution #1: pre-inversion ≠ dead. |
| `core.js`'s evaluator/boards/render pipelines (`evaluateOutfitThroughSharedPipeline`, `createOutfitBoardImage`, `createWholeWardrobeOutfitImage`, `createSavedOutfitImage`, `createEditorialConceptImage`, etc.) | `core.js` (various) | **LIVE — product features (standing caution #1)** | All imported and called from `routes/ai.js` route handlers | No internal branches found reading fields no longer produced anywhere — the P0 finding is the one confirmed instance of that pattern in this scope, located in the candidate-gating layer rather than the render layer. |
| `runOccasionStartupAssertions` | `occasions.js:121` | **LIVE — self-invoking startup gate** | Called unconditionally at module load (`occasions.js:151`) | Not dead despite no external callers — a module-load-time assertion, the correct pattern for it. |
| `softScorePredicates` | `softScoreFloors.js:142` | **LIVE, internal-only** | Called once, inside `applySoftScoreFloors` (live, imported by `routes/crud.js`/`taggerMerge.js`) | No issue. |

### Census 2 — env-flag census

| Flag | Default | Gates | Read sites (this scope) | Status |
|---|---|---|---|---|
| `PHOTO_PRESERVING_VISUALS` | unset → `'false'` | Local-collage vs. AI render | `core.js:1825`, `rules.js:3863` | **live config**, unchanged from spec-20 census |
| `WARDROBE_MANIFEST_MAX_PIECES` | unset → `400` | Whole-closet prompt manifest cap | `core.js:3713` | **live config**, unchanged |
| `WARDROBE_TEST_MAX_WHOLE_WARDROBE_CANDIDATES` | unset → no override, test-only | Candidate-pool size override | `rules.js:3604-3605` | **live config (test harness knob)**, unchanged |
| `WARDROBE_TEST_MAX_WHOLE_WARDROBE_REVIEW_CANDIDATES` | unset → no override, test-only | Review-candidate cap | `core.js:1403-1404` | **live config**, unchanged |
| `STYLIST_CRITIC_DISABLED` | unset → critic runs | Post-generation critic kill-switch | `core.js:438, 469` | **live config, still untested**, unchanged |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IDENTITY_IMAGE_SIZE`, `OPENAI_EDITORIAL_IMAGE_SIZE`, `OPENAI_IMAGE_SIZE` | model/size defaults | AI-rendered visual params | `core.js:1454, 1468-1469` | **live config**, unchanged |
| `NODE_ENV==='test'` gate (`shouldSkipLive`) | n/a | Skips live geocode/forecast network calls under the test runner | `weather.js:115` | **live test-harness convention**, newly enumerated (weather.js wasn't in spec 20's scope) but correct and intentional — keep |

### Census 3 — diagnostics counters

No new counters found living in this Phase 1 surface. All `bumpFreeformDiagnostic` counters live in `tools.js`/`outfitSetPlanner.js`, already fully catalogued by spec 20.

### Census 4 — test/fixture hygiene

| Test file | Subject | Hermeticity | Disposition |
|---|---|---|---|
| `test/occasion_exclusion.test.js`, `test/hot_weather_ranking.test.js`, `test/visual_composer_roster.test.js` | Previously flagged non-hermetic by spec 20 | **Fixed, re-verified** — all three set `WARDROBE_DB_PATH` to a tmpdir before any dynamic `db.js`-touching import | Spec 21 Part 1's fix confirmed still in place. No action. |
| `test/formality_gate.test.js`, `test/spec9_advisor_mode_precompose_fallbacks.test.js` | `locallyGateWholeWardrobeOutfits`/`profileRuleFit` scoring | Hermetic (no DB), but every fixture hand-builds outfit objects with already-full `.pieces`, bypassing `normalizeWholeWardrobeOutfitObject` | **Gap, not a hermeticity bug** — this is why the P0 bug has zero test coverage. Add a regression test running the real `resolved → normalizeWholeWardrobeOutfitObject → locallyGateWholeWardrobeOutfits` sequence with DB-shaped pieces, to pin the eventual fix. |
| `test/outfit_structure.test.js`, `test/softScoreFloors.test.js`, `test/taggerMerge.test.js`, `test/weather.test.js`, `test/owner_rules.test.js` | Their respective files | Hermetic, no DB touch | keep, no action |

### Proposed deletion-spec grouping (Phase 1)

1. **P0 fix — rehydrate the whole-wardrobe candidate gating pipeline** (correctness, highest priority, ship before/alongside anything else here). Fix `normalizeWholeWardrobeOutfitObject`/`locallyGateWholeWardrobeOutfits` so structured gates see real tag data on both `/evaluate-piece` candidate paths. Add the missing-coverage regression test from census 4.
2. **Dead-import mechanical cleanup, `core.js`**: remove the ~60 unused `rules.js`-sourced imports (full list above), zero behavior change.
3. **Dead-function cleanup**: `wholeWardrobeSelectionScore`, `buildCompactPieceText`, `getPiecePhotoPath`, `getCalibrationSourcePhotoPath`, `setPath` — zero test coverage to update, zero behavior change.
4. **Owner ruling, not a deletion** — consolidate or rename the two divergent `pieceTextBlob` implementations before either file is touched again for unrelated work.

Everything else audited this pass (mission-candidate family, evaluator/boards/render pipelines, census 2 flags, `runOccasionStartupAssertions`, `softScorePredicates`, the three private `taggerMerge.js` helpers) is **keep, no action**.

---

## Phase 2 — `routes/ai.js` (non-freeform) + `routes/crud.js` + `server.js` + `db.js`

**Scope:** `routes/ai.js` non-freeform routes (everything except `/api/ai/ask`), `routes/crud.js`, `server.js`, `db.js`. `npm test` re-run fresh this session: **571/571 pass, 0 fail** (matches spec 21's recorded post-cleanup baseline).

### P0 — live data-safety issue

**`test/threadRail.test.js` statically imports `routes/ai.js` (line 10: `import { deriveTripTitle } from '../routes/ai.js'`), which statically imports `db.js` — with no `WARDROBE_DB_PATH`/`WARDROBE_UPLOADS_DIR` override anywhere in the file.** This is the exact hazard class spec 21 Part 1 fixed for `occasion_exclusion.test.js`, `hot_weather_ranking.test.js`, `freeform_observability.test.js`, and `visual_composer_roster.test.js` — but this fifth file was missed. On a bare `npm test` run with no env override, this test module load opens the developer's real repo-root `wardrobe.db`.

Unlike the four files spec 21 fixed (explicit `INSERT`/`DELETE` in test bodies), the exposure here is a `db.js` module-load side effect:
- The seed-data insert is safely gated by an atomic `INSERT OR IGNORE` (`db.js:324`) — harmless on an already-seeded DB.
- The `ALTER TABLE` migrations (`db.js:184-274`) are idempotent no-ops after first application — harmless.
- **The lifecycle-state backfill (`db.js:289-316`) is not gated by a first-run check — it runs unconditionally on every module load**, querying `SELECT * FROM pieces WHERE tag_state IS NULL OR tag_state = 'untagged'` and issuing real `UPDATE`s against any matching rows. On a real closet DB with genuinely-untagged pieces (a normal state for an in-use inventory app), running `npm test` would silently rewrite `tag_state` on real rows.

Verified this session: `wardrobe.db`'s mtime was unchanged after a full `npm test` run — on this checkout's DB, no pieces currently match the backfill's `WHERE` clause, so no mutation occurred this time. That's a property of the current data, not of the test file; the exposure is structural and will fire the moment any untagged piece exists in whatever `wardrobe.db` a developer runs tests against. **Disposition: fix in next spec** — apply the same dynamic-import-after-env-var pattern spec 21 Part 1 already established.

### Census 1 — route-handler reachability

Every `routes/crud.js` route was checked against actual `fetch(...)` call sites in `src/**/*.jsx`, including template-literal ID-interpolated paths. **Result: every route in `routes/crud.js` has a confirmed live frontend caller — no orphaned or dead routes.** This covers `pieces` (CRUD, meta, favorite, occasion-exclusion, append-note), `outfits` (CRUD, favorite, pieces, append-note), `stylist-feedback` (CRUD), `calibration-images` (CRUD), `saved-boards` (CRUD), `todos` (CRUD, clear-orphaned), `chat-threads` (CRUD, pin, archive), and `settings/home-location`.

`routes/ai.js` non-freeform routes — every one confirmed LIVE with a real frontend caller: `/extract-pieces`, `/tag-piece`, `/tag-piece-existing/:id`, `/evaluate-piece`, `/generate-outfits-for-piece`, `/whole-wardrobe-session-memory` (GET/DELETE), `/generate-wardrobe-outfits-visual`, `/generate-outfit-boards`, `/generate-saved-outfit-variants`, `/generate-wardrobe-outfit-image`, `/generate-wardrobe-outfit-comparison-sheet`, `/generate-ideal-additions-preview-sheet`, `/generate-saved-outfit-image`, `/evaluate-wardrobe-outfit`, `/outfit-feedback`, `/editorial-directions-preview`, `/editorial-render-one`, `/compare-outfits`. **No FRONTEND-ORPHANED or DEAD routes found in this scope**, including every category the spec called out by name (upload/photo, tagger, board, evaluation). None trace back to a UI element deleted in specs 14/21 — those deletions were entirely inside the freeform precompose machinery, which fed no route in this scope.

**Standing-caution check (pre-inversion ≠ dead):** `composeSelectedPieceVisualWardrobeOutfits` (`routes/ai.js:562`, called from `/evaluate-piece`) contains the two `buildWholeWardrobeCandidateOutfits` call sites the handoff doc flagged as never audited — confirmed this is the LIVE "AI stylist composer" the standing caution names explicitly, not dead. (Whether it shares the trimmed-pieces bug class is Phase 1's question — see the P0 above, now resolved: yes, it does.)

`db.js`: schema/migration/seed blocks all confirmed LIVE and correctly additive-only, except the lifecycle-state backfill flagged as the P0 mechanism above (the backfill itself is live, wanted behavior for the real app — the hazard is a test importing it without isolation, not the backfill existing).

### Census 2 — env-flag census (this scope)

| Flag | Default | Gates | Read sites | Status |
|---|---|---|---|---|
| `PORT` | `3001` | Listen port | `server.js:14` | live config |
| `NODE_ENV` | unset | Production static-serving + catch-all route; suppresses `app.listen` under `test` | `server.js:26,33` | live config |
| `WARDROBE_DB_PATH` | `'wardrobe.db'` | Which SQLite file opens | `db.js:12` | live config, unchanged from spec 20 — the P0 finding is a consumer of this flag being absent in one more test file, not a new flag issue |
| `WARDROBE_UPLOADS_DIR` | `<repo>/uploads` | Garment photo storage dir | `db.js:9` | live config, unchanged |

No `process.env.*` reads exist in `routes/ai.js` or `routes/crud.js` themselves.

### Census 3 — diagnostics counters

None live in this scope's own code (`persistFreeformGenerationRun` is defined at `routes/ai.js:521` but is exclusively a freeform-pipeline concern, already catalogued by spec 20). Nothing new.

### Census 4 — test/fixture hygiene

Hermetic: `test/crudEndpoints.test.js`, `test/metadataTodos.test.js`, `test/savedBoardsVisibility.test.js`, `test/aiEndpointContracts.test.js`, `test/occasion_exclusion.test.js` (all set env vars before dynamic import). **Not hermetic: `test/threadRail.test.js`** — see P0 above. `test/outfitLookbook.test.js`, `test/feedback_redesign.test.js`, `test/boardCritiqueFix.test.js`, `test/outfit_structure.test.js` never touch `db.js` (pure source-scan or pure-function tests) — N/A.

Coverage gap (not a reachability question, flagged for awareness only): `stylist-feedback`, `calibration-images`, `saved-boards`, `todos/clear-orphaned`, `pieces/:id/outfits`, `outfits/:id/pieces`, the two `append-note` routes, `occasion-exclusion`, `outfits/:id/favorite`, and every non-freeform `routes/ai.js` route are confirmed LIVE via frontend call sites but have no integration test in this scope. "Untested" is not "dead" — not a deletion candidate.

### Proposed deletion-spec grouping (Phase 2)

Because every route handler in scope came back LIVE, this phase has no code-deletion rows — the older pipelines really are live product surface, exactly as the standing cautions predicted. The one actionable item is a hygiene fix:

1. **Test-isolation fix (P0, mechanical, zero production-code behavior change)** — apply the dynamic-import-after-env-var pattern from spec 21 Part 1 to `test/threadRail.test.js`. Single highest-priority item from this phase; should be its own small PR.

No other family exists to group. The coverage gaps in census 4 are explicitly not proposed for a deletion spec (additive test-writing work, out of an audit's scope to schedule).

---

## Phase 3 — frontend beyond `StylistChat.jsx`

**Entry point walked:** `src/main.jsx` → `src/App.jsx`'s `<Routes>` (`/wardrobe`, `/outfits`, `/stylist` + `/stylist/:threadId`, `/visual-lab`) → each view's own component tree. No P0 live data-safety issue found in this phase's scope.

### Census 1 — component/module reachability

| Symbol / file | File:Line | Classification | Evidence | Notes |
|---|---|---|---|---|
| `PieceInventory`, `OutfitLookbook`, `AskClaude`, `VisualLab` | route roots | **LIVE** | Directly mounted by `src/App.jsx`'s `<Routes>` | Everything else was walked from these. |
| `BatchAdd`, `PieceCard`, `PieceDetail`, `PieceForm`, `TodoList`, `ThreadRail`, `MarkdownMessage` | `src/components/*`, `src/views/*` | **LIVE** | Imported and rendered by their parent views (confirmed both import and JSX render site for each) | — |
| `src/utils/threadGrouping.js`, `src/utils/intakeReview.js` | — | **LIVE** | Imported by `ThreadRail.jsx` / `BatchAdd.jsx` respectively | — |
| `src/utils/wardrobeAiContext.js` | — | **LIVE, but not part of the React tree** | Imported by `styling-engine/tools.js`, `rules.js`, `core.js`, and its own test | Genuinely live (reachable from the `executeTool` entry point), just organizationally misfiled under `src/utils/` even though no React component touches it. Awareness-only — moving it is a refactor, not a cleanup. |
| `src/constants/feedback.js` (`STYLE_FEEDBACK`, `IDENTITY_FEEDBACK`), `src/constants/identityFeedbackChips.js`, `src/utils/feedbackMessages.js`, `src/utils/feedbackRouting.js`, `src/utils/identityFeedback.js`, `src/utils/identityLearning.js`, `src/styles/feedback.css` | 7 files, 130 lines total | **DEAD — never wired, not carried-forward debt — delete in next spec** | Exhaustive grep for every exported symbol: zero hits anywhere outside the family's own 7 files. `git log --diff-filter=A --follow` on all 7 shows a single commit each: the initial commit — never touched since. | A different system from the live one: the app's real outfit feedback is `OUTFIT_FEEDBACK_LABELS` (`StylistChat.jsx:32`, two labels — `works`/`not_me`) wired to `feedback_labels`/`/api/stylist-feedback`, pinned by `test/feedback_redesign.test.js`, independently scored by `feedbackWeight()` (`rules.js:451`). This family looks like an early, more elaborate feedback-taxonomy design superseded before ever being imported. Not mentioned in the handoff doc or spec 20's inventory — genuinely undocumented, not a standing-caution "pre-inversion live feature" (that caution protects *live* surfaces; this never went live). |
| `VisualLab`'s `activeContext` prop | `src/components/VisualLab.jsx:58,474` | **owner ruling needed** | Sole render site (`App.jsx:64`) passes only `onGoToThread` — `activeContext` is never supplied, so the per-context empty-state message can never fire | Either (a) wire `activeContext` through from `AskClaude`'s state so the per-context message works as designed, or (b) delete the dead prop/branch since `/visual-lab` is now a standalone tab, not opened from an active stylist context. Not resolved here per the standing-caution framing. |
| `VisualLab.jsx`'s doc comment (lines 50-56) | — | **stale documentation — delete in next spec (mechanical)** | Documents `boardSaveCount`/`onClose` props that don't exist in the actual two-prop signature | Leftover from when `VisualLab` was a closeable modal rather than its own route. Resolve alongside the `activeContext` ruling above. |
| `structuredOutfitsDebug` (API field) | `routes/ai.js:2742` | **cross-reference note, not this phase's scope** | `/api/ai/ask` always sends `structuredOutfitsDebug: null`; zero reads anywhere in `src/` | A Phase 2 dead-field question, not a frontend one — flagged so Phase 2 has frontend-side confirmation nothing depends on it. |

### Census 2 — env-flag census

No frontend `.env`/`import.meta.env`/`process.env` reads exist anywhere in `src/` (zero hits, repo-wide grep). All flag-gated behavior lives server-side. Nothing to census.

### Census 3 — carried-forward open item #1, resolved: devtools-only diagnostics UI gap

Re-verified against current code: 7 counters (`searchCalls`, `gateExcludedTotal`, `proposeCalls`, `proposeValidationFails`, `outfitProseWithoutToolCall`, `zeroResultContradictionBlocks`, `destinationClarificationRetries`) ARE rendered in `StylistChat.jsx`'s "Search & validation details" panel. 9 more (`intentDeclared`, `viewCalls`, `renderCalls`, `coverageCalls`, `composeWithoutDeclaredIntent`, `proposeAfterPlanOutfitSetBlocked`, `proposeUnverifiedPieceBlocks`, `proposeUnseenLayerBlocks`, `planOutfitSetCalls`) reach the client in the full `debug` object but are NOT rendered in the visible panel.

**This audit's recommendation: keep as a deliberate developer-only channel — do not wire into the visible panel.** The handoff doc's own testing protocol treats the full `debug` object as developer/QA evidence inspected via devtools, distinct from the rendered panel's end-user-facing "what got filtered or fixed" summary. The 7 rendered counters share a common "how many times did an auto-correction fire" shape; the 9 non-rendered ones are mostly turn-mechanics/architecture-compliance signals ("is the model using the tools correctly") — a developer question, not an end-user one. No incident report describes a user or tester confused by their absence from the panel. **Judgment call, not certainty** — flagged as owner-ruling-needed with a stated recommendation, since two consecutive audits (spec 20 and this one) independently found evidence pointing toward "intentional," not "missed wiring." Recorded so the open item is finally closed by an owner decision or explicitly re-affirmed as permanent-by-design.

### Census 3b — carried-forward open item #2, resolved: no residue

Spec 21 Part 4 (`7912ed9`) executed the `parseStructuredOutfitsFromAssistantText` deletion in full — `parseStructuredOutfitsFromAssistantText`, `mergeCurrentOutfitSet`, `normalizeOutfitPieceName`, `resolveNamedWardrobePiece`, `OUTFIT_CARD_RESPONSE_PATTERN`, the `replyConversationMode` variable, the `freeform_current_set` branch, and `outfit.unresolvedPieceNames` — all confirmed zero matches in `src/`. `dist/` was rebuilt in the same commit. The source-scan test that pinned this machinery was deleted alongside its subject. **Disposition: fully clean deletion, no residue. Item closed.**

### Census 4 — test/fixture hygiene

`test/feedback_redesign.test.js` correctly tests the LIVE two-label feedback system, not the dead `IDENTITY_FEEDBACK*` family — confirmed by reading the test body, not assumed from the filename. `test/threadRail.test.js`, `test/markdownMessage.test.js`, `test/outfitLookbook.test.js`, `test/batchAdd.test.js`, `test/wardrobeAiContext.test.js` all correctly cover confirmed-live subjects. No test file references any of the 7 orphaned `feedback`/`identity*` files.

### Proposed deletion-spec grouping (Phase 3)

1. **Dead identity-feedback family removal** — recommend a quick owner confirmation first ("did you ever ship a richer feedback taxonomy than works/not_me?") since this audit found no *code* evidence of use but can't rule out an unshipped in-progress design. Then delete `src/constants/feedback.js`, `src/constants/identityFeedbackChips.js`, `src/utils/feedbackMessages.js`, `src/utils/feedbackRouting.js`, `src/utils/identityFeedback.js`, `src/utils/identityLearning.js`, `src/styles/feedback.css`. Rebuild `dist/`.
2. **`VisualLab.jsx` prop/doc cleanup** — owner ruling needed first (wire `activeContext` through, or delete the dead prop/branch and the stale doc comment). Group as one PR once the ruling lands.
3. **Devtools-diagnostics UI gap** — no code action recommended (keep as a deliberate developer channel per this audit's ruling), but should be formally closed by an owner decision rather than carried forward a third time. If ruled "wire it in," that's a ~10-line addition, not a deletion.

Everything else audited this phase — the four route-root components and their children, `threadGrouping.js`/`intakeReview.js`, the prose-parser deletion site, the (empty) frontend env-flag surface — is **keep, no action**.

---

## Cross-phase scope note

Phase 1 covered `styling-engine/rules.js`+`core.js` and five smaller riders. Phase 2 covered the non-freeform server surface (`routes/ai.js` minus `/ask`, `routes/crud.js`, `server.js`, `db.js`). Phase 3 covered `src/` beyond `StylistChat.jsx`. Together with spec 20/21's prior coverage of the freeform plan/precompose/scorer surface and `StylistChat.jsx` itself, this closes every surface spec 20's own scope note listed as not-yet-covered. `styling-engine/outfitSetPlanner.js`, `styling-engine/tools.js`, `styling-engine/provider.js`, and `StylistChat.jsx` remain covered by spec 20/21 and are not re-walked here except where a cross-reference was needed (e.g. Phase 1's P0 tracing into `outfitSetPlanner.js`'s already-fixed sibling bug). `dist/` was excluded throughout, per the spec's instruction — noted only that it must be rebuilt by whichever deletion spec follows.

---

## Spec 29 execution (2026-07-17) — all rows from this audit closed

Every row this audit proposed for a follow-up spec has now been executed, one PR, Part 1 as its own first commit:

- **Phase 1 P0** (the `rehydrateOutfitPieces` bug class in `/evaluate-piece`) — **FIXED**. `locallyGateWholeWardrobeOutfits` (`rules.js`) now rehydrates `outfit.pieces` against `candidatePieces` by id before `profileFits` runs, direction (b) from this audit's two candidate fix directions. Regression test added (`test/whole_wardrobe_gate_rehydration.test.js`), verified red against pre-fix code.
- **Phase 2 P0** (`test/threadRail.test.js` non-hermetic) — **FIXED**. Same dynamic-import-after-env-var pattern as spec 21 Part 1.
- **~60 unused `core.js` imports, `wholeWardrobeSelectionScore`, `buildCompactPieceText`, `getPiecePhotoPath`, `getCalibrationSourcePhotoPath`, `setPath`** — **DELETED**. Each re-verified with a word-boundary grep immediately before deletion, per the doctrine; every one still came back zero-caller.
- **`structuredOutfitsDebug` dead response field** — **DELETED** from `/ask`'s response (`routes/ai.js`).
- **Identity-feedback family (7 files)** — **DELETED**. Owner ruling: never shipped.
- **`VisualLab.jsx`'s `activeContext` prop/branch + stale doc comment** — **DELETED**. Owner ruling: `/visual-lab` is a standalone tab by design, delete the dead branch rather than wire it up.
- **`attributes.js`'s duplicate `pieceTextBlob`** — **RENAMED** to `attributePieceTextBlob`. Owner ruling: rename only, no consolidation (consolidation would change what the matching gates see and needs its own evidence-backed pass).
- **Devtools-diagnostics UI gap (Phase 3, census 3)** — **CLOSED — affirmed keep-as-is** (owner ruling, 2026-07-17). This is a deliberate developer-only channel, not a missed-wiring bug: the 9 non-rendered debug counters are turn-mechanics/architecture-compliance signals for developer/QA use via devtools, distinct in kind from the 7 counters already rendered in the visible "Search & validation details" panel (which share a common "how many times did an auto-correction fire" end-user-relevant shape). Two independent audits (spec 20, spec 28) converged on the same recommendation before this ruling. This item is not to be carried forward again.

`dist/` was rebuilt in the same PR as the frontend deletions (Parts 4–5), per repo convention. `npm test`: 576/576 green throughout every commit in this PR.

**The audit arc is complete: spec 20 → 21 → 28 → 29.** Every app surface named across all four specs has now been walked at least once, and every finding from spec 28's audit has either been fixed, deleted, renamed, or explicitly closed as intentional. No open items remain from this arc.
