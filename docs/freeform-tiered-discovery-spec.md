# Freeform tiered wardrobe discovery

**Status:** HISTORICAL — **implementation removed from the code 2026-08-19**; the design principle
is inherited by batched discovery  
**Flag:** `WARDROBE_FREEFORM_TIERED_DISCOVERY` no longer exists; setting it does nothing  

> **What was kept and what was removed.** The important contribution is the *principle* — retain
> complete identity recall while retrieving detailed truth on demand — and the owner ruling below
> still stands. The *implementation* was coupled to the sequential tool loop that failed the cost
> test: its expansion contract converted prompt facts into tool calls, and each added iteration
> writes a new cache entry over the whole conversation at 1.25×. Measured on
> `thread_1787128902650`: the 72.4% smaller wardrobe block saves ~$0.064 while the extra iterations
> cost ~$0.076. Batched discovery reintroduces only the identity representation it actually needs.
>
> **The measurements below are preserved as the record**, including the 57,817 → 15,941 character
> reduction across 251 identities and the wardrobe-independence clause, which remains a requirement
> for any successor. Rollout row 5's OFF arm was never run, so this flag never had a baseline.
> See [freeform-batched-discovery-spec.md](freeform-batched-discovery-spec.md).  
**Owner ruling:** preserve wardrobe omniscience at the identity and discovery level, not at the
full-detail prompt level. No active garment may become undiscoverable merely because it was omitted
from an initial shortlist. Expand retrieval when identity, coverage, or viable choice is uncertain.

## What changes

The full stylist previously received every stable field for every active garment in its system
prompt. The flagged path replaces that block with an all-active-piece discovery index. Each entry
contains exact piece ID and saved name; category through its containing group and exact count; one
brief visual identity (`reads_as`, then background colour or saved colours as fallback); and trust,
role-permission and provisional-tag flags when present.

It deliberately excludes construction, fit, fabric, opacity, tuck behavior, silhouette, weather,
occasion and styling instructions. Those facts remain in the live piece record and are loaded only
when the turn needs them. Flag off preserves the previous manifest path.

This is not a ranked shortlist. `buildStylistConversationPayload` queries every `status='active'`
piece in stable ID order before building either representation. Recently-shown memory does not
remove identities from the index. Inactive pieces remain excluded exactly as before.

## Automatic expansion contract

| Need | Required expansion |
|---|---|
| Exact named or ID piece | `view_pieces` or `get_garment_details` |
| Composition, alternatives, or occasion/weather/activity viability | `search_wardrobe` |
| Broad category count | read the exact category heading; no tool call |
| Qualified counts or wardrobe-wide coverage | `wardrobe_coverage` |
| Sparse or uncertain result | broaden/repeat the relevant lookup before declaring a gap |

The existing verification contract remains mechanical: a piece named as a recommendation must have
been retrieved during that turn, and a layer/base piece must also have been visually seen. The index
supports recognition and routing, but cannot by itself authorize a recommendation.

**Live amendment, 2026-08-19.** Thread `thread_1787116405571` returned exact category counts with
zero searches, confirming identity-index correctness, but still paid router → `declare_intent` →
answer. Exact count/breakdown requests now use the compact `wardrobe_inventory` profile: the model
router decides eligibility and code returns database counts immediately. Coverage sufficiency and
gap judgment remain on the full stylist.

**Named-piece truth amendment, 2026-08-19.** Thread `thread_1787116925244` found piece 264 but
`view_pieces` omitted its manually confirmed `tuck_behavior:tucks_anywhere`; the model inferred a
hard no from `hem_finish:straight_loose` and answered incorrectly. Retrieved truth now includes tuck
behavior, and an exact unique saved name may seed the compact garment-fact profile without a broad
search. Conversation answers treat tags as evidence rather than infallible truth: manual/high values
are strong; missing/low values permit cautious multi-field inference; clear contradiction must be
disclosed; hem shape alone never decides. Automatic composition gates retain the conservative saved
field authority.

The corrected compact result in `thread_1787117547066` confirmed the judgment and cost path
(`execution_router;compact_garment_fact`, two provider iterations, zero cache read/write) but exposed
raw field and confidence labels. Compact fact answers now keep metadata private and speak in natural
garment terms; confidence still affects reasoning internally.

**Saved-visual correction, 2026-08-19.** `thread_1787117753981` showed the opposite failure mode:
piece 364 had no tuck behavior, low-confidence structure fields and an incorrect fabric tag, so the
compact answer repeated a loose-hem heuristic and asked for a photograph even though both hanger and
worn images were saved. The worn image directly shows a smooth full tuck. Compact garment-fact calls
now attach only the resolved garments' saved images (worn before hanger, four-image ceiling), and
visible behavior may correct weak/missing metadata. A shown configuration proves feasibility, not
styling success; the model must judge what is visible separately and cannot rank an unseen
alternative. Discovery identity and automatic-composition
safety authority are unchanged.

`wardrobeManifestIncluded` remains false in tiered mode and the separate
`wardrobeDiscoveryIndexIncluded` diagnostic becomes true. This distinction is load-bearing:
`search_wardrobe` may trim stable garment fields only when the full manifest is present. With only
the discovery index, search returns the full truth row so styling quality is not starved.

## Wardrobe-independence and recall

- every supplied active identity appears exactly once;
- ordering is category then numeric ID, never relevance;
- low-trust and recently-shown pieces remain discoverable;
- category headings give exact broad inventory counts;
- no initial ranking, score, occasion gate, or memory exclusion may hide an active identity;
- database-backed tools search all active pieces, not only index excerpts.

A future change that ranks, caps, samples or omits index entries requires a new owner ruling and a
held-out multi-wardrobe recall test. It is not an implementation detail of this flag.

## Offline measurement and acceptance

On a read-only copy of the current wardrobe on 2026-08-19:

| Representation | Active pieces | Characters | Rough tokens (chars / 4) |
|---|---:|---:|---:|
| Full stable-truth manifest | 251 | 57,817 | 14,455 |
| Tiered discovery index | 251 | 15,941 | 3,986 |

The wardrobe block is 72.4% smaller while retaining all 251 identities. This is a block-level
estimate, not a promised bill reduction: total cost also depends on cache writes/reads, provider
iterations and how often detailed retrieval expands.

Offline acceptance requires flag-off equivalence; all identities and no full judgment fields under
the flag; at least 55% reduction on a populated synthetic wardrobe; untrimmed detailed search rows;
and unchanged exact-ID, visual-layer and zero-result guards.

## Qualified-coverage amendment — 2026-08-19 — SUPERSEDED

> **Removed from the code 2026-08-19.** `qualified_coverage` is gone from the router enum, schema and
> prompt; its execution branch, coverage-only helpers and tests are deleted. It never ran for a user.
> Coverage remains a product capability and returns as a use case of shared batched discovery — see
> [freeform-batched-discovery-spec.md](freeform-batched-discovery-spec.md), which carries the
> acceptance cases below forward as implementation requirements. Everything in this section is
> historical; read it for the evidence contract, not for current behaviour.

Live thread `thread_1787122233484` showed that the full stylist used one ordinary search as an
exhaustive audit, mixed heavy outerwear into a lightweight question, and inferred rain handling from
material. The flagged router now has a bounded `qualified_coverage` profile with generic category,
clothing-weight and capability dimensions. Code loads the complete active category census; generic
lexical relevance selects at most eight saved photographs. The answer separates all-qualifier
primary matches from backups and names the failed qualifier. Clear purpose-built visual design may
establish function when weak tags disagree; material alone never proves weather protection. The
same structure supports dressy flat shoes, breathable tops, opaque dresses and similar conjunctive
supply questions—there are no garment IDs or rain-specific application branches.

**Owner correction, 2026-08-19.** A broad database category is not a garment kind: “lightweight
jacket” must not audit sheer cardigans merely because both are stored as outerwear. The router now
extracts a generic kind; `jacket_or_coat` is resolved through the centralized `garmentKind` reader.
Practical lightweight judgment uses structured weight plus photographs rather than treating the
`light` enum as the user’s definition. Sufficiency means repeatable functional coverage, not seven
different jackets for seven days. Final prose hides IDs, field names and model deliberation.

**Architecture correction, 2026-08-19.** The owner rejected anticipating every possible qualifier
with new prompt rules. Fixed weight/capability fields are replaced by a generic constraint array
(`dimension`, `target`) plus usage context. The bounded judge returns a structured evidence
classification: primary, plausible-but-unverified, backup-with-missed-dimensions, and unknowns.
Code validates every returned ID against the complete census and renders saved names. The governing
rule is provenance, not a catalog of cases: explicit/owner fact > clear observation > provisional
inference > unknown, and inference may never silently become verified fact.

**Enforcement amendment, 2026-08-19.** `thread_1787123957953` showed prompt-only provenance was not
enough: the model called visible utility details confirmed water resistance and again multiplied
need by trip duration. Router constraints now declare `observable | latent | mixed`, and every
classified piece declares its evidence basis. Code downgrades a visual/inference-only primary when
any latent constraint lacks explicit or owner-confirmed evidence. The router also emits an explicit
minimum quantity, defaulting to one unless simultaneous use/rotation/maintenance/backup is stated.
The renderer computes the headline from validated matches, removes known IDs and internal field
names, bounds each reason, and caps the complete response.
Evidence is attached per constraint dimension, not merely per garment: an explicit weight fact
cannot authorize a visual-only claim about latent weather performance.

**Live staged-coverage finding, 2026-08-19.** `thread_1787128659041` showed that separating a
text census from candidate visuals improved recall only partially: piece 361 surfaced, while 169
and plausible 190 were still removed before sight. Three calls cost 19,384 input / 2,867 output and
the renderer still leaked evidence language and truncated prose. This path is not accepted for
default-on. The next revision is generic recall-first selection: the census excludes only clear
physical failures, contextual/aesthetic qualifiers are decided with visual access to the complete
surviving set, and concise structured fields—not freeform evidence paragraphs—feed the renderer.

## Sparse-composition live result — 2026-08-19

The live matrix request in `thread_1787128902650` proved the discovery guarantee and disproved the
cost hypothesis. The model broadened after a zero-result anchor search, found piece 996783 and
submitted a verified outfit with pieces 996783, 92, 196 and 996771. No deserving identity became
unreachable. But the path took nine provider iterations and five searches, with 60,532 cache-write
and 212,147 cache-read tokens. It narrated each lookup, duplicated the completed card, contradicted
itself about piece 359 and omitted the requested untucked mechanic from `stylingInstructions`.

The next optimization is execution-level, not a narrower index. A single batched discovery result
must carry broadened anchor candidates plus requested support categories, after which one
composition/submission call selects the outfit. The existing identity index and broadening promise
remain unchanged. Intermediate deliberation is not user-facing output; explicit wear mechanics are
part of the submitted card contract.

## Live acceptance — owner-approved calls only

Compare flag off/on for: an exact named-piece question; a broad category/coverage question; an
ordinary occasion composition; and a deliberately sparse request whose first search must broaden.
Record total input/output/cache tokens, tool sequence, iterations, latency, factual correctness,
whether any deserving active piece became unreachable, and styling specificity. Default-on requires
lower total cost with no false wardrobe-gap claim, identity miss, construction mistake,
wear-mechanics omission, or material quality loss. The staged coverage and sparse composition
results above currently fail that bar. No paid call is authorized by this document.
