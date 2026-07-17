import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { STYLIST_TOOLS } from '../styling-engine/tools.js'
import { ACTIVITY_PROFILES } from '../styling-engine/footwear-comfort.js'
import { STYLIST_SYSTEM } from '../styling-engine/prompts.js'
import {
  OCCASION_VALUES,
  ACTIVITY_VALUES,
  MISSION_VALUES,
  normalizeActivity,
  extractWeatherContext,
  normalizeMission,
  normalizeOccasion,
  normalizeStylingIntent,
  tripRequestNeedsScopeClarification,
  travelRequestCanResolveWeatherLive
} from '../styling-engine/stylingIntent.js'

function extractOptionValues(content, constName) {
  const match = content.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\]`))
  assert.ok(match, `${constName} must be defined`)
  return [...match[1].matchAll(/'([^']+)'\s*,\s*'[^']+'/g)].map(m => m[1])
}

function captureWarns(fn) {
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = originalWarn
  }
}

test('styling intent vocabulary matches frontend menus and activity profiles', () => {
  const chatPath = path.join(import.meta.dirname, '../src/components/StylistChat.jsx')
  const content = fs.readFileSync(chatPath, 'utf8')
  const frontendOccasions = extractOptionValues(content, 'OCCASION_OPTIONS')
  const frontendActivities = extractOptionValues(content, 'ACTIVITY_OPTIONS')
  const activityProfileIds = ACTIVITY_PROFILES.map(p => p.id)

  assert.deepEqual(OCCASION_VALUES, frontendOccasions)
  assert.deepEqual(ACTIVITY_VALUES, frontendActivities)
  assert.deepEqual(ACTIVITY_VALUES.filter(v => v !== 'none'), activityProfileIds)
})

test('generate_outfits schema exposes styling intent enums', () => {
  const generateTool = STYLIST_TOOLS.find(t => t.name === 'generate_outfits')
  const searchTool = STYLIST_TOOLS.find(t => t.name === 'search_wardrobe')
  const proposeTool = STYLIST_TOOLS.find(t => t.name === 'propose_outfit')
  const planTool = STYLIST_TOOLS.find(t => t.name === 'plan_outfit_set')
  assert.ok(generateTool, 'generate_outfits tool must exist')
  assert.deepEqual(generateTool.input_schema.properties.occasion.enum, OCCASION_VALUES)
  assert.deepEqual(generateTool.input_schema.properties.activity.enum, ACTIVITY_VALUES)
  assert.deepEqual(generateTool.input_schema.properties.mission.enum, MISSION_VALUES)
  assert.deepEqual(generateTool.input_schema.required, ['occasion', 'season'])
  assert.ok(!generateTool.input_schema.required.includes('activity'), 'activity omission must remain meaningful')

  assert.ok(searchTool.input_schema.properties.weather, 'search_wardrobe should accept weather for fit flags')
  assert.deepEqual(searchTool.input_schema.properties.activity.enum, ACTIVITY_VALUES)
  assert.ok(searchTool.input_schema.properties.visual, 'search_wardrobe should accept visual mode')
  assert.ok(proposeTool, 'propose_outfit tool must exist')
  assert.ok(planTool, 'plan_outfit_set tool must exist')
  assert.ok(!STYLIST_TOOLS.some(t => t.name === 'render_outfit'), 'render_outfit must be retired')
  assert.deepEqual(proposeTool.input_schema.properties.occasion.enum, OCCASION_VALUES)
  assert.deepEqual(proposeTool.input_schema.required, ['pieces'])
  assert.ok(proposeTool.input_schema.properties.pieces.items.properties.role.enum.includes('primary_top'), 'propose_outfit pieces carry a role enum')
  assert.match(proposeTool.description, /ONE (complete, )?coherent outfit/, 'propose_outfit is one outfit, not a roster group')
  assert.match(proposeTool.description, /NEVER pass multiple pieces of the same role/, 'propose_outfit forbids same-role groups')
  assert.match(planTool.input_schema.properties.slots.description, /10-14 cards for a 24-piece capsule/, '24-piece seasonal capsules should request a representative outfit rotation')
})

test('normalize styling intent defaults and preserves valid values', () => {
  assert.equal(normalizeOccasion('gallery / art event'), 'gallery / art event')
  assert.equal(normalizeOccasion('Evening'), 'evening')
  assert.equal(normalizeOccasion('dinner'), 'evening')
  assert.equal(normalizeOccasion('wine bar'), 'evening')
  assert.equal(normalizeOccasion('wedding'), 'evening')
  assert.equal(normalizeOccasion('brunch'), 'city')
  assert.equal(normalizeOccasion('gallery'), 'gallery / art event')
  assert.equal(normalizeOccasion('outdoor_daytime_social'), 'outdoor_daytime_social')
  assert.equal(normalizeOccasion('outdoor daytime social'), 'outdoor_daytime_social')
  assert.equal(normalizeOccasion('wine festival'), 'outdoor_daytime_social')
  assert.equal(normalizeActivity('walking'), 'walking')
  assert.equal(normalizeActivity('hiking'), 'hiking')
  assert.equal(normalizeMission('capsule'), 'capsule')

  const invalidOccasion = captureWarns(() => normalizeOccasion('date night'))
  assert.equal(invalidOccasion.result, 'casual')
  assert.ok(invalidOccasion.warnings.some(w => w.includes('off-vocabulary occasion "date night"')))

  const invalidActivity = captureWarns(() => normalizeActivity('dancing'))
  assert.equal(invalidActivity.result, 'none')
  assert.ok(invalidActivity.warnings.some(w => w.includes('off-vocabulary activity "dancing"')))

  assert.equal(normalizeActivity(''), 'none')
  assert.equal(normalizeMission('editorial'), 'mix')
  assert.deepEqual(normalizeStylingIntent({
    occasion: 'city',
    season: '',
    mood: '  earthy structure  ',
    mission: 'wildcard'
  }), {
    occasion: 'city',
    season: 'current season',
    mood: 'earthy structure',
    mission: 'wildcard'
  })
})

test('extractWeatherContext captures lightweight forecast phrases', () => {
  assert.equal(extractWeatherContext("They say it'll be pretty hot during the day"), 'hot weather')
  assert.equal(extractWeatherContext('The forecast is mid 80s to 90 degrees'), '90 degrees')
  assert.equal(extractWeatherContext('Expect rain and wind'), 'rainy weather')
  assert.equal(extractWeatherContext('Portland in a few days'), '')
})

test('stylist prompt proposes via propose_outfit and narrows visual tool triggers', () => {
  assert.ok(STYLIST_SYSTEM.includes('Proposing Outfits (default)'))
  assert.ok(STYLIST_SYSTEM.includes("Do not call 'generate_outfits' for ordinary styling advice"))
  assert.ok(STYLIST_SYSTEM.includes("call 'search_wardrobe' with `visual: true`"))
  assert.ok(STYLIST_SYSTEM.includes('A packing list or garment inventory may appear only as a secondary recap after the proposed outfits'))
  assert.ok(STYLIST_SYSTEM.includes('it must never replace them unless the user explicitly asks for a checklist only'))
  assert.ok(STYLIST_SYSTEM.includes('color harmony, print scale, texture, visual weight, and proportion'))
  assert.ok(STYLIST_SYSTEM.includes('run a fresh visual \'search_wardrobe\' scoped to that need'))
  assert.ok(STYLIST_SYSTEM.includes('cover each stated occasion/use case as a separate proposed outfit'))
  assert.ok(STYLIST_SYSTEM.includes('Do not collapse distinct stated needs into one generic list'))
  assert.ok(STYLIST_SYSTEM.includes('Anchor-Piece Recomposition'))
  assert.ok(STYLIST_SYSTEM.includes('treat that garment as a locked anchor'))
  assert.ok(STYLIST_SYSTEM.includes('compose fresh outfits around the anchor'))
  assert.ok(STYLIST_SYSTEM.includes('Do not merely substitute the anchor into prior outfits'))
  assert.ok(STYLIST_SYSTEM.includes('For shoe anchors, rebuild the outfit color story, formality, and occasion around the shoes'))
  assert.ok(STYLIST_SYSTEM.includes('Top-Layer Anchor Requests'))
  assert.ok(STYLIST_SYSTEM.includes('keep that exact garment locked as `layer_top`'))
  // Step 6 build 6 — plan_outfit_set decomposition guidance.
  assert.ok(STYLIST_SYSTEM.includes('Planning a Coordinated Multi-Outfit Set'))
  assert.ok(STYLIST_SYSTEM.includes("compose the whole set in a single 'plan_outfit_set' call on the initial planning turn"))
  assert.ok(STYLIST_SYSTEM.includes('YOU decompose the request into slots'))
  assert.ok(STYLIST_SYSTEM.includes('so each slot resolves its OWN live forecast'))
  assert.ok(STYLIST_SYSTEM.includes("\`reuse:'diversify'\` with \`no_repeat:['tops']\`"))
  assert.ok(STYLIST_SYSTEM.includes("'plan_outfit_set' for the initial multi-slot plan, 'propose_outfit' for one specific outfit"))
  // Reinforcement: an at-home multi-day plan must route to the tool on the
  // calendar season, not stall on a weather question (live finding: the model
  // asked for weather instead of composing).
  assert.ok(STYLIST_SYSTEM.includes('Do NOT stall a multi-day plan with a weather question when no place is named'))
  assert.ok(STYLIST_SYSTEM.includes("call 'plan_outfit_set' NOW, proceeding on the calendar season inferred from today's date"))
  assert.ok(STYLIST_SYSTEM.includes('you have everything you need — decompose and call \'plan_outfit_set\' rather than asking a clarifying question first'))
  assert.ok(!STYLIST_SYSTEM.includes('únicamente'))
  // Indoor slots are climate-controlled — the outdoor forecast must not drive an
  // office day toward sleeveless/beachy pieces (live finding: office week
  // composed for the outdoor Walnut Creek heat).
  assert.ok(STYLIST_SYSTEM.includes('INDOOR slots are climate-controlled'))
  assert.ok(STYLIST_SYSTEM.includes("pass \`weather:'indoor'\` so the slot is NOT composed for outdoor heat or cold"))
  assert.ok(STYLIST_SYSTEM.includes('Reserve the live per-slot forecast for slots actually spent OUTDOORS'))
  // Register escalation for event weekends (live finding: the wedding ceremony
  // came out in denim + a leather zip, not the dressiest slot).
  assert.ok(STYLIST_SYSTEM.includes("set each slot's \`register\` so the peak reads dressiest"))
  assert.ok(STYLIST_SYSTEM.includes("wedding ceremony \`register:'formal'\`"))
  assert.ok(STYLIST_SYSTEM.includes("don't \`no_repeat\` the very category (usually dresses) the marquee slot needs"))
  // Capsule decomposition (live finding: the model slotted a capsule by garment
  // category — Tops / Bottoms / Shoes — instead of use-case).
  assert.ok(STYLIST_SYSTEM.includes('For a CAPSULE, slot by USE-CASE, NEVER by garment category'))
  assert.ok(STYLIST_SYSTEM.includes('"N-piece capsule" means ~N distinct PIECES, not N outfits'))
  assert.ok(STYLIST_SYSTEM.includes('larger seasonal capsules (18-24 pieces) should show a real rotation, usually 8-14 outfit cards'))
  assert.ok(STYLIST_SYSTEM.includes('do NOT default every slot to count 1'))
  assert.ok(STYLIST_SYSTEM.includes('ALWAYS set `piece_budget` to the number in "N-piece capsule"'))
  assert.ok(STYLIST_SYSTEM.includes('weighted toward SEPARATES that recombine'))
  // A capsule roster EDIT is a re-plan, never a same-role propose_outfit card
  // (live: the model proposed 5 shoes / 7 tops in one card → broken diagnostic).
  assert.ok(STYLIST_SYSTEM.includes('A follow-up that EDITS the capsule roster'))
  assert.ok(STYLIST_SYSTEM.includes('NEVER present a roster edit as a \'propose_outfit\' card full of same-role pieces'))
  assert.ok(STYLIST_SYSTEM.includes('Current Outfit Set for Trips and Multi-Outfit Plans'))
  assert.ok(STYLIST_SYSTEM.includes('as the canonical packing/styling plan for the thread'))
  assert.ok(STYLIST_SYSTEM.includes("one 'propose_outfit' card per entry (verified piece IDs + roles)"))
  assert.ok(STYLIST_SYSTEM.includes('the pieces live in the tool call'))
  assert.ok(STYLIST_SYSTEM.includes("call 'propose_outfit' again for that entry to update it"))
  assert.ok(STYLIST_SYSTEM.includes('stated length, stated use cases, weather, repeat-wear needs, layers, and shoe comfort'))
  assert.ok(STYLIST_SYSTEM.includes('re-render every current entry unless the user clearly asks for a subset'))
  assert.ok(STYLIST_SYSTEM.includes("use \"[missing wardrobe gap: ...]\" (or the tool's missing_gaps) for slots the wardrobe cannot fill"))
  assert.ok(STYLIST_SYSTEM.includes('Showing / Re-rendering an Outfit'))
  assert.ok(STYLIST_SYSTEM.includes("propose each concrete outfit by calling 'propose_outfit' with verified piece IDs and roles"))
  assert.ok(STYLIST_SYSTEM.includes("call 'propose_outfit' for each referenced outfit using the same verified piece IDs and roles"))
  assert.ok(STYLIST_SYSTEM.includes('never as a generic category checklist'))
  // Part 5 (spec 18): pattern-truth — never call a piece solid/muted/subtle unless its own data says so.
  assert.ok(STYLIST_SYSTEM.includes("A piece's own pattern and color fields are the truth about its print"))
  assert.ok(STYLIST_SYSTEM.includes('never describe a piece as solid, muted, or subtle in a "why it works" line unless its own data says so'))
  assert.ok(STYLIST_SYSTEM.includes('treat each already-assigned top, bottom, dress, shoes, and layer as occupied'))
  assert.ok(STYLIST_SYSTEM.includes("preserve the original outfit's occasion, social register, and visual thesis"))
  assert.ok(STYLIST_SYSTEM.includes('Do not downgrade a city, museum, restaurant, winery, gallery, smart-casual, or outdoor daytime social look into a plain casual tee/sneaker formula'))
  assert.ok(STYLIST_SYSTEM.includes('look first for same-register breathable pieces'))
  assert.ok(STYLIST_SYSTEM.includes('if the only heat-safe owned choices are more casual, say that as a tradeoff or mark a wardrobe gap'))
  assert.ok(STYLIST_SYSTEM.includes('A warm layer must be an actual layer/outerwear garment from the wardrobe'))
  assert.ok(STYLIST_SYSTEM.includes('search `search_wardrobe` with category `outerwear`'))
  assert.ok(STYLIST_SYSTEM.includes('treat the layer as an add-on to the Current outfit set, not as a standalone outfit'))
  assert.ok(STYLIST_SYSTEM.includes('Never count a layer-only entry such as "wool shell + loafers" as an outfit'))
  assert.ok(STYLIST_SYSTEM.includes("Use 'generate_outfits' only when the user explicitly asks the system to compose fresh visual card options from scratch"))
  assert.ok(STYLIST_SYSTEM.includes('weatherFit'))
  assert.ok(STYLIST_SYSTEM.includes('ruleFit'))
  assert.ok(STYLIST_SYSTEM.includes('If an established styling context is provided for this thread'))
  assert.ok(STYLIST_SYSTEM.includes('A fresh explicit request overrides the established context'))
  assert.ok(STYLIST_SYSTEM.includes('Require a geographic destination only when the request is about traveling somewhere or packing for a trip'))
  assert.ok(STYLIST_SYSTEM.includes('For travel or packing, expected weather/forecast is required before recommending garments or outfits'))
  assert.ok(STYLIST_SYSTEM.includes('timing/season alone is not enough'))
  assert.ok(STYLIST_SYSTEM.includes('do NOT ask where she is going'))
  assert.ok(!STYLIST_SYSTEM.includes('before recommending any garments or outfits'))
  // Spec 4 (live weather): once a real place is named, resolve weather live via location instead of
  // asking the user — regression test for the "Legion of Honor museum in San Francisco" case, where
  // the model asked "what weather are you expecting?" despite the city being stated.
  assert.ok(STYLIST_SYSTEM.includes('do NOT ask what weather to expect'))
  assert.ok(STYLIST_SYSTEM.includes('Pass the city/place as `location` on \'search_wardrobe\''))
  assert.ok(STYLIST_SYSTEM.includes('Legion of Honor museum in San Francisco'))
  // Spec 7 (2026-07-09): spec 4's fix didn't generalize past its own museum-framed example — the
  // model still asked for weather on "I'm going to Napa on Saturday. What should I wear to a winery
  // lunch?" despite an occasion (winery lunch) and place (Napa) both being named. Regression test for
  // the explicit distinguishing test plus the new Example 1c covering travel-flavored wording.
  assert.ok(STYLIST_SYSTEM.includes('does the request already name a SPECIFIC occasion/event'))
  assert.ok(STYLIST_SYSTEM.includes('regardless of travel-flavored phrasing like "going to," "trip," or a day-of-week'))
  assert.ok(STYLIST_SYSTEM.includes('Example 1c'))
  assert.ok(STYLIST_SYSTEM.includes("I'm going to Napa on Saturday. What should I wear to a winery lunch?"))
  assert.ok(STYLIST_SYSTEM.includes('a winery lunch is a specific named occasion'))
  // 2026-07-10: found live that the model was treating "Time zone: America/Los_Angeles" (embedded in
  // every turn's context purely for date/day-of-week math) as a proxy for Yuna's actual home
  // location, silently passing location: "Los_Angeles" to search_wardrobe on plain local asks with
  // no place named. Confirmed with Yuna: that IS her timezone but NOT her location — the resolved
  // weather was wrong. There is no configured home location anywhere in this app (see spec 4); the
  // fix is telling the model explicitly not to infer one from the timezone string.
  assert.ok(STYLIST_SYSTEM.includes('There is no configured home location anywhere in this system'))
  assert.ok(STYLIST_SYSTEM.includes('it is NOT a city and must never be treated as one'))
  assert.ok(STYLIST_SYSTEM.includes('do NOT invent or guess a city'))
  assert.ok(STYLIST_SYSTEM.includes('leave `location` unset on \'search_wardrobe\''))
  // 2026-07-10: found live that a freeform chat outfit card ("Relaxed Comfort Look" — top + bottom +
  // cardigan) rendered with zero shoes and no warning at all — freeform chat's prompt only mentioned
  // shoes as one item in a buried list, nowhere near the composer's explicit hard rule. Regression
  // test for the new explicit rule, mirroring WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM's language.
  assert.ok(STYLIST_SYSTEM.includes('Every outfit MUST include a shoes-role piece'))
  assert.ok(STYLIST_SYSTEM.includes('do not call \'propose_outfit\' for an incomplete outfit using missing_gaps as a shoe substitute'))
})

// Spec 25 Part 1: re-homes the deleted pieceOfficePolishScore/office-register
// scorer's knowledge as prompt doctrine — professional contexts default to
// quiet, low-print styling. Wording judged against the #68/#86 owner rulings:
// constrains print COUNT and CONTEXT, never bans a print by name, and says
// nothing about hemlines (the maxi-skirt/shawl rule is the owner's own stored
// rule, delivered via Part 2's workbench mechanism, not hard-coded here).
test('stylist prompt has professional-context competence as a system-side default', () => {
  assert.ok(STYLIST_SYSTEM.includes('Professional and work contexts (office days, client meetings, presentations) default to quiet, structured, low-print styling'))
  assert.ok(STYLIST_SYSTEM.includes('at most ONE bold print per outfit as a deliberate accent'))
  assert.ok(STYLIST_SYSTEM.includes('every accessory\'s register must match the outfit\'s register'))
  assert.ok(STYLIST_SYSTEM.includes('Save artisan, botanical, and statement styling for social contexts'))
  assert.ok(STYLIST_SYSTEM.includes('This is the default, not a rule the user must state'))
  // Judged wording (#68/#86 owner rulings): constrains print count/context,
  // never bans a specific print by name, and never hard-codes the owner's
  // own maxi-skirt/shawl rule (that's her stored rule, Part 2's job).
  const bullet = 'Professional and work contexts (office days, client meetings, presentations) default to quiet, structured, low-print styling: solid or subtle pieces lead, at most ONE bold print per outfit as a deliberate accent, and every accessory\'s register must match the outfit\'s register (no dressy shawls or statement wraps over casual pieces at work). Save artisan, botanical, and statement styling for social contexts — dinners, galleries, weekends — unless the user asks for it at work. This is the default, not a rule the user must state.'
  assert.ok(STYLIST_SYSTEM.includes(bullet))
  assert.ok(!/\bhemline\b/i.test(bullet), 'must not hard-code the owner\'s own hemline (maxi-skirt) rule')
  assert.ok(!/\bmaxi\b/i.test(bullet), 'must not hard-code "maxi" — that is the owner\'s stored rule, not system doctrine')
  for (const printName of ['floral', 'paisley', 'animal print', 'polka dot', 'stripe']) {
    assert.ok(!bullet.toLowerCase().includes(printName), `bullet must not ban a specific print by name, found "${printName}"`)
  }
})

test('StylistChat carries generated styling context into ask requests', () => {
  const chatPath = path.join(import.meta.dirname, '../src/components/StylistChat.jsx')
  const content = fs.readFileSync(chatPath, 'utf8')

  assert.ok(content.includes('const stylingContextFromMemory ='), 'StylistChat should expose a stylingContext request helper')
  assert.ok((content.match(/stylingContext:\s*\{/g) || []).length >= 3, 'generated outfit thread memory should store stylingContext')
  assert.ok((content.match(/\.\.\.stylingContextFromMemory\(threadMemory/g) || []).length >= 3, 'ask requests should include carried styling context')
  assert.ok(!content.includes('activity: activeContext?.type === \'piece\' ? generateActivity : wardrobeOutfitActivity'), 'general ask body should reconcile activity through stylingContext')
})

// 2026-07-10: a multi-day trip needs activities/use cases before the system can safely compose
// outfits or a packing set. Destination and weather resolve climate, not itinerary scope.
test('tripRequestNeedsScopeClarification flags multi-day trips with missing or thin activity scope', () => {
  assert.equal(
    tripRequestNeedsScopeClarification('Going to Fairfax, CA for a few days'),
    true
  )
  assert.equal(
    tripRequestNeedsScopeClarification('Going to Fairfax, CA for a few days, what should I pack?'),
    true
  )
  assert.equal(
    tripRequestNeedsScopeClarification("I'm going to Bodega Bay this weekend for hiking, it'll be cold, what should I pack?"),
    true
  )
  assert.equal(
    tripRequestNeedsScopeClarification("I'm going hiking in Tahoe this weekend, it'll be cold, what should I pack?"),
    true
  )
})

test('tripRequestNeedsScopeClarification does not flag trips that already state multiple use cases', () => {
  assert.equal(
    tripRequestNeedsScopeClarification('Hiking this weekend, also want a nice dinner outfit for one night'),
    false
  )
  assert.equal(
    tripRequestNeedsScopeClarification("Hi! In a few days I'm going to Portland, OR for 4-5 days. Mainly city exploring, walking, a few museums, and also a few nice restaurants and one day at a winery. What should I pack?"),
    false
  )
})

test('tripRequestNeedsScopeClarification does not flag single-day or non-activity requests', () => {
  assert.equal(tripRequestNeedsScopeClarification('Going hiking on Saturday, what should I wear?'), false)
  assert.equal(tripRequestNeedsScopeClarification('What should I wear today, nothing special?'), false)
  assert.equal(tripRequestNeedsScopeClarification(''), false)
})

test('travelRequestCanResolveWeatherLive allows named-place single-occasion trips to use live weather', () => {
  assert.equal(
    travelRequestCanResolveWeatherLive('A hiking day trip to Fairfax tomorrow, what should I wear?'),
    true
  )
  assert.equal(
    travelRequestCanResolveWeatherLive("I'm going to Napa on Saturday. What should I wear to a winery lunch?"),
    true
  )
  assert.equal(
    travelRequestCanResolveWeatherLive('suggest packing outfits for Portland'),
    false
  )
})
