/**
 * Stamps the HISTORICAL ARCHIVE banner onto every file in docs/specs/.
 *
 * The archive spans several generations of a repeatedly-redesigned app, and each spec's own
 * `Status:` line is frozen at authoring time — spec 29, 32 and 33 all say "Proposed. Not
 * implemented." and all three are merged. A search hit opens the spec FILE, not
 * docs/specs/README.md, so the warning has to be on every file.
 *
 * Idempotent: files that already carry the banner are left alone. Run this after adding a spec.
 * `npm test` (scratch/check_docs_health.js) fails if any spec is missing it.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SPECS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'specs')
const MARKER = 'HISTORICAL ARCHIVE — NOT A DESIGN AUTHORITY'

const BANNER = `
> ## ⚠️ ${MARKER}
>
> This spec is a **frozen record of intent at the time it was written**. It spans generations of an
> app that has been redesigned several times, and decisions in it have been revisited, reversed, or
> deleted since.
>
> **The \`Status:\` line below is frozen at authoring time and is frequently WRONG today.** Several
> specs marked "Proposed. Not implemented." shipped long ago (spec 29, 32 and 33 all say this, and
> all are merged).
>
> **Authority order when this disagrees with anything (owner ruling, 2026-07-30):**
> **1. the code** — what actually runs · **2. ratified docs**
> ([occasion profiles](../occasion_profiles_ratification.md), [style constitution](../style_constitution.md),
> the three maps) · **3. this archive** — only *why* something was once done that way.
>
> A decision made from fresh evidence — a live run, a measurement — **stands**. "An old spec decided
> otherwise" is an **unverified claim, not a finding**. Record the disagreement and let testing
> settle it; do not revert working behaviour on the strength of this file.
>
> Read [docs/specs/README.md](README.md) before acting on anything below.
`

let stamped = 0
let skipped = 0

for (const name of fs.readdirSync(SPECS_DIR).sort()) {
  if (!name.endsWith('.md') || name === 'README.md') continue
  const filePath = path.join(SPECS_DIR, name)
  const text = fs.readFileSync(filePath, 'utf8')
  if (text.includes(MARKER)) { skipped += 1; continue }

  const lines = text.split('\n')
  let titleIndex = lines.findIndex(line => line.startsWith('# '))
  const insertAt = titleIndex === -1 ? 0 : titleIndex + 1
  const next = [...lines.slice(0, insertAt), BANNER, ...lines.slice(insertAt)].join('\n')
  fs.writeFileSync(filePath, next)
  stamped += 1
}

console.log(`spec banners: ${stamped} stamped, ${skipped} already present`)
