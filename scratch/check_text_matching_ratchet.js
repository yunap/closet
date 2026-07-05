import fs from 'fs'
import path from 'path'

const PATTERNS = [
  /textIncludesAny\(/,
  /\b(blob|text|name|readsAs|reads_as|silhouette|notes|combined|hay|haystack|normalizedLine|noteBlob|n|value|q|question|lower|filename|category|normalizedCandName|normalizedAiName|targetName)\.includes\(/,
  /\.test\(\s*(blob|text|name|readsAs|reads_as|silhouette|notes|combined|hay|haystack|normalizedLine|noteBlob|n|value|q|question|lower|filename|category|normalizedCandName|normalizedAiName|targetName|piece\.name|p\.name|p\.reads_as|piece\.reads_as|p\.category|piece\.category|p\.notes|piece\.notes|piece\.silhouette|p\.silhouette|p\.readsAs|piece\.readsAs|c\.name|b\.piece\.name|a\.piece\.name|rawName|normalizedLine)\b/
]

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  let matchCount = 0
  let allowedCount = 0
  const matches = []

  lines.forEach((line, index) => {
    const isAllowed = line.includes('// ratchet-allow:')
    let hasMatch = false
    for (const pattern of PATTERNS) {
      if (pattern.test(line)) {
        hasMatch = true
        break
      }
    }

    if (hasMatch) {
      if (isAllowed) {
        allowedCount++
      } else {
        matchCount++
        matches.push({ lineNum: index + 1, content: line.trim() })
      }
    }
  })

  return { matchCount, allowedCount, matches }
}

const stylingEngineDir = './styling-engine'
const routesDir = './routes'

const filesToScan = []

if (fs.existsSync(stylingEngineDir)) {
  fs.readdirSync(stylingEngineDir).forEach(file => {
    if (file.endsWith('.js')) {
      filesToScan.push(path.join(stylingEngineDir, file))
    }
  })
}

if (fs.existsSync(routesDir)) {
  fs.readdirSync(routesDir).forEach(file => {
    if (file.endsWith('.js')) {
      filesToScan.push(path.join(routesDir, file))
    }
  })
}

const currentCounts = {}
let totalMatches = 0
const allowedCounts = {}

for (const file of filesToScan) {
  const { matchCount, allowedCount } = scanFile(file)
  currentCounts[file] = matchCount
  allowedCounts[file] = allowedCount
  totalMatches += matchCount
}

const baselinePath = 'scratch/ratchet_baseline.json'
let baseline = { fileCounts: {}, total: 0 }
let hasBaselineFile = false

if (fs.existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    hasBaselineFile = true
  } catch (err) {
    console.error(`Warning: Failed to parse baseline file: ${err.message}`)
  }
}

// Check for baseline violations
let failed = false
let dropped = false

console.log('\n======================================================================')
console.log('                 TEXT MATCHING DEBT RATCHET CHECK')
console.log('======================================================================\n')

console.log(
  sprintf(
    '%-35s | %-10s | %-10s | %-10s',
    'File Path',
    'Baseline',
    'Current',
    'Allowed'
  )
)
console.log('-'.repeat(75))

for (const file of filesToScan) {
  const fileBaseline = baseline.fileCounts[file] ?? 0
  const fileCurrent = currentCounts[file] ?? 0
  const fileAllowed = allowedCounts[file] ?? 0

  let statusStr = ''
  if (fileCurrent > fileBaseline) {
    failed = true
    statusStr = '❌ (EXCEEDED)'
  } else if (fileCurrent < fileBaseline) {
    dropped = true
    statusStr = '✅ (DROPPED)'
  } else {
    statusStr = '✅'
  }

  console.log(
    sprintf(
      '%-35s | %-10d | %-10d | %-10d %s',
      file,
      fileBaseline,
      fileCurrent,
      fileAllowed,
      statusStr
    )
  )
}
console.log('-'.repeat(75))
console.log(
  sprintf(
    '%-35s | %-10d | %-10d | %-10s',
    'TOTAL',
    baseline.total,
    totalMatches,
    ''
  )
)
console.log('======================================================================\n')

if (!hasBaselineFile) {
  console.log('No ratchet_baseline.json found. Generating the initial baseline file...')
  const newBaseline = {
    fileCounts: currentCounts,
    total: totalMatches
  }
  fs.writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2), 'utf8')
  console.log(`Saved initial baseline to ${baselinePath}.`)
  process.exit(0)
}

if (failed) {
  console.error('ERROR: Text-matching ratchet check failed!')
  console.error('One or more files have exceeded their allowed string-blob match baseline.')
  console.error('Please refactor the new text matching logic to use the attributes module instead,')
  console.error('or use // ratchet-allow: <reason> on the matching line if it is a legitimate non-garment string use.')
  process.exit(1)
}

if (dropped) {
  console.log('GREAT NEWS: You have reduced the text-matching debt!')
  console.log('Please tighten the ratchet by updating scratch/ratchet_baseline.json to match the new counts:')
  const suggestedBaseline = {
    fileCounts: currentCounts,
    total: totalMatches
  }
  console.log('\nSuggested ratchet_baseline.json content:\n')
  console.log(JSON.stringify(suggestedBaseline, null, 2))
  console.log('\nPlease copy and write this content to scratch/ratchet_baseline.json and commit it.')
} else {
  console.log('Ratchet verification passed. No text-matching baseline violations found.')
}

process.exit(0)

// Helper to format table rows
function sprintf(format, ...args) {
  let index = 0
  return format.replace(/%-?(\d*)([sd])/g, (match, width, type) => {
    let val = args[index++]
    if (val === undefined) return ''
    val = String(val)
    if (!width) return val
    const padding = parseInt(width, 10) - val.length
    if (padding <= 0) return val
    if (match.startsWith('%-')) {
      return val + ' '.repeat(padding)
    } else {
      return ' '.repeat(padding) + val
    }
  })
}
