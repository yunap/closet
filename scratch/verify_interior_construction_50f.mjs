#!/usr/bin/env node
// docs/interior-construction-spec.md §10 step 9 — end-to-end weather verification.
//
// The question the whole spec exists to answer: "can this jacket plausibly work around 50°F?"
// Runs the REAL resolved-weather path (resolveWeatherContext → evaluateOutfitEnvironmentalAdequacy
// → pieceWeatherScores) against the repaired wardrobe rows. No model calls: every step here is
// deterministic, so this costs nothing to re-run.
import { resolveWeatherContext, validateUserWeather } from '../styling-engine/weather.js'
import { evaluateOutfitEnvironmentalAdequacy } from '../styling-engine/outfitEnvironmentalAdequacy.js'
import { thermalMaterialVerdict } from '../styling-engine/attributes.js'
const { db, parsePiece } = await import('../db.js')
const { pieceWeatherScores } = await import('../styling-engine/thermal.js')

const OUTER = [996767, 996764, 996759, 207, 996868, 996775, 996866, 996867, 996765, 996762, 250]
const rows = db.prepare(`SELECT * FROM pieces WHERE id IN (${OUTER.join(',')})`).all().map(parsePiece)
const P = new Map(rows.map(r => [Number(r.id), r]))

// A real 58/50°F autumn day, resolved through the canonical path rather than hand-built.
// The user-weather contract is snake_case high_f/low_f — camelCase silently validates to null and
// the whole context resolves 'unavailable', which makes every adequacy verdict vacuously empty.
// resolveWeatherContext takes VALIDATED user weather, not the raw payload — passing the raw object
// silently resolves 'unavailable' and makes every adequacy verdict vacuously empty.
const stated = validateUserWeather({ high_f: 58, low_f: 50, precipitation: 'none', wind: 'calm' })
const ctx = resolveWeatherContext({ userWeather: stated })
const weather = ctx.temperature
if (ctx.status === 'unavailable' || weather.lowF === null) {
  console.error('resolved weather is unavailable — the verification below would be vacuous'); process.exit(1)
}
console.log('# End-to-end: 58°F / 50°F, resolved through the real weather path\n')
console.log('resolved profile:', JSON.stringify({
  highF: weather.highF, lowF: weather.lowF, band: weather.band, isCold: weather.isCold,
  isColdSevere: weather.isColdSevere, needsRemovableCoolLayer: weather.needsRemovableCoolLayer,
  source: weather.source,
}))

const base = [
  { id: 1, category: 'top', name: 'cotton long-sleeve tee', fabric_weight: 'medium', fiber_content: ['cotton'], sleeve_length: 'long' },
  { id: 2, category: 'bottom', name: 'straight jeans', fabric_weight: 'medium', fabric_category: 'denim', fiber_content: ['denim'], length_hits_at: 'ankle' },
  { id: 3, category: 'shoes', name: 'leather ankle boots', fabric_category: 'leather' },
]

console.log('\n## Each outer layer over the same base, at 50°F')
console.log(`  ${'id'.padEnd(8)}${'garment'.padEnd(36)}${'verdict'.padEnd(16)}${'cold'.padStart(5)}   adequacy`)
const results = []
for (const id of OUTER) {
  const p = P.get(id)
  if (!p) continue
  const outfit = [...base, p]
  const verdict = evaluateOutfitEnvironmentalAdequacy(outfit, { weatherProfile: weather, environment: 'outdoor' })
  const findings = (verdict.findings || []).map(f => `${f.severity}:${f.code}`).join(',') || 'none'
  const s = pieceWeatherScores(p)
  results.push({ id, cold: s.cold, findings })
  console.log(`  ${String(id).padEnd(8)}${String(p.name).slice(0, 34).padEnd(36)}` +
    `${thermalMaterialVerdict(p).padEnd(16)}${String(s.cold).padStart(5)}   ${findings}`)
}

console.log('\n## What the 50°F question actually gets')
const byCold = [...results].sort((a, b) => a.cold - b.cold)
console.log('  coldest-appropriate ordering the engine now produces (cold score ascending):')
console.log('    ' + byCold.map(r => `${r.id}(${r.cold})`).join('  <  '))

const failures = []
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
// Control: the same base with NO outer layer must produce a finding. Without this, "adequacy:
// none" above proves nothing — an inert path returns no findings for every input.
const bare = evaluateOutfitEnvironmentalAdequacy(base, { weatherProfile: weather, environment: 'outdoor' })
const bareFindings = (bare.findings || []).map(f => `${f.severity}:${f.code}`).join(',')
console.log(`\n## Control — same base, no outer layer: ${bare.applicable === false ? 'PATH INERT' : bareFindings || 'no findings'}`)

console.log('\n## Invariants at 50°F')
check('the adequacy path is actually live at this tier',
  bare.applicable !== false && bareFindings.length > 0,
  bareFindings || 'no finding for a coatless 50°F outfit — the harness proves nothing')
const cold = id => pieceWeatherScores(P.get(id)).cold
check('the reversible jacket sits between the unlined jacket and the real coats',
  cold(996767) < cold(996764) && cold(996764) < cold(996775),
  `996767 ${cold(996767)} < 996764 ${cold(996764)} < 996775 ${cold(996775)}`)
check('no outer layer is rejected outright by the adequacy path at this tier',
  results.every(r => !r.findings.includes('error')),
  'a 50°F day is a removable-layer tier, not a severe-cold one')
check('the engine no longer treats the reversible jacket as a winter coat',
  thermalMaterialVerdict(P.get(996764)) !== 'insulating')
check('and still ranks it above the genuinely unlined jacket',
  cold(996764) > cold(996767))

console.log(failures.length ? `\n❌ ${failures.length} contradiction(s)` : '\n✅ 50°F path behaves as specified')
process.exit(failures.length ? 1 : 0)
