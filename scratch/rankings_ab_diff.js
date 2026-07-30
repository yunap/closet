#!/usr/bin/env node

// Provider-free A/B runner for deterministic capsule rankings. The baseline
// directory must contain the same `compare_capsule_rosters.js --verbose`
// diagnostic interface as the current checkout. This script is read-only.

import { spawnSync } from 'node:child_process'
import path from 'node:path'

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

console.log(`\nscenarios with differences: ${differences}`)
