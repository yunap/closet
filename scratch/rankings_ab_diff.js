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

function capture(cwd) {
  const result = spawnSync(
    process.execPath,
    ['scratch/compare_capsule_rosters.js', '--verbose'],
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

function parse(output) {
  const scenarios = new Map()
  let scenario = null
  let roster = false
  for (const line of output.split('\n')) {
    const heading = line.match(/^── (.+?) · budget/)
    if (heading) {
      scenario = { ids: [], summary: [] }
      scenarios.set(heading[1], scenario)
      roster = false
      continue
    }
    if (!scenario) continue
    if (line.includes('deterministic roster:')) {
      roster = true
      continue
    }
    const piece = roster && line.match(/^\s+(\d+) ·/)
    if (piece) {
      scenario.ids.push(Number(piece[1]))
      continue
    }
    if (roster && line.trim() === '') roster = false
    if (/deterministic\s+\d+ pieces|per-slot capacity:/.test(line)) {
      scenario.summary.push(line.trim())
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
  if (!dropped.length && !added.length && !summaryChanged) continue
  differences++
  console.log(`── ${name}`)
  console.log(`  dropped: ${dropped.join(', ') || 'none'}`)
  console.log(`  added:   ${added.join(', ') || 'none'}`)
  console.log('  baseline:', ...before.summary)
  console.log('  current: ', ...after.summary)
  console.log('  EXPLAINED BY: document the intentional rule responsible for every roster and capacity change')
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
  if (JSON.stringify(before.ids) === JSON.stringify(after.ids)) continue
  differences++
  const dropped = before.ids.filter(id => !after.ids.includes(id))
  const added = after.ids.filter(id => !before.ids.includes(id))
  console.log(`── freeform workbench · ${name}`)
  console.log(`  baseline order: ${before.ids.join(', ')}`)
  console.log(`  current order:  ${after.ids.join(', ')}`)
  console.log(`  dropped: ${dropped.join(', ') || 'none'}`)
  console.log(`  added:   ${added.join(', ') || 'none'}`)
  console.log(`  EXPLAINED BY: ${workbenchExplanations[name] || 'No explanation recorded — treat this as a bug.'}`)
}

console.log(`\nscenarios with differences: ${differences}`)
