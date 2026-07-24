import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/VisualLab.jsx', import.meta.url), 'utf8')
const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')
const taxonomySource = fs.readFileSync(new URL('../lib/feedbackTaxonomy.js', import.meta.url), 'utf8')

test('Visual Lab uses display-sized derivatives while full previews retain originals', () => {
  assert.match(source, /row\.thumbnail_url \|\| uploadThumbnailSrc\(row\.image_url, 'visual-reference'\)/)
  assert.match(source, /uploadThumbnailSrc\(board\.image_url, 'lookbook-display'\)/)
  assert.match(source, /uploadThumbnailSrc\(selectedBoard\.image_url, 'lookbook-display'\)/)
  assert.match(source, /setPreviewImage\(\{ src: row\.image_url/)
  assert.match(source, /setPreviewImage\(\{ src: selectedBoard\.image_url/)
})

test('Visual Lab defers off-screen grid decoding', () => {
  assert.match(source, /alt="Calibration" loading="lazy" decoding="async"/)
  assert.match(source, /alt=\{board\.title \|\| 'Saved board'\} loading="lazy" decoding="async"/)
})

test('Visual Lab deep-links directly to boards outside the initial grid page', () => {
  assert.match(source, /fetch\(`\/api\/saved-boards\/\$\{encodeURIComponent\(requestedBoardId\)\}`\)/)
  assert.match(source, /setSelectedBoard\(board\)/)
})

test('Visual Lab uses a mutually exclusive verdict and structured issue groups', () => {
  assert.match(taxonomySource, /This feels exactly like me/)
  assert.match(taxonomySource, /Looks good/)
  assert.match(source, /selectOverallVerdict\(selectedBoard, label\)/)
  assert.match(source, /verdictValues = new Set\(OVERALL_VERDICT_LABELS/)
  assert.match(source, /What feels wrong\?/)
  assert.match(source, /Fit and shape/)
  assert.match(taxonomySource, /Looks too bulky/)
  assert.match(taxonomySource, /My shape disappears/)
  assert.match(taxonomySource, /Looks too straight up and down/)
  assert.match(taxonomySource, /Feels too delicate/)
  assert.match(taxonomySource, /Too formal/)
  assert.match(taxonomySource, /Feels too quiet or dull/)
  assert.match(source, /toggleStructuredFeedbackReason\(selectedBoard, 'style_direction', reason\)/)
  assert.match(source, /toggleStructuredFeedbackReason\(selectedBoard, 'shape_balance', reason\)/)
})

test('Visual Lab humanizes legacy flat feedback labels on board cards', () => {
  assert.match(taxonomySource, /const SAVED_BOARD_FEEDBACK_DISPLAY_LABELS = \[/)
  assert.match(taxonomySource, /\.\.\.STYLE_DIRECTION_REASONS/)
  assert.match(taxonomySource, /\.\.\.SHAPE_BALANCE_REASONS/)
  assert.match(taxonomySource, /\['wrong_energy', 'The overall feel is wrong'\]/)
})

test('Calibration boards provide client-side search and meaningful feedback filters', () => {
  assert.match(source, /const \[savedBoardFilter, setSavedBoardFilter\]/)
  assert.match(source, /const \[savedBoardStatusFilter, setSavedBoardStatusFilter\]/)
  assert.match(source, /const filteredSavedBoards = useMemo/)
  assert.match(source, /Search boards, pieces, or feedback/)
  assert.match(source, /\['unreviewed', 'Not reviewed'\]/)
  assert.match(source, /\['review', 'Needs review'\]/)
  assert.match(source, /\['image', 'Image issues'\]/)
  assert.match(source, /aria-label="Review status"/)
  assert.match(source, /aria-label="Board status"/)
  assert.match(source, /aria-pressed=\{savedBoardFilter === value\}/)
  assert.match(source, /aria-pressed=\{savedBoardStatusFilter === value\}/)
  assert.match(source, /filteredSavedBoards\.map/)
  assert.match(source, /includeArchived: 'true'/)
})

test('Visual Lab separates styling diagnosis from image fidelity review', () => {
  assert.match(source, /Problems in the generated image/)
  assert.match(taxonomySource, /My body proportions look wrong/)
  assert.match(taxonomySource, /This does not look like me/)
  assert.match(source, /Which garment was rendered at the wrong length\?/)
  assert.match(source, /feedbackDetails: \{ \.\.\.details, wrong_length: next \}/)

  const fidelityControls = taxonomySource.match(/const IMAGE_FIDELITY_FEEDBACK_LABELS = \[([\s\S]*?)\n\]/)?.[1] || ''
  assert.match(fidelityControls, /wrong_length/)
  assert.match(fidelityControls, /wrong_garment_details/)
  assert.match(fidelityControls, /body_proportions_drift/)
  assert.match(fidelityControls, /identity_drift/)
  assert.doesNotMatch(fidelityControls, /bad_reference/)
  assert.match(taxonomySource, /SAVED_BOARD_FEEDBACK_DISPLAY_LABELS[\s\S]*\['bad_reference', 'Bad reference'\]/)
})

test('Calibration board detail behaves as a review dialog rather than a gallery card', () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="calibration-board-detail-title"/)
  assert.match(source, /boardCloseRef\.current\?\.focus\(\)/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /boardReturnFocusRef\.current\?\.focus\?\.\(\)/)
  assert.match(source, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(source, /Why it was suggested/)
  assert.match(source, /Start with the outfit direction/)
  assert.match(source, /rendering problems separately/)
  assert.match(source, /aria-labelledby="calibration-overall-label"/)
  assert.match(source, /aria-labelledby="calibration-image-label"/)
})

test('wrong-length garment selector is local navigation and not gated by a pending save', () => {
  // The garment picker only calls setRetagPieceId (local UI state); disabling it while a
  // feedback write is in flight swallows a quick garment switch so it appears not to persist.
  const selectorButton = source.match(/<button key=\{piece\.id\}[\s\S]*?setRetagPieceId\(Number\(piece\.id\)\)\}>/)?.[0] || ''
  assert.ok(selectorButton, 'garment selector button should exist')
  assert.doesNotMatch(selectorButton, /disabled=\{savedBoardPending\}/)
  // The reason buttons, which do write, remain gated during a save.
  const reasonButton = source.match(/<button key=\{issue\}[\s\S]*?toggleWrongLengthReason\(selectedBoard, issue\)\}>/)?.[0] || ''
  assert.ok(reasonButton, 'wrong-length reason button should exist')
  assert.match(reasonButton, /disabled=\{savedBoardPending\}/)
})

test('all AI outfit-rendering surfaces include saved-board renderer corrections', () => {
  assert.match(coreSource, /withSavedBoardRendererMemory\(savedOutfitImagePrompt/)
  assert.match(coreSource, /withSavedBoardRendererMemory\(wholeWardrobeImagePrompt/)
  assert.match(coreSource, /withSavedBoardRendererMemory\(wholeWardrobeComparisonSheetPrompt/)
  assert.match(coreSource, /withSavedBoardRendererMemory\(promptText, \[selectedPiece\]\)/)
  assert.match(coreSource, /withSavedBoardRendererMemory\([\s\S]*editorialImagePrompt/)
})
