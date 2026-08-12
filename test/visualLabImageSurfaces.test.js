import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/VisualLab.jsx', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const coreSource = fs.readFileSync(new URL('../styling-engine/core.js', import.meta.url), 'utf8')
const taxonomySource = fs.readFileSync(new URL('../lib/feedbackTaxonomy.js', import.meta.url), 'utf8')
const styleProfileSource = fs.readFileSync(new URL('../src/views/StylistSettings.jsx', import.meta.url), 'utf8')

test('Style Lab names the teaching workspace without adding an attention count', () => {
  assert.match(appSource, /label: 'Style Lab'/)
  assert.match(source, /<div className="view-title">Style Lab<\/div>/)
  assert.match(source, /\['references', 'References'\]/)
  assert.match(source, /\['saved', 'Outfit feedback'\]/)
  assert.match(source, /\['profile', 'Style profile'\]/)
  assert.doesNotMatch(source, /Outfit feedback \{/)
})

test('Style profile separates active guidance from review work', () => {
  assert.match(styleProfileSource, /\['guidance', 'Active guidance'\]/)
  assert.match(styleProfileSource, /\['review', 'Review feedback'\]/)
  assert.match(styleProfileSource, /activeOwnerConstraints[\s\S]*Garment &amp; occasion limits/)
  assert.doesNotMatch(styleProfileSource, /No structured standing constraints are active/)
  assert.match(styleProfileSource, /const proposal = ownerConstraintProposal\(row\)/)
  assert.match(styleProfileSource, /\{proposal && \(/)
  assert.match(styleProfileSource, /useStoredProposal: true/)
  assert.match(styleProfileSource, /Make this a firm rule/)
  assert.match(styleProfileSource, /Confirm firm rule/)
  assert.match(styleProfileSource, /<h2>Things your stylist remembers for particular clothes or situations<\/h2>/)
  assert.match(styleProfileSource, /<h2>Things your stylist got wrong<\/h2>/)
  assert.match(styleProfileSource, /fetch\('\/api\/owner-constraints'\)/)
  assert.match(styleProfileSource, /fetch\('\/api\/product-quality-findings'\)/)
  assert.match(styleProfileSource, /row\.memory\?\.destination === 'renderer'/)
  // Renderer reports are their own section: nothing there awaits a decision, and each is already
  // acting on the image prompt, so listing them under "got wrong" implied a queue that isn't one.
  assert.match(styleProfileSource, /Fixes your stylist applies when drawing pictures/)
  assert.match(styleProfileSource, /const groupedRendererCorrections =/)
  assert.doesNotMatch(styleProfileSource, /General styling failures and image-generation problems/)
  assert.match(styleProfileSource, /Choose where the fix landed/)
  assert.match(styleProfileSource, /Mark resolved/)
})

test('guidance surfaces are read-only explanations, with no scope vocabulary anywhere', () => {
  // A lesson's conditions are ANDed, so a control that removed one would widen where it fires
  // rather than narrow it. There is no safe in-place adjustment, so neither card offers editing.
  assert.match(styleProfileSource, /const lessonAppliesSentence = draft =>/)
  assert.match(styleProfileSource, /const synthesisScopeParts = draft =>/)
  assert.doesNotMatch(styleProfileSource, /Currently applies to/)
  assert.doesNotMatch(styleProfileSource, /SynthesisApplicabilityChips/)
  assert.doesNotMatch(styleProfileSource, /Edit when this applies/)
  assert.doesNotMatch(styleProfileSource, /Only when both garment and context match/)
  // Forgetting a memory stays available on both card types — that is the undo path.
  assert.equal((styleProfileSource.match(/>Forget this<\/button>/g) || []).length, 2)
})

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

test('Outfit feedback provides client-side search and meaningful feedback filters', () => {
  assert.match(source, /const \[savedBoardFilter, setSavedBoardFilter\]/)
  assert.match(source, /const \[savedBoardStatusFilter, setSavedBoardStatusFilter\]/)
  assert.match(source, /const filteredSavedBoards = useMemo/)
  assert.match(source, /Search boards, pieces, or feedback/)
  assert.match(source, /\['unreviewed', 'Not reviewed'\]/)
  assert.match(source, /\['flagged', 'Flagged'\]/)
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

test('Outfit feedback detail behaves as a review dialog rather than a gallery card', () => {
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

test('wrong-length correction renders one reason group per piece, with no shared garment picker to lose', () => {
  // A single shared "which garment" pointer (retagPieceId) used to reset to the first piece
  // on every open/close of the board detail card, hiding correctly-saved corrections on any
  // piece past the first. Fixed by dropping the picker entirely: every piece gets its own
  // always-visible reason group, driven directly by feedback_details.wrong_length.
  assert.doesNotMatch(source, /retagPieceId/)
  const reasonButton = source.match(/<button key=\{issue\}[\s\S]*?toggleWrongLengthReason\(selectedBoard, pieceId, issue\)\}>/)?.[0] || ''
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

test('adding a reference is a References-only action, and History reads as decisions not stores', () => {
  // The page-level "+ Add reference" was offered on every Style Lab tab, including two sections
  // where it acts on content the owner is not looking at.
  assert.match(source, /activeSection === 'references' \|\| activeSection === 'upload' \|\| !activeSection/)

  // History groups by what she did; the old list labelled rows with store names ("Retired
  // constraint", "Rejected draft", "Reviewed conclusion") and printed raw timestamps.
  assert.match(styleProfileSource, /Rules, lessons, and suggestions you&rsquo;ve stopped using or declined/)
  assert.match(styleProfileSource, /title: 'No longer used'/)
  assert.match(styleProfileSource, /title: 'You decided not to keep these'/)
  assert.match(styleProfileSource, /title: 'Reviewed and closed'/)
  assert.match(styleProfileSource, /friendlyLayerDate\(row\.date\)/)
  assert.doesNotMatch(styleProfileSource, /<span>Retired constraint<\/span>/)
  assert.doesNotMatch(styleProfileSource, /<span>\{row\.status === 'retired' \? 'Retired lesson'/)
  assert.doesNotMatch(styleProfileSource, /History only<\/small>/)
})
