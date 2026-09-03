#!/usr/bin/env node
// Deterministic QA of the shipped thermal path (§25.1). REAL wardrobe data, ZERO model calls.
//
// Covers six of the eight cases; the two that need a live tool loop (does search_wardrobe actually
// surface the evidence, and do adequacy findings fight composition) are marked SKIPPED and belong
// to the in-app run.
//
//   WARDROBE_DB_PATH=<copy> node scratch/qa_thermal_shipped_path.mjs
import { wardrobeCategoryGroup } from '../styling-engine/attributes.js'
const { db, parsePiece } = await import('../db.js')
const { weatherFitForPiece } = await import('../styling-engine/rules.js')
const { evaluateOutfitEnvironmentalAdequacy } = await import('../styling-engine/outfitEnvironmentalAdequacy.js')
const { requiredThermalBand, compareThermalFit } = await import('../styling-engine/thermalDemand.js')
const { resolveExposureContext } = await import('../styling-engine/exposure.js')
const { outfitThermalContribution } = await import('../styling-engine/outfitThermalContribution.js')
const { garmentWarmthLevel } = await import('../styling-engine/garmentWarmth.js')
const { validateUserWeather, resolveWeatherContext } = await import('../styling-engine/weather.js')

const W = (h, l) => ({ ...resolveWeatherContext({ userWeather: validateUserWeather({ high_f: h, low_f: l }) }).temperature })
const all = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
const byId = id => all.find(p => Number(p.id) === id)
const outer = all.filter(p => wardrobeCategoryGroup(p) === 'outerwear')

let fails = 0
const check = (label, ok, detail = '') => {
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}
const rank = (weather, exposure) => outer
  .map(p => ({ p, s: weatherFitForPiece(p, weather, exposure ? { exposure } : {}).score }))
  .sort((a, b) => b.s - a.s)

console.log('# Deterministic QA — shipped thermal path, real wardrobe, no model calls\n')
console.log(`active pieces ${all.length} · outerwear ${outer.length}\n`)

// ── 1. 65/47 museum: a lighter layer ahead of the puffer ─────────────────────────────────────
console.log('## 1. 65/47 museum day (walking, outdoor)')
const museum = resolveExposureContext({ activity: 'walking', environment: 'outdoor' }, W(65, 47))
const r1 = rank(W(65, 47), museum)
const puffer = byId(996775)
const pufferRank = r1.findIndex(x => Number(x.p.id) === 996775)
console.log(`  top 5: ${r1.slice(0, 5).map(x => `${String(x.p.name).slice(0, 24)}(${x.s})`).join(' · ')}`)
check('the down puffer is not the top-ranked layer', pufferRank > 0, `rank ${pufferRank + 1} of ${r1.length}`)
check('something lighter out-ranks it', r1[0].s > (r1[pufferRank]?.s ?? 0),
  `${String(r1[0].p.name).slice(0, 30)} ${r1[0].s} > puffer ${r1[pufferRank]?.s}`)

// ── 2. 30/20 outdoor: the puffer becomes preferred ───────────────────────────────────────────
console.log('\n## 2. 30/20 genuinely cold (outdoor)')
const coldExp = resolveExposureContext({ activity: 'none', environment: 'outdoor' }, W(30, 20))
const r2 = rank(W(30, 20), coldExp)
const pufferRank2 = r2.findIndex(x => Number(x.p.id) === 996775)
console.log(`  top 5: ${r2.slice(0, 5).map(x => `${String(x.p.name).slice(0, 24)}(${x.s})`).join(' · ')}`)
check('the puffer is now among the top-ranked layers', pufferRank2 < 6, `rank ${pufferRank2 + 1}`)
check('the ordering reversed against case 1', pufferRank2 < pufferRank, `${pufferRank + 1} -> ${pufferRank2 + 1}`)

// ── 3. indoor destination + outdoor transit ──────────────────────────────────────────────────
console.log('\n## 3. indoor destination, outdoor transit (65/47)')
const dinner = resolveExposureContext({ activity: 'none', environment: 'indoor' }, W(65, 47))
const dd = requiredThermalBand(dinner)
check('the base is an indoor-comfort problem', dd.level === 'light', `base demand ${dd.level}`)
check('the transit window keeps its own demand', Boolean(dd.transit), `transit ${dd.transit?.level}`)
check('transit is warmer than the base', dd.transit && dd.transit.level !== dd.level)

// ── 4. puffer-only wardrobe: usable, never excluded ──────────────────────────────────────────
console.log('\n## 4. puffer-only wardrobe on a mild day (72/62)')
const base = all.filter(p => ['top', 'bottom', 'shoes'].includes(wardrobeCategoryGroup(p))).slice(0, 3)
const mildFit = weatherFitForPiece(puffer, W(72, 62))
check('the puffer still receives a score and a reason', Number.isFinite(mildFit.score) && mildFit.adjustments.length > 0,
  `score ${mildFit.score}`)
const adq = evaluateOutfitEnvironmentalAdequacy([...base, puffer], { weatherProfile: W(72, 62), environment: 'outdoor' })
const errs = (adq.findings || []).filter(f => f.severity === 'error')
check('overshoot never becomes a hard error', errs.every(f => !String(f.code).includes('thermal_capacity_above')),
  (adq.findings || []).map(f => `${f.severity}:${f.code.replace('outfit_', '')}`).join(', ') || 'no findings')

// ── 5. unknown evidence: no false certainty, no hard block ───────────────────────────────────
console.log('\n## 5. unknown thermal evidence')
const unplaceable = all.filter(p => garmentWarmthLevel(p) === null && wardrobeCategoryGroup(p) !== 'shoes')
console.log(`  garments the placement cannot position: ${unplaceable.length} of ${all.length}`)
check('an unplaceable garment gets no thermal opinion', weatherFitForPiece(unplaceable[0], W(40, 30)).score === 0,
  String(unplaceable[0]?.name).slice(0, 34))
const unkOutfit = [unplaceable[0], ...base.slice(1)]
const unkAdq = evaluateOutfitEnvironmentalAdequacy(unkOutfit, { weatherProfile: W(40, 30), environment: 'outdoor' })
const unkErrs = (unkAdq.findings || []).filter(f => f.severity === 'error' && String(f.code).includes('thermal_capacity'))
check('unknown evidence never produces a hard thermal error', unkErrs.length === 0)
const contrib = outfitThermalContribution(unkOutfit)
check('unknown is recorded structurally, not coerced to zero', contrib.unknown.base || contrib.unknown.removable)

// ── 6. mild day: no gratuitous layer pressure ────────────────────────────────────────────────
console.log('\n## 6. mild day (75/60) — no invented layer pressure')
const mildExp = resolveExposureContext({ activity: 'walking', environment: 'outdoor' }, W(75, 60))
const mildDemand = requiredThermalBand(mildExp)
check('demand stays low on a genuinely mild day', ['very light', 'light', 'moderate'].includes(mildDemand.level),
  `demand ${mildDemand.level}`)
const mildAdq = evaluateOutfitEnvironmentalAdequacy(base, { weatherProfile: W(75, 60), environment: 'outdoor' })
check('a bare base on a mild day raises no thermal error',
  !(mildAdq.findings || []).some(f => f.severity === 'error' && String(f.code).includes('thermal_capacity')),
  (mildAdq.findings || []).map(f => f.severity + ':' + f.code.replace('outfit_', '')).join(', ') || 'no findings')

console.log('\n## 7/8 — SKIPPED, need a live tool loop')
console.log('  search_wardrobe surfaces the evidence in a real turn')
console.log('  adequacy advisories do not fight composition')

console.log(fails ? `\n❌ ${fails} deterministic check(s) failed` : '\n✅ all deterministic checks passed')
process.exit(fails ? 1 : 0)
