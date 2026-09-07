// Spec 32 — THE safety rail. The fixture test/fixtures/prompts_yuna_snapshot.json was
// frozen from the prompts.js constants at origin/main BEFORE the profile/constitution
// refactor. buildPrompts() with the legacy (owner) profile + constitution must reproduce
// every one of those strings byte-for-byte: the refactor moves where the words live,
// never what they are. If this test fails, the refactor changed the owner's prompts.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { buildPrompts, DEFAULT_CONSTITUTION, CONSTITUTION_LAYER_KEYS } from '../styling-engine/prompts.js'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'
import { layerConstructionPromptRule, layerDirectionPromptRule, requiredBaseLayerPromptRule } from '../styling-engine/outfitValidation.js'

const snapshot = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'test/fixtures/prompts_yuna_snapshot.json'), 'utf8'))

const ASSEMBLED_KEYS = [
  'STYLIST_SYSTEM',
  'STYLE_SELECTED_ITEM_SYSTEM',
  'COMPARE_OUTFITS_SYSTEM',
  'GENERATE_OUTFIT_IDEAS_SYSTEM',
  'OUTFIT_COMPOSER_SYSTEM',
  'OUTFIT_EVALUATOR_GATE_SYSTEM',
  'WHOLE_WARDROBE_EVALUATOR_SYSTEM',
  'OUTFIT_BOARD_PLANNER_SYSTEM',
  'EDITORIAL_NEW_PIECES_SYSTEM',
  'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM',
  'VISUAL_SUPPORT_CRITIC_SYSTEM',
  'VISUAL_WARDROBE_CRITIC_SYSTEM',
  'TAG_PIECE_PROMPT',
  'EDITORIAL_IMAGE_SUBJECT_PROMPT',
  'EDITORIAL_IMAGE_SHOES_RULE',
  'BODY_CONTRACT',
  'PROVEN_FORMULAS',
  'AESTHETIC_GRAVITY',
  'LANE_NEUTRALITY',
  'WORKING_STYLE'
]

test('legacy profile + constitution reproduce every pre-refactor prompt byte-for-byte', () => {
  const built = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  for (const key of ASSEMBLED_KEYS) {
    assert.ok(typeof snapshot[key] === 'string', `snapshot missing ${key}`)
    // 2026-08-18: one deliberate post-refactor composer instruction prevents its private roster
    // comparison from leaking into user-facing card prose. Keep the frozen pre-refactor fixture
    // intact and spell out the sole accepted delta so this remains a byte-level ratchet.
    let expected = key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM'
      ? snapshot[key].replace(
          '- Respect the rotation warnings and any rejected-pairing memory provided.\n',
          '- Respect the rotation warnings and any rejected-pairing memory provided.\n- Rotation is a soft tie-breaker, never a prohibition: repeat a recently shown garment when it is clearly the best or only valid choice. Do all comparison silently. Every returned field must describe only the final IDs in that outfit; never expose deliberation, rejected alternatives, self-correction, inventory checking, or rebuilding language.\n'
        )
      : snapshot[key]
    // 2026-09-01: the shoes `fabric_category` enum had no `knit` value, so a knitted/flyknit upper
    // was tagged inconsistently as `mesh` or `woven` depending on the photo — in one real wardrobe
    // the word "knit" appears in four shoe names split across both. That made the wet/cold footwear
    // gates fire by tagging luck rather than by construction. Adding the value is a schema fix for
    // every user, not a prompt-tuning tweak, so it is recorded here as an accepted byte delta rather
    // than by re-freezing the fixture.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        'shoes -> leather|suede|nubuck|patent|canvas|mesh|woven (use woven for raffia/straw/other woven shoe materials)|synthetic|textile|rubber|other',
        'shoes -> leather|suede|nubuck|patent|canvas|mesh|knit (a knitted/flyknit upper — knit and mesh are both permeable, pick knit when the upper is a continuous knitted fabric rather than an open perforated mesh)|woven (use woven for raffia/straw/other woven shoe materials, NOT for a knitted upper)|synthetic|textile|rubber|other'
      )
    }
    // 2026-09-02 CORRECTION: the 2026-09-01 version of this delta routed a warm boot lining into
    // fiber_content and called it "the only place a boot's warmth is recorded". That contradicted
    // the material-role contract, where insulating_layer_materials owns a warm boot's pile/shearling
    // lining and fiber_content describes the FACE — the same role confusion that was being fixed for
    // coats, left alive for shoes. Footwear now follows the same ownership rule; the warmth signal
    // survives the move, since a non-empty layer settles thermalMaterialVerdict.
    //
    // 2026-09-01: footwear lining. `pieceHasInsulatingMaterial` is read BEFORE the shoe/accessory
    // exemption in hotWeatherInsulationReason, so a boot whose lining is recorded is ALREADY excluded
    // correctly in hot weather with no code change — but nothing ever recorded linings, so a
    // shearling boot and a thin flat were identical to the engine. fabric_weight is null for shoes
    // and fabric_category describes the upper, leaving fiber_content as the only available home.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        "Use 'tencel' for lyocell/Tencel fabric — there is no separate 'lyocell' value, they are the same stored concept.",
        "Use 'tencel' for lyocell/Tencel fabric — there is no separate 'lyocell' value, they are the same stored concept. For FOOTWEAR this field is the UPPER/face material ONLY. A warm interior — a shearling or fleece collar, a visibly fuzzy or pile lining at the opening — is an INSULATING LAYER and belongs in insulating_layer_materials, not here; recording it here would make the lining read as part of the upper, which is what fiber_content describes. This is the same ownership rule that applies to a coat's fill. Only when you can actually see it — do not infer a lining from the words 'boot' or 'winter', and leave it out when the interior is not visible."
      )
    }
    // 2026-09-02: `shearling` becomes a canonical insulating fibre value. It already existed as a
    // fabric_category in INSULATING_FABRIC_CATEGORIES, so the two vocabularies disagreed about a
    // material the wardrobe actually owns — 996868's shearling lining had to be recorded as
    // 'fleece', losing the distinction. A vocabulary fix for every user, recorded here as an
    // accepted byte delta rather than by re-freezing the fixture.
    // See docs/interior-construction-spec.md §4.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        'mohair, fleece, down, cotton, linen, hemp',
        'mohair, fleece, shearling, down, cotton, linen, hemp'
      )
    }
    // 2026-09-01: the tagger gains a new FACTUAL OUTPUT — known-incomplete fibre composition.
    // It still cannot assert completeness: 'complete' is not in its permitted vocabulary, and
    // normalizeFiberCompleteness() downgrades it to 'unknown' at the boundary if it emits one
    // anyway. Before this, the system could represent partial composition but the main automated
    // intake path could not populate it, even where the photo itself establishes incompleteness —
    // a visibly quilted coat whose shell is identifiable and whose fill is not. Deliberately
    // narrow: positive visual evidence of unidentifiable components only, never "when unsure" and
    // never by category, either of which would dilute partial back into unknown.
    // See docs/interior-construction-spec.md §8.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        "    4. For uncertain textile composition beyond the above — an ordinary knit, jersey, or woven top/bottom with no label and no obviously distinctive material — use fiber_content: [\"unknown\"] rather than inventing a specific fiber from appearance alone. Admitting uncertainty here is correct, not a gap to avoid.",
        "    4. For uncertain textile composition beyond the above — an ordinary knit, jersey, or woven top/bottom with no label and no obviously distinctive material — use fiber_content: [\"unknown\"] rather than inventing a specific fiber from appearance alone. Admitting uncertainty here is correct, not a gap to avoid.\n    5. fiber_content describes the FACE fabric. A quilted or filled coat whose shell you can identify but whose fill you cannot is fiber_content: [\"polyester\"] with insulating_layer_materials: [\"unknown\"] — the fill is recorded as a layer, not as another face fibre. Do not add a lining or fill material to fiber_content.\n  * Directives for Interior Construction: interior_construction and insulating_layer_materials are two different questions and a garment can answer both. insulating_layer_materials is for a THERMALLY FUNCTIONAL layer — fill, wadding, a fuzzy/pile/shearling lining. interior_construction is for ORDINARY construction — a plain lightweight lining, or a reversible/two-full-fabric-layer build. A plain polyester lining in a blazer is interior_construction: \"full_lining\" and is NOT an insulating layer. A reversible jacket is \"full_second_face\", not an insulating layer — this is the single most common error, and recording a second fabric face as insulation makes an unlined jacket read as a winter coat. You may only report construction you can actually see; if the interior is not visible, use \"unknown\". Never emit \"unlined\": not seeing a lining in a photograph is not evidence that there is none."
      )
      expected = expected.replace(
        "  \"formality\":",
        "  \"interior_construction\": \"unknown|partial_lining|full_lining|full_second_face — ordinary, NON-INSULATING interior construction, which is a different question from insulating_layer_materials. Use 'full_lining' when a separate ordinary lightweight lining covers most of the garment, 'partial_lining' when it covers only part, and 'full_second_face' when the garment is reversible or built from two substantial fabric faces covering the same area. Emit these ONLY with positive visual evidence of the construction; otherwise 'unknown'. NEVER emit 'unlined' — the absence of a visible lining in a photograph is not evidence that there is no lining, and only a person handling the garment can establish that. Do not record a warm/fuzzy/pile lining or a quilted fill here; that is insulating_layer_materials. Do not report the lining's fibre — it is not asked for.\",\n  \"formality\":"
      )
    }
    // 2026-09-02: fit_on_body gains definitions. The value list is UNCHANGED — only its description
    // and the guidance around it. Prompted by a live retag calling a visibly waisted quilted jacket
    // "hangs_straight": the model had seen its shaped side panels and recorded them as "texture
    // contrast". The cause was not missing guidance but WRONG guidance — the Fabric & Drape block
    // mapped fabric stiffness straight onto a fit value ("Fit matches: structured or
    // hangs_straight"), so a quilted nylon shell was being classified correctly per instructions.
    // Fabric stiffness and body relationship are different axes; stiffness is now a stated default
    // that visible shaping overrides. See docs/fit-on-body-definitions-spec.md.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        "   - Structured/Stiff (denim, twill, canvas, heavy cotton): Holds its own shape away from the body. Fit matches: \"structured\" or \"hangs_straight\".",
        "   - Structured/Stiff (denim, twill, canvas, heavy cotton): Holds its own shape away from the body. Fit DEFAULTS to \"structured\" or \"hangs_straight\" \u2014 but this is a fallback for an UNSHAPED garment, not a rule. Fabric stiffness and body relationship are different axes: a stiff fabric can still be cut to the waist, and visible shaping overrides this default (see Fit on Body below). QUILTING AND PADDING ARE NOT STIFFNESS and do not belong in this judgement at all \u2014 a padded shell is commonly cut to the waist, so decide a puffer under Fit on Body, never here."
      )
      expected = expected.replace(
        "   - Fluid/Soft (ribbed knit, waffle knit, smocking/pucker, silk, gauze): Conforms to body contours, moves, or drapes. Fit matches: \"skims\" or \"drapes\" (never \"structured\").",
        "   - Fluid/Soft (ribbed knit, waffle knit, smocking/pucker, silk, gauze): Conforms to body contours, moves, or drapes. Fit defaults to \"skims\" or \"drapes\" (never \"structured\")."
      )
      expected = expected.replace(
        "- Fit on Body: Select clings_stretchy, clings_drapey, skims, hangs_straight, drapes, or structured.",
        "- Fit on Body: how the garment relates to the BODY'S CONTOURS. Not how loose it is, and not its outline, which is silhouette. Three questions decide it, and the value list alone is not enough. (1) \"skims\" vs \"hangs_straight\": ask whether there is WAIST DEFINITION. Any shaping device \u2014 darts, princess seams, shaped or elasticated side panels, a peplum, a belt or drawstring built into the design \u2014 means the garment references the body, so it is \"skims\". Choose \"hangs_straight\" only when the garment falls straight from the shoulders or waistband with nothing drawing it in. (2) PADDING IS NOT STRUCTURE: a quilted or filled garment is padded, not architecturally structured, and its bulk is already recorded in fabric_weight and visual_weight \u2014 judge a puffer by whether it is shaped to the waist. (3) fit_on_body is NOT silhouette: they are independent, and \"silhouette\": \"structured\" with \"fit_on_body\": \"skims\" is a normal, correct combination for a tailored waisted coat. Do not copy one field into the other. Where a WORN PHOTO exists it is the authority here \u2014 it is the only view that shows the relationship to an actual body. Use \"none\" when the garment has no meaningful relationship to body contours."
      )
      expected = expected.replace(
        "  \"fit_on_body\": \"clings_stretchy|clings_drapey|skims|hangs_straight|drapes|structured|none\",",
        "  \"fit_on_body\": \"clings_stretchy|clings_drapey|skims|hangs_straight|drapes|structured|none (clothing only; null/omit for shoes/accessory). How the garment relates to the BODY'S CONTOURS \u2014 not how loose it is, and not its outline, which is `silhouette`. 'clings_stretchy': follows the body closely because the fabric stretches onto it (jersey, rib, knit) and the body's outline reads through. 'clings_drapey': follows the body closely because a fluid non-stretch fabric falls onto it (a silk slip, a bias cut). 'skims': shaped to the body and following its line without gripping \u2014 there is ease, but the construction itself references the body through a defined waist, darts, princess seams, shaped or elasticated side panels, or a belt or drawstring built into the design. 'hangs_straight': falls from the shoulders or waistband in a straight line, IGNORING the body's contours, with no waist definition anywhere in the construction. 'drapes': falls in soft folds AWAY from the body, its shape governed by the fabric's weight and fluidity rather than by the body. 'structured': holds its own architectural shape independently of the body \u2014 it would keep that shape off the body, through canvas, interfacing, boning, or tailoring. 'none': no meaningful relationship to body contours.\","
      )
    }
    // 2026-09-02: the tagger gains insulating_layer_materials — a thermally functional INTERNAL
    // layer whose material may differ from the face fabric (a coat's fill, a warm boot's lining).
    // Without it synthetic insulation was unrepresentable: a 100%-polyester-filled leather coat
    // recorded ["polyester","nylon","leather"], and marking its composition complete produced a
    // confident non_insulating. Kept OUT of fiber_content, which pieceFiberBreathability reads as
    // face-material evidence. See docs/material-role-representation-spec.md.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        "  \"formality\":",
        "  \"insulating_layer_materials\": \"array of materials from the same canonical list, describing a thermally functional INTERNAL layer whose material differs from the face fabric \u2014 a coat's fill or wadding, a warm boot's pile/shearling lining. Omit the field entirely (null) when you cannot tell. Use ['unknown'] when construction positively shows an insulating layer \u2014 quilting, baffles, visible loft, a fuzzy or pile interior \u2014 but you cannot identify what it is made of; that is a POSITIVE answer and the common one. Name the material only when it is visually supportable (a visible shearling lining is 'shearling', a fleece one is 'fleece'). NEVER return an empty array: 'this garment has no insulating layer' cannot be established from a photograph, so omit the field instead. ORDINARY LINING DOES NOT COUNT \u2014 a plain lightweight polyester or acetate lining in a blazer, dress or unlined-feeling jacket is not an insulating layer and must not be recorded here. This is separate from fiber_content, which describes the FACE fabric.\"," + "\n  \"formality\":"
      )
    }
    // 2026-09-02: outerwear_role is deprecated (docs/outerwear-role-ontology-spec.md). The tagger
    // stops producing it and both intake forms stop offering it. The field mixed three axes and its
    // one live gate — the severe-cold outdoor-layer check — is now a weather-aware judgment in
    // outfitEnvironmentalAdequacy, computed where the temperature is already known. The column and
    // its legacy readers stay; only production of new values stops.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace("- Outerwear Role (outerwear only): a functional judgment, not a garment-type label \u2014 see the outerwear_role field description below for the four values and what NOT to infer from fabric weight/fiber/name alone. Leave null rather than guess when construction/material evidence is genuinely insufficient." + "\n", "")
      expected = expected.replace("- Weather Protection (outerwear only): a SEPARATE judgment from outerwear_role \u2014 see the weather_protection field description below. Only mark rain/wind when construction genuinely supports it; fiber alone (nylon/polyester) is not rain evidence and fabric weight/wool alone is not wind evidence. Leave the array empty rather than guess.", "- Weather Protection (outerwear only): a judgment about environmental barrier only \u2014 see the weather_protection field description below. Only mark rain/wind when construction genuinely supports it; fiber alone (nylon/polyester) is not rain evidence and fabric weight/wool alone is not wind evidence. Leave the array empty rather than guess.")
      expected = expected.replace("  \"outerwear_role\": \"indoor_layer|transition_layer|protective_shell|cold_weather_outerwear|null (outerwear only; null/omit for non-outerwear categories, and null when the photo/metadata don't give you enough to judge confidently \u2014 do not guess). This is a functional judgment about what job the garment can do as an OUTER layer outdoors, independent of fabric_weight/warmth: indoor_layer = modest warmth/styling layer, no real outdoor weather protection assumed (fine cardigan, knit shrug); transition_layer = works as the primary outer layer in mild/cool conditions but is not a true weather shell or winter coat (substantial cardigan, denim/utility jacket, some blazers/vests); protective_shell = built primarily to block wind/rain rather than insulate \u2014 can be thermally light without being cold_weather_outerwear (windbreaker, rain shell); cold_weather_outerwear = genuine cold-weather outer layer with substantial insulation as the outside layer (insulated coat, puffer, down coat). None of fabric weight, wool/insulating fiber, nylon/polyester, or the word 'coat'/'jacket'/'cardigan' in isolation is sufficient to pick a value \u2014 weigh construction and material evidence together, the same 'no single tag decides it' principle as formality/fabric evidence elsewhere in this schema. A vest supplying torso warmth does not by itself resolve arm coverage; do not let that push toward cold_weather_outerwear on construction alone.\"," + "\n", "")
      expected = expected.replace("    \"outerwear_role\": \"high|medium|low\"," + "\n", "")
    }
    // 2026-09-02: the output contract is tightened rather than the ceiling raised again.
    // real_wear_notes measured 4.9 of 5 keys filled across 221 pieces — including `maintenance`,
    // whose own instruction said to omit it for ordinary garments — because two of its five keys
    // were specified as empty strings, which read as slots that must be answered. Every key now
    // carries a purpose and an 8-12 word bound, and OMIT replaces the empty string. _confidence
    // gains an omit-inapplicable rule: a coat was rating heel_height, jewelry_type and
    // waistband_type, ten keys of pure bookkeeping. See docs/tagger-cost-spec.md §6f.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace("      \"real_wear_notes\": {\n        \"fit\": \"visible placement/strain only; do not claim comfort from still image\",\n        \"drape\": \"\",\n        \"scale\": \"garment volume/visual territory only; no body shape comments\",\n        \"placement\": \"\",\n        \"maintenance\": \"only specify exceptional physical care burdens (e.g. dry clean only, wrinkles easily, pills easily). leave empty or omit for standard machine-washable items.\"\n      },", "      \"real_wear_notes\": {\n        \"_rule\": \"OMIT any key below rather than sending an empty string, and omit the whole object if none apply. Each value is at most 8-12 words. Measured 2026-09-02: this block was filled 4.9 keys out of 5 on average, including on garments whose own instructions said to leave a key out \u2014 the empty-string placeholders were reading as slots that had to be answered.\",\n        \"fit\": \"visible fit/strain/placement only; do not claim comfort from a still image; 8-12 words\",\n        \"drape\": \"how the fabric falls or hangs; 8-12 words; OMIT if not visually meaningful\",\n        \"placement\": \"where key garment features sit on the body; 8-12 words; OMIT if it repeats fit\",\n        \"scale\": \"garment volume/visual territory only; no body shape comments; 8-12 words\",\n        \"maintenance\": \"an exceptional, VISIBLE care burden only (dry clean only, wrinkles easily, pills easily); 8-12 words; OMIT for ordinary machine-washable items\"\n      },")
      expected = expected.replace("  \"_confidence\": {\n", "  \"_confidence\": {\n" + "    \"_rule\": \"OMIT entries for fields that do not apply to this garment's category \u2014 a coat has no heel_height, jewelry_type or waistband_type, and rating them is pure bookkeeping. Rate only what you were actually asked to produce above.\"," + "\n")
    }
    // 2026-08-21: the composer proposes from isolated per-garment photos and was observed
    // rationalizing a two-print pairing ("shares a warm palette", "reads quieter because the
    // ground is dark") instead of actually comparing the two photos. Strengthens pattern
    // discipline from a bare rule into an instruction to look and a named trap to avoid.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        '- Pattern discipline: one loud piece per outfit, grounded by solid supporting pieces.',
        '- Pattern discipline: at most one loud/busy print or heavy texture per outfit, grounded by solid supporting pieces. Before you pair two pieces that both have a print, pattern, or heavy texture, actually look at their two photos side by side and ask whether they compete — similar scale, similar busyness, fighting for the same attention — not whether they share a color-family word. A dark background does not make a busy print "read quiet"; a print\'s ground color and its pattern discipline are two different things, and one does not fix the other. If you find yourself writing a reason like "shares a warm palette" or "reads quieter because the ground is dark" to justify pairing two patterned or heavily textured pieces, that is the sign to stop and swap one of them for a solid piece instead — do not use that reasoning to keep the pairing.'
      )
    }
    // 2026-08-21: a smart-casual request with no stated activity came back with three outfits
    // whose bestFor read "walking-heavy day" / "all-day walking" — the composer was inflating the
    // city_smart_casual occasion profile's "walk-friendly" VIBE text (a footwear/register quality)
    // into an unstated ACTIVITY claim. Structural activity gating was unaffected (activitySource
    // stayed "none"); this was purely a prose overclaim.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        '- Occasion & Weather Classification: Honor the occasion guidance provided in the request; the wardrobe shown has already been filtered for validity — compose freely within it.',
        '- Occasion & Weather Classification: Honor the occasion guidance provided in the request; the wardrobe shown has already been filtered for validity — compose freely within it.\n- Do not invent a physical activity. An occasion\'s vibe text (e.g. "walk-friendly," "comfortable," "walkable") describes a footwear/register QUALITY the occasion generally calls for — it is not a claim that this specific request involves walking, hiking, or any other named activity. Only use activity language like "walking-heavy day," "all-day walking," or "a walk" in `bestFor`/`silhouette`/`watchFor` when an activity was actually stated for this turn (see the Activity line in the request, if present). Otherwise describe the outfit by its occasion and register only (e.g. "smart casual, everyday" — not "smart casual, walking-heavy day").'
      )
    }
    // 2026-08-24: live thread_1787558991064 paired a needs_base crochet top with a relaxed/drapey
    // "emerald green v-neck top" as its base, defending the pairing until the owner corrected it —
    // "to be a base top, it needs to be a fitted top, which it most definitely is not". The composer
    // had the right piece available (a near-identically-named skims/straight tank) and used it
    // correctly elsewhere in the same turn, so this was a base-layer compatibility check the model
    // never had a stated rule for, not a missing garment. Moved ex-ante into the composition rules
    // rather than left to post-hoc repair, per owner instruction: "repair is a bit late I want model
    // to know that garments structure or silhouette won't work for what it wants it to do." The
    // architecture pass now projects the line from the executable contract so its value lists
    // cannot drift from validation.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        '- Respect the rotation warnings and any rejected-pairing memory provided.',
        `${requiredBaseLayerPromptRule()}\n- Respect the rotation warnings and any rejected-pairing memory provided.`
      )
    }
    // 2026-08-26: a prompt-responsibility census on #263 found the sleeve-construction verdict
    // (evaluateLayerPairConstruction) had a canonical outfitValidation.js owner but no active
    // composer actually projected it before composition — only evaluateWearableOutfit's
    // post-composition validation consumed it. Same treatment as requiredBaseLayerPromptRule above:
    // the composition rules cite the executable contract instead of restating its thresholds.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        `${requiredBaseLayerPromptRule()}\n- Respect the rotation warnings and any rejected-pairing memory provided.`,
        `${requiredBaseLayerPromptRule()}\n${layerConstructionPromptRule()}\n- Respect the rotation warnings and any rejected-pairing memory provided.`
      )
    }
    // 2026-08-26 follow-up: the same census verification pass found the direction verdict
    // (evaluateLayerDirections) had no prompt projection at all, and one composer
    // (capsulePlanCompositionSystemPrompt) had invented its own private restatement instead.
    // layerDirectionPromptRule() is the projection; same citation pattern as the two rules above.
    if (key === 'WHOLE_WARDROBE_VISUAL_COMPOSER_SYSTEM') {
      expected = expected.replace(
        `${requiredBaseLayerPromptRule()}\n${layerConstructionPromptRule()}\n- Respect the rotation warnings and any rejected-pairing memory provided.`,
        `${requiredBaseLayerPromptRule()}\n${layerConstructionPromptRule()}\n${layerDirectionPromptRule()}\n- Respect the rotation warnings and any rejected-pairing memory provided.`
      )
    }
    // 2026-08-26 verification pass: traced OUTFIT_EVALUATOR_GATE_SYSTEM's actual call chain
    // (composeStructuredOutfitsForPiece) and confirmed its register/footwear prose could diverge
    // from registerCeilingVerdict/footwearComfortVerdict on the selected anchor — the one piece
    // that bypasses automatic-use eligibility and so never runs those checks upstream. Every
    // supporting candidate already does. Replaced the free-derivation prose with an instruction to
    // cite a server-computed finding for the anchor specifically, rather than re-deriving register
    // or footwear suitability for any piece from scratch.
    if (key === 'OUTFIT_EVALUATOR_GATE_SYSTEM') {
      expected = expected.replace(
        '- reject (or flag in the rejected list) any outfit whose formality clearly exceeds the stated occasion\'s register (e.g. a cocktail/dressy piece proposed for a gallery, museum, or daytime-casual occasion).\n- reject (or flag) any outfit with stilettos, delicate sandals, or high heels when the request implies a walking-heavy or hiking activity.',
        '- Every supporting candidate already passed the wardrobe\'s register and footwear eligibility checks before reaching you — do not re-derive formality-vs-occasion or footwear-vs-activity suitability yourself. If a "Selected garment register check (computed)" or "Selected garment footwear check (computed)" line is supplied, it is the one piece those checks could not run on automatically (the user chose it directly); reject (or flag in the rejected list) any outfit built around that flagged issue for the stated reason. Absent such a line, do not reject or flag an outfit on register or footwear grounds.'
      )
    }
    // 2026-08-19 owner amendment: a direct tuckability question may reason across evidence when a
    // tag is missing, low-confidence, or visibly contradicted. Automatic composition remains
    // conservative, and hem shape alone still cannot decide. Keep this deliberate delta explicit.
    if (key === 'STYLIST_SYSTEM') {
      expected = expected.replace(
        '- Top tuck_behavior "wear_over_only" → NEVER suggest tucking. tuck_behavior is the authority on\n  whether a top can be tucked — hem_finish describes hem shape/construction only and does not by\n  itself determine tuckability (a ribbed or shaped hem can still be designed to tuck).',
        '- For automatic outfit composition, obey a saved tuck_behavior "wear_over_only" conservatively and\n  never suggest tucking it. For a direct user question ABOUT tuckability, treat tuck_behavior as\n  evidence rather than infallible truth: a manual/high-confidence value is strong; a missing or\n  low-confidence value may be inferred cautiously from a fit-visible photo, cut, fabric, length,\n  silhouette, and the receiving waistband. Clear contradictory construction/visual evidence may\n  challenge the saved value, but state that conflict instead of silently replacing it.\n- hem_finish describes hem shape/construction only and does not by itself determine tuckability (a\n  ribbed or shaped hem can still be designed to tuck; straight_loose alone does not mean untuckable).'
      )
      // 2026-08-19: the general evidence-provenance authority, restored. It was learned across the
      // qualified_coverage arc (material is not proof of rain performance; duration does not
      // multiply quantity; inference must not become fact) and was deleted along with that profile
      // — leaving coverage questions, which now route to full_stylist, with none of the guardrails
      // the arc paid live calls to discover. It is stated generally, not as per-garment branches.
      expected = expected.replace(
        'TUCK COMPATIBILITY (two-piece check before every tuck suggestion):',
        'EVIDENCE PROVENANCE (general; the tuck rule below is one instance of it):\n- Rank what you know: an explicit owner statement or a manually confirmed saved fact is strongest;\n  then what a photograph clearly shows; then a cautious inference from construction; then unknown.\n  An inference may never silently become a verified fact. Say which you are working from when it\n  matters, in ordinary language, without naming fields or confidence levels.\n- A claim about hidden performance — waterproofing, warmth rating, breathability, comfort over\n  distance, durability — needs evidence about that same property. Material, colour, appearance and\n  visible hardware are not that evidence: a waxed cotton jacket with taped-looking seams may or may\n  not keep rain out, and saying it does because it looks the part is inventing a fact. Purpose-built\n  design can establish function where a tag is weak or missing; the material name alone cannot.\n- How long something lasts does not multiply how much of it is needed. A week away does not mean\n  seven of a garment; one suitable piece covers repeated use unless the request actually states\n  simultaneous use, rotation, laundering or drying time.\n- Contextual qualities — dressy, polished, casual, creative — are judgments about whether a garment\n  can play that role in the use being asked about, not equality against its saved formality, occasion\n  or style labels. A piece labelled differently may still qualify; say why it does. Physical limits\n  are the opposite: those stay with the saved fact.\n\n' + 'TUCK COMPATIBILITY (two-piece check before every tuck suggestion):'
      )
      // 2026-08-20 owner ruling — global absolutes that were false as universal law. Each looked
      // authoritative while contradicting either generic styling knowledge or the prompt's own
      // evidence hierarchy: "silk … regardless of notes" overrode the owner's own note about their
      // own garment, which is the strongest rung on the provenance ladder. Structured truth
      // (tuck_behavior) carries the general case; per-piece RULES carry the specific one.
      expected = expected.replace(
        '- Silky or satin fabrics cannot hold a tuck — never suggest tucking them.',
        '- Slippery or drapey fabrics such as silk, satin, chiffon and some viscose may be less stable when tucked. Check the garment\'s saved tuck_behavior, owner notes, hem and length, and the receiving waistband before suggesting a tuck. Do not infer "wear over only" from the material name alone.'
      )
      expected = expected.replace(
        '- Silk, satin, chiffon → always wear_over_only regardless of notes.',
        "- Silk, satin and chiffon drape and slip, so a tuck holds less reliably — but that is a reason to check, not a verdict. Judge from the saved tuck_behavior, the owner's notes, the hem and length, and the waistband receiving it. Where material and owner notes conflict, the owner's note wins."
      )
      expected = expected.replace(
        '- For city walks or walking-heavy outings, ensure shoes are practical and comfortable. Never recommend heels, wedges, or delicate shoes for walking-heavy days or walks.',
        '- For city walks or walking-heavy outings, ensure shoes are practical and comfortable. Avoid high, slender or unstable heels and delicate constructions on walking-heavy days; a low block heel may be acceptable where saved comfort evidence supports it.'
      )
      expected = expected.replace(
        '- Never pair two "loud" pieces. One loud + one solid/quiet only. Pattern mixing works when prints share a color family and one is simpler than the other.',
        '- Do not pair two focal pieces unless there is a clear unifying relationship between them. Deliberate print or colour mixing is allowed when hierarchy, palette and scale are controlled — prints that share a colour family, with one simpler or smaller in scale than the other, are the usual way that works.'
      )
      // 2026-08-20: this prohibition contradicted the shipped architecture. Bounded multi-look routes
      // an ordinary "what should I wear?" TO generate_outfits, and both the tool description and the
      // turn's own controller instruction say so — leaving the cached prompt telling the model the
      // opposite, in the most authoritative-sounding place it reads.
      expected = expected.replace(
        " Do not call 'generate_outfits' for ordinary styling advice.",
        " Use 'generate_outfits' when the turn's contract says to (a fresh same-context batch); use 'propose_outfit' for one specific outfit you have composed yourself."
      )
      // 2026-08-20 — the Part A carve-outs. Each of these clauses now lives on the tool that owns it
      // (propose_outfit's output contract, search_wardrobe's result semantics), so the cached prompt
      // no longer restates it. The 'Storing User Corrections' bullet went entirely: every clause in
      // it was already documented on store_user_correction's arguments, envelope included.
      expected = expected.replace(
        " Every outfit MUST include a shoes-role piece — never finalize an outfit without one. If no suitable shoe exists in the wardrobe for this occasion, say plainly that the wardrobe has a shoe gap; do not call 'propose_outfit' for an incomplete outfit using missing_gaps as a shoe substitute.",
        ''
      )
      expected = expected.replace(
        ' Search for a visually plausible base underneath it: a fitted or smooth primary_top, or a simple dress, unless the saved garment notes explicitly say it works over a button-down or bulkier blouse.',
        ''
      )
      expected = expected.replace(
        " Honor the per-result flags returned by 'search_wardrobe': use `weatherFit` (avoid heavy fabrics like denim on hot daytime looks; reserve heavier pieces for cool-evening layers) and the `ruleFit` tier.",
        ''
      )
      expected = expected.split('\n').filter(line => !line.includes("* Storing User Corrections:")).join('\n')
      // 2026-08-30: docs/future-trip-weather-estimate-spec.md §3.2/§4.3.
      // weather:'indoor' is no longer taught — environment:'indoor' is the
      // sole model-facing indoor signal, since weather is now always
      // structured (user_weather/weather_estimate), never free text. Also
      // instructs the model to supply weather_estimate on the first
      // plan_outfit_set call for a future named-destination trip, and to
      // translate only an explicitly user-stated weather claim into
      // user_weather (numeric range or qualitative band, converting Celsius
      // to Fahrenheit itself) rather than its own seasonal knowledge.
      expected = expected.replace(
        "INDOOR slots are climate-controlled, so the OUTDOOR forecast must not drive them: for an office/work day, an indoor event, a restaurant, or any slot spent inside, pass \`weather:'indoor'\` so the slot is NOT composed for outdoor heat or cold — an office in a July heatwave is still air-conditioned, so do not serve sleeveless, breezy, or beachy pieces as if she'll be outside in the sun (offices often run cool, if anything). Reserve the live per-slot forecast for slots actually spent OUTDOORS: city walking, wineries, a hike, the coast, an outdoor event.",
        "INDOOR slots are climate-controlled, so the OUTDOOR forecast must not drive them: for an office/work day, an indoor event, a restaurant, or any slot spent inside, set \`environment:'indoor'\` — the ONLY field for indoor/outdoor/beach_coastal, never weather text — so the slot is NOT composed for outdoor heat or cold — an office in a July heatwave is still air-conditioned, so do not serve sleeveless, breezy, or beachy pieces as if she'll be outside in the sun (offices often run cool, if anything). Reserve the live per-slot forecast for slots actually spent OUTDOORS: city walking, wineries, a hike, the coast, an outdoor event. Weather itself is now always structured, never prose: for a FUTURE named-destination trip (dates that may fall outside the live forecast window, e.g. more than ~2 weeks out), pass a conservative numeric \`weather_estimate\` (\`high_f\`/\`low_f\`) alongside \`location\`/\`date_range\` on this SAME first call — live weather is always tried first and wins whenever it succeeds, so the estimate only matters as a fallback, but omitting it risks a \`weather_context_required\` stop that costs a second round trip. Never call an estimate a forecast or imply the user stated it; it is your own seasonal judgment, and the cooler end should cover evening/early-morning transit. If — and only if — the user's CURRENT message explicitly states the weather themselves (\"it's supposed to be cold\", \"expect rain\", \"high 65F\"), translate only what they actually said into \`user_weather\` (a numeric \`high_f\`/\`low_f\` range, or a qualitative \`temperature_band\` of hot/cold/mild — never both; convert a stated Celsius value to Fahrenheit yourself). Do not read your own \`weather_estimate\` back as if the user had said it, and do not invent a \`user_weather\` from your own knowledge — that field exists only for what they actually stated this turn. Read the tool's returned resolved weather, allowed roster, and submission requirements before proposing anything; if it returns \`weather_context_required\`, re-call with \`weather_estimate\` before composing."
      )
      // 2026-08-31: spec §6.5 single-outfit parity. search_wardrobe/propose_outfit/generate_outfits
      // gained the same structured weather contract and typed weather_context_required stop as
      // plan_outfit_set (styling-engine/tools.js's weatherContextRequiredStop) — the prompt now
      // teaches the model that, not just plan_outfit_set.
      expected = expected.replace(
        'Only the genuinely open-ended case — no occasion stated, just "I\'m going on a trip" / "help me pack" — should trigger the clarifying question.',
        'Only the genuinely open-ended case — no occasion stated, just "I\'m going on a trip" / "help me pack" — should trigger the clarifying question. \'search_wardrobe\', \'propose_outfit\', and \'generate_outfits\' resolve weather the same structured way as \'plan_outfit_set\' (live forecast, then \`weather_estimate\`, then \`user_weather\`) and can likewise return \`status: "weather_context_required"\` when a named future destination/date falls outside live coverage with no estimate supplied — for a destination dated more than ~2 weeks out, pass a conservative \`weather_estimate\` (\`high_f\`/\`low_f\`) alongside \`location\`/\`date\` on the SAME call to avoid that round trip; if it stops anyway, re-call the same tool with \`weather_estimate\` filled in before searching, proposing, or composing.'
      )
    // 2026-09-03: docs/search-propose-signal-inventory.md — thermal/season policy removed from the
    // prompt itself, not just from search_wardrobe's payload. Three deltas: (1) the alternative-swap
    // bullet stops naming the removed `weatherFit` field; (2) the compose-mode bullet stops
    // instructing the model to "favor `preferred`" and states what the tiers mean instead of what to
    // do about them; (3) the INDOOR bullet stops prescribing "do not serve sleeveless" as a blanket
    // rule and states the two fed facts (heated rooms, a coat is not necessarily worn indoors)
    // instead — the exact leak that let a no-tool turn reproduce this policy with zero tool calls.
    if (key === 'STYLIST_SYSTEM') {
      expected = expected.replace(
        'Search with the same occasion/activity/weather context and choose alternatives whose `ruleFit` and `weatherFit` still support that register.',
        'Search with the same occasion/activity/weather context; each result carries its own thermal facts (warmth, insulation, season) and `ruleFit` for occasion/register fit — judge the replacement\'s suitability yourself from those facts and the conditions already established this turn, the same way you would judge any other candidate.'
      )
      expected = expected.replace(
        'results are already filtered to what is wearable for the requested occasion/activity — `prohibited` pieces are removed for you, so compose freely from what comes back without self-rejecting anything; treat `discouraged` pieces as legitimate judgment calls (permitted, not preferred), favor `preferred`, and note that `unknown` means the piece lacks the metadata to judge.',
        'results are already filtered to what is wearable for the requested occasion/activity — `prohibited` pieces are removed for you, so compose freely from what comes back without self-rejecting anything. `ruleFit` states the engine\'s own occasion/register read (`discouraged` is a legitimate, permitted choice, not a piece to avoid by default; `unknown` means the piece lacks the metadata to judge, not that it fails) — weigh it as one input alongside the garment\'s own facts and the outfit\'s visual thesis, the way you would any other piece of evidence, rather than defaulting to whichever piece the tier ranks highest.'
      )
      expected = expected.replace(
        'or cold — an office in a July heatwave is still air-conditioned, so do not serve sleeveless, breezy, or beachy pieces as if she\'ll be outside in the sun (offices often run cool, if anything). Reserve',
        'or cold. An office in a July heatwave is still air-conditioned and often runs cool rather than warm; judge the base\'s warmth for an ordinary indoor room, not for the day outside, and remember any layer worn for the walk there and back is not necessarily worn once indoors — the same distinction applies at arrival and departure regardless of season. Reserve'
      )
    }
    }
    // 2026-08-26: sleeve taxonomy rewrite — sleeve_shape's fashion-name enum
    // (fitted|straight|relaxed|puff|bishop|bell|flutter|raglan|dolman|other|unknown) replaced with a
    // functional sleeve-volume taxonomy canonically owned by SLEEVE_SHAPE_VALUES in attributes.js.
    // See docs/garment-field-reference.md's "Sleeve taxonomy" writeup.
    if (key === 'TAG_PIECE_PROMPT') {
      expected = expected.replace(
        '"sleeve_shape": "fitted|straight|relaxed|puff|bishop|bell|flutter|raglan|dolman|other|unknown|null (omit for sleeveless)",',
        '"sleeve_shape": "fitted|straight|puff_shoulder|gathered_ruched|voluminous|flared|deep_armhole|other|unknown|null (omit for sleeveless) — a functional sleeve-VOLUME classification, not a fashion-name label; see the Sleeve Shape guidance below for what each value means.",'
      )
      expected = expected.replace(
        '   - Voluminous (oversized, boxy, bishop sleeve, bell sleeve, full skirt): Stands out as the dominant shape.',
        '   - Voluminous (oversized, boxy, a sleeve with real shoulder/arm/cuff volume, full skirt): Stands out as the dominant shape.'
      )
      expected = expected.replace(
        '- Sleeve Shape: Select "bishop" or "bell" when there is visible sleeve volume (ballooning through the arm, gathered at the shoulder, or cinched tightly at the cuff). Do not default to sleeve_length "long" with no shape if these voluminous features are present — sleeve_length and sleeve_shape are separate fields; a voluminous long sleeve is sleeve_length "long" + sleeve_shape "bishop"/"bell". Default to a plain sleeve_shape only for simple, straight, non-voluminous sleeves.',
        '- Sleeve Shape: a functional classification of WHERE the sleeve carries excess volume, not a fashion-history label — you may use fashion terms as recognition clues, but the output must be one of the canonical values only. "puff_shoulder" = volume concentrated at the shoulder/sleeve head (puff, mutton with shoulder-head fullness). "gathered_ruched" = bulk from gathering/ruching along the arm or lower arm. "voluminous" = substantial full-arm or mid-arm volume (bishop, balloon, lantern sleeves). "flared" = the sleeve opens substantially toward the cuff (bell, flutter, flounce). "deep_armhole" = excess fabric at the underarm/armhole itself (dolman, batwing, deep kimono-style construction) — a raglan SEAM alone (attachment construction, not volume) does not by itself justify any of these; classify raglan-seamed sleeves by their actual sleeve-volume geometry, defaulting to "straight" if there is no meaningful excess volume. "fitted" = close/slim with little excess volume. "straight" = an ordinary sleeve with no localized excess volume — ordinary looseness alone is "straight", not "voluminous"; gathering elsewhere on the garment (not the sleeve) does not imply "gathered_ruched". Do not default to sleeve_length "long" with no shape if genuine volume is present — sleeve_length and sleeve_shape are separate fields. Use "other" only when the sleeve geometry genuinely does not fit any category above. Use "unknown" when a sleeve exists but its shape cannot be reliably determined — never guess. Sleeveless pieces omit this field entirely (null), never "unknown".'
      )
      expected = expected.replace(
        '  pintucked body with volumed (bishop/puff) sleeves and a finished back detail — executed\n  in quality fabric, not jersey.\n  silhouette: "fitted", fit_on_body: "skims", sleeve_length: "long", sleeve_shape: "bishop",',
        '  pintucked body with volumed (bishop-style) sleeves and a finished back detail — executed\n  in quality fabric, not jersey.\n  silhouette: "fitted", fit_on_body: "skims", sleeve_length: "long", sleeve_shape: "voluminous",'
      )
    }
    assert.strictEqual(built[key], expected, `byte drift in ${key}`)
  }
})

// The stylist prompt is built in two layers: stylistSystemTemplate holds the base text, and
// currentStylistSystemTemplate applies .replace() patches that supersede specific strings in it.
// String.replace is a SILENT no-op when its needle is not found — so editing a base line that a
// patch targets does not error, does not fail a build, and quietly reverts that correction to the
// older wording. This is the trap standing between here and any clause-level edit of the prompt.
//
// Parses the patch pairs out of the source rather than listing them, so a new patch is covered the
// day it is written.
test('every currentStylistSystemTemplate patch still finds its target', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8')
  const start = source.indexOf('function currentStylistSystemTemplate')
  assert.ok(start > 0, 'the patch layer must still exist')
  const body = source.slice(start, source.indexOf('\n}', source.indexOf('return stylistSystemTemplate', start)))

  // .replace('old', 'new') across the quote styles used in this file.
  const pairs = [...body.matchAll(/\.replace\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)]
  assert.ok(pairs.length >= 4, `expected the patch layer to be parsed, found ${pairs.length}`)

  const built = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION }).STYLIST_SYSTEM
  const unescape = text => text.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')

  for (const [, rawOld, rawNew] of pairs) {
    const before = unescape(rawOld)
    const after = unescape(rawNew)
    assert.ok(!built.includes(before),
      `a patch did not apply — its target text is still in the built prompt, so the correction was lost silently: ${before.slice(0, 70)}`)
    assert.ok(built.includes(after),
      `a patch's replacement text is missing from the built prompt: ${after.slice(0, 70)}`)
  }
})

test('untouched global prompt constants still match the snapshot', async () => {
  const prompts = await import('../styling-engine/prompts.js')
  for (const key of ['EXPRESSIVE_HIERARCHY_RULES', 'TAG_PIECE_SYSTEM', 'EXTRACT_PIECES_SYSTEM', 'EDITORIAL_IMAGE_BASE_PROMPT', 'EDITORIAL_IMAGE_REALISM_RULE', 'STYLE_SELECTED_ITEM_FEW_SHOTS']) {
    assert.strictEqual(prompts[key], snapshot[key], `byte drift in global ${key}`)
  }
  assert.deepStrictEqual(prompts.WHOLE_WARDROBE_OUTFIT_ARCHETYPES, snapshot.WHOLE_WARDROBE_OUTFIT_ARCHETYPES)
  assert.deepStrictEqual(prompts.OUTFIT_MISSIONS, snapshot.OUTFIT_MISSIONS)
})

test('generic default assembly is fully de-personalized', () => {
  const built = buildPrompts()
  const all = ASSEMBLED_KEYS.map(key => built[key]).join('\n')
  assert.ok(!/\bYuna\b/.test(all), 'generic prompts must not mention Yuna')
  assert.ok(!/\bshe\b/i.test(all), 'generic prompts must not use she')
  assert.ok(!/\bUrban Artisan\b/.test(all), 'generic prompts must not assert an aesthetic home base')
  assert.ok(!/Plum and mustard are just raw color names/.test(all), 'generic prompts must not carry the plum/mustard ruling')
  assert.ok(!/except by /.test(built.AESTHETIC_GRAVITY), 'generic aesthetic layer must not carry owner-specific ratification language')
  // Per-user drift vocabulary lives in Layer 4 (lane_neutrality) and must be absent from the
  // generic layer. The composer/editorial templates' anti-drift language ("librarian drift" etc.)
  // is global editorial craft doctrine (spec 6), same class as the tagger rulings — deliberately
  // NOT per-user, so it is not asserted here.
  assert.ok(!/librarian|teacher/.test(built.LANE_NEUTRALITY), 'generic Layer 4 must not carry ratified drift vocabulary')
  assert.ok(/the user's personal stylist/.test(built.STYLIST_SYSTEM), 'generic stylist prompt addresses a generic user')
  assert.ok(/their wardrobe/.test(built.STYLIST_SYSTEM), 'generic prompts use they/them by default')
})

test('partial constitution rows fall back per-layer to the generic defaults', () => {
  const built = buildPrompts({ constitution: { body_contract: 'Layer 1 — custom contract', working_style: '   ' } })
  assert.strictEqual(built.BODY_CONTRACT, 'Layer 1 — custom contract')
  assert.strictEqual(built.WORKING_STYLE, DEFAULT_CONSTITUTION.working_style)
  assert.ok(built.STYLIST_SYSTEM.includes('Layer 1 — custom contract'))
  for (const key of CONSTITUTION_LAYER_KEYS) assert.ok(typeof DEFAULT_CONSTITUTION[key] === 'string' && DEFAULT_CONSTITUTION[key].length > 0)
})
