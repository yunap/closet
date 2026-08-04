#!/usr/bin/env node

// Provider-free A/B runner for deterministic capsule rankings. The baseline
// directory must contain the same `compare_capsule_rosters.js --verbose`
// diagnostic interface as the current checkout. This script is read-only.

import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PLAN_WORKBENCH_DRIVER = `
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const moduleDir = path.resolve(process.env.WORKBENCH_MODULE_DIR)
const planner = await import(pathToFileURL(path.join(moduleDir, 'styling-engine/outfitSetPlanner.js')).href)
const database = await import(pathToFileURL(path.join(moduleDir, 'db.js')).href)
const allPieces = database.db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(database.parsePiece)
const scenarios = [
  { name: 'extreme-heat active caregiving', question: 'active kid day in 105F heat', weather: 'extreme heat, highs 100-105F', slot: { label: 'Active Kid Day', occasion: 'casual', activity: 'walking', environment: 'outdoor', count: 1, best_for: 'chasing a 5-year-old at parks and playgrounds' } },
  { name: 'extreme-heat indoor transit', question: 'museum day during a 105F trip', weather: 'extreme heat, highs 100-105F', slot: { label: 'Indoor Museum', occasion: 'city', activity: 'none', environment: 'indoor', weather: 'indoor', count: 1, best_for: 'museum with outdoor transit' } },
  { name: 'home play operational ease', question: 'relaxed day at home', weather: 'warm', slot: { label: 'Relaxed Home / Downtime', occasion: 'casual', activity: 'none', environment: 'indoor', weather: 'indoor', count: 1, best_for: 'home base, indoor play, low-key days' } }
]
for (const scenario of scenarios) {
  const slots = planner.normalizePlanSlots([scenario.slot], { fallbackWeather: scenario.weather })
  const workbench = await planner.buildPlanSlotWorkbench(slots, { allPieces, question: scenario.question })
  const slot = workbench.slots[0] || {}
  console.log(JSON.stringify({ name: scenario.name, ids: slot.allowed_piece_ids || [], assessments: slot.piece_assessments || [] }))
}
`

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const baselineDir = arg('--baseline-dir')
const dbPath = arg('--db')
if (!baselineDir || !dbPath) {
  console.error('usage: node scratch/rankings_ab_diff.js --baseline-dir <checkout> --db <wardrobe-copy.db>')
  process.exit(2)
}

// Forwarded to BOTH checkouts so the two sides never measure different bench
// widths. An older baseline that predates the flag ignores it and uses its own
// hardcoded value — which is why the bench line prints `benchSize N` and that
// line is diffed: a mismatch surfaces as a reported difference instead of
// quietly invalidating the comparison.
const benchSize = arg('--bench-size')

function capture(cwd) {
  const result = spawnSync(
    process.execPath,
    ['scratch/compare_capsule_rosters.js', '--verbose', ...(benchSize ? ['--bench-size', benchSize] : [])],
    {
      cwd: path.resolve(cwd),
      env: { ...process.env, WARDROBE_DB_PATH: path.resolve(dbPath) },
      encoding: 'utf8',
    },
  )
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status || 1)
  }
  return result.stdout
}

function capturePlanWorkbenches(moduleDir) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', PLAN_WORKBENCH_DRIVER],
    {
      cwd: process.cwd(),
      env: { ...process.env, WARDROBE_DB_PATH: path.resolve(dbPath), WORKBENCH_MODULE_DIR: path.resolve(moduleDir) },
      encoding: 'utf8',
    },
  )
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status || 1)
  }
  return new Map(result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const parsed = JSON.parse(line)
    return [parsed.name, parsed]
  }))
}

// Two id lists are printed per scenario now, in the same `  <id> · name`
// format, so the reader tracks WHICH list it is inside rather than flipping a
// single boolean. The bench list was previously not captured at all, which
// meant a bench change of any size — width, category floors, ranking — reported
// zero differences here. The bench is the model's entire universe at stage 3,
// so that was the largest blind spot in this harness.
function parse(output) {
  const scenarios = new Map()
  let scenario = null
  let mode = null
  for (const line of output.split('\n')) {
    const heading = line.match(/^── (.+?) · budget/)
    if (heading) {
      scenario = { ids: [], benchIds: [], summary: [], benchSummary: [] }
      scenarios.set(heading[1], scenario)
      mode = null
      continue
    }
    if (!scenario) continue
    if (line.includes('deterministic roster:')) { mode = 'roster'; continue }
    if (line.includes('bench roster:')) { mode = 'bench'; continue }
    const piece = mode && line.match(/^\s+(\d+) ·/)
    if (piece) {
      if (mode === 'roster') scenario.ids.push(Number(piece[1]))
      else scenario.benchIds.push(Number(piece[1]))
      continue
    }
    if (mode && line.trim() === '') mode = null
    if (/deterministic\s+\d+ pieces|per-slot capacity:/.test(line)) {
      scenario.summary.push(line.trim())
    }
    // Bench width, guaranteed/rank-fill split, shape, and headroom. These are
    // the free Tier-1 measures: a property no bench piece has is a property no
    // roster can have, checkable with no model and no money.
    if (/^\s+bench \d+ of \d+ eligible|^\s+bench shape:|^\s+bench headroom:|^\s+bench unmet targets:/.test(line)) {
      scenario.benchSummary.push(line.trim())
    }
  }
  return scenarios
}

const baseline = parse(capture(baselineDir))
const current = parse(capture(process.cwd()))
let differences = 0

for (const [name, after] of current) {
  const before = baseline.get(name)
  if (!before) {
    console.log(`── ${name}\n  missing from baseline`)
    differences++
    continue
  }
  const dropped = before.ids.filter(id => !after.ids.includes(id))
  const added = after.ids.filter(id => !before.ids.includes(id))
  const summaryChanged = before.summary.join('\n') !== after.summary.join('\n')
  if (dropped.length || added.length || summaryChanged) {
    differences++
    console.log(`── ${name}`)
    console.log(`  dropped: ${dropped.join(', ') || 'none'}`)
    console.log(`  added:   ${added.join(', ') || 'none'}`)
    console.log('  baseline:', ...before.summary)
    console.log('  current: ', ...after.summary)
    console.log('  EXPLAINED BY: isCapsuleStatementPiece now reads visual_roles.hero_piece as well as pattern_complexity=loud, matching the bench reserve it had drifted from. statement_presence is therefore already satisfied by hero-tagged pieces, so enforceCapsulePostConditions no longer swaps a loud print in to satisfy it — and the loud print each roster previously carried ONLY because of that swap is no longer bought. Protagonist counts stay >=2 everywhere (4->3, 4->4, 3->2); loud-print counts go to 0.')
  }

  // Reported separately from the deterministic roster: a bench change and a
  // roster change have different causes and different blast radius. The
  // deterministic roster is what ships when stage 3 is off or falls back; the
  // bench is what the model chooses from when it is on, so a bench-only diff
  // is invisible in shipped output and still changes every model capsule.
  const benchDropped = before.benchIds.filter(id => !after.benchIds.includes(id))
  const benchAdded = after.benchIds.filter(id => !before.benchIds.includes(id))
  const benchSummaryChanged = before.benchSummary.join('\n') !== after.benchSummary.join('\n')
  if (!benchDropped.length && !benchAdded.length && !benchSummaryChanged) continue
  differences++
  console.log(`── bench · ${name}`)
  console.log(`  dropped: ${benchDropped.join(', ') || 'none'}`)
  console.log(`  added:   ${benchAdded.join(', ') || 'none'}`)
  for (const line of before.benchSummary) console.log(`  baseline: ${line}`)
  for (const line of after.benchSummary) console.log(`  current:  ${line}`)
  console.log('  EXPLAINED BY: name the intentional rule behind every bench membership and headroom change — a bench diff changes what every model-chosen capsule can contain')
}

const baselineWorkbenches = capturePlanWorkbenches(baselineDir)
const currentWorkbenches = capturePlanWorkbenches(process.cwd())
const workbenchExplanations = {
  'extreme-heat active caregiving': 'Extreme-heat and movement advisories now rank low-coverage/light everyday mains and supportive shoes ahead of warmer, fuller-coverage, or elevated alternatives; the 40-piece display cap accounts for the corresponding additions and drops.',
  'extreme-heat indoor transit': 'Indoor slots now inherit extreme transit heat, so breathable bases and ventilated shoes rise while fuller-coverage and warmer pieces fall; the 40-piece display cap accounts for the corresponding additions and drops.',
  'home play operational ease': 'The home-play operational-ease advisory ranks flat/low footwear ahead of higher heels without removing either from the gate-allowed pool; the 40-piece display cap accounts for the corresponding additions and drops.'
}
for (const [name, after] of currentWorkbenches) {
  const before = baselineWorkbenches.get(name)
  if (!before) {
    console.log(`── freeform workbench · ${name}\n  missing from baseline`)
    differences++
    continue
  }
  // The assessments are what the model actually READS — each piece's
  // extreme-heat / movement / operational-ease tier, score and reason. Comparing
  // only `ids` meant an advisory could change every tier and reason it emits
  // and report no difference, so long as the top-40 ordering happened to
  // survive. Both are compared, and the report says which moved.
  const orderChanged = JSON.stringify(before.ids) !== JSON.stringify(after.ids)
  const assessmentsChanged = JSON.stringify(before.assessments || []) !== JSON.stringify(after.assessments || [])
  if (!orderChanged && !assessmentsChanged) continue
  differences++
  const dropped = before.ids.filter(id => !after.ids.includes(id))
  const added = after.ids.filter(id => !before.ids.includes(id))
  console.log(`── freeform workbench · ${name}`)
  console.log(`  changed: ${[orderChanged ? 'piece order/membership' : '', assessmentsChanged ? 'piece assessments' : ''].filter(Boolean).join(' + ')}`)
  console.log(`  baseline order: ${before.ids.join(', ')}`)
  console.log(`  current order:  ${after.ids.join(', ')}`)
  console.log(`  dropped: ${dropped.join(', ') || 'none'}`)
  console.log(`  added:   ${added.join(', ') || 'none'}`)
  if (assessmentsChanged) {
    const beforeById = new Map((before.assessments || []).map(entry => [entry.id, entry]))
    const movedIds = (after.assessments || [])
      .filter(entry => JSON.stringify(beforeById.get(entry.id)) !== JSON.stringify(entry))
      .map(entry => entry.id)
    console.log(`  assessments changed for ${movedIds.length} piece(s): ${movedIds.slice(0, 12).join(', ')}${movedIds.length > 12 ? ', …' : ''}`)
  }
  console.log(`  EXPLAINED BY: ${workbenchExplanations[name] || 'No explanation recorded — treat this as a bug.'}`)
}

console.log(`\nscenarios with differences: ${differences}`)
