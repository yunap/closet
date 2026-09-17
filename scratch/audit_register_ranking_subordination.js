#!/usr/bin/env node
//
// Two things the register work claims, made reproducible.
//
//   node scratch/audit_register_ranking_subordination.js            # paired comparisons
//   node scratch/audit_register_ranking_subordination.js --baseline # build the isolated A/B baseline
//
// 1. PAIRED COMPARISONS. Register is a preference; weather adequacy is not. The claim is that a
//    weather-appropriate candidate is never displaced by a weather-INADEQUATE one on register
//    distance alone. This prints the scoring components for matched pairs — same category, same
//    conditions, one piece matching the request's register but wrong for the weather, the other
//    N ranks above the register and right for it — so the ordering can be read rather than asserted.
//
// 2. ISOLATED BASELINE. `scratch/rankings_ab_diff.js` needs a baseline that differs from the working
//    tree by ONLY the register delta; comparing against HEAD on a heavily modified branch proves
//    nothing about which change caused a difference. `--baseline` writes that tree: a copy with
//    `registerCeilingIsExplicit` forced true (pre-change hard ceiling) and the ranking advisory
//    zeroed, everything else untouched. Then:
//
//      node scratch/rankings_ab_diff.js --baseline-dir <printed path> --db <wardrobe copy>
//
// Provider-free and read-only against an isolated DB copy (docs/database-safety.md).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = process.cwd()

if (process.argv.includes('--baseline')) {
  const target = path.join(os.tmpdir(), `register-isolated-baseline-${Date.now()}`)
  fs.mkdirSync(target, { recursive: true })
  execFileSync('rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.git', '--exclude', '*.db*',
    '--exclude', 'backups', `${repoRoot}/`, `${target}/`])
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'))

  const rulesPath = path.join(target, 'styling-engine/rules.js')
  let rules = fs.readFileSync(rulesPath, 'utf8')
  const explicitMarker = 'export function registerCeilingIsExplicit(options = {}) {'
  const advisoryMarker = "export function registerFitPieceAdvisory(piece = {}, { registerCeiling = null, occasion = '', explicitCeiling = false } = {}) {"
  if (!rules.includes(explicitMarker) || !rules.includes(advisoryMarker)) {
    console.error('rules.js no longer has the expected register entry points — update this script before trusting its baseline.')
    process.exit(2)
  }
  rules = rules.replace(explicitMarker, `${explicitMarker}\n  return true // ISOLATED BASELINE: pre-register-change behaviour (every ceiling hard)`)
  rules = rules.replace(advisoryMarker, `${advisoryMarker}\n  return { score: 0, reason: '' } // ISOLATED BASELINE: no register ranking term`)
  fs.writeFileSync(rulesPath, rules, 'utf8')
  console.log(target)
  process.exit(0)
}

const dbPath = process.env.WARDROBE_DB_PATH
if (!dbPath) {
  console.error('Set WARDROBE_DB_PATH to an isolated copy of the wardrobe DB first (docs/database-safety.md).')
  process.exit(2)
}

const { buildVisualComposerRoster } = await import(path.join(repoRoot, 'styling-engine/rules.js'))
const { resolveWeatherContext, validateUserWeather } = await import(path.join(repoRoot, 'styling-engine/weather.js'))

// 70/60 puts the bottom demand at `moderate`: a medium cotton bottom is ADEQUATE and a light linen
// one is not, which is the contrast the comparison needs.
const weatherProfile = resolveWeatherContext({ userWeather: validateUserWeather({ high_f: 70, low_f: 60 }) }).temperature
const bottom = (id, formality, fabricWeight, fiber, occasions) => ({
  id, name: `fixture ${id}`, category: 'bottom', photo: 'fixture.jpg',
  formality, occasions, fabric_weight: fabricWeight, fiber_content: [fiber], length_hits_at: 'ankle',
})

const total = reasons => reasons.reduce((sum, reason) => {
  const match = reason.match(/\(([+-]\d+)\)/)
  return match ? sum + Number(match[1]) : sum
}, 0)

let inversions = 0
console.log('PAIRED COMPARISONS — weather adequacy versus register distance\n')
for (const [label, formality] of [['one rank above', 'elevated'], ['two ranks above', 'dressy']]) {
  // The register-above piece is deliberately NOT tagged for the occasion: an explicit owner tag
  // would trigger the one-step exemption and mask what is being measured.
  const registerMatch = bottom(9001, 'everyday', 'light', 'linen', ['casual'])
  const registerAbove = bottom(9002, formality, 'medium', 'cotton', ['city'])
  const { debug } = buildVisualComposerRoster([registerMatch, registerAbove], {
    occasion: 'casual', weatherProfile, calendarSeason: 'fall', maxImages: 90,
  })
  const adjustments = debug.relevanceAdjustments || {}
  const matchReasons = adjustments[9001] || []
  const aboveReasons = adjustments[9002] || []
  const matchScore = total(matchReasons)
  const aboveScore = total(aboveReasons)
  const weatherWins = aboveScore > matchScore
  if (!weatherWins) inversions++
  console.log(`${label}:`)
  console.log(`  register match, weather-inadequate  (${String(matchScore).padStart(3)}): ${matchReasons.join(' | ')}`)
  console.log(`  ${label.padEnd(15)}, weather-adequate (${String(aboveScore).padStart(3)}): ${aboveReasons.join(' | ')}`)
  console.log(`  => ${weatherWins ? `weather wins by ${aboveScore - matchScore}` : 'REGISTER DISPLACED WEATHER'}\n`)
}

console.log(inversions
  ? `FAIL: ${inversions} pair(s) let register distance displace weather adequacy.`
  : 'PASS: weather adequacy outranks register distance in every pair.')
process.exit(inversions ? 1 : 0)
