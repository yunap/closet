import express from 'express'
import Database from 'better-sqlite3'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI, { toFile } from 'openai'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

// ── Image helper: resize before sending to Claude (max 4MB safe limit) ────────
async function prepareImageForClaude(filePath) {
  const sharp = (await import('sharp')).default
  const buffer = await sharp(filePath)
    .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg' }
}

// ── Shared stylist system prompt ───────────────────────────────────────────────
const STYLIST_SYSTEM = `You are Yuna's personal stylist. You know her wardrobe and her established style rules. Be direct, specific, and concise — never repeat advice you've already given in this conversation.

YUNA'S CONFIRMED SILHOUETTE RULES — treat as non-negotiable, never re-explain them:
- The bust carries significant visual weight and must be addressed directly — fitted, dark, or fabric with built-in compression/structure. Loose or unstructured tops through the bust read shapeless.
- The midsection skims rather than cinches. Waist emphasis works when the fabric or a knot/tuck does the shaping — avoid external cinching that pulls the eye to the midsection.
- Volume works exclusively below the hip. Drop-waist and hip-level waistline transitions are comfortable and flattering.
- Legs are the primary visual asset — don't hide them.
- Length: midi to maxi is the default. Minis work when the top is fitted and creates clear hip-level definition — a knot, a tuck, or a hem that lands at the hip naturally.
- No cropped tops that expose the midsection.
- The strongest confirmed formula: dark fitted structured top + wide-leg or flowing pants/midi/maxi skirt.
- Bold solid colors read well. Pattern mixing works when one piece is bold and the other is quiet.
- The red/orange crossbody bag is a reliable finishing element that works with almost everything.

YUNA'S AESTHETIC: "Urban Artisan" — earthy neutrals, artisan fabrics (linen, textured knits), utility details, relaxed but intentional. Plum is one of her best colors.

HARD CONSTRAINTS — always check piece notes before suggesting:
- If a piece note says it can't be tucked, never suggest tucking it.
- If a piece note mentions fit issues, factor them in before recommending it.
- Silky or satin fabrics cannot hold a tuck — never suggest tucking them.
- Only suggest pieces that exist in the provided wardrobe.

PHOTO VISIBILITY — be honest about this:
- You can only see photos attached to the CURRENT message. Photos from earlier in the conversation are no longer visible — you only have your text description of what you said about them.
- If a user references a previous photo ("the photo I uploaded above", "as you can see"), do NOT pretend to see it and do NOT guess. Say: "I can't see that photo anymore — could you re-upload it?" Then wait before giving advice.
- Never give advice based on reconstructing what a previous photo might have shown.

TUCK COMPATIBILITY (two-piece check before every tuck suggestion):
- Top tuck_behavior "wear_over_only" → NEVER suggest tucking.
- Silk, satin, chiffon → always wear_over_only regardless of notes.
- Ribbed or design hems → always wear_over_only.
- Bottom waistband "tight_no_room" or "soft_elastic_pull_on" → cannot receive a tuck.
- If tuck check fails → pivot to untucked pairing. Never suggest a tuck that won't hold.

PATTERN MIXING:
- Never pair two "loud" pieces. One loud + one solid/quiet only.
- Use reads_as field as the definitive visual impression — it overrides color tags.

EARNED WISDOM OVERRIDE:
- Each piece may have RULES listed as "RULES (authoritative): ...". These override ALL generic styling principles.
- If a piece has a rule, apply it first. Never suggest something that contradicts it.
- REJECTED entries show what has already failed — never re-suggest these combinations.
- PAIRS WITH entries are confirmed to work — prioritize these.
- Example: if a piece says RULES: "lace waistband is a design feature, top must end above it or cover it fully" — do NOT suggest a tucked top or suggest hiding the lace. The rule is settled.

CONVERSATION DISCIPLINE:
- Check what you've already said before responding. Do not repeat advice.
- Do not reverse a recommendation more than once. If a pairing isn't working after two attempts, say clearly "this combination has a structural problem" and suggest a different piece entirely.
- If you've explained the silhouette rule, don't explain it again — just apply it.
- One clear recommendation beats three hedged ones.`

// ── Dedicated STYLE_SELECTED_ITEM prompt ──────────────────────────────────────
const STYLE_SELECTED_ITEM_SYSTEM = `You are Yuna's wardrobe art director, not a generic fashion assistant.
Your job is to style ONE selected wardrobe item using corrected wardrobe truth.

VOICE:
- concise, specific, visually grounded
- no filler, no cheerleading, no body-energy language
- separate "technically works" from "best aligned with Yuna's aesthetic" when needed
- talk about garments, proportion, silhouette, texture, color relationship, and comfort realism

ABSOLUTE TASK RULES:
- The selected item must remain central in every outfit idea.
- Do not suggest replacing the selected item.
- If the selected item is pants, do not suggest skirts, dresses, or other pants as outfit ideas.
- If the selected item is a skirt, do not suggest pants as outfit ideas.
- If the selected item is a top, every outfit idea must include that top.
- Use saved wardrobe pieces whenever possible. If you must suggest an unsaved generic piece, label it clearly as "missing wardrobe gap".
- Never contradict RULES (authoritative), PAIRS WITH, or REJECTED notes.
- If a user-corrected field says something about fabric/color/fit, treat it as truth even if the photo suggests otherwise.

YUNA'S CURRENT STYLE FILTER:
- artistic minimalist; relaxed structure; modern bohemian restraint
- believable wearable proportions, not fashion-editorial drama
- implied waist through shape/drape, not tight cinching
- one expressive/artistic element at a time
- favor vertical continuity and stable columns
- warm/earthy/deep palettes work well: olive, mustard, cognac, cream, beige/oatmeal, taupe, navy/denim, chocolate brown
- controlled playful color is okay when intentional

WHAT USUALLY WORKS:
- compact/fitted top + softer or wider bottom
- structured/artistic top + relaxed but anchored bottom
- oversized top + long dark/stable column
- expressive piece + quiet supporting pieces
- structured pants anchoring artistic tops

WHAT USUALLY FAILS:
- wide + wide + soft
- boxy + shapeless
- long loose layers over gathered waists
- too many soft textures together: gauze + loose knit + drape + oversized layers
- ultra-feminine department-store styling
- generic fashion-blogger layering
- delicate florals without grounding contrast

OUTPUT FORMAT:
Start with one direct sentence naming the selected item and its styling role.
Then use exactly these sections:

Best direction
- 2-3 bullets only

Outfit ideas using this piece
1. [selected item] + [actual or clearly labeled piece] + [shoe/accessory if useful]
   Why it works: [one sentence]
2. ...
3. ...

Avoid
- 2-3 bullets only

Saveable rule
- One compact rule that could be saved back to this garment.

Do not end with "let me know" or generic offers.`


// ── Dedicated EVALUATE_OUTFIT prompt ─────────────────────────────────────────
const EVALUATE_OUTFIT_SYSTEM = `You are Yuna's wardrobe art director evaluating a complete outfit.
Your job is NOT to apply generic body-flattery rules. Your job is to judge whether the outfit works as a garment composition for Yuna's actual style.

VOICE:
- concise, specific, visually grounded
- no body-part diagnosis such as "bust area", "leg asset", "tummy", "figure", or "flattering your body"
- no "face/body energy" language
- no generic fashion-blogger phrasing
- discuss garments, proportion, silhouette, texture, color relationship, and comfort realism

AUTHORITATIVE CONTEXT:
- Linked garment records are truth. If linked pieces are provided, use their corrected names/fabric/fit notes over what the image seems to show.
- If a photo is present, use it for silhouette and outfit interaction, but do not override corrected garment truth.
- Confirmed/favorite outfits show Yuna's taste direction; use them as positive evidence, not neutral metadata. If the current outfit status is confirmed/favorite, start by looking for why it works before naming risks.

YUNA'S CURRENT STYLE FILTER:
- artistic minimalist; relaxed structure; modern bohemian restraint
- believable wearable proportions, not fashion-editorial drama
- implied waist through shape/drape, not tight cinching
- one expressive/artistic element at a time, with nuanced exceptions when palette and silhouette stay controlled
- favor vertical continuity and stable columns
- warm/earthy/deep palettes work well: olive, mustard, cognac, cream, beige/oatmeal, taupe, navy/denim, chocolate brown
- controlled playful color is okay when intentional

WHAT USUALLY WORKS:
- compact/fitted top + softer or wider bottom
- structured/artistic top + relaxed but anchored bottom
- oversized top + long dark/stable column
- expressive piece + quiet supporting pieces
- texture can function as grounding structure when tonal and controlled
- relaxed jeans can be correct when the leg stays narrow/controlled enough, shoes are quiet, and the top is compact or shaped
- cuffs/cropped hems are not automatically problems; judge whether they support the outfit's visual edit or break it
- clean visual edit matters: one focal piece, restrained palette, stable lower half, and minimal accessory noise can outweigh textbook vertical-continuity concerns

WHAT USUALLY FAILS:
- wide + wide + soft
- boxy + shapeless
- long loose layers over gathered waists
- too many soft textures together: gauze + loose knit + drape + oversized layers
- ultra-feminine department-store styling
- generic Pinterest/fashion-blogger layering
- delicate florals without grounding contrast

EVALUATION RULES:
- Evaluate the outfit as a whole before suggesting changes. First identify the dominant visual success or failure; do not start from isolated rule violations.
- Do not automatically replace the main/selected piece.
- Suggest small adjustments first: shoes, sleeve/hem handling, column color, texture simplification, palette, accessories.
- Do NOT recommend tucking unless linked garment truth says tucking is comfortable/possible. Prefer no-adjustment fixes.
- Do NOT default to "more fitted jeans/pants" as a fix. Only suggest a slimmer bottom if the current bottom is visibly collapsing the outfit, not merely because it is relaxed or cuffed.
- Only recommend replacing a garment if the combination has a real structural problem AND the outfit is not already confirmed/favorite.
- Distinguish "technically works" from "actually aligned with Yuna's aesthetic".
- Allow intentional exceptions if the composition still has stable silhouette, tonal palette, and visual intent.
- Use "vertical continuity" as a diagnostic, not a mechanical rule. A cuff, crop, or lighter jean can still work if the lower half remains stable and visually quiet.
- Do not call an outfit boxy if asymmetry, taper, drape, or garment shaping creates visual movement and shape.
- Oversized/playful outfits can work when the bottom creates enough visual stability, the palette is controlled, and the shoes support the mood. Do not treat all volume as a problem.
- Boyfriend/relaxed jeans may intentionally pool, cuff, or relax at the hem; do not automatically read that as sloppy, cropped-problematic, or as a need to taper.
- Quiet black shoes can provide enough grounding without needing heavier footwear.
- Patterned/artistic slip-ons can be the grounding playful element; do not neutralize them automatically.
- When garment truth or confirmed memory says a formula has worked, do not contradict it unless the current photo clearly shows a new problem.
- If an outfit is confirmed/favorite but has no linked garment truth, assume Yuna marked it that way for a reason. Explain the likely successful logic and recommend linking the pieces for better future precision; do not suggest replacing core items unless asked for alternatives.

OUTPUT FORMAT:
Start with one direct verdict sentence.
Then use exactly these sections:

Works
- 1-3 bullets

Weak spots / risks
- 1-3 bullets

Best adjustment
- 1-2 bullets, small changes first

Verdict
- Choose one: Strong / Works with tweaks / Technically works but not the best aesthetic / Not recommended

Saveable learning
- One compact note that could be saved to outfit or garment memory.

Do not end with "let me know" or generic offers.`

const EVALUATE_OUTFIT_FEW_SHOTS = `
BAD RESPONSE EXAMPLE:
"Bust Area: the tunic is loose and may look shapeless. Legs are the primary asset, so switch to a fitted dark top."
Why bad: body-part diagnosis, generic flattery logic, and it replaces the main piece too quickly.

GOOD RESPONSE EXAMPLE:
"The tunic is the expressive piece here. It works only if the bottom creates a clean stable column and the shoes stay light enough. The issue is not the body; it is whether the top's looseness has enough visual structure around it."

BAD RESPONSE EXAMPLE:
"This breaks your rules, so the outfit does not work."
Why bad: too rigid. Yuna's rules are filters, not a mechanical checklist.

GOOD RESPONSE EXAMPLE:
"This technically breaks the usual compact-top rule, but it may still work if the pants create a grounded column and the palette stays tonal. Treat it as experimental/artistic rather than universally flattering."

GOOD RESPONSE EXAMPLE:
"This is intentionally oversized/playful, not polished. The hoodie volume works because the darker boyfriend jeans create a stable enough column and the patterned slip-ons support the artistic mood. The risk is casualness, not silhouette failure."

GOLD STANDARD EXAMPLE — compact asymmetrical top + relaxed cream jeans:
"Works well / signature casual direction. The compact asymmetrical top is the focal point, and the relaxed cream jeans stay controlled enough through the leg to support it. The cuff is not a problem here because the shoes are quiet, the palette is restrained, and the outfit has a clean visual edit. Risk: if the jeans were wider, shorter, or paired with louder shoes, the lower half would lose clarity. Do not recommend more fitted jeans unless the current jeans visibly collapse the silhouette."
`


// ── Dedicated COMPARE_OUTFITS prompt ─────────────────────────────────────────
const COMPARE_OUTFITS_SYSTEM = `You are Yuna's wardrobe art director comparing two saved outfits.
Your job is to make a grounded visual judgment, not to give generic fashion encouragement.

Core task:
- Compare Outfit A and Outfit B as complete garment compositions.
- Choose the stronger option when there is a meaningful difference.
- If both work, explain what each is best for.
- If neither works well, say so and identify the shared problem.
- Trust linked garment truth and saved notes over visual guessing.
- Do not use body-part critique or generic flattery.

Evaluate by:
- silhouette and vertical continuity
- texture balance
- color relationship
- shoe weight and grounding
- proportion realism
- comfort / sitting-standing practicality
- whether the outfit fits Yuna's artistic-minimalist style
- whether it is technically okay vs actually aligned vs signature-level

Yuna's style filters:
- artistic minimalist, relaxed structure, modern bohemian restraint
- implied waist over tight waist or constant tucking
- one dominant silhouette idea per outfit
- compact/structured top + softer bottom can work well
- oversized top needs a stable bottom column
- one expressive piece at a time unless palette and silhouette are controlled
- avoid wide + wide + soft, shapeless layering, generic fashion-blog styling

Response format:
**Winner / stronger option**
- A, B, both for different uses, or neither.

**Why**
- 2–4 specific visual reasons.

**Outfit A**
- Works:
- Weak spot / risk:

**Outfit B**
- Works:
- Weak spot / risk:

**Best next move**
- The most useful styling decision or swap.

**Saveable learning**
- One concise note that could be saved to outfit or garment memory.`



// ── Dedicated GENERATE_OUTFIT_IDEAS prompt ───────────────────────────────────
const GENERATE_OUTFIT_IDEAS_SYSTEM = `You are Yuna's wardrobe art director generating outfit concepts from her actual saved wardrobe.
Your job is to create ranked, wearable outfit ideas for ONE selected garment.

Core task:
- Every outfit must include the selected garment.
- Use actual wardrobe items from the provided ranked candidate list.
- Do not replace the selected garment.
- If an ideal supporting item is missing, label it clearly as "missing-piece idea" and keep it optional.
- In ideal missing-piece mode, do NOT wait until the closet has no acceptable item. Show one best owned wardrobe direction AND one ideal editorial completion when a missing archetype would be stylistically stronger.
- Prioritize believable proportions over fashion-editorial drama.
- Make the outfits wearable, not aspirational fantasy styling.

Yuna's style filters:
- artistic minimalist, relaxed structure, modern bohemian restraint
- implied waist through shape/drape, not tight cinching or constant tucking
- one dominant silhouette idea per outfit
- one expressive/artistic piece at a time, unless palette and silhouette are controlled
- vertical continuity and stable columns matter
- warm/earthy/deep palettes work well: olive, mustard, cognac, cream, beige/oatmeal, taupe, navy/denim, chocolate brown
- playful/kawaii or Miami Art Deco color can work in controlled doses

Avoid:
- generic fashion-blogger layering
- ultra-feminine department-store styling
- wide + wide + soft unless there is a clear stabilizing reason
- long loose layers over gathered waists
- recommending tucking unless garment truth says tucking works
- invented wardrobe items unless clearly marked as a missing-piece idea

Editorial ranking logic:
- Think through many possible candidates internally, but surface ONLY the strongest coherent options.
- Use visual-weight judgment, not category rules alone. Ask whether the lower half gives enough visual gravity for the selected piece.
- Soft/delicate/pale tops usually need a grounded lower half: darker color, denser texture, longer line, structured shoe, or stable column.
- Do not over-penalize skirts: pencil, midi, maxi, or dense crochet skirts can be excellent anchors; mini/floral skirts are only strong when the top is compact and the playful lane is intentional.
- Style lanes matter: relaxed earthy, soft structured, artistic textured, controlled playful, modern preppy. Surface the lane intentionally instead of mixing moods accidentally.
- Do not force variety. Fewer better outfits are preferred over five mediocre ones.
- Surface 2-3 outfits by default. Use 4 only when all 4 are genuinely strong. Never pad to 5.
- In ideal missing-piece mode, the default structure should be: Best owned wardrobe direction, Ideal editorial completion, and optional usable/experimental direction.
- The first outfit must be the strongest signature direction for Yuna, not merely the safest conventional outfit.
- Prioritize silhouette continuity over color echo, contrast, novelty, or preppy/playful variety.
- For button-up shirts, tunics, and longer tops, prefer elongated bottoms and stable lower columns; avoid ranking mini/short skirts as signature unless saved feedback explicitly confirms that formula.
- For genuinely compact tops such as shells, tanks, fitted knits, or sleeveless tops, skirts can be strong when they preserve a controlled silhouette.
- A relaxed everyday option may appear only if it is still stylistically sound. If it contradicts the avoid guidance, either rewrite it as a weaker fallback or remove it.
- An experimental/playful option may appear only if it is controlled and intentional. Do not include loud + loud combinations just to provide variety.
- If a pairing is technically possible but not aesthetically aligned, suppress it or label it clearly as "usable but weaker"; do not present it as a recommendation.
- The Avoid section must be contextual to the selected garment and must not contradict any recommended outfit.

Output format:
**Generated outfit ideas for:** [selected garment]
**Occasion / season:** [occasion] / [season]

**Signature / strongest direction**
For closet-only mode: this is the best saved-wardrobe outfit.
For ideal missing-piece mode: use this section as the best owned wardrobe direction.
Pieces: [selected garment] + [actual saved pieces only]
Why it works: [specific visual reason using visual column, stable bottom, controlled softness, grounded texture, or relaxed structure. Do not use generic balance/cohesive phrasing.]
Watch for: [one real risk or "none"]

**Ideal editorial completion**
Include this section in ideal missing-piece mode. It should use the selected garment plus the strongest conceptual support pieces, even if the wardrobe has usable alternatives.
Pieces: [selected garment] + [actual saved pieces if useful] + [missing: shape/color/material archetype] + optional second [missing: archetype]
Why it works: [explain what the missing archetype contributes: grounding, visual gravity, texture density, shoe weight, silhouette continuity, or style lane]
Watch for: [specific risk or "none"]

**Usable variation**
Pieces: [selected garment] + [actual saved pieces only; optional [missing: archetype] if ideal mode permits it]
Why it works: [specific visual reason]
Watch for: [explain exactly why it is less signature, or "none"]

**Optional experimental direction**
Only include this section if it is actually coherent for Yuna.
Pieces: [selected garment] + [actual saved pieces only; optional [missing: archetype] if ideal mode permits it]
Why it works: [specific visual reason]
Watch for: [specific risk]

**I would skip**
Optional: one concise sentence if tempting but weak categories/pairings should be avoided.

**Avoid for this garment**
- 2 bullets max. These must not contradict the surfaced outfits.

**Saveable learning**
- One concise garment-specific rule. No generic "balance/harmony" boilerplate.

Important: use exact saved wardrobe piece names from the candidate list for owned pieces. In ideal mode, at least one surfaced direction should include conceptual gaps using exact bracket notation [missing: shape/color/material archetype].`

const STYLE_SELECTED_ITEM_FEW_SHOTS = `
BAD RESPONSE EXAMPLE:
Selected item: striped corduroy pants.
Bad answer: "Try a brown-cream midi skirt with ankle boots."
Why bad: it replaced the selected pants with another bottom.

GOOD RESPONSE EXAMPLE:
Selected item: striped corduroy pants.
Good answer: "These pants should function as the grounded textured column. Best pairings are compact tops, clean knits, or shorter artistic blouses that do not compete with the vertical stripe. Avoid long loose layers or other dominant bottoms."

BAD RESPONSE EXAMPLE:
Selected item: gauzy cream wide-leg pants.
Bad answer: "Wear with a loose overshirt and chunky cardigan."
Why bad: it stacks soft + wide + loose layers around the waist.

GOOD RESPONSE EXAMPLE:
Selected item: gauzy cream wide-leg pants.
Good answer: "Keep the top compact and simple because the pants already carry softness and width. Let the crinkled texture be the expressive element."
`

function isStyleSelectedQuestion(question = '') {
  const q = String(question).toLowerCase()
  return !q.trim() || /style|wear|pair|outfit|how should|how do i|what goes|what would work|proposal|suggest/.test(q)
}


function wardrobeCategoryGroup(pieceOrCategory = '') {
  const raw = typeof pieceOrCategory === 'string'
    ? pieceOrCategory
    : (pieceOrCategory?.category || pieceOrCategory?.type || pieceOrCategory?.name || '')
  const value = String(raw || '').toLowerCase().trim()
  if (/\b(top|shirt|blouse|tee|t-shirt|tank|shell|sweater|knit|cardigan as top|tunic|hoodie|sweatshirt)\b/.test(value) || /tops?/.test(value)) return 'top'
  if (/\b(bottom|pant|trouser|jean|skirt|short|culotte|legging)\b/.test(value) || /bottoms?/.test(value)) return 'bottom'
  if (/\b(dress|jumpsuit)\b/.test(value) || /dresses/.test(value)) return 'dress'
  if (/\b(outerwear|jacket|cardigan|coat|blazer|vest|overshirt|kimono)\b/.test(value)) return 'outerwear'
  if (/\b(shoe|boot|flat|loafer|sandal|sneaker|heel|mule|clog)\b/.test(value) || /shoes/.test(value)) return 'shoes'
  if (/\b(accessor|necklace|pendant|earring|bracelet|bag|tote|belt|scarf|watch|ring)\b/.test(value)) return 'accessory'
  return value || 'other'
}

function categoryConstraintForSelectedPiece(piece) {
  if (wardrobeCategoryGroup(piece) === 'bottom') {
    return `Selected item category is BOTTOM. Every outfit idea must include "${piece.name}" as the bottom. Do not recommend skirts, dresses, jeans, pants, or any other bottom as an outfit idea.`
  }
  if (wardrobeCategoryGroup(piece) === 'top') {
    return `Selected item category is TOP. Every outfit idea must include "${piece.name}" as the top. Do not replace it with another top.`
  }
  if (wardrobeCategoryGroup(piece) === 'dress') {
    return `Selected item category is DRESS. Every outfit idea must include "${piece.name}" as the dress. Do not replace it with separates.`
  }
  if (wardrobeCategoryGroup(piece) === 'outerwear') {
    return `Selected item category is OUTERWEAR. Every outfit idea must include "${piece.name}" as the outer layer. Do not replace it with another jacket/cardigan.`
  }
  if (wardrobeCategoryGroup(piece) === 'shoes') {
    return `Selected item category is SHOES. Every outfit idea must include "${piece.name}" as the shoes. Do not suggest different shoes unless marked as an avoid note.`
  }
  return `Every outfit idea must include the selected item "${piece.name}".`
}

function textIncludesAny(value, words) {
  const haystack = String(value || '').toLowerCase()
  return words.some(w => haystack.includes(w))
}

function pieceTextBlob(p) {
  return [
    p.name, p.category, p.background_color, p.reads_as, p.pattern_type,
    p.pattern_scale, p.pattern_complexity, p.hem_finish, p.length_hits_at,
    p.silhouette, p.fabric_category, p.fabric_weight, p.fit_on_body,
    p.tuck_behavior, p.waistband_type, p.notes,
    ...(p.colors || []), ...(p.occasions || []),
    ...(p.styling_rules_learned || []), ...(p.pairs_well_with || []), ...(p.tried_and_rejected || [])
  ].filter(Boolean).join(' ').toLowerCase()
}


function visualWeightProfile(p) {
  const blob = pieceTextBlob(p)
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const name = String(p.name || '').toLowerCase()
  const dark = colors.some(c => ['black','navy','denim','brown','charcoal','dark grey','dark gray','deep navy','chocolate'].includes(c)) || textIncludesAny(blob, ['black','navy','dark denim','dark blue','charcoal','brown','chocolate'])
  const light = colors.some(c => ['white','cream','beige','taupe','oatmeal','ivory','nude'].includes(c)) || textIncludesAny(blob, ['white','cream','beige','oatmeal','ivory','nude','light'])
  const denseTexture = textIncludesAny(blob, ['denim','corduroy','wool','twill','utility','canvas','leather','structured','pencil','maxi','crochet','heavy','substantial','ribbed'])
  const airyTexture = textIncludesAny(blob, ['lace','gauzy','chiffon','sheer','silk','satin','delicate','soft floral','airy','lightweight'])
  const longLine = textIncludesAny(blob, ['maxi','midi','full length','full-length','long','straight','flare','bootcut','wide-leg','wide leg','column','pencil'])
  const abrupt = textIncludesAny(blob, ['mini','short','cropped','crop','knee-length','knee length'])
  let grounding = 0
  if (dark) grounding += 3
  if (denseTexture) grounding += 2
  if (longLine) grounding += 2
  if (light) grounding -= 1
  if (airyTexture) grounding -= 2
  if (abrupt) grounding -= 2

  const expressive = textIncludesAny(blob, ['floral','abstract','graphic','bold','multi','print','pattern','appliqué','applique','lace','embroidered','colorblock'])
  const softness = (airyTexture ? 2 : 0) + (textIncludesAny(blob, ['relaxed','drape','loose','gauzy','soft']) ? 1 : 0)
  const structure = (denseTexture ? 2 : 0) + (textIncludesAny(blob, ['tailored','structured','utility','straight','pencil','crisp','button-up','button down','button-down']) ? 1 : 0)

  const lanes = []
  if (textIncludesAny(blob, ['utility','olive','canvas','twill','cognac','linen','earthy'])) lanes.push('relaxed earthy')
  if (textIncludesAny(blob, ['tailored','trouser','button-up','button down','pencil','loafer','blazer'])) lanes.push('soft structured')
  if (textIncludesAny(blob, ['crochet','appliqué','applique','lace','embroidered','woven','artisan','textured'])) lanes.push('artistic textured')
  if (textIncludesAny(blob, ['pink','pastel','kawaii','mini','playful','bright floral'])) lanes.push('controlled playful')
  if (textIncludesAny(blob, ['navy','pinstripe','loafer','pencil','button-up','button down','preppy'])) lanes.push('modern preppy')

  return {
    grounding,
    groundingLabel: grounding >= 4 ? 'strong anchor' : grounding >= 2 ? 'moderate anchor' : grounding >= 0 ? 'light anchor' : 'floating/soft',
    softness,
    structure,
    expressive,
    lanes: [...new Set(lanes)].slice(0,3)
  }
}

function buildVisualWeightText(p) {
  const v = visualWeightProfile(p)
  const lane = v.lanes.length ? v.lanes.join(', ') : 'neutral support'
  return `VISUAL WEIGHT: ${v.groundingLabel}; structure ${v.structure}; softness ${v.softness}; expressive ${v.expressive ? 'yes' : 'no'}; style lane: ${lane}`
}

function hasPairingReference(sourcePiece, targetPiece) {
  const targetName = String(targetPiece.name || '').toLowerCase()
  return (sourcePiece.pairs_well_with || []).some(note => String(note).toLowerCase().includes(targetName))
}

function hasRejectedReference(sourcePiece, targetPiece) {
  const targetName = String(targetPiece.name || '').toLowerCase()
  return (sourcePiece.tried_and_rejected || []).some(note => String(note).toLowerCase().includes(targetName))
}



function collectPieceIdsFromFeedbackPayload(payloadText) {
  const ids = new Set()
  try {
    const payload = typeof payloadText === 'string' ? safeJsonParse(payloadText, {}) : (payloadText || {})
    const visit = (value) => {
      if (!value) return
      if (Array.isArray(value)) return value.forEach(visit)
      if (typeof value === 'object') {
        if (value.id !== undefined && value.id !== null && !Number.isNaN(Number(value.id))) ids.add(Number(value.id))
        if (value.pieceId !== undefined && value.pieceId !== null && !Number.isNaN(Number(value.pieceId))) ids.add(Number(value.pieceId))
        if (Array.isArray(value.pieces)) value.pieces.forEach(visit)
        if (Array.isArray(value.pieceIds)) value.pieceIds.forEach(id => {
          if (!Number.isNaN(Number(id))) ids.add(Number(id))
        })
        if (value.board) visit(value.board)
        if (value.outfit) visit(value.outfit)
      } else if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        ids.add(Number(value))
      }
    }
    visit(payload)
  } catch {}
  return [...ids]
}

function feedbackWeight(feedbackType) {
  const weights = {
    signature: 38,
    works: 22,
    good_formula: 14,
    good_pieces: 16,
    almost: 4,
    not_me: -32,
    too_safe: -22,
    too_soft: -20,
    too_generic: -26,
    too_boho: -18,
    too_polished: -16,
    weak_structure: -24,
    weak_contrast: -18,
    bad_grounding: -20,
    wrong_silhouette: -8, // scoped: wrong for this selected garment/board, not a global silhouette ban
    catalog_drift: -34,
    bad_reference: -36,
    proportion_problem: -24,
    wrong_proportions: -24,
    wrong_item_read: -24,
    bad_occasion: -22,
    fit_issue: -34,
  }
  return weights[feedbackType] || 0
}

function getFeedbackInfluenceForPair(selectedPiece, candidatePiece) {
  if (!selectedPiece?.id || !candidatePiece?.id || typeof db === 'undefined') return null
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0 AND context_type = 'piece'
        AND context_id = ?
      ORDER BY id DESC
      LIMIT 120
    `).all(Number(selectedPiece.id))

    let score = 0
    const reasons = []
    const candidateName = String(candidatePiece.name || '').toLowerCase()

    for (const row of rows) {
      const weight = feedbackWeight(row.feedback_type)
      if (!weight) continue
      const ids = collectPieceIdsFromFeedbackPayload(row.payload)
      const noteBlob = [row.note, row.label, row.context_name].filter(Boolean).join(' ').toLowerCase()
      const touchesCandidate = ids.includes(Number(candidatePiece.id)) || (candidateName && noteBlob.includes(candidateName))
      if (!touchesCandidate) continue

      score += weight + (row.is_gold ? 35 : 0)
      if (row.feedback_type === 'signature') reasons.push('signature feedback')
      else if (row.feedback_type === 'works') reasons.push('works feedback')
      else if (row.feedback_type === 'almost') reasons.push('almost feedback')
      else if (row.feedback_type === 'not_me') reasons.push('not-me feedback')
      else if (row.feedback_type === 'too_soft') reasons.push('too-soft feedback')
      else if (row.feedback_type === 'proportion_problem') reasons.push('proportion feedback')
      else if (row.feedback_type === 'wrong_item_read') reasons.push('wrong-item feedback')
      else if (row.feedback_type === 'too_generic') reasons.push('too-generic feedback')
      else if (row.feedback_type === 'too_safe') reasons.push('too-safe feedback')
      else if (row.feedback_type === 'weak_structure') reasons.push('weak-structure feedback')
      else if (row.feedback_type === 'weak_contrast') reasons.push('weak-contrast feedback')
      else if (row.feedback_type === 'bad_grounding') reasons.push('bad-grounding feedback')
      else if (row.feedback_type === 'wrong_silhouette') reasons.push('wrong-for-this-piece silhouette feedback')
      else if (row.feedback_type === 'catalog_drift') reasons.push('catalog-drift feedback')
    }

    if (!score) return null
    return { score: Math.max(-60, Math.min(60, score)), reasons: [...new Set(reasons)].slice(0, 4) }
  } catch {
    return null
  }
}

function buildGoldStandardFeedbackMemory(pieceId, limit = 10) {
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0 AND context_type = 'piece'
        AND context_id = ?
        AND feedback_type IN ('signature','works')
      ORDER BY COALESCE(is_gold,0) DESC, CASE feedback_type WHEN 'signature' THEN 0 ELSE 1 END, id DESC
      LIMIT ?
    `).all(Number(pieceId), Number(limit))
    if (!rows.length) return ''
    return rows.map(row => {
      const ids = collectPieceIdsFromFeedbackPayload(row.payload)
      const pieces = ids.length ? db.prepare(`SELECT id, name, category FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []
      const pieceText = pieces.length ? ` pieces: ${pieces.map(p => `${p.name} (${p.category})`).join(' + ')}` : ''
      const note = row.note ? ` — ${String(row.note).slice(0, 220)}` : ''
      return `- ${row.feedback_type}${row.label ? ` / ${row.label}` : ''}${pieceText}${note}`
    }).join('\n')
  } catch {
    return ''
  }
}

function collectPieceIdsFromSavedBoardRow(row) {
  const ids = new Set()
  const visit = (value) => {
    if (!value) return
    if (Array.isArray(value)) return value.forEach(visit)
    if (typeof value === 'object') {
      if (value.id !== undefined && value.id !== null && !String(value.id).startsWith('missing-') && !Number.isNaN(Number(value.id))) ids.add(Number(value.id))
      if (value.pieceId !== undefined && value.pieceId !== null && !Number.isNaN(Number(value.pieceId))) ids.add(Number(value.pieceId))
      if (Array.isArray(value.pieces)) value.pieces.forEach(visit)
      if (Array.isArray(value.pieceIds)) value.pieceIds.forEach(visit)
      if (value.board) visit(value.board)
      if (value.outfit) visit(value.outfit)
    } else if (/^\d+$/.test(String(value))) {
      ids.add(Number(value))
    }
  }
  visit(safeJsonParse(row?.pieces, []))
  visit(safeJsonParse(row?.payload, {}))
  if (row?.context_type === 'piece' && row?.context_id) ids.add(Number(row.context_id))
  return [...ids]
}

function getSavedBoardInfluenceForPair(selectedPiece, candidatePiece) {
  if (!selectedPiece?.id || !candidatePiece?.id || typeof db === 'undefined') return null
  try {
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE COALESCE(archived,0) = 0
        AND ((context_type = 'piece' AND context_id = ?) OR COALESCE(favorite,0) = 1)
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT 120
    `).all(Number(selectedPiece.id))
    let score = 0
    const reasons = []
    for (const row of rows) {
      const ids = collectPieceIdsFromSavedBoardRow(row)
      if (!ids.includes(Number(selectedPiece.id)) || !ids.includes(Number(candidatePiece.id))) continue
      score += row.favorite ? 45 : 18
      reasons.push(row.favorite ? 'saved board marked Use strongly' : 'saved board memory')
    }
    if (!score) return null
    return { score: Math.max(0, Math.min(70, score)), reasons: [...new Set(reasons)].slice(0, 3) }
  } catch {
    return null
  }
}

function getSavedBoardMemory(contextType = null, contextId = null, limit = 10) {
  try {
    const clauses = ['COALESCE(archived,0) = 0']
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      WHERE ${clauses.join(' AND ')}
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))
    if (!rows.length) return ''
    const positiveLabels = /signature|works|strong|most_like_me|grounded|artistic|modern/i
    const negativeLabels = /almost|not_me|too_safe|too_boho|too_polished|too_soft|too_generic|wrong_proportions|wrong_silhouette|wrong_energy|weak_structure|weak_contrast|bad_grounding|catalog_drift|ignore|bad|drift/i
    const positives = []
    const negatives = []
    for (const row of rows) {
      const pieces = safeJsonParse(row.pieces, []).map(p => p?.name).filter(Boolean).join(' + ')
      const payload = safeJsonParse(row.payload, {}) || {}
      const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
      const labelText = labels.length ? ` [${labels.join(', ')}]` : ''
      const reason = row.reason ? ` — ${String(row.reason).slice(0, 240)}` : ''
      const line = `- ${row.title || 'Untitled board'}${labelText}${pieces ? ` | pieces: ${pieces}` : ''}${reason}`
      if (row.favorite || labels.some(l => positiveLabels.test(String(l)))) positives.push(line)
      if (labels.some(l => negativeLabels.test(String(l)))) negatives.push(line)
      if (!row.favorite && !labels.length) positives.push(`- Saved board: ${line.slice(2)}`)
    }
    const parts = []
    if (positives.length) parts.push(`Saved visual board positive memory. Bias future outfit suggestions toward these successful formulas:
${positives.slice(0, 10).join('\n')}`)
    if (negatives.length) parts.push(`Saved visual board negative memory. Avoid repeating these drift/problem patterns:
${negatives.slice(0, 10).join('\n')}`)
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

function compatibilityScoreForSelectedItem(selected, candidate) {
  let score = 0
  const reasons = []
  const selectedBlob = pieceTextBlob(selected)
  const candidateBlob = pieceTextBlob(candidate)

  if (candidate.favorite) { score += 4; reasons.push('favorite') }
  if (hasPairingReference(selected, candidate) || hasPairingReference(candidate, selected)) {
    score += 16; reasons.push('confirmed pairing note')
  }
  if (hasRejectedReference(selected, candidate) || hasRejectedReference(candidate, selected)) {
    score -= 40; reasons.push('rejected pairing note')
  }

  // Category compatibility: make sure the model mostly sees useful support pieces.
  if (selected.category === 'bottom') {
    if (candidate.category === 'top') { score += 10; reasons.push('needed top for selected bottom') }
    if (candidate.category === 'shoes') { score += 4; reasons.push('shoe support') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'bottom' || candidate.category === 'dress') { score -= 60; reasons.push('competing bottom/dress') }

    // Yuna's strongest formula for wider/statement bottoms: compact/fitted/structured tops.
    if (candidate.category === 'top') {
      if (textIncludesAny(candidateBlob, ['fitted', 'slim', 'compact', 'structured', 'sleeveless', 'shell', 'tank', 'short sleeve', 'short-sleeve'])) {
        score += 12; reasons.push('compact/structured top')
      }
      if (textIncludesAny(candidateBlob, ['boxy', 'oversized', 'drop-shoulder', 'loose', 'relaxed']) &&
          textIncludesAny(selectedBlob, ['wide', 'bootcut', 'relaxed', 'gauzy', 'soft', 'corduroy', 'stripe'])) {
        score -= 8; reasons.push('wide/soft top risk with statement bottom')
      }
      if (textIncludesAny(candidateBlob, ['long', 'mid-thigh', 'tunic']) && textIncludesAny(selectedBlob, ['stripe', 'corduroy', 'wide', 'bootcut'])) {
        score -= 8; reasons.push('long layer may break vertical line')
      }
    }
  } else if (selected.category === 'top') {
    if (candidate.category === 'bottom') { score += 10; reasons.push('needed bottom for selected top') }
    if (candidate.category === 'shoes') { score += 4; reasons.push('shoe support') }
    if (candidate.category === 'accessory') { score += 2; reasons.push('accessory support') }
    if (candidate.category === 'top') { score -= 60; reasons.push('competing top') }

    if (candidate.category === 'bottom') {
      const selectedIsButtonOrTunic = textIncludesAny(selectedBlob, ['button-up', 'button up', 'button-down', 'button down', 'shirt', 'tunic', 'popover', 'longline'])
      const selectedIsCompactTop = textIncludesAny(selectedBlob, ['shell', 'sleeveless', 'tank', 'compact', 'cropped', 'short sleeve', 'short-sleeve', 'fitted knit', 'fitted top']) && !selectedIsButtonOrTunic
      const bottomIsPantsColumn = textIncludesAny(candidateBlob, ['jeans', 'denim', 'pants', 'trousers', 'straight', 'slim', 'bootcut', 'flare', 'wide-leg', 'wide leg', 'column', 'dark', 'navy', 'black', 'brown'])
      const bottomIsAbruptSkirt = textIncludesAny(candidateBlob, ['mini', 'knee-length', 'knee length', 'short skirt', 'colorblock knit mini', 'skort'])
      const bottomIsUsefulSkirt = textIncludesAny(candidateBlob, ['pencil', 'midi', 'maxi', 'straight skirt'])
      const selectedWeight = visualWeightProfile(selected)
      const candidateWeight = visualWeightProfile(candidate)
      const selectedNeedsAnchor = selectedWeight.softness >= 2 || (selectedWeight.expressive && textIncludesAny(selectedBlob, ['lace','floral','appliqué','applique','sheer','cream','white','pale','soft']))

      if (selectedNeedsAnchor && candidateWeight.grounding >= 3) {
        score += 14; reasons.push('visual gravity for soft/expressive top')
      }
      if (selectedNeedsAnchor && candidateWeight.grounding < 1) {
        score -= 12; reasons.push('too little lower-half anchor')
      }
      if (selectedNeedsAnchor && textIncludesAny(candidateBlob, ['white','cream','pale','light']) && !textIncludesAny(candidateBlob, ['denim','structured','utility','twill','pencil','maxi'])) {
        score -= 7; reasons.push('pale-on-pale softness risk')
      }
      if (bottomIsUsefulSkirt && candidateWeight.grounding >= 3) {
        score += 10; reasons.push('grounded skirt anchor')
      }

      if (textIncludesAny(candidateBlob, ['structured', 'column', 'dark', 'navy', 'black', 'brown', 'denim', 'straight', 'slim', 'bootcut', 'flare'])) {
        score += 12; reasons.push('stable vertical bottom')
      }
      if (bottomIsPantsColumn && selectedIsButtonOrTunic) {
        score += 10; reasons.push('preserves vertical continuity for shirt/tunic')
      }
      if (bottomIsUsefulSkirt && selectedIsCompactTop) {
        score += 8; reasons.push('compact top can support skirt formula')
      }
      if (bottomIsAbruptSkirt && selectedIsButtonOrTunic) {
        score -= 22; reasons.push('abrupt skirt hem weakens vertical continuity')
      } else if (bottomIsAbruptSkirt && !selectedIsCompactTop) {
        score -= 12; reasons.push('short skirt is less signature without compact top')
      }
      if (textIncludesAny(candidateBlob, ['gauzy', 'soft', 'wide', 'relaxed']) && textIncludesAny(selectedBlob, ['loose', 'oversized', 'boxy', 'drape', 'tunic'])) {
        score -= 12; reasons.push('wide + soft risk')
      }
    }
  } else if (selected.category === 'dress') {
    if (['shoes','accessory','outerwear'].includes(candidate.category)) { score += 8; reasons.push('supports selected dress') }
    if (['top','bottom','dress'].includes(candidate.category)) { score -= 40; reasons.push('replaces dress') }
  }

  // Color/taste compatibility for Yuna.
  const earthyOrDeep = ['olive','mustard','cognac','cream','beige','taupe','navy','denim','brown','tan','oatmeal','amber','plum','charcoal','dark blue','dark grey']
  const sharedColors = (candidate.colors || []).filter(c => (selected.colors || []).includes(c))
  if (sharedColors.length) { score += 3; reasons.push(`shared color: ${sharedColors.slice(0,2).join('/')}`) }
  if ((candidate.colors || []).some(c => earthyOrDeep.includes(c))) { score += 3; reasons.push('Yuna palette') }
  if (textIncludesAny(candidateBlob, ['artistic', 'graphic', 'architectural', 'texture', 'textured', 'corduroy', 'crochet', 'cashmere', 'linen', 'knit'])) {
    score += 4; reasons.push('artistic/texture vocabulary')
  }

  // Avoid stacking too much softness/expressiveness.
  const selectedSoft = textIncludesAny(selectedBlob, ['gauzy', 'soft', 'drape', 'loose knit', 'oversized', 'relaxed'])
  const candidateSoft = textIncludesAny(candidateBlob, ['gauzy', 'soft', 'drape', 'loose knit', 'oversized', 'relaxed'])
  if (selectedSoft && candidateSoft) { score -= 7; reasons.push('soft + soft risk') }

  const selectedExpressive = textIncludesAny(selectedBlob, ['loud', 'bold', 'graphic', 'floral', 'stripe', 'abstract', 'multi', 'pattern'])
  const candidateExpressive = textIncludesAny(candidateBlob, ['loud', 'bold', 'graphic', 'floral', 'stripe', 'abstract', 'multi', 'pattern'])
  if (selectedExpressive && candidateExpressive) { score -= 5; reasons.push('two expressive pieces risk') }

  const feedbackInfluence = getFeedbackInfluenceForPair(selected, candidate)
  if (feedbackInfluence) {
    score += feedbackInfluence.score
    reasons.push(...feedbackInfluence.reasons)
  }

  const savedBoardInfluence = getSavedBoardInfluenceForPair(selected, candidate)
  if (savedBoardInfluence) {
    score += savedBoardInfluence.score
    reasons.push(...savedBoardInfluence.reasons)
  }

  return { score, reasons }
}

function rankedComplementaryWardrobeFor(piece, allPieces, limit = 24) {
  const selectedCategory = piece.category
  const allowed = allPieces.filter(p => {
    if (p.id === piece.id) return false
    if (selectedCategory === 'bottom') return ['top','outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'top') return ['bottom','outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'dress') return ['outerwear','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'outerwear') return ['top','bottom','dress','shoes','accessory'].includes(p.category)
    if (selectedCategory === 'shoes') return ['top','bottom','dress','outerwear','accessory'].includes(p.category)
    return true
  })

  return allowed
    .map(p => ({ piece: p, ...compatibilityScoreForSelectedItem(piece, p) }))
    .sort((a,b) => b.score - a.score || Number(b.piece.favorite) - Number(a.piece.favorite) || String(a.piece.category).localeCompare(String(b.piece.category)))
    .slice(0, limit)
}

function complementaryWardrobeFor(piece, allPieces, limit = 24) {
  return rankedComplementaryWardrobeFor(piece, allPieces, limit).map(r => r.piece)
}

function buildRankedCandidateText(rankedCandidates) {
  if (!rankedCandidates?.length) return ''
  return rankedCandidates.map((r, idx) => {
    const reasonText = r.reasons?.length ? `
  RANKING REASONS: ${r.reasons.slice(0, 4).join('; ')} | score ${r.score}` : ''
    return `${idx + 1}. ${buildPieceText(r.piece)}${reasonText}`
  }).join('\n')
}


function selectCandidatesForOutfitGeneration(piece, allPieces, limit = 30) {
  // Reuse the selected-item ranking, but keep a broader pool for multi-piece outfits.
  const ranked = rankedComplementaryWardrobeFor(piece, allPieces, limit)
  const byCategory = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [] }
  for (const r of ranked) {
    const cat = r.piece.category || 'other'
    if (byCategory[cat]) byCategory[cat].push(r)
  }
  const mixed = []
  const addSome = (cat, count) => { mixed.push(...(byCategory[cat] || []).slice(0, count)) }

  if (wardrobeCategoryGroup(piece) === 'top') {
    addSome('bottom', 12); addSome('shoes', 8); addSome('outerwear', 5); addSome('accessory', 5)
  } else if (wardrobeCategoryGroup(piece) === 'bottom') {
    addSome('top', 12); addSome('shoes', 8); addSome('outerwear', 5); addSome('accessory', 5)
  } else if (wardrobeCategoryGroup(piece) === 'dress') {
    addSome('shoes', 10); addSome('outerwear', 8); addSome('accessory', 6)
  } else {
    mixed.push(...ranked.slice(0, limit))
  }

  const seen = new Set()
  return mixed.filter(r => {
    if (seen.has(r.piece.id)) return false
    seen.add(r.piece.id)
    return true
  }).slice(0, limit)
}

function buildOutfitGenerationCandidateText(rankedCandidates) {
  if (!rankedCandidates?.length) return ''
  return rankedCandidates.map((r, idx) => {
    const p = r.piece
    const reasons = r.reasons?.length ? `\n  WHY RETRIEVED: ${r.reasons.slice(0, 5).join('; ')} | score ${r.score}` : ''
    return `${idx + 1}. ${buildPieceText(p)}${reasons}`
  }).join('\n')
}

async function criticPassForGeneratedOutfits({ selectedPiece, draft, userQuestion }) {
  if (process.env.STYLIST_CRITIC_DISABLED === 'true') return draft

  const criticSystem = `You are a strict editor for Yuna's generated outfit ideas.
Return ONLY the corrected final answer.

Hard checks:
- Every outfit idea must include the selected garment.
- Do not replace the selected garment.
- Remove invented saved wardrobe items unless clearly labeled as missing-piece idea.
- Prune weak ideas. Surface only 2-3 recommendations unless more are genuinely strong. Never keep five just for variety.
- Do not present a risky outfit as recommended if it contradicts the Avoid section. Either remove it or label it "usable but weaker" and explain why.
- Remove generic filler like "harmony", "balance", "draws attention upward", "confidence to pull off", or "proper tuck" unless tied to a real garment-specific reason.
- Do not recommend tucking unless garment truth supports it.
- Avoid section must be contextual and must not contradict the recommended outfits.
- Keep the required output format: Signature / strongest direction, Usable variation, optional Experimental direction, optional I would skip, Saveable learning.
- Use Yuna's language: visual column, relaxed structure, grounded texture, compact top, stable bottom, controlled softness, signature direction.`

  const checked = await askStylist({
    system: criticSystem,
    maxTokens: 1200,
    messages: [{ role: 'user', content: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      categoryConstraintForSelectedPiece(selectedPiece),
      `User request: ${userQuestion || 'Generate outfit ideas'}`,
      `Draft answer to audit and correct:\n${draft}`
    ].join('\n\n') }]
  })
  return checked || draft
}

function getOutfitsForPieceMemory(pieceId, limit = 6) {
  const outfits = db.prepare(`
    SELECT o.* FROM outfits o
    JOIN outfit_pieces op ON o.id = op.outfit_id
    WHERE op.piece_id = ?
    ORDER BY o.favorite DESC, o.date_added DESC
    LIMIT ?
  `).all(pieceId, limit)
  return outfits.map(o => buildOutfitText(o, getLinkedPiecesForOutfit(o.id))).join('\n\n')
}

function getStylistFeedbackMemory(contextType = null, contextId = null, limit = 16) {
  try {
    const clauses = []
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      ${where ? where + ' AND COALESCE(archived,0) = 0' : 'WHERE COALESCE(archived,0) = 0'}
      ORDER BY COALESCE(is_gold,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))

    if (!rows.length) return ''
    return rows.map(r => {
      const target = r.target_type ? `${r.target_type}` : 'item'
      const label = r.label ? ` — ${r.label}` : ''
      const note = r.note ? `: ${String(r.note).slice(0, 280)}` : ''
      if (r.feedback_type === 'wrong_silhouette') {
        return `- wrong_silhouette on ${target}${label}${note} — scoped to this selected garment/board; do NOT globally avoid this silhouette family.`
      }
      if (r.feedback_type === 'wrong_proportions' || r.feedback_type === 'proportion_problem') {
        return `- ${r.feedback_type} on ${target}${label}${note} — scoped to this selected garment/board; do NOT treat as a universal proportion rule.`
      }
      return `- ${r.feedback_type} on ${target}${label}${note}`
    }).join('\n')
  } catch {
    return ''
  }
}

function getWholeWardrobeFeedbackMemory(limit = 24) {
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND target_type = 'whole_wardrobe_outfit'
      ORDER BY COALESCE(is_gold,0) DESC, id DESC
      LIMIT ?
    `).all(Number(limit))

    if (!rows.length) return ''
    const positives = []
    const negatives = []
    for (const row of rows) {
      const payload = safeJsonParse(row.payload, {}) || {}
      const outfit = payload.outfit || {}
      const pieces = Array.isArray(payload.pieces) && payload.pieces.length
        ? payload.pieces
        : (Array.isArray(outfit.pieces) ? outfit.pieces : [])
      const pieceText = pieces.map(p => p?.name).filter(Boolean).join(' + ')
      const formula = payload.formulaFamily || outfit.formulaFamily || ''
      const occasion = payload.occasion || outfit.bestFor || ''
      const note = row.note ? ` — ${String(row.note).slice(0, 220)}` : ''
      const line = `- ${row.feedback_type}${row.label ? ` / ${row.label}` : ''}${occasion ? ` (${occasion})` : ''}${formula ? ` | formula: ${formula}` : ''}${pieceText ? ` | pieces: ${pieceText}` : ''}${note}`
      if (feedbackWeight(row.feedback_type) > 0) positives.push(line)
      if (feedbackWeight(row.feedback_type) < 0) negatives.push(line)
    }

    const parts = []
    if (positives.length) parts.push(`Whole-wardrobe outfit feedback to reinforce. Prefer similar garment relationships and formulas when pieces/occasion fit:
${positives.slice(0, 10).join('\n')}`)
    if (negatives.length) parts.push(`Whole-wardrobe outfit feedback to suppress. Avoid repeating these exact combinations, piece roles, formulas, or occasion mismatches:
${negatives.slice(0, 12).join('\n')}`)
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

function buildWholeWardrobeFeedbackInfluence(limit = 120) {
  const influence = {
    piece: new Map(),
    combination: new Map(),
    formula: new Map(),
    occasionFormula: new Map(),
    pieceFormula: new Map(),
    rowsUsed: 0
  }
  const add = (map, key, value) => {
    if (!key || !value) return
    map.set(key, (map.get(key) || 0) + value)
  }
  try {
    const rows = db.prepare(`
      SELECT * FROM stylist_feedback
      WHERE COALESCE(archived,0) = 0
        AND target_type = 'whole_wardrobe_outfit'
      ORDER BY id DESC
      LIMIT ?
    `).all(Number(limit))
    for (const row of rows) {
      const weight = feedbackWeight(row.feedback_type)
      if (!weight) continue
      const payload = safeJsonParse(row.payload, {}) || {}
      const outfit = payload.outfit || {}
      const pieceIds = [...new Set((payload.pieceIds || outfit.pieceIds || collectPieceIdsFromFeedbackPayload(row.payload))
        .map(Number)
        .filter(Boolean))]
      const focusedPieceId = Number(payload.pieceId)
      const formula = payload.formulaFamily || outfit.formulaFamily || ''
      const occasion = payload.occasion || outfit.bestFor || ''
      const signedWeight = weight + (row.is_gold ? Math.sign(weight) * 18 : 0)

      if (Number.isFinite(focusedPieceId) && focusedPieceId > 0) {
        const focusedWeight = row.feedback_type === 'wrong_item_read' || row.feedback_type === 'fit_issue'
          ? Math.round(signedWeight * 1.35)
          : Math.round(signedWeight * 0.9)
        add(influence.piece, focusedPieceId, focusedWeight)
        if (formula) add(influence.pieceFormula, `${focusedPieceId}||${formula}`, Math.round(focusedWeight * 0.8))
      } else if (pieceIds.length) {
        const comboKey = pieceIds.slice().sort((a, b) => a - b).join('|')
        add(influence.combination, comboKey, Math.round(signedWeight * 1.15))
        const pieceMultiplier = row.feedback_type === 'good_formula' ? 0.12 : (row.feedback_type === 'good_pieces' ? 0.55 : 0.35)
        for (const id of pieceIds) add(influence.piece, id, Math.round(signedWeight * pieceMultiplier))
      }
      const formulaMultiplier = row.feedback_type === 'good_formula' ? 0.9 : (row.feedback_type === 'good_pieces' ? 0.2 : 0.45)
      add(influence.formula, formula, Math.round(signedWeight * formulaMultiplier))
      if (occasion && formula) add(influence.occasionFormula, `${occasion}||${formula}`, Math.round(signedWeight * 0.65))
      influence.rowsUsed += 1
    }
  } catch {}
  return influence
}

function wholeWardrobeFeedbackInfluenceForCandidate(pieces = [], options = {}) {
  const influence = options.wholeWardrobeFeedbackInfluence
  if (!influence) return null
  const ids = pieces.map(p => Number(p.id)).filter(Boolean)
  const outfit = { pieces }
  const comboKey = ids.slice().sort((a, b) => a - b).join('|')
  const formula = wholeWardrobeFormulaFamily(outfit, pieces, options.occasion)
  const occasionFormula = `${options.occasion || ''}||${formula}`
  let score = 0
  const reasons = []
  const addScore = (value, reason) => {
    if (!value) return
    score += value
    reasons.push(reason)
  }

  addScore(influence.combination.get(comboKey), 'whole-wardrobe exact-combination feedback')
  addScore(influence.formula.get(formula), `whole-wardrobe ${formula} feedback`)
  addScore(influence.occasionFormula.get(occasionFormula), `whole-wardrobe ${options.occasion || 'occasion'} formula feedback`)
  const pieceFormulaScore = ids.reduce((sum, id) => sum + (influence.pieceFormula.get(`${id}||${formula}`) || 0), 0)
  addScore(Math.max(-55, Math.min(35, pieceFormulaScore)), 'whole-wardrobe piece/formula feedback')
  const pieceScore = ids.reduce((sum, id) => sum + (influence.piece.get(id) || 0), 0)
  addScore(Math.max(-45, Math.min(30, Math.round(pieceScore / Math.max(1, ids.length)))), 'whole-wardrobe piece feedback')

  if (!score) return null
  return {
    score: Math.max(-80, Math.min(80, score)),
    reasons: [...new Set(reasons)].slice(0, 4)
  }
}


async function criticPassForSelectedItem({ selectedPiece, draft, userQuestion }) {
  if (process.env.STYLIST_CRITIC_DISABLED === 'true') return draft

  const criticSystem = `You are a strict editor for Yuna's wardrobe stylist app.
Check the draft answer for rule violations.
Fix it if needed. Return ONLY the corrected final answer, no meta-commentary.

Hard checks:
- Every outfit idea must include the selected item.
- If selected item is a bottom, the answer must not recommend skirts/dresses/other pants as outfit ideas.
- It must not contradict authoritative notes, rejected pairings, or the user's style filter.
- Remove generic filler and body-shape commentary.
- Keep the required section structure.`

  const checked = await askStylist({
    system: criticSystem,
    maxTokens: 900,
    messages: [{ role: 'user', content: [
      `Selected item:\n${buildPieceText(selectedPiece)}`,
      categoryConstraintForSelectedPiece(selectedPiece),
      `User question: ${userQuestion || 'How should I style this piece?'}`,
      `Draft answer to audit and correct:\n${draft}`
    ].join('\n\n') }]
  })
  return checked || draft
}


async function criticPassForOutfit({ draft, userQuestion, outfitText = '', mode = 'evaluate_outfit' }) {
  if (process.env.STYLIST_CRITIC_DISABLED === 'true') return draft

  const criticSystem = `You are a strict editor for Yuna's outfit evaluation app.
Check the draft answer for prompt violations and fix it if needed.
Return ONLY the corrected final answer, no meta-commentary.

Hard checks:
- Remove body-part diagnostic language: bust area, legs as asset, tummy, figure, flattering your body.
- Do not automatically replace the main garment; suggest small adjustments first.
- If outfit context says confirmed/favorite, the answer must begin from why the outfit likely works. Do not recommend swapping core garments unless the user specifically asked for alternatives.
- If linked garment truth is present, do not contradict it. If linked truth is absent, avoid overconfident garment identification and mention that linking pieces would improve precision only when relevant.
- Do not recommend tucking unless garment truth says tucking is possible/comfortable.
- Do not neutralize intentionally playful shoes, relaxed jeans, cuffs, or quiet black flats by default.
- Do not recommend more fitted jeans/pants unless the current bottom is visibly collapsing the outfit.
- Do not call relaxed jeans/cuffs unstable just because they interrupt a textbook long column; judge the full visual edit first.
- Do not call an outfit boxy when asymmetry, taper, or garment shaping creates shape.
- Keep the evaluation about garment composition: silhouette, visual edit, vertical continuity as one factor, texture, color, proportion, comfort realism.
- Preserve nuance: technically works vs aesthetically aligned.
- Keep the required section structure.`

  const checked = await askStylist({
    system: criticSystem,
    maxTokens: 900,
    messages: [{ role: 'user', content: [
      `Mode: ${mode}`,
      outfitText ? `Outfit context:\n${outfitText}` : '',
      `User question: ${userQuestion || 'What do you think of this outfit?'}`,
      `Draft answer to audit and correct:\n${draft}`
    ].filter(Boolean).join('\n\n') }]
  })
  return checked || draft
}




// ── AI provider abstraction for stylist endpoints ─────────────────────────────
const AI_PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase()
const ANTHROPIC_MODEL = process.env.ANTHROPIC_STYLIST_MODEL || 'claude-sonnet-4-6'
const OPENAI_MODEL = process.env.OPENAI_STYLIST_MODEL || 'gpt-4o'
const ACTIVE_STYLIST_MODEL = AI_PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL

function assertProviderKey() {
  if (AI_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('AI_PROVIDER=openai but no OPENAI_API_KEY set in .env')
  }
  if (AI_PROVIDER !== 'openai' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY set in .env')
  }
}

function contentToOpenAI(content) {
  if (typeof content === 'string') return content
  return (content || []).map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') {
      return {
        type: 'image_url',
        image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` }
      }
    }
    return { type: 'text', text: JSON.stringify(part) }
  })
}


function parseModelJson(raw) {
  return JSON.parse(String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim())
}

async function askClaude({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('No ANTHROPIC_API_KEY set in .env')
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system,
    messages
  })
  return response.content?.[0]?.text || ''
}

async function askStylist({ system = STYLIST_SYSTEM, messages, maxTokens = 1200 }) {
  assertProviderKey()

  if (AI_PROVIDER === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role, content: contentToOpenAI(m.content) }))
      ]
    })
    return response.choices?.[0]?.message?.content || ''
  }

  return askClaude({ system, messages, maxTokens })
}



const OUTFIT_COMPOSER_SYSTEM = `You are the Outfit Composer for Yuna's wardrobe app.
Return ONLY valid JSON. No markdown.

Your job is styling composition only. Do not write renderer instructions. Do not explain identity theory.
Create complete, ranked outfit formulas for ONE selected garment using actual saved wardrobe candidates.

NON-NEGOTIABLE TARGET:
Compose like a visually literate artist/stylist, not a retail recommendation engine.
The winning boards are controlled, edited, specific, and memorable. They have one clear visual thesis.
Do NOT optimize for conventional flattering, generic balance, tasteful mature casual, or "elevated everyday" safety.

Core hierarchy:
1. Strong complete outfit composition first.
2. Selected garment remains central in every outfit.
3. Each outfit needs one dominant silhouette idea AND one controlled tension: graphic contrast, dark column, sharp shoe, texture contrast, structured/relaxed friction, or a precise color story.
4. Preserve selective visual friction. Do not smooth every risk into bland harmony.
5. Use missing pieces only when the request allows ideal/missing-piece ideas, and mark them clearly.

Yuna style shorthand:
- artistic minimalist, relaxed structure, grounded femininity, modern restraint
- implied waist through shape/drape, not cinching/tucking
- warm earthy/deep palette: olive, mustard, cognac, cream, taupe, navy, chocolate, espresso, charcoal, black, plum
- controlled playful/graphic moments are good when the silhouette is edited
- avoid over-layering, costume styling, wide+wide+soft, generic fashion-blog styling, excessive softness

Strong board logic copied from successful references:
- Give each direction a real name/lane: Clean & Modern, Earthy & Structured, Artistic Contrast, Gallery Casual, Dark Column, Modern Preppy, Soft Color Pop, Slightly Edgy Contrast, Graphic Minimal, Modern Artisan, Black Minimalist, Relaxed Artistic, Structured Utility, Slightly Edgy Contrast.
- Prioritize edited silhouette + visual hierarchy + grounded shoe.
- Use dark columns, pointed flats/loafers/boots, long pendants, structured bags, utility pants, controlled denim, pencil/midi/column skirts, and precise earth/deep color stories when available.
- A little tension is GOOD. If an outfit has no tension, it is probably boring.
- For soft/quiet tops, do NOT default to cream skirts or taupe linen. First test a dark column, an earthy structured bottom, a black/charcoal grounding option, and one controlled color-tension option.
- If the source/reference has angular relaxed tension, preserve that attitude: off-center ease, dark denim/column grounding, cuffs, boots/loafers, and sharp shoe weight are often stronger than polite light shoes.

Reject/avoid while composing:
- boring tonal sludge, flat beige/cream softness, generic "luxe neutral layering", mature catalog comfort, librarian drift, purely soft skirt + soft shoe + soft top, pleasant neutral filler, weak shoe grounding, low-contrast beige/taupe mush, and "balanced silhouette" language.
- Aggressively demote cream skirt + cream shoe, beige trouser + light flat, soft skirt + slip-on sneaker, and any outfit whose only idea is "light neutral elegance".
- Do not write: harmonious, flattering, elongating, confidence, elevated casual, sophisticated neutral, balance the body, draws attention upward.

Board architecture:
- Each direction must be a complete outfit, not an accessory idea or vague styling suggestion.
- Each direction must have a distinct purpose/lane.
- Prefer 4-5 directions in closet-only mode if enough wardrobe pieces exist. Never pad with weak ideas.
- First direction must be the most visually specific/signature direction, not the safest conventional one.

JSON shape:
{
  "outfits": [
    {
      "label": "Modern Minimal Column",
      "strength": "signature | strong | usable | experimental",
      "dominantDirection": "short style lane",
      "silhouette": "one clear silhouette idea",
      "bestFor": "short use case",
      "pieceIds": [1, 2, 3],
      "pieces": [
        {"id": 1, "name": "exact saved garment name", "category": "top"},
        {"id": "missing-...", "name": "specific archetype (missing piece)", "category": "shoes", "missing": true}
      ],
      "reason": "specific visual reason; use words like visual column, stable bottom, controlled softness, grounded texture, relaxed structure",
      "watchFor": "one real risk or none"
    }
  ],
  "skip": "one tempting weak direction to skip, or empty string",
  "saveableLearning": "one garment-specific rule"
}

Rules:
- For owned pieces, use exact candidate ids and names.
- In closet-only mode, use owned candidate ids only.
- In ideal mode, include one best owned direction and one ideal missing-piece completion.
- Do not recommend replacing the selected garment.
- Do not use generic wording like harmony, balance, confidence, flattering, draws attention upward.
- Do not recommend tucking unless garment truth supports it.`

const OUTFIT_EVALUATOR_GATE_SYSTEM = `You are the Outfit Gate for Yuna's wardrobe app.
Return ONLY valid JSON. No markdown.

Your job is to audit composed outfit formulas before rendering. You are not the renderer and not a second stylist.
Reject weak, duplicated, vague, or unstable directions.

Keep only outfits that pass these checks:
- includes the selected garment
- is a complete outfit direction, not a fragment
- has one dominant silhouette idea
- has clear shoe/grounding logic when shoes are included or missing
- has one controlled visual tension or graphic decision
- does not stack too much softness/volume/boho texture
- is distinct from the other directions
- does not read as mature catalog, generic retail, librarian, or beige/neutral sludge
- label strength honestly: signature, strong, usable, experimental

Reject outfits whose main virtue is merely "balanced", "flattering", "luxe neutral", "soft", "comfortable", "pleasant", or "elegant". If an outfit lacks a memorable contrast/shape decision, demote it even if it is wearable.
Prefer 3 visually specific boards over 5 mediocre boards.
Require at least one of the top three to use a dark/charcoal/black/deep column or strong grounding unless the selected garment itself is already dark and structured.
Demote light neutral outfits unless they contain real graphic contrast, sharp footwear, or structural tension.
Never upgrade a weak/fallback outfit to signature.

JSON shape:
{
  "outfits": [same outfit objects, corrected if needed],
  "rejected": [{"label":"...", "reason":"..."}],
  "skip": "one concise skip note or empty string",
  "saveableLearning": "one concise garment-specific rule"
}`

const WHOLE_WARDROBE_COMPOSER_SYSTEM = `You are the whole-wardrobe outfit composer for Yuna's closet app.
Return ONLY valid JSON. No markdown.

You receive a curated set of complete candidate outfits already built from saved wardrobe pieces. Your job is to pick the strongest outfits right now, not to browse the raw closet.

Yuna's style filter:
- artistic minimalist, relaxed structure, modern bohemian restraint
- one dominant silhouette idea
- vertical continuity, grounded shoes, edited texture, warm/deep palette
- controlled playful moments are good when the silhouette is disciplined

Reject:
- wide + wide, soft + soft + soft, weak shoe grounding
- generic beige/cream softness, mature catalog drift, librarian drift
- duplicate formulas and outfits whose only virtue is wearable harmony
- body-shape/flattery language

Rules:
- Use only candidate outfit ids and owned garment ids/names provided.
- Keep fewer than 5 if only 3-4 are genuinely strong.
- Surface at least 3 distinct formula families across your selections when viable. Do not pick more than 2 outfits from the same formula family.
- Preserve exact owned piece ids and names.
- Do not invent missing pieces.
- Do not use words like flattering, elongating, slimming, confidence, balance the body, or draws attention upward.

JSON shape:
{
  "outfits": [
    {
      "candidateId": "cand-1",
      "label": "Modern Minimal Column",
      "strength": "signature | strong | usable | experimental",
      "dominantDirection": "relaxed top + dark column",
      "silhouette": "compact upper line over grounded straight-leg denim",
      "bestFor": "city casual",
      "pieceIds": [1, 2, 3],
      "pieces": [{"id": 1, "name": "exact saved garment name", "category": "top"}],
      "reason": "specific visual reason based on garment interaction",
      "watchFor": "one real risk or none"
    }
  ],
  "rejected": [{"candidateId": "cand-9", "label": "...", "reason": "..."}],
  "skip": "one tempting weak formula to skip, or empty string",
  "saveableLearning": "one concise whole-wardrobe rule"
}`

const WHOLE_WARDROBE_EVALUATOR_SYSTEM = `You are evaluating one proposed whole-wardrobe outfit for Yuna's closet app.
Return ONLY valid JSON. No markdown.

Evaluate lived personal style, not editorial fashion correctness.
Write like a precise fitting-room stylist looking at the photo and linked garment records.
The goal is not maximum visual cleanliness, trend conformity, or simplifying every outfit.

Evaluation philosophy:
- Successful personal outfits can rely on mixed textures, softness against structure, asymmetry, historical references, and imperfect harmony.
- Do not automatically penalize visual tension. Classify it as productive tension or problematic tension.
- Distinguish visual correctness from stylistic identity. An outfit can be slightly unresolved but still emotionally coherent and worth preserving.
- Evaluate operational reality: whether the outfit survives movement, sitting, walking, sleeve/hem behavior, and whether it requires constant adjustment.
- The best recommendation helps the outfit become more itself; it does not flatten the outfit into a safer generic version.

Avoid:
- body-shape/flattery language
- saying "Yuna's aesthetic", "Yuna's style", "adhering to", "aligning with", or any sentence that merely proves you know the profile
- generic phrases like balanced, elevated, sophisticated, playful touch, visual interest, modernity, adds depth, overall look, refinement, cohesion/cohesive, professional, elegant finish
- pretending a questionable combination works just because the pieces are individually good
- vague fixes like "add an accessory", "add a statement piece", "choose a simpler top", or "introduce color" unless you name exactly what visual problem it solves
- recommending replacement of a linked/core garment as the first move. This is an evaluation of the saved outfit, not a request to rebuild it from scratch.
- saying "replace the blouse/top/bottom/shoe" unless the verdict is avoid. For revise, first suggest an adjustment using the current pieces.
- treating "cleaner", "sleeker", "simpler", or "more minimal" as automatically better

Replacement language rules:
- Instead of "cohesive", name the actual relationship: "the vest frames the blouse", "the trouser line gives the outfit a soft base", or "the quiet palette lets the texture mix read intentionally."
- Instead of "visual interest", name the source: ruffled neckline, tweed texture, long trouser line, pointed shoe, print scale, color contrast, shine, drape, or visible hem behavior.
- Do not suggest a statement necklace as a generic fix. Only mention jewelry if it solves a named problem, such as "the blouse neckline disappears under the vest"; otherwise keep jewelry quiet.
- If tensionType is productive or mixed, possibleCompetingPiece must name the garment relationship creating that tension. Do not answer "None."

Required reasoning order:
1. Parse visible facts before judging. This section must describe what is actually visible, including the floor line if a full-body photo is present.
2. Infer the outfit intent. Ask: what kind of success is this outfit attempting?
3. Evaluate within that intent, not against universal "good style".
4. Recommend the smallest adjustment that preserves the intent.

Visible facts must include:
- floorLine: trouser/skirt hem break, pooling, shoe visibility, and whether the shoe gives enough finish. If unclear, say low confidence.
- upperLayering: what the blouse/top/vest/jacket relationship visibly does.
- waistArea: what is visible at the waist/tuck/layer overlap. Do not invent shifting, tugging, or tuck failure from a still photo.
- texturePattern: which texture, ruffle, shine, print, or drape is actually visible.
- confidenceLimits: what the photo does not let you judge.

Intent inference must include:
- intentLabel, such as soft-structured smart casual, grounded romantic tailoring, relaxed sculptural, quiet artistic, graphic minimal, operationally fussy layering.
- successCriteria: the outfit-specific rules it should be judged by.

Evaluation within intent must include:
- roles: heroPiece, supportPieces, groundingPiece, possibleCompetingPiece.
- tensionType: productive, mixed, or problematic.
- mainSuccess: the best thing the outfit achieves within its intent.
- firstVisibleIssue: the most visible unresolved area in the actual photo. In full-body photos, floorLine usually outranks theoretical upper-body cleanup.
- maintenanceBurden: what needs monitoring, tugging, arranging, cuffing, smoothing, or better shoe visibility.

Recommendation rules:
- recommendation.smallestAdjustment must address evaluation.firstVisibleIssue.
- Do not recommend a replacement garment unless verdict is avoid.
- Tuck advice is allowed only when garment truth supports tucking AND visibleFacts.waistArea is the firstVisibleIssue. If recommending it, phrase it as a low-maintenance test, such as "try a cleaner front tuck if it stays put naturally", not as a fussy requirement.

For the critique:
- say what works, what fails or feels risky, and whether the occasion fit is convincing
- name the actual garments and their jobs
- distinguish "good pieces" from "good combination"
- if a piece seems fit-risky, too dominant, too casual, or wrong for the occasion, say so plainly
- make the recommendation the first visible thing to adjust inside this outfit: hem break, shoe visibility/weight, cuffing, buttoning/opening a layer, sleeve handling, blouse placement, removing/adding one visible support piece only if already linked or clearly optional
- if a garment interaction is risky, explain the salvage path before proposing a replacement
- if the photo is too distant, backlit, or unclear for a detail, say that detail is low-confidence instead of inventing certainty

JSON shape:
{
  "visibleFacts": {
    "floorLine": "what is visible about hem break, pooling, shoe visibility, shoe finish, or low-confidence note",
    "upperLayering": "visible blouse/top/vest/jacket relationship",
    "waistArea": "visible waist/tuck/layer overlap, or low-confidence note",
    "texturePattern": "visible texture/pattern/drape relationship",
    "confidenceLimits": "what the photo does not clearly show"
  },
  "inferredIntent": {
    "label": "soft-structured smart casual | grounded romantic tailoring | relaxed sculptural | quiet artistic | etc.",
    "successCriteria": ["outfit-specific criterion", "outfit-specific criterion"]
  },
  "evaluation": {
    "summary": "2-3 sentence direct evaluation. Must connect visible facts to inferred intent.",
    "verdict": "keep | revise | avoid",
    "roles": {
      "heroPiece": "garment name and why it is the focal/intent piece",
      "supportPieces": ["garment name and job"],
      "groundingPiece": "garment name and grounding job",
      "possibleCompetingPiece": "garment name and whether the tension is productive or problematic"
    },
    "tensionType": "productive | mixed | problematic",
    "maintenanceBurden": "low | medium | high",
    "mainSuccess": "best thing this outfit achieves within its intent",
    "firstVisibleIssue": "most visible unresolved area from the photo",
    "scores": {
      "tensionQuality": 1-5,
      "silhouetteIntegrity": 1-5,
      "embodiedEase": 1-5,
      "stylePresence": 1-5,
      "occasionReality": 1-5
    }
  },
  "recommendation": {
    "smallestAdjustment": "one concrete current-outfit adjustment tied to firstVisibleIssue",
    "avoidForNow": "one tempting but premature change to avoid",
    "tryNext": "optional next garment/fit experiment tied to the diagnosis; not a generic accessory suggestion and not a render prompt"
  },
  "verdict": "keep | revise | avoid",
  "works": ["specific thing that works"],
  "risks": ["specific thing to watch or fix"],
  "saveableLearning": "one concise learning rule"
}`

const WHOLE_WARDROBE_OUTFIT_ARCHETYPES = [
  {
    id: 'grounded_graphic_column',
    label: 'Grounded Graphic Column',
    direction: 'restrained graphic minimalism',
    silhouette: 'compact upper over long grounded lower line',
    visualGoal: 'artistic but controlled',
    formulaFamily: 'compact_top_dark_column',
    preferredRoles: ['upper_anchor', 'graphic_element', 'lower_column', 'grounding_piece'],
    avoidRoles: ['soft_texture', 'extra_pattern'],
    occasionBias: { evening: 12, 'gallery / art event': 14, casual: 4 }
  },
  {
    id: 'soft_structure_contrast',
    label: 'Soft Structure Contrast',
    direction: 'soft piece anchored by structure',
    silhouette: 'soft expressive garment held by structured support pieces',
    visualGoal: 'modern artistic restraint',
    formulaFamily: 'soft_piece_structured_anchor',
    preferredRoles: ['soft_texture', 'grounding_piece', 'structure_support'],
    avoidRoles: ['soft_texture_stack'],
    occasionBias: { casual: 8, 'gallery / art event': 10 }
  },
  {
    id: 'earthy_structured_minimal',
    label: 'Earthy Structured Minimal',
    direction: 'earthy restraint with clear garment structure',
    silhouette: 'structured separates with one relaxed element',
    visualGoal: 'modern bohemian restraint without looseness',
    formulaFamily: 'earthy_structured_separates',
    preferredRoles: ['grounding_piece', 'structure_support', 'lower_column'],
    avoidRoles: ['beige_sludge', 'soft_texture_stack'],
    occasionBias: { casual: 8, 'gallery / art event': 10 }
  },
  {
    id: 'dress_grounded_sharp',
    label: 'Grounded Dress Edit',
    direction: 'simple dress sharpened by shoe/layer choice',
    silhouette: 'one-piece column with grounded finish',
    visualGoal: 'clean evening/gallery option without extra fuss',
    formulaFamily: 'dress_grounding_shoe',
    preferredRoles: ['one_piece_column', 'grounding_piece', 'sharp_finish'],
    avoidRoles: ['extra_pattern', 'soft_shoe'],
    occasionBias: { evening: 14, 'gallery / art event': 10 }
  },
  {
    id: 'relaxed_dark_base',
    label: 'Relaxed Dark Base',
    direction: 'oversized or relaxed top stabilized by a narrow/dark base',
    silhouette: 'relaxed upper over stable dark lower column',
    visualGoal: 'wearable artistic ease without shapelessness',
    formulaFamily: 'relaxed_top_dark_base',
    preferredRoles: ['relaxed_upper', 'lower_column', 'grounding_piece'],
    avoidRoles: ['wide_soft_bottom', 'soft_texture_stack'],
    occasionBias: { casual: 10, city: 8 }
  }
]


function outfitStylisticStrengthScore(outfit = {}, selectedPiece = null) {
  const text = [
    outfit.label,
    outfit.dominantDirection,
    outfit.silhouette,
    outfit.bestFor,
    outfit.reason,
    outfit.watchFor,
    ...(Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name || '') : [])
  ].join(' ').toLowerCase()
  let score = 0
  const add = (n, reason) => { score += n }

  // Reward visual specificity and controlled tension: the successful boards had a clear thesis.
  if (/\b(dark column|column|graphic|contrast|structured|structure|architectural|gallery|modern minimal|clean & modern|clean and modern|earthy & structured|earthy and structured|artistic contrast|modern preppy|city minimal|black minimalist|monochrome chic|relaxed artistic|structured utility|slightly edgy)\b/.test(text)) add(22)
  if (/\b(black|charcoal|deep navy|espresso|chocolate|plum|olive|cognac|rust|terra.?cotta|ink navy)\b/.test(text)) add(9)
  if (/\b(pointed|loafer|loafers|ankle boot|boots|boot|structured bag|crossbody|long pendant|belt|blazer|utility|denim|jeans|cigarette|straight|pencil|midi|column skirt|dark denim|cuffed|cuff|mule|oxford)\b/.test(text)) add(10)
  if (/\b(tension|friction|sharp|grounded|edited|visual thesis|focal|directional|memorable|angular|asymmetry|asymmetric|attitude)\b/.test(text)) add(18)
  if (/\b(dark|black|charcoal|espresso|deep navy)\b/.test(text) && /\b(pointed|loafer|boot|structured|column|jeans|trouser)\b/.test(text)) add(10)

  // Penalize the recurring failure mode: safe retail harmony / mature-casual sludge.
  if (/\b(luxe neutral|elevated casual|harmonious|harmony|flattering|elongating|draws attention upward|balanced silhouette|balance the body|confidence|comfortable chic|soft romantic|soft neutral|textured monochrome contrast|lightweight layered elegance|luxe neutral layering)\b/.test(text)) add(-34)
  if (/\b(librarian|catalog|mature|tasteful|polished neutral|sophisticated neutral|respectable|ladylike)\b/.test(text)) add(-30)
  if (/\b(cream stable slip-on|stable slip-on|soft shoe|light casual sneaker|rounded sneaker|beige|sand-colored|sand colored|cream slip-on|taupe slip-on|white architectural skirt|soft white skirt)\b/.test(text)) add(-18)
  if (/\b(soft)\b/.test(text) && !/\b(contrast|structure|structured|dark|black|charcoal|pointed|boot|loafer|graphic)\b/.test(text)) add(-18)
  if (/\b(cream|ivory|white|beige|taupe|sand|blush)\b/.test(text) && /\b(skirt|pant|trouser|shoe|sneaker|slip-on|flat)\b/.test(text) && !/\b(black|charcoal|deep navy|espresso|plum|cognac|rust|graphic|contrast|pointed|boot|structured|dark column)\b/.test(text)) add(-18)


  if (/\b(cream|beige|taupe|ivory|sand|blush)\b/.test(text) && !/\b(black|charcoal|espresso|plum|deep navy|graphic|contrast|pointed|boot|structured|dark column)\b/.test(text)) add(-14)
  if (/\b(skirt|pants|trouser)\b/.test(text) && !/\b(pointed|loafer|boot|black|structured|dark|cognac|sharp|grounded)\b/.test(text)) add(-8)

  // Missing a distinct lane is a warning sign.
  if (!String(outfit.label || '').trim() || /^third wardrobe option|best wardrobe direction|relaxed structured variation|strongest wardrobe column$/i.test(String(outfit.label || '').trim())) add(-8)
  if (!String(outfit.dominantDirection || '').trim()) add(-6)
  if (!String(outfit.silhouette || '').trim()) add(-6)
  return score
}

function sortByStylisticStrength(outfits = [], selectedPiece = null) {
  const strengthOrder = { signature: 8, strong: 5, usable: 2, experimental: 1 }
  return [...outfits].sort((a, b) => {
    const as = outfitStylisticStrengthScore(a, selectedPiece) + (strengthOrder[a?.strength] || 3)
    const bs = outfitStylisticStrengthScore(b, selectedPiece) + (strengthOrder[b?.strength] || 3)
    return bs - as
  }).map((o, index) => {
    const score = outfitStylisticStrengthScore(o, selectedPiece)
    const copy = { ...o }
    if (index === 0 && score >= 8) copy.strength = 'signature'
    else if (score < -15 && copy.strength === 'signature') copy.strength = 'usable'
    else if (score < -5 && copy.strength === 'strong') copy.strength = 'usable'
    return copy
  })
}

function normalizeGeneratedOutfitObject(outfit, selectedPiece, candidatePieces = []) {
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  const selectedId = Number(selectedPiece?.id)
  const ids = []
  const missingPieces = []

  const addId = (value) => {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0 && candidateById.has(n) && !ids.includes(n)) ids.push(n)
  }

  if (Array.isArray(outfit?.pieceIds)) outfit.pieceIds.forEach(addId)
  if (Array.isArray(outfit?.pieces)) {
    for (const piece of outfit.pieces) {
      if (piece?.missing || String(piece?.id || '').startsWith('missing-')) {
        const rawName = piece.name || piece.label || 'missing piece'
        const normalized = normalizeForMatch(rawName).replace(/missing piece/g, '').trim() || normalizeForMatch(rawName) || 'support piece'
        missingPieces.push({
          id: piece.id || `missing-${normalized.replace(/\s+/g, '-')}`,
          name: /missing piece/i.test(rawName) ? rawName : `${rawName} (missing piece)`,
          category: piece.category || inferMissingCategory(rawName),
          missing: true,
          photo: null,
          worn_photo: null
        })
      } else {
        addId(piece?.id)
      }
    }
  }
  if (selectedId && !ids.includes(selectedId)) ids.unshift(selectedId)

  const ownedPieces = ids.map(id => candidateById.get(id)).filter(Boolean)
  const cleanMissing = dedupeMissingAgainstOwned(missingPieces, ownedPieces).slice(0, Math.max(0, 5 - ownedPieces.length))
  const label = String(outfit?.label || outfit?.title || 'Outfit direction').trim()
  const strength = String(outfit?.strength || '').toLowerCase().trim()
  return {
    label,
    strength: ['signature', 'strong', 'usable', 'experimental'].includes(strength) ? strength : (label.toLowerCase().includes('signature') ? 'signature' : 'strong'),
    dominantDirection: outfit?.dominantDirection || outfit?.dominant_direction || outfit?.direction || '',
    silhouette: outfit?.silhouette || '',
    bestFor: outfit?.bestFor || outfit?.best_for || '',
    reason: outfit?.reason || outfit?.why || '',
    watchFor: outfit?.watchFor || outfit?.watch_for || 'none',
    pieceIds: ids.slice(0, 5),
    missingPieces: cleanMissing,
    pieces: [
      ...ownedPieces.map(p => ({ id: p.id, name: p.name, category: p.category })),
      ...cleanMissing.map(p => ({ id: p.id, name: p.name, category: p.category, missing: true }))
    ]
  }
}

function locallyGateOutfitDirections(outfits = [], selectedPiece) {
  const selectedId = Number(selectedPiece?.id)
  const seen = new Set()
  const accepted = []
  const rejected = []
  for (const outfit of outfits) {
    const ids = Array.isArray(outfit?.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    const missingCount = Array.isArray(outfit?.missingPieces) ? outfit.missingPieces.length : 0
    const key = ids.slice().sort((a,b) => a-b).join('|') + '::' + (outfit?.label || '').toLowerCase()
    if (selectedId && !ids.includes(selectedId)) {
      rejected.push({ label: outfit?.label || 'unnamed', reason: 'does not include selected garment' })
      continue
    }
    if ((ids.length + missingCount) < 2) {
      rejected.push({ label: outfit?.label || 'unnamed', reason: 'not a complete outfit direction' })
      continue
    }
    if (seen.has(key)) {
      rejected.push({ label: outfit?.label || 'unnamed', reason: 'duplicate direction' })
      continue
    }
    seen.add(key)
    accepted.push(outfit)
  }
  return sortByStylisticStrength(accepted, selectedPiece).slice(0, 5)
}



function mergeOutfitDirections(primary = [], fallback = [], selectedPiece, { closetOnly = false, minCount = 3 } = {}) {
  const selectedId = Number(selectedPiece?.id)
  const merged = []
  const seen = new Set()
  const add = (outfit) => {
    if (!outfit) return
    const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
    const hasMissing = (Array.isArray(outfit.missingPieces) && outfit.missingPieces.length) ||
      (Array.isArray(outfit.pieces) && outfit.pieces.some(p => p?.missing || String(p?.id || '').startsWith('missing-')))
    if (closetOnly && hasMissing) return
    if (selectedId && !ids.includes(selectedId)) return
    if (ids.length < 2) return
    const key = ids.slice().sort((a,b) => a-b).join('|')
    if (seen.has(key)) return
    seen.add(key)
    merged.push(outfit)
  }
  primary.forEach(add)
  fallback.forEach(add)
  return locallyGateOutfitDirections(merged, selectedPiece).slice(0, Math.max(minCount, 4))
}


function buildLocalFallbackOutfitDirections(selectedPiece, rankedCandidates = []) {
  const selected = selectedPiece
  const byCategory = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [] }
  for (const r of rankedCandidates || []) {
    const piece = r?.piece || r
    if (!piece || piece.id === selected?.id) continue
    const cat = wardrobeCategoryGroup(piece)
    if (byCategory[cat]) byCategory[cat].push(piece)
  }

  const pick = (cat, used = new Set()) => (byCategory[cat] || []).find(p => !used.has(Number(p.id)))
  const make = ({ label, strength, dominantDirection, silhouette, bestFor, pieces, reason, watchFor }) => {
    const all = [selected, ...(pieces || [])].filter(Boolean)
    const seen = new Set()
    const owned = all.filter(piece => {
      const id = Number(piece.id)
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    return normalizeGeneratedOutfitObject({
      label,
      strength,
      dominantDirection,
      silhouette,
      bestFor,
      pieceIds: owned.map(p => p.id),
      pieces: owned.map(p => ({ id: p.id, name: p.name, category: p.category })),
      reason,
      watchFor: watchFor || 'none'
    }, selected, [selected, ...rankedCandidates.map(r => r?.piece || r).filter(Boolean)])
  }

  const outfits = []
  const usedFirst = new Set()

  if (wardrobeCategoryGroup(selected) === 'top') {
    const bottom1 = pick('bottom', usedFirst); if (bottom1) usedFirst.add(Number(bottom1.id))
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    const acc1 = pick('accessory', usedFirst); if (acc1) usedFirst.add(Number(acc1.id))
    if (bottom1) outfits.push(make({
      label: 'Most specific wardrobe direction',
      strength: 'signature',
      dominantDirection: 'edited outfit with a clear visual thesis',
      silhouette: 'selected top plus a grounded lower-half shape',
      bestFor: 'everyday, city days, casual meetings',
      pieces: [bottom1, shoes1, acc1].filter(Boolean),
      reason: 'Uses the strongest saved bottom to create a readable silhouette instead of a safe generic pairing.',
      watchFor: 'check shoe weight in the photo before rendering'
    }))

    const usedSecond = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const bottom2 = pick('bottom', usedSecond); if (bottom2) usedSecond.add(Number(bottom2.id))
    const shoes2 = pick('shoes', usedSecond); if (shoes2) usedSecond.add(Number(shoes2.id))
    const outer2 = pick('outerwear', usedSecond); if (outer2) usedSecond.add(Number(outer2.id))
    if (bottom2) outfits.push(make({
      label: 'Controlled contrast variation',
      strength: 'strong',
      dominantDirection: 'casual direction with one deliberate contrast',
      silhouette: 'compact/controlled top with an intentional saved bottom',
      bestFor: 'errands, lunch, studio days',
      pieces: [bottom2, shoes2, outer2].filter(Boolean),
      reason: 'Gives a second real wardrobe option without replacing the selected top or inventing missing pieces.',
      watchFor: 'avoid adding a loose layer if it makes the waist area visually busy'
    }))


    const usedThird = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const bottom3 = pick('bottom', usedThird); if (bottom3) usedThird.add(Number(bottom3.id))
    const shoes3 = pick('shoes', usedThird); if (shoes3) usedThird.add(Number(shoes3.id))
    const acc3 = pick('accessory', usedThird); if (acc3) usedThird.add(Number(acc3.id))
    if (bottom3) outfits.push(make({
      label: 'Alternate visual thesis',
      strength: 'usable',
      dominantDirection: 'different saved-wardrobe idea with its own shape logic',
      silhouette: 'selected top with a different saved bottom and quiet support pieces',
      bestFor: 'alternate everyday styling test',
      pieces: [bottom3, shoes3, acc3].filter(Boolean),
      reason: 'Keeps the selected top central and uses only saved wardrobe pieces so the suggestion is testable immediately.',
      watchFor: 'compare this against the stronger first two options before rendering visuals'
    }))
  } else if (wardrobeCategoryGroup(selected) === 'bottom') {
    const top1 = pick('top', usedFirst); if (top1) usedFirst.add(Number(top1.id))
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    const acc1 = pick('accessory', usedFirst); if (acc1) usedFirst.add(Number(acc1.id))
    if (top1) outfits.push(make({
      label: 'Most specific wardrobe pairing',
      strength: 'signature',
      dominantDirection: 'selected bottom with a clear upper-half point of view',
      silhouette: 'stable bottom with a controlled upper half',
      bestFor: 'everyday, city days, casual meetings',
      pieces: [top1, shoes1, acc1].filter(Boolean),
      reason: 'Keeps the selected bottom central and uses the highest-ranked saved top rather than suggesting replacement bottoms.',
      watchFor: 'judge cuff or hem by the full outfit, not by vertical-column rules alone'
    }))

    const usedSecond = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const top2 = pick('top', usedSecond); if (top2) usedSecond.add(Number(top2.id))
    const shoes2 = pick('shoes', usedSecond); if (shoes2) usedSecond.add(Number(shoes2.id))
    const outer2 = pick('outerwear', usedSecond); if (outer2) usedSecond.add(Number(outer2.id))
    if (top2) outfits.push(make({
      label: 'Casual visual-tension variation',
      strength: 'strong',
      dominantDirection: 'relaxed structure with a distinct support piece',
      silhouette: 'selected bottom with a simple supporting top',
      bestFor: 'errands, lunch, casual days',
      pieces: [top2, shoes2, outer2].filter(Boolean),
      reason: 'Provides another complete wardrobe outfit while keeping the selected bottom as the anchor.',
      watchFor: 'skip extra layers if they compete with the main silhouette'
    }))


    const usedThird = new Set(outfits.flatMap(o => o.pieceIds.map(Number)))
    const top3 = pick('top', usedThird); if (top3) usedThird.add(Number(top3.id))
    const shoes3 = pick('shoes', usedThird); if (shoes3) usedThird.add(Number(shoes3.id))
    const acc3 = pick('accessory', usedThird); if (acc3) usedThird.add(Number(acc3.id))
    if (top3) outfits.push(make({
      label: 'Alternate visual thesis',
      strength: 'usable',
      dominantDirection: 'another real closet pairing with the selected bottom',
      silhouette: 'selected bottom with a different controlled top and quiet support pieces',
      bestFor: 'alternate everyday styling test',
      pieces: [top3, shoes3, acc3].filter(Boolean),
      reason: 'Keeps the selected bottom central and uses only saved wardrobe pieces so the suggestion is testable immediately.',
      watchFor: 'compare shoe grounding and top compactness before rendering visuals'
    }))
  } else if (wardrobeCategoryGroup(selected) === 'dress') {
    const shoes1 = pick('shoes', usedFirst); if (shoes1) usedFirst.add(Number(shoes1.id))
    const acc1 = pick('accessory', usedFirst); if (acc1) usedFirst.add(Number(acc1.id))
    const outer1 = pick('outerwear', usedFirst); if (outer1) usedFirst.add(Number(outer1.id))
    if (shoes1 || acc1 || outer1) outfits.push(make({
      label: 'Clean dress styling',
      strength: 'signature',
      dominantDirection: 'selected dress with restrained support pieces',
      silhouette: 'one-piece column with simple grounding',
      bestFor: 'dinner, events, gallery days',
      pieces: [shoes1, acc1, outer1].filter(Boolean),
      reason: 'Keeps the dress central and adds only support pieces from the wardrobe.',
      watchFor: 'avoid over-accessorizing the dress'
    }))
  } else {
    const top = pick('top', usedFirst); if (top) usedFirst.add(Number(top.id))
    const bottom = pick('bottom', usedFirst); if (bottom) usedFirst.add(Number(bottom.id))
    const shoes = pick('shoes', usedFirst); if (shoes) usedFirst.add(Number(shoes.id))
    if (top || bottom || shoes) outfits.push(make({
      label: 'Best wardrobe direction',
      strength: 'signature',
      dominantDirection: 'complete saved-wardrobe outfit',
      silhouette: 'simple stable outfit architecture',
      bestFor: 'everyday',
      pieces: [top, bottom, shoes].filter(Boolean),
      reason: 'Builds a complete outfit from the highest-ranked saved wardrobe pieces.',
      watchFor: 'none'
    }))
  }

  return locallyGateOutfitDirections(outfits, selected).slice(0, 3)
}

function formatStructuredOutfitFeedback({ selectedPiece, occasion, season, outfits = [], skip = '', saveableLearning = '' }) {
  const lines = [
    `**Generated outfit ideas for:** ${selectedPiece?.name || 'selected garment'}`,
    `**Occasion / season:** ${occasion || 'casual'} / ${season || 'current season'}`,
    ''
  ]
  const labelFor = (outfit, index) => {
    if (index === 0 || outfit.strength === 'signature') return 'Signature / strongest direction'
    if (outfit.strength === 'usable') return 'Usable variation'
    if (outfit.strength === 'experimental') return 'Optional experimental direction'
    return outfit.label || 'Strong direction'
  }
  outfits.forEach((outfit, index) => {
    lines.push(`**${labelFor(outfit, index)}**`)
    if (outfit.label && outfit.label !== labelFor(outfit, index)) lines.push(`Label: ${outfit.label}`)
    if (outfit.strength) lines.push(`Strength: ${outfit.strength}`)
    if (outfit.dominantDirection) lines.push(`Direction: ${outfit.dominantDirection}`)
    if (outfit.silhouette) lines.push(`Silhouette: ${outfit.silhouette}`)
    if (outfit.bestFor) lines.push(`Best for: ${outfit.bestFor}`)
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean).join(' + ') : ''
    if (pieces) lines.push(`Pieces: ${pieces}`)
    if (outfit.reason) lines.push(`Why it works: ${outfit.reason}`)
    lines.push(`Watch for: ${outfit.watchFor || 'none'}`)
    lines.push('')
  })
  if (skip) lines.push(`**I would skip**\n${skip}\n`)
  if (saveableLearning) lines.push(`**Saveable learning**\n- ${saveableLearning}`)
  return lines.join('\n').trim()
}

async function composeStructuredOutfitsForPiece({ selectedPiece, rankedCandidates, occasion, season, question, idealMode, idealOnlyMode, memoryText, history = [] }) {
  const candidatePieces = [selectedPiece, ...rankedCandidates.map(r => r.piece)]
  const candidateText = buildOutfitGenerationCandidateText(rankedCandidates)
  const userPayload = [
    `Selected garment id: ${selectedPiece.id}`,
    categoryConstraintForSelectedPiece(selectedPiece),
    `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
    '',
    `Occasion: ${occasion}`,
    `Season: ${season}`,
    `Mode: ${idealOnlyMode ? 'ideal missing-piece only' : idealMode ? 'mixed owned wardrobe plus ideal missing-piece completion' : 'closet-only saved wardrobe'}`,
    '',
    memoryText || '',
    '',
    candidateText ? `Ranked candidate wardrobe pieces. Use exact ids/names for owned pieces:\n${candidateText}` : 'No supporting wardrobe candidates found.',
    '',
    `User request: ${question || 'Generate outfit ideas for this piece.'}`
  ].filter(Boolean).join('\n')

  const rawComposer = await askStylist({
    system: OUTFIT_COMPOSER_SYSTEM,
    maxTokens: 1800,
    messages: [
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: [{ type: 'text', text: userPayload }] }
    ]
  })

  let composerParsed = safeJsonFromModel(rawComposer)
  let normalized = (composerParsed.outfits || []).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))

  // Run a gate/evaluator pass on the structured composer output. If it fails, keep deterministic local gating.
  let gated = { outfits: normalized, rejected: [], skip: composerParsed.skip || '', saveableLearning: composerParsed.saveableLearning || '' }
  try {
    const rawGate = await askStylist({
      system: OUTFIT_EVALUATOR_GATE_SYSTEM,
      maxTokens: 1400,
      messages: [{ role: 'user', content: [{ type: 'text', text: [
        `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
        categoryConstraintForSelectedPiece(selectedPiece),
        `Composer JSON to audit:\n${JSON.stringify({ outfits: normalized, skip: composerParsed.skip || '', saveableLearning: composerParsed.saveableLearning || '' }, null, 2)}`
      ].join('\n\n') }] }]
    })
    const gateParsed = safeJsonFromModel(rawGate)
    const gateOutfits = (gateParsed.outfits || []).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
    gated = {
      outfits: gateOutfits.length ? gateOutfits : normalized,
      rejected: gateParsed.rejected || [],
      skip: gateParsed.skip || composerParsed.skip || '',
      saveableLearning: gateParsed.saveableLearning || composerParsed.saveableLearning || ''
    }
  } catch (err) {
    console.warn('Outfit gate fallback:', err.message)
  }

  let outfits = locallyGateOutfitDirections(gated.outfits, selectedPiece)
  if (!outfits.length && normalized.length) outfits = locallyGateOutfitDirections(normalized, selectedPiece)

  const localFallback = buildLocalFallbackOutfitDirections(selectedPiece, rankedCandidates)

  if (idealOnlyMode) {
    outfits = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
  } else if (idealMode) {
    outfits = ensureIdealMissingCompletion(outfits.length ? outfits : localFallback, selectedPiece, true).map(o => normalizeGeneratedOutfitObject(o, selectedPiece, candidatePieces))
  } else {
    // Closet-only / Style with my wardrobe: never surface invented missing pieces, and always
    // supplement with deterministic saved-wardrobe directions so the UI shows multiple usable cards.
    outfits = mergeOutfitDirections(outfits, localFallback, selectedPiece, { closetOnly: true, minCount: 4 })
    if (!outfits.length) outfits = localFallback
  }

  return {
    outfits,
    rejected: gated.rejected || [],
    skip: gated.skip || composerParsed.skip || '',
    saveableLearning: gated.saveableLearning || composerParsed.saveableLearning || '',
    rawComposer
  }
}

function wholeWardrobePieceBucket(allPieces = []) {
  const bucket = { top: [], bottom: [], dress: [], outerwear: [], shoes: [], accessory: [], other: [] }
  for (const piece of allPieces) {
    const group = wardrobeCategoryGroup(piece)
    if (bucket[group]) bucket[group].push(piece)
    else bucket.other.push(piece)
  }
  const piecePriority = (piece) => {
    const blob = pieceTextBlob(piece)
    let score = piece.favorite ? 12 : 0
    if (/\b(black|charcoal|espresso|chocolate|deep navy|navy|olive|plum|cognac|rust|mustard)\b/.test(blob)) score += 5
    if (/\b(artistic|graphic|architectural|structured|utility|linen|corduroy|textured|denim|cashmere|knit)\b/.test(blob)) score += 4
    if (/\b(pointed|loafer|boot|mule|oxford|structured)\b/.test(blob)) score += 3
    if (/\b(soft|gauzy|drape|oversized|beige|cream|ivory|taupe)\b/.test(blob)) score -= 1
    return score
  }
  for (const key of Object.keys(bucket)) {
    bucket[key].sort((a, b) => piecePriority(b) - piecePriority(a) || String(a.name).localeCompare(String(b.name)))
  }
  return bucket
}

function wholeWardrobePieceTrustDecision(piece = {}, { occasion = 'casual', explorationMode = 'moderate' } = {}) {
  const status = String(piece.recommendation_status || 'trusted')
  const fit = String(piece.fit_confidence || 'unknown')
  const role = String(piece.role_permission || 'auto')
  const notes = `${piece.engine_notes || ''} ${piece.notes || ''}`.toLowerCase()
  const permissions = Array.isArray(piece.occasion_permissions) ? piece.occasion_permissions : []
  const reasons = []
  const aggressive = explorationMode === 'aggressive'

  if (status === 'avoid' || status === 'do_not_recommend') reasons.push('recommendation status blocks auto-use')
  if (role === 'never_auto' || role === 'only_when_requested') reasons.push('role permission blocks automatic styling')
  if (status === 'needs_fit_review' && !aggressive) reasons.push('needs fit review')
  if (status === 'experimental' && !aggressive) reasons.push('experimental piece held for exploration mode')
  if (fit === 'low' && !aggressive) reasons.push('low fit confidence')
  if (permissions.length && occasion && !permissions.includes(occasion)) reasons.push(`not permitted for ${occasion}`)
  if (/\b(too small|too tight|does not fit|doesn't fit|bad fit|avoid auto|not evening|not for evening|testing only)\b/.test(notes) && !aggressive) {
    reasons.push('engine notes suppress auto-use')
  }

  return {
    allowed: reasons.length === 0,
    supportOnly: role === 'support_only',
    reasons
  }
}

function filterWholeWardrobePiecesForGeneration(allPieces = [], options = {}) {
  const allowedPieces = []
  const suppressedPieces = []
  for (const piece of allPieces) {
    const decision = wholeWardrobePieceTrustDecision(piece, options)
    if (decision.allowed) allowedPieces.push(piece)
    else suppressedPieces.push({ id: piece.id, name: piece.name, category: wardrobeCategoryGroup(piece), reasons: decision.reasons })
  }
  return { allowedPieces, suppressedPieces }
}

function scoreWholeWardrobeCandidate(pieces = [], options = {}) {
  const text = pieces.map(pieceTextBlob).join(' ')
  const names = pieces.map(p => p.name).join(' + ')
  const groups = pieces.map(wardrobeCategoryGroup)
  let score = 0
  const reasons = []
  const add = (n, reason) => { score += n; if (reason) reasons.push(reason) }

  if (groups.includes('top') && groups.includes('bottom')) add(14, 'complete separates')
  if (groups.includes('dress')) add(12, 'complete dress base')
  if (groups.includes('shoes')) add(10, 'grounded with shoes')
  if (pieces.some(p => p.favorite)) add(5, 'favorite piece')
  if (/\b(black|charcoal|espresso|chocolate|deep navy|navy|olive|plum|cognac|rust|mustard)\b/.test(text)) add(7, 'deep/warm palette')
  if (/\b(artistic|graphic|architectural|structured|utility|textured|corduroy|linen|denim)\b/.test(text)) add(8, 'artistic texture/structure')
  if (/\b(pointed|loafer|boot|mule|oxford|cognac|black)\b/.test(text) && groups.includes('shoes')) add(6, 'strong shoe grounding')
  if (/\b(contrast|column|dark|structured|utility|graphic)\b/.test(text)) add(5, 'clear visual thesis')

  const wideCount = (text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length
  const softCount = (text.match(/\b(soft|gauzy|drape|drapey|chiffon|loose knit|oversized|cream|ivory|beige|taupe|sand)\b/g) || []).length
  const lightNeutralCount = (text.match(/\b(cream|ivory|beige|taupe|sand|oatmeal|white)\b/g) || []).length
  if (wideCount >= 2) add(-20, 'wide + wide risk')
  if (softCount >= 3) add(-24, 'soft stack risk')
  if (lightNeutralCount >= 3 && !/\b(black|charcoal|espresso|plum|cognac|boot|loafer|pointed|graphic|structured)\b/.test(text)) add(-24, 'generic light-neutral softness')
  if (/\b(librarian|catalog|mature|ladylike|polished neutral|luxe neutral)\b/.test(text)) add(-28, 'catalog/librarian drift risk')
  if (groups.includes('shoes') && !/\b(pointed|loafer|boot|mule|oxford|black|cognac|structured|grounded)\b/.test(text)) add(-8, 'weak shoe grounding')
  for (const piece of pieces) {
    const decision = wholeWardrobePieceTrustDecision(piece, options)
    if (decision.supportOnly && ['top', 'bottom', 'dress'].includes(wardrobeCategoryGroup(piece))) add(-18, `${piece.name} support-only`)
  }
  const feedbackInfluence = wholeWardrobeFeedbackInfluenceForCandidate(pieces, options)
  if (feedbackInfluence) {
    add(feedbackInfluence.score, 'whole-wardrobe feedback memory')
    reasons.push(...feedbackInfluence.reasons)
  }

  const mood = String(options.mood || '').toLowerCase()
  if (mood && text.includes(mood)) add(2, 'mood match')

  return { score, reasons: reasons.slice(0, 6), names }
}

function candidateObjectFromPieces(pieces, index, options) {
  const scored = scoreWholeWardrobeCandidate(pieces, options)
  return {
    candidateId: `cand-${index + 1}`,
    label: pieces.map(p => p.name).join(' + '),
    pieceIds: pieces.map(p => Number(p.id)).filter(Boolean),
    pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
    localScore: scored.score,
    localReasons: scored.reasons,
  }
}

function wholeWardrobeCandidateAxes(candidate = {}) {
  const pieces = Array.isArray(candidate.pieces) ? candidate.pieces : []
  const outfit = { pieces }
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const text = pieces.map(pieceTextBlob).join(' ').toLowerCase()
  return {
    topId: top ? Number(top.id) : null,
    bottomId: bottom ? Number(bottom.id) : null,
    shoeId: shoe ? Number(shoe.id) : null,
    formula: wholeWardrobeFormulaFamily(outfit, pieces),
    silhouette: wholeWardrobeSilhouetteFromPieces(outfit),
    grounding: wholeWardrobeGroundingStrategy(outfit),
    shoeShape: wholeWardrobeShoeShape(outfit),
    rhythm: wholeWardrobeVisualRhythm(outfit),
    hasDress: pieces.some(p => wardrobeCategoryGroup(p) === 'dress'),
    hasNonGraphicTop: Boolean(top && !/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceTextBlob(top))),
    hasSoftTexture: /\b(crochet|gauze|gauzy|soft|cashmere|drape|drapey|silk|ruffle|fluid)\b/.test(text),
    hasTonalDark: /\b(black|charcoal|espresso|chocolate|deep navy|navy)\b/.test(text) && !/\b(floral|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)
  }
}

function selectDiverseWholeWardrobeCandidates(candidates = [], limit = 60, options = {}) {
  const selected = []
  const pool = [...candidates]
  const useCount = {
    top: new Map(),
    bottom: new Map(),
    shoe: new Map(),
    formula: new Map(),
    silhouette: new Map(),
    grounding: new Map(),
    shoeShape: new Map(),
    rhythm: new Map()
  }
  const count = (map, key) => key == null ? 0 : (map.get(key) || 0)
  const bump = (map, key) => {
    if (key != null) map.set(key, (map.get(key) || 0) + 1)
  }
  const selectedHas = predicate => selected.some(candidate => predicate(wholeWardrobeCandidateAxes(candidate)))

  while (pool.length && selected.length < limit) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i]
      const axes = wholeWardrobeCandidateAxes(candidate)
      let score = Number(candidate.score ?? candidate.localScore) || 0

      if (!count(useCount.formula, axes.formula)) score += 22
      if (!count(useCount.silhouette, axes.silhouette)) score += 16
      if (!count(useCount.grounding, axes.grounding)) score += 12
      if (!count(useCount.shoeShape, axes.shoeShape)) score += 10
      if (!count(useCount.rhythm, axes.rhythm)) score += 10
      if (axes.topId && !count(useCount.top, axes.topId)) score += 9
      if (axes.bottomId && !count(useCount.bottom, axes.bottomId)) score += 9
      if (axes.hasDress && !selectedHas(a => a.hasDress)) score += 24
      if (axes.hasNonGraphicTop && !selectedHas(a => a.hasNonGraphicTop)) score += 16
      if (axes.hasSoftTexture && !selectedHas(a => a.hasSoftTexture)) score += 12
      if (axes.hasTonalDark && !selectedHas(a => a.hasTonalDark)) score += 12

      score -= count(useCount.top, axes.topId) * 46
      score -= count(useCount.bottom, axes.bottomId) * 34
      score -= count(useCount.shoe, axes.shoeId) * 14
      score -= count(useCount.formula, axes.formula) * 44
      score -= count(useCount.silhouette, axes.silhouette) * 24
      score -= count(useCount.grounding, axes.grounding) * 14
      score -= count(useCount.shoeShape, axes.shoeShape) * 12
      score -= count(useCount.rhythm, axes.rhythm) * 12

      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    const [chosen] = pool.splice(bestIndex, 1)
    const axes = wholeWardrobeCandidateAxes(chosen)
    selected.push(chosen)
    bump(useCount.top, axes.topId)
    bump(useCount.bottom, axes.bottomId)
    bump(useCount.shoe, axes.shoeId)
    bump(useCount.formula, axes.formula)
    bump(useCount.silhouette, axes.silhouette)
    bump(useCount.grounding, axes.grounding)
    bump(useCount.shoeShape, axes.shoeShape)
    bump(useCount.rhythm, axes.rhythm)
  }

  return selected
}

function wholeWardrobeCandidateFormulaCounts(candidates = []) {
  return candidates.reduce((counts, candidate) => {
    const formula = wholeWardrobeCandidateAxes(candidate).formula || 'unknown'
    counts[formula] = (counts[formula] || 0) + 1
    return counts
  }, {})
}

function wholeWardrobeCandidateText(candidates = []) {
  return candidates.map((candidate, index) => [
    `${index + 1}. ${candidate.candidateId} | formula family ${wholeWardrobeCandidateAxes(candidate).formula}`,
    `Pieces: ${candidate.pieces.map(p => `${p.id}:${p.name} (${p.category})`).join(' + ')}`,
    candidate.localReasons?.length ? `Local reasons: ${candidate.localReasons.join('; ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
}

function buildWholeWardrobeCandidateOutfits(allPieces, options = {}) {
  const bucket = wholeWardrobePieceBucket(allPieces)
  const candidates = []
  const shoes = bucket.shoes.length ? bucket.shoes.slice(0, 14) : [null]
  const tops = bucket.top.slice(0, 34)
  const bottoms = bucket.bottom.slice(0, 28)
  const dresses = bucket.dress.slice(0, 18)
  const outerwear = bucket.outerwear.slice(0, 10)
  const accessories = bucket.accessory.slice(0, 8)

  const addCandidate = (pieces) => {
    const clean = pieces.filter(Boolean)
    const key = clean.map(p => p.id).sort((a,b) => a-b).join('|')
    if (!key || candidates.some(c => c.key === key)) return
    const scored = scoreWholeWardrobeCandidate(clean, options)
    if (scored.score < -18) return
    candidates.push({ key, pieces: clean, score: scored.score })
  }

  for (const top of tops) {
    for (const bottom of bottoms) {
      for (const shoe of shoes) addCandidate([top, bottom, shoe])
    }
  }
  for (const dress of dresses) {
    for (const shoe of shoes) addCandidate([dress, shoe])
  }

  const base = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
  for (const candidate of base.slice(0, 30)) {
    for (const layer of outerwear.slice(0, 4)) addCandidate([...candidate.pieces, layer])
    for (const accessory of accessories.slice(0, 3)) addCandidate([...candidate.pieces, accessory])
  }

  const ranked = candidates.sort((a, b) => b.score - a.score)
  const chosen = selectDiverseWholeWardrobeCandidates(ranked, 60, options)
  const exploratoryFamilies = new Set(['dress_grounding_shoe', 'soft_piece_structured_anchor', 'earthy_structured_separates'])
  const exploratory = ranked.find(candidate => exploratoryFamilies.has(inferOutfitArchetype({ pieces: candidate.pieces }, candidate.pieces, options.occasion).formulaFamily))
  if (exploratory && chosen.length && !chosen.some(candidate => candidate.key === exploratory.key)) chosen[chosen.length - 1] = exploratory
  return chosen
    .map((candidate, index) => candidateObjectFromPieces(candidate.pieces, index, options))
}

function normalizeWholeWardrobeOutfitObject(outfit, candidatePieces = []) {
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  const ids = []
  const addId = (value) => {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0 && candidateById.has(n) && !ids.includes(n)) ids.push(n)
  }
  if (Array.isArray(outfit?.pieceIds)) outfit.pieceIds.forEach(addId)
  if (Array.isArray(outfit?.pieces)) outfit.pieces.forEach(piece => addId(piece?.id))
  const ownedPieces = ids.map(id => candidateById.get(id)).filter(Boolean)
  const label = String(outfit?.label || outfit?.title || 'Whole wardrobe outfit').trim()
  const strength = String(outfit?.strength || '').toLowerCase().trim()
  return {
    label,
    strength: ['signature', 'strong', 'usable', 'experimental'].includes(strength) ? strength : 'strong',
    dominantDirection: outfit?.dominantDirection || outfit?.dominant_direction || outfit?.direction || '',
    silhouette: outfit?.silhouette || '',
    bestFor: outfit?.bestFor || outfit?.best_for || '',
    reason: outfit?.reason || outfit?.why || '',
    watchFor: outfit?.watchFor || outfit?.watch_for || 'none',
    pieceIds: ids.slice(0, 6),
    missingPieces: [],
    textOnly: true,
    wholeWardrobe: true,
    localScore: Number(outfit?.localScore) || 0,
    archetypeId: outfit?.archetypeId || null,
    formulaFamily: outfit?.formulaFamily || null,
    pieces: ownedPieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null }))
  }
}

function wholeWardrobeFormulaType(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const groups = pieces.map(p => wardrobeCategoryGroup(p))
  const text = pieces.map(p => `${p.name || ''} ${p.category || ''}`).join(' ').toLowerCase()
  if (groups.includes('dress')) return 'dress + grounding layer/shoe'
  if (/\b(tapestry|print pant|printed pant|pattern pant|floral pant|graphic pant)\b/.test(text)) return 'artistic pant + restrained top'
  if (groups.includes('top') && groups.includes('bottom') && /\b(black|charcoal|dark|navy|denim|jean|column|straight|trouser)\b/.test(text) && /\b(relaxed|oversized|loose|linen|knit|tunic|cardigan|jacket|overshirt)\b/.test(text)) return 'relaxed layer + narrow base'
  if (/\b(monochrome|black|charcoal|espresso|same tone|tonal dark)\b/.test(text) && !/\b(floral|print|graphic|stripe|pattern|abstract)\b/.test(text)) return 'structured monochrome'
  if (/\b(soft|gauzy|linen|cashmere|knit|drape|cream|ivory)\b/.test(text) && /\b(pointed|loafer|boot|mule|oxford|sharp)\b/.test(text)) return 'soft texture + sharp shoe'
  if (/\b(floral|print|graphic|stripe|pattern|abstract)\b/.test(text)) return 'artistic print + simple anchor'
  if (groups.includes('top') && groups.includes('bottom') && /\b(black|charcoal|dark|denim|straight|trouser|column)\b/.test(text)) return 'compact top + dark column'
  if (groups.includes('top') && groups.includes('bottom')) return 'compact top + structured bottom'
  return 'complete wardrobe formula'
}

function wholeWardrobeDirectionFromPieces(outfit = {}) {
  const family = wholeWardrobeFormulaType(outfit)
  if (family === 'dress + grounding layer/shoe') return 'quiet modern bohemian'
  if (family === 'artistic pant + restrained top') return 'grounded artistic contrast'
  if (family === 'relaxed layer + narrow base') return 'relaxed structured casual'
  if (family === 'structured monochrome') return 'restrained graphic minimalism'
  if (family === 'soft texture + sharp shoe') return 'soft texture with sharp grounding'
  if (family === 'compact top + dark column') return 'restrained graphic minimalism'
  return 'earthy structured casual'
}

function wholeWardrobeSilhouetteFromPieces(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const dress = wholeWardrobePieceByGroup(outfit, 'dress')
  const layer = wholeWardrobePieceByGroup(outfit, 'outerwear')
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (dress) return layer ? 'dress column with structured outer layer' : 'one-piece column with grounded shoe'
  const upper = top && /\b(sleeveless|fitted|tank|shell|compact|tee)\b/.test(pieceNameBlob(top)) ? 'compact upper'
    : top && /\b(relaxed|oversized|loose|tunic|linen|sweater|knit)\b/.test(pieceNameBlob(top)) ? 'relaxed upper'
    : top ? 'controlled upper'
    : 'upper line'
  const lower = bottom && /\b(bootcut|flare|wide|wide-leg|flowing|soft)\b/.test(pieceNameBlob(bottom)) ? 'soft lower movement'
    : bottom && /\b(denim|jean|black|charcoal|straight|trouser|column|dark)\b/.test(pieceNameBlob(bottom)) ? 'long dark line'
    : bottom ? 'structured lower line'
    : 'lower line'
  if (/\b(tapestry|print pant|printed pant|pattern pant)\b/.test(text)) return 'restrained upper over expressive print pant'
  return `${upper} over ${lower}`
}

function wholeWardrobeGroundingStrategy(outfit = {}) {
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const text = shoe ? pieceNameBlob(shoe) : ''
  if (!shoe) return 'no shoe'
  if (/\b(pointed|flat|mule)\b/.test(text)) return 'pointed-flat grounding'
  if (/\b(loafer|oxford)\b/.test(text)) return 'loafer grounding'
  if (/\b(boot|bootie)\b/.test(text)) return 'boot grounding'
  if (/\b(sneaker)\b/.test(text)) return 'sneaker grounding'
  return 'simple shoe grounding'
}

function wholeWardrobeShoeShape(outfit = {}) {
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const text = shoe ? pieceNameBlob(shoe) : ''
  if (/\b(pointed)\b/.test(text)) return 'pointed'
  if (/\b(round|rounded)\b/.test(text)) return 'rounded'
  if (/\b(boot|bootie)\b/.test(text)) return 'boot'
  if (/\b(loafer|oxford)\b/.test(text)) return 'loafer'
  if (/\b(sneaker)\b/.test(text)) return 'sneaker'
  if (/\b(mule|flat)\b/.test(text)) return 'flat'
  return text || 'unknown'
}

function wholeWardrobeVisualRhythm(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (/\b(floral|print|graphic|stripe|pattern|abstract|tapestry)\b/.test(text) && /\b(black|charcoal|dark|denim|straight|plain|solid)\b/.test(text)) return 'expressive plus quiet anchor'
  if (/\b(black|charcoal|dark|navy|espresso|monochrome)\b/.test(text)) return 'dark continuous rhythm'
  if (/\b(soft|gauzy|linen|cashmere|knit|cream|ivory)\b/.test(text) && /\b(pointed|boot|loafer|structured)\b/.test(text)) return 'soft texture sharp finish'
  if (/\b(utility|structured|blazer|jacket|trouser)\b/.test(text)) return 'structured utilitarian rhythm'
  return 'simple separated rhythm'
}

function wholeWardrobeHeroPieceId(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const expressive = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract|bold|textured|lace|ruffle|architectural)\b/.test(`${p.name || ''} ${p.category || ''}`.toLowerCase()))
  const topOrDress = pieces.find(p => ['top', 'dress'].includes(wardrobeCategoryGroup(p)))
  return Number((expressive || topOrDress || pieces[0])?.id) || null
}

function pieceNameBlob(piece = {}) {
  return `${piece.name || ''} ${piece.category || ''}`.toLowerCase()
}

function wholeWardrobeFullPieces(outfit = {}, candidatePieces = []) {
  const byId = new Map(candidatePieces.map(p => [Number(p.id), p]))
  const ids = Array.isArray(outfit.pieceIds) ? outfit.pieceIds.map(Number).filter(Boolean) : []
  const fromIds = ids.map(id => byId.get(id)).filter(Boolean)
  if (fromIds.length) return fromIds
  return Array.isArray(outfit.pieces) ? outfit.pieces : []
}

function wholeWardrobePieceByGroup(outfit = {}, group) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : []).find(p => wardrobeCategoryGroup(p) === group) || null
}

function pieceStyleProfile(piece = {}) {
  if (piece?.style_profile_json && typeof piece.style_profile_json === 'object') return piece.style_profile_json
  return safeJsonParse(piece?.style_profile_json, {}) || {}
}

function inferWholeWardrobePieceRoles(piece = {}) {
  const profile = pieceStyleProfile(piece)
  const profileRoles = Array.isArray(profile.roles) ? profile.roles : []
  const group = wardrobeCategoryGroup(piece)
  const text = [
    pieceNameBlob(piece),
    piece.background_color,
    piece.reads_as,
    piece.pattern_type,
    piece.pattern_complexity,
    piece.silhouette,
    piece.fabric_category,
    piece.fabric_weight,
    piece.fit_on_body,
    piece.notes,
    ...(piece.colors || []),
    ...(piece.styling_rules_learned || [])
  ].filter(Boolean).join(' ').toLowerCase()
  const roles = new Set(profileRoles)
  if (group === 'dress') roles.add('one_piece_column')
  if (group === 'top' && /\b(fitted|sleeveless|tank|shell|compact|structured)\b/.test(text)) roles.add('upper_anchor')
  if (group === 'top' && /\b(relaxed|oversized|loose|tunic|boxy|linen|knit)\b/.test(text)) roles.add('relaxed_upper')
  if (group === 'bottom' && /\b(black|charcoal|dark|navy|denim|jean|straight|bootcut|trouser|column)\b/.test(text)) roles.add('lower_column')
  if (group === 'shoes') roles.add('grounding_piece')
  if (group === 'shoes' && /\b(pointed|patent|loafer|boot|mule|oxford)\b/.test(text)) roles.add('sharp_finish')
  if (['outerwear', 'bottom', 'top'].includes(group) && /\b(structured|blazer|jacket|utility|trouser|denim|crisp|architectural)\b/.test(text)) roles.add('structure_support')
  if (/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry|bold)\b/.test(text)) roles.add('graphic_element')
  if (/\b(soft|gauzy|drape|drapey|linen|cashmere|knit|chiffon|lace|cream|ivory|oatmeal)\b/.test(text)) roles.add('soft_texture')
  if (/\b(beige|taupe|sand|cream|ivory|soft neutral|oatmeal)\b/.test(text)) roles.add('beige_sludge')
  if (group === 'shoes' && /\b(slipper|soft flat|slip-on|beach|sandal)\b/.test(text)) roles.add('soft_shoe')
  if (group === 'bottom' && /\b(wide|wide-leg|soft|gauzy|flowing|palazzo)\b/.test(text)) roles.add('wide_soft_bottom')
  return [...roles]
}

function inferWholeWardrobeOutfitRoles(pieces = []) {
  const roles = new Set()
  for (const piece of pieces) inferWholeWardrobePieceRoles(piece).forEach(role => roles.add(role))
  const softCount = pieces.filter(p => inferWholeWardrobePieceRoles(p).includes('soft_texture')).length
  const patternCount = pieces.filter(p => inferWholeWardrobePieceRoles(p).includes('graphic_element')).length
  if (softCount >= 2) roles.add('soft_texture_stack')
  if (patternCount >= 2) roles.add('extra_pattern')
  return [...roles]
}

function occasionBiasForArchetype(archetype, occasion) {
  const key = String(occasion || '').toLowerCase()
  return Number(archetype.occasionBias?.[key] || archetype.occasionBias?.[occasion] || 0)
}

function occasionScoreForOutfit(pieces = [], occasion = '') {
  const key = String(occasion || '').toLowerCase()
  const text = pieces.map(pieceTextBlob).join(' ')
  let score = 0
  if (key === 'evening') {
    if (/\b(black|charcoal|dark|espresso|navy|plum|patent)\b/.test(text)) score += 10
    if (/\b(pointed|patent|loafer|boot|mule|dress)\b/.test(text)) score += 8
    if (/\b(sneaker|slipper|beach|flip|soft sandal|light casual)\b/.test(text)) score -= 14
    if (/\b(gauzy|beachy|linen short|soft slip-on)\b/.test(text)) score -= 8
  }
  if (key === 'gallery / art event') {
    if (/\b(print|graphic|stripe|abstract|tapestry|architectural|structured|utility|earthy|olive|cognac)\b/.test(text)) score += 10
    const expressiveCount = (text.match(/\b(print|graphic|stripe|abstract|tapestry|floral|pattern)\b/g) || []).length
    if (expressiveCount > 1 && !/\b(black|charcoal|solid|plain|denim|structured|pointed|loafer|boot)\b/.test(text)) score -= 12
  }
  return score
}

function inferOutfitArchetype(outfit, candidatePieces = [], occasion = 'casual') {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const roles = inferWholeWardrobeOutfitRoles(pieces)
  const roleSet = new Set(roles)
  const hasRole = (role) => roleSet.has(role)
  let best = null
  for (const archetype of WHOLE_WARDROBE_OUTFIT_ARCHETYPES) {
    let score = occasionBiasForArchetype(archetype, occasion) + occasionScoreForOutfit(pieces, occasion)
    for (const role of archetype.preferredRoles || []) if (hasRole(role)) score += 8
    for (const role of archetype.avoidRoles || []) if (hasRole(role)) score -= 12
    if (archetype.id === 'grounded_graphic_column' && hasRole('graphic_element') && hasRole('lower_column') && hasRole('grounding_piece')) score += 12
    if (archetype.id === 'dress_grounded_sharp' && hasRole('one_piece_column')) score += 18
    if (archetype.id === 'relaxed_dark_base' && hasRole('relaxed_upper') && hasRole('lower_column')) score += 14
    if (archetype.id === 'soft_structure_contrast' && hasRole('soft_texture') && hasRole('structure_support')) score += 12
    if (archetype.id === 'earthy_structured_minimal' && hasRole('structure_support') && !hasRole('extra_pattern')) score += 8
    if (!best || score > best.archetypeScore) best = { ...archetype, archetypeScore: score }
  }
  const fallback = best || WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0]
  return {
    archetypeId: fallback.id,
    formulaFamily: fallback.formulaFamily,
    direction: fallback.direction,
    silhouette: fallback.silhouette,
    labelSuggestion: fallback.label,
    archetypeScore: fallback.archetypeScore || 0,
    visualGoal: fallback.visualGoal,
    roles
  }
}

function wholeWardrobeArchetypeFor(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const inferred = inferOutfitArchetype(outfit, candidatePieces, occasion)
  return WHOLE_WARDROBE_OUTFIT_ARCHETYPES.find(a => a.id === inferred.archetypeId)
    ? inferred
    : { ...WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0], archetypeId: WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0].id, labelSuggestion: WHOLE_WARDROBE_OUTFIT_ARCHETYPES[0].label, archetypeScore: 0, roles: [] }
}

function wholeWardrobeFormulaFamily(outfit = {}, candidatePieces = [], occasion = 'casual') {
  return outfit.formulaFamily || wholeWardrobeArchetypeFor(outfit, candidatePieces, occasion).formulaFamily || wholeWardrobeFormulaType(outfit)
}


function wholeWardrobeHasDress(outfit = {}) {
  return (Array.isArray(outfit.pieces) ? outfit.pieces : []).some(p => wardrobeCategoryGroup(p) === 'dress')
}

function wholeWardrobeTopBottomKey(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  if (!top || !bottom) return null
  return `${Number(top.id)}:${Number(bottom.id)}`
}

function wholeWardrobeHasPrintOrStripe(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  return /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)
}

function wholeWardrobeHasGraphicTop(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  return top ? /\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceNameBlob(top)) : false
}

function wholeWardrobeHasNonGraphicTop(outfit = {}) {
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  return Boolean(top && !wholeWardrobeHasGraphicTop(outfit))
}

function wholeWardrobeIsExploratory(outfit = {}) {
  const text = (Array.isArray(outfit.pieces) ? outfit.pieces : []).map(pieceNameBlob).join(' ')
  if (wholeWardrobeHasDress(outfit)) return true
  if (/\b(soft|gauzy|linen|cashmere|knit|drape|cream|ivory|oatmeal)\b/.test(text) && /\b(pointed|loafer|boot|mule|oxford|black|cognac)\b/.test(text)) return true
  if (wholeWardrobeHasNonGraphicTop(outfit) && /\b(neutral|black|white|cream|ivory|navy|charcoal|taupe|beige|oatmeal|solid)\b/.test(text)) return true
  if (/\b(black|charcoal|dark|espresso|navy)\b/.test(text) && !/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(text)) return true
  return false
}

function wholeWardrobeLabelFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(p => `${p.name || ''} ${p.category || ''}`).join(' ').toLowerCase()
  const has = (pattern) => pattern.test(text)
  const mood = has(/\b(floral|print|graphic|stripe|abstract|pattern)\b/) ? 'Graphic'
    : has(/\b(olive|cognac|rust|mustard|linen|utility|earth)\b/) ? 'Earthy'
    : has(/\b(black|charcoal|navy|dark|denim|espresso)\b/) ? 'Dark'
    : has(/\b(lace|ruffle|textured|architectural|structured)\b/) ? 'Textured'
    : 'Wardrobe'
  const anchor = has(/\b(denim|jean)\b/) ? 'Denim'
    : has(/\b(column|black|charcoal|dark|straight|trouser|pant)\b/) ? 'Column'
    : has(/\b(dress)\b/) ? 'Dress'
    : has(/\b(utility|structured|blazer|jacket)\b/) ? 'Structured'
    : 'Complete'
  const setting = has(/\b(gallery|art|graphic|architectural)\b/) ? 'Gallery'
    : has(/\b(casual|denim|loafer|sneaker)\b/) ? 'Casual'
    : has(/\b(minimal|black|charcoal|column)\b/) ? 'Minimal'
    : 'Wardrobe'
  return `${mood} ${anchor} ${setting}`.replace(/\b(\w+)\s+\1\b/g, '$1').trim()
}

function wholeWardrobeReasonFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const byGroup = (group) => pieces.find(p => wardrobeCategoryGroup(p) === group)
  const top = byGroup('top')
  const bottom = byGroup('bottom')
  const dress = byGroup('dress')
  const shoe = byGroup('shoes')
  const layer = byGroup('outerwear')
  const printPiece = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract)\b/.test(`${p.name || ''} ${p.category || ''}`.toLowerCase()))
  const shoeText = shoe ? pieceNameBlob(shoe) : ''
  const base = dress
    ? `${dress.name} carries the main line`
    : bottom
      ? `${bottom.name} creates the lower column`
      : top
        ? `${top.name} sets the top line`
        : `${pieces[0]?.name || 'The base pieces'} carry the outfit`
  const support = dress && layer
    ? `${layer.name} adds structure over the dress`
    : top && bottom
      ? `${top.name} sets the upper proportion against that base`
      : layer
        ? `${layer.name} adds the outer structure`
        : ''
  const grounding = shoe
    ? /\b(pointed|flat|loafer|mule|oxford)\b/.test(shoeText)
      ? `${shoe.name} keeps the line sharp at the floor`
      : /\b(boot|bootie|clog)\b/.test(shoeText)
        ? `${shoe.name} anchors the lower half with enough weight`
        : `${shoe.name} grounds the outfit`
    : 'the shoe choice needs to stay grounded'
  const print = printPiece ? `The pattern stays controlled because the rest of the outfit is quieter around ${printPiece.name}.` : ''
  return [base, support, grounding, print].filter(Boolean).join('. ')
}

function wholeWardrobeWatchFromPieces(outfit = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const text = pieces.map(p => `${p.name || ''} ${p.category || ''}`).join(' ').toLowerCase()
  if (/\b(tapestry|print pant|printed pant|pattern pant)\b/.test(text)) return 'Keep jewelry quiet if print pants are used; do not add another patterned layer.'
  if (/\b(floral|print|graphic|stripe|pattern|abstract)\b/.test(text)) return 'Avoid another patterned layer; the shoe must stay quiet enough to anchor the print.'
  if (/\b(gallery|art event)\b/.test(text)) return 'Shoe must have enough polish for a gallery setting.'
  if (/\b(bootcut|wide|wide-leg|flare)\b/.test(text)) return 'The hem needs enough shoe weight so the lower line does not collapse.'
  if (/\b(boot|bootie)\b/.test(text)) return 'Boot shaft and hem must not chop the line.'
  if (/\b(tuck|waistband|high waist|elastic waist)\b/.test(text)) return 'Top must not bunch at the waistband.'
  if (/\b(oversized|loose|tunic|boxy)\b/.test(text)) return 'Top length should stop cleanly above the widest hip area or commit to a full column.'
  if (/\b(cream|ivory|beige|taupe|soft|gauzy)\b/.test(text)) return 'Keep one dark or structured anchor so the outfit does not drift into soft neutral mush.'
  return 'Do not add extra texture; let the listed pieces carry the formula.'
}

function wholeWardrobeGarmentModifier(pieces = []) {
  const dress = pieces.find(p => wardrobeCategoryGroup(p) === 'dress')
  const printPiece = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
  const darkBase = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom' && /\b(black|charcoal|dark|navy|denim|jean|straight|trouser|column)\b/.test(pieceNameBlob(p)))
  const softPiece = pieces.find(p => /\b(soft|gauzy|drape|linen|cashmere|knit|cream|ivory|oatmeal)\b/.test(pieceNameBlob(p)))
  const anchor = dress || printPiece || darkBase || softPiece || pieces.find(p => ['top', 'bottom'].includes(wardrobeCategoryGroup(p))) || pieces[0]
  const raw = String(anchor?.name || '').replace(/\b(top|shirt|pants|pant|skirt|dress|shoe|shoes|flat|boot|loafer)\b/gi, '').trim()
  return raw.split(/\s+/).slice(0, 3).join(' ')
}

function buildOutfitMechanicsReason(outfit = {}, pieces = [], archetype = {}) {
  const byGroup = (group) => pieces.find(p => wardrobeCategoryGroup(p) === group)
  const top = byGroup('top')
  const bottom = byGroup('bottom')
  const dress = byGroup('dress')
  const shoe = byGroup('shoes')
  const layer = byGroup('outerwear')
  const printPiece = pieces.find(p => /\b(floral|print|graphic|stripe|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
  const softPiece = pieces.find(p => /\b(soft|gauzy|drape|linen|cashmere|knit|cream|ivory|oatmeal)\b/.test(pieceNameBlob(p)))
  const shoeText = shoe ? pieceNameBlob(shoe) : ''
  const sentences = []

  if (dress) {
    const support = layer ? `${layer.name} adds the structure around it` : shoe ? `${shoe.name} gives the one-piece line a grounded finish` : 'the supporting pieces need to stay clean'
    sentences.push(`${dress.name} carries the column, and ${support}.`)
  } else if (bottom) {
    const columnVerb = /\b(black|charcoal|dark|navy|denim|straight|trouser|column)\b/.test(pieceNameBlob(bottom)) ? 'creates the long base' : 'sets the lower proportion'
    const upperJob = top ? `${top.name} ${/\b(fitted|sleeveless|tank|shell|compact)\b/.test(pieceNameBlob(top)) ? 'keeps the upper half compact' : 'sets the upper shape'}` : 'the upper piece needs to stay controlled'
    sentences.push(`${bottom.name} ${columnVerb}, while ${upperJob}.`)
  } else if (top) {
    sentences.push(`${top.name} sets the upper anchor, so the remaining pieces need to keep the line grounded.`)
  }

  if (printPiece && printPiece !== top && printPiece !== bottom && printPiece !== dress) {
    sentences.push(`${printPiece.name} supplies the visual tension; the quiet support pieces keep it from turning into pattern stacking.`)
  } else if (printPiece) {
    sentences.push(`${printPiece.name} supplies the visual tension, so the surrounding pieces need to stay quieter.`)
  } else if (softPiece) {
    sentences.push(`${softPiece.name} brings the softness; the structured or dark pieces keep the formula from drifting loose.`)
  }

  if (shoe) {
    if (/\b(pointed|patent|mule|flat)\b/.test(shoeText)) sentences.push(`${shoe.name} keeps the finish sharp at the floor.`)
    else if (/\b(boot|bootie)\b/.test(shoeText)) sentences.push(`${shoe.name} gives the hem enough weight.`)
    else if (/\b(loafer|oxford)\b/.test(shoeText)) sentences.push(`${shoe.name} adds the tailored grounding.`)
    else sentences.push(`${shoe.name} grounds the outfit; keep it intentional rather than casual.`)
  } else if (archetype?.formulaFamily !== 'dress_grounding_shoe') {
    sentences.push('The shoe choice needs to add a clear anchor before this leaves the house.')
  }

  return sentences
    .join(' ')
    .replace(/\b(harmonious|flattering|sophisticated|balance|modernity|overall look|playful touch)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function rewriteWholeWardrobeOutfitWithArchetype(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const pieces = wholeWardrobeFullPieces(outfit, candidatePieces)
  const archetype = wholeWardrobeArchetypeFor({ ...outfit, pieces }, candidatePieces, occasion)
  const modifier = wholeWardrobeGarmentModifier(pieces)
  const label = modifier
    ? `${archetype.labelSuggestion}: ${modifier}`
    : archetype.labelSuggestion
  const silhouetteVariant = wholeWardrobeSilhouetteFromPieces({ ...outfit, pieces })
  const silhouette = silhouetteVariant && silhouetteVariant !== archetype.direction
    ? silhouetteVariant
    : archetype.silhouette
  return {
    ...outfit,
    archetypeId: archetype.archetypeId,
    formulaFamily: archetype.formulaFamily,
    label,
    dominantDirection: archetype.direction,
    silhouette,
    reason: buildOutfitMechanicsReason(outfit, pieces, archetype),
    watchFor: wholeWardrobeWatchFromPieces({ ...outfit, pieces })
  }
}

function hasWholeWardrobePlaceholder(outfit = {}) {
  const text = [outfit.label, outfit.dominantDirection, outfit.silhouette, outfit.bestFor, outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(short style lane|one clear silhouette idea|short use case|whole wardrobe outfit|strong wardrobe outfit|complete wardrobe formula|locally ranked wardrobe composition)\b/.test(text)
}

function hasGenericWholeWardrobeText(outfit = {}) {
  const text = [outfit.reason, outfit.watchFor].join(' ').toLowerCase()
  return /\b(balances artfulness with modernity|playful touch|overall look|creates an artistic visual|refined silhouette|visual balance|contrasts well|modern artistic element|clean silhouette|may overwhelm the look|potential boxiness|ensure the playful elements do not overwhelm)\b/.test(text)
}

function repairWholeWardrobeOutfit(outfit = {}, candidatePieces = [], occasion = 'casual') {
  const repaired = rewriteWholeWardrobeOutfitWithArchetype({ ...outfit }, candidatePieces, occasion)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.label || '').trim()) repaired.label = wholeWardrobeLabelFromPieces(repaired)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.dominantDirection || '').trim() || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.dominantDirection = wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion).direction
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.silhouette || '').trim() || String(repaired.dominantDirection || '').trim() === String(repaired.silhouette || '').trim()) repaired.silhouette = wholeWardrobeSilhouetteFromPieces(repaired)
  if (hasWholeWardrobePlaceholder(repaired) || !String(repaired.bestFor || '').trim()) repaired.bestFor = 'right-now wardrobe dressing'
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.reason || '').trim()) repaired.reason = buildOutfitMechanicsReason(repaired, wholeWardrobeFullPieces(repaired, candidatePieces), wholeWardrobeArchetypeFor(repaired, candidatePieces, occasion))
  if (hasWholeWardrobePlaceholder(repaired) || hasGenericWholeWardrobeText(repaired) || !String(repaired.watchFor || '').trim() || /^none$/i.test(String(repaired.watchFor || '').trim())) repaired.watchFor = wholeWardrobeWatchFromPieces(repaired)
  return repaired
}

function wholeWardrobeSelectionScore(outfit, selected, options = {}) {
  const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
  const top = wholeWardrobePieceByGroup(outfit, 'top')
  const bottom = wholeWardrobePieceByGroup(outfit, 'bottom')
  const shoe = wholeWardrobePieceByGroup(outfit, 'shoes')
  const formula = wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
  const grounding = wholeWardrobeGroundingStrategy(outfit)
  const shoeShape = wholeWardrobeShoeShape(outfit)
  const rhythm = wholeWardrobeVisualRhythm(outfit)
  let score = outfitStylisticStrengthScore(outfit, null) + (Number(outfit.localScore) || 0) * 0.25 + (Number(outfit.archetypeScore) || 0)
  const countPiece = (groupPiece) => groupPiece
    ? selected.filter(existing => (existing.pieces || []).some(p => Number(p.id) === Number(groupPiece.id))).length
    : 0
  const sameTopCount = countPiece(top)
  const sameBottomCount = countPiece(bottom)
  const sameShoeCount = countPiece(shoe)
  const sameFormulaCount = selected.filter(existing => wholeWardrobeFormulaFamily(existing, options.candidatePieces, options.occasion) === formula).length
  const sameSilhouetteCount = selected.filter(existing => wholeWardrobeSilhouetteFromPieces(existing) === silhouetteFamily).length
  const sameGroundingCount = selected.filter(existing => wholeWardrobeGroundingStrategy(existing) === grounding).length
  const sameShoeShapeCount = selected.filter(existing => wholeWardrobeShoeShape(existing) === shoeShape).length
  const sameRhythmCount = selected.filter(existing => wholeWardrobeVisualRhythm(existing) === rhythm).length
  const printFormulaCount = wholeWardrobeHasPrintOrStripe(outfit)
    ? selected.filter(existing => wholeWardrobeHasPrintOrStripe(existing)).length
    : 0

  if (sameTopCount >= 1) score -= 40 * sameTopCount
  if (sameBottomCount >= 1) score -= 20 * sameBottomCount
  if (sameShoeCount >= 1) score -= 20 * sameShoeCount
  if (sameSilhouetteCount >= 1) score -= 35 * sameSilhouetteCount
  if (sameGroundingCount >= 1) score -= 18 * sameGroundingCount
  if (sameShoeShapeCount >= 1) score -= 14 * sameShoeShapeCount
  if (sameRhythmCount >= 1) score -= 16 * sameRhythmCount
  if (printFormulaCount >= 1) score -= 20 * printFormulaCount
  if (sameFormulaCount >= 1) score -= 45 * sameFormulaCount
  if (formula === 'compact_top_dark_column' && sameFormulaCount >= 1) score -= 25
  return score
}

function bestWholeWardrobeRequirementCandidate(pool, selected, predicate, options = {}) {
  const selectedKeys = new Set(selected.map(o => (o.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
  return pool
    .filter(outfit => predicate(outfit))
    .filter(outfit => !selectedKeys.has((outfit.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')))
    .sort((a, b) => wholeWardrobeSelectionScore(b, selected, options) - wholeWardrobeSelectionScore(a, selected, options))[0] || null
}

function applyWholeWardrobeDiversity(outfits = [], limit = 5, options = {}) {
  const selected = []
  const rejected = []
  const topUse = new Map()
  const bottomUse = new Map()
  const shoeUse = new Map()
  const heroUse = new Map()
  const formulaUse = new Map()
  const silhouetteUse = new Map()
  const groundingUse = new Map()
  const shoeShapeUse = new Map()
  const rhythmUse = new Map()
  const topBottomUse = new Set()
  const pool = [...outfits]
  const formulaFor = (outfit) => wholeWardrobeFormulaFamily(outfit, options.candidatePieces, options.occasion)
  const hasUnusedAlternativeFormula = (formula) => pool.some(candidate => {
    const key = (candidate.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === key)) return false
    return formulaFor(candidate) !== formula
  })
  const exploratoryFamilies = new Set(['dress_grounding_shoe', 'soft_piece_structured_anchor', 'earthy_structured_separates'])
  const exploratory = bestWholeWardrobeRequirementCandidate(
    pool,
    selected,
    outfit => exploratoryFamilies.has(formulaFor(outfit)) || wholeWardrobeIsExploratory(outfit),
    options
  )
  if (exploratory) {
    selected.push(exploratory)
    const pieces = Array.isArray(exploratory.pieces) ? exploratory.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(exploratory)
    const formula = formulaFor(exploratory)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(exploratory)
    const grounding = wholeWardrobeGroundingStrategy(exploratory)
    const shoeShape = wholeWardrobeShoeShape(exploratory)
    const rhythm = wholeWardrobeVisualRhythm(exploratory)
    const topBottomKey = wholeWardrobeTopBottomKey(exploratory)
    if (top) topUse.set(Number(top.id), 1)
    if (bottom) bottomUse.set(Number(bottom.id), 1)
    if (shoe) shoeUse.set(Number(shoe.id), 1)
    if (heroId) heroUse.set(heroId, 1)
    formulaUse.set(formula, 1)
    silhouetteUse.set(silhouetteFamily, 1)
    groundingUse.set(grounding, 1)
    shoeShapeUse.set(shoeShape, 1)
    rhythmUse.set(rhythm, 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }
  while (pool.length && selected.length < limit) {
    pool.sort((a, b) => wholeWardrobeSelectionScore(b, selected, options) - wholeWardrobeSelectionScore(a, selected, options))
    const outfit = pool.shift()
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
    const top = pieces.find(p => wardrobeCategoryGroup(p) === 'top')
    const bottom = pieces.find(p => wardrobeCategoryGroup(p) === 'bottom')
    const shoe = pieces.find(p => wardrobeCategoryGroup(p) === 'shoes')
    const heroId = wholeWardrobeHeroPieceId(outfit)
    const formula = formulaFor(outfit)
    const silhouetteFamily = wholeWardrobeSilhouetteFromPieces(outfit)
    const grounding = wholeWardrobeGroundingStrategy(outfit)
    const shoeShape = wholeWardrobeShoeShape(outfit)
    const rhythm = wholeWardrobeVisualRhythm(outfit)
    const topBottomKey = wholeWardrobeTopBottomKey(outfit)
    const outfitKey = (outfit.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')
    if (selected.some(existing => (existing.pieceIds || []).map(Number).filter(Boolean).sort((a,b) => a-b).join('|') === outfitKey)) continue
    const topCount = top ? (topUse.get(Number(top.id)) || 0) : 0
    const bottomCount = bottom ? (bottomUse.get(Number(bottom.id)) || 0) : 0
    const shoeCount = shoe ? (shoeUse.get(Number(shoe.id)) || 0) : 0
    const heroCount = heroId ? (heroUse.get(heroId) || 0) : 0
    const formulaCount = formulaUse.get(formula) || 0
    const silhouetteCount = silhouetteUse.get(silhouetteFamily) || 0
    const groundingCount = groundingUse.get(grounding) || 0
    const shoeShapeCount = shoeShapeUse.get(shoeShape) || 0
    const rhythmCount = rhythmUse.get(rhythm) || 0
    if (top && topCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${top.name}` })
      continue
    }
    if (bottom && bottomCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many outfits use ${bottom.name}` })
      continue
    }
    if (topBottomKey && topBottomUse.has(topBottomKey)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'exact top+bottom formula already used' })
      continue
    }
    if (heroId && heroCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'hero garment used more than twice' })
      continue
    }
    if (formula === 'compact_top_dark_column' && formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: 'compact-top dark-column slot already used' })
      continue
    }
    if (formulaCount >= 1 && hasUnusedAlternativeFormula(formula)) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${formula} formula` })
      continue
    }
    if (silhouetteCount >= 1 && selected.length >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${silhouetteFamily} silhouette` })
      continue
    }
    if (groundingCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too much ${grounding}` })
      continue
    }
    if (shoeShapeCount >= 2) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `too many ${shoeShape} shoes` })
      continue
    }
    if (rhythmCount >= 1 && selected.length >= 3) {
      rejected.push({ label: outfit.label || 'unnamed', reason: `duplicate ${rhythm}` })
      continue
    }
    selected.push(outfit)
    if (top) topUse.set(Number(top.id), topCount + 1)
    if (bottom) bottomUse.set(Number(bottom.id), bottomCount + 1)
    if (shoe) shoeUse.set(Number(shoe.id), shoeCount + 1)
    if (heroId) heroUse.set(heroId, heroCount + 1)
    formulaUse.set(formula, formulaCount + 1)
    silhouetteUse.set(silhouetteFamily, silhouetteCount + 1)
    groundingUse.set(grounding, groundingCount + 1)
    shoeShapeUse.set(shoeShape, shoeShapeCount + 1)
    rhythmUse.set(rhythm, rhythmCount + 1)
    if (topBottomKey) topBottomUse.add(topBottomKey)
  }

  if (options.requireDress && !selected.some(wholeWardrobeHasDress)) {
    const dressCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasDress, options)
    if (dressCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a dress formula' })
      selected[replaceIndex] = dressCandidate
    }
  }

  if (options.requireNonGraphicTop && !selected.some(wholeWardrobeHasNonGraphicTop)) {
    const plainTopCandidate = bestWholeWardrobeRequirementCandidate(outfits, selected, wholeWardrobeHasNonGraphicTop, options)
    if (plainTopCandidate) {
      const replaceIndex = selected.length >= limit ? selected.length - 1 : selected.length
      if (selected[replaceIndex]) rejected.push({ label: selected[replaceIndex].label || 'unnamed', reason: 'replaced to include a non-graphic top formula' })
      selected[replaceIndex] = plainTopCandidate
    }
  }

  while (new Set(selected.map(formulaFor)).size < Math.min(3, limit) && selected.length) {
    const usedFamilies = new Set(selected.map(formulaFor))
    const candidate = bestWholeWardrobeRequirementCandidate(
      outfits,
      selected,
      outfit => !usedFamilies.has(formulaFor(outfit)),
      options
    )
    if (!candidate) break
    const replaceIndex = selected
      .map((outfit, index) => ({ outfit, index, count: selected.filter(o => formulaFor(o) === formulaFor(outfit)).length }))
      .filter(item => item.count > 1 || formulaFor(item.outfit) === 'compact_top_dark_column')
      .sort((a, b) => wholeWardrobeSelectionScore(a.outfit, selected.filter((_, i) => i !== a.index), options) - wholeWardrobeSelectionScore(b.outfit, selected.filter((_, i) => i !== b.index), options))[0]?.index
    const targetIndex = Number.isInteger(replaceIndex) ? replaceIndex : selected.length - 1
    rejected.push({ label: selected[targetIndex]?.label || 'unnamed', reason: `replaced to include ${formulaFor(candidate)} formula` })
    selected[targetIndex] = candidate
  }

  return { outfits: selected, rejected }
}

function normalizeWholeWardrobeStrengths(outfits = []) {
  return outfits.map((outfit, index) => ({
    ...outfit,
    strength: index === 0 ? 'signature' : (index <= 2 ? 'strong' : 'usable')
  }))
}

function wholeWardrobeOutfitsFromCandidates(candidates = [], candidatePieces = [], options = {}) {
  return candidates.map(candidate => repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject({
    label: wholeWardrobeLabelFromPieces({ pieces: candidate.pieces }),
    strength: 'usable',
    dominantDirection: wholeWardrobeDirectionFromPieces({ pieces: candidate.pieces }),
    silhouette: wholeWardrobeSilhouetteFromPieces({ pieces: candidate.pieces }),
    bestFor: options.occasion || 'casual',
    pieceIds: candidate.pieceIds,
    pieces: candidate.pieces,
    reason: wholeWardrobeReasonFromPieces({ pieces: candidate.pieces }),
    watchFor: wholeWardrobeWatchFromPieces({ pieces: candidate.pieces }),
    localScore: candidate.localScore,
  }, candidatePieces), candidatePieces, options.occasion))
}

function locallyGateWholeWardrobeOutfits(outfits = [], limit = 5, { requireShoes = true, requireDress = false, requireNonGraphicTop = false, candidatePieces = [], occasion = 'casual' } = {}) {
  const seen = new Set()
  const accepted = []
  const rejected = []
  for (const outfit of outfits) {
    const repaired = repairWholeWardrobeOutfit(outfit, candidatePieces, occasion)
    const pieces = Array.isArray(repaired?.pieces) ? repaired.pieces : []
    const groups = pieces.map(p => wardrobeCategoryGroup(p))
    const hasSeparates = groups.includes('top') && groups.includes('bottom')
    const hasDress = groups.includes('dress')
    const hasShoes = groups.includes('shoes')
    const text = [repaired.label, repaired.dominantDirection, repaired.silhouette, repaired.reason, repaired.watchFor, ...pieces.map(p => p.name)].join(' ').toLowerCase()
    const key = (repaired.pieceIds || pieces.map(p => p.id)).map(Number).filter(Boolean).sort((a,b) => a-b).join('|')

    if ((!hasSeparates && !hasDress) || (requireShoes && !hasShoes)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'not a complete wardrobe outfit' })
      continue
    }
    if (seen.has(key)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'duplicate formula' })
      continue
    }
    if (/\b(flattering|elongating|slimming|confidence|draws attention upward|balance the body)\b/.test(text)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'uses body-shape/flattery framing' })
      continue
    }
    if ((text.match(/\b(wide|wide-leg|oversized|loose|flowing|voluminous|relaxed)\b/g) || []).length >= 3) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'too much width/volume' })
      continue
    }
    if ((text.match(/\b(soft|gauzy|drape|drapey|cream|ivory|beige|taupe|sand)\b/g) || []).length >= 5 && !/\b(black|charcoal|espresso|boot|loafer|pointed|structured|graphic)\b/.test(text)) {
      rejected.push({ label: repaired?.label || 'unnamed', reason: 'soft neutral drift' })
      continue
    }

    seen.add(key)
    accepted.push(repaired)
  }
  const diverse = applyWholeWardrobeDiversity(sortByStylisticStrength(accepted, null), limit, { requireDress, requireNonGraphicTop, candidatePieces, occasion })
  return {
    outfits: normalizeWholeWardrobeStrengths(diverse.outfits),
    rejected: [...rejected, ...diverse.rejected]
  }
}

function formatWholeWardrobeOutfitFeedback({ occasion, season, mood, outfits = [], skip = '', saveableLearning = '' }) {
  const lines = [
    `**Generated strongest wardrobe outfits**`,
    `**Occasion / season:** ${occasion || 'casual'} / ${season || 'current season'}`,
    mood ? `**Mood:** ${mood}` : '',
    ''
  ].filter(Boolean)
  outfits.forEach((outfit, index) => {
    lines.push(`**${index === 0 || outfit.strength === 'signature' ? 'Signature / strongest outfit' : outfit.label || `Outfit ${index + 1}`}**`)
    if (outfit.label) lines.push(`Label: ${outfit.label}`)
    if (outfit.strength) lines.push(`Strength: ${outfit.strength}`)
    if (outfit.dominantDirection) lines.push(`Direction: ${outfit.dominantDirection}`)
    if (outfit.silhouette) lines.push(`Silhouette: ${outfit.silhouette}`)
    if (outfit.bestFor) lines.push(`Best for: ${outfit.bestFor}`)
    const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean).join(' + ') : ''
    if (pieces) lines.push(`Pieces: ${pieces}`)
    if (outfit.reason) lines.push(`Why it works: ${outfit.reason}`)
    lines.push(`Watch for: ${outfit.watchFor || 'none'}`)
    lines.push('')
  })
  if (skip) lines.push(`**I would skip**\n${skip}\n`)
  if (saveableLearning) lines.push(`**Saveable learning**\n- ${saveableLearning}`)
  return lines.join('\n').trim()
}

const OUTFIT_BOARD_PLANNER_SYSTEM = `You create simple wardrobe-board plans for Yuna's local closet app.
Return ONLY valid JSON. No markdown.

Goal: choose actual saved wardrobe pieces for visual outfit boards.
The board is a flat collage/styling-board using real garment photos, not virtual try-on.
Act as a renderer, not a second stylist: visualize the surfaced outfit ideas; do not invent extra weak variety.

Yuna's style filter:
- artistic minimalist, relaxed structure, believable proportions
- compact/structured tops with softer or wider bottoms
- stable visual column for oversized tops
- controlled softness; one expressive element unless palette/silhouette are controlled
- warm earthy/deep palette preferred
- no generic fashion-blog styling, no waist-cinching as default

Rules:
- Every board must include the selected garment id.
- Use only candidate garment ids provided.
- Prefer actual wardrobe pieces over generic suggestions.
- Create boards only for the outfit ideas that were actually surfaced in the concept text.
- Prefer 2-3 boards. Do not force an expressive/playful board if the concept text does not include a sound expressive option.
- Keep each board to 2-5 garments total.
- If the concept text labels an outfit as weaker/fallback, reflect that in the board label; do not upgrade it to signature.

JSON shape:
{
  "boards": [
    {
      "label": "strongest artistic-minimal",
      "reason": "short visual reason",
      "pieceIds": [1, 2, 3]
    }
  ]
}`


function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value || '') } catch { return fallback }
}

function safeJsonFromModel(raw) {
  const text = String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim()
  try { return JSON.parse(text) } catch {}
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Model did not return JSON')
  return JSON.parse(match[0])
}

function withTimeout(promise, ms, label = 'operation') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}


function normalizeCalibrationRow(row) {
  return {
    ...row,
    favorite: Boolean(row.favorite),
    archived: Boolean(row.archived),
    labels: safeJsonParse(row.labels, []) || []
  }
}

function getCalibrationReferenceSummary(limit = 24) {
  let rows = []
  try {
    rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived,0) = 0
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(Number(limit))
  } catch {
    return ''
  }
  if (!rows.length) return ''

  const normalized = rows.map(normalizeCalibrationRow)
  const good = normalized.filter(r => ['good_reference', 'real_photo'].includes(r.kind)).slice(0, 8)
  const bad = normalized.filter(r => r.kind === 'bad_reference').slice(0, 8)

  const summarize = (r) => {
    const labels = (r.labels || []).join(', ')
    const note = String(r.notes || '').trim()
    const strength = r.favorite ? 'Use strongly; ' : ''
    return `- ${strength}${r.kind}${labels ? ` [${labels}]` : ''}${note ? `: ${note}` : ''}`
  }

  const parts = []
  if (good.length) parts.push(`Positive calibration references — preserve these traits:
${good.map(summarize).join('\n')}`)
  if (bad.length) parts.push(`Negative calibration references — avoid these drift patterns:
${bad.map(summarize).join('\n')}`)
  return parts.join('\n\n')
}

function getCalibrationMemoryForStylist(limit = 32) {
  let rows = []
  try {
    rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived,0) = 0
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(Number(limit))
  } catch {
    return ''
  }
  if (!rows.length) return ''

  const normalized = rows.map(normalizeCalibrationRow)
  const positiveLabels = /most_like_me|signature|works|good|strong|real|use_strongly|relaxed_structure|grounded|modern|minimal|artistic/i
  const negativeLabels = /too_safe|too_boho|wrong_proportions|wrong_silhouette|wrong_energy|catalog_drift|not_me|ignore|bad|drift|too_polished|too_generic|too_soft/i

  const positives = []
  const negatives = []
  for (const row of normalized) {
    const labels = row.labels || []
    const labelText = labels.join(', ')
    const note = String(row.notes || '').trim()
    const summary = `- ${row.favorite ? 'Use strongly: ' : ''}${row.kind}${labelText ? ` [${labelText}]` : ''}${note ? ` — ${note.slice(0, 260)}` : ''}`
    if (row.archived) continue
    if (row.kind === 'bad_reference' || labels.some(l => negativeLabels.test(String(l))) || negativeLabels.test(note)) {
      negatives.push(summary)
    } else if (row.favorite || row.kind === 'real_photo' || row.kind === 'good_reference' || labels.some(l => positiveLabels.test(String(l))) || positiveLabels.test(note)) {
      positives.push(summary)
    }
  }

  const parts = []
  if (positives.length) parts.push(`Calibration Library positive memory. Treat Use strongly / real outfit / good references as high-authority taste and identity examples, but do not copy outfits literally:
${positives.slice(0, 12).join('\n')}`)
  if (negatives.length) parts.push(`Calibration Library negative memory. Suppress outfit ideas and renderer choices that resemble these drift patterns:
${negatives.slice(0, 12).join('\n')}`)
  return parts.join('\n\n')
}

function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapLabel(value, max = 22) {
  const words = String(value || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  return lines.slice(0, 2)
}

async function makeTextTile({ width, height, title, subtitle }) {
  const titleLines = wrapLabel(title, 20)
  const subtitleLines = wrapLabel(subtitle, 28)
  const titleSvg = titleLines.map((line, i) => `<text x="${width / 2}" y="${height / 2 - 16 + i * 18}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="#4b423b">${escapeSvgText(line)}</text>`).join('')
  const subtitleSvg = subtitleLines.map((line, i) => `<text x="${width / 2}" y="${height / 2 + 34 + i * 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#81766d">${escapeSvgText(line)}</text>`).join('')
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="18" fill="#f4f0ea"/><rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="14" fill="none" stroke="#d8cec4" stroke-width="1.5" stroke-dasharray="5 5"/>${titleSvg}${subtitleSvg}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function makeGarmentTile(piece, width = 190, height = 230) {
  const photo = piece?.photo || piece?.worn_photo
  const filePath = photo ? path.join(uploadsDir, photo) : null
  let image
  if (filePath && fs.existsSync(filePath)) {
    image = await sharp(filePath)
      .rotate()
      .resize(width - 20, height - 52, { fit: 'contain', background: { r: 250, g: 248, b: 245, alpha: 0 } })
      .png()
      .toBuffer()
  } else {
    image = await makeTextTile({ width: width - 20, height: height - 52, title: piece?.name || 'garment', subtitle: piece?.category || '' })
  }

  const labelLines = wrapLabel(piece?.name || 'garment', 21)
  const labelSvg = labelLines.map((line, i) => `<text x="${width / 2}" y="${height - 28 + i * 13}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#5b5149">${escapeSvgText(line)}</text>`).join('')
  const tileSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="18" fill="#fbfaf8"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="18" fill="none" stroke="#e2d9d0"/>${labelSvg}</svg>`
  return sharp(Buffer.from(tileSvg)).composite([{ input: image, left: 10, top: 12 }]).png().toBuffer()
}

function fullPiecesForCandidate(candidate = {}, candidatePieces = []) {
  const byId = new Map(candidatePieces.map(piece => [Number(piece.id), piece]))
  return (candidate.pieceIds || candidate.pieces?.map(piece => piece.id) || [])
    .map(id => byId.get(Number(id)))
    .filter(Boolean)
}

async function makeWholeWardrobeCandidateContactSheet(candidates = [], candidatePieces = [], maxCandidates = 12) {
  const shown = candidates.slice(0, maxCandidates)
  const width = 1120
  const rowHeight = 196
  const headerHeight = 76
  const height = headerHeight + shown.length * rowHeight + 28
  const composites = []
  const rowSvgs = []

  for (const [index, candidate] of shown.entries()) {
    const y = headerHeight + index * rowHeight
    const pieces = fullPiecesForCandidate(candidate, candidatePieces).slice(0, 5)
    const title = `${candidate.candidateId}: ${pieces.map(piece => piece.name).join(' + ')}`
    const formula = wholeWardrobeCandidateAxes(candidate).formula
    rowSvgs.push(`
      <rect x="24" y="${y}" width="${width - 48}" height="${rowHeight - 14}" rx="18" fill="#fffaf7" stroke="#ddd1c6"/>
      <text x="44" y="${y + 30}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#3f352e">${escapeSvgText(title)}</text>
      <text x="44" y="${y + 54}" font-family="Arial, sans-serif" font-size="12" fill="#81756b">formula: ${escapeSvgText(formula)}${candidate.localReasons?.length ? ` · ${escapeSvgText(candidate.localReasons.join('; '))}` : ''}</text>
    `)
    composites.push(...await Promise.all(pieces.map(async (piece, pieceIndex) => ({
      input: await makeGarmentTile(piece, 150, 132),
      left: 44 + pieceIndex * 166,
      top: y + 62
    }))))
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f4efe8"/>
    <text x="32" y="38" font-family="Georgia, serif" font-size="30" fill="#2f2924">Whole wardrobe candidate sheet</text>
    <text x="32" y="62" font-family="Arial, sans-serif" font-size="14" fill="#786d63">Choose visually coherent outfits by candidate ID. Use the garment photos, not just the labels.</text>
    ${rowSvgs.join('')}
  </svg>`
  const buffer = await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 84 }).toBuffer()
  return { base64: buffer.toString('base64'), mime: 'image/jpeg', shownCandidateIds: shown.map(candidate => candidate.candidateId) }
}

async function rankWholeWardrobeCandidatesWithVision({ candidates = [], candidatePieces = [], occasion, season, mood, memoryText = '', limit = 5 }) {
  const candidatesWithPhotos = candidates.filter(candidate =>
    fullPiecesForCandidate(candidate, candidatePieces).some(piece => piece.photo || piece.worn_photo)
  )
  const reviewSource = candidatesWithPhotos.length >= 6 ? candidatesWithPhotos : candidates
  const reviewCandidates = selectDiverseWholeWardrobeCandidates(reviewSource, 18, { occasion })
  if (!reviewCandidates.length) return null

  const sheet = await makeWholeWardrobeCandidateContactSheet(reviewCandidates, candidatePieces, 18)
  const candidateTruth = wholeWardrobeCandidateText(reviewCandidates)
  const raw = await askStylist({
    system: `You are Yuna's visual wardrobe critic. Rank candidate outfits by what actually works visually from the contact sheet. Prioritize Yuna's known taste and saved calibration memory. Do not invent pieces. Return ONLY JSON.`,
    maxTokens: 900,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: sheet.mime, data: sheet.base64 } },
        { type: 'text', text: [
          `Occasion: ${occasion || 'casual'}`,
          `Season: ${season || 'current season'}`,
          `Mood: ${mood || 'artistic minimalist'}`,
          memoryText ? `Taste memory:\n${memoryText}` : '',
          `Candidate truth:\n${candidateTruth}`,
          '',
          `Return JSON exactly like:
{
  "rankedCandidateIds": ["cand-1", "cand-7"],
  "rejectedCandidateIds": [{"candidateId": "cand-3", "reason": "visual reason"}],
  "visualLearning": "one concise observation"
}`,
          `Rank up to ${Math.max(limit, 5)} candidates. Prefer visual coherence, good fit/trust, garment rotation, and actual outfit appeal over safe repeated formulas.`
        ].filter(Boolean).join('\n\n') }
      ]
    }]
  })
  const parsed = safeJsonFromModel(raw)
  const rankedIds = Array.isArray(parsed.rankedCandidateIds) ? parsed.rankedCandidateIds.filter(id => sheet.shownCandidateIds.includes(id)) : []
  if (!rankedIds.length) return null
  const byId = new Map(candidates.map(candidate => [candidate.candidateId, candidate]))
  const ranked = rankedIds.map(id => byId.get(id)).filter(Boolean)
  const rest = candidates.filter(candidate => !rankedIds.includes(candidate.candidateId))
  return {
    candidates: [...ranked, ...rest],
    visualRejected: parsed.rejectedCandidateIds || [],
    visualLearning: parsed.visualLearning || '',
    reviewedCandidateIds: sheet.shownCandidateIds,
    rankedCandidateIds: rankedIds
  }
}


function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}


function escapeXml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function normalizeEditorialDirections(directions = []) {
  if (!Array.isArray(directions)) return []
  return directions.map((d, idx) => {
    const missingPieces = Array.isArray(d?.missingPieces)
      ? d.missingPieces.map(p => typeof p === 'string' ? p : (p?.name || p?.label || '')).filter(Boolean)
      : []
    return {
      title: d?.title || d?.label || `Ideal direction ${idx + 1}`,
      missingPieces,
      reason: d?.reason || d?.notes || d?.stylistReason || '',
      watchFor: d?.watchFor || d?.risk || '',
      visualPrompt: d?.visualPrompt || d?.prompt || d?.reason || ''
    }
  }).filter(d => d.title || d.missingPieces.length || d.reason)
}

function getOpenAIImageModel() {
  // Current OpenAI image docs use GPT Image models for generations/edits.
  // Some local .env files may still contain retired DALL-E names; ignore those.
  const configured = String(process.env.OPENAI_IMAGE_MODEL || '').trim()
  const unsupported = new Set(['dall-e-2', 'dall-e-3', 'dalle-2', 'dalle-3'])
  if (configured && !unsupported.has(configured.toLowerCase())) return configured
  return 'gpt-image-1'
}

function getOpenAIImageFallbackModels() {
  const primary = getOpenAIImageModel()
  return [primary, 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest']
    .filter((m, i, arr) => m && arr.indexOf(m) === i)
}

function getOpenAIImageSize(kind = 'generate') {
  return kind === 'identity'
    ? (process.env.OPENAI_IDENTITY_IMAGE_SIZE || process.env.OPENAI_EDITORIAL_IMAGE_SIZE || process.env.OPENAI_IMAGE_SIZE || '1024x1536')
    : (process.env.OPENAI_EDITORIAL_IMAGE_SIZE || process.env.OPENAI_IMAGE_SIZE || '1024x1536')
}

async function runOpenAIImageGeneration({ client, prompt, size, kind = 'generate', imagePath = null }) {
  let lastError = null
  for (const model of getOpenAIImageFallbackModels()) {
    try {
      if (kind === 'edit' && imagePath) {
        return await client.images.edit({
          model,
          image: await toFile(fs.createReadStream(imagePath), path.basename(imagePath), { type: 'image/png' }),
          prompt,
          size,
          n: 1
        })
      }
      return await client.images.generate({
        model,
        prompt,
        size,
        n: 1
      })
    } catch (err) {
      lastError = err
      console.error(`OpenAI image ${kind} failed with ${model}:`, err.message)
    }
  }
  throw lastError || new Error('OpenAI image generation failed')
}

function inferBoardLabel(block, index) {
  const heading = String(block || '').split('\n').find(line => /^\*\*[^*]+\*\*/.test(line.trim()))
  if (heading) return heading.replace(/\*/g, '').trim().replace(/^\d+\.?\s*/, '')
  return index === 0 ? 'signature / strongest direction' : index === 1 ? 'usable variation' : 'optional experimental direction'
}

function extractPiecesLine(block) {
  const line = String(block || '').split('\n').find(l => /^\s*Pieces\s*:/i.test(l))
  return line ? line.replace(/^\s*Pieces\s*:/i, '').trim() : ''
}

function extractWhyLine(block) {
  const line = String(block || '').split('\n').find(l => /^\s*Why it works\s*:/i.test(l))
  return line ? line.replace(/^\s*Why it works\s*:/i, '').trim() : ''
}

function extractWatchLine(block) {
  const line = String(block || '').split('\n').find(l => /^\s*Watch for\s*:/i.test(l))
  const value = line ? line.replace(/^\s*Watch for\s*:/i, '').trim() : ''
  return /^none$/i.test(value) ? '' : value
}

function piecesMentionedInLine(line, candidatePieces, selectedPiece) {
  const normalizedLine = normalizeForMatch(line)
  const scored = []
  for (const piece of candidatePieces) {
    const name = normalizeForMatch(piece.name)
    if (!name) continue
    if (normalizedLine.includes(name)) {
      scored.push({ piece, score: name.length + 100 })
      continue
    }
    const words = name.split(' ').filter(w => w.length > 2)
    if (!words.length) continue
    const hits = words.filter(w => normalizedLine.includes(w)).length
    const score = hits / words.length
    if (score >= 0.72 && hits >= Math.min(3, words.length)) scored.push({ piece, score: score * 80 + hits })
  }
  const byId = new Map()
  for (const { piece, score } of scored.sort((a,b) => b.score - a.score)) {
    if (!byId.has(Number(piece.id))) byId.set(Number(piece.id), piece)
  }
  if (selectedPiece?.id && !byId.has(Number(selectedPiece.id))) byId.set(Number(selectedPiece.id), selectedPiece)
  return [...byId.values()]
}

function inferMissingCategory(name = '') {
  const n = normalizeForMatch(name)
  if (/boot|loafer|flat|sandal|sneaker|shoe|mule/.test(n)) return 'shoes'
  if (/pant|jean|trouser|skirt|short/.test(n)) return 'bottom'
  if (/jacket|cardigan|blazer|coat|vest/.test(n)) return 'outerwear'
  if (/bag|belt|necklace|earring|bracelet|scarf|tote|crossbody/.test(n)) return 'accessory'
  if (/dress/.test(n)) return 'dress'
  return 'missing piece'
}

function missingPiecesMentionedInLine(line, candidatePieces = []) {
  const text = String(line || '')
  const found = []
  const seen = new Set()
  const patterns = [
    /\[missing\s*:\s*([^\]]+)\]/gi,
    /\(missing\s*:\s*([^\)]+)\)/gi,
    /missing-piece idea\s*:\s*([^+;,.]+)/gi
  ]
  for (const pattern of patterns) {
    let m
    while ((m = pattern.exec(text))) {
      const raw = String(m[1] || '').replace(/^idea\s*:/i, '').trim()
      const name = raw.replace(/^a\s+|^an\s+|^the\s+/i, '').trim()
      if (!name) continue
      const normalized = normalizeForMatch(name)
      if (!normalized || seen.has(normalized)) continue
      // If it actually matches an owned candidate, do not duplicate it as missing.
      if (candidatePieces.some(p => normalizeForMatch(p.name) === normalized)) continue
      seen.add(normalized)
      found.push({
        id: `missing-${normalized.replace(/\s+/g, '-')}`,
        name: `${name} (missing piece)`,
        category: inferMissingCategory(name),
        missing: true,
        photo: null,
        worn_photo: null
      })
    }
  }
  return found
}

function structuredOutfitsFromGeneratedText(answer, selectedPiece, candidatePieces) {
  const text = String(answer || '')
  const sections = []
  const labelPattern = 'Signature \/ strongest direction|Best owned wardrobe direction|Ideal editorial completion|Usable variation|Optional experimental direction'
  const regex = new RegExp('\\*\\*(' + labelPattern + ')\\*\\*([\\s\\S]*?)(?=\\n\\*\\*(?:' + labelPattern + '|I would skip|Avoid for this garment|Saveable learning)|$)', 'gi')
  let match
  while ((match = regex.exec(text))) {
    sections.push({ label: match[1], block: match[2] })
  }
  if (!sections.length) {
    const chunks = text.split(/\n---\n/).filter(chunk => /Pieces\s*:/i.test(chunk)).slice(0, 3)
    chunks.forEach((block, i) => sections.push({ label: inferBoardLabel(block, i), block }))
  }
  return sections.map((section, i) => {
    const line = extractPiecesLine(section.block)
    const pieces = piecesMentionedInLine(line, candidatePieces, selectedPiece)
    const missingPieces = missingPiecesMentionedInLine(line, candidatePieces)
    const reason = extractWhyLine(section.block)
    const watchFor = extractWatchLine(section.block)
    return {
      label: section.label.toLowerCase(),
      reason: reason || `${section.label} using saved wardrobe pieces and/or missing-piece archetypes`,
      watchFor,
      pieceIds: pieces.map(p => Number(p.id)).filter(Boolean),
      missingPieces,
      pieces: [
        ...pieces.map(p => ({ id: p.id, name: p.name, category: p.category })),
        ...missingPieces.map(p => ({ id: p.id, name: p.name, category: p.category, missing: true }))
      ]
    }
  }).filter(o => o.pieceIds.includes(Number(selectedPiece.id)) && (o.pieceIds.length + (o.missingPieces?.length || 0)) >= 2)
}


function hasMissingPiecesInStructuredOutfits(structuredOutfits = []) {
  return (structuredOutfits || []).some(o =>
    (Array.isArray(o?.missingPieces) && o.missingPieces.length) ||
    (Array.isArray(o?.pieces) && o.pieces.some(p => p?.missing || String(p?.id || '').startsWith('missing-')))
  )
}

function buildIdealMissingCompletionForPiece(selectedPiece, existingOutfits = []) {
  if (!selectedPiece?.id) return null
  const name = String(selectedPiece.name || '').toLowerCase()
  const category = String(selectedPiece.category || '').toLowerCase()
  const isTop = category.includes('top')
  const isBottom = category.includes('bottom') || category.includes('pants') || category.includes('skirt')
  let missing = []
  let reason = 'Ideal editorial completion using missing-piece archetypes to show the strongest direction, not just the closest owned substitute.'

  if (isTop) {
    if (/lace|sheer|floral|soft|cream|appliqu/.test(name)) {
      missing = [
        { id: 'missing-grounded-olive-utility-trouser', name: 'grounded olive utility trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-cognac-or-brown-grounded-flat', name: 'cognac grounded flat or loafer (missing piece)', category: 'shoes', missing: true },
      ]
      reason = 'Ideal editorial completion: a grounded olive utility trouser gives the soft top visual gravity, while cognac footwear keeps the warmth intentional.'
    } else if (/stripe|button|shirt|tailor|structured/.test(name)) {
      missing = [
        { id: 'missing-deep-navy-or-charcoal-long-column-trouser', name: 'deep navy or charcoal long column trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-slim-loafer-or-grounded-flat', name: 'slim loafer or grounded flat (missing piece)', category: 'shoes', missing: true },
      ]
      reason = 'Ideal editorial completion: a long dark column keeps the structured top clean and avoids breaking the vertical line.'
    } else {
      missing = [
        { id: 'missing-structured-earth-tone-trouser', name: 'structured earth-tone trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-grounded-walking-flat', name: 'grounded walking flat (missing piece)', category: 'shoes', missing: true },
      ]
      reason = 'Ideal editorial completion: a structured trouser and grounded shoe clarify the silhouette without adding more visual noise.'
    }
  } else if (isBottom) {
    missing = [
      { id: 'missing-compact-artistic-knit-or-shell', name: 'compact artistic knit or shell (missing piece)', category: 'top', missing: true },
      { id: 'missing-grounded-low-profile-shoe', name: 'grounded low-profile shoe (missing piece)', category: 'shoes', missing: true },
    ]
    reason = 'Ideal editorial completion: a compact top keeps the selected bottom central while the shoe stabilizes the lower line.'
  } else {
    missing = [
      { id: 'missing-simple-grounding-support-piece', name: 'simple grounding support piece (missing piece)', category: 'bottom', missing: true },
    ]
  }

  return {
    label: 'ideal editorial completion',
    reason,
    pieceIds: [Number(selectedPiece.id)],
    missingPieces: missing,
    pieces: [
      { id: selectedPiece.id, name: selectedPiece.name, category: selectedPiece.category },
      ...missing
    ]
  }
}

function ensureIdealMissingCompletion(structuredOutfits, selectedPiece, forceVisible = false) {
  const outfits = Array.isArray(structuredOutfits) ? [...structuredOutfits] : []
  if (!forceVisible && hasMissingPiecesInStructuredOutfits(outfits)) return outfits
  const ideal = buildIdealMissingCompletionForPiece(selectedPiece, outfits)
  if (!ideal) return outfits
  // Keep the best owned direction first, then make the ideal missing-piece direction visible.
  const filtered = outfits.filter(o => !/optional experimental/i.test(String(o?.label || '')))
  return [filtered[0], ideal, ...filtered.slice(1)].filter(Boolean).slice(0, 3)
}


function buildIdealOnlyCompletionsForPiece(selectedPiece) {
  const name = String(selectedPiece?.name || '').toLowerCase()
  const category = String(selectedPiece?.category || '').toLowerCase()
  const selected = { id: selectedPiece.id, name: selectedPiece.name, category: selectedPiece.category }
  const isTop = category.includes('top')
  const isBottom = category.includes('bottom') || /pant|jean|skirt|trouser/.test(name)

  const make = (label, reason, missing) => ({
    label,
    reason,
    pieceIds: [Number(selectedPiece.id)],
    missingPieces: missing,
    pieces: [selected, ...missing]
  })

  if (isTop && /lace|sheer|cream|floral|appliqu|soft/.test(name)) {
    return [
      make('ideal relaxed earthy', 'A grounded olive utility trouser gives the delicate top visual gravity without making the outfit stiff.', [
        { id: 'missing-grounded-olive-utility-trouser', name: 'grounded olive utility trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-cognac-leather-flat-or-loafer', name: 'cognac leather flat or loafer (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal soft structured', 'A clean cream structured trouser keeps the palette quiet while adding enough architecture below the lace.', [
        { id: 'missing-cream-structured-full-length-trouser', name: 'cream structured full-length trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-nude-or-taupe-flat', name: 'nude or taupe flat (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal modern preppy', 'A dark navy pencil or midi skirt gives the soft top a restrained vertical anchor.', [
        { id: 'missing-deep-navy-pencil-or-midi-skirt', name: 'deep navy pencil or midi skirt (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-navy-or-black-loafer', name: 'navy or black loafer (missing piece)', category: 'shoes', missing: true }
      ])
    ]
  }

  if (isTop && /stripe|button|shirt|structured|sleeveless/.test(name)) {
    return [
      make('ideal long column', 'A long dark trouser gives the graphic top a cleaner vertical base than a cropped or playful bottom.', [
        { id: 'missing-deep-navy-long-column-trouser', name: 'deep navy long column trouser (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-low-profile-loafer', name: 'low-profile loafer (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal relaxed earthy', 'An olive or tobacco utility pant softens the graphic stripe while keeping enough structure.', [
        { id: 'missing-olive-or-tobacco-utility-pant', name: 'olive or tobacco utility pant (missing piece)', category: 'bottom', missing: true },
        { id: 'missing-cognac-flat', name: 'cognac flat (missing piece)', category: 'shoes', missing: true }
      ])
    ]
  }

  if (isBottom) {
    return [
      make('ideal compact top', 'A compact structured top keeps the selected bottom central and avoids extra volume at the waist.', [
        { id: 'missing-compact-navy-shell-or-knit', name: 'compact navy shell or knit (missing piece)', category: 'top', missing: true },
        { id: 'missing-grounded-low-profile-shoe', name: 'grounded low-profile shoe (missing piece)', category: 'shoes', missing: true }
      ]),
      make('ideal artistic restraint', 'A quiet graphic or textural top adds interest without competing with the selected bottom.', [
        { id: 'missing-quiet-graphic-structured-top', name: 'quiet graphic structured top (missing piece)', category: 'top', missing: true },
        { id: 'missing-cognac-or-dark-flat', name: 'cognac or dark flat (missing piece)', category: 'shoes', missing: true }
      ])
    ]
  }

  return [buildIdealMissingCompletionForPiece(selectedPiece)].filter(Boolean)
}

function boardPlanFromStructuredOutfits(structuredOutfits, selectedPiece, candidatePieces) {
  if (!Array.isArray(structuredOutfits) || !structuredOutfits.length) return []
  const candidateById = new Map(candidatePieces.map(p => [Number(p.id), p]))
  return structuredOutfits.slice(0, 3).map((outfit, index) => {
    const ids = Array.isArray(outfit.pieceIds)
      ? outfit.pieceIds.map(Number)
      : Array.isArray(outfit.pieces)
        ? outfit.pieces.map(p => Number(p.id || p.pieceId)).filter(Boolean)
        : []
    if (selectedPiece?.id && !ids.includes(Number(selectedPiece.id))) ids.unshift(Number(selectedPiece.id))
    const unique = [...new Set(ids)].filter(id => candidateById.has(id)).slice(0, 5)
    const missingPieces = Array.isArray(outfit.missingPieces)
      ? outfit.missingPieces
      : Array.isArray(outfit.pieces)
        ? outfit.pieces.filter(p => p?.missing || String(p?.id || '').startsWith('missing-')).map(p => ({
            id: p.id || `missing-${normalizeForMatch(p.name).replace(/\s+/g, '-')}`,
            name: p.name || 'missing piece',
            category: p.category || inferMissingCategory(p.name),
            missing: true,
            photo: null,
            worn_photo: null
          }))
        : []
    return {
      label: outfit.label || (index === 0 ? 'strongest artistic-minimal' : index === 1 ? 'usable variation' : 'optional experimental'),
      reason: outfit.reason || outfit.why || '',
      watchFor: outfit.watchFor || outfit.watch_for || '',
      pieceIds: unique,
      missingPieces: missingPieces.slice(0, Math.max(0, 5 - unique.length))
    }
  }).filter(b => (b.pieceIds.length + (b.missingPieces?.length || 0)) >= 2)
}


function dedupeBoardPiecesForRender(pieces = []) {
  const seenIds = new Set()
  const seenNames = new Set()
  const result = []
  for (const piece of pieces) {
    if (!piece) continue
    const rawId = piece.id
    const numericId = Number(rawId)
    const hasRealNumericId = Number.isFinite(numericId) && numericId > 0
    const nameKey = normalizeForMatch(piece.name || '')
    const categoryKey = normalizeForMatch(piece.category || '')
    const key = `${nameKey}|${categoryKey}`

    // Prefer the real saved wardrobe item over a missing-piece placeholder.
    if (hasRealNumericId && seenIds.has(numericId)) continue
    if (nameKey && seenNames.has(key)) continue

    seenIds.add(numericId)
    if (nameKey) seenNames.add(key)
    result.push(piece)
  }
  return result
}

function dedupeMissingAgainstOwned(missingPieces = [], ownedPieces = []) {
  const ownedKeys = new Set(ownedPieces.map(p => `${normalizeForMatch(p.name)}|${normalizeForMatch(p.category)}`))
  const ownedNames = new Set(ownedPieces.map(p => normalizeForMatch(p.name)))
  const seen = new Set()
  const result = []
  for (const piece of missingPieces || []) {
    const nameKey = normalizeForMatch(piece?.name || '').replace(/ missing piece$/i, '').trim()
    const categoryKey = normalizeForMatch(piece?.category || '')
    const key = `${nameKey}|${categoryKey}`
    if (!nameKey) continue
    if (ownedNames.has(nameKey) || ownedKeys.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(piece)
  }
  return result
}


function photoPreservingVisualsEnabled() {
  return String(process.env.PHOTO_PRESERVING_VISUALS || 'false').toLowerCase() === 'true'
}

async function makePhotoPanel(filePath, width, height, label = 'source photo') {
  let image
  try {
    image = await sharp(filePath)
      .rotate()
      .resize(width - 24, height - 70, { fit: 'cover', position: 'top' })
      .png()
      .toBuffer()
  } catch (err) {
    image = await makeTextTile({ width: width - 24, height: height - 70, title: label, subtitle: 'photo unavailable' })
  }
  const safeLabel = escapeSvgText(label)
  const frame = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="24" fill="#fffaf4" stroke="#d8c9b7" stroke-width="2"/>
    <text x="18" y="${height - 30}" font-family="Arial, sans-serif" font-size="15" fill="#6d6259">${safeLabel}</text>
  </svg>`
  return sharp(Buffer.from(frame)).composite([{ input: image, left: 12, top: 12 }]).png().toBuffer()
}

function makeMissingPieceObject(name, idx = 0) {
  return {
    id: `missing-visual-${idx}-${normalizeForMatch(name).replace(/\s+/g, '-')}`,
    name: String(name || 'missing piece'),
    category: inferMissingCategory(name),
    missing: true,
    photo: null,
    worn_photo: null
  }
}

async function createPhotoPreservingCollageImage({ title, subtitle, sourcePath = null, selectedPiece = null, pieces = [], missingPieces = [], reason = '', index = 1, prefix = 'photo-collage' }) {
  const boardDir = path.join(uploadsDir, 'generated-boards')
  if (!fs.existsSync(boardDir)) fs.mkdirSync(boardDir, { recursive: true })

  const width = 1024
  const height = sourcePath ? 1280 : 900
  const safeTitle = escapeSvgText(title || 'Photo-preserving board')
  const safeSubtitle = escapeSvgText(subtitle || 'Real-photo / saved-garment collage')
  const safeReason = escapeSvgText(reason || 'Uses real saved images rather than generating a new person or scene.')
  const baseSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f7f3ed"/>
    <text x="48" y="58" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#3f3832">${safeTitle}</text>
    <text x="48" y="88" font-family="Arial, sans-serif" font-size="15" fill="#756a62">${safeSubtitle}</text>
    <foreignObject x="48" y="${height - 110}" width="900" height="58"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.35; color:#6d6259;">${safeReason}</div></foreignObject>
    <text x="48" y="${height - 28}" font-family="Arial, sans-serif" font-size="12" fill="#9b9087">Photo-preserving collage: source/saved photos are kept as photos; no synthetic person rendering.</text>
  </svg>`

  const composites = []
  let startY = 126
  let x = 52
  if (sourcePath) {
    const sourcePanel = await makePhotoPanel(sourcePath, 430, 780, 'source photo preserved')
    composites.push({ input: sourcePanel, left: 52, top: 126 })
    x = 520
  }

  const visualPieces = []
  if (selectedPiece) visualPieces.push({ ...selectedPiece, _labelPrefix: 'anchor' })
  for (const piece of pieces || []) {
    if (selectedPiece?.id && Number(piece?.id) === Number(selectedPiece.id)) continue
    visualPieces.push(piece)
  }
  for (const [idx, name] of (missingPieces || []).entries()) visualPieces.push(makeMissingPieceObject(name, idx))

  const tileW = sourcePath ? 200 : 190
  const tileH = sourcePath ? 244 : 230
  const positions = sourcePath
    ? [[520,126],[760,126],[520,404],[760,404],[640,682]]
    : [[70,150],[292,150],[514,150],[736,150],[292,440],[514,440]]

  for (let i = 0; i < visualPieces.slice(0, positions.length).length; i++) {
    const tile = await makeGarmentTile(visualPieces[i], tileW, tileH)
    composites.push({ input: tile, left: positions[i][0], top: positions[i][1] })
  }

  const filename = `generated-boards/${prefix}-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  await sharp(Buffer.from(baseSvg)).composite(composites).png().toFile(outPath)
  return `/uploads/${filename}`
}

async function createOutfitBoardImage({ board, pieces, index }) {
  const boardDir = path.join(uploadsDir, 'generated-boards')
  if (!fs.existsSync(boardDir)) fs.mkdirSync(boardDir, { recursive: true })

  const width = 900
  const height = 620
  const headerSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f7f3ed"/>
    <text x="48" y="54" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#3f3832">${escapeSvgText(board.label || 'Outfit board')}</text>
    <text x="48" y="84" font-family="Arial, sans-serif" font-size="14" fill="#756a62">${escapeSvgText(board.reason || 'Wardrobe styling board')}</text>
    <text x="48" y="590" font-family="Arial, sans-serif" font-size="12" fill="#9b9087">Visual board uses saved garment photos; missing pieces appear as labeled placeholders.</text>
  </svg>`

  const tileW = 190
  const tileH = 230
  const coords = [
    [64, 132], [270, 122], [476, 132], [654, 174], [372, 370]
  ]
  const composites = []
  for (let i = 0; i < pieces.slice(0, 5).length; i++) {
    const tile = await makeGarmentTile(pieces[i], tileW, tileH)
    composites.push({ input: tile, left: coords[i][0], top: coords[i][1] })
  }

  const filename = `generated-boards/board-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  await sharp(Buffer.from(headerSvg)).composite(composites).png().toFile(outPath)
  return `/uploads/${filename}`
}

async function garmentReferenceImage(piece) {
  const photo = piece?.worn_photo || piece?.photo
  if (!photo) return null
  const filePath = path.join(uploadsDir, photo)
  if (!fs.existsSync(filePath)) return null
  const buffer = await sharp(filePath)
    .rotate()
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84 })
    .toBuffer()
  return {
    base64: buffer.toString('base64'),
    mime: 'image/jpeg',
    label: `${piece.name} (${wardrobeCategoryGroup(piece)})`,
    piece
  }
}

function wholeWardrobeImagePrompt({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season' }) {
  const pieceLines = pieces.map((piece, index) => {
    const truth = buildPieceText(piece).replace(/\s+/g, ' ').slice(0, 900)
    return `${index + 1}. ${piece.name} (${wardrobeCategoryGroup(piece)}): ${truth}`
  }).join('\n')
  return [
    'Generate one realistic full-outfit styling image using the provided saved wardrobe garment references.',
    'This is NOT a shopping/editorial concept and NOT a generated fantasy outfit. Use the listed saved garments as the outfit components.',
    '',
    'Garment fidelity rules:',
    '- Preserve each referenced garment category, color family, print/stripe/pattern scale, neckline/sleeve/hem behavior, fabric weight, and visible texture as much as possible.',
    '- Do not replace a listed wardrobe piece with a different garment.',
    '- Do not add extra hero garments, patterned layers, belts, scarves, or accessories unless the listed outfit explicitly includes them.',
    '- Shoes must match the listed shoe reference if shoes are included.',
    '',
    'Person / scene:',
    '- Full figure visible from head to shoes, single adult woman, natural relaxed posture, ordinary realistic proportions, no beauty retouching.',
    '- Simple neutral or natural background, soft daylight, no text, no watermark, no collage labels.',
    '- Keep the result wearable and grounded, closer to a real try-on/photo reference than a fashion ad.',
    '',
    `Outfit label: ${outfit.label || 'Whole wardrobe outfit'}`,
    outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
    outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
    outfit.reason ? `Stylist mechanics: ${outfit.reason}` : '',
    outfit.watchFor ? `Avoid drift: ${outfit.watchFor}` : '',
    `Occasion: ${occasion}. Season: ${season}.`,
    '',
    `Saved wardrobe pieces to use:\n${pieceLines}`
  ].filter(Boolean).join('\n')
}

function savedOutfitImagePrompt({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season' }) {
  const anchorPiece = (pieces || []).find(piece => wardrobeCategoryGroup(piece) === 'top')
    || (pieces || []).find(piece => wardrobeCategoryGroup(piece) === 'dress')
    || (pieces || [])[0]
  const pieceLines = pieces.map((piece, index) => {
    const truth = buildPieceText(piece).replace(/\s+/g, ' ').slice(0, 500)
    return `${index + 1}. ${piece.name} (${wardrobeCategoryGroup(piece)}): ${truth}`
  }).join('\n')
  return [
    'Create one image showing three outfit alternatives inspired by the saved outfit photo.',
    'Show the three alternatives side by side as a clean triptych/contact sheet. Each alternative should be a full-body outfit on the same person.',
    'Do not copy the input outfit. Make each alternative meaningfully different.',
    anchorPiece ? `Keep this linked garment as the visible anchor in all three alternatives: ${anchorPiece.name} (${wardrobeCategoryGroup(anchorPiece)}). Do not replace or redesign that anchor garment.` : '',
    'Surface at least three distinct outfit formula families across the alternatives. Vary support pieces, shoe/grounding strategy, layer logic, color story, and visual rhythm. Do not generate near-duplicates.',
    'Use taste guardrails as boundaries, not a fixed recipe: avoid generic casual/resort/preppy styling, bland retail styling, and overly soft beige looks.',
    'Do not make all three alternatives earthy, vintage, bohemian, or autumnal. Do not repeat the same skirt shape, same shoe family, same color family, or same layer idea across all three.',
    'At least one option should feel sharper, urban, graphic, or minimal rather than warm/bohemian. One option may be softer or more romantic, but the set must not collapse into one mood.',
    'Use the source photo only for identity, proportions, and fit context.',
    'Use the linked garment references when useful. You may change supporting styling pieces freely, but keep the anchor garment.',
    'Full body, realistic clothing, no text, no labels, no watermark, no mirror selfie.',
    '',
    `Saved outfit: ${outfit.label || outfit.title || outfit.name || 'saved outfit'}`,
    pieceLines ? `Linked garment truth:\n${pieceLines}` : '',
    `Occasion: ${occasion}. Season: ${season}.`
  ].filter(Boolean).join('\n')
}

async function createSavedOutfitImage({ outfit = {}, pieces = [], occasion = 'casual', season = 'current season', index = 1 }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/saved-outfit-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const sourcePath = outfit.photo ? imageUrlToUploadPath(outfit.photo) : null

  if (photoPreservingVisualsEnabled() || !process.env.OPENAI_API_KEY) {
    const collageStartedAt = Date.now()
      const imageUrl = await createPhotoPreservingCollageImage({
      title: 'Outfit alternatives',
      subtitle: 'saved outfit variant · photo-preserving collage',
      sourcePath,
      pieces,
      reason: 'Uses the saved outfit photo and linked garment photos as references.',
      index,
      prefix: 'saved-outfit-collage'
    })
    timings.collageMs = Date.now() - collageStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'photo_preserving_collage' }
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const contentParts = []
    if (sourcePath) {
      const sourceStartedAt = Date.now()
      const buffer = await sharp(sourcePath)
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86 })
        .toBuffer()
      timings.sourceImageMs = Date.now() - sourceStartedAt
      contentParts.push({ type: 'input_text', text: 'Source outfit photo. Reference only. Do not recreate it exactly.' })
      contentParts.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${buffer.toString('base64')}` })
    }

    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(pieces.slice(0, 5).map(piece => garmentReferenceImage(piece)))).filter(Boolean)
    timings.garmentReferenceMs = Date.now() - garmentStartedAt
    for (const ref of garmentRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
      contentParts.push({ type: 'input_text', text: `Linked garment reference: ${ref.label}` })
    }

    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({ type: 'input_text', text: img.kind === 'real_photo' ? 'Identity/proportion calibration reference.' : 'Taste calibration reference.' })
    }

    contentParts.push({ type: 'input_text', text: savedOutfitImagePrompt({ outfit, pieces, occasion, season }) })
    const gptStartedAt = Date.now()
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content: contentParts }],
      tools: [{ type: 'image_generation', size: getOpenAIImageSize('generate'), quality: 'medium' }]
    })
    timings.gpt4oImageMs = Date.now() - gptStartedAt
    const imageItem = response.output?.find(item => item.type === 'image_generation_call')
    if (!imageItem?.result) throw new Error('GPT-4o did not return an image result')
    const writeStartedAt = Date.now()
    await fs.promises.writeFile(outPath, Buffer.from(imageItem.result, 'base64'))
    timings.writeMs = Date.now() - writeStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    console.error('Saved outfit GPT-4o image generation failed, falling back to collage:', err.message)
    timings.gpt4oError = err.message
    const imageUrl = await createPhotoPreservingCollageImage({
      title: 'Outfit alternatives',
      subtitle: 'saved outfit variant fallback · source and garment photos',
      sourcePath,
      pieces,
      reason: `Image generation fallback: ${err.message}`,
      index,
      prefix: 'saved-outfit-fallback'
    })
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'fallback_collage' }
  }
}

async function createWholeWardrobeOutfitImage({ outfit, pieces, occasion, season, index = 1 }) {
  const startedAt = Date.now()
  const timings = {}
  const filename = `generated-boards/whole-wardrobe-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const board = {
    label: outfit.label || `Whole wardrobe outfit ${index}`,
    reason: outfit.reason || '',
  }

  if (photoPreservingVisualsEnabled() || !process.env.OPENAI_API_KEY) {
    const collageStartedAt = Date.now()
    const imageUrl = await createPhotoPreservingCollageImage({
      title: board.label,
      subtitle: 'whole-wardrobe outfit · saved garment photos',
      pieces,
      reason: outfit.reason || 'Uses saved wardrobe garment photos for evaluation.',
      index,
      prefix: 'whole-wardrobe-collage'
    })
    timings.collageMs = Date.now() - collageStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'photo_preserving_collage' }
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const contentParts = []
    const garmentStartedAt = Date.now()
    const garmentRefs = (await Promise.all(pieces.slice(0, 5).map(piece => garmentReferenceImage(piece)))).filter(Boolean)
    timings.garmentReferenceMs = Date.now() - garmentStartedAt

    if (garmentRefs.length) {
      contentParts.push({
        type: 'input_text',
        text: `WARDROBE GARMENT REFERENCES — use these saved pieces together in one outfit. Preserve each garment as much as possible; do not invent substitutes.`
      })
      for (const ref of garmentRefs) {
        contentParts.push({ type: 'input_image', image_url: `data:${ref.mime};base64,${ref.base64}` })
        contentParts.push({ type: 'input_text', text: ref.label })
      }
    }

    const calibrationStartedAt = Date.now()
    const calibrationRefs = await getCalibrationReferenceImagesForGeneration(2)
    timings.calibrationReferenceMs = Date.now() - calibrationStartedAt
    for (const img of calibrationRefs) {
      contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
      contentParts.push({ type: 'input_text', text: img.kind === 'real_photo' ? 'Identity/proportion reference only. Do not copy outfit unless it matches listed wardrobe pieces.' : 'Taste calibration reference only.' })
    }

    contentParts.push({ type: 'input_text', text: wholeWardrobeImagePrompt({ outfit, pieces, occasion, season }) })

    const gptStartedAt = Date.now()
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: [{ role: 'user', content: contentParts }],
      tools: [{ type: 'image_generation', size: getOpenAIImageSize('generate'), quality: 'medium' }]
    })
    timings.gpt4oImageMs = Date.now() - gptStartedAt
    const imageItem = response.output?.find(item => item.type === 'image_generation_call')
    if (!imageItem?.result) throw new Error('GPT-4o did not return an image result')
    const writeStartedAt = Date.now()
    await fs.promises.writeFile(outPath, Buffer.from(imageItem.result, 'base64'))
    timings.writeMs = Date.now() - writeStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl: `/uploads/${filename}`, timings, renderer: 'gpt-4o' }
  } catch (err) {
    console.error('Whole-wardrobe GPT-4o image generation failed, falling back to collage:', err.message)
    timings.gpt4oError = err.message
    const fallbackStartedAt = Date.now()
    const imageUrl = await createPhotoPreservingCollageImage({
      title: board.label,
      subtitle: 'whole-wardrobe fallback · saved garment photos',
      pieces,
      reason: `Image generation fallback: ${err.message}`,
      index,
      prefix: 'whole-wardrobe-fallback'
    })
    timings.fallbackCollageMs = Date.now() - fallbackStartedAt
    timings.totalMs = Date.now() - startedAt
    return { imageUrl, timings, renderer: 'fallback_collage' }
  }
}

const uploadsDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  }
})
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } })

// ── Database ───────────────────────────────────────────────────────────────────
const db = new Database('wardrobe.db')
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS pieces (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    colors       TEXT DEFAULT '[]',
    occasions    TEXT DEFAULT '[]',
    season       TEXT DEFAULT 'year-round',
    notes        TEXT DEFAULT '',
    status       TEXT DEFAULT 'active',
    recommendation_status TEXT DEFAULT 'trusted',
    fit_confidence TEXT DEFAULT 'unknown',
    role_permission TEXT DEFAULT 'auto',
    occasion_permissions TEXT DEFAULT '[]',
    engine_notes TEXT DEFAULT '',
    favorite     INTEGER DEFAULT 0,
    photo        TEXT,
    date_added   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS outfits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    occasion     TEXT DEFAULT 'casual',
    season       TEXT DEFAULT 'year-round',
    notes        TEXT DEFAULT '',
    status       TEXT DEFAULT 'confirmed',
    favorite     INTEGER DEFAULT 0,
    photo        TEXT,
    date_added   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS outfit_pieces (
    outfit_id    INTEGER REFERENCES outfits(id) ON DELETE CASCADE,
    piece_id     INTEGER REFERENCES pieces(id)  ON DELETE CASCADE,
    PRIMARY KEY (outfit_id, piece_id)
  );

  CREATE TABLE IF NOT EXISTS todos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL,
    description     TEXT NOT NULL,
    linked_piece_id INTEGER REFERENCES pieces(id) ON DELETE SET NULL,
    completed       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );


  CREATE TABLE IF NOT EXISTS stylist_feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_type   TEXT NOT NULL,
    target_type     TEXT DEFAULT 'message',
    context_type    TEXT,
    context_id      INTEGER,
    context_name    TEXT,
    label           TEXT,
    note            TEXT DEFAULT '',
    payload         TEXT DEFAULT '{}',
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_boards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    board_type      TEXT DEFAULT 'wardrobe',
    context_type    TEXT,
    context_id      INTEGER,
    context_name    TEXT,
    title           TEXT,
    image_url       TEXT,
    pieces          TEXT DEFAULT '[]',
    missing_pieces  TEXT DEFAULT '[]',
    reason          TEXT DEFAULT '',
    watch_for       TEXT DEFAULT '',
    payload         TEXT DEFAULT '{}',
    favorite        INTEGER DEFAULT 0,
    archived        INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  );


  CREATE TABLE IF NOT EXISTS calibration_images (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url       TEXT NOT NULL,
    kind            TEXT DEFAULT 'good_reference',
    labels          TEXT DEFAULT '[]',
    notes           TEXT DEFAULT '',
    source          TEXT DEFAULT 'uploaded',
    favorite        INTEGER DEFAULT 0,
    archived        INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  );
`)

// ── Migrate: add new columns to existing DB ───────────────────────────────────
const NEW_COLUMNS = [
  'worn_photo TEXT',
  'pattern_type TEXT', 'pattern_scale TEXT', 'pattern_complexity TEXT',
  'reads_as TEXT', 'hem_finish TEXT',
  'neckline TEXT', 'sleeve_type TEXT', 'length_hits_at TEXT',
  'silhouette TEXT', 'fabric_category TEXT', 'fabric_weight TEXT',
  'stretch TEXT', 'fit_on_body TEXT', 'tuck_behavior TEXT', 'waistband_type TEXT',
  'styling_rules_learned TEXT', 'pairs_well_with TEXT', 'tried_and_rejected TEXT',
  'background_color TEXT',
  'recommendation_status TEXT DEFAULT "trusted"',
  'fit_confidence TEXT DEFAULT "unknown"',
  'role_permission TEXT DEFAULT "auto"',
  'occasion_permissions TEXT DEFAULT "[]"',
  'engine_notes TEXT DEFAULT ""',
]
NEW_COLUMNS.forEach(col => {
  try { db.exec(`ALTER TABLE pieces ADD COLUMN ${col}`) } catch {}
})

// Additive learning-schema migrations. Existing local databases keep working.
;[
  'is_gold INTEGER DEFAULT 0',
  'archived INTEGER DEFAULT 0'
].forEach(col => {
  try { db.exec(`ALTER TABLE stylist_feedback ADD COLUMN ${col}`) } catch {}
})

// ── Seed data (first run only) ─────────────────────────────────────────────────
const seeded = db.prepare("SELECT value FROM app_meta WHERE key = 'seeded'").get()
if (!seeded) {
  const ins = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status)
    VALUES (@name, @category, @colors, @occasions, @season, @notes, @status)
  `)
  const seedPieces = db.transaction(() => {
    const pieces = [
      // Tops
      { name: 'Whale stripe tee',        category: 'top',       colors: '["navy","white"]',      occasions: '["casual"]',                         season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black sleeveless tank',   category: 'top',       colors: '["black"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: 'Replace with better quality version',          status: 'active' },
      { name: 'Daisy print tee',         category: 'top',       colors: '["white","yellow"]',    occasions: '["casual"]',                         season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Orange ribbed tank',      category: 'top',       colors: '["orange"]',            occasions: '["casual","home"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Botanical wrap top',      category: 'top',       colors: '["green","cream"]',     occasions: '["casual","smart-casual"]',           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Black blouse',            category: 'top',       colors: '["black"]',             occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Navy pinstripe shirt',    category: 'top',       colors: '["navy"]',              occasions: '["city","smart-casual"]',            season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Floral blouse',           category: 'top',       colors: '["multi"]',             occasions: '["city","smart-casual"]',            season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Striped button-down',     category: 'top',       colors: '["navy","white"]',      occasions: '["city"]',                           season: 'year-round', notes: 'Wear open as a layer over navy top',           status: 'active' },
      { name: 'Navy top',                category: 'top',       colors: '["navy"]',              occasions: '["city","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black button-detail top', category: 'top',       colors: '["black"]',             occasions: '["evening","city"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cashmere tee',            category: 'top',       colors: '["grey"]',              occasions: '["smart-casual","casual"]',          season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Fitted Breton tee',       category: 'top',       colors: '["navy","white"]',      occasions: '["smart-casual","casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black tank',              category: 'top',       colors: '["black"]',             occasions: '["outdoor","casual","home"]',        season: 'warm',       notes: 'Base layer',                                   status: 'active' },
      { name: 'Navy graphic tee',        category: 'top',       colors: '["navy"]',              occasions: '["home","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Plum cap-sleeve top',     category: 'top',       colors: '["plum"]',              occasions: '["home","casual"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      // Bottoms
      { name: 'Dark jeans',              category: 'bottom',    colors: '["dark blue"]',         occasions: '["casual","city","evening","smart-casual"]', season: 'year-round', notes: '',                                    status: 'active' },
      { name: 'Orange pink floral mini skirt', category: 'bottom', colors: '["orange","pink"]', occasions: '["casual"]',                         season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Emerald green pants',     category: 'bottom',    colors: '["green"]',             occasions: '["casual"]',                         season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cream wide-leg pants',    category: 'bottom',    colors: '["cream"]',             occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Mustard corduroy skinnies', category: 'bottom', colors: '["mustard"]',            occasions: '["casual","smart-casual"]',          season: 'cool',       notes: 'Zipper needs repair',                          status: 'needs-repair' },
      { name: 'Cream cropped wide-leg pants', category: 'bottom', colors: '["cream"]',           occasions: '["city"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Dark wide-leg pants',     category: 'bottom',    colors: '["dark grey"]',         occasions: '["city","smart-casual","evening"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Cream knit skirt',        category: 'bottom',    colors: '["cream"]',             occasions: '["city"]',                           season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Light grey denim',        category: 'bottom',    colors: '["light grey"]',        occasions: '["evening","casual"]',               season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Grey lace-waist pants',   category: 'bottom',    colors: '["grey"]',              occasions: '["smart-casual"]',                   season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Brown-cream midi skirt',  category: 'bottom',    colors: '["brown","cream"]',     occasions: '["smart-casual"]',                   season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Dark fuller pants',       category: 'bottom',    colors: '["dark grey"]',         occasions: '["outdoor","casual"]',               season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Dark leggings',           category: 'bottom',    colors: '["black"]',             occasions: '["outdoor","home"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'White terry pants',       category: 'bottom',    colors: '["white"]',             occasions: '["home"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Floral leggings',         category: 'bottom',    colors: '["multi"]',             occasions: '["home"]',                           season: 'year-round', notes: '',                                             status: 'active' },
      // Dresses
      { name: 'Plum dress',              category: 'dress',     colors: '["plum"]',              occasions: '["evening"]',                        season: 'year-round', notes: 'Versatile — styles up or down easily',         status: 'active' },
      { name: 'Green maxi dress',        category: 'dress',     colors: '["green"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Charcoal ruched dress',   category: 'dress',     colors: '["charcoal"]',          occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      // Outerwear
      { name: 'Grey vest',               category: 'outerwear', colors: '["grey"]',              occasions: '["casual","smart-casual"]',          season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Leather jacket',          category: 'outerwear', colors: '["black"]',             occasions: '["evening","casual"]',               season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Oatmeal cardigan',        category: 'outerwear', colors: '["oatmeal"]',           occasions: '["evening","casual","city"]',        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Tweed vest',              category: 'outerwear', colors: '["brown","cream"]',     occasions: '["smart-casual"]',                   season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Plum hoodie',             category: 'outerwear', colors: '["plum"]',              occasions: '["outdoor"]',                        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Olive hoodie',            category: 'outerwear', colors: '["olive"]',             occasions: '["outdoor","casual"]',               season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Cream cardigan',          category: 'outerwear', colors: '["cream"]',             occasions: '["city","evening","casual"]',        season: 'cool',       notes: '',                                             status: 'active' },
      // Shoes
      { name: 'White sneakers',          category: 'shoes',     colors: '["white"]',             occasions: '["casual","smart-casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Black sandals',           category: 'shoes',     colors: '["black"]',             occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Brown ankle boots',       category: 'shoes',     colors: '["brown"]',             occasions: '["casual","smart-casual","city","evening"]', season: 'cool', notes: '',                                          status: 'active' },
      { name: 'Black mules',             category: 'shoes',     colors: '["black"]',             occasions: '["city","evening"]',                 season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Black flats',             category: 'shoes',     colors: '["black"]',             occasions: '["city","smart-casual","evening"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Tan ankle boots',         category: 'shoes',     colors: '["tan"]',               occasions: '["evening","smart-casual","city"]',  season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Navy slip-ons',           category: 'shoes',     colors: '["navy"]',              occasions: '["smart-casual","casual"]',          season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Flat sandals',            category: 'shoes',     colors: '["brown"]',             occasions: '["smart-casual","casual"]',          season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Hiking boots',            category: 'shoes',     colors: '["brown"]',             occasions: '["outdoor"]',                        season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Flip-flops',              category: 'shoes',     colors: '["tan"]',               occasions: '["home"]',                           season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Platform sandals',        category: 'shoes',     colors: '["tan"]',               occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Grey pointed flats',      category: 'shoes',     colors: '["grey"]',              occasions: '["city","evening"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Taupe sneakers',          category: 'shoes',     colors: '["tan"]',               occasions: '["home","casual"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      // Accessories
      { name: 'Red/orange crossbody bag',   category: 'accessory', colors: '["red","orange"]',  occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Amber pendant necklace',     category: 'accessory', colors: '["amber"]',          occasions: '["city","evening","smart-casual"]',  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Green beaded necklace',      category: 'accessory', colors: '["green"]',          occasions: '["evening","city"]',                 season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Turquoise pendant',          category: 'accessory', colors: '["turquoise"]',      occasions: '["casual","city"]',                  season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Colorful loop scarf',        category: 'accessory', colors: '["multi"]',          occasions: '["casual","city","evening"]',        season: 'cool',       notes: '',                                             status: 'active' },
      { name: 'Brown leather belt',         category: 'accessory', colors: '["brown"]',          occasions: '["smart-casual","city"]',            season: 'year-round', notes: '',                                             status: 'active' },
      { name: 'Woven/rattan crossbody bag', category: 'accessory', colors: '["tan","brown"]',    occasions: '["casual","city"]',                  season: 'warm',       notes: '',                                             status: 'active' },
      { name: 'Green bucket hat',           category: 'accessory', colors: '["green"]',          occasions: '["outdoor"]',                        season: 'warm',       notes: '',                                             status: 'active' },
    ]
    pieces.forEach(p => ins.run(p))
  })
  seedPieces()

  const insTodo = db.prepare('INSERT INTO todos (type, description) VALUES (@type, @description)')
  ;[
    { type: 'repair',   description: 'Fix zipper on mustard corduroy skinnies' },
    { type: 'shopping', description: 'Replace worn black sleeveless tank with better quality version — fitted, structured, not clingy' },
    { type: 'donate',   description: 'Consider donating: grey tunic' },
    { type: 'donate',   description: 'Consider donating: olive drapey tank' },
    { type: 'donate',   description: 'Consider donating: worn black tank' },
    { type: 'shopping', description: 'Shop for: tan/cognac flat mule sandal' },
    { type: 'shopping', description: 'Shop for: quality black sleeveless top (fitted, structured, not clingy)' },
  ].forEach(t => insTodo.run(t))

  db.prepare("INSERT INTO app_meta (key, value) VALUES ('seeded', 'true')").run()
  console.log('✓ Wardrobe seeded with sample data')
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))
app.use('/uploads', express.static(uploadsDir))
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')))
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const parsePiece = p => p ? ({
  ...p,
  colors:                JSON.parse(p.colors                || '[]'),
  occasions:             JSON.parse(p.occasions             || '[]'),
  occasion_permissions:   JSON.parse(p.occasion_permissions  || '[]'),
  styling_rules_learned: JSON.parse(p.styling_rules_learned || '[]'),
  pairs_well_with:       JSON.parse(p.pairs_well_with       || '[]'),
  tried_and_rejected:    JSON.parse(p.tried_and_rejected    || '[]'),
  recommendation_status: p.recommendation_status || 'trusted',
  fit_confidence:        p.fit_confidence        || 'unknown',
  role_permission:       p.role_permission       || 'auto',
  engine_notes:          p.engine_notes          || '',
  favorite: Boolean(p.favorite)
}) : null

function computeTuckNote(p) {
  if (!p.category || !['top','dress','outerwear'].includes(p.category)) return null
  if (p.tuck_behavior === 'wear_over_only') return 'no tuck — wear over only'
  if (p.fabric_category === 'silk' || p.fabric_category === 'satin') return 'no tuck — silk/satin cannot hold'
  if (p.hem_finish === 'ribbed' || p.hem_finish === 'design_hem') return 'no tuck — design hem'
  if (p.tuck_behavior === 'tucks_with_structure') return 'tucks with structured waist or belt only'
  if (p.tuck_behavior === 'tucks_anywhere') return 'tucks freely'
  return null
}

function computeWaistbandNote(p) {
  if (p.category !== 'bottom') return null
  if (p.waistband_type === 'tight_no_room') return 'tight waistband — no tuck'
  if (p.waistband_type === 'soft_elastic_pull_on') return 'elastic waist — no tuck'
  if (p.waistband_type === 'structured_high_waist') return 'structured high waist — receives tuck'
  if (p.waistband_type === 'structured_mid_waist') return 'structured mid waist — receives tuck'
  if (p.waistband_type === 'drawstring_relaxed') return 'drawstring — no tuck'
  return null
}

function buildPieceText(p) {
  const parts = []
  // Visual identity
  if (p.background_color) parts.push(`background: ${p.background_color}`)
  if (p.reads_as) parts.push(`reads as: ${p.reads_as}`)
  else if (p.colors?.length) parts.push(p.colors.join('/'))
  // Pattern
  if (p.pattern_complexity && p.pattern_complexity !== 'solid') {
    const pat = [p.pattern_type, p.pattern_scale, p.pattern_complexity].filter(Boolean).join('/')
    parts.push(`pattern: ${pat}`)
  }
  // Construction
  if (p.hem_finish) parts.push(`hem: ${p.hem_finish}`)
  if (p.length_hits_at) parts.push(`hits at: ${p.length_hits_at}`)
  if (p.silhouette) parts.push(`silhouette: ${p.silhouette}`)
  if (p.fabric_category) parts.push(`fabric: ${p.fabric_category}${p.fabric_weight ? '/'+p.fabric_weight : ''}`)
  // Fit
  if (p.fit_on_body) parts.push(`fit: ${p.fit_on_body}`)
  // Tuck / waistband
  const tuck = computeTuckNote(p) || computeWaistbandNote(p)
  if (tuck) parts.push(tuck)
  // Occasion/season
  if (p.occasions?.length) parts.push(p.occasions.join(', '))
  if (p.status && p.status !== 'active') parts.push(`⚠ ${p.status}`)
  if (p.recommendation_status && p.recommendation_status !== 'trusted') parts.push(`recommendation trust: ${p.recommendation_status}`)
  if (p.fit_confidence && p.fit_confidence !== 'unknown') parts.push(`fit confidence: ${p.fit_confidence}`)
  if (p.role_permission && p.role_permission !== 'auto') parts.push(`auto-styling role: ${p.role_permission}`)
  if (p.occasion_permissions?.length) parts.push(`auto occasions: ${p.occasion_permissions.join(', ')}`)
  if (p.engine_notes) parts.push(`engine note: ${p.engine_notes}`)
  if (p.notes) parts.push(`note: ${p.notes}`)

  let text = `• ${p.name} (${p.category} | ${parts.join(' | ')})`

  // Styling rules — listed separately as AUTHORITATIVE constraints
  if (p.styling_rules_learned?.length) {
    text += `\n  RULES (authoritative): ${p.styling_rules_learned.join(' | ')}`
  }
  if (p.tried_and_rejected?.length) {
    text += `\n  REJECTED: ${p.tried_and_rejected.join(' | ')}`
  }
  if (p.pairs_well_with?.length) {
    text += `\n  PAIRS WITH: ${p.pairs_well_with.join(', ')}`
  }

  return text
}


function buildOutfitText(outfit, linkedPieces = []) {
  const lines = [
    `Outfit: "${outfit.name}"`,
    outfit.occasion ? `Occasion: ${outfit.occasion}` : '',
    outfit.season ? `Season: ${outfit.season}` : '',
    outfit.status ? `Status: ${outfit.status}` : '',
    outfit.notes ? `Styling notes: ${outfit.notes}` : '',
    linkedPieces.length ? `Linked garment truth:\n${linkedPieces.map(buildPieceText).join('\n')}` : 'Linked garment truth: none saved for this outfit yet'
  ].filter(Boolean)
  return lines.join('\n')
}


function buildOutfitAuthorityNote(outfit, linkedPieces = [], likelyPieces = []) {
  const status = String(outfit.status || '').toLowerCase()
  const isConfirmed = status === 'confirmed' || Boolean(outfit.favorite)
  const lines = []

  if (linkedPieces.length) {
    lines.push('AUTHORITY NOTE: This outfit has linked garment records. Treat linked garment truth as higher authority than the image. Do not rename, replace, or visually reinterpret linked pieces unless the user explicitly says the record is wrong.')
  } else {
    lines.push('AUTHORITY NOTE: No linked garment records are saved for this outfit yet. Image/title analysis is lower confidence. Avoid strong garment-identity claims and avoid recommending replacement of core pieces based only on a visual guess.')
  }

  if (isConfirmed) {
    lines.push('STATUS NOTE: This outfit is marked confirmed/favorite. Start from the assumption that the core outfit has worked for Yuna. Explain WHY it works first. Suggest only minor refinements unless the user asks for alternatives.')
  } else if (status === 'rejected') {
    lines.push('STATUS NOTE: This outfit is marked rejected. Diagnose what likely failed, but keep the critique garment-focused and practical.')
  } else {
    lines.push('STATUS NOTE: This outfit appears to be testing/uncertain. Evaluate openly, but still prefer small adjustments before replacing garments.')
  }

  if (likelyPieces.length && !linkedPieces.length) {
    lines.push('LIKELY-PIECE NOTE: The app inferred possible saved pieces from the outfit name/notes. Use them cautiously as hints, not confirmed truth. If the answer depends on them, say that linking the actual pieces would improve precision.')
  }

  lines.push('MEMORY NOTE: If the outfit is confirmed, the Saveable learning should capture the formula that works. If it is testing/rejected, the Saveable learning should capture the condition or problem to remember.')
  return lines.join('\n')
}

function getLinkedPiecesForOutfit(outfitId) {
  return db.prepare(`
    SELECT p.* FROM pieces p
    JOIN outfit_pieces op ON p.id = op.piece_id
    WHERE op.outfit_id = ?
    ORDER BY p.category, p.name
  `).all(outfitId).map(parsePiece)
}

function getConfirmedOutfitMemory(limit = 8) {
  const outfits = db.prepare(`
    SELECT * FROM outfits
    WHERE status = 'confirmed' OR favorite = 1
    ORDER BY favorite DESC, date_added DESC
    LIMIT ?
  `).all(limit)

  return outfits.map(o => buildOutfitText(o, getLinkedPiecesForOutfit(o.id))).join('\n\n')
}

function findLikelyPiecesForOutfit(outfit, limit = 12) {
  const text = `${outfit.name || ''} ${outfit.notes || ''}`.toLowerCase()
  const pieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY favorite DESC, date_added DESC").all().map(parsePiece)
  const stop = new Set(['the','and','with','plus','outfit','look','top','pants','jeans','skirt','dress','shoes','boots','shirt','blouse','sweater','knit','sleeve','sleeves','casual','year','round'])
  const tokens = text.split(/[^a-z0-9]+/).filter(t => t.length > 2 && !stop.has(t))

  const scored = pieces.map(piece => {
    const hay = [
      piece.name, piece.category, piece.colors?.join(' '), piece.reads_as, piece.fabric_category,
      piece.silhouette, piece.notes, piece.pairs_well_with?.join(' '), piece.styling_rules_learned?.join(' ')
    ].filter(Boolean).join(' ').toLowerCase()
    let score = 0
    for (const t of tokens) if (hay.includes(t)) score += 3
    if (piece.favorite) score += 2
    if (text.includes('jeans') && /jean|denim/.test(hay)) score += 5
    if (text.includes('hoodie') && /hoodie|sweatshirt/.test(hay)) score += 5
    if (text.includes('knit') && /knit|sweater|crochet/.test(hay)) score += 3
    if (text.includes('sleeve') && /sleeve/.test(hay)) score += 3
    if (text.includes('boyfriend') && /boyfriend/.test(hay)) score += 6
    return { piece, score }
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score)

  return scored.slice(0, limit).map(x => x.piece)
}

// ── Pieces API ─────────────────────────────────────────────────────────────────
app.get('/api/pieces', (req, res) => {
  const { category, occasion, season, status, search, favorites } = req.query
  let q = 'SELECT * FROM pieces WHERE 1=1'
  const params = []
  if (category)  { q += ' AND category = ?';              params.push(category) }
  if (season && season !== 'all') { q += ' AND (season = ? OR season = "year-round")'; params.push(season) }
  if (status)    { q += ' AND status = ?';                params.push(status) }
  if (search)    { q += ' AND name LIKE ?';               params.push(`%${search}%`) }
  if (occasion)  { q += ' AND occasions LIKE ?';          params.push(`%"${occasion}"%`) }
  if (favorites === 'true') { q += ' AND favorite = 1' }
  q += ' ORDER BY favorite DESC, date_added DESC'
  res.json(db.prepare(q).all(...params).map(parsePiece))
})

app.get('/api/pieces/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  res.json(parsePiece(p))
})

app.post('/api/pieces', upload.fields([{ name: 'photo' }, { name: 'worn_photo' }]), (req, res) => {
  const { name, category, colors, occasions, season, notes, status,
    recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes,
    pattern_type, pattern_scale, pattern_complexity, reads_as, background_color, hem_finish,
    neckline, sleeve_type, length_hits_at, silhouette,
    fabric_category, fabric_weight, stretch,
    fit_on_body, tuck_behavior, waistband_type,
    styling_rules_learned, pairs_well_with, tried_and_rejected } = req.body
  const photo      = req.files?.photo?.[0]?.filename || null
  const worn_photo = req.files?.worn_photo?.[0]?.filename || null
  const r = db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, season, notes, status, photo, worn_photo,
      recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes,
      pattern_type, pattern_scale, pattern_complexity, reads_as, background_color, hem_finish,
      neckline, sleeve_type, length_hits_at, silhouette,
      fabric_category, fabric_weight, stretch, fit_on_body, tuck_behavior, waistband_type,
      styling_rules_learned, pairs_well_with, tried_and_rejected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, category, colors||'[]', occasions||'[]', season||'year-round', notes||'', status||'active', photo, worn_photo,
    recommendation_status||'trusted', fit_confidence||'unknown', role_permission||'auto', occasion_permissions||'[]', engine_notes||'',
    pattern_type||null, pattern_scale||null, pattern_complexity||null, reads_as||null, background_color||null, hem_finish||null,
    neckline||null, sleeve_type||null, length_hits_at||null, silhouette||null,
    fabric_category||null, fabric_weight||null, stretch||null, fit_on_body||null, tuck_behavior||null, waistband_type||null,
    styling_rules_learned||'[]', pairs_well_with||'[]', tried_and_rejected||'[]')
  res.json(parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(r.lastInsertRowid)))
})

app.put('/api/pieces/:id', upload.fields([{ name: 'photo' }, { name: 'worn_photo' }]), (req, res) => {
  const existing = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const { name, category, colors, occasions, season, notes, status, favorite, clear_photo, clear_worn_photo,
    recommendation_status, fit_confidence, role_permission, occasion_permissions, engine_notes,
    pattern_type, pattern_scale, pattern_complexity, reads_as, background_color, hem_finish,
    neckline, sleeve_type, length_hits_at, silhouette,
    fabric_category, fabric_weight, stretch,
    fit_on_body, tuck_behavior, waistband_type,
    styling_rules_learned, pairs_well_with, tried_and_rejected } = req.body
  const photo      = req.files?.photo?.[0]?.filename      || (clear_photo      === 'true' ? null : existing.photo)
  const worn_photo = req.files?.worn_photo?.[0]?.filename  || (clear_worn_photo === 'true' ? null : existing.worn_photo)
  db.prepare(`
    UPDATE pieces SET name=?,category=?,colors=?,occasions=?,season=?,notes=?,status=?,favorite=?,photo=?,worn_photo=?,
      recommendation_status=?,fit_confidence=?,role_permission=?,occasion_permissions=?,engine_notes=?,
      pattern_type=?,pattern_scale=?,pattern_complexity=?,reads_as=?,background_color=?,hem_finish=?,
      neckline=?,sleeve_type=?,length_hits_at=?,silhouette=?,
      fabric_category=?,fabric_weight=?,stretch=?,fit_on_body=?,tuck_behavior=?,waistband_type=?,
      styling_rules_learned=?,pairs_well_with=?,tried_and_rejected=?
    WHERE id=?
  `).run(name, category, colors||'[]', occasions||'[]', season||'year-round', notes||'', status||'active',
    favorite==='true'?1:0, photo, worn_photo,
    recommendation_status||'trusted', fit_confidence||'unknown', role_permission||'auto', occasion_permissions||'[]', engine_notes||'',
    pattern_type||null, pattern_scale||null, pattern_complexity||null, reads_as||null, background_color||null, hem_finish||null,
    neckline||null, sleeve_type||null, length_hits_at||null, silhouette||null,
    fabric_category||null, fabric_weight||null, stretch||null, fit_on_body||null, tuck_behavior||null, waistband_type||null,
    styling_rules_learned||'[]', pairs_well_with||'[]', tried_and_rejected||'[]',
    req.params.id)
  res.json(parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)))
})

app.delete('/api/pieces/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  if (p.photo) { const fp = path.join(uploadsDir, p.photo); if (fs.existsSync(fp)) fs.unlinkSync(fp) }
  db.prepare('DELETE FROM pieces WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

app.patch('/api/pieces/:id/favorite', (req, res) => {
  const p = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Not found' })
  const newVal = p.favorite ? 0 : 1
  db.prepare('UPDATE pieces SET favorite = ? WHERE id = ?').run(newVal, req.params.id)
  res.json({ favorite: Boolean(newVal) })
})

// ── Outfits API ────────────────────────────────────────────────────────────────
app.get('/api/outfits', (req, res) => {
  const { occasion, season, favorites } = req.query
  let q = 'SELECT * FROM outfits WHERE 1=1'
  const params = []
  if (occasion) { q += ' AND occasion = ?'; params.push(occasion) }
  if (season && season !== 'all') { q += ' AND (season = ? OR season = "year-round")'; params.push(season) }
  if (favorites === 'true') { q += ' AND favorite = 1' }
  q += ' ORDER BY favorite DESC, date_added DESC'

  const outfits = db.prepare(q).all(...params)
  const result = outfits.map(o => {
    const pieces = db.prepare(`
      SELECT p.* FROM pieces p JOIN outfit_pieces op ON p.id = op.piece_id WHERE op.outfit_id = ?
    `).all(o.id).map(parsePiece)
    return { ...o, favorite: Boolean(o.favorite), pieces }
  })
  res.json(result)
})

app.post('/api/outfits', upload.single('photo'), (req, res) => {
  const { name, occasion, season, notes, status, pieceIds } = req.body
  const photo = req.file?.filename || null
  const r = db.prepare(`
    INSERT INTO outfits (name, occasion, season, notes, status, photo) VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, occasion||'casual', season||'year-round', notes||'', status||'confirmed', photo)
  const outfitId = r.lastInsertRowid
  if (pieceIds) {
    const insLink = db.prepare('INSERT OR IGNORE INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)')
    JSON.parse(pieceIds).forEach(pid => insLink.run(outfitId, pid))
  }
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitId)
  res.json({ ...o, favorite: Boolean(o.favorite), pieces: [] })
})

app.put('/api/outfits/:id', upload.single('photo'), (req, res) => {
  const existing = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const { name, occasion, season, notes, status, favorite, pieceIds } = req.body
  const photo = req.file?.filename || existing.photo
  db.prepare(`
    UPDATE outfits SET name=?,occasion=?,season=?,notes=?,status=?,favorite=?,photo=? WHERE id=?
  `).run(name, occasion||'casual', season||'year-round', notes||'', status||'confirmed', favorite==='true'?1:0, photo, req.params.id)
  if (pieceIds) {
    db.prepare('DELETE FROM outfit_pieces WHERE outfit_id = ?').run(req.params.id)
    const insLink = db.prepare('INSERT OR IGNORE INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)')
    JSON.parse(pieceIds).forEach(pid => insLink.run(req.params.id, pid))
  }
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  const pieces = db.prepare(`SELECT p.* FROM pieces p JOIN outfit_pieces op ON p.id = op.piece_id WHERE op.outfit_id = ?`).all(req.params.id).map(parsePiece)
  res.json({ ...o, favorite: Boolean(o.favorite), pieces })
})

app.delete('/api/outfits/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!o) return res.status(404).json({ error: 'Not found' })
  if (o.photo) { const fp = path.join(uploadsDir, o.photo); if (fs.existsSync(fp)) fs.unlinkSync(fp) }
  db.prepare('DELETE FROM outfits WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

app.patch('/api/outfits/:id/favorite', (req, res) => {
  const o = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!o) return res.status(404).json({ error: 'Not found' })
  const newVal = o.favorite ? 0 : 1
  db.prepare('UPDATE outfits SET favorite = ? WHERE id = ?').run(newVal, req.params.id)
  res.json({ favorite: Boolean(newVal) })
})

app.get('/api/pieces/:id/outfits', (req, res) => {
  const outfits = db.prepare(`
    SELECT o.* FROM outfits o
    JOIN outfit_pieces op ON o.id = op.outfit_id
    WHERE op.piece_id = ?
    ORDER BY o.date_added DESC
  `).all(req.params.id)
  res.json(outfits.map(o => ({ ...o, favorite: Boolean(o.favorite) })))
})

app.put('/api/outfits/:id/pieces', (req, res) => {
  const { pieceIds } = req.body
  db.prepare('DELETE FROM outfit_pieces WHERE outfit_id = ?').run(req.params.id)
  const ins = db.prepare('INSERT OR IGNORE INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)')
  ;(pieceIds || []).forEach(pid => ins.run(req.params.id, pid))
  res.json({ success: true })
})

app.patch('/api/pieces/:id/append-note', (req, res) => {
  const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
  if (!piece) return res.status(404).json({ error: 'Not found' })
  const { text } = req.body
  const existing = JSON.parse(piece.styling_rules_learned || '[]')
  const updated  = [...existing, text.trim()]
  db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?').run(JSON.stringify(updated), req.params.id)
  res.json({ styling_rules_learned: updated })
})

app.patch('/api/outfits/:id/append-note', (req, res) => {
  const outfit = db.prepare('SELECT * FROM outfits WHERE id = ?').get(req.params.id)
  if (!outfit) return res.status(404).json({ error: 'Not found' })
  const { text } = req.body
  const existing = outfit.notes || ''
  const separator = existing.trim() ? '\n\n' : ''
  const updated = existing + separator + '— Stylist: ' + text.trim()
  db.prepare('UPDATE outfits SET notes = ? WHERE id = ?').run(updated, req.params.id)
  res.json({ notes: updated })
})


// ── Stylist feedback / learning API ───────────────────────────────────────────
app.post('/api/stylist-feedback', (req, res) => {
  try {
    const {
      feedbackType,
      targetType = 'message',
      contextType = null,
      contextId = null,
      contextName = '',
      label = '',
      note = '',
      payload = {},
      appendToPiece = false,
    } = req.body || {}

    if (!feedbackType) return res.status(400).json({ error: 'feedbackType is required' })

    const result = db.prepare(`
      INSERT INTO stylist_feedback
      (feedback_type, target_type, context_type, context_id, context_name, label, note, payload, is_gold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedbackType,
      targetType,
      contextType,
      contextId ? Number(contextId) : null,
      contextName || '',
      label || '',
      note || '',
      JSON.stringify(payload || {}),
      feedbackType === 'signature' ? 1 : 0
    )

    // High-signal feedback can optionally become garment memory immediately.
    // Keep it compact and factual so it does not pollute future prompts.
    if (appendToPiece && contextType === 'piece' && contextId) {
      const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(contextId)
      if (piece) {
        const existing = JSON.parse(piece.styling_rules_learned || '[]')
        const feedbackLabel = label ? ` (${label})` : ''
        const memory = `[feedback:${feedbackType}]${feedbackLabel} ${note || ''}`.trim()
        if (memory && !existing.includes(memory)) {
          db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?')
            .run(JSON.stringify([...existing, memory]), contextId)
        }
      }
    }

    const learningMessages = {
      signature: 'Learning saved: boosting this as a signature direction. The board itself is not saved unless you click Save board.',
      works: 'Learning saved: boosting similar outfit logic. The board itself is not saved unless you click Save board.',
      good_formula: 'Learning saved: boosting this formula without overcommitting to every exact piece.',
      good_pieces: 'Learning saved: these pieces look promising together.',
      almost: 'Learning saved: treating this as close but not fully solved.',
      not_me: 'Learning saved: reducing this direction for future suggestions.',
      bad_occasion: 'Learning saved: reducing this formula for this occasion.',
      fit_issue: 'Learning saved: treating this as a fit-risk combination.',
      too_safe: 'Learning saved: reducing safe/over-balanced styling.',
      too_generic: 'Learning saved: reducing generic outfit logic.',
      too_soft: 'Learning saved: reducing excessive softness.',
      wrong_proportions: 'Learning saved: avoiding this proportion behavior.',
      wrong_silhouette: 'Learning saved: this silhouette is wrong for this selected piece/board, not a global silhouette ban.',
      catalog_drift: 'Learning saved: reducing catalog/mature-casual drift.',
      weak_structure: 'Learning saved: requiring stronger structure next time.',
      weak_contrast: 'Learning saved: requiring clearer contrast/tension next time.',
      bad_grounding: 'Learning saved: improving shoe/grounding logic next time.',
      bad_reference: 'Learning saved: using this as a negative reference.'
    }

    res.json({ success: true, id: result.lastInsertRowid, learningMessage: learningMessages[feedbackType] || 'Learning saved.' })
  } catch (err) {
    console.error('Stylist feedback error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/stylist-feedback', (req, res) => {
  const { contextType, contextId, limit = 100, includeArchived = 'false' } = req.query
  const clauses = []
  const params = []
  if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
  if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
  if (includeArchived !== 'true') clauses.push('COALESCE(archived,0) = 0')
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`
    SELECT * FROM stylist_feedback
    ${where}
    ORDER BY COALESCE(is_gold,0) DESC, id DESC
    LIMIT ?
  `).all(...params, Number(limit))
  res.json(rows.map(r => ({ ...r, is_gold: Boolean(r.is_gold), archived: Boolean(r.archived), payload: safeJsonParse(r.payload, {}) })))
})

app.patch('/api/stylist-feedback/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Feedback not found' })
    const { isGold, archived, note, label } = req.body || {}
    const next = {
      is_gold: typeof isGold === 'boolean' ? (isGold ? 1 : 0) : row.is_gold || 0,
      archived: typeof archived === 'boolean' ? (archived ? 1 : 0) : row.archived || 0,
      note: typeof note === 'string' ? note : row.note,
      label: typeof label === 'string' ? label : row.label,
    }
    db.prepare('UPDATE stylist_feedback SET is_gold = ?, archived = ?, note = ?, label = ? WHERE id = ?')
      .run(next.is_gold, next.archived, next.note, next.label, req.params.id)
    const updated = db.prepare('SELECT * FROM stylist_feedback WHERE id = ?').get(req.params.id)
    res.json({ ...updated, is_gold: Boolean(updated.is_gold), archived: Boolean(updated.archived), payload: safeJsonParse(updated.payload, {}) })
  } catch (err) {
    console.error('Update stylist feedback error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/stylist-feedback/:id', (req, res) => {
  try {
    db.prepare('UPDATE stylist_feedback SET archived = 1 WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('Archive stylist feedback error:', err)
    res.status(500).json({ error: err.message })
  }
})



// ── Renderer calibration image library API ───────────────────────────────────
app.post('/api/calibration-images', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo is required' })
    const kind = String(req.body.kind || 'good_reference')
    const labels = safeJsonParse(req.body.labels, []) || []
    const notes = String(req.body.notes || '')
    const source = String(req.body.source || 'uploaded')
    const imageUrl = `/uploads/${req.file.filename}`

    const result = db.prepare(`
      INSERT INTO calibration_images (image_url, kind, labels, notes, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(imageUrl, kind, JSON.stringify(labels), notes, source)

    const row = db.prepare('SELECT * FROM calibration_images WHERE id = ?').get(result.lastInsertRowid)
    res.json(normalizeCalibrationRow(row))
  } catch (err) {
    console.error('Save calibration image error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/calibration-images', (req, res) => {
  try {
    const { kind, includeArchived = 'false', limit = 120 } = req.query
    const clauses = []
    const params = []
    if (kind) { clauses.push('kind = ?'); params.push(kind) }
    if (includeArchived !== 'true') clauses.push('COALESCE(archived,0) = 0')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT * FROM calibration_images
      ${where}
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))
    res.json(rows.map(normalizeCalibrationRow))
  } catch (err) {
    console.error('List calibration images error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/calibration-images/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM calibration_images WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Calibration image not found' })
    const labels = Array.isArray(req.body.labels) ? JSON.stringify(req.body.labels) : row.labels
    const notes = typeof req.body.notes === 'string' ? req.body.notes : row.notes
    const kind = typeof req.body.kind === 'string' ? req.body.kind : row.kind
    const favorite = typeof req.body.favorite === 'boolean' ? (req.body.favorite ? 1 : 0) : row.favorite
    const archived = typeof req.body.archived === 'boolean' ? (req.body.archived ? 1 : 0) : row.archived
    db.prepare('UPDATE calibration_images SET kind = ?, labels = ?, notes = ?, favorite = ?, archived = ? WHERE id = ?')
      .run(kind, labels, notes, favorite, archived, req.params.id)
    res.json(normalizeCalibrationRow(db.prepare('SELECT * FROM calibration_images WHERE id = ?').get(req.params.id)))
  } catch (err) {
    console.error('Update calibration image error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/calibration-images/:id', (req, res) => {
  try {
    db.prepare('UPDATE calibration_images SET archived = 1 WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('Archive calibration image error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Saved outfit/editorial boards API ─────────────────────────────────────────
app.post('/api/saved-boards', (req, res) => {
  try {
    const {
      boardType = 'wardrobe',
      contextType = null,
      contextId = null,
      contextName = '',
      title = '',
      imageUrl = '',
      pieces = [],
      missingPieces = [],
      reason = '',
      watchFor = '',
      payload = {},
      favorite = false,
    } = req.body || {}

    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' })

    const result = db.prepare(`
      INSERT INTO saved_boards
      (board_type, context_type, context_id, context_name, title, image_url, pieces, missing_pieces, reason, watch_for, payload, favorite)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      boardType || 'wardrobe',
      contextType || null,
      contextId ? Number(contextId) : null,
      contextName || '',
      title || '',
      imageUrl,
      JSON.stringify(pieces || []),
      JSON.stringify(missingPieces || []),
      reason || '',
      watchFor || '',
      JSON.stringify(payload || {}),
      favorite ? 1 : 0
    )

    const saved = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(result.lastInsertRowid)
    res.json({
      ...saved,
      favorite: Boolean(saved.favorite),
      archived: Boolean(saved.archived),
      pieces: safeJsonParse(saved.pieces, []),
      missing_pieces: safeJsonParse(saved.missing_pieces, []),
      payload: safeJsonParse(saved.payload, {})
    })
  } catch (err) {
    console.error('Save board error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/saved-boards', (req, res) => {
  try {
    const { contextType, contextId, limit = 100, includeArchived = 'false' } = req.query
    const clauses = []
    const params = []
    if (contextType) { clauses.push('context_type = ?'); params.push(contextType) }
    if (contextId) { clauses.push('context_id = ?'); params.push(Number(contextId)) }
    if (includeArchived !== 'true') clauses.push('COALESCE(archived,0) = 0')
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT * FROM saved_boards
      ${where}
      ORDER BY COALESCE(favorite,0) DESC, id DESC
      LIMIT ?
    `).all(...params, Number(limit))
    res.json(rows.map(row => ({
      ...row,
      favorite: Boolean(row.favorite),
      archived: Boolean(row.archived),
      pieces: safeJsonParse(row.pieces, []),
      missing_pieces: safeJsonParse(row.missing_pieces, []),
      payload: safeJsonParse(row.payload, {})
    })))
  } catch (err) {
    console.error('List saved boards error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/saved-boards/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Saved board not found' })
    const { favorite, archived, title, reason, watchFor, feedbackLabel, feedbackLabels } = req.body || {}
    const payload = safeJsonParse(row.payload, {}) || {}
    let nextFeedbackLabels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    if (Array.isArray(feedbackLabels)) {
      nextFeedbackLabels = [...new Set(feedbackLabels.map(x => String(x || '').trim()).filter(Boolean))]
    } else if (typeof feedbackLabel === 'string' && feedbackLabel.trim()) {
      const label = feedbackLabel.trim()
      nextFeedbackLabels = nextFeedbackLabels.includes(label)
        ? nextFeedbackLabels.filter(x => x !== label)
        : [...nextFeedbackLabels, label]
    }
    const nextPayload = { ...payload, feedback_labels: nextFeedbackLabels }
    const next = {
      favorite: typeof favorite === 'boolean' ? (favorite ? 1 : 0) : row.favorite || 0,
      archived: typeof archived === 'boolean' ? (archived ? 1 : 0) : row.archived || 0,
      title: typeof title === 'string' ? title : row.title,
      reason: typeof reason === 'string' ? title : row.reason,
      watch_for: typeof watchFor === 'string' ? watchFor : row.watch_for,
      payload: JSON.stringify(nextPayload),
    }
    // Preserve the reason unless explicitly changed; the line above cannot use title.
    next.reason = typeof reason === 'string' ? reason : row.reason
    db.prepare('UPDATE saved_boards SET favorite = ?, archived = ?, title = ?, reason = ?, watch_for = ?, payload = ? WHERE id = ?')
      .run(next.favorite, next.archived, next.title, next.reason, next.watch_for, next.payload, req.params.id)
    const updated = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(req.params.id)
    res.json({
      ...updated,
      favorite: Boolean(updated.favorite),
      archived: Boolean(updated.archived),
      pieces: safeJsonParse(updated.pieces, []),
      missing_pieces: safeJsonParse(updated.missing_pieces, []),
      payload: safeJsonParse(updated.payload, {})
    })
  } catch (err) {
    console.error('Update saved board error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/saved-boards/:id', (req, res) => {
  try {
    db.prepare('UPDATE saved_boards SET archived = 1 WHERE id = ?').run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    console.error('Archive saved board error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Todos API ──────────────────────────────────────────────────────────────────
app.get('/api/todos', (req, res) => {
  const todos = db.prepare('SELECT * FROM todos ORDER BY completed ASC, id ASC').all()
  res.json(todos.map(t => ({ ...t, completed: Boolean(t.completed) })))
})

app.post('/api/todos', (req, res) => {
  const { type, description, linked_piece_id } = req.body
  const r = db.prepare('INSERT INTO todos (type, description, linked_piece_id) VALUES (?, ?, ?)').run(type, description, linked_piece_id||null)
  const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(r.lastInsertRowid)
  res.json({ ...t, completed: Boolean(t.completed) })
})

app.patch('/api/todos/:id/toggle', (req, res) => {
  const t = db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.id)
  if (!t) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE todos SET completed = ? WHERE id = ?').run(t.completed ? 0 : 1, req.params.id)
  res.json({ completed: !t.completed })
})

app.delete('/api/todos/:id', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// ── AI: Extract individual pieces from an outfit photo ────────────────────────
app.post('/api/ai/extract-pieces', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const raw = await askStylist({
      maxTokens: 800,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: `Look at this outfit photo and identify every clothing item and accessory visible.
Return ONLY a valid JSON object — no markdown, no explanation:
{
  "pieces": [
    {
      "name_suggestion": "short name 2-4 words, lowercase",
      "category": "top|bottom|dress|outerwear|shoes|accessory",
      "colors": ["use only: black, white, cream, beige, taupe, grey, charcoal, navy, denim, brown, tan, oatmeal, amber, mustard, orange, red, pink, plum, green, olive, turquoise, dark blue, dark grey, light grey, multi"],
      "occasions": ["use only: casual, city, evening, smart-casual, outdoor, home"],
      "season": "warm|cool|year-round"
    }
  ]
}` }
        ]
      }]
    })

    res.json(parseModelJson(raw))
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    console.error('Extract pieces error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Generate fit note from worn photo ─────────────────────────────────────
app.post('/api/ai/fit-note', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const { base64, mime } = await prepareImageForClaude(filePath)
    fs.unlinkSync(filePath)

    const { piece_name, piece_category } = req.body
    const isTop    = ['top','outerwear','dress'].includes(piece_category)
    const isBottom = piece_category === 'bottom'

    const focusLine = piece_name && piece_category
      ? `The piece being evaluated is: "${piece_name}" (${piece_category}). Focus your entire evaluation on this piece only — treat any other visible clothing as neutral context, not part of the assessment.`
      : 'Focus on the primary garment visible in this photo.'

    const schemaText = `Return ONLY a valid JSON object — no markdown, no explanation:
{
  "note": "2-4 sentence factual fit evaluation in lowercase covering: how it sits/drapes/clings on the body, any visible fit issues and whether they are prominent or absorbed by the print/color, where the eye goes, net verdict (works as-is / needs minor adjustment / needs different pairing)",
  "fit_on_body": "clings_stretchy|clings_drapey|skims|hangs_straight|drapes|structured",
  "length_hits_at": "crop|waist|hip|mid-thigh|knee|midi|maxi|full-length",
  ${isTop  ? '"tuck_behavior": "tucks_anywhere|tucks_with_structure|wear_over_only",' : ''}
  ${isBottom ? '"waistband_type": "structured_high_waist|structured_mid_waist|soft_elastic_pull_on|tight_no_room|drawstring_relaxed",' : ''}
  "silhouette": "fitted|slim|relaxed|boxy|A-line|drop-shoulder|oversized"
}`

    const raw = await askStylist({
      system: `Evaluate this try-on photo for fit of a specific garment. Focus ONLY on the clothing — do NOT assess facial expression, body language, apparent comfort, or confidence. Do not comment on the wearer's body or features.\n\n${focusLine}`,
      maxTokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: `Evaluate the fit of the ${piece_name || 'garment'} in this photo.\n\n${schemaText}` }
        ]
      }]
    })

    res.json(parseModelJson(raw))
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    console.error('Fit note error:', err)
    res.status(500).json({ error: err.message })
  }
})


const TAG_PIECE_PROMPT = `Analyze this clothing item hanger/flat-lay photo. Return ONLY a valid JSON object — no markdown, no explanation, just JSON:
{
  "name_suggestion": "descriptive name: [visual]+[pattern/texture]+[shape]+[length], 3-5 words, lowercase. e.g. 'bold multicolor floral knit top' or 'black cream botanical midi skirt'",
  "category": "top|bottom|dress|outerwear|shoes|accessory",
  "background_color": "the literal base/background color of the garment, e.g. black, navy, cream, white",
  "colors": ["only from: black, white, cream, beige, taupe, grey, charcoal, navy, denim, brown, tan, oatmeal, amber, mustard, orange, red, pink, plum, green, olive, turquoise, dark blue, dark grey, light grey, light blue, periwinkle, multi"],
  "occasions": ["only from: casual, city, evening, smart-casual, outdoor, home"],
  "season": "warm|cool|year-round",
  "pattern_type": "solid|floral|stripe|botanical|geometric|abstract|animal|graphic|plaid|other",
  "pattern_scale": "none|subtle|medium|bold",
  "pattern_complexity": "solid|quiet|medium|loud",
  "reads_as": "short phrase: the dominant visual impression",
  "hem_finish": "straight_loose|banded_elastic|ribbed|design_hem",
  "neckline": "V|scoop|crew|boat|mock|cowl|off-shoulder|square|wrap|other|none",
  "sleeve_type": "sleeveless|cap|short|3/4|long|bell|bishop|none",
  "length_hits_at": "crop|waist|hip|mid-thigh|knee|midi|maxi|full-length",
  "silhouette": "fitted|slim|relaxed|boxy|A-line|drop-shoulder|oversized",
  "fabric_category": "jersey|knit|linen|silk|satin|cotton|wool|denim|ponte|synthetic|fleece|other",
  "fabric_weight": "ultralight|light|medium|heavy",
  "_confidence": {
    "pattern_complexity": "high|medium|low",
    "reads_as": "high|medium|low",
    "silhouette": "high|medium|low",
    "fabric_category": "high|medium|low",
    "fabric_weight": "high|medium|low"
  }
}`

async function tagPieceWithProvider(filePath) {
  const { base64, mime } = await prepareImageForClaude(filePath)
  const payload = {
    system: 'You tag wardrobe items from hanger or flat-lay photos. Return only valid JSON matching the requested schema.',
    maxTokens: 700,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: TAG_PIECE_PROMPT }
      ]
    }]
  }

  // Normal tagging follows AI_PROVIDER.
  const raw = await askStylist(payload)
  return parseModelJson(raw)
}

// ── AI: Tag a piece from photo ─────────────────────────────────────────────────
app.post('/api/ai/tag-piece', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  const filePath = path.join(uploadsDir, req.file.filename)
  try {
    const tags = await tagPieceWithProvider(filePath)
    fs.unlinkSync(filePath) // don't keep temp file
    res.json(tags)
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    console.error('AI tag error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Retag an existing saved piece from its hanger photo using the selected AI provider, without changing the photo.
app.post('/api/ai/tag-piece-existing/:id', async (req, res) => {
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    if (!piece.photo) return res.status(400).json({ error: 'This piece has no hanger photo to tag' })

    const filePath = path.join(uploadsDir, piece.photo)
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Hanger photo file not found in uploads/' })

    const tags = await tagPieceWithProvider(filePath)
    res.json(tags)
  } catch (err) {
    console.error('AI retag error:', err)
    res.status(500).json({ error: err.message })
  }
})


// Backward-compatible alias for older frontend builds. This still follows AI_PROVIDER.
app.post('/api/ai/tag-piece-claude/:id', async (req, res) => {
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(req.params.id)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    if (!piece.photo) return res.status(400).json({ error: 'This piece has no hanger photo to tag' })

    const filePath = path.join(uploadsDir, piece.photo)
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Hanger photo file not found in uploads/' })

    const tags = await tagPieceWithProvider(filePath)
    res.json(tags)
  } catch (err) {
    console.error('AI retag error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Evaluate/style a saved piece by ID ───────────────────────────────────
app.post('/api/ai/evaluate-piece', async (req, res) => {
  const { pieceId, question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const parsedPiece = parsePiece(piece)
    const selectedStyleMode = isStyleSelectedQuestion(question)

    const relatedWardrobe = selectedStyleMode
      ? complementaryWardrobeFor(parsedPiece, allPieces)
      : allPieces.filter(p => p.id !== piece.id)
    const wardrobeText = relatedWardrobe.map(buildPieceText).join('\n')
    const confirmedOutfitsText = getConfirmedOutfitMemory()
    const selectedPieceOutfitsText = getOutfitsForPieceMemory(parsedPiece.id)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }

    if (selectedStyleMode) {
      content.push({ type: 'text', text: [
        `Mode: STYLE_SELECTED_ITEM`,
        categoryConstraintForSelectedPiece(parsedPiece),
        '',
        `Selected item — corrected garment truth. This overrides image guesses:`,
        buildPieceText(parsedPiece),
        '',
        selectedPieceOutfitsText ? `Saved outfits that already use this selected item:\n${selectedPieceOutfitsText}` : `Saved outfits using this selected item: none yet`,
        '',
        confirmedOutfitsText ? `General confirmed/favorite outfit memory for Yuna's taste filter:\n${confirmedOutfitsText}` : '',
        '',
        wardrobeText ? `Available wardrobe pieces that may be used as supporting items. Do not replace the selected item with these:\n${wardrobeText}` : '',
        '',
        `Few-shot quality examples:\n${STYLE_SELECTED_ITEM_FEW_SHOTS}`,
        '',
        `User question: ${question || 'How should I style this piece?'}`,
        '',
        `Final reminder: every outfit idea must include "${parsedPiece.name}". Use the ranked candidates as your wardrobe pool. If you choose a lower-ranked candidate, explain the visual reason.`
      ].filter(Boolean).join('\n') })

      const draft = await askStylist({
        system: STYLE_SELECTED_ITEM_SYSTEM,
        maxTokens: 1200,
        messages: [
          ...(history || []).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content }
        ]
      })
      const answer = await criticPassForSelectedItem({ selectedPiece: parsedPiece, draft, userQuestion: question })
      return res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'STYLE_SELECTED_ITEM' })
    }

    content.push({ type: 'text', text: [
      `Mode: evaluate_piece`,
      `Piece being evaluated — use these corrected records as truth:`,
      buildPieceText(parsedPiece),
      '',
      confirmedOutfitsText ? `Confirmed outfit memory:\n${confirmedOutfitsText}` : '',
      '',
      `Rest of active wardrobe for pairings:\n${wardrobeText}`,
      '',
      question || 'What can you tell me about this piece and how to style it?'
    ].filter(Boolean).join('\n') })

    const answer = await askStylist({
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })
    res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'evaluate_piece' })
  } catch (err) {
    console.error('Evaluate piece error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Evaluate a saved outfit by ID (photo already on disk) ─────────────────
app.post('/api/ai/evaluate-outfit', async (req, res) => {
  const { outfitId, question, history } = req.body
  const outfit = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitId)
  if (!outfit) return res.status(404).json({ error: 'Outfit not found' })

  try {
    const content = []
    if (outfit.photo) {
      const filePath = path.join(uploadsDir, outfit.photo)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }

    const linkedPieces = getLinkedPiecesForOutfit(outfitId)
    const likelyPieces = linkedPieces.length ? [] : findLikelyPiecesForOutfit(outfit)
    const confirmedOutfitsText = getConfirmedOutfitMemory()
    const currentOutfitText = buildOutfitText(outfit, linkedPieces)
    const authorityNote = buildOutfitAuthorityNote(outfit, linkedPieces, likelyPieces)
    content.push({ type: 'text', text: [
      `Mode: evaluate_outfit`,
      authorityNote,
      currentOutfitText,
      likelyPieces.length ? `Likely saved garment truth inferred from outfit title/notes — use cautiously. These are hints only unless linked:\n${likelyPieces.map(buildPieceText).join('\n')}` : '',
      '',
      confirmedOutfitsText ? `Other confirmed outfit memory for comparison. Use this to understand Yuna's taste, not as a rigid checklist:\n${confirmedOutfitsText}` : '',
      '',
      question || 'What do you think of this outfit? Does it work well together?'
    ].filter(Boolean).join('\n') })

    const draft = await askStylist({
      system: EVALUATE_OUTFIT_SYSTEM + '\n\n' + EVALUATE_OUTFIT_FEW_SHOTS,
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })
    const answer = await criticPassForOutfit({
      draft,
      userQuestion: question,
      outfitText: [authorityNote, currentOutfitText, likelyPieces.length ? `Likely saved garment truth:
${likelyPieces.map(buildPieceText).join('\n')}` : ''].filter(Boolean).join('\n\n'),
      mode: 'evaluate_saved_outfit'
    })
    res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'evaluate_outfit' })
  } catch (err) {
    console.error('Evaluate outfit error:', err)
    res.status(500).json({ error: err.message })
  }
})



// ── AI: Generate outfit ideas for a selected saved piece ─────────────────────
app.post('/api/ai/generate-outfits-for-piece', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history, includeMissingPieces = false, idealOnly = false } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const parsedPiece = parsePiece(piece)
    const idealMode = Boolean(includeMissingPieces || idealOnly || /ideal|missing|new ideas|do not have|don't have|dont have|not in my wardrobe|wish list|wardrobe gap/i.test(String(question || '')))
    const idealOnlyMode = Boolean(idealOnly || /new ideas|do not limit|not limited|not just my wardrobe|ignore wardrobe|conceptual/i.test(String(question || '')))
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const rankedCandidates = selectCandidatesForOutfitGeneration(parsedPiece, allPieces, 32)
    const confirmedOutfitsText = getConfirmedOutfitMemory()
    const selectedPieceOutfitsText = getOutfitsForPieceMemory(parsedPiece.id, 8)
    const selectedFeedbackText = getStylistFeedbackMemory('piece', parsedPiece.id, 16)
    const goldFeedbackText = buildGoldStandardFeedbackMemory(parsedPiece.id, 10)
    const selectedSavedBoardText = getSavedBoardMemory('piece', parsedPiece.id, 10)
    const globalSavedBoardText = getSavedBoardMemory(null, null, 12)
    const globalFeedbackText = getStylistFeedbackMemory(null, null, 24)
    const calibrationMemoryText = getCalibrationMemoryForStylist(32)

    const memoryText = [
      selectedPieceOutfitsText ? `Saved outfits already using this selected garment:
${selectedPieceOutfitsText}` : `Saved outfits using this selected garment: none yet`,
      goldFeedbackText ? `High-authority signature/works feedback for this garment. Reinforce similar formulas:
${goldFeedbackText}` : '',
      selectedSavedBoardText ? `Saved visual boards for this garment. Use strongly boards are high-authority outfit memory:
${selectedSavedBoardText}` : '',
      selectedFeedbackText ? `Recent feedback for this garment. Signature/Works should be reinforced; Not me/Too soft/Proportion problem should suppress similar ideas:
${selectedFeedbackText}` : '',
      confirmedOutfitsText ? `Confirmed/favorite outfit memory for Yuna's taste filter:
${confirmedOutfitsText}` : '',
      globalSavedBoardText ? `Global saved board memory. Use strongly boards should bias ranking when relevant:
${globalSavedBoardText}` : '',
      calibrationMemoryText ? `Calibration Library memory. This is higher authority than broad style theory for taste boundaries and identity-preservation:
${calibrationMemoryText}` : '',
      globalFeedbackText ? `General saved stylist feedback memory:
${globalFeedbackText}` : ''
    ].filter(Boolean).join('\n\n')

    const composed = await composeStructuredOutfitsForPiece({
      selectedPiece: parsedPiece,
      rankedCandidates,
      occasion,
      season,
      question,
      idealMode,
      idealOnlyMode,
      memoryText,
      history
    })

    let structuredOutfits = Array.isArray(composed.outfits) ? composed.outfits : []
    if (!structuredOutfits.length && !idealOnlyMode) {
      structuredOutfits = buildLocalFallbackOutfitDirections(parsedPiece, rankedCandidates)
    }
    if (!structuredOutfits.length) {
      const candidates = (rankedCandidates || []).map(r => r.piece).filter(Boolean)
      const selectedGroup = wardrobeCategoryGroup(parsedPiece)
      const supporting = candidates.filter(p => Number(p.id) !== Number(parsedPiece.id)).slice(0, 4)
      structuredOutfits = [normalizeGeneratedOutfitObject({
        label: 'Best available wardrobe direction',
        strength: 'usable',
        dominantDirection: 'simple closet-based pairing using the selected garment',
        silhouette: selectedGroup === 'bottom' ? 'selected bottom with a controlled top' : selectedGroup === 'top' ? 'selected top with the cleanest available bottom' : 'selected garment with restrained support pieces',
        bestFor: 'testing from saved wardrobe pieces',
        pieceIds: [parsedPiece.id, ...supporting.map(p => p.id)].filter(Boolean).slice(0, 5),
        pieces: [parsedPiece, ...supporting].map(p => ({ id: p.id, name: p.name, category: p.category })).slice(0, 5),
        reason: 'Fallback direction generated locally because the AI response did not return visible outfit cards.',
        watchFor: 'Use this as a starting point; refine after seeing the actual garments together.'
      }, parsedPiece, [parsedPiece, ...candidates])]
    }
    const answer = formatStructuredOutfitFeedback({
      selectedPiece: parsedPiece,
      occasion,
      season,
      outfits: structuredOutfits,
      skip: composed.skip,
      saveableLearning: composed.saveableLearning
    })

    res.json({
      feedback: answer,
      structuredOutfits,
      rejectedOutfits: composed.rejected || [],
      provider: AI_PROVIDER,
      mode: idealOnlyMode ? 'ideal_new_ideas_only' : idealMode ? 'ideal_styling_directions' : 'generate_outfit_ideas',
      pipeline: 'composer_evaluator_renderer_handoff',
      idealMode,
      idealOnlyMode
    })
  } catch (err) {
    console.error('Generate outfit ideas error:', err)
    res.status(500).json({ error: err.message })
  }
})


app.post('/api/ai/generate-wardrobe-outfits', async (req, res) => {
  const {
    occasion = 'casual',
    season = 'current season',
    mood = '',
    limit = 5,
    explorationMode = 'moderate'
  } = req.body || {}

  try {
    const routeStartedAt = Date.now()
    const requestedLimit = Math.max(1, Math.min(5, Number(limit) || 5))
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const { allowedPieces, suppressedPieces } = filterWholeWardrobePiecesForGeneration(allPieces, { occasion, explorationMode })
    const wholeWardrobeFeedbackInfluence = buildWholeWardrobeFeedbackInfluence()
    let candidates = buildWholeWardrobeCandidateOutfits(allowedPieces, { occasion, season, mood, explorationMode, wholeWardrobeFeedbackInfluence })
    const candidateFormulaCounts = wholeWardrobeCandidateFormulaCounts(candidates)
    let candidatePieceIds = [...new Set(candidates.flatMap(c => c.pieceIds || []))]
    const candidatePieces = candidatePieceIds
      .map(id => allPieces.find(p => Number(p.id) === Number(id)))
      .filter(Boolean)
    const confirmedOutfitsText = getConfirmedOutfitMemory(10)
    const globalFeedbackText = getStylistFeedbackMemory(null, null, 24)
    const wholeWardrobeFeedbackText = getWholeWardrobeFeedbackMemory(28)
    const globalSavedBoardText = getSavedBoardMemory(null, null, 16)
    const calibrationMemoryText = getCalibrationMemoryForStylist(32)
    const requireShoes = allPieces.some(p => wardrobeCategoryGroup(p) === 'shoes')
    const requireDress = allPieces.some(p => wardrobeCategoryGroup(p) === 'dress')
    const requireNonGraphicTop = allPieces.some(p => wardrobeCategoryGroup(p) === 'top' && !/\b(floral|print|graphic|stripe|striped|pattern|abstract|tapestry)\b/.test(pieceNameBlob(p)))
    const timings = {
      candidateBuildMs: Date.now() - routeStartedAt
    }

    const memoryText = [
      confirmedOutfitsText ? `Confirmed/favorite outfit memory:
${confirmedOutfitsText}` : '',
      globalSavedBoardText ? `Saved visual board memory. Use strongly boards should bias ranking:
${globalSavedBoardText}` : '',
      calibrationMemoryText ? `Calibration Library memory. Higher authority than broad style theory:
${calibrationMemoryText}` : '',
      wholeWardrobeFeedbackText ? `Whole-wardrobe outfit feedback. This is direct ranking/correction memory for this feature:
${wholeWardrobeFeedbackText}` : '',
      globalFeedbackText ? `General saved stylist feedback memory:
${globalFeedbackText}` : ''
    ].filter(Boolean).join('\n\n')
    let visualCriticDebug = null
    try {
      const visualStartedAt = Date.now()
      const visualRanked = await withTimeout(rankWholeWardrobeCandidatesWithVision({
        candidates,
        candidatePieces,
        occasion,
        season,
        mood,
        memoryText,
        limit: requestedLimit
      }), 25000, 'Whole-wardrobe visual critic')
      timings.visualCriticMs = Date.now() - visualStartedAt
      if (visualRanked?.candidates?.length) {
        candidates = visualRanked.candidates.map((candidate, index) => ({ ...candidate, candidateId: `cand-${index + 1}` }))
        candidatePieceIds = [...new Set(candidates.flatMap(c => c.pieceIds || []))]
        visualCriticDebug = {
          reviewedCandidateIds: visualRanked.reviewedCandidateIds,
          rankedCandidateIds: visualRanked.rankedCandidateIds,
          reviewedFormulaCounts: wholeWardrobeCandidateFormulaCounts(visualRanked.candidates.filter(candidate => visualRanked.reviewedCandidateIds.includes(candidate.candidateId))),
          visualLearning: visualRanked.visualLearning || '',
          rejectedCandidateIds: visualRanked.visualRejected || []
        }
      }
    } catch (err) {
      console.warn('Whole-wardrobe visual critic fallback:', err.message)
      visualCriticDebug = { error: err.message }
      timings.visualCriticMs = timings.visualCriticMs || null
    }
    const candidateById = new Map(candidates.map(c => [c.candidateId, c]))

    const userPayload = [
      `Occasion: ${occasion || 'casual'}`,
      `Season: ${season || 'current season'}`,
      `Mood: ${mood || 'artistic minimalist'}`,
      `Target count: ${requestedLimit}. Return fewer if only 3-4 are genuinely strong.`,
      '',
      memoryText,
      '',
      `Curated complete outfit candidates. Pick only from these candidates and preserve exact garment ids/names:
${wholeWardrobeCandidateText(candidates)}`,
      '',
      `Piece truth for candidate pieces only:
${candidatePieces.map(buildPieceText).join('\n')}`,
      '',
      'Return the strongest whole-wardrobe outfits right now. Text only; no image generation.'
    ].filter(Boolean).join('\n')

    let parsed = {}
    let composerError = null
    try {
      const composerStartedAt = Date.now()
      const raw = await withTimeout(askStylist({
        system: WHOLE_WARDROBE_COMPOSER_SYSTEM,
        maxTokens: 1600,
        messages: [{ role: 'user', content: [{ type: 'text', text: userPayload }] }]
      }), 35000, 'Whole-wardrobe composer')
      timings.composerMs = Date.now() - composerStartedAt
      parsed = safeJsonFromModel(raw)
    } catch (err) {
      console.warn('Whole-wardrobe composer fallback:', err.message)
      composerError = err.message
      timings.composerMs = timings.composerMs || null
    }
    const aiReturnedCount = Array.isArray(parsed?.outfits) ? parsed.outfits.length : 0
    const withCandidatePieces = (Array.isArray(parsed?.outfits) ? parsed.outfits : []).map(outfit => {
    const candidate = outfit?.candidateId ? candidateById.get(outfit.candidateId) : null
    if (!candidate) return outfit
    return {
      ...outfit,
      localScore: candidate.localScore,
      pieceIds: Array.isArray(outfit.pieceIds) && outfit.pieceIds.length ? outfit.pieceIds : candidate.pieceIds,
      pieces: Array.isArray(outfit.pieces) && outfit.pieces.length ? outfit.pieces : candidate.pieces
    }
    })
    let structuredOutfits = withCandidatePieces.map(o => repairWholeWardrobeOutfit(normalizeWholeWardrobeOutfitObject(o, candidatePieces), candidatePieces, occasion))
    const localBackfillOutfits = wholeWardrobeOutfitsFromCandidates(candidates, candidatePieces, { occasion })

    if (!structuredOutfits.length) {
      structuredOutfits = localBackfillOutfits.slice(0, Math.max(requestedLimit, 8))
    }

    let diversityRejectedCount = 0
    let gated = locallyGateWholeWardrobeOutfits(
      [...structuredOutfits, ...localBackfillOutfits],
      requestedLimit,
      { requireShoes, requireDress, requireNonGraphicTop, candidatePieces, occasion }
    )
    diversityRejectedCount += gated.rejected?.length || 0
    structuredOutfits = gated.outfits
    if (!structuredOutfits.length) {
      structuredOutfits = locallyGateWholeWardrobeOutfits(
        localBackfillOutfits.slice(0, Math.max(requestedLimit, 12)),
        requestedLimit,
        { requireShoes, requireDress, requireNonGraphicTop, candidatePieces, occasion }
      ).outfits
    }
    const formulaFamiliesReturned = [...new Set(structuredOutfits.map(outfit => outfit.formulaFamily || wholeWardrobeFormulaFamily(outfit, candidatePieces, occasion)).filter(Boolean))]
    const archetypeCounts = structuredOutfits.reduce((counts, outfit) => {
      const id = outfit.archetypeId || wholeWardrobeArchetypeFor(outfit, candidatePieces, occasion).archetypeId
      counts[id] = (counts[id] || 0) + 1
      return counts
    }, {})

    const feedback = formatWholeWardrobeOutfitFeedback({
      occasion,
      season,
      mood,
      outfits: structuredOutfits,
      skip: parsed.skip || '',
      saveableLearning: parsed.saveableLearning || ''
    })

    res.json({
      feedback,
      structuredOutfits,
      rejectedOutfits: [...(parsed.rejected || []), ...(gated.rejected || [])],
      provider: AI_PROVIDER,
      mode: 'generate_wardrobe_outfits',
      pipeline: 'whole_wardrobe_composer_evaluator',
      debug: {
        candidateCount: candidates.length,
        candidateFormulaCounts,
        feedbackInfluenceRowsUsed: wholeWardrobeFeedbackInfluence.rowsUsed,
        suppressedPieceCount: suppressedPieces.length,
        suppressedPieces,
        visualCritic: visualCriticDebug,
        composerError,
        timings,
        archetypeCounts,
        formulaFamiliesReturned,
        locallyGeneratedCount: localBackfillOutfits.length,
        aiReturnedCount,
        finalReturnedCount: structuredOutfits.length,
        diversityRejectedCount
      }
    })
  } catch (err) {
    console.error('Generate whole-wardrobe outfits error:', err)
    res.status(500).json({ error: err.message })
  }
})



// ── AI: Generate visual outfit boards from a selected piece ──────────────────
app.post('/api/ai/generate-outfit-boards', async (req, res) => {
  const { pieceId, conceptsText = '', structuredOutfits = null, occasion = 'casual', season = 'current season' } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const selectedPiece = parsePiece(piece)
    const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)
    const rankedCandidates = selectCandidatesForOutfitGeneration(selectedPiece, allPieces, 48)
    const candidatePieces = [selectedPiece, ...rankedCandidates.map(r => r.piece)]
    const allowedIds = new Set(candidatePieces.map(p => Number(p.id)))
    const pieceById = new Map(candidatePieces.map(p => [Number(p.id), p]))

    let boardPlans = boardPlanFromStructuredOutfits(structuredOutfits, selectedPiece, candidatePieces)

    // Fallback for older chat responses: parse the visible Pieces lines before asking AI to plan.
    if (!boardPlans.length && conceptsText) {
      boardPlans = structuredOutfitsFromGeneratedText(conceptsText, selectedPiece, candidatePieces)
    }

    // Last fallback: ask the model to choose ids, but keep this as a backup only.
    if (!boardPlans.length) {
      const candidateText = candidatePieces.map(p => `${p.id}: ${p.name} (${p.category}) — ${buildPieceText(p)}`).join('\n')
      const rawPlan = await askStylist({
        system: OUTFIT_BOARD_PLANNER_SYSTEM,
        maxTokens: 1000,
        messages: [{ role: 'user', content: [{ type: 'text', text: [
          `Selected garment id: ${selectedPiece.id}`,
          `Selected garment: ${selectedPiece.name} (${selectedPiece.category})`,
          `Occasion: ${occasion}`,
          `Season: ${season}`,
          '',
          conceptsText ? `Text outfit ideas to translate into boards:\n${conceptsText}` : 'No prior concept text was provided. Create useful boards from the candidates.',
          '',
          `Candidate saved wardrobe pieces. Use ONLY these ids:\n${candidateText}`,
          '',
          `Return 2-3 boards if possible. Every board must include selected id ${selectedPiece.id}.`
        ].join('\n') }] }]
      })
      const parsed = safeJsonFromModel(rawPlan)
      boardPlans = parsed.boards || []
    }

    const boards = []
    for (const [idx, board] of boardPlans.slice(0, 3).entries()) {
      const ids = Array.isArray(board.pieceIds) ? board.pieceIds.map(Number).filter(id => allowedIds.has(id)) : []
      if (!ids.includes(Number(selectedPiece.id))) ids.unshift(Number(selectedPiece.id))
      const uniqueIds = [...new Set(ids)].slice(0, 5)
      const ownedBoardPieces = uniqueIds.map(id => pieceById.get(id)).filter(Boolean)
      const rawMissingPieces = Array.isArray(board.missingPieces) ? board.missingPieces : []
      const cleanMissingPieces = dedupeMissingAgainstOwned(rawMissingPieces, ownedBoardPieces)
      const boardPieces = dedupeBoardPiecesForRender([
        ...ownedBoardPieces,
        ...cleanMissingPieces.map(p => ({ ...p, missing: true, photo: null, worn_photo: null }))
      ]).slice(0, 5)
      if (boardPieces.length < 2) continue
      const imageUrl = await createOutfitBoardImage({ board, pieces: boardPieces, index: idx + 1 })
      boards.push({
        label: board.label || `Outfit board ${idx + 1}`,
        reason: board.reason || '',
        watchFor: board.watchFor || '',
        pieces: boardPieces.map(p => ({ id: p.id, name: p.name, category: p.category, missing: !!p.missing })),
        imageUrl
      })
    }

    if (!boards.length) throw new Error('No usable boards were generated from structured outfit ids')
    res.json({ boards, provider: AI_PROVIDER, mode: 'generate_outfit_boards' })
  } catch (err) {
    console.error('Generate outfit boards error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Generate one image from a whole-wardrobe outfit card ──────────────────
app.post('/api/ai/generate-wardrobe-outfit-image', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season' } = req.body || {}
  try {
    const ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 6)
    if (!ids.length) return res.status(400).json({ error: 'pieceIds are required' })

    const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
    const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
    const pieces = ids.map(id => byId.get(id)).filter(Boolean)
    if (pieces.length < 2) return res.status(400).json({ error: 'At least two saved wardrobe pieces are required' })

    const rendered = await createWholeWardrobeOutfitImage({ outfit, pieces, occasion, season, index: 1 })
    const board = {
      label: outfit.label || 'Whole wardrobe generated outfit',
      reason: outfit.reason || '',
      watchFor: outfit.watchFor || '',
      pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      wholeWardrobe: true
    }
    res.json({ ...board, board, provider: AI_PROVIDER, mode: 'generate_wardrobe_outfit_image', debug: board.debug })
  } catch (err) {
    console.error('Generate whole-wardrobe outfit image error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ai/generate-saved-outfit-image', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season' } = req.body || {}
  try {
    let ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 6)
    let pieces = []
    if (ids.length) {
      const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
      const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
      pieces = ids.map(id => byId.get(id)).filter(Boolean)
    } else if (outfit.id) {
      pieces = getLinkedPiecesForOutfit(outfit.id).slice(0, 6)
      ids = pieces.map(piece => Number(piece.id)).filter(Boolean)
    }
    if (!ids.length) return res.status(400).json({ error: 'No linked wardrobe pieces were found for this outfit' })

    if (pieces.length < 2) return res.status(400).json({ error: 'At least two linked wardrobe pieces are required' })

    const rendered = await createSavedOutfitImage({ outfit, pieces, occasion, season, index: 1 })
    const boards = [{
      label: 'Outfit alternatives',
      reason: 'One GPT-4o call generated three distinct outfit alternatives from the saved outfit photo and linked garment references.',
      watchFor: 'The three alternatives should use different outfit formulas rather than repeat the same styling idea.',
      pieces: pieces.map(p => ({ id: p.id, name: p.name, category: wardrobeCategoryGroup(p), photo: p.photo || null, worn_photo: p.worn_photo || null })),
      imageUrl: rendered.imageUrl,
      debug: { timings: rendered.timings, renderer: rendered.renderer },
      savedOutfit: true,
      variant: true
    }]
    res.json({
      boards,
      feedback: 'Generated three outfit alternatives in one image from the saved outfit photo and linked garment references.',
      provider: 'openai',
      mode: 'generate_saved_outfit_variants',
      debug: { variantCount: 3, requestCount: 1 }
    })
  } catch (err) {
    console.error('Generate saved outfit image error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ai/evaluate-wardrobe-outfit', async (req, res) => {
  const { outfit = {}, pieceIds = [], occasion = 'casual', season = 'current season', mood = '', question = '' } = req.body || {}
  try {
    const startedAt = Date.now()
    const ids = [...new Set((Array.isArray(pieceIds) && pieceIds.length ? pieceIds : outfit.pieceIds || [])
      .map(Number)
      .filter(Boolean))]
      .slice(0, 6)
    if (!ids.length) return res.status(400).json({ error: 'pieceIds are required' })

    const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(parsePiece)
    const byId = new Map(rows.map(piece => [Number(piece.id), piece]))
    const pieces = ids.map(id => byId.get(id)).filter(Boolean)
    if (pieces.length < 2) return res.status(400).json({ error: 'At least two saved wardrobe pieces are required' })

    const content = []
    const outfitPhoto = outfit.photo || outfit.imageUrl || ''
    if (outfitPhoto) {
      const outfitFileName = String(outfitPhoto).startsWith('/uploads/')
        ? path.basename(outfitPhoto)
        : path.basename(String(outfitPhoto))
      const outfitFilePath = path.join(uploadsDir, outfitFileName)
      if (fs.existsSync(outfitFilePath)) {
        const { base64, mime } = await prepareImageForClaude(outfitFilePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const imageRefs = await Promise.all(pieces.slice(0, 5).map(async (piece) => {
      const photo = piece.worn_photo || piece.photo
      if (!photo) return null
      const filePath = path.join(uploadsDir, photo)
      if (!fs.existsSync(filePath)) return null
      const { base64, mime } = await prepareImageForClaude(filePath)
      return { piece, base64, mime }
    }))
    for (const ref of imageRefs.filter(Boolean)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: ref.mime, data: ref.base64 } })
    }

    const wholeWardrobeFeedbackText = getWholeWardrobeFeedbackMemory(20)
    const calibrationMemoryText = getCalibrationMemoryForStylist(20)
    const globalSavedBoardText = getSavedBoardMemory(null, null, 10)
    const pieceLines = pieces.map((piece, index) => `${index + 1}. ${buildPieceText(piece)}`).join('\n')
    const outfitSummary = [
      `Label: ${outfit.label || outfit.title || 'Whole wardrobe outfit'}`,
      outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
      outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
      outfit.reason ? `Current reason: ${outfit.reason}` : '',
      outfit.watchFor ? `Current watch note: ${outfit.watchFor}` : '',
      outfit.formulaFamily ? `Formula family: ${outfit.formulaFamily}` : '',
      outfit.archetypeId ? `Archetype: ${outfit.archetypeId}` : ''
    ].filter(Boolean).join('\n')

    content.push({ type: 'text', text: [
      `Mode: evaluate_whole_wardrobe_outfit`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      mood ? `Mood: ${mood}` : '',
      question ? `User question: ${question}` : 'User question: Evaluate this outfit.',
      outfitPhoto ? 'The first image is the actual worn outfit photo. Treat it as primary visual evidence for fit, scale, proportion, and whether the combination works. Later images are linked garment references that clarify the saved pieces.' : 'No worn outfit photo was provided. Use linked garment references and garment truth cautiously.',
      '',
      `Proposed outfit:\n${outfitSummary}`,
      '',
      `Owned garment truth. Use these exact garments for the critique:\n${pieceLines}`,
      '',
      wholeWardrobeFeedbackText ? `Whole-wardrobe feedback memory:\n${wholeWardrobeFeedbackText}` : '',
      globalSavedBoardText ? `Saved visual board memory:\n${globalSavedBoardText}` : '',
      calibrationMemoryText ? `Calibration memory:\n${calibrationMemoryText}` : '',
      '',
      'Return direct advice only. Do not create render directions or image-generation prompts.'
    ].filter(Boolean).join('\n') })

    const raw = await withTimeout(askStylist({
      system: WHOLE_WARDROBE_EVALUATOR_SYSTEM,
      maxTokens: 1400,
      messages: [{ role: 'user', content }]
    }), 45000, 'Whole-wardrobe outfit evaluator')
    const parsed = safeJsonFromModel(raw)
    const visibleFacts = parsed?.visibleFacts && typeof parsed.visibleFacts === 'object' ? parsed.visibleFacts : {}
    const inferredIntent = parsed?.inferredIntent && typeof parsed.inferredIntent === 'object' ? parsed.inferredIntent : {}
    const nestedEvaluation = parsed?.evaluation && typeof parsed.evaluation === 'object' ? parsed.evaluation : {}
    const recommendationBlock = parsed?.recommendation && typeof parsed.recommendation === 'object' ? parsed.recommendation : {}
    const verdict = nestedEvaluation.verdict || parsed.verdict || ''
    const scores = nestedEvaluation.scores || parsed.scores || {}
    const scoreText = scores && typeof scores === 'object'
      ? Object.entries(scores).map(([key, value]) => `${key}: ${value}/5`).join(' · ')
      : ''
    const roles = nestedEvaluation.roles && typeof nestedEvaluation.roles === 'object'
      ? nestedEvaluation.roles
      : parsed?.roles && typeof parsed.roles === 'object' ? parsed.roles : {}
    const factsText = [
      visibleFacts.floorLine ? `Floor line: ${visibleFacts.floorLine}` : '',
      visibleFacts.upperLayering ? `Upper layering: ${visibleFacts.upperLayering}` : '',
      visibleFacts.waistArea ? `Waist area: ${visibleFacts.waistArea}` : '',
      visibleFacts.texturePattern ? `Texture/pattern: ${visibleFacts.texturePattern}` : '',
      visibleFacts.confidenceLimits ? `Confidence limits: ${visibleFacts.confidenceLimits}` : '',
    ].filter(Boolean).join('\n')
    const intentText = [
      inferredIntent.label ? `Intent: ${inferredIntent.label}` : '',
      Array.isArray(inferredIntent.successCriteria) && inferredIntent.successCriteria.length
        ? `Success criteria: ${inferredIntent.successCriteria.join(' ')}`
        : '',
    ].filter(Boolean).join('\n')
    const roleText = [
      roles.heroPiece ? `Hero: ${roles.heroPiece}` : '',
      Array.isArray(roles.supportPieces) && roles.supportPieces.length ? `Support: ${roles.supportPieces.join(' ')}` : '',
      roles.groundingPiece ? `Grounding: ${roles.groundingPiece}` : '',
      roles.possibleCompetingPiece ? `Tension point: ${roles.possibleCompetingPiece}` : '',
    ].filter(Boolean).join('\n')
    const feedback = [
      nestedEvaluation.summary || parsed.summary || 'Evaluation complete.',
      verdict ? `Verdict: ${verdict}` : '',
      intentText,
      factsText ? `Visible facts:\n${factsText}` : '',
      nestedEvaluation.tensionType || parsed.tensionType ? `Tension: ${nestedEvaluation.tensionType || parsed.tensionType}` : '',
      nestedEvaluation.maintenanceBurden || parsed.maintenanceBurden ? `Maintenance burden: ${nestedEvaluation.maintenanceBurden || parsed.maintenanceBurden}` : '',
      scoreText ? `Scores: ${scoreText}` : '',
      roleText ? `Roles:\n${roleText}` : '',
      nestedEvaluation.mainSuccess ? `Main success: ${nestedEvaluation.mainSuccess}` : '',
      nestedEvaluation.firstVisibleIssue ? `First visible issue: ${nestedEvaluation.firstVisibleIssue}` : '',
      Array.isArray(parsed.works) && parsed.works.length ? `Works: ${parsed.works.join(' ')}` : '',
      Array.isArray(parsed.risks) && parsed.risks.length ? `Risks: ${parsed.risks.join(' ')}` : '',
      (recommendationBlock.smallestAdjustment || typeof parsed.recommendation === 'string') ? `Next: ${recommendationBlock.smallestAdjustment || parsed.recommendation}` : '',
      recommendationBlock.avoidForNow ? `Avoid for now: ${recommendationBlock.avoidForNow}` : '',
      recommendationBlock.tryNext || parsed.tryNext ? `Try next: ${recommendationBlock.tryNext || parsed.tryNext}` : ''
    ].filter(Boolean).join('\n\n')

    res.json({
      feedback,
      evaluation: {
        visibleFacts,
        inferredIntent,
        summary: nestedEvaluation.summary || parsed.summary || '',
        verdict,
        roles,
        tensionType: nestedEvaluation.tensionType || parsed.tensionType || '',
        maintenanceBurden: nestedEvaluation.maintenanceBurden || parsed.maintenanceBurden || '',
        mainSuccess: nestedEvaluation.mainSuccess || '',
        firstVisibleIssue: nestedEvaluation.firstVisibleIssue || '',
        scores,
        works: Array.isArray(parsed.works) ? parsed.works : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        recommendation: recommendationBlock.smallestAdjustment || (typeof parsed.recommendation === 'string' ? parsed.recommendation : ''),
        avoidForNow: recommendationBlock.avoidForNow || '',
        tryNext: recommendationBlock.tryNext || parsed.tryNext || '',
        saveableLearning: parsed.saveableLearning || ''
      },
      provider: AI_PROVIDER,
      model: ACTIVE_STYLIST_MODEL,
      mode: 'evaluate_wardrobe_outfit',
      pipeline: 'whole_wardrobe_outfit_evaluator',
      debug: { timings: { totalMs: Date.now() - startedAt }, outfitImageIncluded: Boolean(outfitPhoto), imageCount: imageRefs.filter(Boolean).length + (outfitPhoto ? 1 : 0) }
    })
  } catch (err) {
    console.error('Evaluate whole-wardrobe outfit error:', err)
    res.status(500).json({ error: err.message })
  }
})



function ownedInventorySummaryForEditorial(excludePieceId = null) {
  try {
    const rows = db.prepare('SELECT id, name, category, colors, notes FROM pieces ORDER BY id DESC LIMIT 400').all()
    return rows
      .filter(p => Number(p.id) !== Number(excludePieceId))
      .map(p => {
        const bits = [p.name, p.category, p.colors ? `colors: ${p.colors}` : '', p.notes ? `notes: ${String(p.notes).slice(0, 120)}` : '']
        return bits.filter(Boolean).join(' — ')
      })
      .join('\n')
  } catch (err) {
    return ''
  }
}

function normalizeArchetypeText(value = '') {
  return normalizeForMatch(String(value || '').replace(/\(missing piece\)/gi, ''))
}

function ownedLooksSimilarToArchetype(archetype = '', ownedPieces = []) {
  const a = normalizeArchetypeText(archetype)
  if (!a) return false
  const wantsDenim = /\b(denim|jean|jeans)\b/.test(a)
  const wantsOliveUtility = /\bolive\b/.test(a) && /\b(utility|cargo|barrel|fatigue|workwear)\b/.test(a)
  const wantsCreamTrouser = /\b(cream|ivory|white|oatmeal|beige)\b/.test(a) && /\b(trouser|pant|pants|jean|jeans)\b/.test(a)
  const wantsNavyTrouser = /\b(navy|indigo|blue)\b/.test(a) && /\b(trouser|pant|pants|jean|jeans|denim)\b/.test(a)

  for (const p of ownedPieces || []) {
    const n = normalizeForMatch(`${p.name || ''} ${p.category || ''} ${p.colors || ''} ${p.notes || ''}`)
    if (!n) continue
    if (a && n.includes(a)) return true
    if (wantsDenim && /\b(denim|jean|jeans)\b/.test(n)) return true
    if (wantsOliveUtility && /\bolive\b/.test(n) && /\b(utility|cargo|pant|pants|trouser|fatigue|workwear)\b/.test(n)) return true
    if (wantsCreamTrouser && /\b(cream|ivory|white|oatmeal|beige)\b/.test(n) && /\b(trouser|pant|pants|jean|jeans)\b/.test(n)) return true
    if (wantsNavyTrouser && /\b(navy|indigo|blue)\b/.test(n) && /\b(trouser|pant|pants|jean|jeans|denim)\b/.test(n)) return true
  }
  return false
}

function makeDistinctNewPieceArchetype(original = '', selectedPiece = {}, used = new Set()) {
  const selectedName = normalizeForMatch(selectedPiece?.name || '')
  const poolForTop = []

  if (/lace|sheer|appliqu|cream|soft|floral/.test(selectedName)) {
    poolForTop.push(
      'deep chocolate straight midi skirt with clean column line',
      'ink navy structured pencil skirt with subtle texture',
      'tobacco brown architectural trouser with soft front pleat',
      'dark olive weighted crochet-column skirt',
      'cognac slim-soled loafer'
    )
  } else if (/stripe|striped|graphic|button|shirt|sleeveless|knit/.test(selectedName)) {
    poolForTop.push(
      'dark chocolate long column trouser with clean hem',
      'tobacco brown structured barrel trouser with tapered ankle',
      'ink navy straight midi skirt with matte texture',
      'warm taupe architectural trouser with crisp front crease',
      'cognac slim-soled loafer'
    )
  } else {
    poolForTop.push(
      'dark chocolate straight-leg trouser with clean hem',
      'tobacco structured utility trouser without cargo pockets',
      'ink navy column skirt with matte texture',
      'warm taupe architectural trouser',
      'cognac grounded loafer'
    )
  }

  const o = normalizeArchetypeText(original)
  let candidate = poolForTop.find(x => !used.has(normalizeArchetypeText(x)) && normalizeArchetypeText(x) !== o)
  if (!candidate) candidate = `more specific ${String(original || 'editorial support piece').replace(/\(missing piece\)/gi, '').trim()}`
  used.add(normalizeArchetypeText(candidate))
  return candidate
}

function dedupeAndDifferentiateEditorialDirections(directions = [], selectedPiece = {}, ownedPieces = []) {
  const usedMissing = new Set()
  const seenTitles = new Set()
  const cleaned = []

  for (const direction of directions || []) {
    const copy = { ...direction }
    const titleKey = normalizeForMatch(copy.title || '')
    if (titleKey && seenTitles.has(titleKey)) continue
    if (titleKey) seenTitles.add(titleKey)

    const missing = Array.isArray(copy.missingPieces) ? copy.missingPieces : []
    copy.missingPieces = missing.map(piece => {
      const raw = typeof piece === 'string' ? piece : piece?.name || String(piece || '')
      let next = raw.replace(/\(missing piece\)/gi, '').trim()
      const key = normalizeArchetypeText(next)
      if (!next) next = 'specific editorial support piece'
      if (usedMissing.has(key) || ownedLooksSimilarToArchetype(next, ownedPieces)) {
        next = makeDistinctNewPieceArchetype(next, selectedPiece, usedMissing)
      } else {
        usedMissing.add(key)
      }
      return next
    }).filter(Boolean)

    // In new-piece mode, every direction should contain at least two suggested additions.
    while (copy.missingPieces.length < 2) {
      copy.missingPieces.push(makeDistinctNewPieceArchetype('', selectedPiece, usedMissing))
    }

    copy.reason = String(copy.reason || '').replace(/\bjeans?\b/gi, m => m)
    cleaned.push(copy)
  }

  return cleaned.slice(0, 3)
}

// ── AI: Ideal new-piece visual concepts for selected garment ─────────────────
const EDITORIAL_NEW_PIECES_SYSTEM = `You are Yuna's visual editorial stylist.
Your job is NOT to combine her closet. Your job is to show what NEW missing pieces would complete ONE selected wardrobe item.
 
Return ONLY valid JSON. No markdown.
 
YUNA'S CONFIRMED OUTFIT FORMULA — every direction must respect this:
- Top: fitted, dark, or expressive (pattern, texture, color-block, or interesting detail). Never loose, unstructured, or generically layered.
- Bottom: full-length preferred — wide-leg trouser, straight-leg trouser, midi or maxi skirt, or dark straight-leg jeans. The bottom is the foundation; it is quieter than the top.
- The strongest formula is dark fitted top + light or neutral full-length bottom, OR a expressive patterned top + dark full-length bottom.
- Shoes: pointed-toe dark flat, kitten heel, slim-soled loafer, or ankle boot with edge. NEVER round-toe flat, chunky sole, sneaker, Oxford, or white/beige casual shoe for a styled look.
- Accessory: one leather bag in warm tone (cognac, brown, tan, black). A long pendant necklace creates the vertical line — include when the top is simpler.
- Volume and expression come from ONE element per outfit — the top, OR a skirt with movement, never both at once.
 
Rules:
- Every concept must use the selected garment as the anchor.
- Supporting pieces must be conceptual suggested additions, not saved wardrobe items.
- Do not include wardrobe-piece names unless they are the selected garment.
- Use the owned inventory list only to AVOID recommending things she already owns.
- If a common archetype is already represented in her wardrobe, suggest a meaningfully different version: different color family, cleaner cut, stronger visual weight, different texture, or more precise shape.
- Be specific and editorial: e.g. "deep chocolate straight-leg trouser with clean hem", "ink navy matte column skirt with slight weight", "cognac slim-soled pointed loafer", "black kitten mule with almond toe".
- Generate 3 strong visual directions.
- Each direction must be wearable, realistic, and grounded in the confirmed formula above.
- Preferred bottom archetypes: dark grounded column trouser, charcoal/espresso/black straight-leg, cream or taupe wide-leg linen, flowing midi skirt in earthy tone, weighted textured midi skirt.
- Preferred shoe archetypes: black pointed flat, cognac slim loafer, dark ankle boot, black kitten heel mule.
- At least two directions must include real visual contrast: dark top + light bottom, or expressive patterned top + dark clean bottom.
- At least one direction must be a full dark column: dark top + dark bottom + dark grounded shoe.
 
Hard anti-drift rules — NEVER suggest these regardless of the anchor piece:
- No beige/cream cardigan as a layer (this is the primary catalog-drift signal)
- No scarves as a default styling element
- No Oxford shoes or round-toe flats
- No blazer unless the anchor piece specifically calls for structure
- No soft skirt + soft unstructured shoe (the "librarian comfort" combination)
- No all-neutral cream/taupe/beige harmony without a dark grounding element
- No tucking when the anchor piece has a design hem or is noted as wear-over-only
 
For each direction, write a visualPrompt that encodes:
- exact silhouette (e.g. "fitted dark top, full-length wide-leg cream linen trouser, black pointed kitten heel")
- fabric feel (e.g. "matte, weighted, with real drape")
- one specific color story (e.g. "dark olive on cream, grounded by a cognac leather tote")
- posture/energy: "relaxed confident stance, not front-facing catalog posture"
 
JSON shape:
{
  "directions": [
    {
      "title": "Short evocative label",
      "missingPieces": ["specific archetype 1", "specific archetype 2"],
      "reason": "One sentence: what this direction does and why it works for this anchor piece",
      "watchFor": "One specific drift risk to avoid when rendering",
      "visualPrompt": "Full outfit direction for the image renderer — silhouette, fabric, color story, shoe, posture"
    }
  ]
}`

function anchorFidelityInstructions(selectedPiece = {}) {
  const name = String(selectedPiece.name || '').toLowerCase()
  const category = String(selectedPiece.category || '').toLowerCase()
  const notes = String(selectedPiece.notes || '').toLowerCase()
  const parts = []

  if (category.includes('top') || /top|shell|tank|tee|shirt|blouse|sweater|cardigan|tunic/.test(name)) {
    parts.push('Anchor is an upper-body garment: preserve its neckline, shoulder width, sleeve length, hem length, and looseness/fittedness.')
  }
  if (category.includes('bottom') || /pant|jean|trouser|skirt|short/.test(name)) {
    parts.push('Anchor is a lower-body garment: preserve the rise, leg/hem width, length, drape, and visible volume. Do not turn wide pants into slim pants or cropped pants into long pants.')
  }
  if (/sleeveless|tank|shell/.test(name + ' ' + notes)) parts.push('Keep the anchor sleeveless; do not add sleeves.')
  if (/short sleeve|short-sleeve/.test(name + ' ' + notes)) parts.push('Keep the anchor short-sleeved; do not make it long-sleeved.')
  if (/long sleeve|long-sleeve/.test(name + ' ' + notes)) parts.push('Keep the anchor long-sleeved; do not shorten the sleeves.')
  if (/stripe|striped/.test(name + ' ' + notes)) parts.push('Preserve stripe direction, stripe spacing, and color relationship; do not invent a different stripe scale.')
  if (/lace|crochet|gauze|linen|corduroy|cashmere|wool|silk|satin|denim/.test(name + ' ' + notes)) parts.push('Preserve the apparent fabric character and texture weight of the anchor garment.')
  if (/boxy|relaxed|loose|oversized/.test(name + ' ' + notes)) parts.push('Keep the anchor relaxed/boxy if described that way; do not make it clingy or tucked tight.')
  if (/fitted|slim|compact/.test(name + ' ' + notes)) parts.push('Keep the anchor fitted/compact if described that way; do not make it oversized.')

  return parts.join(' ')
}

function editorialImagePrompt({ selectedPiece, direction, occasion, season }) {
  const missing = Array.isArray(direction.missingPieces)
    ? direction.missingPieces.join(', ')
    : ''
  const pieceDesc = [
    selectedPiece.name,
    selectedPiece.category,
    selectedPiece.colors  ? `colors: ${selectedPiece.colors}`  : '',
    selectedPiece.fabric  ? `fabric: ${selectedPiece.fabric}`  : '',
    selectedPiece.notes   ? `notes: ${String(selectedPiece.notes).slice(0, 700)}` : ''
  ].filter(Boolean).join('; ')
  const anchorRules = anchorFidelityInstructions(selectedPiece)
 
  return [
    'Full-figure personal styling concept image. Full outfit visible from head to shoes. Simple neutral or natural background, soft daylight or studio light. No text, labels, watermarks, or additional people.',
 
    'Subject: a real woman with medium curly hair (natural, not styled), warm olive skin tone, strong facial features, direct and warm expression. Natural relaxed posture with slight asymmetry — weight shifted, hand in pocket or at side, not front-facing catalog stance.',
 
    'Aesthetic: Urban Artisan. One expressive element per outfit — either an interesting top (pattern, texture, color-block) OR a skirt with movement — never both at once. The rest of the outfit is quieter and grounds the expression.',
 
    'Silhouette: fitted or structured upper half + full-length bottom (wide-leg, straight-leg, flowing maxi/midi). The lower half is always full-length.',
 
    'Shoes: pointed-toe dark flat, black or cognac kitten heel, slim-soled leather loafer, or ankle boot with edge. NEVER round-toe flat, chunky sole, white sneaker, Oxford shoe, or beige/neutral casual slip-on.',
 
    'Clothing must look real: visible fabric weight, natural folds and drape, slight tension where fitted. No idealized tailoring, no AI-smooth perfection, no beauty retouching.',
 
    `ANCHOR GARMENT — preserve exactly: ${pieceDesc}.`,
    anchorRules ? `Anchor fidelity: ${anchorRules}` : '',
    'The anchor garment must remain visually recognizable — same category, neckline, sleeve length, print scale, color, fit, and hem length. Do not redesign it or substitute a different garment.',
 
    direction.visualPrompt
      ? `PRIMARY RENDERING DIRECTIVE — follow this exactly: ${direction.visualPrompt}`
      : missing
        ? `Complete the outfit with these new-piece archetypes: ${missing}.`
        : '',
    direction.reason ? `Stylist logic: ${direction.reason}` : '',
 
    `Occasion: ${occasion}. Season: ${season}.`,
 
    [
  'GARMENT FIDELITY — preserve the anchor garment exactly as shown in the photo:',
  '- Do not add a belt or waist tie unless the anchor garment photo shows one',
  '- Do not change the neckline, sleeve length, or closure style of the anchor garment',
    ].join('\n'),
 
  ].filter(Boolean).join('\n')
}

async function getCalibrationReferenceImagesForGeneration(limit = 3) {
  try {
    const rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived, 0) = 0
        AND kind IN ('good_reference', 'real_photo')
      ORDER BY
        CASE WHEN kind = 'real_photo' THEN 0 ELSE 1 END,
        COALESCE(favorite, 0) DESC,
        id DESC
      LIMIT ?
    `).all(Number(limit))
 
    const images = []
    for (const row of rows) {
      const filePath = imageUrlToUploadPath(row.image_url)
      if (!filePath) continue
      try {
        // Resize to a reasonable input size — large enough for style reading,
        // small enough to keep token cost manageable
        const buffer = await sharp(filePath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
        images.push({
          base64:   buffer.toString('base64'),
          mime:     'image/jpeg',
          kind:     row.kind,
          favorite: Boolean(row.favorite),
          labels:   safeJsonParse(row.labels, []),
          notes:    row.notes || '',
        })
      } catch (imgErr) {
        console.warn('Could not read calibration image for generation:', row.id, imgErr.message)
      }
    }
    return images
  } catch (err) {
    console.warn('getCalibrationReferenceImagesForGeneration error:', err.message)
    return []
  }
}

async function runGPT4oImageGeneration({ client, prompt, size = '1024x1536', referenceImages = [], anchorGarmentImage = null }) {
  const contentParts = []
 
  // anchorGarmentImage can be a single { base64, mime, label } object
  // or an array of them (worn photo + hanger photo)
  const anchorPhotos = Array.isArray(anchorGarmentImage)
    ? anchorGarmentImage
    : anchorGarmentImage ? [anchorGarmentImage] : []
 
  if (anchorPhotos.length > 0) {
    contentParts.push({
      type: 'input_text',
      text: `ANCHOR GARMENT — the following ${anchorPhotos.length > 1 ? anchorPhotos.length + ' photos show' : 'photo shows'} the exact garment that must appear in the generated image. Preserve exactly: neckline shape, collar or no-collar, closure type, sleeve length and style, print scale and color family, lace or fabric detail, hem length, and overall silhouette. Do NOT redesign this garment, change its neckline, add a belt or waist definition not present in the photos, or substitute a different garment.`
    })
    for (const photo of anchorPhotos) {
      contentParts.push({ type: 'input_image', image_url: `data:${photo.mime};base64,${photo.base64}` })
      if (photo.label) {
        contentParts.push({ type: 'input_text', text: photo.label })
      }
    }
  }
 
  for (const img of referenceImages.slice(0, 3)) {
    contentParts.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.base64}` })
    const captionParts = [
      img.kind === 'real_photo'
        ? (img.favorite ? 'Real photo — use strongly for visual identity, proportion, and presence reference' : 'Real outfit photo — use for identity reference')
        : (img.favorite ? 'Good style reference — use strongly for aesthetic direction' : 'Good style reference'),
      img.labels?.length ? `[${img.labels.join(', ')}]` : '',
      img.notes ? img.notes : '',
    ].filter(Boolean)
    if (captionParts.length) {
      contentParts.push({ type: 'input_text', text: captionParts.join(' — ') })
    }
  }
 
  contentParts.push({ type: 'input_text', text: prompt })
 
  const response = await client.responses.create({
    model: 'gpt-4o',
    input: [{ role: 'user', content: contentParts }],
    tools: [{ type: 'image_generation', size, quality: 'medium' }]
  })
 
  const imageItem = response.output?.find(item => item.type === 'image_generation_call')
  if (!imageItem?.result) {
    throw new Error('GPT-4o Responses API did not return an image_generation_call result')
  }
  return imageItem.result
}

async function createEditorialConceptImage({ selectedPiece, direction, index, occasion, season }) {
  const prompt = editorialImagePrompt({ selectedPiece, direction, occasion, season })
  const filename = `generated-boards/editorial-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
 
  if (photoPreservingVisualsEnabled()) {
    return createPhotoPreservingCollageImage({
      title: direction.title || `Ideal direction ${index}`,
      subtitle: 'ideal addition concept · photo-preserving collage',
      selectedPiece,
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || '',
      index,
      prefix: 'editorial-collage'
    })
  }
 
  if (!process.env.OPENAI_API_KEY) {
    const title  = escapeXml(direction.title || `Ideal direction ${index}`)
    const pieces = escapeXml((direction.missingPieces || []).join(' + '))
    const anchor = escapeXml(selectedPiece.name || 'selected item')
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="48" fill="#3b3128">${title}</text>
      <text x="112" y="238" font-family="Arial, sans-serif" font-size="28" fill="#7b6a59">Anchor: ${anchor}</text>
      <text x="112" y="310" font-family="Arial, sans-serif" font-size="30" fill="#6d5135">Suggested additions: ${pieces}</text>
      <text x="112" y="1480" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Image generation unavailable.</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }
 
  // ── Load anchor garment photo ───────────────────────────────────────────────
  let anchorGarmentImage = null
  try {
    const anchorParts = []
 
    // Worn photo — shows how the garment actually drapes and fits on a body
    if (selectedPiece.worn_photo) {
      const filePath = path.join(uploadsDir, selectedPiece.worn_photo)
      if (fs.existsSync(filePath)) {
        const buffer = await sharp(filePath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        anchorParts.push({
          base64: buffer.toString('base64'),
          mime: 'image/jpeg',
          label: `${selectedPiece.name} — worn photo showing drape, fit, and neckline on a body`,
        })
      }
    }
 
    // Hanger photo — shows the garment's exact color, print, texture, and construction details
    if (selectedPiece.photo) {
      const filePath = path.join(uploadsDir, selectedPiece.photo)
      if (fs.existsSync(filePath)) {
        const buffer = await sharp(filePath)
          .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        anchorParts.push({
          base64: buffer.toString('base64'),
          mime: 'image/jpeg',
          label: `${selectedPiece.name} — hanger photo showing exact print scale, color, texture, and construction detail`,
        })
      }
    }
 
    if (anchorParts.length > 0) {
      // Pass both as a combined anchor — runGPT4oImageGeneration handles the array
      anchorGarmentImage = anchorParts
    }
  } catch (err) {
    console.warn('Could not load anchor garment photos:', err.message)
  }
 
  // ── Primary path: GPT-4o with anchor photo + calibration references ─────────
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const referenceImages = await getCalibrationReferenceImagesForGeneration(3)
    const base64Result = await runGPT4oImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('generate'),
      referenceImages,
      anchorGarmentImage,
    })
    await fs.promises.writeFile(outPath, Buffer.from(base64Result, 'base64'))
    return `/uploads/${filename}`
  } catch (err) {
    console.error('GPT-4o editorial image generation failed, falling back to gpt-image-1:', err.message)
  }
 
  // ── Fallback: gpt-image-1 (no visual reference) ─────────────────────────────
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const result = await runOpenAIImageGeneration({
      client, prompt, size: getOpenAIImageSize('generate'), kind: 'generate'
    })
    const first = result.data?.[0]
    if (first?.b64_json) {
      await fs.promises.writeFile(outPath, Buffer.from(first.b64_json, 'base64'))
      return `/uploads/${filename}`
    }
    if (first?.url) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`image download failed: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer))
      return `/uploads/${filename}`
    }
    throw new Error('No image data in fallback response')
  } catch (fallbackErr) {
    console.error('gpt-image-1 fallback also failed:', fallbackErr.message)
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="48" fill="#3b3128">${escapeXml(direction.title || '')}</text>
      <text x="112" y="1480" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Could not generate: ${escapeXml(fallbackErr.message).slice(0, 120)}</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }
}
 
 
app.post('/api/ai/editorial-directions-preview', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history, seedLook } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)
    const ownedRows = db.prepare('SELECT * FROM pieces ORDER BY id DESC LIMIT 500').all().map(parsePiece)
 
    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const calibrationSummary = getCalibrationReferenceSummary()
    const seedBoard = seedLook?.board || null
    const seedOutfit = seedLook?.outfit || null
    const seedImageUrl = typeof seedBoard?.imageUrl === 'string' ? seedBoard.imageUrl : ''
    if (seedImageUrl.startsWith('/uploads/')) {
      const seedFilePath = path.join(uploadsDir, path.basename(seedImageUrl))
      if (fs.existsSync(seedFilePath)) {
        const { base64, mime } = await prepareImageForClaude(seedFilePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const seedPieces = Array.isArray(seedBoard?.pieces) ? seedBoard.pieces : (Array.isArray(seedOutfit?.pieces) ? seedOutfit.pieces : [])
    const seedMissingPieces = Array.isArray(seedBoard?.missingPieces) ? seedBoard.missingPieces : (Array.isArray(seedOutfit?.missingPieces) ? seedOutfit.missingPieces : [])
    const seedLookSummary = seedLook ? [
      'Rendered wardrobe look to use as a taste seed:',
      `Board title: ${seedBoard?.label || seedBoard?.title || seedOutfit?.label || seedOutfit?.title || 'Wardrobe look'}`,
      seedBoard?.reason || seedOutfit?.reason ? `Why it worked: ${seedBoard?.reason || seedOutfit?.reason}` : '',
      seedOutfit?.silhouette ? `Silhouette: ${seedOutfit.silhouette}` : '',
      seedOutfit?.dominantDirection ? `Direction: ${seedOutfit.dominantDirection}` : '',
      seedPieces.length ? `Owned pieces in the seed look: ${seedPieces.map(p => p?.name || p).filter(Boolean).join(' + ')}` : '',
      seedMissingPieces.length ? `Existing missing-piece notes: ${seedMissingPieces.map(p => p?.name || p).filter(Boolean).join(' + ')}` : '',
      'Use this look as the visual and styling DNA. Suggest ideal new additions that elevate or sharpen it beyond the saved wardrobe board, while keeping the selected garment central.'
    ].filter(Boolean).join('\n') : ''
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Suggest ideal new pieces for this item.'}`,
      seedLookSummary,
      calibrationSummary ? `Renderer calibration library:\n${calibrationSummary}` : '',
      '',
      'Generate only conceptual missing-piece additions. Do not use saved wardrobe pairings except for the selected garment. If the wardrobe already has jeans, olive cargo/utility pants, or similar basics, do not present those as new pieces; suggest more specific/different archetypes.'
    ].filter(Boolean).join('\n') })
 
    const raw = await askStylist({
      system: EDITORIAL_NEW_PIECES_SYSTEM,
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })
 
    let parsed = safeJsonFromModel(raw)
    let directions = Array.isArray(parsed?.directions) ? parsed.directions : []
    if (!directions.length) {
      directions = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => ({
        title: o.label || 'Ideal direction',
        missingPieces: (o.missingPieces || []).map(p => p.name),
        reason: o.reason || '',
        watchFor: o.watchFor || '',
        visualPrompt: o.reason || ''
      }))
    }
    directions = dedupeAndDifferentiateEditorialDirections(directions, selectedPiece, ownedRows)
 
    // Return directions only — NO image generation
    res.json({
      directions: directions.slice(0, 3).map(d => ({
        title: d.title || 'Ideal direction',
        missingPieces: Array.isArray(d.missingPieces) ? d.missingPieces : [],
        reason: d.reason || '',
        watchFor: d.watchFor || '',
        visualPrompt: d.visualPrompt || '',
      })),
      pieceId,
      occasion,
      season,
      provider: AI_PROVIDER,
      mode: 'editorial_directions_preview'
    })
  } catch (err) {
    console.error('Editorial directions preview error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ai/editorial-render-one', async (req, res) => {
  const { pieceId, direction, occasion = 'casual', season = 'current season' } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)
 
    const imageUrl = await createEditorialConceptImage({
      selectedPiece,
      direction,
      index: 1,
      occasion,
      season
    })
 
    res.json({
      imageUrl,
      label: direction.title || 'Rendered direction',
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || '',
      watchFor: direction.watchFor || '',
      mode: 'editorial_render_one'
    })
  } catch (err) {
    console.error('Editorial render-one error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ai/editorial-new-piece-visuals', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)
    const ownedRows = db.prepare('SELECT * FROM pieces ORDER BY id DESC LIMIT 500').all().map(parsePiece)
    const ownedInventorySummary = ownedInventorySummaryForEditorial(pieceId)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    const calibrationSummary = getCalibrationReferenceSummary()
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Suggest ideal new pieces for this item.'}`,
      calibrationSummary ? `Renderer calibration library:\n${calibrationSummary}` : '',
      '',
      'Generate only conceptual missing-piece additions. Do not use saved wardrobe pairings except for the selected garment. If the wardrobe already has jeans, olive cargo/utility pants, or similar basics, do not present those as new pieces; suggest more specific/different archetypes.'
    ].filter(Boolean).join('\n') })

    const raw = await askStylist({
      system: EDITORIAL_NEW_PIECES_SYSTEM,
      maxTokens: 1200,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })

    let parsed = safeJsonFromModel(raw)
    let directions = Array.isArray(parsed?.directions) ? parsed.directions : []
    if (!directions.length) {
      directions = buildIdealOnlyCompletionsForPiece(selectedPiece).map(o => ({
        title: o.label || 'Ideal direction',
        missingPieces: (o.missingPieces || []).map(p => p.name),
        reason: o.reason || '',
        watchFor: o.watchFor || '',
        visualPrompt: o.reason || ''
      }))
    }
    directions = dedupeAndDifferentiateEditorialDirections(directions, selectedPiece, ownedRows)

    const visuals = []
    for (const [idx, direction] of directions.slice(0, 3).entries()) {
      const imageUrl = await createEditorialConceptImage({ selectedPiece, direction, index: idx + 1, occasion, season })
      visuals.push({
        label: direction.title || `Ideal direction ${idx + 1}`,
        reason: direction.reason || '',
        watchFor: direction.watchFor || '',
        missingPieces: Array.isArray(direction.missingPieces) ? direction.missingPieces : [],
        imageUrl,
        mode: 'editorial_new_piece_visual'
      })
    }
    res.json({ visuals, provider: AI_PROVIDER, mode: 'editorial_new_piece_visuals' })
  } catch (err) {
    console.error('Editorial new-piece visuals error:', err)
    res.status(500).json({ error: err.message })
  }
})




// ── AI: Identity-preserving photo edits for selected garment ─────────────────
function getPiecePhotoPath(piece, preferWorn = true) {
  const photo = preferWorn ? (piece.worn_photo || piece.photo) : (piece.photo || piece.worn_photo)
  if (!photo) return null
  const filePath = path.join(uploadsDir, photo)
  return fs.existsSync(filePath) ? filePath : null
}

function imageUrlToUploadPath(imageUrl) {
  const value = String(imageUrl || '')
  const filename = value.startsWith('/uploads/') ? value.replace('/uploads/', '') : path.basename(value)
  if (!filename || filename.includes('..')) return null
  const filePath = path.join(uploadsDir, filename)
  return fs.existsSync(filePath) ? filePath : null
}

function getCalibrationSourcePhotoPath() {
  try {
    const rows = db.prepare(`
      SELECT * FROM calibration_images
      WHERE COALESCE(archived,0) = 0
        AND kind IN ('real_photo', 'good_reference')
      ORDER BY
        CASE WHEN kind = 'real_photo' THEN 0 ELSE 1 END,
        COALESCE(favorite,0) DESC,
        id DESC
      LIMIT 12
    `).all()
    for (const row of rows) {
      const filePath = imageUrlToUploadPath(row.image_url)
      if (filePath) {
        return {
          path: filePath,
          label: row.kind === 'real_photo'
            ? (row.favorite ? 'calibration real photo marked Use strongly' : 'calibration real outfit photo')
            : (row.favorite ? 'good calibration reference marked Use strongly' : 'good calibration reference'),
          row: normalizeCalibrationRow(row)
        }
      }
    }
  } catch (err) {
    console.warn('Calibration source lookup failed:', err.message)
  }
  return null
}

function chooseIdentityEditSource(piece) {
  const worn = piece?.worn_photo ? getPiecePhotoPath({ ...piece, photo: null }, true) : null
  if (worn) return { path: worn, label: 'selected garment worn photo', kind: 'garment_worn' }

  const calibration = getCalibrationSourcePhotoPath()
  if (calibration) return { ...calibration, kind: 'calibration' }

  const garment = piece?.photo ? getPiecePhotoPath({ ...piece, worn_photo: null }, false) : null
  if (garment) return { path: garment, label: 'selected garment hanger/photo fallback', kind: 'garment_photo' }

  return null
}

function identityEditPrompt({ selectedPiece, direction, occasion, season, sourceLabel }) {
  const missing = Array.isArray(direction.missingPieces) ? direction.missingPieces.join(', ') : ''
  const pieceDesc = [
    selectedPiece.name,
    selectedPiece.category,
    selectedPiece.colors ? `colors: ${selectedPiece.colors}` : '',
    selectedPiece.fabric ? `fabric: ${selectedPiece.fabric}` : '',
    selectedPiece.notes ? `notes: ${String(selectedPiece.notes).slice(0, 700)}` : ''
  ].filter(Boolean).join('; ')
  const anchorRules = anchorFidelityInstructions(selectedPiece)
  const calibrationSummary = getCalibrationReferenceSummary(12)

  return [
    'Edit the provided real mirror/photo reference. This is an observation-preserving clothing edit, NOT a synthetic portrait, NOT a new model, and NOT an editorial re-creation.',
    `SOURCE PHOTO: ${sourceLabel || 'real reference photo'}. The source photo is the authority for body geometry and identity. Preserve the same person and the same physical geometry: face, hair, age read, head size, neck length, shoulder slope, shoulder width, bust/torso width, torso length, waist ambiguity, hip width, thigh/leg proportions, arm size, stance, weight distribution, posture asymmetry, camera angle, lighting, background, and lived-in photo realism.`,
    'Do NOT optimize the body. Do NOT lengthen the torso or legs. Do NOT narrow hips/thighs. Do NOT shrink the waist. Do NOT broaden or square the shoulders. Do NOT straighten posture. Do NOT make the person taller, thinner, younger, smoother, more symmetrical, more elegant, more polished, more catalog-ready, or more conventionally flattering.',
    'If the source photo already shows the selected anchor garment, preserve it as visual truth. If the source photo is a calibration fallback and does not show the selected garment, use the source only for body/posture/identity and introduce the selected garment conservatively without changing the person geometry. Keep garment fit, looseness/fittedness, length, neckline, sleeve length, print/stripe scale, fabric behavior, hem behavior, wrinkles, slight tension, and visual weight. Do not clean it up into ideal tailoring.',
    `ANCHOR GARMENT: ${pieceDesc}.`,
    anchorRules ? `Anchor-specific fidelity: ${anchorRules}` : '',
    'Change only the supporting styling pieces needed for the concept. Treat this like trying different clothes on the same real photo. If the edit cannot preserve the person and anchor garment, make a minimal edit rather than regenerating the full person.',
    'Do NOT repaint the face, arms, neck, shoulders, or body mass. Preserve facial angularity, actual jaw/cheek planes, real shoulder slope, real arm width, real torso width, real hip/thigh relationship, and the exact stance from the source. No beauty smoothing, no soft-body rounding, no chubby cartoon effect, no plastic skin, no AI eyes.',
    'Keep natural mirror-photo imperfections: asymmetry, relaxed stance, imperfect drape, real textile collapse, non-model posture, and ordinary room lighting. These are identity features, not problems to fix.',
    'Preserve angular relaxed tension when present: off-center ease, directional body line, garment pull, cuffs, shadows, and shoe grounding. Do not replace it with front-facing passive catalog posture.',
    `Suggested additions to test: ${missing}.`,
    direction.visualPrompt ? `Visual direction: ${direction.visualPrompt}` : '',
    direction.reason ? `Stylist logic: ${direction.reason}` : '',
    calibrationSummary ? `Use this calibration library as identity guidance and anti-drift memory, not as outfits to copy:
${calibrationSummary}` : '',
    'Style target: relaxed structure with artistic intelligence; restrained artistic modernism; grounded but not passive; contemporary, authentic, visually self-directed. Prefer dark grounded columns, sharper footwear, directional accessories, controlled contrast, and one strong silhouette idea over polite neutral harmony.',
    'Avoid: librarian/school-teacher styling, mature catalog drift, Santa Fe/boho stereotype, lifestyle-brand softness, influencer polish, excessive scarves/cardigans, excessive neatness, generic elegance, passive comfortwear, soft cream/taupe sludge, and over-smoothed mature-casual styling.',
    'Hard anti-drift rule: do not convert relaxed structure into tailoring, do not convert artistic tension into accessories, do not convert comfort into passivity, and do not resolve silhouette ambiguity into a safe catalog look.',
    `Occasion/season: ${occasion} / ${season}.`,
    'Return only the edited realistic image. No text, labels, watermarks, extra people, product tags, or split-screen layout.'
  ].filter(Boolean).join('\n')
}

async function createIdentityPreservingEditImage({ sourcePath, sourceLabel, selectedPiece, direction, index, occasion, season }) {
  const prompt = identityEditPrompt({ selectedPiece, direction, occasion, season, sourceLabel })
  const filename = `generated-boards/identity-edit-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  if (photoPreservingVisualsEnabled()) {
    return createPhotoPreservingCollageImage({
      title: direction.title || `Identity edit ${index}`,
      subtitle: `identity edit · ${sourceLabel || 'source photo'} preserved`,
      sourcePath,
      selectedPiece,
      missingPieces: direction.missingPieces || [],
      reason: direction.reason || 'Shows the real source photo alongside the selected garment and suggested additions instead of repainting the person.',
      index,
      prefix: 'identity-collage'
    })
  }

  if (!process.env.OPENAI_API_KEY) {
    const title = escapeXml(direction.title || `Identity edit ${index}`)
    const pieces = escapeXml((direction.missingPieces || []).join(' + '))
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="230" font-family="Arial, sans-serif" font-size="26" fill="#7b6a59">Identity-preserving edit placeholder</text>
      <foreignObject x="112" y="300" width="800" height="260"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 34px; line-height: 1.35; color:#3b3128;">${pieces}</div></foreignObject>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Image editing unavailable.</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const result = await runOpenAIImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('identity'),
      kind: 'edit',
      imagePath: sourcePath
    })
    const first = result.data?.[0]
    if (first?.b64_json) {
      await fs.promises.writeFile(outPath, Buffer.from(first.b64_json, 'base64'))
      return `/uploads/${filename}`
    }
    if (first?.url) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`image download failed: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer))
      return `/uploads/${filename}`
    }
    throw new Error('No image data returned')
  } catch (err) {
    console.error('Identity edit generation failed:', err.message)
    const title = escapeXml(direction.title || `Identity edit ${index}`)
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Could not edit image: ${escapeXml(err.message).slice(0, 120)}</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }
}

app.post('/api/ai/identity-edit-visuals', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })

    const sourceInfo = chooseIdentityEditSource(piece)
    if (!sourceInfo?.path) {
      return res.status(400).json({ error: 'Identity-preserving edits need either a selected garment worn photo, a Calibration Library real photo/good reference, or a garment photo.' })
    }
    const sourcePath = sourceInfo.path

    const selectedPiece = parsePiece(piece)
    const content = []
    const { base64, mime } = await prepareImageForClaude(sourcePath)
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Create identity-preserving styling edits for this selected item.'}`,
      '',
      'Generate exactly three styling directions for editing the provided real photo. Do not make wardrobe pairings. Each direction should suggest conceptual additions only. Keep the selected garment as the anchor. The edit must preserve the real person/photo geometry; choose additions that can be shown without changing body proportions, posture, age read, or garment fit. Prioritize visual composition over pleasant harmony: at least one dark grounded column, one structured/earthy tension option, and one controlled contrast option. Avoid scarves/cardigans as default maturity signals, soft cream/taupe sludge, polite slip-ons, and generic mature-casual elegance.'
    ].join('\n') })

    let directions = []
    try {
      const raw = await askStylist({
        system: EDITORIAL_NEW_PIECES_SYSTEM,
        maxTokens: 1300,
        messages: [
          ...(history || []).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content }
        ]
      })
      const parsed = safeJsonFromModel(raw)
      directions = normalizeEditorialDirections(parsed?.directions || [])
    } catch (err) {
      console.error('Identity edit direction model failed:', err.message)
    }

    if (!directions.length) directions = buildIdealOnlyCompletionsForPiece(selectedPiece).slice(0, 3)
    if (!directions.length) directions = defaultCalibrationVariations(selectedPiece)
    directions = directions.slice(0, 3).map((d, idx) => ({
      title: d.title || ['Identity-preserving edit A', 'Identity-preserving edit B', 'Identity-preserving edit C'][idx],
      missingPieces: Array.isArray(d.missingPieces) ? d.missingPieces.map(p => p.name || p).filter(Boolean) : [],
      reason: d.reason || '',
      watchFor: d.watchFor || '',
      visualPrompt: d.visualPrompt || d.reason || ''
    }))

    const visuals = []
    for (const [idx, direction] of directions.entries()) {
      const imageUrl = await createIdentityPreservingEditImage({ sourcePath, sourceLabel: sourceInfo.label, selectedPiece, direction, index: idx + 1, occasion, season })
      visuals.push({
        label: direction.title || `Identity edit ${idx + 1}`,
        reason: direction.reason || '',
        watchFor: direction.watchFor || '',
        missingPieces: direction.missingPieces || [],
        imageUrl,
        mode: 'identity_edit',
        calibration: {
          rendererVersion: 'v36',
          source: 'real_photo_edit',
          identityPreserving: true
        }
      })
    }

    res.json({ visuals, provider: AI_PROVIDER, mode: 'identity_edit' })
  } catch (err) {
    console.error('Identity edit visuals error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Renderer calibration boards for selected garment ─────────────────────
const RENDERER_CALIBRATION_SYSTEM = `You are Yuna's renderer calibration stylist.
Your job is to generate THREE controlled visual variations for the same selected garment so the user can compare renderer direction.

Return ONLY valid JSON. No markdown.

Core goal:
- Do NOT try to predict one perfect outfit.
- Generate three plausible calibrated directions that differ subtly and intentionally.
- The selected garment is the locked anchor and must remain visually recognizable.

Use the calibration spec:
- Preserve identity, body realism, garment truth, and artistic modernism.
- Avoid artistic-woman archetypes, librarian/school-teacher capsule styling, retirement-catalog neutrality, Santa Fe boho, lifestyle-brand softness, influencer polish, and excessive tasteful maturity.
- Preserve a modern person with artistic sensibility, not an artistic woman stereotype.

All variations must preserve:
- actual anchor garment category, neckline, sleeve length, print/stripe scale, color relationship, fit, and length
- believable mature proportions and natural posture
- real fabric behavior and lived-in ease
- relaxed structure with artistic intelligence

Variation A: softer restrained
- relaxed structure
- lighter grounding
- softer architectural line
- lower visual tension
- still avoid passive softness and boho drift

Variation B: balanced artistic modern
- strongest likely baseline
- grounded, wearable, contemporary, edited
- controlled artistic tension
- compact-to-grounded proportion logic

Variation C: sharper architectural
- stronger lower-half anchor
- cleaner vertical line
- more visual confidence
- restrained intellectual silhouette
- still not hard tailoring or fashion fantasy

JSON shape:
{
  "variations": [
    {
      "variation": "A",
      "title": "Softer restrained",
      "silhouetteLabel": "soft structure / medium grounding",
      "missingPieces": ["specific suggested addition", "specific suggested addition"],
      "reason": "one sentence explaining what this variation tests",
      "watchFor": "one brief drift risk",
      "visualPrompt": "specific full-outfit visual direction, no text in image"
    }
  ]
}`

function calibrationImagePrompt({ selectedPiece, variation, occasion, season }) {
  const base = editorialImagePrompt({ selectedPiece, direction: variation, occasion, season })
  const variationType = String(variation.variation || variation.title || '').toUpperCase()
  const extra = []
  extra.push('CALIBRATION MODE: This image is one of three controlled renderer variations. It should test a specific silhouette/energy direction, not invent a random outfit.')
  if (variationType.includes('A')) {
    extra.push('Variation A weighting: softer restrained, relaxed structure, medium-light grounding, slightly softer drape, but do not become passive, boho, sweet, or mature-catalog.')
  } else if (variationType.includes('B')) {
    extra.push('Variation B weighting: balanced artistic modern baseline, grounded and edited, likely strongest everyday artistic direction, with contemporary presence and controlled tension.')
  } else if (variationType.includes('C')) {
    extra.push('Variation C weighting: sharper architectural, stronger lower-half anchor, cleaner vertical line, more intentional structure and visual confidence, but no fashion fantasy or hard corporate tailoring.')
  }
  extra.push('The comparison should be visible: A/B/C should differ in grounding, structure, and artistic tension while preserving the same anchor garment truth.')
  return [base, ...extra].join('\n')
}

async function createCalibrationConceptImage({ selectedPiece, variation, index, occasion, season }) {
  const prompt = calibrationImagePrompt({ selectedPiece, variation, occasion, season })
  const filename = `generated-boards/calibration-${Date.now()}-${index}-${Math.round(Math.random() * 1e6)}.png`
  const outPath = path.join(uploadsDir, filename)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
 
  // No API key — SVG placeholder
  if (!process.env.OPENAI_API_KEY) {
    const title  = escapeXml(`${variation.variation || String.fromCharCode(64 + index)} · ${variation.title || 'Calibration variation'}`)
    const pieces = escapeXml((variation.missingPieces || []).join(' + '))
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="230" font-family="Arial, sans-serif" font-size="26" fill="#7b6a59">Renderer calibration placeholder</text>
      <foreignObject x="112" y="300" width="800" height="260"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, sans-serif; font-size: 34px; line-height: 1.35; color:#3b3128;">${pieces}</div></foreignObject>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Image generation unavailable.</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }
 
  // ── Primary path: GPT-4o with visual calibration references ────────────────
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const referenceImages = await getCalibrationReferenceImagesForGeneration(3)
    const base64Result = await runGPT4oImageGeneration({
      client,
      prompt,
      size: getOpenAIImageSize('generate'),
      referenceImages,
    })
    await fs.promises.writeFile(outPath, Buffer.from(base64Result, 'base64'))
    return `/uploads/${filename}`
  } catch (err) {
    console.error('GPT-4o calibration image generation failed, falling back to gpt-image-1:', err.message)
  }
 
  // ── Fallback: gpt-image-1 without visual reference ─────────────────────────
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const result = await runOpenAIImageGeneration({
      client, prompt, size: getOpenAIImageSize('generate'), kind: 'generate'
    })
    const first = result.data?.[0]
    if (first?.b64_json) {
      await fs.promises.writeFile(outPath, Buffer.from(first.b64_json, 'base64'))
      return `/uploads/${filename}`
    }
    if (first?.url) {
      const response = await fetch(first.url)
      if (!response.ok) throw new Error(`image download failed: ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      await fs.promises.writeFile(outPath, Buffer.from(arrayBuffer))
      return `/uploads/${filename}`
    }
    throw new Error('No image data in fallback response')
  } catch (fallbackErr) {
    console.error('gpt-image-1 calibration fallback also failed:', fallbackErr.message)
    const title = escapeXml(`${variation.variation || String.fromCharCode(64 + index)} · ${variation.title || 'Calibration variation'}`)
    const svg = `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1536" fill="#f5efe7"/>
      <rect x="72" y="72" width="880" height="1392" rx="34" fill="#fffaf4" stroke="#d8c9b7" stroke-width="3"/>
      <text x="112" y="160" font-family="Georgia, serif" font-size="46" fill="#3b3128">${title}</text>
      <text x="112" y="1385" font-family="Arial, sans-serif" font-size="24" fill="#9a8774">Could not generate image: ${escapeXml(fallbackErr.message).slice(0, 120)}</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(outPath)
    return `/uploads/${filename}`
  }
}

function defaultCalibrationVariations(selectedPiece) {
  const base = buildIdealOnlyCompletionsForPiece(selectedPiece)
  const source = base.length ? base : [{ missingPieces: [], reason: '' }]
  return ['A', 'B', 'C'].map((letter, idx) => {
    const fallback = source[idx % source.length]
    const missingPieces = (fallback.missingPieces || []).map(p => p.name || p).filter(Boolean)
    return {
      variation: letter,
      title: letter === 'A' ? 'Softer restrained' : letter === 'B' ? 'Balanced artistic modern' : 'Sharper architectural',
      silhouetteLabel: letter === 'A' ? 'soft structure / medium grounding' : letter === 'B' ? 'grounded edited baseline' : 'architectural / stronger anchor',
      missingPieces: missingPieces.length ? missingPieces : ['specific grounded support piece', 'specific stabilizing shoe'],
      reason: letter === 'A'
        ? 'Tests whether a softer version can stay intentional without drifting passive.'
        : letter === 'B'
          ? 'Tests the most balanced grounded artistic direction.'
          : 'Tests a sharper architectural version with stronger lower-half weight.',
      watchFor: letter === 'A' ? 'Too soft or mature-catalog drift.' : letter === 'B' ? 'Too generic if the pieces become basic.' : 'Too severe or over-styled.',
      visualPrompt: fallback.reason || ''
    }
  })
}

app.post('/api/ai/generate-calibration-boards', async (req, res) => {
  const { pieceId, occasion = 'casual', season = 'current season', question, history } = req.body
  try {
    const piece = db.prepare('SELECT * FROM pieces WHERE id = ?').get(pieceId)
    if (!piece) return res.status(404).json({ error: 'Piece not found' })
    const selectedPiece = parsePiece(piece)

    const content = []
    const photoFile = piece.worn_photo || piece.photo
    if (photoFile) {
      const filePath = path.join(uploadsDir, photoFile)
      if (fs.existsSync(filePath)) {
        const { base64, mime } = await prepareImageForClaude(filePath)
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
      }
    }
    content.push({ type: 'text', text: [
      `Selected garment truth:\n${buildPieceText(selectedPiece)}`,
      `Occasion: ${occasion}`,
      `Season: ${season}`,
      `User request: ${question || 'Generate renderer calibration variations.'}`,
      '',
      'Generate exactly three controlled renderer variations: A softer restrained, B balanced artistic modern, C sharper architectural. Use conceptual supporting pieces, not saved wardrobe pairings. Preserve the selected garment as visual truth.'
    ].join('\n') })

    let variations = []
    try {
      const raw = await askStylist({
        system: RENDERER_CALIBRATION_SYSTEM,
        maxTokens: 1200,
        messages: [
          ...(history || []).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content }
        ]
      })
      const parsed = safeJsonFromModel(raw)
      variations = Array.isArray(parsed?.variations) ? parsed.variations : []
    } catch (err) {
      console.error('Calibration variation model failed:', err.message)
    }

    if (!variations.length) variations = defaultCalibrationVariations(selectedPiece)
    variations = variations.slice(0, 3).map((v, idx) => ({
      variation: v.variation || ['A', 'B', 'C'][idx],
      title: v.title || ['Softer restrained', 'Balanced artistic modern', 'Sharper architectural'][idx],
      silhouetteLabel: v.silhouetteLabel || '',
      missingPieces: Array.isArray(v.missingPieces) ? v.missingPieces : [],
      reason: v.reason || '',
      watchFor: v.watchFor || '',
      visualPrompt: v.visualPrompt || ''
    }))

    const visuals = []
    for (const [idx, variation] of variations.entries()) {
      const imageUrl = await createCalibrationConceptImage({ selectedPiece, variation, index: idx + 1, occasion, season })
      visuals.push({
        label: `${variation.variation || String.fromCharCode(65 + idx)} · ${variation.title || 'Calibration variation'}`,
        variation: variation.variation || String.fromCharCode(65 + idx),
        silhouetteLabel: variation.silhouetteLabel || '',
        reason: variation.reason || '',
        watchFor: variation.watchFor || '',
        missingPieces: variation.missingPieces || [],
        imageUrl,
        mode: 'renderer_calibration',
        calibration: {
          variationType: variation.title || '',
          silhouetteLabel: variation.silhouetteLabel || '',
          rendererVersion: 'v32'
        }
      })
    }
    res.json({ visuals, provider: AI_PROVIDER, mode: 'renderer_calibration' })
  } catch (err) {
    console.error('Calibration boards error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Compare two saved outfits ─────────────────────────────────────────────
app.post('/api/ai/compare-outfits', async (req, res) => {
  const { outfitAId, outfitBId, question, history } = req.body
  const outfitA = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitAId)
  const outfitB = db.prepare('SELECT * FROM outfits WHERE id = ?').get(outfitBId)
  if (!outfitA || !outfitB) return res.status(404).json({ error: 'One or both outfits were not found' })

  try {
    const content = []

    const addOutfitImage = async (label, outfit) => {
      if (!outfit.photo) return
      const filePath = path.join(uploadsDir, outfit.photo)
      if (!fs.existsSync(filePath)) return
      const { base64, mime } = await prepareImageForClaude(filePath)
      content.push({ type: 'text', text: `${label} image:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } })
    }

    await addOutfitImage('Outfit A', outfitA)
    await addOutfitImage('Outfit B', outfitB)

    const linkedA = getLinkedPiecesForOutfit(outfitA.id)
    const linkedB = getLinkedPiecesForOutfit(outfitB.id)
    const likelyA = linkedA.length ? [] : findLikelyPiecesForOutfit(outfitA)
    const likelyB = linkedB.length ? [] : findLikelyPiecesForOutfit(outfitB)
    const confirmedOutfitsText = getConfirmedOutfitMemory()

    content.push({ type: 'text', text: [
      `Mode: compare_outfits`,
      `Question: ${question || 'Which outfit works better for Yuna?'}`,
      '',
      `Outfit A context:`,
      buildOutfitAuthorityNote(outfitA, linkedA, likelyA),
      buildOutfitText(outfitA, linkedA),
      likelyA.length ? `Likely saved garment truth for Outfit A — hints only unless linked:\n${likelyA.map(buildPieceText).join('\n')}` : '',
      '',
      `Outfit B context:`,
      buildOutfitAuthorityNote(outfitB, linkedB, likelyB),
      buildOutfitText(outfitB, linkedB),
      likelyB.length ? `Likely saved garment truth for Outfit B — hints only unless linked:\n${likelyB.map(buildPieceText).join('\n')}` : '',
      '',
      confirmedOutfitsText ? `Other confirmed outfit memory for Yuna's taste filter:\n${confirmedOutfitsText}` : '',
      '',
      `Comparison instruction: make a call if one outfit is clearly stronger. If both work, explain the different use cases. If neither works, identify the shared issue. Do not give a vague "both are nice" answer.`
    ].filter(Boolean).join('\n') })

    const answer = await askStylist({
      system: COMPARE_OUTFITS_SYSTEM,
      maxTokens: 1400,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content }
      ]
    })

    res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'compare_outfits' })
  } catch (err) {
    console.error('Compare outfits error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: Outfit Feedback (with optional photo) ──────────────────────────────────
app.post('/api/ai/outfit-feedback', upload.single('photo'), async (req, res) => {
  try {
    const { question, outfitName, outfitNotes } = req.body
    const content = []

    if (req.file) {
      const tempPath = path.join(uploadsDir, req.file.filename)
      const { base64: imgBase64, mime: imgMime } = await prepareImageForClaude(tempPath)
      content.push({ type: 'image', source: { type: 'base64', media_type: imgMime, data: imgBase64 } })
      fs.unlinkSync(tempPath)
    }

    const activeWardrobeText = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece).map(buildPieceText).join('\n')
    const confirmedOutfitsText = getConfirmedOutfitMemory()

    content.push({ type: 'text', text: [
      `Mode: evaluate_uploaded_outfit_photo`,
      outfitName ? `Outfit: "${outfitName}"` : '',
      outfitNotes ? `User notes / corrected truth: ${outfitNotes}` : '',
      confirmedOutfitsText ? `Confirmed outfit memory:\n${confirmedOutfitsText}` : '',
      activeWardrobeText ? `Active wardrobe truth, for identifying likely saved garments and avoiding wrong guesses:\n${activeWardrobeText}` : '',
      question || 'What do you think of this outfit? Does it work well together?'
    ].filter(Boolean).join('\n') })

    const draft = await askStylist({
      system: EVALUATE_OUTFIT_SYSTEM + '\n\n' + EVALUATE_OUTFIT_FEW_SHOTS,
      maxTokens: 1200,
      messages: [{ role: 'user', content }]
    })
    const answer = await criticPassForOutfit({
      draft,
      userQuestion: question,
      outfitText: [outfitName ? `Outfit: ${outfitName}` : '', outfitNotes ? `Notes: ${outfitNotes}` : ''].filter(Boolean).join('\n'),
      mode: 'evaluate_uploaded_outfit_photo'
    })
    res.json({ feedback: answer, provider: AI_PROVIDER, mode: 'evaluate_uploaded_outfit_photo' })
  } catch (err) {
    console.error('AI error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── AI: General wardrobe query (with conversation history) ────────────────────
app.post('/api/ai/ask', async (req, res) => {
  try {
    const { question, pieces, history } = req.body
    const wardrobeText = (pieces || []).map(buildPieceText).join('\n')
    const confirmedOutfitsText = getConfirmedOutfitMemory()

    const system = STYLIST_SYSTEM + [
      '',
      'CURRENT WARDROBE TRUTH:',
      wardrobeText,
      '',
      confirmedOutfitsText ? `CONFIRMED / FAVORITE OUTFIT MEMORY:\n${confirmedOutfitsText}` : ''
    ].filter(Boolean).join('\n')

    const answer = await askStylist({
      system,
      maxTokens: 1500,
      messages: [
        ...(history || []).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: question }
      ]
    })
    res.json({ answer, provider: AI_PROVIDER })
  } catch (err) {
    console.error('AI error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Catch-all: serve React app (production only) ──────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`\n🧥 Wardrobe app → http://localhost:${PORT}\n`)
})
