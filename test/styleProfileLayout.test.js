import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/StylistSettings.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

test('active guidance leads with the memory itself and keeps compact canonical sections', () => {
  // The "What changed recently" strip was removed: every card in it also appeared in the sections
  // directly below, and its "Guides the stylist" label asserted unconditional delivery for rows
  // that are relevance-routed — and outright delivery for unresolved rows that are never sent.
  assert.doesNotMatch(source, /What changed recently/)
  assert.doesNotMatch(source, />Guides the stylist</)
  assert.match(source, /Things your stylist remembers for particular clothes or situations/)
  assert.match(source, /Garment &amp; occasion limits/)
  assert.match(source, /Always avoid[\s\S]*Firm rules your stylist always enforces\./)
  assert.match(source, /Specific pieces[\s\S]*Pieces your stylist avoids for certain occasions\./)
  assert.equal((source.match(/<h2>Things your stylist remembers for particular clothes or situations<\/h2>/g) || []).length, 1)
  assert.match(source, /Review all \{guidanceLimitCount\} limits/)
  assert.match(source, /className="style-profile-foundation"/)
  // The onboarding baseline reads as its own thing, distinct from the memory the stylist builds.
  assert.match(source, /The foundation your stylist uses every day/)
  assert.match(source, /These are your core preferences and guidance from onboarding/)
  assert.match(source, /FOUNDATION_TILES\.map/)
  assert.match(source, /Feedback your stylist noticed but hasn&rsquo;t acted on[\s\S]*className="style-memory-list"/)
  assert.match(source, /Other things you&rsquo;ve told your stylist/)
  assert.match(source, /className="memory-card"/)
  assert.match(source, /className="memory-told-row"/)
  assert.match(source, /className="style-memory-row style-memory-row--context"/)
  assert.match(css, /\.style-memory-list\s*\{[\s\S]*border-top:\s*1px solid var\(--border\)/)
  assert.match(css, /\.style-memory-row\s*\{[\s\S]*border-bottom:\s*1px solid var\(--border-light\)/)
})

test('active guidance uses effect language instead of storage labels', () => {
  assert.match(source, /\['guidance', 'Active guidance'\]/)
  // Both card types state their effect as a sentence rather than a storage-provenance label.
  assert.match(source, /Applies when styling \$\{garment\.join\(' or '\)\} for \$\{context\.join\(' '\)\}\./)
  assert.match(source, /For \{scope\}/)
  assert.doesNotMatch(source, /Source: told directly to your stylist/)
  assert.match(source, /Learned from feedback you approved\./)
  assert.match(source, /Not for \{group\.entries\.map/)
  assert.doesNotMatch(source, />Conversation memory</)
  assert.doesNotMatch(source, />Garment memory</)
  assert.doesNotMatch(source, />Matching situations</)
  assert.doesNotMatch(source, /Guidance you told your stylist/)
})

test('active guidance is read-only: it can be stopped, never reworded in place', () => {
  assert.match(source, /className="memory-told-text">\{row\.note\}/)
  assert.equal((source.match(/>Forget this<\/button>/g) || []).length, 2)
  assert.doesNotMatch(source, />Stop using<\/button>/)
  // No editor of any kind on either card type — no textarea, no scope control, no save action.
  // Correcting a preference means telling the stylist again in chat, which writes its own record.
  assert.doesNotMatch(source, /editingLearningId/)
  assert.doesNotMatch(source, /What should your stylist remember instead\?/)
  assert.doesNotMatch(source, />\s*Change\s*<\/button>/)
  assert.doesNotMatch(source, /Currently applies to/)
  assert.doesNotMatch(source, /feedback-synthesis-chip/)
  assert.match(css, /\.style-memory-read-layout\s*\{[\s\S]*display:\s*flex/)
})

test('contextual memory can be filtered without discarding its source context', () => {
  assert.match(source, /const CONTEXT_FILTERS = \[[\s\S]*Generated boards/)
  assert.doesNotMatch(source, /\['piece', 'Garments'\]/)
  assert.match(source, /function feedbackContextKind\(row\)/)
  assert.match(source, /return 'outfit'/)
  assert.match(source, /className="style-memory-type-filter"/)
  assert.match(source, /className=\{`style-memory-filter \$\{feedbackContextFilter === value \? 'active' : ''\}`\}/)
  assert.match(css, /\.style-memory-filter\.active\s*\{[\s\S]*var\(--accent-light\)/)
})

test('contextual memory progressively reveals results and hides raw metadata by default', () => {
  assert.match(source, /const FEEDBACK_PAGE_SIZE = 40/)
  assert.match(source, /setFeedbackVisibleCount\(count => count \+ FEEDBACK_PAGE_SIZE\)/)
  assert.match(source, /className="style-memory-show-more"/)
  assert.match(source, /function readableFeedbackNote\(value\)/)
  assert.match(source, /<details className="style-memory-technical">/)
  assert.match(source, /<summary>Technical details<\/summary>/)
  assert.match(css, /\.style-memory-technical dl\s*\{[\s\S]*grid-template-columns:/)
})

test('foundation layers read as notes: expand is not edit, and system language stays out of the reading view', () => {
  // Expanding renders plain lines on the card surface; only Edit swaps in a textarea, so the
  // resting state can never look editable.
  assert.match(source, /isOpen && !isEditing && \(/)
  assert.match(source, /isOpen && isEditing && \(/)
  assert.match(source, /<li key=\{index\}>\{line\}<\/li>/)
  assert.match(source, />\s*Cancel\s*<\/button>/)
  assert.match(source, /disabled=\{draft === body\}/)

  // One section open at a time — seven layers unfolded at once is what made this feel enormous.
  assert.match(source, /setOpenFoundationLayer\(current => \(current === layer \? null : layer\)\)/)

  // The stored text is a prompt: a "Layer N —" header, model-facing ALL-CAPS, and app-internal
  // glossary lines. The reading view filters those; the stored value is never rewritten.
  assert.match(source, /function foundationReadingLines\(body\)/)
  assert.match(source, /FOUNDATION_INTERNAL_LINE/)
  assert.match(source, /softenModelEmphasis/)
  assert.match(source, /technical \{hiddenCount === 1 \? 'note' : 'notes'\} shown when editing/)

  // Proven formulas is earned from confirmed outfits, never interviewed at onboarding, so it must
  // not inherit the section's "from onboarding" attribution.
  assert.match(source, /Earned from outfits you&rsquo;ve confirmed/)

  // Quiet footer rather than a machine timestamp.
  assert.match(source, /const friendlyLayerDate = value =>/)
  assert.doesNotMatch(source, /Last updated \$\{updatedAt\}/)
})

test('limits are a preview, and "Review all" opens its own view rather than unrolling the page', () => {
  // All firm rules always show — there are few and each is broad and high-impact.
  assert.match(source, /activeOwnerConstraints\.map\(row => \(/)
  // Specific pieces are capped at a small preview, ordered by what changed most recently.
  assert.match(source, /const LIMITS_PREVIEW = 4/)
  assert.match(source, /groupedOccasionExclusions\.slice\(0, LIMITS_PREVIEW\)\.map\(renderExclusionRow\)/)
  // The overview and the full list are mutually exclusive: "Review all" must not expand inline.
  assert.match(source, /const showingAllLimits = searchParams\.get\('limits'\) === 'all'/)
  assert.match(source, /styleProfileTab === 'guidance' && showingAllLimits && !showingPastDecisions && \(/)
  assert.match(source, /styleProfileTab === 'guidance' && !showingAllLimits && !showingPastDecisions && <>/)
  assert.doesNotMatch(source, /limitsExpanded/)
  // The focused view is actually focused: the foundation card belongs to the overview, so leaving
  // it rendered underneath made the sub-view read as a half-hidden page rather than its own place.
  assert.match(source, /!showingAllLimits && !showingPastDecisions && \(\n\s*<div className="style-profile-foundation">/)
  // Switching tabs clears the param, so it can't silently resurrect the sub-view later.
  assert.match(source, /if \(showingAllLimits\) setSearchParams/)
})

test('limit rows lay out from content, not a fixed column count', () => {
  // A firm-rule row has no thumbnail. Under a 3-column grid its button landed in the 1fr track and
  // stretched the full row width; flex keeps every row correct regardless of how many children.
  assert.match(css, /\.limit-row \{[\s\S]*display: flex/)
  assert.match(css, /\.limit-row-body \{[\s\S]*flex: 1 1 auto/)
  assert.match(css, /\.limit-row > button \{[\s\S]*flex: 0 0 auto/)
})

test('Style profile has two primary tabs; past decisions is a recovery archive behind a quiet link', () => {
  // History carried equal visual weight to the two tabs the owner actually works in, while being
  // an audit trail she could take no action from.
  assert.match(source, /const STYLE_PROFILE_TABS = \[\n\s*\['guidance', 'Active guidance'\],\n\s*\['review', 'Review feedback'\],\n\]/)
  assert.doesNotMatch(source, /\['history', 'History'\]/)
  assert.match(source, /className="past-decisions-link"/)
  assert.match(source, /View past decisions/)

  // Its only justification is recovery, so every row leads somewhere.
  assert.match(source, /const showingPastDecisions = searchParams\.get\('past'\) === '1'/)
  assert.match(source, /label: 'Start using again', run: \(\) => restoreOwnerConstraint\(row\)/)
  assert.match(source, /label: 'Start using again', run: \(\) => updateSynthesisDraft\(row, 'accepted'\)/)
  assert.match(source, /label: 'Reconsider', run: \(\) => updateSynthesisDraft\(row, 'draft'\)/)
  assert.match(source, /label: 'Reopen', run: \(\) => reopenProductFinding\(row\)/)

  // A declined suggestion returns to Review feedback to be re-decided, never straight to active.
  assert.doesNotMatch(source, /rejected[\s\S]{0,220}run: \(\) => updateSynthesisDraft\(row, 'accepted'\)/)
})

test('an unusable synthesis result is reported, not queued as a decision', () => {
  // It was reaching "Waiting on your decision" with Accept / Keep for later / Reject, so the only
  // way to clear a non-result was Reject — which then filed it as a suggestion she turned down.
  assert.match(source, /draft\.disposition !== 'insufficient_evidence'/)
  assert.match(source, /const reportedNonResults = synthesisDrafts/)
  assert.match(source, /Nothing to learn from/)
  assert.match(source, /didn&rsquo;t find enough to go on/)
  // Its rationale is the useful part, and it is removable so the archive does not accumulate.
  assert.match(source, /row\.rationale \|\| row\.boundary/)
  assert.match(source, /label: 'Remove', run: \(\) => removeSynthesisNonResult\(row\)/)
  assert.match(source, /title: "Couldn't be turned into a lesson"/)
})

test('forgetting guidance is recoverable: it lists in Past decisions with Start using again', () => {
  // "Forget this" archives rather than deletes, but nothing surfaced archived guidance, so the
  // action looked permanent and the recovery archive was missing its most likely entry.
  assert.match(source, /includeArchived=true/)
  assert.match(source, /setForgottenLearnings\(feedbackRows\.filter\(row => row\.archived && isStandingLearning\(row\)\)\)/)
  assert.match(source, /label: 'Start using again', run: \(\) => restoreLearning\(row\)/)
  assert.match(source, /body: JSON\.stringify\(\{ archived: false \}\)/)
  // The active lists must now exclude archived explicitly, since the response no longer does.
  assert.match(source, /const liveFeedbackRows = feedbackRows\.filter\(row => !row\.archived\)/)
  assert.match(source, /const activeFeedbackRows = liveFeedbackRows/)
})
