# Spec 31: Batch wardrobe onboarding — photo-library import, cross-photo garment dedup, and the review gate

> ## ⚠️ HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The `Status:` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.


**Status:** Proposed (2026-07-18), reviewed with owner same day — three rulings encoded: calibration seeding defaults ON for fresh onboarding but OFF for imports into an already-calibrated wardrobe; video-file ingestion (ffmpeg) STAYS in v1 (packaging cost consciously accepted — first binary dependency, note it in the future platform spec); merge evidence-attachment is permanent on accept, no per-merge undo (manual photo deletion is the escape hatch). Not implemented. First spec of the productization arc (de-Yunafication workstreams were assessed in-chat 2026-07-18; this is the onboarding workstream, split out per owner request).
**Owner constraints encoded:** NO Apple Photos integration (owner cannot test it — dropped entirely, not deferred). Video walkthrough de-risked: no in-app capture; a video FILE is just another ingest input, frames sampled locally.
**Why this exists:** filling the wardrobe is the single biggest barrier to anyone using the app. The unlock already in the codebase: `extract-pieces` pulls individual garments from OUTFIT photos, so onboarding can consume "photos of me wearing my clothes" — which every user already has — instead of per-garment hanger photography. Bonus: worn photos are the app's own preferred evidence class (`fit_visible`, `real_context`), and accepted imports can seed the calibration library, so one import bootstraps BOTH cold starts (wardrobe + taste).

## Design principles

1. **Local-first ingest.** The primary door is files on disk. No cloud photo API is required for the core flow; Google Photos arrives via Takeout ZIP (no API) in Phase 1 and the Picker API only as Phase 4 sugar.
2. **Nothing trusted lands untriaged.** Every imported piece enters `tag_state: provisional` with `fit_confidence` honest-low and passes through a human review/merge gate before it can be auto-styled. The existing provisional/needs-review machinery is the landing zone — no new trust states.
3. **Dedup runs against the EXISTING wardrobe too**, not just within the import batch. This is both correctness (re-runs and follow-up imports must not duplicate) and the owner's own live test: importing photos of clothes already in the 227-piece wardrobe must MERGE (attach worn photos as evidence) rather than duplicate.
4. **Visual grounding, house pattern.** Garment identity clustering is done the way this app already does visual judgment — contact sheets + model adjudication — not a new local-ML embedding stack.
5. **Cost is visible before it is spent.** BYOK users see an estimate (from provider.js's existing pricing tables) before the batch runs, and the pipeline is two-tier: cheap model for detect/crop/cluster, full model only for final tagging of canonical garments.

## Phase 1 — Ingest doors + detection

- **Folder / ZIP drop** (`routes/onboarding.js`, new): accept a directory of images, a plain ZIP, or a Google Takeout ZIP (recognize the Takeout folder structure and album metadata JSONs; use album name + EXIF date as hints, ignore the rest). Accept video files (mp4/mov) in the same drop: sample frames locally (ffmpeg, ~1 fps with a sharpness filter), then treat frames as ordinary ingest images. This IS the closet-walkthrough feature, minus everything scary — no capture UX, no realtime anything.
- **Classification pass** (cheap model tier, batched contact sheets): each image → `worn_outfit` (person wearing clothes) / `garment_only` (hanger, flat-lay — the video frames mostly land here) / `irrelevant` (no usable garment). Irrelevant images are dropped with a count shown, never silently.
- **Extraction:** `worn_outfit` images go through the existing `extract-pieces` path; `garment_only` images through the existing single-piece tagging path. Reuse, don't fork — if extract-pieces needs a batch wrapper, the wrapper is new; the extraction prompt is not.

## Phase 2 — Cross-photo garment dedup (the genuinely new capability)

- Build crops per detected garment; cluster by garment identity via batched **contact-sheet adjudication** (cheap tier): "which of these crops are the same physical garment?" — transitive-merge the verdicts into clusters. O(n²) avoidance: pre-bucket by category + dominant color (both already extracted) so sheets stay small.
- Each cluster → one **canonical piece**: best crop chosen (sharpest, most frontal) as `photo`, best on-body shot as `worn_photo`, remaining shots retained as evidence (new `piece_import_evidence` table — additive migration; the `pieces` schema is untouched).
- **Merge-vs-existing:** every cluster is also adjudicated against same-category existing wardrobe pieces (their thumbs are already on disk). Match → proposed MERGE (attach evidence to the existing piece, no new piece). Ambiguous → surfaced to the review gate, never auto-decided.
- Occasion-evidence seeding (small, high-leverage): a garment repeatedly worn in photos classified as real-context gets that noted in its import evidence — reviewable input to occasion confidence, not an automatic tag write.

## Phase 3 — Bulk tagging, cost gate, review gate

- **Cost preflight:** after clustering, show the bill before the expensive step: "~N canonical garments to tag, ~M merge candidates; estimated $X (full-model tagging) + $Y already spent (classification/clustering)." Proceed / trim selection / cancel.
- **Full tagging** (existing tagger prompts, full-model tier) runs only on approved canonical garments.
- **Review gate UI** (new component, Wardrobe tab): triage queue — accept / merge-into-existing (with the candidate shown) / not-my-garment / skip. Batch accept per category. Accepted pieces land `provisional`; the existing wardrobe UI already knows how to display and graduate those.
- **Calibration seeding (owner ruling 2026-07-18 — default depends on instance state):** accepted worn-outfit photos with real context are offered to the calibration library as positives. Checkbox defaults **ON when the import runs inside first-run onboarding** (empty calibration library — this is the taste bootstrap) and **OFF when the wardrobe already has a curated calibration library** (protects an established taste signal, e.g. the owner's 34 curated images, from dilution during live testing). Always visible, always overridable per import.

## Phase 4 — Google Photos Picker API (deferred sugar)

Browser-based multi-select against the user's Google Photos without a Takeout round-trip. **Verify current API status before building** (the Library API scope restrictions of March 2025 made Picker the supported third-party path at the time; re-confirm terms + quota for a BYOK desktop app). Ships only if Phase 1's Takeout door proves the demand; nothing in Phases 1–3 depends on it.

## Acceptance

- Hermetic pipeline tests with fixture images (tmpdir DB per spec-21 doctrine; `wardrobe.db` mtime untouched by the suite — the ratchet from specs 21/29 must hold).
- Dedup contract tests: same garment in two fixture photos → one canonical piece; fixture matching an existing seeded piece → merge proposal, not a new piece; re-running an identical import is a no-op.
- Cost gate test: the expensive tier cannot run without a recorded preflight approval in the import session.
- **Live smoke (owner):** (a) drop a folder of ~20 real photos mixing new garments and already-owned ones → verify merges proposed for the owned ones, no duplicates created after accept; (b) drop one short closet video file → frames sampled, hanger garments extracted; (c) cancel at the cost gate → verify zero full-model tagging calls in the log.

## Risks / out of scope

- **Model misclustering** is the main quality risk — the review gate is the containment; nothing writes to trusted wardrobe state without human accept. Start conservative (over-split rather than over-merge; merging later is one click, un-merging is painful).
- **Merge evidence-attachment is permanent on accept (owner ruling 2026-07-18):** no per-merge undo ships; a wrongly attached evidence photo is removed by deleting it from the piece manually. Accept means accept.
- **ffmpeg is the app's first binary dependency (owner ruling 2026-07-18: accepted for v1).** The future platform/packaging spec must account for bundling or detecting it; if ffmpeg is absent at runtime, video files are skipped with a visible count and an install hint — images still import normally.
- Import volume cost is real; the two-tier split plus the preflight keeps it consented. No silent caps: anything dropped (blurry frames, irrelevant photos, oversized batches) is counted and shown.
- Out of scope: Apple Photos (owner ruling — untestable), Instagram/Meta export parsing (it's just "more photos" — a folder-drop already handles an unzipped export; dedicated parsing waits for demand), purchase-history mining (v2 enricher), any in-app camera/capture UX, and auto-graduation of imported pieces past provisional (the existing trust ladder is the only path up).
