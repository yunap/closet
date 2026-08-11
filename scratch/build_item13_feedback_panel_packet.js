import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const manifest = JSON.parse(read('docs/item13-feedback-panel-manifest.json'))
const brief = read('docs/expert-panel-brief.md')
const handoff = read('docs/ui-v1-design-handoff.md')
const captureManifest = JSON.parse(read('docs/item13-panel-captures/MANIFEST.json'))

function between(text, start, end) {
  const startAt = text.indexOf(start)
  if (startAt < 0) throw new Error(`Missing packet source marker: ${start}`)
  const endAt = text.indexOf(end, startAt)
  if (endAt < 0) throw new Error(`Missing packet source marker: ${end}`)
  return text.slice(startAt, endAt).trim()
}

const sharedContext = between(brief, '## Part 1 — The app', '## Part 2 — Two panel modes')
const evidenceRules = between(brief, '## Part 4 — Evidence rules', '## Part 4b — How the implementing agent gets this wrong')
const failureModes = between(brief, '## Part 4b — How the implementing agent gets this wrong', '## Part 5 — Output contract')
const outputContract = between(brief, '## Part 5 — Output contract', '## Part 6 — What is not a panel\'s job')
const settledGround = between(handoff, '**Resolved, not open:**', '## Stylist bugfix spec cleanup')
const sourceHash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(row => `| ${row.map(value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`),
].join('\n')

const surfaceTable = table(
  ['Surface', 'Packet status', 'Why'],
  manifest.surfaceInventory.map(item => [item.surface, item.status, item.reason]),
)
const traceTable = table(
  ['Example', 'Owner action', 'Canonical store', 'Documented reader/effect', 'Scope', 'Undo', 'Behavior tests'],
  manifest.authorityTrace.map(item => [item.example, item.userAction, item.canonicalStore, `${item.reader}: ${item.effect}`, item.scope, item.undo, item.behaviorTests.map(file => `\`${file}\``).join(', ')]),
)
const propositionText = manifest.reviewPropositions.map((item, index) => `${index + 1}. ${item}`).join('\n')
const captureCaptions = {
  '01-style-profile-populated-1440.png': 'Current Style Profile at 1440px. Routing works, but the dense administrative hierarchy, terminology and interaction model are evidence of the UX problem—not a proposed design direction.',
  '02-provisional-reaction-actions-1440.png': 'An unprocessed reaction exposes one true source (chat), related board and garment links, synthesis selection and removal.',
  '03-accepted-lesson-expanded-1440.png': 'Accepted lesson at 1440px: editable guidance and boundary, with structured applicability as the actual routing control.',
  '03-accepted-lesson-expanded-1024.png': 'The same accepted-lesson workflow at 1024px.',
  '03-accepted-lesson-expanded-768.png': 'The same workflow at 768px. No textarea clips, while the narrow reaction layout demonstrates why responsive redesign is required.',
  '04-constitution-layers-768.png': 'Long constitution layers at 768px after clipping cleanup; the capture script asserts no populated textarea overflows.',
  '05-source-chat-populated-1440.png': 'The actual source chat: request, outfit card, garments and the instruction that led to the per-piece reaction.',
  '06-renderer-control-active-1440.png': 'Wrong-length generated-image problem selected at its originating board, including the field-specific cardigan detail and no-silent-retag copy. The rejected generated image is evidence only and is never reused as a future reference.',
  '07-wardrobe-tasks-retag-1440.png': 'Separate metadata-review task created from the wrong-length report; no garment tag changed automatically.',
  '08-empty-synthesis-state-1440.png': 'Precise empty state: no provisional reactions are eligible for lesson synthesis. It does not claim that no other feedback exists.',
}
const captureEvidence = captureManifest.captures.map(file => {
  const caption = captureCaptions[file]
  if (!caption) throw new Error(`Missing packet caption for ${file}`)
  return `### ${file.replace(/\.png$/, '').replaceAll('-', ' ')}\n\n![${caption}](item13-panel-captures/${file})\n\n${caption}`
}).join('\n\n')

const packet = `# Item 13 panel packet — feedback memory and review direction

**Status: READY FOR PANEL DISPATCH. Owner preflight and the reproducible evidence set are complete. The visual direction remains unratified until Yuna reviews the panel recommendation.**

Generated from the machine-readable manifest and the ratified panel sources. The generator copies the shared app context, evidence rules, failure warnings, output contract, and settled-ground exclusion lists verbatim. Re-run \`node scratch/build_item13_feedback_panel_packet.js\` after changing a source.

Source fingerprints:

- manifest: \`${sourceHash(JSON.stringify(manifest))}\`
- expert panel brief: \`${sourceHash(brief)}\`
- UI handoff: \`${sourceHash(handoff)}\`

## Review boundary

**Mode:** ${manifest.reviewMode}

**Question:** ${manifest.reviewQuestion}

This is not a review of whether feedback routing should exist, a styling-quality audit, or permission to add more model calls. Items 11 and 12 have settled backend behaviour. The panel is deciding how an owner should understand and operate those behaviours alongside the existing Style Profile.

The panel is explicitly **not** being told that a missing screen is a defect. Two capabilities are backend-only because the mandatory panel must precede their material UI design. Reviewers are asked to recommend their owner-facing home and workflow using the documented behaviour below.

**Current positive-feedback boundary:** ${manifest.currentPositiveFeedbackBoundary}

## Presenter comprehension gate

Before this packet may be sent, the presenter must be able to answer every row of the authority trace without guessing:

1. Which user action created it?
2. Which record is canonical and which records are projections or provenance?
3. Does it gate, score, enter a prompt, guide rendering, create a task, or merely display?
4. What exact context activates it?
5. What action removes its behavioural authority?

Any answer inferred from a timestamp, label, or screenshot fails preflight. The manifest names source files and behavioral tests for each row. \`node scratch/check_item13_feedback_panel_packet.js\` checks packet/manifest consistency and proof-file presence, then runs the linked tests. It does not semantically prove arbitrary English claims in the manifest.

## Complete surface inventory

${surfaceTable}

An omitted surface must be added to the manifest or explicitly excluded there before review. Silence does not mean complete.

## Documented authority trace, backed by linked behavioral tests

${traceTable}

### Important separations reviewers must preserve

- An owner rule is standing prompt guidance. It is not automatically a hard gate.
- An occasion exclusion and an owner constraint are deterministic eligibility gates.
- A wrong-choice reaction is provisional context. It is not a garment dislike or a score.
- An accepted personal/contextual lesson is bounded prompt guidance only when structured applicability matches.
- A generated-image report can add a textual fidelity reminder only when the identified garment is rendered again. It never supplies the rejected image as a reference and never affects styling selection.
- A product-quality finding changes nothing until a human resolves it to a named product destination.
- Works, Signature, and Almost currently carry no styling or synthesis authority; their unresolved future destination is part of the product boundary, not a shipped learning mechanism.
- Mirrored receipts and source links are not additional authority.

## Fresh evidence set required before reviewer dispatch

The final packet must include current, freshly created evidence for all of the following states. Test records must be created in an isolated sandbox with mock AI enabled; none may come from the owner's legacy testing account.

1. Populated Style Profile showing one owner rule, one occasion exclusion, one unprocessed provisional reaction, and one accepted scoped lesson whose processed source is collapsed under provenance.
2. The precise empty state for reactions eligible for lesson synthesis; it must not imply that no renderer or other feedback exists elsewhere.
3. A long owner rule and a long synthesis boundary at 1440px, 1024px, and 768px.
4. One active structured owner constraint shown as matching one context/slot and not another.
5. One open product-quality finding with its durable evidence snapshot, followed by its resolved state.
6. Source navigation from a reaction to its actual source, with related garment/board links labelled related rather than source; plus the generated-image problem report in its originating image-feedback controls and its separate metadata-review task.
7. Undo: restore occasion exclusion, retire owner constraint, retire accepted lesson, and dismiss or resolve a product finding.
8. Error/conflict: stale garment-rule receipt or unsupported applicability edit, shown without losing the record.

Until surfaces 4 and 5 exist, they are **direction artifacts**, not fake screenshots. Their records and behavioral traces are included; the panel must propose how they should be surfaced. A later craft verification uses the implemented UI.

## Current UI evidence — functional behavior, not a design endorsement

The screenshots below are generated from the isolated fixture by \`node scratch/capture_item13_panel_evidence.js\`. They show the current implementation honestly. Reviewers must return a concrete replacement information architecture, screen-level wireframe, responsive interaction model, card patterns, progressive disclosure, user-facing terminology and action hierarchy—not merely critique these screens.

${captureEvidence}

## Propositions to attack or defend

${propositionText}

For every proposition, return: a position; the strongest counterargument; what would have to be observably true for the position to be wrong; and a concrete recommendation. Do not propose a new paid call without identifying who authorizes it, when cost is shown, and why existing stored evidence is insufficient.

## Required reviewers

1. **Fashion-product / styling competence:** whether the distinctions help a non-stylist teach the product without needing fashion vocabulary, and whether evidence remains useful for real garment/outfit decisions.
2. **Human↔model interaction design:** capture, review, scope, authority, provenance, correction, and undo across the complete loop.
3. **Cost and product-economics honesty:** free versus paid boundaries, token/prompt implications, and whether the interface creates pressure to synthesize records that should simply be managed locally.

This is a direction review. Bugs, stale copy, contrast measurements, and missing ARIA are removed in preflight rather than spending panel tokens.

---

${sharedContext}

---

${evidenceRules}

---

${failureModes}

---

${outputContract}

---

## Settled ground — copied verbatim, never paraphrased

${settledGround}
`

fs.writeFileSync(path.join(root, 'docs/item13-feedback-panel-packet.md'), packet)
console.log('Wrote docs/item13-feedback-panel-packet.md')
