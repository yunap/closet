# Visual Composer — "Use my wardrobe"

How the "Use my wardrobe" outfit generator works, end to end. This is the
model-facing flow: you give a brief, the app filters your closet, one model call
composes outfits from photos, and the results are validated before display.

**How to read the diagrams — shape and color tell you who does the work:**

```mermaid
flowchart LR
    A["app code"]:::app ~~~ R["wardrobe rules"]:::rules ~~~ M{{"LLM · text model"}}:::model ~~~ I{{"Image · image model"}}:::model ~~~ D{"decision"}:::check
    classDef app fill:#eef2ff,stroke:#6366a0,color:#1e2140;
    classDef rules fill:#f3edfe,stroke:#7c6bd6,color:#2f2557;
    classDef model fill:#c9efe0,stroke:#0f8f68,color:#06382b;
    classDef check fill:#faeeda,stroke:#ba7517,color:#4a2f06;
```

- **Rectangles** — the app's own code (indigo = plumbing & ui, purple = product / wardrobe rules).
- **Hexagons** — a call to a model: `LLM ·` = the text model (Claude), `Image ·` = the image model (GPT-4o). The only places a model is involved.
- **Diamonds** — decisions; the amber fill also marks validation & fallback steps.

The one thing to remember: **a model is called only at the hexagons.**
Everything else — filtering, gating, backfill, rendering — is the app's code.

## Overview (PM altitude)

```mermaid
flowchart TD
    A["You set the brief<br/>occasion, season, mood, request"] --> X["Resolve shared styling context<br/>values + source provenance"]
    X --> B["Gather your wardrobe<br/>all active closet pieces"]
    B --> C["Filter to a roster<br/>hide unsuitable, cap photos"]
    C --> D["Assemble AI context<br/>weather, feedback, favorites"]
    D --> E{{"LLM · composes outfits<br/>sees every piece's photo"}}
    E --> F{"Structurally valid<br/>outfits?"}
    F -->|enough| I["Show outfit cards<br/>in a new thread"]
    F -->|none valid| G["Backfill locally<br/>real wearable outfits"] --> I
    F -->|some, but too few| H["Pad with diagnostic cards<br/>flagged 'needs review'"] --> I

    classDef app fill:#eef2ff,stroke:#6366a0,color:#1e2140;
    classDef rules fill:#f3edfe,stroke:#7c6bd6,color:#2f2557;
    classDef model fill:#c9efe0,stroke:#0f8f68,color:#06382b;
    classDef check fill:#faeeda,stroke:#ba7517,color:#4a2f06;
    class A,X,B,I app;
    class C,D rules;
    class E model;
    class F,G,H check;
```

Two things worth knowing at this altitude:

- There is **exactly one model call** (stage E). No tools, no multi-turn — the
  model gets one shot with a photo of every rostered piece.
- **Nothing is "repaired."** In advisor mode the app never swaps pieces to fix a
  broken outfit. Invalid outfits are dropped; then the app either backfills with
  locally-generated real outfits (only when the model produced *zero* valid ones)
  or pads the remaining slots with diagnostic "needs review" cards.

> **Weather-location correction, 2026-08-19:** the Visual Composer header exposed the saved
> weather location, but `POST /generate-wardrobe-outfits-visual` did not read it; "Current season"
> therefore used only the season/request text heuristic. The endpoint now resolves today's live
> forecast from the saved home location and passes the exact numeric profile into composition.
> Explicit Spring/Summer/Fall/Winter/Very hot/Very cold selections remain hypothetical briefs and
> deliberately do not fetch or get overridden by today's local weather. This behavior now belongs
> to `resolveStylingContext` (`styling-engine/stylingContext.js`), shared with selected-piece
> composition. Response debug includes the chosen source and any conflicting evidence.

> **Shared-composer scope, 2026-08-19:** garment wear facts and explicit renderer
> `styling_instructions` apply here as well as bounded freeform. The composer judges the relevant
> part of a numeric range: an evening request near a cooler low should include a removable
> arrival/departure layer when the roster supports one, even when dinner itself is indoors.
> Image labels also carry authoritative `opacity` and explicit `needs_base` values; visual texture
> cannot make an opaque, independently wearable garment sheer or introduce an unverified base.
> Multi-option Visual Composer runs receive comparison-set variety guidance. Saved-outfit
> formula-similar variants explicitly disable it; adjacent exploration retains it.

### Stage map

| Stage | What happens                        | Where                                                             |
| ----- | ----------------------------------- | ----------------------------------------------------------------- |
| A     | User fills the brief, hits generate | `generateWholeWardrobeOutfits` — `src/components/StylistChat.jsx`  |
| X     | Normalize values, choose field authority, build profiles and weather | `resolveStylingContext` — `styling-engine/stylingContext.js` |
| B–H   | Server builds and validates outfits | `generateWholeWardrobeOutfitsVisualInternal` — `routes/ai.js`     |
| C     | Roster construction (deep dive)     | `buildVisualComposerRoster` — `styling-engine/rules.js`           |
| E     | The model call                      | `askStylistWithUsage` with `WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM`|
| I     | Cards rendered back in the thread    | `generateWholeWardrobeOutfits` render path — `StylistChat.jsx`    |

---

## Stage 3 deep dive — "Filter to a roster"

Two functions run back to back. First a **suppression pass**
(`filterWholeWardrobePiecesForGeneration`, `styling-engine/rules.js:1939`) drops
pieces the app doesn't trust for generation at all. Then
`buildVisualComposerRoster` (`styling-engine/rules.js:1992`) runs a 4-step gate
pipeline and an image-budget cap to produce the final roster (≤ 90 photos, below
Claude's 100-image limit).

```mermaid
flowchart TD
    P["Active pieces<br/>status = 'active'"] --> S["Suppression pass<br/>wholeWardrobePieceTrustDecision<br/>+ hot-weather outerwear cap (keep 3 lightest)"]
    S --> S1["Step 1 — no photo<br/>drop pieces with no image"]
    S1 --> S2["Step 2 — category gate<br/>drop accessories (unless opted in)"]
    S2 --> S3["Step 3 — weather / register / footwear<br/>register ceiling, footwear comfort,<br/>hot: insulating; cold: shorts, bare, linen"]
    S3 --> S4["Register-target + activity-tag gates<br/>enforce a formality floor & activity rating"]
    S4 --> CAP{"Pool > 90<br/>images?"}
    CAP -->|no| R["Roster<br/>grouped by category"]
    CAP -->|yes| CAT["Step 4 — image budget cap<br/>per-category ceilings (top 30, bottom 25,<br/>shoes 15, dress 10, outerwear 8, other 5),<br/>then global trim by relevance score"] --> R

    classDef rules fill:#f3edfe,stroke:#7c6bd6,color:#2f2557;
    classDef check fill:#faeeda,stroke:#ba7517,color:#4a2f06;
    classDef app fill:#eef2ff,stroke:#6366a0,color:#1e2140;
    class P,R app;
    class S,S1,S2,S3,S4,CAT rules;
    class CAP check;
```

Engineer notes:

- **Selected-piece bypass.** Every gate checks `isSelected(p)` first — a pinned
  piece skips every exclusion (photo, category, weather, register, cap). This
  path is shared with the selected-piece composer.
- **Register ceiling** (`resolveRegisterCeiling`) is a formality cap derived from
  occasion + mood + activity + free text. A piece whose formality rank exceeds
  the ceiling is excluded with `register: <formality> exceeds <ceiling> ceiling`
  (`rules.js:2109`). Missing formality metadata → excluded *and* a metadata todo
  is filed (`ensureMetadataTodo`, `rules.js:2068`).
- **Weather branch** (`rules.js:2313`) splits hot / cold / neutral. Hot drops
  insulating fibers and heavy pieces and caps outerwear to the 3 lightest; cold
  drops shorts, sleeveless/bare, and lightweight linen bottoms.
- **The cap is category-aware, not just a global trim** (`rules.js:2417`).
  Ceilings are scaled down proportionally if their sum exceeds `maxImages`, each
  category is sorted by `comparePieces` (relevance score, then recency, then id),
  and anything over its ceiling is excluded as `roster cap: category limit`. A
  final global trim (`rules.js:2651`) handles the rare case where per-category
  limits still overflow.
- **Everything excluded is recorded** in `excluded[]` with a reason and counted
  in `debug.excludedCounts` — this is what powers the diagnostic cards in stage 7
  and the `[Visual Composer Roster]` server log.
- **Per-piece prompt lines carry register hints.** Each roster line sent to the
  model (`ID {id}: {name}`) is appended with `; fabric: {fabric_category}` and
  `; reads_as: {reads_as}` when present (`composerPieceLineSuffix`, `routes/ai.js`,
  shared with the selected-piece composer). This is additive text next to the
  untouched photo — no gate, no roster change — so the model can see the register
  facts the tagger already recorded (e.g. "sporty casual pants") instead of
  composing from name + photo alone (spec 30).

---

## Stage 7 deep dive — "Show outfit cards"

The server responds with `{ feedback, structuredOutfits, debug }`. The frontend
(`generateWholeWardrobeOutfits`, `src/components/StylistChat.jsx:3150`) turns that
into an assistant message and renders one card per outfit.

```mermaid
flowchart TD
    RESP["Server response<br/>feedback + structuredOutfits + debug"] --> TAG["Tag each outfit<br/>textOnly: true, wholeWardrobe: true"]
    TAG --> MSG["Append assistant message<br/>source: 'visual_composer'"]
    MSG --> MEM["Set thread memory<br/>so follow-up chat has context"]
    MSG --> CARDS["Render outfit cards"]
    CARDS --> OK["Normal card<br/>piece photos, strength, watchFor, reason"]
    CARDS --> BROKEN["Diagnostic card<br/>broken:true → 'needs review' + violation text"]

    classDef app fill:#eef2ff,stroke:#6366a0,color:#1e2140;
    classDef check fill:#faeeda,stroke:#ba7517,color:#4a2f06;
    class RESP,TAG,MSG,MEM,CARDS,OK app;
    class BROKEN check;
```

Engineer notes:

- **`textOnly: true` matters.** These cards show the *individual piece photos*
  plus text (strength, watchFor, reason) — there is no rendered "worn outfit"
  image for whole-wardrobe results (`StylistChat.jsx:3160`). The card component
  keys off `wholeWardrobe` / `previewOnly` to pick this layout
  (`canRenderStructuredOutfit`, `StylistChat.jsx:2008`).
- **Diagnostic cards are real messages, not errors.** A card with `broken: true`
  / `diagnosticOnly: true` renders with a "needs review" strength and the
  violation text the server attached (`buildBrokenModelCard` /
  `buildBrokenDiagnosticCard`, `routes/ai.js`). To a PM this is "what the user
  sees when the model underperforms."
- **Thread memory is set here** (`setThreadMemory`, `StylistChat.jsx:3173`) so a
  follow-up like "swap the shoes on #2" has the generated outfits as context.
- **`data.debug`** is stored on the message and drives the roster / selection
  debug panel — every exclusion reason from stage 3 is available here.

---

## Status

Documented: "Use my wardrobe" (this flow). Other model-facing flows
(selected-piece composer, ideal suggestions, stylist chat, trip planning) are not
yet mapped — add them as sibling files under `docs/flows/`.
