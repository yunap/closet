import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const packet = read('docs/item13-feedback-panel-packet.md')
const manifest = JSON.parse(read('docs/item13-feedback-panel-manifest.json'))
const brief = read('docs/expert-panel-brief.md')
const handoff = read('docs/ui-v1-design-handoff.md')
const captureManifest = JSON.parse(read('docs/item13-panel-captures/MANIFEST.json'))

const failures = []
const requireText = (haystack, needle, label) => {
  if (!haystack.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`)
}
const between = (text, start, end) => {
  const startAt = text.indexOf(start)
  const endAt = text.indexOf(end, startAt)
  if (startAt < 0 || endAt < 0) throw new Error(`Cannot extract ${start} → ${end}`)
  return text.slice(startAt, endAt).trim()
}

requireText(packet, between(brief, '## Part 1 — The app', '## Part 2 — Two panel modes'), 'shared context drift')
requireText(packet, between(brief, '## Part 4 — Evidence rules', '## Part 4b — How the implementing agent gets this wrong'), 'evidence rules drift')
requireText(packet, between(brief, '## Part 4b — How the implementing agent gets this wrong', '## Part 5 — Output contract'), 'failure-mode drift')
requireText(packet, between(handoff, '**Resolved, not open:**', '## Stylist bugfix spec cleanup'), 'settled-ground drift')

for (const surface of manifest.surfaceInventory) requireText(packet, surface.surface, 'surface inventory')
requireText(packet, manifest.currentPositiveFeedbackBoundary, 'positive-feedback boundary')
for (const proposition of manifest.reviewPropositions) requireText(packet, proposition, 'review proposition')
for (const file of captureManifest.captures) {
  requireText(packet, `item13-panel-captures/${file}`, 'capture inventory')
  if (!fs.existsSync(path.join(root, 'docs', 'item13-panel-captures', file))) failures.push(`missing capture file ${file}`)
}
for (const trace of manifest.authorityTrace) {
  requireText(packet, trace.example, 'authority trace')
  requireText(packet, trace.canonicalStore, `authority trace ${trace.example}`)
  const proofSource = trace.proofFiles.map(file => read(file)).join('\n')
  const proofTokens = {
    'Global owner rule': ['getOwnerRuleNotes'],
    'Garment occasion exclusion': ['occasion_exclusions', 'wholeWardrobePieceTrustDecision'],
    'Wrong choice for this outfit': ['feedbackEvidence', 'getProvisionalWrongChoiceMemory'],
    'Accepted personal/contextual lesson': ['feedback_synthesis_drafts', 'getAcceptedFeedbackSynthesisMemory'],
    'Generated-image correction': ['wrong_length'],
    'General product-quality finding': ['product_quality_findings'],
    'Structured owner constraint': ['owner_constraints'],
  }[trace.example] || []
  for (const file of trace.proofFiles) {
    if (!fs.existsSync(path.join(root, file))) failures.push(`${trace.example}: missing proof file ${file}`)
  }
  if (!Array.isArray(trace.behaviorTests) || !trace.behaviorTests.length) {
    failures.push(`${trace.example}: no behavioral tests declared`)
  } else {
    for (const file of trace.behaviorTests) {
      requireText(packet, file, `${trace.example}: behavioral-test citation`)
      if (!fs.existsSync(path.join(root, file))) failures.push(`${trace.example}: missing behavioral test ${file}`)
    }
  }
  for (const token of proofTokens) {
    if (!proofSource.includes(token)) failures.push(`${trace.example}: proof files do not contain ${token}`)
  }
}

if (manifest.surfaceInventory.filter(item => item.status.includes('backend-only')).length !== 2) {
  failures.push('Expected exactly two backend-only surfaces (product findings and owner constraints).')
}
if (!packet.startsWith('# Item 13 panel packet')) failures.push('Packet title/status is missing.')
if (!packet.includes('PANEL COMPLETE')) failures.push('Packet must record completed owner preflight, evidence capture and panel review.')

if (failures.length) {
  console.error('ITEM 13 PACKET PREFLIGHT FAILED')
  failures.forEach(item => console.error(`- ${item}`))
  process.exit(1)
}

const behaviorTests = [...new Set(manifest.authorityTrace.flatMap(trace => trace.behaviorTests || []))]
const testRun = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...behaviorTests], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'test' },
})
if (testRun.status !== 0) {
  console.error('ITEM 13 LINKED BEHAVIOR TESTS FAILED')
  process.stderr.write(testRun.stderr || '')
  process.stdout.write(testRun.stdout || '')
  process.exit(testRun.status || 1)
}

console.log(`PASS — packet/manifest consistency and proof-file presence checked for ${manifest.surfaceInventory.length} surfaces, ${manifest.authorityTrace.length} authority traces, ${manifest.reviewPropositions.length} propositions and ${captureManifest.captures.length} captures; ${behaviorTests.length} linked behavioral test files passed.`)
