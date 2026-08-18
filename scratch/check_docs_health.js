/**
 * Doc integrity checks, run by `npm test` before the suite (alongside
 * check_style_claims.js and check_text_matching_ratchet.js).
 *
 * Why this exists: this app documents behaviour before coding it, so the docs are load-bearing —
 * a session that reads a stale map reaches a confident wrong answer. Three concrete precedents:
 *   - docs/garment-memory-and-feedback-audit.md was deleted when superseded; references to it
 *     survived elsewhere and pointed at nothing for nine days.
 *   - occasion_profiles_ratification.md said DRAFT in its title while its body was ratified, and
 *     "a later session spent a day changing occasion behaviour" (that doc's own words).
 *   - engine-behaviour-map.md gained the owner-constraint gate weeks late — it "shipped with
 *     item 12 and had never been recorded here".
 *
 * Mechanical checks only. Anything requiring judgment belongs in review, not here.
 *
 * ERRORS fail the build. WARNINGS print and are ratcheted against a committed baseline so the
 * count can only go down — matching the check_text_matching_ratchet.js pattern already in use.
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = path.join(ROOT, 'scratch', 'docs_health_baseline.json')
const SPEC_BANNER = 'HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY'
const STALE_DAYS = 90

const STATUS_VOCABULARY = ['ratified', 'active', 'historical', 'superseded-by']

const errors = []
const warnings = []
const err = (file, msg) => errors.push({ file, msg })
const warn = (file, msg) => warnings.push({ file, msg })

const git = cmd => {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { return '' }
}

const trackedFiles = new Set(git('git ls-files').split('\n').filter(Boolean))
const isTracked = rel => trackedFiles.has(rel)

const markdownFiles = [...trackedFiles]
  .filter(f => f.endsWith('.md'))
  .concat(['docs/README.md', 'docs/specs/README.md'].filter(f => fs.existsSync(path.join(ROOT, f))))
const docFiles = [...new Set(markdownFiles)].sort()

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ── 1. Relative links resolve ────────────────────────────────────────────────
// A map that points at a file which no longer exists is worse than no map: it is still trusted.
function checkLinks(rel, text) {
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1]
    // Any URI scheme (http:, file:, sandbox:, mailto:) is out of scope — only repo-relative
    // paths are this repo's problem to keep valid.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue
    const resolved = path.normalize(path.join(path.dirname(rel), target.split('#')[0]))
    if (!resolved || resolved === '.') continue
    if (!fs.existsSync(path.join(ROOT, resolved))) {
      err(rel, `broken link → ${target}`)
    }
  }
}

// ── 2. Superseded docs leave a tombstone ─────────────────────────────────────
// Never delete a doc outright: references live outside this repo (agent memories, PRs, notes)
// and cannot be updated by a rename. Leave a 3-line file pointing at the successor instead.
// A doc may legitimately NAME a document that does not exist — because it does not exist yet
// (a planned research note), or because it deliberately no longer exists (a postmortem, or the
// tombstone rule itself explaining what was deleted and why). Only an unqualified reference is a
// dangling pointer.
const PROSPECTIVE = /\b(to be written|not yet written|future|planned|proposed name|does not exist yet|would live|was deleted|no longer exists|deleted on|superseded|pointed at nothing|has been removed)\b/i
function checkTombstones(rel, text) {
  const seen = new Set()
  for (const m of text.matchAll(/\bdocs\/([a-z0-9._-]+\.md)\b/gi)) {
    const target = path.join('docs', m[1])
    if (seen.has(target) || fs.existsSync(path.join(ROOT, target))) continue
    seen.add(target)
    // A doc may legitimately name a document that does not exist YET — a planned research note,
    // a proposed filename. Only an unqualified reference is a dangling pointer.
    const context = text.slice(Math.max(0, m.index - 240), m.index + 240)
    if (PROSPECTIVE.test(context)) continue
    err(rel, `references ${target}, which does not exist — leave a tombstone rather than deleting`)
  }
}

// ── 3. Docs citing scratch/ scripts must cite TRACKED ones ───────────────────
// feedback-and-memory-map.md §0 flagged this itself: engine-behaviour-map.md cites
// measure_provenance.js and measure_plural_gap.js, "and neither is tracked" — so its numbers
// cannot be regenerated from a clean checkout. scratch/* is gitignored with an allowlist.
// Ratcheted rather than fatal: there is a real pre-existing backlog of cited-but-untracked
// measurement scripts (engine-behaviour-map.md alone cites six). Failing the build on day one
// would only teach people to delete the citation, which is the wrong repair — the right one is
// to allowlist the script so the number can be regenerated.
function checkCitedScripts(rel, text) {
  const seen = new Set()
  for (const m of text.matchAll(/\bscratch\/([A-Za-z0-9._-]+\.(?:js|json))\b/g)) {
    const target = `scratch/${m[1]}`
    if (seen.has(target)) continue
    seen.add(target)
    if (!fs.existsSync(path.join(ROOT, target))) {
      warn(rel, `cites ${target}, which does not exist — the claim it supports cannot be checked`)
    } else if (!isTracked(target)) {
      warn(rel, `cites ${target}, which is UNTRACKED — allowlist it in .gitignore or the claim cannot be reproduced from a clean checkout`)
    }
  }
}

// ── 4. Function-name citations still resolve ─────────────────────────────────
// The maps mandate citing code by file and function name, never line number, because "every
// reader citation in §4 had drifted by roughly a hundred lines while still looking
// authoritative". This confirms the names survive.
const CODE_DIRS = ['styling-engine', 'routes', 'lib', 'src', 'scripts']
let codeCorpus = null
function loadCodeCorpus() {
  if (codeCorpus) return codeCorpus
  codeCorpus = ''
  for (const rel of trackedFiles) {
    if (!/\.(js|jsx)$/.test(rel)) continue
    if (!CODE_DIRS.some(d => rel.startsWith(`${d}/`)) && rel !== 'db.js' && rel !== 'server.js') continue
    codeCorpus += fs.readFileSync(path.join(ROOT, rel), 'utf8')
  }
  return codeCorpus
}
function checkFunctionCitations(rel, text) {
  // Only backticked identifiers written call-style: `someFunction(` — unambiguous, low noise.
  const seen = new Set()
  for (const m of text.matchAll(/`([a-z][A-Za-z0-9_]{6,})\(\)?`/g)) {
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)
    if (!loadCodeCorpus().includes(name)) {
      warn(rel, `cites \`${name}()\`, not found in tracked source — renamed or removed?`)
    }
  }
}

// ── 5. Status header present and in vocabulary ───────────────────────────────
function checkStatusHeader(rel, text) {
  const head = text.split('\n').slice(0, 40).join('\n')
  const m = head.match(/\*\*Status:\*\*\s*([^\n]+)/i)
  if (!m) {
    warn(rel, 'no **Status:** line in the first 40 lines')
    return
  }
  const value = m[1].toLowerCase()
  if (!STATUS_VOCABULARY.some(v => value.includes(v)) && !/implemented|proposed|complete|pass|draft|written|ready|pilot/.test(value)) {
    warn(rel, `**Status:** does not use the vocabulary (${STATUS_VOCABULARY.join(' | ')}): "${m[1].slice(0, 60)}"`)
  }
  const verified = head.match(/\*\*Last verified:\*\*\s*(\d{4}-\d{2}-\d{2})/i)
  if (verified && /ratified|active/.test(value)) {
    const age = (Date.now() - Date.parse(verified[1])) / 86400000
    if (age > STALE_DAYS) warn(rel, `Last verified ${verified[1]} — over ${STALE_DAYS} days old for an active/ratified doc`)
  }
}

// ── 6. Every archived spec self-discloses ────────────────────────────────────
// The archive spans generations of a repeatedly-redesigned app and its own Status lines are
// frozen at authoring time (spec 29/32/33 all say "not implemented"; all shipped). A grep hit
// opens the FILE, not docs/specs/README.md — so the warning has to live on every file.
function checkSpecBanners() {
  const dir = path.join(ROOT, 'docs', 'specs')
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md') || name === 'README.md') continue
    const rel = `docs/specs/${name}`
    if (!read(rel).includes(SPEC_BANNER)) {
      err(rel, 'archived spec is missing the HISTORICAL ARCHIVE banner — run scratch/add_spec_banners.js')
    }
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
for (const rel of docFiles) {
  const text = read(rel)
  // docs/specs/** is a frozen historical archive: its links, citations and status lines describe
  // an app that no longer exists, and editing them would falsify the record. The banner is the
  // only thing enforced there (checkSpecBanners below), and it is what tells a reader not to
  // trust the rest.
  if (rel.startsWith('docs/specs/') && rel !== 'docs/specs/README.md') continue
  checkLinks(rel, text)
  checkTombstones(rel, text)
  checkCitedScripts(rel, text)
  checkFunctionCitations(rel, text)
  if (rel.startsWith('docs/')) checkStatusHeader(rel, text)
}
checkSpecBanners()

const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  : { warningCount: Number.MAX_SAFE_INTEGER, note: 'no baseline yet' }

if (errors.length) {
  console.error(`\n❌ Doc health: ${errors.length} error(s)\n`)
  for (const e of errors) console.error(`   ${e.file}\n      ${e.msg}`)
  console.error('\nThese are hard failures: a broken pointer in a load-bearing doc misleads the next session.\n')
}

if (warnings.length) {
  console.warn(`\n⚠️  Doc health: ${warnings.length} warning(s) (baseline ${baseline.warningCount})`)
  for (const w of warnings.slice(0, 40)) console.warn(`   ${w.file}: ${w.msg}`)
  if (warnings.length > 40) console.warn(`   … and ${warnings.length - 40} more`)
}

const ratchetBroken = warnings.length > baseline.warningCount
if (ratchetBroken) {
  console.error(`\n❌ Doc-health warnings went UP: ${baseline.warningCount} → ${warnings.length}.`)
  console.error('   Fix the new one, or if it is legitimate, update scratch/docs_health_baseline.json deliberately.\n')
}

if (errors.length || ratchetBroken) process.exit(1)

if (warnings.length < baseline.warningCount && baseline.warningCount !== Number.MAX_SAFE_INTEGER) {
  console.log(`\n✅ Doc health: warnings down ${baseline.warningCount} → ${warnings.length}. Lower scratch/docs_health_baseline.json to lock the gain in.`)
} else {
  console.log(`\n✅ Doc health: ${docFiles.length} docs checked, no errors.`)
}
