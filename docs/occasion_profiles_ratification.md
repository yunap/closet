# Occasion Profiles — Ratification Checklist

**Not a draft.** The title said DRAFT until 2026-07-30 while the body carried a ratified
amendment (register ceilings, 2026-07-05) plus two more added since. Nothing in the repository
linked here, which is why a later session spent a day changing occasion behaviour without finding
it. Linked from `docs/capsule-index-and-plan.md`.

**This document is authoritative for occasion behaviour.** Read it before changing a
`register_ceiling`, an occasion profile's keywords, or the prompt guidance that routes a slot to an
occasion.

Same rules as the Style Constitution: check `[x]` to keep, edit freely, unchecked = cut.
Verdict legend: **HARD** = stays a prohibition (validity), **SOFT** = becomes discouraged
(score penalty, never suppression), **CUT** = remove. My recommendation is pre-filled;
override anything.

These lists were authored by a model during the hiking experiments and have never been
ratified. Per the constitution's amendment rule, they have no force until you check them.

---

## Profile: outdoor_active — "Outdoor Active / Walking Heavy"

**Triggering:** currently fires on `walk`, `walking`, `city walk`, `park walk` (in occasion
OR mood text). Recommendation: trail-level activities only.
- [x] Keep keywords: `hike`, `hiking`, `trail` — and rename profile "Trail / Active Outdoor"
- [x] CUT keywords: `walk`, `walking`, `city walk`, `park walk`, `beach walk`, `active`
      (your lookbook is full of ordinary walks in sandals and skirts; a casual walk is not a
      hike). Ordinary-walk shoe practicality is already covered by the body contract.

Prohibited materials: silk **[SOFT]** · satin **[SOFT]** · chiffon **[SOFT]** ·
lace **[SOFT]** · ~~delicate lace~~ **[CUT — duplicate]** ·
~~high-maintenance fabrics~~ **[CUT — unmatchable]**
- [x] Ratify as marked, or edit: ______________

Prohibited footwear: heel/heels **[HARD — trail validity]** · wedge/wedges **[HARD]** ·
dress shoes **[HARD]** · mules **[SOFT — backless on a real trail is a fair warning, not a
ban]** · sandals **[SOFT — you own walkable sandals; let scoring + the model judge]** ·
delicate sandals **[SOFT]** · flip-flops **[HARD on trails]**
- [x] Ratify as marked, or edit: ______________

Prohibited pieces: blouse(s) **[SOFT]** · dressy top(s) **[SOFT]** ·
dressy shorts **[SOFT]** · dress(es) **[SOFT — Yuna 2026-06-12 (revision): athletic trail dresses are a legitimate category; city dresses are handled via per-piece exclusions]** ·
skirt(s) **[SOFT — Yuna 2026-06-12 (revision): trail skirts are legitimate; city skirts handled via exclusions]**
- [x] Ratify: blouses/dressy tops/dressy shorts are SOFT; dresses/skirts are SOFT — revised Yuna 2026-06-12.


Preferred (soft bonuses — uncontroversial): cotton, knit, denim, utility, canvas; sneakers,
walking flats, flat rugged boots
- [x] Keep

### Round 2 Ratification Additions (Yuna 2026-06-12)
- **Boots in Hot Weather**: `discouraged_footwear_warm` contains `["boot", "boots", "ankle boot", "ankle boots"]` when hot. (SOFT)
- **Suede material**: `discouraged_materials` contains `suede` year-round. (SOFT)
- **Footwear Requirement**: `required_footwear` includes sneakers, athletic, trail, rugged, lace-up, walking flats. Enforced via automatic repair/swap layer. (HARD)

## Profile: outdoor_daytime_social — "Festivals / Markets / Picnics"

- [x] Keywords fine (`festival`, `market`, `fair`, `picnic`, `outdoor cafe`); the hardcoded
      vibe quote "'Urban Artisan'" should soften to "textured, airy, intentional" — aesthetic
      gravity is a weight, not an occasion property.
- Hot-weather prohibitions (cashmere, heavy wool, dense knits, thick corduroy):
  **[HARD — redundant with the weather filter but harmless]** · winter boots in summer
  **[HARD]**
- [x] Ratify

**Amendment (Yuna, 2026-08-21):** bare `market` over-matched — this profile was written for
kid graduations, garden parties, wineries, and crafts/wine festivals, not an ordinary grocery
farmers-market run. Surfaced by a live trace of thread `thread_1787288298461` ("What should I
wear to the farmers' market"), where the model read `keywords` in the injected
`OCCASION_PROFILES` JSON as if it were a literal, exhaustive trigger list and matched `market`
without weighing register. Rejected fix: enumerating more literal phrases (`farmers market`,
`grocery`, `craft market`...) in the keyword arrays — that's the same failure mode one clause
later, since real requests will keep using wording nothing on the list anticipated. Instead the
classification instruction in `core.js` (right before `OCCASION_PROFILES` is serialized into the
system prompt) now states explicitly that `keywords` are illustrative examples, not an exhaustive
match list, and that ambiguous nouns like "market" should be classified by the register/setting
the request actually implies — defaulting to the permissive `casual`/`city` profiles absent real
festival/social/event framing. `occasions.js`'s keyword lists are unchanged.

## Profile: city_smart_casual

- [x] CUT keyword `work` (matches "workout") — replace with `office` only (already present)
- ~~uncomfortable heels~~ **[CUT — unmatchable judgment word]** ·
  ~~athletic running shoes (unless styled deliberately)~~ **[CUT — instruction inside a
  matcher; the "styled deliberately" judgment belongs to the model]**
- [x] Preferred lists fine — keep

## Profile: evening_social

- [x] No prohibitions, preferred-only — keep as is

## Profile: home_loungewear

- structured denim **[SOFT]** · outerwear coats **[SOFT]** · heeled shoes **[SOFT]** ·
  formal blazers **[SOFT]** (none of these are *invalid* at home — just unlikely; soft is
  enough and keeps "throw a blazer over loungewear for a call" possible)
- [x] Ratify as marked, or edit: ______________

---

## Standing rules (ratify once)

- [x] Profile prohibitions may encode VALIDITY only; taste-adjacent entries are always SOFT.
- [x] Mood text can only trigger a profile via strong activity words (hiking, trail,
      festival, picnic, lounge...) — never via generic words (walk, city, work, home).
- [x] New profile entries by models are `[proposed]` and inert until ratified here.

---

## Ratified Amendment: Register Ceilings For Roster Gating

Status: **ratified by Yuna, 2026-07-05**. These values are wired into `occasions.js`
as `register_ceiling` fields. A ceiling excludes pieces above the ceiling before the
visual composer sees images; pieces below the ceiling remain eligible.

Register values: `lounge < everyday < elevated < dressy`.

| Occasion | Ratified `register_ceiling` | Notes |
|---|---:|---|
| casual | `everyday` | New profile. Low-key casual should keep the roster genuinely everyday. |
| city / city_smart_casual | `elevated` | Allows elevated city clothing while excluding dressy unless explicitly requested. |
| smart casual | `elevated` | Resolved through the city_smart_casual profile. |
| outdoor daytime social | `elevated` | Festivals/markets/picnics may include elevated pieces, but not dressy by default. |
| evening | `dressy` | No effective register ceiling. |
| gallery / art event | `elevated` | Yuna: "mostly elevated for me." Dressy gallery looks via typed request override. |
| travel | none / `null` | Trip slots carry their own contexts. |
| concert | `elevated` | Yuna: "mostly elevated for me." Dressy concert looks via typed request override. |
| home | `everyday` | Home loungewear should not pull in elevated/dressy pieces by default. |

Notes:
- `casual -> everyday` is the largest behavior change. It would make park-friend,
  coffee, errands, and low-key social rosters reject `elevated` and `dressy` pieces.
- Outdoor daytime social has an `elevated` roster target in addition to its ceiling. When
  enough elevated top/bottom/shoe coverage exists, lower-register pieces stay out of the
  visual composer roster before the model sees images; if coverage is thin, the gate degrades
  by slot rather than starving the model.
- For outdoor daytime social + walking, footwear uses a polished-walking target: everyday
  walkable shoes may remain available, while lounge or athletic/gym/running shoes stay out.
- Walking as an **activity** gates footwear only. It does not lower register. City + walking
  should still allow elevated clothing on walkable soles.
- Hiking as an activity may carry `register_ceiling: everyday` because trail context
  constrains clothing register, not just shoe comfort.
- Explicit typed register requests override upward. For example, `dressy` on a city or
  gallery request raises the effective ceiling to `dressy`; `not dressy` lowers it.

---

## Amendment 1: An explicit occasion tag overrides that occasion's ceiling, by one step

Status: **ratified by Yuna, 2026-07-30. Marked for revisit during testing.**
Amends the register-ceiling table above; does not replace it.

### What changed

A piece the owner has explicitly tagged for an occasion is exempt from that occasion's
`register_ceiling`, **capped at one register step**. Implemented in `registerCeilingVerdict`
(`styling-engine/rules.js`), which now takes the occasion; tests in
`test/freeform_gate_parity.test.js`.

- `elevated` tagged `casual` → **admitted** to casual slots
- `dressy` tagged `casual` → **still excluded** (two steps)
- a piece *not* tagged for the occasion → **still excluded**, unchanged

### Why

Live thread_1785380251549: the beige tailored linen shorts (piece 242, `formality: elevated`,
`occasions: casual, smart-casual, city`) were refused from a casual slot and the look shipped as
a needs-review card. The owner's ruling was that an explicit tag on a garment is a statement about
*that garment*, and should outrank a category default written for pieces nobody has judged. This
mirrors the precedent already in `pieceMatchesOccasion`: *"User tag overrides AI profile
confidence."*

### Measured effect on this wardrobe

- **174** pieces are tagged `casual`; **52** of those sit above the `everyday` ceiling.
- Of those 52: **50 are `elevated`** and now enter casual slots; **2 are `dressy`** and remain
  excluded by the one-step cap.
- **No other occasion profile changes at all** — no piece tagged for any other occasion exceeds
  that occasion's ceiling. This is exclusively a casual-ceiling-versus-casual-tag amendment.

### Tension with the original ratification — stated plainly

The 2026-07-05 note on this table reads: *"`casual -> everyday` is the largest behavior change. It
would make park-friend, coffee, errands, and low-key social rosters reject `elevated` and `dressy`
pieces."* This amendment keeps the `dressy` half of that intent and **relaxes the `elevated`
half**.

The owner chose this amendment before the 2026-07-05 ratification had been found — nothing in the
repository linked to this document. It was then re-confirmed on 2026-07-30 with the conflict
explicit, and **flagged to revisit in testing**: the question to answer live is whether casual
slots now pull in elevated pieces that read wrong for park-friend, coffee and errands, which is
exactly what the original ratification was protecting against.

Two narrower fallbacks were considered and are still available if testing says so: revert to the
ratified ceiling outright, or apply the exemption only to slots above `casual` (city, smart casual)
and leave low-key casual exactly as ratified.

---

## Amendment 2: Ordinary restaurant dinners are smart casual, not evening

Status: **ratified by Yuna, 2026-07-30.** Prompt guidance only — no ceiling in the table above
changes.

The plan-slot `occasion` field description told the model to *"map dinner/evening-restaurant/
night-out use cases to 'evening'"*, which contradicted the profiles this document ratifies:

- `city_smart_casual` keywords include **`dinner`** and `museum` → ceiling `elevated`
- `evening_social` keywords are `evening, dinner date, wine bar, theater, night out` → ceiling
  `dressy`

Owner's semantics: *"evening has historically been dressier than restaurant, and restaurant would
usually get smart casual or maybe city."* Following the old wording pushed a restaurant slot to a
`dressy` ceiling the owner does not want.

The description now routes ordinary restaurant dinners to `smart casual`/`city` and reserves
`evening` for genuinely dressier night-out contexts. **This aligns the prompt with the ratified
ceilings rather than changing them.** The old wording was unratified scaffolding from PR #58.

Pinned by two tests in `test/plan_outfit_set.test.js`: one on the guidance, one on the profile
semantics it describes, so a future ceiling change cannot silently invalidate the wording.
