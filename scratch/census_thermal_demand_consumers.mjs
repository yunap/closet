#!/usr/bin/env node
// docs/exposure-conditions-spec.md §10 Slice 1 — the verification census.
//
// Enumerates every live reference to the cold/cool flag family outside weather.js and classifies
// each by THE QUESTION IT ANSWERS — revised 2026-09-03 (§21) after implementation evidence
// falsified the original completion criterion.
//
// The first version classified by WHICH FLAG a site reads, and lumped everything into
// `thermal_demand` with a `-> 0` target. Step 4 measured that assumption and it was too broad: a
// removable-layer requirement and an outdoor-capability requirement are not ordinal warmth
// questions, and mapping the band's levels onto them would have required a removable layer at
// 75/60. Reading `isCold` is not the same as answering "how much warmth".
//
//   thermal_amount     "how much thermal contribution is appropriate" — MUST reach 0 legacy readers
//   parallel_contract  presence / adaptability / coverage / capability — allowed to keep a legacy
//                      trigger for now, but must have NAMED independent ownership, and must never
//                      derive its semantics from the thermal band
//   projection         display, prompt text, owner-rule and metadata surfaces — migrated separately
//   non_thermal        footwear / rain — independent, and must NOT fall to zero
//   derivation         computes the flag shape FROM structured weather or from an existing profile
//                      — carries no independent authority; legitimate for as long as the parallel
//                      contracts consume flags
//   producer           creates cold truth from something that is NOT structured weather. This is the
//                      class with independent authority, and the only one step 6 has to justify.
//
// DONE means: no consumer derives thermal AMOUNT from legacy cold flags, and no independent
// contract accidentally derives its semantics from the band. Not "every count is zero".
//
// Comments are excluded: a grep hit inside a comment is not a consumer. Deterministic, no DB, no
// model calls. Re-run after any migration step to watch thermal_demand fall to zero.
import fs from 'node:fs'
import path from 'node:path'

const FLAGS = ['isCold', 'isColdSevere', 'transitIsCold', 'transitIsColdSevere',
  'needsRemovableCoolLayer', 'transitNeedsRemovableCoolLayer']
const ROOTS = ['styling-engine', 'routes', 'src']
const EXCLUDE = new Set(['styling-engine/weather.js'])   // the producer of record

// Classification by enclosing owner. Where one owner mixes concerns, the line-level rules below
// refine it — evaluateOutfitEnvironmentalAdequacy is the case that matters.
const OWNER_CLASS = {
  // Derivations: each computes the flag shape from structured weather (resolved.temperature) or by
  // transforming a profile it was handed. None invents a temperature.
  profileForEnvironment: 'derivation',
  resolveSlotWeather: 'derivation',
  profileFromResolvedWeatherContext: 'derivation',
  projectStylingApplicabilityContext: 'derivation',
  // The one genuine producer: it parses prose and emits isCold with NO structured temperature
  // behind it. See §23.
  weatherProfileFromContext: 'producer',
  describeWeatherProfile: 'projection',
  weatherSummary: 'projection',
  savedOutfitImagePrompt: 'projection',
  isStyleSelectedQuestion: 'projection',
  executeToolInternal: 'projection',
  wholeWardrobePieceTrustDecision: 'parallel_contract',
  scoreWholeWardrobeCandidate: 'thermal_amount',
  weatherFitForPiece: 'thermal_amount',
  piecePriorityForMission: 'thermal_amount',
  elevatedCapsuleDemands: 'parallel_contract',
  slotGateEligiblePieces: 'parallel_contract',
  buildVisualComposerRoster: 'parallel_contract',
  evaluateOutfitEnvironmentalAdequacy: 'parallel_contract',
  finding: 'projection',
}

// Context-level overrides. The flag line itself rarely names what it decides — `if
// (weatherProfile.isCold || weatherProfile.transitIsCold ...)` looks identical whether it guards a
// footwear exclusion or a warmth floor. So these scan a WINDOW around the hit, including its
// comments, which is where this codebase states intent.
//
// Footwear is the clearest non-thermal contract: a shoe is wrong in the wet or the cold for reasons
// that are not "how much insulation does this day need" (spec §7, band spec §3.6).
const CONTEXT_RULES = [
  // Scoring bonuses/penalties keyed on a cold flag ARE thermal amount, wherever they sit. These live
  // inside buildVisualComposerRoster — `parallel_contract` by owner — and PR B missed them for
  // exactly that reason: the enclosing function builds a roster, but these lines are heavy-fabric
  // cold bonuses, which is the amount question applied to scoring clothes.
  //
  // Windowed, not line-matched: the guard reads the flag and the bonus lands two lines below it, so
  // a line-level rule saw `if (isHeavy && weatherProfile.isColdSevere) {` and matched nothing.
  [/weatherBonus\s*[+-]=/, 'thermal_amount'],
  [/\b(footwear|shoe|sneaker|boot|mesh upper|open[- ]toe|sandal|toe_shape|walk_support)\b/i, 'non_thermal'],
  [/\b(rain|waterproof|precipitation|wet)\b/i, 'non_thermal'],
]
const LINE_RULES = [
  [/evidence\s*=|isCold:\s*Boolean|isColdSevere:\s*Boolean|transitNeeds\w+:\s*Boolean|\?\s*'/, 'projection'],
  // Prompt-projection switches. Band spec §6 classifies these as "probably continuous /
  // availability-based, needs design" and names the second one as a DEFECT in its own right: there
  // is no good reason for the model to go from hearing nothing about thermal conditions to hearing
  // full weather guidance at a threshold crossing. They project; their TRIGGER migrates with the band.
  [/requirements\.push|isWeatherFiltered/, 'projection'],
]
// Same two switches, matched on the guard line rather than the pushed string.
const NEXT_LINE_RULES = [
  [/requirements\.push/, 'projection'],
]

// The owner is the MODULE-LEVEL declaration, so this matches column 0 only. A first attempt relaxed
// the indentation to catch sites the 260-line lookback had missed, and promptly reported local
// helpers (`corroborate`, `exclusions`) as the owner of a rule they merely sit inside. The real
// problem was distance, not indentation: these are long functions.
function enclosingOwner(lines, idx) {
  for (let k = idx; k >= Math.max(0, idx - 900); k--) {
    const m = lines[k].match(
      /^(?:export )?(?:async )?function\*? (\w+)|^(?:export )?(?:const|let) (\w+)\s*=\s*(?:async\s*)?(?:\(|function)/)
    if (m) return m[1] || m[2]
  }
  return ''
}

// The window a CONTEXT_RULE reads: the statement plus the comment block that introduces it.
function contextWindow(lines, idx) {
  return lines.slice(Math.max(0, idx - 8), Math.min(lines.length, idx + 6)).join('\n')
}

const rows = []
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { walk(full); continue }
    if (!/\.(js|jsx)$/.test(e.name)) continue
    const rel = path.relative(process.cwd(), full)
    if (EXCLUDE.has(rel)) continue
    const lines = fs.readFileSync(full, 'utf8').split('\n')
    lines.forEach((raw, i) => {
      const text = raw.trim()
      if (!FLAGS.some(f => new RegExp(`\\b${f}\\b`).test(text))) return
      if (text.startsWith('//') || text.startsWith('*')) return          // comment, not a consumer
      const owner = enclosingOwner(lines, i)
      let cls = OWNER_CLASS[owner] || 'unclassified'
      // Context only REFINES a demand-ish site into a non-thermal contract. It must not reclassify
      // a producer or a projection: `savedOutfitImagePrompt` and `profileFromResolvedWeatherContext`
      // were both flipped to non_thermal by a stray "rain" in their neighbourhood before this guard.
      // Context refines a demand-ish or contract-ish site into a non-thermal one. The guard listed
      // only the retired `thermal_demand` class after the §21 reclassification, so every footwear
      // and wet-weather site stayed `parallel_contract` and `non_thermal` fell to ZERO — the exact
      // alarm this class exists to raise, fired by the tool rather than by the code.
      if (['thermal_amount', 'parallel_contract', 'unclassified'].includes(cls)) {
        const win = contextWindow(lines, i)
        for (const [re, c] of CONTEXT_RULES) if (re.test(win)) { cls = c; break }
      }
      for (const [re, c] of LINE_RULES) if (re.test(text)) { cls = c; break }
      const next = (lines[i + 1] || '').trim()
      for (const [re, c] of NEXT_LINE_RULES) if (re.test(next)) { cls = c; break }
      rows.push({ file: rel, line: i + 1, owner, cls, text: text.slice(0, 120) })
    })
  }
}
for (const r of ROOTS) if (fs.existsSync(r)) walk(r)

const by = rows.reduce((a, r) => (a[r.cls] = (a[r.cls] || 0) + 1, a), {})
console.log('# Thermal-demand consumer census\n')
console.log(`live references (comments excluded): ${rows.length}\n`)
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}`)
}
console.log('\n## thermal_amount — MUST reach 0: these derive AMOUNT from legacy flags')
for (const r of rows.filter(r => r.cls === 'thermal_amount')) {
  console.log(`  ${(r.file + ':' + r.line).padEnd(52)} ${r.owner}`)
}
console.log('\n## parallel_contract — independent questions; must NOT take band semantics')
for (const r of rows.filter(r => r.cls === 'parallel_contract')) {
  console.log(`  ${(r.file + ':' + r.line).padEnd(52)} ${r.owner}`)
}
console.log('\n## non_thermal — these stay INDEPENDENT (spec §7)')
for (const r of rows.filter(r => r.cls === 'non_thermal')) {
  console.log(`  ${(r.file + ':' + r.line).padEnd(52)} ${r.owner}`)
}
const un = rows.filter(r => r.cls === 'unclassified')
if (un.length) {
  console.log('\n## UNCLASSIFIED — must be resolved before migration')
  for (const r of un) console.log(`  ${(r.file + ':' + r.line).padEnd(52)} ${r.owner || '(top level)'}  ${r.text}`)
}
fs.writeFileSync('scratch/thermal_demand_consumer_inventory.json', JSON.stringify({ generated: new Date().toISOString(), counts: by, rows }, null, 2))
console.log('\ninventory → scratch/thermal_demand_consumer_inventory.json')
