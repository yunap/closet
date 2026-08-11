// Item 13 panel evidence capture.
//
// Deterministic replacement for hand-taken screenshots: drives the running panel fixture
// (panel-fixture-api :3097 / panel-fixture-web :5177) with the local Playwright chromium and
// writes PNGs to docs/item13-panel-captures/.
//
// Prerequisites:
//   node scratch/build_item13_feedback_panel_fixture.js --reset --with-auth
//   Start the API on :3097 with WARDROBE_DB_PATH, WARDROBE_UPLOADS_DIR and
//   WARDROBE_SYSTEM_DB_PATH from the generated fixture-manifest.json, plus
//   WARDROBE_MOCK_AI=true. Start Vite on :5177 with
//   VITE_API_PROXY_TARGET=http://127.0.0.1:3097 and no VITE_STYLIST_DEBUG.
//
// The final capture removes the unprocessed provisional reaction to show the empty synthesis
// state, so REBUILD THE FIXTURE afterwards. The script prints that reminder.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'docs', 'item13-panel-captures')
const BASE = process.env.PANEL_WEB_ORIGIN || 'http://127.0.0.1:5177'
const EMAIL = 'item13-panel@example.invalid'
const PASSWORD = 'item13-panel-only'

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const shots = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
const page = await context.newPage()

const shoot = async (name, { fullPage = true, locator = null } = {}) => {
  const file = path.join(outDir, `${name}.png`)
  if (locator) await locator.screenshot({ path: file })
  else await page.screenshot({ path: file, fullPage })
  shots.push(`${name}.png`)
  console.log(`  captured ${name}.png`)
}

const gotoProfile = async () => {
  await page.goto(`${BASE}/visual-lab?section=profile`, { waitUntil: 'networkidle' })
  await page.getByText('Outfit & styling feedback').first().waitFor()
}

// Expand every <details> whose text matches, so long-text states are visible in the capture.
const expandDetails = async (pattern) => {
  await page.evaluate((source) => {
    const re = new RegExp(source, 'i')
    document.querySelectorAll('details').forEach(d => { if (re.test(d.textContent)) d.open = true })
  }, pattern)
  await page.waitForTimeout(250)
}

console.log('signing in…')
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.getByRole('textbox', { name: /email/i }).fill(EMAIL)
await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD)
await page.getByRole('button', { name: /sign in/i }).click()
await page.waitForURL(url => !/\/login$/.test(url.pathname), { timeout: 15000 })

console.log('style profile…')
await gotoProfile()
await shoot('01-style-profile-populated-1440')

const reactionRow = page.locator('#feedback-row-4')
await reactionRow.waitFor()
await shoot('02-provisional-reaction-actions-1440', { locator: reactionRow })

console.log('accepted lesson, three widths…')
for (const width of [1440, 1024, 768]) {
  await page.setViewportSize({ width, height: 1000 })
  await gotoProfile()
  await expandDetails('accepted personal or contextual lesson|source reactions')
  await shoot(`03-accepted-lesson-expanded-${width}`)
}

console.log('constitution layers at 768…')
await page.setViewportSize({ width: 768, height: 1000 })
await gotoProfile()
await expandDetails('Layer 1 — Body & Comfort Contract|Layer 4 — Style Lanes')
await shoot('04-constitution-layers-768')
const clipped = await page.evaluate(() =>
  [...document.querySelectorAll('textarea')].filter(t => t.value && t.scrollHeight > t.clientHeight + 2).length)
console.log(`  clipped textareas at 768px: ${clipped}`)

console.log('source chat…')
await page.setViewportSize({ width: 1440, height: 1000 })
await gotoProfile()
await page.locator('#feedback-row-4').getByRole('button', { name: 'Open source chat' }).click()
await page.waitForURL(/\/stylist\/item13_panel_source_thread/, { timeout: 15000 })
await page.getByText('Panel fog-walk outfit').first().waitFor()
await page.waitForTimeout(600) // let garment thumbnails paint
await shoot('05-source-chat-populated-1440')

console.log('renderer control…')
await page.goto(`${BASE}/visual-lab?section=boards&boardId=1`, { waitUntil: 'networkidle' })
const rendererChip = page.getByRole('button', { name: 'A garment is the wrong length' })
await rendererChip.waitFor()
await rendererChip.scrollIntoViewIfNeeded()
console.log(`  chip aria-pressed=${await rendererChip.getAttribute('aria-pressed')}`)
await page.waitForTimeout(300)
await shoot('06-renderer-control-active-1440', { fullPage: false })

console.log('wardrobe tasks…')
await page.goto(`${BASE}/wardrobe`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /^Tasks/ }).click()
await page.getByText(/no tag was changed automatically/i).waitFor()
await page.waitForTimeout(300)
await shoot('07-wardrobe-tasks-retag-1440', { fullPage: false })

console.log('empty synthesis state (destructive)…')
await gotoProfile()
page.once('dialog', d => d.accept())
await page.locator('#feedback-row-4').getByRole('button', { name: 'Remove' }).click()
await page.getByText('No provisional outfit reactions are currently available for lesson synthesis.').waitFor()
await shoot('08-empty-synthesis-state-1440')

await browser.close()

fs.writeFileSync(path.join(outDir, 'MANIFEST.json'), JSON.stringify({
  origin: BASE,
  viewportsCaptured: [1440, 1024, 768],
  deviceScaleFactor: 2,
  stylistDebug: false,
  captures: shots,
}, null, 2))

console.log(`\n${shots.length} captures written to docs/item13-panel-captures/`)
console.log('The last capture removed the unprocessed reaction — rebuild before further use:')
console.log('  node scratch/build_item13_feedback_panel_fixture.js --reset --with-auth')
