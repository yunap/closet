# yunap-closet

**Status:** Active — canonical domain vocabulary, introduced by PR 253 on 2026-08-24.

An AI-driven wardrobe and styling assistant: a user's photographed pieces are tagged, ranked,
and composed into outfits and capsules by a model-in-the-loop engine, gated by deterministic
rules and shaped by the user's own feedback and standing preferences.

This is a glossary, not a behavior reference. For how the gates, scores, caches, and retries
actually work, see [engine-behaviour-map.md](engine-behaviour-map.md). For what the user tells
the app and who reads it back, see [feedback-and-memory-map.md](feedback-and-memory-map.md).
For what the user can touch, see [app-surface-map.md](app-surface-map.md).

## Language

### Core entities

**Piece**:
A single wardrobe garment, shoe, or accessory — one row in the `pieces` table.
_Avoid_: Garment, item.

**Category**:
A piece's root taxonomy slot: `top | bottom | dress | outerwear | shoes | accessory`.

**Wardrobe**:
The full collection of a user's pieces.

**Candidate**:
A piece or assembled outfit still being scored or considered — the pre-filter pool, before
gating narrows it down to a roster.

**Roster**:
The curated working set of pieces accepted for a specific composition task, after gating has
narrowed the candidate pool.

**Outfit**:
A data object representing an assembled combination of pieces (`outfits` table).
_Avoid_: Look.

**Board**:
A saved, persisted rendering of an outfit the user has reacted to (`saved_boards` table).
Distinct from an outfit: a board is specifically the reacted-to, saved unit.

**Card**:
A UI-rendered unit presenting one proposal to the user — may represent an outfit or a plan
slot's proposal.

**Capsule**:
The general noun for a themed, bounded multi-outfit plan (seasonal, trip). Also appears as a
`PLAN_KINDS` value (`seasonal_capsule`) and as a `mission` value (`capsule`) — see Mission.

**Plan**:
The multi-slot structure a capsule or trip request is built against before being finalized as
outfits.

**Slot**:
One planned outfit-shaped placeholder within a plan, awaiting pieces from the roster.

**Mission**:
The normalized request-intent axis: `mix | capsule | wildcard`. Selecting `mission: 'capsule'`
is what invokes the capsule-planning subsystem — not a naming conflict with Capsule, but the
trigger for it.

**Archetype**:
A code-side classification of an outfit's compositional formula, producing a `formulaFamily`
bucket. Distinct from the Style Constitution's own, unrelated use of "formula" — see below.

**Occasion**:
The context a piece or outfit is intended for (e.g. `casual`, `evening`). A separate axis from
Activity and Mood.

**Activity**:
A structured physical-activity axis (e.g. `walking`, `hiking`), resolved via
`resolveActivityProfile`. Not a mood or an occasion.

**Mood**:
A free-form vibe/taste axis, explicitly distinct from Occasion and Activity.

**Formality**:
A piece-level tag: `lounge | everyday | elevated | dressy`.

**Register**:
Shorthand for "formality level" used specifically in the ceiling/ranking context — see
Register Ceiling.

**Register Ceiling**:
The maximum Formality an Occasion permits, expressed in formality terms.

**Anchor Piece**:
A user-requested must-include piece that bypasses the hard gate entirely.
_Avoid_: unqualified "anchor" — see Calibration Anchor and Image Anchor for the other senses.

**Calibration Anchor**:
A wardrobe piece used as a ground-truth example to calibrate the tagger's vocabulary.
_Avoid_: unqualified "anchor."

**Image Anchor**:
The reference photo an editorial image-generation call must stay visually faithful to.
_Avoid_: unqualified "anchor."

**Support Role**:
A visual-composition role value (`support` / `support_piece`) describing a piece's job within
an outfit.
_Avoid_: unqualified "support" — see Walk Support and Support-Only for the other senses.

**Walk Support**:
A footwear-comfort field (`high | medium | low`) unrelated to Support Role.

**Support-Only**:
A gate/trust outcome (`role_permission: support_only`) meaning a piece is eligible only as a
secondary piece, never as an auto-use hero. Unrelated to Support Role and Walk Support.

**Piece Season**:
A curated, piece-level tag (`warm | cool | year-round`).

**Requested Season**:
The season named or implied by the current request/intent context.

**Calendar Season**:
The canonical `spring | summer | fall | winter` projection used to match executable seasonal
applicability. A Requested Season of `current season` remains intact for weather/UI policy but is
projected against the request date before owner constraints or accepted lessons are matched.

**Applicability Context**:
The canonical executable projection used to decide whether a stored owner constraint, owner
guidance line, or accepted lesson applies now. It combines Occasion, Activity, Calendar Season,
request date, and normalized weather flags. It is not display copy and is distinct from the raw
Requested Season or weather wording.

**Climate Season**:
The season implied by live or heuristic weather, which can diverge from Requested Season (see
`seasonIsCalendarOnly`).

**Weather Profile**:
The structured object describing physical conditions for a request, including hot, cold, extreme
heat, rain, wet exposure, and source provenance. It is distinct from Calendar Season: `indoor` is
an environment/weather condition, not a season, and summer does not itself prove heat or rain.

**Visual Weight**:
Two related but distinct mechanisms sharing one name: a stored field on shoes/accessories
(`delicate | slim | medium | chunky`, replacing fabric_weight for those categories), and a
derived scoring concept (`visualWeightProfile`) used elsewhere.

**Warmth Tier**:
A derived tier (`light | medium | heavy`), partly computed from fabric_weight but not the same
value — fabric_weight describes textile substance, not a warmth verdict.

**Bareness**:
A derived, binary skin-exposure signal (high/null) feeding the hard gate.

**Exposure Degree**:
A derived, graded skin-exposure fraction (0–1) feeding weather scoring. Deliberately distinct
from Bareness — different consumers need different granularity.

**Tag State**:
A piece's tagging completeness: `untagged | provisional | fully_tagged`.

**Confidence**:
Per-field tagger certainty (`high | medium | low | manual`). A data-quality axis, distinct from
Trust.

**Trust**:
Whether the engine should auto-select a piece at all (`recommendation_status`,
`auto_use_trust`, the hard gate's verdict). A usability axis, distinct from Confidence.

**Manual Override**:
A JSON path the owner has manually pinned, protected from being overwritten by a future tagger
run.

**Style Constitution**:
The single ratified authority document for taste and style rules. Curated prose, not a
structured/queryable rule set — distinct from Owner Constraint.

**Owner Constraint**:
A structured, queryable standing prohibition row (by piece, category, material, or footwear
type, crossed with occasion/activity/season/weather). Distinct from Occasion Exclusion.

**Occasion Exclusion**:
A per-piece veto list for specific occasions. A separate gate layer from Owner Constraint, even
though both express "the owner's personal rule."

**Tagged Style Lane**:
One of ten fixed, tagger-authored aesthetic categories on a piece (e.g. `artistic_minimal`,
`modern_bohemian`).
_Avoid_: unqualified "style lane."

**Derived Style Descriptor**:
A different, smaller set of English-phrase style descriptors (e.g. "relaxed earthy") computed
from free text by `styleLanes()`. Not the same taxonomy as Tagged Style Lane.
_Avoid_: unqualified "style lane."

**Style-Lane Concept (Constitution)**:
The Style Constitution's own open, unenumerated Layer 4 taste concept (bohemian, folk/artisan,
romantic, etc). A third, looser vocabulary — not the same as either of the above.

**Calibration Image**:
A reference image used to teach the model taste (`calibration_images` table).

**Stylist Feedback**:
The umbrella table storing both owner rules and board/outfit reactions.

**Todo**:
A task auto-created from a gate exclusion or a retag suggestion.

**Thread**:
The persisted, user-facing conversation record (`chat_threads`).

**Session**:
The state key (`session_id`) a thread's engine state is keyed by.

**Turn**:
One round of conversational exchange within a thread; may itself contain a multi-step tool
loop.

### The hard gate

**The Hard Gate**:
The canonical name for `wholeWardrobePieceTrustDecision` — the piece-level pass/fail trust
decision. When "gate" is used unqualified in conversation about piece eligibility, this is the
default referent.
_Avoid_: unqualified "gate" for this concept — prefer "the hard gate."

**Gate Mode**:
One of the two literal `mode` values (`'gate'` vs `'advisor'`) on the outfit-level gating
function. Gate mode excludes; advisor mode annotates without excluding.

**Gate-Eligibility Check**:
A data-completeness precheck (`missingGateFields`) — whether a piece has enough data to be
considered by the taste/rule gates at all. Distinct from the taste/rule gates themselves.

**Role Vocabulary**:
Three competing, not-fully-reconciled naming schemes exist for a piece's compositional role:
the tagger writes unsuffixed values (`hero`, `support`, `grounding`, ...); code matches on
suffixed values (`hero_piece`, `support_piece`, `grounding_piece`); `garment_intelligence`
carries a third, overlapping set. The suffixed form is canonical — it is the only one archetype
matching reads. See [ADR-0001](adr/0001-role-vocabulary-reconciliation.md).

### Verbs

**Propose**:
To assemble and offer a candidate outfit to the user (the freeform chat path).

**Gate** (verb):
To exclude a piece or outfit via a hard, deterministic rule.

**Repair**:
A narrower operation than the name implies: rewrites outfit prose, and — only under the hiking
activity — swaps exactly one shoe. Does not fill missing slots.

**Rank**:
To order candidates, often vision-assisted, by score.

**Score** (verb):
To numerically evaluate a candidate, additive/subtractive — distinct from Gate, which removes
rather than weighs.

**Tag**:
To run the tagger on a piece for the first time.

**Retag**:
To re-run the tagger on an existing, previously-tagged piece.

**Critique**:
A model-authored second pass over already-generated outfits.

**Evaluate**:
To score an existing or uploaded outfit photo.

**Review**:
A human/owner action on a flagged item (e.g. the import review queue). Distinct from Critique
and Evaluate, which are both model-authored.

**Compose**:
To assemble pieces into an outfit (the whole-wardrobe generation subsystem, informally "the
composer").
_Avoid_: unqualified "generate" for this sense.

**Render**:
To produce an image via an image-generation model call.
_Avoid_: unqualified "generate" for this sense.

**Validate**:
To check structural completeness (e.g. required roles filled, slot constraints met) — distinct
from Gate, which checks taste/rules rather than structure.

**Declare**:
For the model to state structured intent (occasion/activity/mission) before searching or
proposing.

**Search**:
To query the wardrobe for pieces matching criteria.

**Resolve**:
To normalize a raw or ambiguous input into a structured value (e.g. `resolveActivityProfile`).

**Normalize**:
To coerce raw text or model output into the controlled vocabulary or schema.

**Merge**:
To reconcile new tagger output against existing manual overrides and prior data.

**Diversify**:
To rerank a generated set via a penalty that spreads variety across it.
