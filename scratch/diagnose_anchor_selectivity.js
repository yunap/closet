import { db, parsePiece } from '../db.js'
import { visualWeightProfile } from '../styling-engine/rules.js'
import { pieceTextBlob, fabricWeight, patternLoudness, colorFamily, bottomKind } from '../styling-engine/attributes.js'

// Query all active pieces
const allPieces = db.prepare("SELECT * FROM pieces WHERE status = 'active'").all().map(parsePiece)

console.log("======================================================================")
console.log("DIAGNOSTIC: ANCHOR AND SOFTNESS SELECTIVITY")
console.log("======================================================================\n")

// 1. Diagnose piece ID 1 ("Whale stripe tee")
const piece1 = allPieces.find(p => p.id === 1)
if (piece1) {
  const blob = pieceTextBlob(piece1)
  const weight = fabricWeight(piece1)
  const loudness = patternLoudness(piece1)
  const colorFam = colorFamily(piece1)
  const profile = visualWeightProfile(piece1)
  
  // Re-evaluate the selectedNeedsAnchor logic step-by-step
  const selectedNeedsAnchor = profile.softness >= 2 || (
    profile.expressive && 
    (
      blob.includes('lace') ||
      blob.includes('floral') ||
      blob.includes('appliqué') ||
      blob.includes('applique') ||
      blob.includes('sheer') ||
      blob.includes('cream') ||
      blob.includes('white') ||
      blob.includes('pale') ||
      blob.includes('soft')
    )
  )

  console.log("--- Piece ID 1 Diagnostic ---")
  console.log(`Name:                 ${piece1.name}`)
  console.log(`Category:             ${piece1.category}`)
  console.log(`fabricWeight:         ${weight}`)
  console.log(`patternLoudness:      ${loudness}`)
  console.log(`colorFamily:          ${colorFam}`)
  console.log(`Computed Softness:    ${profile.softness}`)
  console.log(`Expressive Flag:      ${profile.expressive}`)
  console.log(`selectedNeedsAnchor:  ${selectedNeedsAnchor}`)
  console.log("Contributions:")
  console.log(`  - softness >= 2:    ${profile.softness >= 2} (val: ${profile.softness})`)
  console.log(`  - expressive:       ${profile.expressive}`)
  console.log(`  - has soft keyword: ${
    blob.includes('lace') ||
    blob.includes('floral') ||
    blob.includes('appliqué') ||
    blob.includes('applique') ||
    blob.includes('sheer') ||
    blob.includes('cream') ||
    blob.includes('white') ||
    blob.includes('pale') ||
    blob.includes('soft')
  }`)
  console.log(`  - matching words:   ${['lace','floral','appliqué','applique','sheer','cream','white','pale','soft'].filter(w => blob.includes(w)).join(', ')}`)
  console.log("\n")
} else {
  console.log("Piece ID 1 not found in database.\n")
}

// 2. Softness/anchor distribution over all active TOPS
const activeTops = allPieces.filter(p => p.category === 'top')
const triggeringTops = []
activeTops.forEach(top => {
  const profile = visualWeightProfile(top)
  const blob = pieceTextBlob(top)
  const selectedNeedsAnchor = profile.softness >= 2 || (
    profile.expressive && 
    (
      blob.includes('lace') ||
      blob.includes('floral') ||
      blob.includes('appliqué') ||
      blob.includes('applique') ||
      blob.includes('sheer') ||
      blob.includes('cream') ||
      blob.includes('white') ||
      blob.includes('pale') ||
      blob.includes('soft')
    )
  )
  if (selectedNeedsAnchor) {
    triggeringTops.push(top)
  }
})

console.log("--- Tops Anchor-Gate triggering ---")
console.log(`Total active tops:               ${activeTops.length}`)
console.log(`Tops triggering selectedNeedsAnchor: ${triggeringTops.length} (${((triggeringTops.length / activeTops.length) * 100).toFixed(1)}%)`)
console.log("Triggering tops list:")
triggeringTops.forEach(t => {
  const p = visualWeightProfile(t)
  console.log(`  - [ID ${t.id}] ${t.name} (softness: ${p.softness}, expressive: ${p.expressive})`)
})
console.log("\n")

// 3. Grounding distribution over all active BOTTOMS
const activeBottoms = allPieces.filter(p => p.category === 'bottom')
const groundingCounts = { 0: 0, 1: 0, 2: 0, 3: 0 }
const highGroundingBottoms = []
const highGroundingShortsOrMinis = []

activeBottoms.forEach(bottom => {
  const profile = visualWeightProfile(bottom)
  const g = profile.grounding
  const gLevel = g >= 4 ? 3 : g >= 2 ? 2 : g >= 0 ? 1 : 0
  groundingCounts[gLevel] = (groundingCounts[gLevel] || 0) + 1
  
  if (g >= 3) {
    highGroundingBottoms.push(bottom)
    const bKind = bottomKind(bottom)
    if (bKind === 'shorts' || bKind === 'skirt-mini') {
      highGroundingShortsOrMinis.push(bottom)
    }
  }
})

console.log("--- Bottoms Grounding Distribution ---")
console.log(`Total active bottoms:            ${activeBottoms.length}`)
console.log(`groundingLevel distribution (0/1/2/3+):`)
console.log(`  - 0 (floating/soft):           ${groundingCounts[0]} (${((groundingCounts[0]/activeBottoms.length)*100).toFixed(1)}%)`)
console.log(`  - 1 (light anchor):            ${groundingCounts[1]} (${((groundingCounts[1]/activeBottoms.length)*100).toFixed(1)}%)`)
console.log(`  - 2 (moderate anchor):         ${groundingCounts[2]} (${((groundingCounts[2]/activeBottoms.length)*100).toFixed(1)}%)`)
console.log(`  - 3 (strong anchor, g>=3):      ${groundingCounts[3]} (${((groundingCounts[3]/activeBottoms.length)*100).toFixed(1)}%)`)
console.log(`Percentage of bottoms with grounding >= 3: ${((highGroundingBottoms.length / activeBottoms.length) * 100).toFixed(1)}%`)

console.log("\nRed flags: Bottoms at grounding >= 3 that are shorts or mini-skirts:")
if (highGroundingShortsOrMinis.length === 0) {
  console.log("  None")
} else {
  highGroundingShortsOrMinis.forEach(b => {
    const p = visualWeightProfile(b)
    const bKind = bottomKind(b)
    console.log(`  - [ID ${b.id}] ${b.name} (bottomKind: ${bKind}, grounding: ${p.grounding})`)
  })
}
console.log("\n")

// 4. Print general selectivity details
console.log("--- Anchor gating firing rate against bottoms ---")
const selectedPiece = activeTops.find(t => t.id === 1) // Whale stripe tee
if (selectedPiece) {
  const selectedWeight = visualWeightProfile(selectedPiece)
  const selectedBlob = pieceTextBlob(selectedPiece)
  const selectedNeedsAnchor = selectedWeight.softness >= 2 || (
    selectedWeight.expressive && 
    (
      selectedBlob.includes('lace') ||
      selectedBlob.includes('floral') ||
      selectedBlob.includes('appliqué') ||
      selectedBlob.includes('applique') ||
      selectedBlob.includes('sheer') ||
      selectedBlob.includes('cream') ||
      selectedBlob.includes('white') ||
      selectedBlob.includes('pale') ||
      selectedBlob.includes('soft')
    )
  )
  
  let firingCount = 0
  activeBottoms.forEach(bottom => {
    const candidateWeight = visualWeightProfile(bottom)
    if (selectedNeedsAnchor && candidateWeight.grounding >= 3) {
      firingCount++
    }
  })
  
  console.log(`Whale stripe tee needs anchor: ${selectedNeedsAnchor}`)
  console.log(`Visual gravity fires for:      ${firingCount} / ${activeBottoms.length} bottoms (${((firingCount / activeBottoms.length) * 100).toFixed(1)}%)`)
}
console.log("======================================================================")
