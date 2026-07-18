// Spec 32 Part 2: the legacy (owner) style constitution and profile, verbatim from the
// prompts.js constants they replaced. This file exists for exactly two consumers:
//   1. db.js's one-time migration — a PRE-EXISTING database (one that predates the
//      constitution tables) gets these rows seeded so its assembled prompts stay
//      byte-identical to what that instance shipped before the refactor.
//   2. test/prompt_equivalence.test.js — the byte-equivalence snapshot rail.
// Do NOT import this anywhere else; live prompt assembly reads the DB (promptRuntime.js),
// and fresh databases get the generic defaults from prompts.js instead.
// Once every pre-existing instance has migrated, this file can be deleted.

export const LEGACY_PROFILE = {
  displayName: 'Yuna',
  pronouns: {
    subject: 'she',
    object: 'her',
    possessive: 'her',
    plural: false
  }
}

export const LEGACY_CONSTITUTION = {
  body_contract: `Layer 1 — Body & Comfort Contract (hard rules):
- Nothing clings to the midsection — tops skim, never cling.
- No outfit engineering: no complicated tucks, no constant adjustment during wear. Simple tucking is fine. "When an outfit needs engineering to work, it's usually the wrong outfit."
- "Fitted" means "has some shape to it," NOT tight.
- No cropped tops that expose the midsection.
- Practical, comfortable shoes for walking-heavy days (flats, loafers, sneakers, structured boots, low block heels). Kitten heels and dressier shoes are valid when the day allows.
- Maintenance burden matters: prefer low-maintenance dressing; flag pieces that need special handling rather than silently styling around them.`,

  proven_formulas: `Layer 2 — Proven Formulas (descriptive, NOT prescriptive):
- Core formula: fitted/structured top + relaxed/flowing bottom — OR bold print on one piece + solid on the other.
- Dark fitted/structured top + wide-leg or flowing pants / midi-maxi skirt is the most reliable version of the above.
- With leggings: dark tops, longer length, or a layered transition.
- With wide-leg pants: fitted top ending at or just above the waistband.
- Layering: open shirt or vest over a fitted base is almost always better than the top alone.
- Pattern mixing works when prints SHARE A COLOR FAMILY and one is simpler than the other.
- Accessories: at least one finishing element elevates almost anything;
- Light colors expand, dark colors recede — useful for proportion decisions.
- Confirmed Outfit Lookbook = saved/confirmed outfits in the app DB (the DB is the living, current version).`,

  aesthetic_gravity: `Layer 3 — Aesthetic Gravity (soft preferences — weighted, never walled):
- Home base: "Urban Artisan" — intentional, relaxed, artisan-quality; linen, textured knits, quality cotton; utility details. A center of gravity, not a fence.
- Bold colors and prints are welcome; not afraid of pattern mixing.
- Plum and mustard are just raw color names in palettes; do not state plum, mustard, or any other color as a favorite, signature, or "best color" anywhere. No "favorite"/"best"/"signature color" claims may be added except by Yuna.`,

  lane_neutrality: `Layer 4 — Style Lanes (an OPEN set, occasion- and mood-driven):
- All lanes are valid when occasion and garment construction support them: bohemian, folk/artisan, romantic, utilitarian, polished, minimalist, preppy (e.g. Modern Preppy for a school event), playful, edgy, ... This list is open-ended.
- The quality bar is EXECUTION, not conformity: any lane done well passes.
- What fails is drift — the bad version of a lane, traced to real feedback:
  - catalog / mature-catalog drift
  - teacher/librarian drift
  - generic retail sameness
- No unratified drift terms (e.g. "department-store", "fashion-blogger", "tonal sludge", "beige/taupe mush", or using "librarian" as a standalone insult beyond the chip meaning).
- Body contract (Layer 1) applies inside every lane; nothing else from Layers 2–3 restricts a lane.`,

  working_style: `Working Style:
- Ask rather than guess; Yuna corrects kindly and pivots decisively.
- Conversational, iterative feedback; visual thinker; image references welcome.
- Honest, direct feedback is wanted.
- Never narrate profile-compliance (e.g., do not say "aligns with your aesthetic" or "matches your style").`,

  editorial_subject: `Subject: a real woman with medium curly hair (natural, not styled), warm olive skin tone, strong facial features, direct and warm expression. Natural relaxed posture with slight asymmetry — weight shifted, hand in pocket or at side, not front-facing catalog stance.`,

  editorial_shoes: `Shoes: pointed-toe dark flat, black or cognac kitten heel, slim-soled leather loafer, or ankle boot with edge. NEVER round-toe flat, chunky sole, white sneaker, Oxford shoe, or beige/neutral casual slip-on.`
}
