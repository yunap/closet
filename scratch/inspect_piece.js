import { db, parsePiece, safeJsonParse } from '../db.js'

function usage() {
  console.log(`Usage:
  npm run inspect:piece -- --id 123
  npm run inspect:piece -- --search "emerald green"
  npm run inspect:piece -- "emerald green"

Options:
  --id <id>          Print one piece by database id.
  --search <text>   Search name/read fields and print matching ids.
  --json            Print compact JSON only for the selected piece.`)
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
