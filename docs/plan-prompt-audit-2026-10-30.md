# Plan prompt audit: generic knowledge turned into rules

**Status:** audit for owner rulings, 2026-10-30. Implemented: item 0 (engine map 90); items 7, 10 and 11 (owner-approved, engine map 91). Item 7 took only the factual half of the set-aside rewording. Everything else awaits rulings. Evidence:
`thread_1793347659171` (guests at home, mornings, 3.7 Flash; capture `scratch/captures/thread_1793347659171/`) and an
outside review of that capture.

## Method

The question for every sentence: does it tell the model something it cannot know — the wearer's preferences, garment
facts, app constraints and requirements — or does it tell a capable stylist how to dress someone? The second kind is
a candidate for removal, but only after naming the failure it was added for (owner ruling 2026-10-02: never remove a
gate without naming the mistake it was added for). Every quote below was found in the capture and traced to its
first commit and, where one exists, its doc.

## What this thread shows first

- **The mornings were planned as outdoor walking slots.** The owner answered "it'll start by making dinner, and then
  we might go for a neighborhood walk". The stylist made three slots, each `activity: walking` with no `environment`,
  which defaults to outdoor. So each morning took the outdoor morning forecast (49–62°F) and the `walking` activity
  profile, labelled **"Lots of walking"** (`footwear-comfort.js`). The hosting part — the main part of the morning —
  disappeared. Sunday's look put the navy quilted puffer (cold-weather outerwear) on an outfit worn while hosting.
  The slot has one setting and one activity; it cannot say "mostly indoors, a possible short walk". That is the
  `time_outside: brief` design set aside on 2026-10-29 (`wip/situation-read-set-aside`), and the reviewer's
  "preserve which activity is primary".
- **The shortlist again took both cashmere sweaters**, describing its picks as "effortless, low-maintenance pieces
  that feel cozy at home" — a reason that does not engage with the garments it names (reviewer finding G).

## Findings

| # | Instruction (quoted from the capture) | Where | Added for | Verdict proposed |
|---|---|---|---|---|
| 0 | "a coat comes off indoors, at a table and in a museum, so the tops and knits worn all day are what keep the wearer warm" | shortlist, plans | trips, 2026-10-07 (engine map 47: short sleeves under three coats) | **Done** for plans (engine map 90); trips keep it — **rule** whether trips should lose it too |
| 1 | "a layer worn over a top and kept on indoors — a cardigan, a vest, a shirt worn open, a light knit — does two things at once…" | shortlist, plans + trips | owner 2026-10-09 (engine map 76: "I actually want to see some layered outfits"; no layer packed) | Remove the explanation; **keep** the app fact that open layers are filed under outerwear beside coats. The owner's wish to see layered looks is a preference — **rule** whether to state it as one (per-user) or leave layering to judgment |
| 2 | "shoes made for walking for walking-heavy days (not heels or wedges); … polished boots, loafers, or elevated flats for evening dining" | shortlist | 2026-10-07 (#320) | Remove the category-per-occasion list; keep the walking footwear gate (hard, owner rulings) and the shoe reasoning added today (engine map 89) |
| 3 | "TOPS VARIETY & FUNCTIONAL COVERAGE: an active or outdoor use case … needs … a genuinely functional, casual/active top … not a delicate, dressy, or elevated top" | shortlist | 2026-10-01 (hiking slot, `thread_1789585467294`) | Remove the tutorial; keep "a use case that needs several looks needs several tops" (a count fact the selection must honour) |
| 4 | "INDEPENDENT WEARABILITY: Default to independently wearable garments … prefer standalone tops" | shortlist | 2026-10-01 | Keep the `needs_base` rule (a garment fact: it cannot be worn alone); remove "default to / prefer standalone" (a styling preference) |
| 5 | LAYERING / OUTERWEAR: "Never rely solely on dressy … outerwear when … trail walking"; "A button-up … is not a substitute for outerwear"; "Avoid choosing rainwear … unless rain"; "ultralight, unlined … not accepted as the warm layer" | shortlist | 2026-09-10 → 10-09, each for a trip failure | Keep the last (it mirrors a validator floor, engine map 18 — an app requirement). The others are judgment; **rule** item by item, starting with the button-up sentence (trip `thread_1789628875203`) |
| 6 | Router/plan: a neighborhood walk becomes `activity: walking` → profile "Lots of walking" | router, plan slot, composer `activityProfile` | activity axis, 2026-06-13 | Not a wording fix. The slot needs to say how much walking (a possible stroll vs a day on foot) and that hosting is primary — the set-aside `time_outside` design, or an activity intensity. **Rule** which |
| 7 | Conversational prompt: "In a multi-outfit plan, the outside forecast still governs the base outfit and transit" vs "INDOOR slots are climate-controlled, so the OUTDOOR forecast must not drive them" | `core.js` (#198, 2026-08-03, extreme heat/AC) vs `prompts.js` (#65, 2026-07-13, office days) | as stated | A real contradiction, both in every stylist call. The set-aside branch reworded the first ("the outside forecast governs what is worn for the time outside"). Proposed: take that rewording now |
| 8 | Composer: "Do not add accessories" vs Style Constitution "Accessories: at least one finishing element elevates almost anything" | composer (#183, 2026-07-28, capsule bench) | the plan bench excludes accessories (0 of 266 candidates here); the composer has none to add | Structural, not taste. The conflict is real but the constitution line cannot be acted on in plans. **Rule** whether plans should offer accessories at all (a product decision; cards and validation would need it) |
| 9 | Composer slot requirement: "at most 1 optional outerwear layer" and workbench "At most one layer (cardigan, jacket, or shawl) per outfit unless cold or rain genuinely demands two" | `outfitSetPlanner.js` (spec 24, 2026-07-16: cardigan + shawl stacked three times) | as stated | Trips already allow a middle layer (engine map 73). For plans, the same change was built and set aside on 2026-10-29 ("live runs showed no better outfits"). Leave until the owner re-opens it |
| 10 | Composer slot requirement: "Submit exactly 1 outfit for this slot" vs the composer's own "target_outfits is the most outfits a slot may have, not a quota" and its decline option | `outfitSetPlanner.js:5262` | predates the 2026-10-27 count-ceiling ruling | **Clearly broken** — the count-ceiling change did not reach this line. Proposed: for plans, say "at most N" |
| 11 | "Professional and work contexts … default to quiet, structured, low-print styling … Save artisan, botanical, and statement styling for social contexts"; composer: "no statement wraps at work. Social slots … are where statement styling belongs" | `prompts.js` (spec 25, 2026-07-16), `outfitSetPlanner.js` (spec 26) | the owner's own office days composed print-led (spec 25) | A personal preference shipped as a global default, against the 2026-08-07 ruling that owner preferences must be per-user. Proposed: remove from shared prompts; if the owner wants it for herself, it belongs in her own rules |
| 12 | Style Constitution: "open shirt or vest over a fitted base is almost always better than the top alone"; "Dark fitted/structured top + wide-leg … is the most reliable version"; "Light colors expand, dark colors recede" | the owner's constitution | the owner | Not edited in a prompt cleanup. **Owner review**: the first two read as formulas, the third is generic theory |
| 13 | 24 saved reactions in every stylist call ("catalog_like … Rich emerald structured blazer", "too_safe … Monochrome Elegance", …), each scoped to an old board | conversational prompt | feedback memory | Selection and relevance, not wording: route through `docs/feedback-and-memory-map.md` before changing |
| 14 | `piece_jobs` / card reasons justify choices without comparing them | shortlist, composer | — | Agreed with the reviewer: a quality-testing problem, not more prompt. The review call of `docs/situation-fit-plan.md` step 5 is the candidate |

## Proposed order

1. **No ruling needed (clearly broken):** item 10.
2. **Small, evidence-backed:** item 7 (take the set-aside rewording), item 11 (remove the office default from shared
   prompts).
3. **Shortlist cleanup in one change:** items 1–5, keeping the app facts and constraints named in each row. Then
   rerun this thread's turn on 3.7 Flash (≈ $0.14) and compare the outfits, not whether cashmere disappears.
4. **Design decision:** item 6 (how a slot says "mostly hosting, maybe a stroll").
5. **Owner's own material:** items 12–13.
6. **Left as is:** items 8–9 until the owner re-opens them.

## What to protect (agreed with the reviewer)

Verified IDs; the separate roles of photographs and recorded facts; owner-confirmed facts over visual inference;
physical layering possibility; hard exclusions, wearing rules and comfort requirements; the option to decline a slot.
