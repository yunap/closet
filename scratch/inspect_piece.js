import { db, parsePiece, safeJsonParse } from '../db.js'
import {
  pieceHasInsulatingMaterial,
  thermalMaterialVerdict,
  compositionEvidenceState,
  fabricAdmitsHiddenMaterial,
  pieceHasVentilatedFootwearMaterial,
  pieceHasWetSensitiveFootwearMaterial,
  pieceOuterwearRole,
  pieceWeatherProtection,
  wardrobeCategoryGroup,
} from '../styling-engine/attributes.js'
import { pieceWeatherScores } from '../styling-engine/thermal.js'
import { evaluateOuterwearCapability } from '../styling-engine/outerwearCapability.js'

// The candidate warmth scale from docs/garment-warmth-calibration.md §2, migrated onto the
// verdict layer 2026-09-01 (fiber-evidence-completeness-spec.md §12). It previously asked
// pieceHasInsulatingMaterial() — a boolean — and then hand-rolled its own "is the composition
// unresolved?" test from the raw fibre list. That local heuristic is exactly the question
// compositionEvidenceState()/thermalMaterialVerdict() now own, so it is gone rather than kept in
// sync.
//
// The three-way rule, which is the point of the migration:
//   insulating      positive evidence  → substance + 2
//   non_insulating  negative evidence  → substance alone, decisively
//   unknown         NOT coerced to the old false — a substantial garment whose composition was
//                   never established has an unknown warmth level, not a low one
//
// The substance floor stays: for an ultralight or light garment the missing evidence cannot change
// the answer much, so unknown composition there is not worth refusing to score.
const SUBSTANCE = { light: 0, medium: 1, heavy: 2 }
function proposedWarmthLevel(piece) {
  const substance = SUBSTANCE[piece.fabric_weight] ?? null
  if (substance === null) return 'UNKNOWN (no fabric_weight)'
  const verdict = thermalMaterialVerdict(piece)
  // Refuse to score only where the missing evidence could actually change the answer: a
  // substantial garment whose composition was never established AND whose construction admits
  // material you cannot see. Without the third condition this refuses to score half the wardrobe —
  // see fabricAdmitsHiddenMaterial() for the measurement.
  if (verdict === 'unknown' && substance >= 1 && fabricAdmitsHiddenMaterial(piece)) {
    return 'UNKNOWN (substantial, hidden material possible, composition never established)'
  }
  const bonus = verdict === 'insulating' ? 2 : 0
  return ['very light', 'light', 'moderate', 'warm', 'very warm'][Math.min(4, substance + bonus)]
}

// What the engine CONCLUDES from the stored facts above it. Added 2026-09-01: the puffer
// investigation needed the tags and their consequences side by side — a garment whose
// fiber_content read ["polyester","nylon"] looked correctly tagged while scoring the same warmth as
// heavy denim, and only the derived line made that visible.
function printDerived(piece) {
  const group = wardrobeCategoryGroup(piece)
  const scores = pieceWeatherScores(piece)
  const line = (k, v) => console.log(`${String(k).padEnd(26)}${v}`)
  console.log('\n=== Derived: what the engine concludes ===')
  line('thermal evidence', scores.evidence ? 'present' : 'null  <- nothing known about warmth')
  line('cold / heat score', `${scores.cold} / ${scores.heat}`)
  line('composition evidence', compositionEvidenceState(piece))
  line('thermal material verdict', thermalMaterialVerdict(piece))
  line('warmth level (proposed)', proposedWarmthLevel(piece))
  if (group === 'outerwear') {
    line('outerwear role', pieceOuterwearRole(piece) ?? 'null (unknown)')
    line('weather protection', JSON.stringify(pieceWeatherProtection(piece)))
    line('as outdoor layer', evaluateOuterwearCapability(piece, { requireOutdoorLayer: true }).verdict)
  }
  if (group === 'shoes') {
    line('absorbent upper', pieceHasWetSensitiveFootwearMaterial(piece))
    line('ventilated upper', pieceHasVentilatedFootwearMaterial(piece))
  }
}

function usage() {
  console.log(`Usage:
  WARDROBE_ALLOW_LIVE_DB=1 npm run inspect:piece -- --id 123
  npm run inspect:piece -- --search "emerald green"
  npm run inspect:piece -- "emerald green"

Options:
  --id <id>          Print one piece by database id.
  --search <text>   Search name/read fields and print matching ids.
  --json            Print compact JSON only for the selected piece.

Reads the live wardrobe.db through db.js, so it needs WARDROBE_ALLOW_LIVE_DB=1
(docs/database-safety.md) or WARDROBE_DB_PATH pointing at a copy. It only reads.

Prints the stored tags AND the verdicts derived from them, so a tag and its
consequences can be compared side by side.`)
}

function argValue(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

function parseJsonField(row, field, fallback) {
  return safeJsonParse(row?.[field], fallback)
}

function printSummary(row) {
  const piece = parsePiece(row)
  console.log(`${piece.id}: ${piece.name}`)
  console.log(`  category=${piece.category} tag_state=${piece.tag_state} photo=${piece.photo || '-'} worn_photo=${piece.worn_photo || '-'}`)
  console.log(`  colors=${piece.colors.join(', ') || '-'} occasions=${piece.occasions.join(', ') || '-'}`)
  console.log(`  reads_as=${piece.reads_as || '-'}`)
}

function printPiece(row, { jsonOnly = false } = {}) {
  const piece = parsePiece(row)
  const rawJson = {
    colors: parseJsonField(row, 'colors', []),
    occasions: parseJsonField(row, 'occasions', []),
    occasion_permissions: parseJsonField(row, 'occasion_permissions', []),
    occasion_exclusions: parseJsonField(row, 'occasion_exclusions', []),
    styling_rules_learned: parseJsonField(row, 'styling_rules_learned', []),
    pairs_well_with: parseJsonField(row, 'pairs_well_with', []),
    tried_and_rejected: parseJsonField(row, 'tried_and_rejected', []),
    style_profile_json: parseJsonField(row, 'style_profile_json', {}),
    manual_overrides: parseJsonField(row, 'manual_overrides', [])
  }
  const output = {
    piece,
    raw_row: row,
    parsed_json_fields: rawJson
  }
  if (jsonOnly) {
    console.log(JSON.stringify(output, null, 2))
    return
  }

  console.log('\n=== Piece ===')
  printSummary(row)
  console.log('\n=== Structure / Fit ===')
  ;[
    'neckline',
    'sleeve_type',
    'silhouette',
    'length_hits_at',
    'hem_finish',
    'fabric_category',
    'fabric_weight',
    'stretch',
    'fit_on_body',
    'tuck_behavior',
    'waistband_type',
    'fit_confidence',
    'recommendation_status',
    'role_permission'
  ].forEach(field => console.log(`${field}: ${piece[field] ?? '-'}`))

  printDerived(piece)

  console.log('\n=== Notes ===')
  console.log(piece.notes || '-')
  if (piece.engine_notes) console.log(`\nengine_notes: ${piece.engine_notes}`)

  console.log('\n=== Manual Overrides ===')
  console.log(JSON.stringify(piece.manual_overrides || [], null, 2))

  console.log('\n=== Style Profile JSON ===')
  console.log(JSON.stringify(piece.style_profile_json || {}, null, 2))

  console.log('\n=== Raw Row ===')
  console.log(JSON.stringify(row, null, 2))
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  usage()
  process.exit(0)
}

const jsonOnly = args.includes('--json')
const id = argValue(args, '--id')
const search = argValue(args, '--search') || args.find(arg => !arg.startsWith('--'))

if (id) {
  const row = db.prepare('SELECT * FROM pieces WHERE id = ?').get(id)
  if (!row) {
    console.error(`No piece found with id ${id}`)
    process.exit(1)
  }
  printPiece(row, { jsonOnly })
  process.exit(0)
}

if (!search) {
  usage()
  process.exit(1)
}

const term = `%${search}%`
const rows = db.prepare(`
  SELECT * FROM pieces
  WHERE name LIKE ?
     OR reads_as LIKE ?
     OR colors LIKE ?
     OR style_profile_json LIKE ?
  ORDER BY date_added DESC
  LIMIT 25
`).all(term, term, term, term)

if (!rows.length) {
  console.error(`No pieces matched "${search}"`)
  process.exit(1)
}

if (rows.length === 1) {
  printPiece(rows[0], { jsonOnly })
} else {
  console.log(`Found ${rows.length} matching pieces. Re-run with --id <id> for the full dump:\n`)
  rows.forEach(printSummary)
}
