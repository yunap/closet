import { useEffect, useRef, useState } from 'react'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'
import { GATE_CRITICAL_FIELDS, missingGateFields } from '../../styling-engine/attributes.js'
import { ColorEditor } from './ColorSelector.jsx'
import InfoTooltip from './InfoTooltip.jsx'

const CATEGORIES  = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
const OCCASIONS   = ['casual', 'city', 'evening', 'smart-casual', 'outdoor', 'home']
const SEASONS     = ['warm', 'cool', 'year-round']
const RECOMMENDATION_STATUSES = [
  { value: 'trusted', label: 'Trusted' },
  { value: 'experimental', label: 'Experimental' },
  { value: 'needs_fit_review', label: 'Needs fit review' },
  { value: 'avoid', label: 'Do not recommend' },
]
const FIT_CONFIDENCE = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]
const FORMALITY_OPTIONS = [
  { value: 'lounge', label: 'Lounge' },
  { value: 'everyday', label: 'Everyday' },
  { value: 'elevated', label: 'Elevated' },
  { value: 'dressy', label: 'Dressy' },
]
const ROLE_PERMISSIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'focal_ok', label: 'Focal ok' },
  { value: 'support_only', label: 'Support only' },
  { value: 'only_when_requested', label: 'Only when requested' },
  { value: 'never_auto', label: 'Never auto-use' },
]
const STATUSES    = [
  { value: 'active',            label: 'Active' },
  { value: 'needs-repair',      label: '⚠ Needs repair' },
  { value: 'consider-donating', label: '◌ Consider donating' },
  { value: 'donated',           label: '✓ Donated' },
]
const OPACITY_OPTIONS = [
  { value: 'opaque', label: 'opaque' },
  { value: 'semi_sheer', label: 'semi-sheer' },
  { value: 'sheer', label: 'sheer' },
  { value: 'open_weave', label: 'open weave' },
]
const NEEDS_BASE_OPTIONS = [
  { value: 'yes', label: 'needs a base layer' },
  { value: 'no', label: 'wearable alone (checked)' },
]

const FIBER_OPTIONS = [
  'cotton', 'linen', 'hemp', 'silk', 'wool', 'merino', 'cashmere',
  'alpaca', 'mohair', 'fleece', 'down', 'tencel', 'modal',
  'rayon', 'viscose', 'polyester', 'nylon', 'acrylic',
  'spandex', 'leather', 'suede', 'denim', 'tweed',
  'metal', 'stone', 'wood', 'ceramic', 'glass', 'horn', 'shell', 'resin',
  'pearl', 'crystal', 'enamel', 'unknown'
]
const HEEL_HEIGHT_OPTIONS = [
  { value: 'flat', label: 'Flat' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
]
const WALK_SUPPORT_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

const ACCESSORY_SUBTYPE_OPTIONS = [
  { value: 'belt', label: 'Belt' },
  { value: 'bag', label: 'Bag' },
  { value: 'jewelry', label: 'Jewelry' },
  { value: 'scarf', label: 'Scarf' },
  { value: 'hat', label: 'Hat' },
  { value: 'watch', label: 'Watch' },
  { value: 'glasses', label: 'Glasses' },
  { value: 'gloves', label: 'Gloves' },
  { value: 'other', label: 'Other' },
]
const JEWELRY_TYPE_OPTIONS = [
  { value: 'necklace', label: 'Necklace' },
  { value: 'earrings', label: 'Earrings' },
  { value: 'bracelet', label: 'Bracelet' },
  { value: 'ring', label: 'Ring' },
  { value: 'pin', label: 'Pin' },
]
const NECKLACE_LENGTH_OPTIONS = [
  { value: 'choker', label: 'Choker' },
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
]

const BOTTOM_SUBTYPE_OPTIONS = [
  { value: 'pants', label: 'Pants' },
  { value: 'shorts', label: 'Shorts' },
  { value: 'skirt', label: 'Skirt' },
  { value: 'culottes', label: 'Culottes' },
  { value: 'overalls', label: 'Overalls' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
]

const CLOTHING_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear']

const CONSTRUCTION_BY_CATEGORY = {
  top: {
    sectionLabel: 'Construction',
    showNeckline: true,
    showSleeve: true,
    silhouetteLabel: 'Silhouette',
    silhouetteOptions: ['fitted','slim','straight','relaxed','boxy','drop-shoulder','oversized','peplum','wrap'],
    lengthLabel: 'Length hits at',
    lengthOptions: ['cropped','waist','high_hip','hip','low_hip','tunic','unknown'],
    hemLabel: 'Hem finish',
    hemOptions: [
      { value: 'straight_loose', label: 'straight' },
      { value: 'banded_elastic', label: 'banded / elastic' },
      { value: 'ribbed',         label: 'ribbed' },
      { value: 'curved',         label: 'curved' },
      { value: 'shirttail',      label: 'shirttail' },
      { value: 'high_low',       label: 'high-low' },
      { value: 'asymmetric',     label: 'asymmetric' },
      { value: 'other',          label: 'other' },
    ],
  },
  bottom: {
    sectionLabel: 'Construction',
    silhouetteLabel: 'Bottom shape',
    // No static silhouetteOptions: depends on bottom_subtype (skirt vs
    // pants), same as lengthOptions below — see BOTTOM_SKIRT_SILHOUETTE_OPTIONS
    // / BOTTOM_PANTS_SILHOUETTE_OPTIONS, chosen at render time.
    lengthLabel: 'Length',
    // No static lengthOptions: bottom's length vocabulary depends on
    // bottom_subtype (skirt vs pants) — see BOTTOM_SKIRT_LENGTH_OPTIONS /
    // BOTTOM_PANTS_LENGTH_OPTIONS below, chosen at render time.
    hemLabel: 'Hem / leg opening',
    hemOptions: [
      { value: 'straight_loose', label: 'straight/open' },
      { value: 'cuffed', label: 'cuffed' },
      { value: 'raw', label: 'raw/frayed' },
      { value: 'tapered', label: 'tapered' },
      { value: 'banded_elastic', label: 'elastic/banded' },
      { value: 'slit', label: 'slit' },
      { value: 'asymmetric', label: 'asymmetric' },
      { value: 'other', label: 'other' },
    ],
  },
  dress: {
    sectionLabel: 'Construction',
    showNeckline: true,
    showSleeve: true,
    silhouetteLabel: 'Dress shape',
    silhouetteOptions: ['fitted','sheath','shift','A-line','wrap','slip','column','fit-and-flare','empire','relaxed'],
    lengthLabel: 'Length',
    lengthOptions: ['mini','above_knee','knee','below_knee','midi','ankle','maxi','unknown'],
  },
  outerwear: {
    sectionLabel: 'Construction',
    showSleeve: true,
    silhouetteLabel: 'Outerwear shape',
    silhouetteOptions: ['fitted','straight','boxy','relaxed','oversized','structured'],
    lengthLabel: 'Length hits at',
    lengthOptions: ['cropped','waist','high_hip','hip','low_hip','mid_thigh','knee','mid_calf','ankle','full_length','floor_length','unknown'],
  },
  shoes: {
    sectionLabel: 'Shoe Details',
    // No silhouette here — shoe_type/toe_shape replace it (the old flat
    // silhouette list mixed toe shape and shoe type into one enum).
    lengthLabel: 'Coverage / shaft',
    lengthOptions: ['open','below_ankle','ankle','high_top','mid_calf','knee','over_knee','unknown'],
  },
}

const SHOE_TYPE_OPTIONS = ['mule','loafer','boot','sandal','pump','flat','sneaker','slip_on','other','unknown']
const TOE_SHAPE_OPTIONS = ['pointed','almond','round','square','open_toe','other','unknown']
const OUTERWEAR_ROLE_OPTIONS = ['indoor_layer','transition_layer','protective_shell','cold_weather_outerwear']
const WEATHER_PROTECTION_OPTIONS = ['rain','wind']

const BOTTOM_SKIRT_SILHOUETTE_OPTIONS = ['a_line','pencil','full','slip','straight','pleated','wrap']
const BOTTOM_PANTS_SILHOUETTE_OPTIONS = ['straight_leg','wide_leg','bootcut','flare','tapered','barrel','relaxed']
const BOTTOM_SKIRT_LENGTH_OPTIONS = ['mini','above_knee','knee','below_knee','midi','ankle','maxi','unknown']
const BOTTOM_PANTS_LENGTH_OPTIONS = ['shorts','knee','mid_calf','ankle','full_length','floor_length','unknown']

const FABRIC_BY_CATEGORY = {
  shoes: {
    sectionLabel: 'Material',
    fabricLabel: 'Primary Material',
    fabricOptions: ['leather','suede','nubuck','patent','canvas','mesh','woven','synthetic','textile','rubber','other'],
    weightLabel: 'Visual weight',
    weightOptions: ['delicate','slim','medium','chunky'],
    showStretch: false,
  },
  accessory: {
    sectionLabel: 'Material',
    fabricLabel: 'Primary Material',
    fabricOptions: ['leather','suede','metal','stone','straw','canvas','synthetic','textile','rubber','wood','ceramic','glass','horn','shell','resin','pearl','crystal','enamel','other'],
    weightLabel: 'Visual weight',
    weightOptions: ['delicate','slim','medium','chunky'],
    showStretch: false,
  },
  default: {
    sectionLabel: 'Fabric',
    fabricLabel: 'Fabric',
    fabricOptions: ['jersey','knit','rib knit','ponte','sweatshirt fleece','fleece','cotton','poplin','linen','linen blend','rayon','viscose','modal','silk','satin','crepe','chiffon','organza','lace','crochet','jacquard','wool','cashmere','boucle','denim','twill','canvas','corduroy','tweed','velvet','leather','faux leather','suede','faux suede','mesh','technical/performance','synthetic','other'],
    weightLabel: 'Weight',
    weightOptions: ['ultralight','light','medium','heavy'],
    showStretch: true,
  },
}

// ── Rule list (add/remove chips) ──────────────────────────────────────────────
// An "Excluded from X by <name> (<date>)" line is written alongside a real
// occasion exclusion, and it is only the receipt — the enforceable record is
// pieces.occasion_exclusions, which PUT /pieces/:id cannot write (its column
// list omits it). So removing this chip and saving used to be guaranteed
// cosmetic: the note vanished, the garment stayed blocked, and nothing on the
// screen said so any more. Those chips now call the restore endpoint instead.
//
// A chip is treated as live only when the occasion it names is still present in
// the garment's own exclusion list. Prose alone is not enough: the same text
// remains after a restore, and matching on it would offer to restore something
// already restored.
const EXCLUSION_RULE = /^Excluded from (.+?) by .+\(\d{4}-\d{2}-\d{2}\)\s*$/

function normalizeOccasion(value) {
  return String(value || '').toLowerCase().replace(/[-_]+/g, ' ').trim()
}

export function liveExclusionOccasion(rule, exclusions = []) {
  const match = EXCLUSION_RULE.exec(String(rule || ''))
  if (!match) return null
  const occasion = match[1].trim()
  const normalized = normalizeOccasion(occasion)
  return exclusions.some(entry => normalizeOccasion(entry) === normalized) ? occasion : null
}

function RuleList({ rules, onChange, placeholder, color = 'accent', exclusions = [], onRestore = null, restoring = '' }) {
  const [input, setInput] = useState('')

  const add = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    onChange([...rules, trimmed])
    setInput('')
  }

  const remove = (i) => onChange(rules.filter((_, idx) => idx !== i))

  const colorVar = color === 'donate' ? 'var(--donate)' : color === 'repair' ? 'var(--repair)' : 'var(--accent)'
  const bgVar    = color === 'donate' ? 'var(--donate-bg)' : color === 'repair' ? 'var(--repair-bg)' : 'var(--accent-light)'

  return (
    <div>
      {rules.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {rules.map((rule, i) => {
            const liveOccasion = onRestore ? liveExclusionOccasion(rule, exclusions) : null
            const busy = Boolean(liveOccasion) && restoring === liveOccasion
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px 4px 12px', borderRadius: 20,
                background: bgVar, border: `1px solid ${colorVar}`,
                fontSize: 12, color: colorVar, maxWidth: '100%',
              }}>
                <span style={{ flex: 1, lineHeight: 1.4 }}>{rule}</span>
                {liveOccasion && (
                  <span
                    title="This is a live occasion exclusion, not just a note"
                    style={{ fontSize: 9, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.75, flexShrink: 0 }}
                  >rule</span>
                )}
                <button
                  onClick={() => liveOccasion ? onRestore(liveOccasion) : remove(i)}
                  disabled={busy}
                  title={liveOccasion
                    ? `Restore this piece for ${liveOccasion} — removing the note alone would not`
                    : 'Remove this rule'}
                  style={{ color: colorVar, fontSize: 14, lineHeight: 1, flexShrink: 0, opacity: busy ? 0.35 : 0.7 }}
                >{busy ? '…' : '✕'}</button>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="form-input"
          style={{ flex: 1, fontSize: 13 }}
          placeholder={placeholder}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          style={{
            padding: '0 14px', background: colorVar, color: '#fff',
            borderRadius: 'var(--radius-sm)', fontSize: 13, flexShrink: 0,
            opacity: input.trim() ? 1 : 0.4,
          }}
        >+</button>
      </div>
    </div>
  )
}

// ── Section divider ────────────────────────────────────────────────────────────
function Section({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 -4px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }} />
      <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }} />
    </div>
  )
}

// ── Photo slot ─────────────────────────────────────────────────────────────────
function PhotoSlot({ label, hint, preview, onChange, onClear, onPreview, pendingRemoval = false, onRestore }) {
  return (
    <div className="form-group">
      <div className="form-label piece-form-photo-label">{label}</div>
      {pendingRemoval ? (
        <div className="piece-form-photo-removal">
          <span>{label} will be removed when you save.</span>
          <button type="button" className="btn-secondary" onClick={onRestore}>Restore</button>
        </div>
      ) : preview ? (
        <div className="photo-preview">
          <button
            type="button"
            className="photo-preview-open"
            onClick={onPreview}
            aria-label={`Open larger ${label.toLowerCase()}`}
          >
            <img src={uploadThumbnailSrc(preview, 'garment-display')} alt={label} decoding="async" />
          </button>
          <button type="button" className="photo-preview-remove" onClick={onClear} aria-label={`Remove ${label.toLowerCase()}`}>✕</button>
        </div>
      ) : (
        <label className="photo-upload">
          <input type="file" accept="image/*" onChange={onChange} />
          <div className="photo-upload-icon" style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
          <div className="photo-upload-text" style={{ fontSize: 12 }}>{label}</div>
          <div className="photo-upload-hint" style={{ fontSize: 12 }}>{hint}</div>
        </label>
      )}
    </div>
  )
}

// ── Chip row helper ─────────────────────────────────────────────────────────────
// Re-clicking the selected chip used to CLEAR the field. That is the wrong
// default here: the common reason to click a value that is already correct is to
// confirm it — which is what marks the field owner-set — and the old behaviour
// silently emptied it instead, then pinned the empty value as a manual override.
// Confirming is now what a re-click does; clearing moved to its own control so
// it has to be meant. Multi-select is untouched: there, clicking an active chip
// removing it from the list is the only way to deselect and is unambiguous.
// `clearable={false}` for required fields whose call site refuses an empty value
// (category does: `v || form.category`). Rendering a clear control there would
// offer an action that silently does nothing.
// `none`/`unknown` are the tagger's "does not apply to this category" sentinels,
// not values the person chose — same set buildWardrobePieceTruthText refuses to
// print. There is nothing to clear, so don't offer to.
const CHIP_UNSET_VALUES = new Set(['none', 'unknown', 'n/a'])

function ChipRow({ options, value, onChange, multi = false, label, labelledBy, clearable = true }) {
  const hasValue = clearable && !multi &&
    value !== null && value !== undefined && value !== '' &&
    !CHIP_UNSET_VALUES.has(String(value).toLowerCase())
  return (
    <div className="chip-grid" role="group" aria-label={label} aria-labelledby={labelledBy}>
      {options.map(opt => {
        const val  = typeof opt === 'string' ? opt : opt.value
        const lbl  = typeof opt === 'string' ? opt : opt.label
        const active = multi ? (Array.isArray(value) ? value.includes(val) : false) : value === val
        return (
          <button
            key={val}
            type="button"
            className={`chip-toggle ${active ? 'active' : ''}`}
            aria-pressed={active}
            onClick={() => multi
              ? onChange(active ? value.filter(v => v !== val) : [...(value||[]), val])
              : onChange(val)
            }
            title={active ? 'Already selected — click to confirm this value as yours' : undefined}
            style={{ textTransform: 'capitalize' }}
          >{lbl}</button>
        )
      })}
      {hasValue && (
        <button
          type="button"
          className="chip-toggle chip-toggle-clear"
          onClick={() => onChange(null)}
          title="Clear this field"
        >clear</button>
      )}
    </div>
  )
}

export default function PieceForm({ piece, onSave, onCancel }) {
  const isEdit   = Boolean(piece?.id)
  const isTop    = (cat) => cat === 'top'
  const isBottom = (cat) => cat === 'bottom'

  const [form, setForm] = useState({
    name:               piece?.name               || '',
    category:           piece?.category           || 'top',
    colors:             piece?.colors             || [],
    occasions:          piece?.occasions          || [],
    season:             piece?.season             || 'year-round',
    notes:              piece?.notes              || '',
    status:             piece?.status             || 'active',
    recommendation_status: piece?.recommendation_status || 'trusted',
    fit_confidence:        piece?.fit_confidence        || 'unknown',
    role_permission:       piece?.role_permission       || 'auto',
    occasion_permissions:  piece?.occasion_permissions  || [],
    engine_notes:          piece?.engine_notes          || '',
    // Pattern
    pattern_type:       piece?.pattern_type       || null,
    pattern_scale:      piece?.pattern_scale      || null,
    pattern_complexity: piece?.pattern_complexity || null,
    reads_as:           piece?.reads_as           || '',
    // Construction
    neckline:           piece?.neckline           || null,
    sleeve_length:      piece?.sleeve_length      || null,
    sleeve_shape:       piece?.sleeve_shape       || null,
    length_hits_at:     piece?.length_hits_at     || null,
    silhouette:         piece?.silhouette         || null,
    hem_finish:         piece?.hem_finish         || null,
    // Fabric
    fabric_category:    piece?.fabric_category    || null,
    fabric_weight:      piece?.fabric_weight      || null,
    visual_weight:      piece?.visual_weight      || null,
    opacity:            piece?.opacity            || null,
    needs_base:         piece?.needs_base         || null,
    fiber_content:      piece?.fiber_content      || [],
    formality:          piece?.formality          || null,
    heel_height:        piece?.heel_height        || null,
    walk_support:       piece?.walk_support       || null,
    stretch:            piece?.stretch            || null,
    // Fit
    fit_on_body:        piece?.fit_on_body        || null,
    tuck_behavior:      piece?.tuck_behavior      || null,
    waistband_type:     piece?.waistband_type     || null,
    // Accessory
    accessory_subtype:  piece?.accessory_subtype  || null,
    jewelry_type:       piece?.jewelry_type       || null,
    necklace_length:    piece?.necklace_length    || null,
    // Bottom
    bottom_subtype:     piece?.bottom_subtype     || null,
    // Shoes
    shoe_type:          piece?.shoe_type          || null,
    toe_shape:          piece?.toe_shape          || null,
    // Outerwear
    outerwear_role:     piece?.outerwear_role     || null,
    weather_protection: piece?.weather_protection || [],
    // Learned wisdom
    styling_rules_learned: piece?.styling_rules_learned || [],
    tried_and_rejected:    piece?.tried_and_rejected    || [],
    style_profile_json:    piece?.style_profile_json    || {},
    // Color
    background_color: piece?.background_color || '',
    tagger_version: piece?.tagger_version || null,
    tag_state: piece?.tag_state || 'untagged',
  })
  const initialConfidence = piece?.style_profile_json?._confidence || {}
  const [confidenceFlags, setConfidenceFlags] = useState(Object.fromEntries(
    Object.entries(initialConfidence).filter(([, conf]) => conf === 'medium' || conf === 'low')
  )) // field -> 'medium'|'low'
  const [manualOverrides, setManualOverrides] = useState(piece?.manual_overrides || [])
  // The enforceable exclusion list, kept beside the form because PUT /pieces/:id
  // cannot write it — only POST /pieces/:id/occasion-exclusion can.
  const [exclusions, setExclusions] = useState(piece?.occasion_exclusions || [])
  const [restoringOccasion, setRestoringOccasion] = useState('')

  // Restoring is a real, immediate change to the garment, matching how the same
  // action behaves in the Stylist chat and in Style profile. It deliberately
  // does not wait for Save: Save cannot perform it, so deferring would leave the
  // button doing nothing again.
  const restoreOccasion = async (occasion) => {
    if (!piece?.id || restoringOccasion) return
    setRestoringOccasion(occasion)
    try {
      const res = await fetch(`/api/pieces/${piece.id}/occasion-exclusion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, excluded: false }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Restore failed')
      const updated = await res.json()
      setExclusions(updated.occasion_exclusions || [])
      // Sync exactly to the server rather than trimming the clicked line. The
      // endpoint keeps "Excluded from …" and appends "Restored for …" on
      // purpose — that pair is the audit trail. Editing it here would put the
      // form out of step with the database and would survive only if the person
      // then pressed Save, which they have no reason to do after an action that
      // already took effect.
      //
      // The visible feedback is the badge disappearing and the "Restored for …"
      // chip arriving, not the original line vanishing.
      setForm(f => ({
        ...f,
        styling_rules_learned: Array.isArray(updated.styling_rules_learned) ? updated.styling_rules_learned : f.styling_rules_learned,
      }))
    } catch (err) {
      alert(err.message || 'Could not restore this occasion')
    } finally {
      setRestoringOccasion('')
    }
  }

  const [hangerFile,  setHangerFile]  = useState(null)
  const [hangerPrev,  setHangerPrev]  = useState(piece?.photo      ? `/uploads/${piece.photo}`      : null)
  const [wornFile,    setWornFile]    = useState(null)
  const [wornPrev,    setWornPrev]    = useState(piece?.worn_photo  ? `/uploads/${piece.worn_photo}` : null)
  const [clearHanger, setClearHanger] = useState(false)
  const [clearWorn,   setClearWorn]   = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [tagging,     setTagging]     = useState(false)
  const [tagError,    setTagError]    = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const [styleReadExpanded, setStyleReadExpanded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [aiUpdateSummary, setAiUpdateSummary] = useState(null)
  const [colorTaxonomyGaps, setColorTaxonomyGaps] = useState([])
  const dialogRef = useRef(null)
  const stylistControlsRef = useRef(null)
  const garmentCharacterRef = useRef(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const titleId = `piece-form-title-${piece?.id || 'new'}`
  const retagSuggestions = Array.isArray(piece?.retag_suggestions) ? piece.retag_suggestions : []
  const suggestedFields = new Set(retagSuggestions.map(suggestion => suggestion.field).filter(Boolean))

  const markManualOverride = (path) => {
    setManualOverrides(paths => paths.includes(path) ? paths : [...paths, path])
    setForm(f => {
      const profile = f.style_profile_json && typeof f.style_profile_json === 'object' ? f.style_profile_json : {}
      return {
        ...f,
        style_profile_json: {
          ...profile,
          _confidence: {
            ...(profile._confidence || {}),
            [path]: 'manual'
          }
        }
      }
    })
  }
  const clearManualOverride = (path) => {
    setManualOverrides(paths => paths.filter(p => p !== path))
  }
  const set = (k, v) => {
    setDirty(true)
    markManualOverride(k)
    setForm(f => ({ ...f, [k]: v }))
  }
  const toggleArr = (k, val) => {
    setDirty(true)
    markManualOverride(k)
    setForm(f => ({
      ...f,
      [k]: f[k].includes(val) ? f[k].filter(x => x !== val) : [...f[k], val]
    }))
  }
  const normalizeProfileList = (value) => {
    if (!value) return []
    if (Array.isArray(value)) return [...new Set(value.map(v => String(v || '').trim()).filter(Boolean))]
    return String(value).split(/[\n;]+/).map(v => v.trim()).filter(Boolean)
  }
  const isManualOverride = (path) => manualOverrides.some(override => (
    override === path || path.startsWith(`${override}.`) || override.startsWith(`${path}.`)
  ))
  const applyTagValue = (draft, field, value, fallback = draft[field]) => {
    if (value === undefined || value === null || value === '') return
    if (isManualOverride(field)) return
    draft[field] = value || fallback
  }
  const mergeTagProfile = (existing, incoming) => {
    if (!incoming || typeof incoming !== 'object' || manualOverrides.includes('style_profile_json')) return existing
    const base = existing && typeof existing === 'object' ? existing : {}
    const merged = { ...base, ...incoming }
    for (const path of manualOverrides.filter(p => p.startsWith('style_profile_json.'))) {
      const parts = path.replace(/^style_profile_json\./, '').split('.')
      let source = base
      let target = merged
      for (let i = 0; i < parts.length - 1; i += 1) {
        source = source?.[parts[i]]
        target[parts[i]] = { ...(target[parts[i]] || {}) }
        target = target[parts[i]]
      }
      const key = parts[parts.length - 1]
      if (source && Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key]
    }
    return merged
  }

  // Auto-tag from a new hanger photo. In edit mode, retag from saved hanger + worn photos when available.
  const handleTagThis = async () => {
    const hasExistingPhoto = isEdit && ((piece?.photo && hangerPrev && !clearHanger) || (piece?.worn_photo && wornPrev && !clearWorn))
    if (!hangerFile && !wornFile && !hasExistingPhoto) return
    setTagging(true); setTagError(null)
    try {
      let res
      if (isEdit) {
        // Always retag through tag-piece-existing so ground-truth overrides and the
        // wardrobe anchor block still apply, even when a new hanger photo is picked —
        // /tag-piece has neither. Any newly-selected (not yet saved) photo is sent
        // along; a field left unsent falls back to whatever's already saved on the piece.
        const fd = new FormData()
        if (hangerFile) fd.append('photo', hangerFile)
        if (wornFile) fd.append('worn_photo', wornFile)
        res = await fetch(`/api/ai/tag-piece-existing/${piece.id}`, { method: 'POST', body: fd })
      } else {
        const fd = new FormData()
        fd.append('photo', hangerFile)
        if (wornFile) fd.append('worn_photo', wornFile)
        res = await fetch('/api/ai/tag-piece', { method: 'POST', body: fd })
      }
      const tags = await res.json()
      if (tags.error) throw new Error(tags.error)
      const taxonomyGaps = Array.isArray(tags.color_taxonomy_gaps) ? tags.color_taxonomy_gaps : []
      setColorTaxonomyGaps(taxonomyGaps)
      // Compute the diff synchronously against the current form state, then set it directly —
      // NOT inside a setForm functional updater. React does not invoke a functional updater
      // synchronously at the call site; it runs later during the render phase. The previous code
      // mutated an outer `changedCount` variable from inside that updater and then read it on the
      // very next line, before React had actually run the updater — so `changedCount` was
      // effectively always still its initial value (0) by the time the toast message below used
      // it, regardless of how many fields the tag response actually changed. Confirmed live: a
      // brand-new piece tagged for the first time filled in every field correctly, yet showed "AI
      // found no new details to apply. Your protected edits were preserved." Reading `form`
      // directly here is safe — both "Tag this" buttons and Save are disabled for the whole
      // duration of this async call (`disabled={tagging || saving}` / `disabled={saving ||
      // tagging || ...}`), so nothing else can change `form` while this is in flight.
      const next = { ...form }
      applyTagValue(next, 'category', tags.category)
      applyTagValue(next, 'colors', tags.colors)
      applyTagValue(next, 'occasions', tags.occasions)
      applyTagValue(next, 'season', tags.season)
      if (!form.name) applyTagValue(next, 'name', tags.name_suggestion, '')
      if (!form.notes) applyTagValue(next, 'notes', tags.notes_suggestion, '')
      applyTagValue(next, 'background_color', tags.background_color)
      applyTagValue(next, 'pattern_type', tags.pattern_type)
      applyTagValue(next, 'pattern_scale', tags.pattern_scale)
      applyTagValue(next, 'pattern_complexity', tags.pattern_complexity)
      applyTagValue(next, 'reads_as', tags.reads_as)
      applyTagValue(next, 'hem_finish', tags.hem_finish)
      applyTagValue(next, 'neckline', tags.neckline)
      applyTagValue(next, 'sleeve_length', tags.sleeve_length)
      applyTagValue(next, 'sleeve_shape', tags.sleeve_shape)
      applyTagValue(next, 'length_hits_at', tags.length_hits_at)
      applyTagValue(next, 'silhouette', tags.silhouette)
      applyTagValue(next, 'fabric_category', tags.fabric_category)
      applyTagValue(next, 'fabric_weight', tags.fabric_weight)
      applyTagValue(next, 'visual_weight', tags.visual_weight)
      applyTagValue(next, 'opacity', tags.opacity)
      applyTagValue(next, 'needs_base', tags.needs_base)
      applyTagValue(next, 'fiber_content', tags.fiber_content)
      applyTagValue(next, 'formality', tags.formality)
      applyTagValue(next, 'heel_height', tags.heel_height)
      applyTagValue(next, 'walk_support', tags.walk_support)
      applyTagValue(next, 'stretch', tags.stretch)
      applyTagValue(next, 'tuck_behavior', tags.tuck_behavior)
      applyTagValue(next, 'waistband_type', tags.waistband_type)
      applyTagValue(next, 'accessory_subtype', tags.accessory_subtype)
      applyTagValue(next, 'bottom_subtype', tags.bottom_subtype)
      applyTagValue(next, 'shoe_type', tags.shoe_type)
      applyTagValue(next, 'toe_shape', tags.toe_shape)
      applyTagValue(next, 'outerwear_role', tags.outerwear_role)
      applyTagValue(next, 'weather_protection', tags.weather_protection)
      applyTagValue(next, 'jewelry_type', tags.jewelry_type)
      applyTagValue(next, 'necklace_length', tags.necklace_length)
      next.style_profile_json = mergeTagProfile(form.style_profile_json, tags.style_profile_json)
      if (tags.fit_on_body && tags.fit_on_body !== 'none') applyTagValue(next, 'fit_on_body', tags.fit_on_body)
      applyTagValue(next, 'tagger_version', tags.tagger_version)
      applyTagValue(next, 'tag_state', tags.tag_state || (wornFile || piece?.worn_photo ? 'fully_tagged' : 'provisional'))
      const changedCount = Object.keys(next).filter(key => JSON.stringify(next[key]) !== JSON.stringify(form[key])).length
      setForm(next)
      setDirty(true)
      const gapSummary = taxonomyGaps.length
        ? ` Unsupported ${taxonomyGaps.length === 1 ? 'shade' : 'shades'} ${taxonomyGaps.join(', ')} ${isEdit && !hangerFile ? 'were added' : 'will be added when you save'} to Retag suggestions and were not applied.`
        : ''
      setAiUpdateSummary((changedCount
        ? `AI updated ${changedCount} ${changedCount === 1 ? 'detail' : 'details'}. Review the fields before saving.`
        : 'AI found no new details to apply. Your protected edits were preserved.') + gapSummary)
      // Set confidence flags for medium/low fields
      const tagConfidence = tags.style_profile_json?._confidence || tags._confidence
      if (tagConfidence) {
        const flags = {}
        Object.entries(tagConfidence).forEach(([field, conf]) => {
          if (conf === 'medium' || conf === 'low') flags[field] = conf
        })
        setConfidenceFlags(flags)
      }
    } catch { setTagError('AI could not update the details. Your current edits are unchanged.') }
    finally { setTagging(false) }
  }

  const handleSubmit = async () => {
    if (!form.name.trim() || tagging) {
      if (!form.name.trim()) setSaveError('Add a name before saving.')
      return
    }
    setSaveError(null)
    setSaving(true)
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      if (v !== null && v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v)
    })
    fd.append('manual_overrides', JSON.stringify(manualOverrides))
    fd.append('resolved_retag_suggestion_ids', JSON.stringify(retagSuggestions.map(suggestion => suggestion.id)))
    fd.append('color_taxonomy_gaps', JSON.stringify(colorTaxonomyGaps))
    if (hangerFile)   fd.append('photo', hangerFile)
    else if (clearHanger) fd.append('clear_photo', 'true')
    if (wornFile)     fd.append('worn_photo', wornFile)
    else if (clearWorn)   fd.append('clear_worn_photo', 'true')
    try {
      const res = await fetch(isEdit ? `/api/pieces/${piece.id}` : '/api/pieces', {
        method: isEdit ? 'PUT' : 'POST', body: fd
      })
      const payload = await res.json()
      if (!res.ok || payload?.error) throw new Error(payload?.error || 'Save failed')
      setDirty(false)
      onSave(payload)
    } catch {
      setSaveError('Changes could not be saved. Nothing was discarded; please try again.')
    } finally { setSaving(false) }
  }

  const requestClose = () => {
    if (savingRef.current) return
    if (!dirtyRef.current || window.confirm('Discard your unsaved changes?')) onCancel()
  }

  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => { savingRef.current = saving }, [saving])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const previousFocus = document.activeElement
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = () => [...dialog.querySelectorAll(focusableSelector)]
    const initial = dialog.querySelector('[data-piece-form-initial-focus]') || focusables()[0]
    initial?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus?.()
    }
  }, [])

  // Helper: field label with confidence indicator
  const FieldLabel = ({ field, children, id }) => {
    const conf = confidenceFlags[field]
    const isGate = GATE_CRITICAL_FIELDS.includes(field)
    return (
      <div id={id} className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {children}
        {isGate && <span title="Gate-critical field" style={{ fontSize: 9, background: 'var(--accent-light)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 8 }}>gate</span>}
        {conf === 'low'    && <span title="AI unsure" style={{ fontSize: 9, background: '#E8A020', color: '#fff', padding: '1px 6px', borderRadius: 8, letterSpacing: '0.04em' }}>AI unsure</span>}
        {conf === 'medium' && <span style={{ fontSize: 9, background: 'var(--border)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 8 }}>review</span>}
      </div>
    )
  }

  const cat = form.category
  const constructionConfig = CONSTRUCTION_BY_CATEGORY[cat]
  const fabricConfig = FABRIC_BY_CATEGORY[cat] || FABRIC_BY_CATEGORY.default
  const showFitFields = CLOTHING_CATEGORIES.includes(cat)
  const showFormality = cat !== 'accessory'
  const missingGates = missingGateFields(form)
  const actionableMissingGates = missingGates.filter(field => field !== 'formality' || showFormality)
  const missingGateLabels = {
    formality: 'Formality',
    fabric_weight: 'Fabric weight',
    visual_weight: 'Visual weight',
    fiber_content: 'Fiber content',
    occasions: 'Occasions',
    heel_height: 'Heel height',
    walk_support: 'Walk support',
    accessory_subtype: 'Accessory type',
    bottom_subtype: 'Bottom type',
    shoe_type: 'Shoe type',
  }
  const revealMissingField = (field) => {
    const group = dialogRef.current?.querySelector(`[data-piece-field="${field}"]`)
    const disclosure = group?.closest('details')
    if (disclosure) disclosure.open = true
    requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector(`[data-piece-field="${field}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.querySelector('button, input, select, textarea')?.focus()
    })
  }
  const styleProfile = typeof form.style_profile_json === 'string'
    ? (() => { try { return JSON.parse(form.style_profile_json) || {} } catch { return {} } })()
    : (form.style_profile_json || {})
  const styleLanes = styleProfile?.style_lanes && typeof styleProfile.style_lanes === 'object'
    ? Object.entries(styleProfile.style_lanes)
      .map(([lane, score]) => [lane, Number(score)])
      .filter(([, score]) => Number.isFinite(score) && score > 0)
      .sort((a, b) => b[1] - a[1])
    : []
  const styleRoles = Array.isArray(styleProfile?.visual_roles) ? styleProfile.visual_roles : []
  const prettyProfileLabel = (value) => String(value || '').replace(/_/g, ' ')
  const garmentIntel = styleProfile?.garment_intelligence && typeof styleProfile.garment_intelligence === 'object'
    ? styleProfile.garment_intelligence
    : {}
  const profileList = (value) => normalizeProfileList(value)
  const styleRisk = styleProfile?.style_notes?.risk
  const rawFailureRisks = profileList(garmentIntel.failure_risks)
  const filteredFailureRisks = rawFailureRisks.filter(r => {
    if (!styleRisk) return true
    const rLower = r.toLowerCase().trim()
    const sLower = styleRisk.toLowerCase().trim()
    return !sLower.includes(rLower) && !rLower.includes(sLower)
  })
  const pairingRequirements = profileList(garmentIntel.pairing_requirements)
  const formulaCompatibility = profileList(garmentIntel.formula_compatibility)
  const doNotPairRules = profileList(garmentIntel.do_not_pair_rules)
  const styleReadPreview = (values) => (styleReadExpanded ? values : values.slice(0, 3)).join('; ')
  const hasMoreStyleRead = [
    pairingRequirements,
    filteredFailureRisks,
    formulaCompatibility,
    doNotPairRules,
  ].some(values => values.length > 3)
  const intelRows = [
    garmentIntel.auto_use_trust && ['Auto-use', prettyProfileLabel(garmentIntel.auto_use_trust)],
    garmentIntel.best_outfit_role && ['Best role', prettyProfileLabel(garmentIntel.best_outfit_role)],
    pairingRequirements.length > 0 && ['Needs', styleReadPreview(pairingRequirements)],
    filteredFailureRisks.length > 0 && ['Risks', styleReadPreview(filteredFailureRisks)],
    formulaCompatibility.length > 0 && ['Formulas', styleReadPreview(formulaCompatibility)],
    doNotPairRules.length > 0 && ['Avoid', styleReadPreview(doNotPairRules)],
  ].filter(Boolean)
  const realWearRows = Object.entries(garmentIntel.real_wear_notes || {}).filter(([, value]) => value)
  const occasionRows = Object.entries(garmentIntel.occasion_confidence || {}).filter(([, value]) => value)

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-sheet piece-form-sheet"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-handle piece-form-handle" />
        <div className="modal-header">
          <div>
            <div id={titleId} className="modal-title">{isEdit ? `Edit ${form.name || 'piece'}` : 'Add a piece'}</div>
            {isEdit && <div className="piece-form-header-meta">Piece #{piece.id} · {form.category}</div>}
            {!isEdit && <div className="piece-form-header-meta">Start with a photo or the details you already know.</div>}
          </div>
          <button type="button" className="modal-close" onClick={requestClose} aria-label="Close piece editor">✕</button>
        </div>

        <div className="form-body piece-form-layout">

          <aside className="piece-form-media-column">
            <div className="piece-form-section-intro">
              <span>Piece photos</span>
              {isEdit
                ? 'Keep the garment visible and evenly lit. A worn photo adds useful fit context.'
                : 'A clear hanger photo gives the stylist the best start. A worn photo is optional.'}
            </div>

          {/* ── Photos ──────────────────────────────────────────────── */}
          <div className="piece-form-photo-grid">
            <div className="piece-form-primary-photo">
              <PhotoSlot
                label="Hanger photo"
                hint={isEdit ? 'Ready to update with AI' : 'AI can fill the first draft'}
                preview={hangerPrev}
                onChange={e => { const f = e.target.files[0]; if (f) { setDirty(true); setHangerFile(f); setHangerPrev(URL.createObjectURL(f)); setClearHanger(false) } }}
                onClear={() => {
                  setDirty(true)
                  // Clearing a freshly-picked, not-yet-saved file is not the same as removing an
                  // already-saved photo — there's nothing on the server to mark for removal or
                  // offer to "restore." Only set clearHanger (the pending-removal/Restore
                  // affordance) when the photo actually being cleared is the saved one.
                  setHangerFile(null)
                  if (hangerFile) setHangerPrev(piece?.photo ? `/uploads/${piece.photo}` : null)
                  else setClearHanger(true)
                }}
                pendingRemoval={clearHanger}
                onRestore={() => { setClearHanger(false); setHangerPrev(piece?.photo ? `/uploads/${piece.photo}` : null) }}
                onPreview={() => hangerPrev && setPreviewImage({ src: hangerPrev, title: form.name || 'Piece', meta: 'Hanger photo' })}
              />
              {!isEdit && hangerFile && (
                <div className="piece-form-ai-action">
                  <button type="button" onClick={handleTagThis} disabled={tagging || saving} className="piece-form-ai-button">
                    {tagging
                      ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Tagging…</>
                      : '◇ Fill details with AI'}
                  </button>
                  <div className="piece-form-ai-help">AI prepares a first draft from your photo. Review it before adding the piece.</div>
                  {tagError && <div className="piece-form-status piece-form-status-error" role="alert">{tagError}</div>}
                  {aiUpdateSummary && <div className="piece-form-status" role="status">{aiUpdateSummary}</div>}
                </div>
              )}
            </div>
            <PhotoSlot
              label="Worn photo"
              hint="Adds fit and drape context for the stylist"
              preview={wornPrev}
              onChange={e => { const f = e.target.files[0]; if (f) { setDirty(true); setWornFile(f); setWornPrev(URL.createObjectURL(f)); setClearWorn(false) } }}
              onClear={() => {
                setDirty(true)
                // Same reasoning as the hanger slot above: clearing a freshly-picked file that
                // was never saved is not a removal of anything real.
                setWornFile(null)
                if (wornFile) setWornPrev(piece?.worn_photo ? `/uploads/${piece.worn_photo}` : null)
                else setClearWorn(true)
              }}
              pendingRemoval={clearWorn}
              onRestore={() => { setClearWorn(false); setWornPrev(piece?.worn_photo ? `/uploads/${piece.worn_photo}` : null) }}
              onPreview={() => wornPrev && setPreviewImage({ src: wornPrev, title: form.name || 'Piece', meta: 'Worn photo' })}
            />
          </div>

          {/* Tag This button */}
          {isEdit && ((piece?.photo && hangerPrev && !clearHanger) || (piece?.worn_photo && wornPrev && !clearWorn) || hangerFile || wornFile) && (
            <div>
              <button type="button" onClick={handleTagThis} disabled={tagging || saving} className="piece-form-ai-button">
                {tagging
                  ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Tagging…</>
                  : '◇ Update details with AI'}
              </button>
              <div className="piece-form-ai-help">
                AI suggestions remain reviewable until you save. Owner-edited fields stay protected.
              </div>
              {tagError && <div className="piece-form-status piece-form-status-error" role="alert">{tagError}</div>}
              {aiUpdateSummary && <div className="piece-form-status" role="status">{aiUpdateSummary}</div>}
            </div>
          )}

          </aside>

          <div className="piece-form-fields-column">
            <div className="piece-form-section-intro">
              <span>{isEdit ? 'Piece details' : 'Describe the piece'}</span>
              {isEdit
                ? 'Start with what you know. Add only what helps your stylist use this piece well.'
                : 'Name it, place it in your wardrobe, and refine only what matters today.'}
            </div>

          {retagSuggestions.length > 0 && (
            <div className="piece-form-retag-banner">
              <strong>Retag suggested</strong>
              <span>Review the highlighted garment fields. Saving resolves these suggestions; no values have been changed automatically.</span>
              {retagSuggestions.map(suggestion => <small key={suggestion.id}>{suggestion.description}</small>)}
            </div>
          )}

          {/* ── Basics ──────────────────────────────────────────────── */}
          <Section label="Basics" />

          {isEdit && actionableMissingGates.length > 0 && (
            <div className="piece-form-completeness" role="status">
              <span>Add for better outfit suggestions:</span>
              <div className="piece-form-completeness-links">
                {actionableMissingGates.map(field => (
                  <button type="button" key={field} onClick={() => revealMissingField(field)}>
                    {missingGateLabels[field] || field.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="piece-form-name">Name</label>
            <input
              id="piece-form-name"
              data-piece-form-initial-focus
              className="form-input"
              aria-required="true"
              aria-invalid={Boolean(saveError && !form.name.trim())}
              aria-describedby={!isEdit ? 'piece-form-name-help' : undefined}
              placeholder="e.g. Bold multicolor floral knit top"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
            {!isEdit && <div id="piece-form-name-help" className="piece-form-field-help">Required to add this garment.</div>}
          </div>

          <div className="form-group">
            <div id="piece-form-category-label" className="form-label">Category</div>
            <ChipRow labelledBy="piece-form-category-label" options={CATEGORIES} value={form.category} clearable={false} onChange={v => set('category', v || form.category)} />
          </div>

          <div className="form-group">
            <div id="piece-form-colors-label" className="form-label">Colors</div>
            <ColorEditor value={form.colors} onChange={value => set('colors', value)} labelledBy="piece-form-colors-label" />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="piece-form-background-color">Background color <span style={{ fontSize: 12, color: 'var(--text-light)', fontStyle: 'italic', fontWeight: 400 }}>literal base color of the garment</span></label>
            <input id="piece-form-background-color" className="form-input" placeholder="e.g. black, navy, cream" value={form.background_color} onChange={e => set('background_color', e.target.value)} />
          </div>

          <div className="form-group" data-piece-field="occasions">
            <FieldLabel id="piece-form-occasions-label" field="occasions">Occasions</FieldLabel>
            <ChipRow labelledBy="piece-form-occasions-label" options={OCCASIONS} value={form.occasions} onChange={v => set('occasions', v)} multi />
          </div>

          {!(form.category === 'accessory' && form.accessory_subtype === 'jewelry') && (
          <div className="form-group">
            <div id="piece-form-season-label" className="form-label">Season</div>
            <div className="radio-row" role="group" aria-labelledby="piece-form-season-label">
              {SEASONS.map(s => <button type="button" key={s} aria-pressed={form.season === s} className={`radio-btn ${form.season === s ? 'active' : ''}`} onClick={() => set('season', s)}>{s}</button>)}
            </div>
          </div>
          )}

          {isEdit && (
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}

          {/* ── Stylist controls ───────────────────────────────────── */}
          {isEdit && <details ref={stylistControlsRef} className="piece-form-disclosure">
            <summary>
              <span>Stylist controls</span>
              <small>Advanced recommendation behavior and AI interpretation</small>
            </summary>
            <div className="piece-form-disclosure-body">

          <div className="form-group">
            <label className="form-label">Auto-recommendation status</label>
            <select className="form-select" value={form.recommendation_status} onChange={e => set('recommendation_status', e.target.value)}>
              {RECOMMENDATION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Fit confidence</label>
            <ChipRow options={FIT_CONFIDENCE} value={form.fit_confidence} onChange={v => set('fit_confidence', v || 'unknown')} />
          </div>

          {showFormality && (
            <div className="form-group" data-piece-field="formality">
              <FieldLabel field="formality">Formality</FieldLabel>
              <ChipRow options={FORMALITY_OPTIONS} value={form.formality} onChange={v => set('formality', v)} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Auto-styling role</label>
            <select className="form-select" value={form.role_permission} onChange={e => set('role_permission', e.target.value)}>
              {ROLE_PERMISSIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Allowed auto occasions <span style={{ fontSize: 10, color: 'var(--text-light)', fontStyle: 'italic', fontWeight: 400 }}>empty = any occasion</span></label>
            <ChipRow options={OCCASIONS} value={form.occasion_permissions} onChange={v => set('occasion_permissions', v)} multi />
          </div>

          <div className="form-group">
            <label className="form-label">Engine notes <span style={{ fontSize: 10, color: 'var(--text-light)', fontStyle: 'italic', fontWeight: 400 }}>private instructions for auto styling</span></label>
            <textarea className="form-textarea" placeholder="e.g. too small; do not use as a focal evening garment" value={form.engine_notes} onChange={e => set('engine_notes', e.target.value)} style={{ minHeight: 72 }} />
          </div>

          {(styleLanes.length > 0 || styleRoles.length > 0 || styleProfile?.style_notes?.best_use || styleProfile?.style_notes?.risk || intelRows.length > 0 || realWearRows.length > 0 || occasionRows.length > 0) && (
            <div className="form-group" style={{
              padding: 12,
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
            }}>
              <label className="form-label" style={{ marginBottom: 8 }}>AI style read</label>
              {styleLanes.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {styleLanes.map(([lane, score]) => (
                    <span key={lane} style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      border: '1px solid var(--border)',
                      background: score >= 4 ? 'var(--accent-light)' : 'var(--surface)',
                      color: score >= 4 ? 'var(--accent)' : 'var(--text-muted)',
                      fontSize: 11,
                    }}>
                      {prettyProfileLabel(lane)} {score}/5
                    </span>
                  ))}
                </div>
              )}
              {styleRoles.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text)' }}>Roles:</strong> {styleRoles.map(prettyProfileLabel).join(', ')}
                </div>
              )}
              {styleProfile?.style_notes?.best_use && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text)' }}>Best use:</strong> {styleProfile.style_notes.best_use}
                </div>
              )}
              {styleProfile?.style_notes?.risk && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text)' }}>Risk:</strong> {styleProfile.style_notes.risk}
                </div>
              )}
              {intelRows.map(([label, value]) => (
                <div key={label} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text)' }}>{label}:</strong> {value}
                </div>
              ))}
              {hasMoreStyleRead && (
                <button
                  type="button"
                  className="piece-style-read-toggle"
                  onClick={() => setStyleReadExpanded(expanded => !expanded)}
                  aria-expanded={styleReadExpanded}
                >
                  {styleReadExpanded ? 'Show less' : 'Show all AI insights'}
                  <span aria-hidden="true">{styleReadExpanded ? '↑' : '↓'}</span>
                </button>
              )}
              {realWearRows.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <strong style={{ color: 'var(--text)' }}>Real wear:</strong> {realWearRows.map(([key, value]) => `${prettyProfileLabel(key)}: ${value}`).join('; ')}
                </div>
              )}
              {occasionRows.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                  {occasionRows.map(([occasion, value]) => (
                    <span key={occasion} style={{
                      padding: '3px 7px',
                      borderRadius: 999,
                      border: '1px solid var(--border-light)',
                      background: value === 'high' ? 'var(--surface)' : 'var(--surface-2)',
                      color: 'var(--text-muted)',
                      fontSize: 10,
                    }}>{prettyProfileLabel(occasion)} {value}</span>
                  ))}
                </div>
              )}
            </div>
          )}
            </div>
          </details>}

          {/* ── Pattern & Visual ─────────────────────────────────────── */}
          <details ref={garmentCharacterRef} className="piece-form-disclosure">
            <summary>
              <span>{isEdit ? 'Garment character' : 'Refine garment details'}</span>
              <small>{isEdit ? 'Pattern, construction, material, and silhouette' : 'Optional pattern, material, and silhouette details'}</small>
            </summary>
            <div className="piece-form-disclosure-body">

          {cat === 'accessory' && (
            <>
              <Section label="Accessory type" />

              <div className="form-group" data-piece-field="accessory_subtype">
                <FieldLabel field="accessory_subtype">Type</FieldLabel>
                <ChipRow options={ACCESSORY_SUBTYPE_OPTIONS} value={form.accessory_subtype} onChange={v => set('accessory_subtype', v)} />
              </div>

              {form.accessory_subtype === 'jewelry' && (
                <div className="form-group" data-piece-field="jewelry_type">
                  <FieldLabel field="jewelry_type">Jewelry Type</FieldLabel>
                  <ChipRow options={JEWELRY_TYPE_OPTIONS} value={form.jewelry_type} onChange={v => set('jewelry_type', v)} />
                </div>
              )}

              {form.accessory_subtype === 'jewelry' && form.jewelry_type === 'necklace' && (
                <div className="form-group" data-piece-field="necklace_length">
                  <FieldLabel field="necklace_length">Necklace Length</FieldLabel>
                  <ChipRow options={NECKLACE_LENGTH_OPTIONS} value={form.necklace_length} onChange={v => set('necklace_length', v)} />
                </div>
              )}
            </>
          )}

          {/* Jewelry (necklace, earrings, bracelet, ring, pin) has no meaningful pattern —
              skip the whole chip wall rather than showing fields that always resolve to
              solid/none. reads_as stays: it's one free-text field, not a wall of options,
              and "delicate gold minimalist" is still a real visual read for a necklace. */}
          {!(cat === 'accessory' && form.accessory_subtype === 'jewelry') && (
            <>
              <Section label="Pattern & Visual" />

              <div className="form-group">
                <label className="form-label">Pattern type</label>
                <ChipRow options={['solid','floral','botanical','stripe','polka_dot','check','plaid','geometric','abstract','animal','graphic','paisley','patchwork','other']} value={form.pattern_type} onChange={v => set('pattern_type', v)} />
              </div>

              <div className="form-group">
                <label className="form-label">Pattern scale</label>
                <ChipRow options={['none','subtle','medium','bold']} value={form.pattern_scale} onChange={v => set('pattern_scale', v)} />
              </div>

              <div className="form-group">
                <FieldLabel field="pattern_complexity">
                  Pattern complexity
                  <span style={{ fontSize: 10, color: 'var(--text-light)', marginLeft: 6, fontStyle: 'italic', fontWeight: 400 }}>solid / quiet 1–2 colors / medium 2–3 / loud 3+</span>
                </FieldLabel>
                <ChipRow options={['solid','quiet','medium','loud']} value={form.pattern_complexity} onChange={v => set('pattern_complexity', v)} />
              </div>
            </>
          )}

          <div className="form-group">
            <FieldLabel field="reads_as">
              Reads as
              <span style={{ fontSize: 10, color: 'var(--text-light)', marginLeft: 6, fontStyle: 'italic', fontWeight: 400 }}>visual impression — overrides color tags</span>
            </FieldLabel>
            <input className="form-input" placeholder='e.g. "bold warm multicolor statement" or "quiet dark neutral"' value={form.reads_as} onChange={e => set('reads_as', e.target.value)} />
          </div>

          {/* ── Construction ─────────────────────────────────────────── */}
          {constructionConfig && (
            <>
              <Section label={constructionConfig.sectionLabel} />

              {constructionConfig.showNeckline && (
                <div className="form-group">
                  <label className="form-label">Neckline</label>
                  <ChipRow options={['V','scoop','crew','boat','mock','turtleneck','cowl','off-shoulder','square','wrap','halter','strapless','one-shoulder','collared','shawl','other','unknown']} value={form.neckline} onChange={v => set('neckline', v)} />
                </div>
              )}

              {constructionConfig.showSleeve && (
                <div className={`form-group ${suggestedFields.has('sleeve_length') ? 'retag-field-highlight' : ''}`} data-piece-field="sleeve_length">
                  <label className="form-label">Sleeve Length {suggestedFields.has('sleeve_length') && <span className="retag-review-marker">Review suggested</span>}</label>
                  <ChipRow options={['sleeveless','cap','short','elbow','3/4','long','extra_long','unknown']} value={form.sleeve_length} onChange={v => set('sleeve_length', v)} />
                </div>
              )}

              {constructionConfig.showSleeve && form.sleeve_length !== 'sleeveless' && (
                <div className={`form-group ${suggestedFields.has('sleeve_shape') ? 'retag-field-highlight' : ''}`} data-piece-field="sleeve_shape">
                  <label className="form-label">Sleeve Shape {suggestedFields.has('sleeve_shape') && <span className="retag-review-marker">Review suggested</span>}</label>
                  <ChipRow options={['fitted','straight','relaxed','puff','bishop','bell','flutter','raglan','dolman','other','unknown']} value={form.sleeve_shape} onChange={v => set('sleeve_shape', v)} />
                </div>
              )}

              {cat === 'bottom' && (
                <div className={`form-group ${suggestedFields.has('bottom_subtype') ? 'retag-field-highlight' : ''}`} data-piece-field="bottom_subtype">
                  <FieldLabel field="bottom_subtype">Bottom Type {suggestedFields.has('bottom_subtype') && <span className="retag-review-marker">Review suggested</span>}</FieldLabel>
                  <ChipRow options={BOTTOM_SUBTYPE_OPTIONS} value={form.bottom_subtype} onChange={v => set('bottom_subtype', v)} />
                </div>
              )}

              {cat === 'outerwear' && (
                <div className={`form-group ${suggestedFields.has('outerwear_role') ? 'retag-field-highlight' : ''}`} data-piece-field="outerwear_role">
                  <FieldLabel field="outerwear_role">
                    Outerwear Role
                    <InfoTooltip className="outerwear-info-tooltip" label="What outerwear role means" size="sm" align="left" width={260}>
                      <div>Describes what this layer is functionally suited to do — not how warm it is.</div>
                      <div><strong>Indoor layer</strong> — light layering, mostly indoors</div>
                      <div><strong>Transition layer</strong> — outer layer for mild/cool weather</div>
                      <div><strong>Protective shell</strong> — wind/rain protection, not necessarily warm</div>
                      <div><strong>Cold-weather outerwear</strong> — substantial outer layer for genuinely cold weather</div>
                    </InfoTooltip>
                    {suggestedFields.has('outerwear_role') && <span className="retag-review-marker">Review suggested</span>}
                  </FieldLabel>
                  <ChipRow options={OUTERWEAR_ROLE_OPTIONS} value={form.outerwear_role} onChange={v => set('outerwear_role', v)} />
                </div>
              )}

              {cat === 'outerwear' && (
                <div className={`form-group ${suggestedFields.has('weather_protection') ? 'retag-field-highlight' : ''}`} data-piece-field="weather_protection">
                  <FieldLabel field="weather_protection">
                    Weather Protection
                    <InfoTooltip className="outerwear-info-tooltip" label="What weather protection means" size="sm" align="left" width={260}>
                      <div>Which specific hazard this layer reliably protects against, if any — separate from its role above.</div>
                      <div>Leave both unchecked if the piece doesn't clearly protect against rain or wind (this is normal for most pieces).</div>
                    </InfoTooltip>
                    {suggestedFields.has('weather_protection') && <span className="retag-review-marker">Review suggested</span>}
                  </FieldLabel>
                  <ChipRow options={WEATHER_PROTECTION_OPTIONS} value={form.weather_protection} onChange={v => set('weather_protection', v)} multi />
                </div>
              )}

              {cat !== 'shoes' && (
                <div className="form-group">
                  <FieldLabel field="silhouette">{constructionConfig.silhouetteLabel}</FieldLabel>
                  <ChipRow
                    options={cat === 'bottom'
                      ? (form.bottom_subtype === 'skirt' ? BOTTOM_SKIRT_SILHOUETTE_OPTIONS : BOTTOM_PANTS_SILHOUETTE_OPTIONS)
                      : constructionConfig.silhouetteOptions}
                    value={form.silhouette}
                    onChange={v => set('silhouette', v)}
                  />
                </div>
              )}

              {cat === 'shoes' && (
                <>
                  <div className={`form-group ${suggestedFields.has('shoe_type') ? 'retag-field-highlight' : ''}`} data-piece-field="shoe_type">
                    <FieldLabel field="shoe_type">Shoe Type {suggestedFields.has('shoe_type') && <span className="retag-review-marker">Review suggested</span>}</FieldLabel>
                    <ChipRow options={SHOE_TYPE_OPTIONS} value={form.shoe_type} onChange={v => set('shoe_type', v)} />
                  </div>

                  <div className={`form-group ${suggestedFields.has('toe_shape') ? 'retag-field-highlight' : ''}`} data-piece-field="toe_shape">
                    <FieldLabel field="toe_shape">Toe Shape {suggestedFields.has('toe_shape') && <span className="retag-review-marker">Review suggested</span>}</FieldLabel>
                    <ChipRow options={TOE_SHAPE_OPTIONS} value={form.toe_shape} onChange={v => set('toe_shape', v)} />
                  </div>
                </>
              )}

              <div className={`form-group ${suggestedFields.has('length_hits_at') ? 'retag-field-highlight' : ''}`}>
                <label className="form-label">{constructionConfig.lengthLabel} {suggestedFields.has('length_hits_at') && <span className="retag-review-marker">Review suggested</span>}</label>
                <ChipRow
                  options={cat === 'bottom'
                    ? (form.bottom_subtype === 'skirt' ? BOTTOM_SKIRT_LENGTH_OPTIONS : BOTTOM_PANTS_LENGTH_OPTIONS)
                    : constructionConfig.lengthOptions}
                  value={form.length_hits_at}
                  onChange={v => set('length_hits_at', v)}
                />
              </div>

              {constructionConfig.hemOptions && (
                <div className="form-group">
                  <label className="form-label">
                    {constructionConfig.hemLabel}
                    {constructionConfig.hemHint && <span style={{ fontSize: 10, color: 'var(--text-light)', marginLeft: 6, fontStyle: 'italic', fontWeight: 400 }}>{constructionConfig.hemHint}</span>}
                  </label>
                  <ChipRow
                    options={constructionConfig.hemOptions}
                    value={form.hem_finish}
                    onChange={v => set('hem_finish', v)}
                  />
                </div>
              )}
            </>
          )}

          {/* ── Fabric ───────────────────────────────────────────────── */}
          <Section label={fabricConfig.sectionLabel} />

          <div className="form-group">
            <FieldLabel field="fabric_category">
              {fabricConfig.fabricLabel}
              {(cat === 'shoes' || cat === 'accessory') && <span style={{ fontSize: 10, color: 'var(--text-light)', marginLeft: 6, fontStyle: 'italic', fontWeight: 400 }}>one value — for a mix (e.g. metal + stone), also check Material Properties below</span>}
            </FieldLabel>
            <ChipRow options={fabricConfig.fabricOptions} value={form.fabric_category} onChange={v => set('fabric_category', v)} />
          </div>

          <div className="form-group" data-piece-field={cat === 'shoes' || cat === 'accessory' ? 'visual_weight' : 'fabric_weight'}>
            <FieldLabel field={cat === 'shoes' || cat === 'accessory' ? 'visual_weight' : 'fabric_weight'}>{fabricConfig.weightLabel}</FieldLabel>
            {cat === 'shoes' || cat === 'accessory'
              ? <ChipRow options={fabricConfig.weightOptions} value={form.visual_weight} onChange={v => set('visual_weight', v)} />
              : <ChipRow options={fabricConfig.weightOptions} value={form.fabric_weight} onChange={v => set('fabric_weight', v)} />
            }
          </div>

          {form.category !== 'shoes' && form.category !== 'accessory' && (
            <div className="form-group">
              <FieldLabel field="opacity">Opacity</FieldLabel>
              <ChipRow options={OPACITY_OPTIONS} value={form.opacity} onChange={v => set('opacity', v)} />
            </div>
          )}

          {form.category !== 'shoes' && form.category !== 'accessory' && (
            <div className="form-group">
              <FieldLabel field="needs_base">Needs a base layer</FieldLabel>
              <ChipRow options={NEEDS_BASE_OPTIONS} value={form.needs_base} onChange={v => set('needs_base', v)} />
            </div>
          )}

          <div className="form-group" data-piece-field="fiber_content">
            <FieldLabel field="fiber_content">{cat === 'shoes' || cat === 'accessory' ? 'Material properties' : 'Fiber content'}</FieldLabel>
            <ChipRow options={FIBER_OPTIONS} value={form.fiber_content} onChange={v => set('fiber_content', v)} multi />
          </div>

          {fabricConfig.showStretch && (
            <div className="form-group">
              <FieldLabel field="stretch">Stretch</FieldLabel>
              <ChipRow options={['none','minimal','moderate','stretchy']} value={form.stretch} onChange={v => set('stretch', v)} />
            </div>
          )}

          {cat === 'shoes' && (
            <>
              <div className="form-group" data-piece-field="heel_height">
                <FieldLabel field="heel_height">Heel height</FieldLabel>
                <ChipRow options={HEEL_HEIGHT_OPTIONS} value={form.heel_height} onChange={v => set('heel_height', v)} />
              </div>

              <div className="form-group" data-piece-field="walk_support">
                <FieldLabel field="walk_support">Walk support</FieldLabel>
                <ChipRow options={WALK_SUPPORT_OPTIONS} value={form.walk_support} onChange={v => set('walk_support', v)} />
              </div>
            </>
          )}

            </div>
          </details>

          {/* ── Fit ──────────────────────────────────────────────────── */}
          {showFitFields && (isEdit ? (
            <>
              <Section label="Fit on body" />

              <div className="form-group">
                <label className="form-label">How does it fit?</label>
                <ChipRow
                  options={[
                    { value: 'clings_stretchy', label: 'clings (stretchy)' },
                    { value: 'clings_drapey',   label: 'clings (drapey)' },
                    { value: 'skims',           label: 'skims' },
                    { value: 'hangs_straight',  label: 'hangs straight' },
                    { value: 'drapes',          label: 'drapes/flowy' },
                    { value: 'structured',      label: 'structured' },
                  ]}
                  value={form.fit_on_body}
                  onChange={v => set('fit_on_body', v)}
                />
              </div>

              {isTop(cat) && (
                <div className="form-group">
                  <label className="form-label">Tuck behavior</label>
                  <ChipRow
                    options={[
                      { value: 'tucks_anywhere',        label: 'tucks freely' },
                      { value: 'tucks_with_structure',  label: 'needs structured waist/belt' },
                      { value: 'wear_over_only',         label: 'wear over only' },
                    ]}
                    value={form.tuck_behavior}
                    onChange={v => set('tuck_behavior', v)}
                  />
                </div>
              )}

              {isBottom(cat) && (
                <div className="form-group">
                  <label className="form-label">Waistband</label>
                  <ChipRow
                    options={[
                      { value: 'structured_high_waist', label: 'structured high' },
                      { value: 'structured_mid_waist',  label: 'structured mid' },
                      { value: 'structured_low_waist',  label: 'structured low' },
                      { value: 'soft_elastic_pull_on',  label: 'soft elastic' },
                      { value: 'tight_no_room',          label: 'tight - no tuck' },
                      { value: 'drawstring_relaxed',     label: 'drawstring' },
                    ]}
                    value={form.waistband_type}
                    onChange={v => set('waistband_type', v)}
                  />
                </div>
              )}
            </>
          ) : (
            <details className="piece-form-disclosure">
              <summary>
                <span>Fit and wear</span>
                <small>Optional details that help the stylist combine it well</small>
              </summary>
              <div className="piece-form-disclosure-body">
                <div className="form-group">
                  <label className="form-label">How does it fit?</label>
                  <ChipRow
                    options={[
                      { value: 'clings_stretchy', label: 'clings (stretchy)' },
                      { value: 'clings_drapey',   label: 'clings (drapey)' },
                      { value: 'skims',           label: 'skims' },
                      { value: 'hangs_straight',  label: 'hangs straight' },
                      { value: 'drapes',           label: 'drapes/flowy' },
                      { value: 'structured',       label: 'structured' },
                    ]}
                    value={form.fit_on_body}
                    onChange={v => set('fit_on_body', v)}
                  />
                </div>
                {isTop(cat) && (
                  <div className="form-group">
                    <label className="form-label">Tuck behavior</label>
                    <ChipRow
                      options={[
                        { value: 'tucks_anywhere', label: 'tucks freely' },
                        { value: 'tucks_with_structure', label: 'needs structured waist/belt' },
                        { value: 'wear_over_only', label: 'wear over only' },
                      ]}
                      value={form.tuck_behavior}
                      onChange={v => set('tuck_behavior', v)}
                    />
                  </div>
                )}
                {isBottom(cat) && (
                  <div className="form-group">
                    <label className="form-label">Waistband</label>
                    <ChipRow
                      options={[
                        { value: 'structured_high_waist', label: 'structured high' },
                        { value: 'structured_mid_waist', label: 'structured mid' },
                        { value: 'structured_low_waist', label: 'structured low' },
                        { value: 'soft_elastic_pull_on', label: 'soft elastic' },
                        { value: 'tight_no_room', label: 'tight - no tuck' },
                        { value: 'drawstring_relaxed', label: 'drawstring' },
                      ]}
                      value={form.waistband_type}
                      onChange={v => set('waistband_type', v)}
                    />
                  </div>
                )}
              </div>
            </details>
          ))}

          {/* ── Styling Rules ────────────────────────────────────────── */}
          {isEdit && <details className="piece-form-disclosure">
            <summary>
              <span>What the stylist should remember</span>
              <small>What works, what does not, and protected owner corrections</small>
            </summary>
            <div className="piece-form-disclosure-body">

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Rules learned
              <span style={{ fontSize: 10, color: 'var(--text-light)', fontStyle: 'italic', fontWeight: 400 }}>authoritative — stylist follows these first</span>
            </label>
            <RuleList
              rules={form.styling_rules_learned}
              exclusions={exclusions}
              onRestore={isEdit ? restoreOccasion : null}
              restoring={restoringOccasion}
              onChange={v => set('styling_rules_learned', v)}
              placeholder="e.g. needs flow on bottom, silk — wear over only, always with amber pendant"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Tried and rejected</label>
            <RuleList
              rules={form.tried_and_rejected}
              onChange={v => set('tried_and_rejected', v)}
              placeholder="e.g. grey wide-leg — too much volume both top and bottom"
              color="repair"
            />
          </div>

          {manualOverrides.length > 0 && (
            <div className="form-group">
              <label className="form-label">Protected edits</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {manualOverrides.map(path => (
                  <button
                    key={path}
                    type="button"
                    className="chip-toggle active"
                    onClick={() => clearManualOverride(path)}
                    title="Click to let AI update this field again"
                    style={{ fontSize: 11, textTransform: 'none' }}
                  >
                    {path.replace(/_/g, ' ')} ×
                  </button>
                ))}
              </div>
            </div>
          )}
            </div>
          </details>}

          {/* ── Notes ────────────────────────────────────────────────── */}
          {isEdit ? (
            <>
              <Section label="Notes" />
              <div className="form-group">
                <label className="form-label">Styling notes</label>
                <textarea className="form-textarea" placeholder="Anything you've learned about how to wear this piece…" value={form.notes} onChange={e => set('notes', e.target.value)} style={{ minHeight: 100 }} />
              </div>
            </>
          ) : (
            <details className="piece-form-disclosure">
              <summary>
                <span>Add a note</span>
                <small>Optional context the photo cannot show</small>
              </summary>
              <div className="piece-form-disclosure-body">
                <div className="form-group">
                  <label className="form-label">Styling notes</label>
                  <textarea className="form-textarea" placeholder="Anything useful to remember about wearing this piece…" value={form.notes} onChange={e => set('notes', e.target.value)} style={{ minHeight: 100 }} />
                </div>
              </div>
            </details>
          )}

          </div>

        </div>

        <div className="form-actions">
          <div className="piece-form-save-state" role="status">
            {saveError || (!isEdit && !form.name.trim()
              ? 'Add a name to continue'
              : !isEdit
                ? 'Ready to add'
                : dirty ? 'Unsaved changes' : 'No unsaved changes')}
          </div>
          <button type="button" className="btn-secondary" onClick={requestClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={saving || tagging || !form.name.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add piece'}
          </button>
        </div>
      </div>
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="image-preview-overlay"
          onClick={e => {
            e.stopPropagation()
            setPreviewImage(null)
          }}
        >
          <div className="image-preview-dialog" onClick={e => e.stopPropagation()}>
            <div className="image-preview-header">
              <div style={{ minWidth: 0 }}>
                <div className="image-preview-title">{previewImage.title}</div>
                {previewImage.meta && <div className="image-preview-meta">{previewImage.meta}</div>}
              </div>
              <button className="chip" onClick={() => setPreviewImage(null)}>Close</button>
            </div>
            <img className="image-preview-img" src={previewImage.src} alt={previewImage.title} />
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
