import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/OutfitLookbook.jsx', import.meta.url), 'utf8')

// Helper to extract function body from source
function extractFunction(funcName, code) {
  const match = code.match(new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`))
  if (!match) throw new Error(`Could not find function ${funcName}`)
  const startIndex = match.index
  let braceCount = 0
  let endIndex = startIndex
  for (let i = startIndex; i < code.length; i++) {
    if (code[i] === '{') braceCount++
    else if (code[i] === '}') {
      braceCount--
      if (braceCount === 0) {
        endIndex = i + 1
        break
      }
    }
  }
  return code.slice(startIndex, endIndex)
}

// Extract and eval functions
const computeTokenSimilarityStr = extractFunction('computeTokenSimilarity', source)
const findBestMatchForExtractedStr = extractFunction('findBestMatchForExtracted', source)

const context = {}
new Function('context', `
  ${computeTokenSimilarityStr}
  ${findBestMatchForExtractedStr}
  context.computeTokenSimilarity = computeTokenSimilarity;
  context.findBestMatchForExtracted = findBestMatchForExtracted;
`)(context)

const { computeTokenSimilarity, findBestMatchForExtracted } = context

test('computeTokenSimilarity computes Jaccard similarity correctly', () => {
  assert.equal(computeTokenSimilarity('cream knit open cardigan', 'cream cardigan'), 0.5)
  assert.equal(computeTokenSimilarity('cream knit open cardigan', 'grey vest'), 0)
  assert.equal(computeTokenSimilarity('cream knit open cardigan', 'oatmeal cardigan'), 0.2)
})

test('findBestMatchForExtracted matches identical categories and overlapping colors/words', () => {
  const wardrobe = [
    { id: 1, name: 'cream cardigan', category: 'outerwear', colors: ['cream'], reads_as: 'cream cardigan' },
    { id: 2, name: 'grey vest', category: 'outerwear', colors: ['grey'], reads_as: 'grey vest' },
    { id: 3, name: 'oatmeal cardigan', category: 'outerwear', colors: ['oatmeal'], reads_as: 'oatmeal cardigan' },
    { id: 4, name: 'black pants', category: 'bottom', colors: ['black'], reads_as: 'black pants' }
  ]

  // High confidence match
  const match1 = findBestMatchForExtracted(
    { name_suggestion: 'cream knit open cardigan', category: 'outerwear', colors: ['cream'], reads_as: 'cream cardigan' },
    wardrobe
  )
  assert.equal(match1.piece.id, 1)
  assert.equal(match1.confidence, 'high')

  // Mismatch category
  const match2 = findBestMatchForExtracted(
    { name_suggestion: 'cream pants', category: 'bottom', colors: ['cream'], reads_as: 'cream pants' },
    wardrobe
  )
  assert.equal(match2.piece, null)
  assert.equal(match2.confidence, 'none')

  // Low confidence match (different colors)
  const match3 = findBestMatchForExtracted(
    { name_suggestion: 'cream knit open cardigan', category: 'outerwear', colors: ['cream'], reads_as: 'cream cardigan' },
    [
      { id: 3, name: 'oatmeal cardigan', category: 'outerwear', colors: ['oatmeal'], reads_as: 'oatmeal cardigan' }
    ]
  )
  assert.equal(match3.confidence, 'none') // Colors don't match
})
