# Occasion Profiles — Ratification Checklist (DRAFT)

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
