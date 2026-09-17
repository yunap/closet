// Stage 3 day-wear pilot scorer (scratch/ab_stage3_preregistration.json outcomes). Offline, read-only.
// Joins the locked stage-1 card export and the stage-2 explanation export with the sealed key and computes the
// pre-registered useful-signal rule. Descriptive: 6 cards per arm at most.
// usage: node scratch/ab_stage3_score.mjs --run-root scratch/ab_stage3_runs/2026-09-15 --stage1-export <file> --stage2-export <file>
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const runRoot = path.resolve(REPO, value('--run-root') || 'scratch/ab_stage3_runs/2026-09-15')
const review = path.join(runRoot, 'review')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const key = readJson(path.join(review, 'stage3-pilot-cards.sealed-key.json'))
const locked = readJson(path.join(review, 'stage1-export-locked.json'))
const s1Bytes = fs.readFileSync(value('--stage1-export'))
if (sha(s1Bytes) !== locked.sha256) throw new Error('stage-1 export differs from the locked export')
const s1 = JSON.parse(s1Bytes), s2 = readJson(value('--stage2-export'))
if (s1.seed !== key.seed || s2.seed !== key.seed || s2.lockedStage1ExportSha256 !== locked.sha256) throw new Error('exports do not match the sealed key / locked export')
const manifest = readJson(path.join(runRoot, 'live', 'manifest.json'))
const mean = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100 : null
const cards = key.cards.map(k => ({ ...k, ...s1.cards.find(c => c.cardId === k.cardId), explanation: s2.cards.find(c => c.cardId === k.cardId) || null, arm: k.arm.startsWith('explain') ? 'explain' : 'control' }))
const arm = a => cards.filter(c => c.arm === a)
const summary = list => ({ cards: list.length, meanWeather: mean(list.map(c => c.weatherAdequacy)), meanStyle: mean(list.map(c => c.styleIntent)), wouldWear: list.filter(c => c.wouldWear === 'yes').length, weatherAtMost3: list.filter(c => c.weatherAdequacy <= 3).length })
const control = summary(arm('control')), explain = summary(arm('explain'))
const byScenario = Object.fromEntries([...new Set(cards.map(c => c.scenario))].sort().map(s => [s, { control: summary(arm('control').filter(c => c.scenario === s)), explain: summary(arm('explain').filter(c => c.scenario === s)) }]))
const failures = manifest.attempts.filter(a => a.error || !a.rawOutfits).map(a => a.key).concat(key.failures.map(f => f.attempt))
const uniqueFailures = [...new Set(failures)]
const marks = arm('explain').map(c => c.explanation)
const believableYes = marks.filter(m => m?.believable === 'yes').length
const rationalizesYes = marks.filter(m => m?.rationalizes === 'yes').length
const d = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 100) / 100)
const criteria = {
  pooledWeatherDiffAtLeast0_5: { value: d(explain.meanWeather, control.meanWeather), pass: d(explain.meanWeather, control.meanWeather) >= 0.5 },
  noScenarioLower: { value: Object.fromEntries(Object.entries(byScenario).map(([s, v]) => [s, d(v.explain.meanWeather, v.control.meanWeather)])), pass: Object.values(byScenario).every(v => v.explain.meanWeather != null && v.control.meanWeather != null && v.explain.meanWeather >= v.control.meanWeather) },
  styleNotLowerBy0_5: { value: d(explain.meanStyle, control.meanStyle), pass: d(explain.meanStyle, control.meanStyle) >= -0.5 },
  wouldWearNotLower: { value: { control: control.wouldWear, explain: explain.wouldWear }, pass: explain.wouldWear >= control.wouldWear },
  explanationValidity: { value: { believableYes, rationalizesYes, explainCards: marks.length }, pass: believableYes >= 4 && rationalizesYes <= 1 },
  technicalFailuresAtMost1: { value: uniqueFailures, pass: uniqueFailures.length <= 1 },
}
const result = { label: prereg().label, control, explain, byScenario, criteria, usefulSignal: uniqueFailures.length > 1 ? 'inconclusive' : Object.values(criteria).every(c => c.pass),
  explainCardsWithMarks: arm('explain').map(c => ({ cardId: c.cardId, scenario: c.scenario, replicate: c.replicate, weather: c.weatherAdequacy, style: c.styleIntent, wouldWear: c.wouldWear, notes: c.notes, marks: c.explanation })),
  controlCards: arm('control').map(c => ({ cardId: c.cardId, scenario: c.scenario, replicate: c.replicate, weather: c.weatherAdequacy, style: c.styleIntent, wouldWear: c.wouldWear, notes: c.notes })) }
function prereg() { return readJson(path.join(REPO, 'scratch', 'ab_stage3_preregistration.json')) }
fs.writeFileSync(path.join(review, 'results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ control, explain, criteria, usefulSignal: result.usefulSignal }, null, 2))
