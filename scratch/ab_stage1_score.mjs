// Scores one Stage 1 scenario after unblinding: joins the blinded ratings export with the sealed key and
// computes the pre-registered outcomes per arm and replicate (scratch/ab_stage1_preregistration.json).
// usage: node scratch/ab_stage1_score.mjs --ratings <export.json> --key <review-S1.sealed-key.json> [--out <file>]
import fs from 'fs'
import { scoreStage1 } from './ab_stage1_contract.mjs'
const args = process.argv.slice(2)
const val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
if (!val('--ratings') || !val('--key')) { console.error('usage: node scratch/ab_stage1_score.mjs --ratings <export.json> --key <sealed-key.json> [--out <file>]'); process.exit(2) }
const result = scoreStage1(JSON.parse(fs.readFileSync(val('--ratings'), 'utf8')), JSON.parse(fs.readFileSync(val('--key'), 'utf8')))
const text = JSON.stringify(result, null, 2)
if (val('--out')) fs.writeFileSync(val('--out'), text)
console.log(text)
