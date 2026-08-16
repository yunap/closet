// Sweeps the engine's keyword lists for the SINGULAR-ONLY bug.
//
// Garment names are overwhelmingly plural ("black slip-on loafers", "taupe suede ankle boots"),
// but the engine's keyword regexes test singular forms with word boundaries: /\bloafer\b/ does not
// match "loafers". Found while mapping the role vocabulary, where it moved 8 of 33 shoes out of
// the default shoe-shape bucket.
//
// This finds every literal keyword alternation in styling-engine/ and reports which terms would
// match MORE real wardrobe pieces if a plural 's?' were allowed — so the affected sites are a list,
// not a guess.
//
//   node scratch/measure_plural_gap.js
//
// Read-only. No network, no model call.

import fs from 'fs'
import path from 'path'
import { db, parsePiece } from '../db.js'
import { pieceTextBlob, pieceNameBlob } from '../styling-engine/rules.js'

const root = process.cwd()
const pieces = db.prepare("SELECT * FROM pieces WHERE status='active'").all().map(parsePiece)
const blobs = pieces.map(p => ({ id: p.id, name: p.name, text: pieceTextBlob(p), nameBlob: pieceNameBlob(p) }))

const FILES = fs.readdirSync(path.join(root, 'styling-engine')).filter(f => f.endsWith('.js'))

// literal alternations like /\b(a|b|c)\b/
const ALT = /\/\\b\(([a-z|\- ]{4,400})\)\\b\//g

const terms = new Map()   // term -> Set of "file:line"
for (const file of FILES) {
  const src = fs.readFileSync(path.join(root, 'styling-engine', file), 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    let m
    ALT.lastIndex = 0
    while ((m = ALT.exec(line))) {
      for (const raw of m[1].split('|')) {
        const term = raw.trim()
        if (!term || term.length < 3) continue
        if (term.endsWith('s')) continue          // already plural or plural-tolerant
        if (!terms.has(term)) terms.set(term, new Set())
        terms.get(term).add(`styling-engine/${file}:${i + 1}`)
      }
    }
  })
}

const rows = []
for (const [term, sites] of terms) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sing = new RegExp(`\\b${esc}\\b`)
  const plur = new RegExp(`\\b${esc}s\\b`)
  const singHits = blobs.filter(b => sing.test(b.text)).length
  const missed = blobs.filter(b => !sing.test(b.text) && plur.test(b.text))
  // name-level misses are unambiguous: the garment IS the thing, it is not merely mentioned
  // in another piece's notes (pieceTextBlob includes notes and learned styling rules).
  const nameMissed = blobs.filter(b => !sing.test(b.nameBlob) && plur.test(b.nameBlob))
  if (nameMissed.length) rows.push({ term, singHits, missed: missed.length, nameMissed: nameMissed.length, sites: sites.size, example: nameMissed[0].name })
}

rows.sort((a, b) => b.nameMissed - a.nameMissed)
console.log(`wardrobe: ${pieces.length} active pieces`)
console.log(`scanned ${FILES.length} engine files, ${terms.size} distinct singular keywords in literal alternations\n`)
console.log(`--- keywords that MISS real pieces because only the singular is matched ---\n`)
console.log(`  ${'keyword'.padEnd(14)} ${'sing.hits'.padStart(9)} ${'by name'.padStart(8)} ${'sites'.padStart(6)}   example garment missed`)
console.log(`  ${'-'.repeat(14)} ${'-'.repeat(9)} ${'-'.repeat(8)} ${'-'.repeat(6)}   ${'-'.repeat(40)}`)
for (const r of rows) {
  const dead = r.singHits === 0 ? '  <- NEVER FIRES' : ''
  console.log(`  ${r.term.padEnd(14)} ${String(r.singHits).padStart(9)} ${String(r.nameMissed).padStart(8)} ${String(r.sites).padStart(6)}   ${String(r.example).slice(0, 40)}${dead}`)
}
const totalMissed = rows.reduce((s, r) => s + r.nameMissed, 0)
console.log(`\n  ${rows.length} keywords affected, ${totalMissed} garments missed by name.`)
console.log('\nNOTE: "by name" counts garments whose OWN NAME carries the plural — unambiguous.')
console.log('Not every site is worth fixing — but any DISTRIBUTION in the behaviour map derived')
console.log('from one of these keywords is understated, and should be re-measured before acting.')
