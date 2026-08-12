// Measures the capsule roster prompt-cache split documented in
// docs/engine-behaviour-map.md → "The capsule roster prompt cache".
//
// Read-only. Runs no migrations, makes no provider call, touches no image file
// beyond reading the pieces table. Safe against a live database.
//
//   node scratch/measure_capsule_prompt_cache.js [--db wardrobe.db] [--bench 40]
//
// What it answers: how much of the capsule roster request sits behind
// `cache_control`, and how much of that cached prefix is the owner-rules block
// that now varies per request since guidance became relevance-routed.
import path from 'node:path'

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const dbPath = path.resolve(arg('--db', 'wardrobe.db'))
const benchSize = Number(arg('--bench', 40))

process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = dbPath
process.env.WARDROBE_UPLOADS_DIR = process.env.WARDROBE_UPLOADS_DIR || path.resolve('uploads')

const { db, parsePiece } = await import('../db.js')
const { capsuleRosterSelectionUserText } = await import('../routes/ai.js')
const { pieceVisualDetailPolicy } = await import('../styling-engine/attributes.js')

// ~4 characters per token is the same rough basis used elsewhere for local
// upper bounds; images use Anthropic's published (width * height) / 750.
const estTextTokens = value => Math.ceil(String(value).length / 4)
const estImageTokens = maxPx => Math.ceil((maxPx * maxPx) / 750)

const bench = db.prepare(`
  SELECT * FROM pieces
  WHERE status IS NULL OR status = 'active'
  LIMIT ?
`).all(benchSize).map(parsePiece)

const slots = [
  { label: 'Everyday errands', occasion: 'casual', bestFor: 'daytime errands' },
  { label: 'Client day', occasion: 'smart casual', bestFor: 'office and client meetings' },
  { label: 'Evening out', occasion: 'evening', bestFor: 'dinner' },
  { label: 'Travel day', occasion: 'travel', bestFor: 'airport and transit' },
]
const base = { bench, slots, budget: 24, palette: ['rust', 'camel'], isSummer: true, isWinter: false, quotas: null }

// The same text builder the provider path uses, with and without the blocks
// that relevance routing made request-dependent.
const withoutRules = capsuleRosterSelectionUserText({ ...base, ownerRules: [], acceptedLessons: '' })
const withRules = capsuleRosterSelectionUserText({
  ...base,
  ownerRules: [
    'For office and client days: structured silhouettes only — no dressy maxi skirts, no shawls at work.',
    'Yuna prefers to travel in pants, not dresses, for airplane travel days.',
  ],
  acceptedLessons: '- Olive suede slip-ons read autumnal; avoid for summer. Boundary: summer contexts only.',
})

let hiRes = 0
let lowRes = 0
let withPhoto = 0
for (const piece of bench) {
  if (!(piece.worn_photo || piece.photo)) continue
  withPhoto += 1
  if (pieceVisualDetailPolicy(piece).maxPx === 800) hiRes += 1
  else lowRes += 1
}

const textTokens = estTextTokens(withRules)
const imageTokens = hiRes * estImageTokens(800) + lowRes * estImageTokens(448)
const prefixTokens = textTokens + imageTokens
const rulesTokens = estTextTokens(withRules) - estTextTokens(withoutRules)
const pct = value => `${((100 * value) / prefixTokens).toFixed(2)}%`

console.log(`db: ${dbPath}`)
console.log(`bench: ${bench.length} pieces, ${withPhoto} with photos (${hiRes} hi-res 800px, ${lowRes} low 448px)\n`)
console.log('CACHED PREFIX — content[0] text + every thumbnail, behind cache_control:')
console.log(`  content[0] catalog text ........ ${String(textTokens).padStart(8)} tokens`)
console.log(`  thumbnails .................... ${String(imageTokens).padStart(8)} tokens`)
console.log(`  ---------------------------------------------`)
console.log(`  cacheable prefix .............. ${String(prefixTokens).padStart(8)} tokens\n`)
console.log('REQUEST-VARYING, AT THE FRONT OF THAT PREFIX:')
console.log(`  owner rules + accepted lessons  ${String(rulesTokens).padStart(8)} tokens  (${pct(rulesTokens)})`)
console.log(`\n  A change in the applicable rule set invalidates all ${prefixTokens} tokens behind it.`)
console.log('  The intra-run invariant (attempt 1 -> attempt 2 repair) is unaffected: ownerRules is')
console.log('  computed once per run upstream and passed unchanged into both attempts.')
