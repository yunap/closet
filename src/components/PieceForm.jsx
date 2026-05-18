import { useState } from 'react'

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
const COLOR_OPTIONS = [
  { name: 'black',      hex: '#2A2420' }, { name: 'white',      hex: '#F5F2EC' },
  { name: 'cream',      hex: '#E8DFC8' }, { name: 'beige',      hex: '#D6C3A3' },
  { name: 'taupe',      hex: '#9C8B78' }, { name: 'grey',       hex: '#9A9A9A' },
  { name: 'charcoal',   hex: '#484848' }, { name: 'navy',       hex: '#1E2D4A' },
  { name: 'denim',      hex: '#4F6F8F' }, { name: 'brown',      hex: '#7A5A3A' },
  { name: 'tan',        hex: '#C0A070' }, { name: 'oatmeal',    hex: '#D8C8B0' },
  { name: 'amber',      hex: '#B07820' }, { name: 'mustard',    hex: '#B89020' },
  { name: 'orange',     hex: '#C86030' }, { name: 'red',        hex: '#A83A2A' },
  { name: 'pink',       hex: '#C07080' }, { name: 'plum',       hex: '#5A3060' },
  { name: 'green',      hex: '#3A6A3A' }, { name: 'olive',      hex: '#5A6030' },
  { name: 'turquoise',  hex: '#2A8080' }, { name: 'light blue', hex: '#7AADCC' },
  { name: 'periwinkle', hex: '#8888CC' }, { name: 'dark blue',  hex: '#1A2040' },
  { name: 'dark grey',  hex: '#484848' }, { name: 'light grey', hex: '#B8B8B8' },
  { name: 'multi',      hex: '#8A6848' },
]
const LIGHT_COLORS = ['white', 'cream', 'beige', 'oatmeal', 'light grey', 'light blue']

const CLOTHING_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear']

const CONSTRUCTION_BY_CATEGORY = {
  top: {
    sectionLabel: 'Construction',
    showNeckline: true,
    showSleeve: true,
    silhouetteLabel: 'Silhouette',
    silhouetteOptions: ['fitted','slim','relaxed','boxy','drop-shoulder','oversized','peplum','wrap'],
    lengthLabel: 'Length hits at',
    lengthOptions: ['crop','waist','hip','tunic','mid-thigh'],
    hemLabel: 'Hem finish',
    hemHint: 'determines tuck ability',
    hemOptions: [
      { value: 'straight_loose', label: 'straight - tuckable' },
      { value: 'banded_elastic', label: 'banded/elastic' },
      { value: 'ribbed',         label: 'ribbed - wear over' },
      { value: 'design_hem',     label: 'design hem - wear over' },
    ],
  },
  bottom: {
    sectionLabel: 'Construction',
    silhouetteLabel: 'Bottom shape',
    silhouetteOptions: ['straight leg','wide leg','bootcut','flare','tapered','barrel','A-line skirt','pencil skirt','full skirt','slip skirt','relaxed','structured'],
    lengthLabel: 'Length',
    lengthOptions: ['short','above-knee','knee','midi','maxi','ankle','full-length','cropped'],
    hemLabel: 'Hem / leg opening',
    hemOptions: [
      { value: 'straight_loose', label: 'straight/open' },
      { value: 'cuffed', label: 'cuffed' },
      { value: 'raw', label: 'raw/frayed' },
      { value: 'tapered', label: 'tapered' },
      { value: 'banded_elastic', label: 'elastic/banded' },
      { value: 'slit', label: 'slit' },
      { value: 'asymmetrical', label: 'asymmetrical' },
      { value: 'design_hem', label: 'design hem' },
    ],
  },
  dress: {
    sectionLabel: 'Construction',
    showNeckline: true,
    silhouetteLabel: 'Dress shape',
    silhouetteOptions: ['fitted','sheath','shift','A-line','wrap','slip','column','fit-and-flare','relaxed'],
    lengthLabel: 'Length',
    lengthOptions: ['mini','above-knee','knee','midi','maxi'],
  },
  outerwear: {
    sectionLabel: 'Construction',
    showSleeve: true,
    silhouetteLabel: 'Outerwear shape',
    silhouetteOptions: ['cropped','fitted','boxy','relaxed','oversized','structured','longline'],
    lengthLabel: 'Length hits at',
    lengthOptions: ['waist','hip','mid-thigh','knee','longline'],
  },
  shoes: {
    sectionLabel: 'Shoe Details',
    silhouetteLabel: 'Shoe shape',
    silhouetteOptions: ['pointed','almond','round','square','open-toe','mule','loafer','boot','sandal','heel','flat','sneaker'],
    lengthLabel: 'Coverage / shaft',
    lengthOptions: ['open','closed','ankle','mid-calf','knee','over-knee'],
  },
}

const FABRIC_BY_CATEGORY = {
  shoes: {
    sectionLabel: 'Material',
    fabricLabel: 'Material',
    fabricOptions: ['leather','suede','patent','canvas','mesh','synthetic','textile','rubber','other'],
    weightLabel: 'Visual weight',
    weightOptions: ['delicate','slim','medium','chunky'],
    showStretch: false,
  },
  accessory: {
    sectionLabel: 'Material',
    fabricLabel: 'Material',
    fabricOptions: ['leather','suede','metal','straw','canvas','synthetic','textile','rubber','other'],
    weightLabel: 'Visual weight',
    weightOptions: ['delicate','slim','medium','chunky'],
    showStretch: false,
  },
  default: {
    sectionLabel: 'Fabric',
    fabricLabel: 'Fabric',
    fabricOptions: ['jersey','knit','linen','silk','satin','cotton','wool','denim','ponte','synthetic','fleece','other'],
    weightLabel: 'Weight',
    weightOptions: ['ultralight','light','medium','heavy'],
    showStretch: true,
  },
}

// ── Rule list (add/remove chips) ──────────────────────────────────────────────
function RuleList({ rules, onChange, placeholder, color = 'accent' }) {
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
          {rules.map((rule, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px 4px 12px', borderRadius: 20,
              background: bgVar, border: `1px solid ${colorVar}`,
              fontSize: 12, color: colorVar, maxWidth: '100%',
            }}>
              <span style={{ flex: 1, lineHeight: 1.4 }}>{rule}</span>
              <button onClick={() => remove(i)} style={{ color: colorVar, fontSize: 14, lineHeight: 1, flexShrink: 0, opacity: 0.7 }}>✕</button>
            </div>
          ))}
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
      <span style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }} />
    </div>
  )
}

// ── Photo slot ─────────────────────────────────────────────────────────────────
function PhotoSlot({ label, hint, preview, onChange, onClear }) {
  return (
    <div className="form-group">
      <label className="form-label" style={{ fontSize: 10 }}>{label}</label>
      {preview ? (
        <div className="photo-preview">
          <img src={preview} alt={label} style={{ maxHeight: 160 }} />
          <button className="photo-preview-remove" onClick={onClear}>✕</button>
        </div>
      ) : (
        <label className="photo-upload" style={{ padding: '16px 10px' }}>
          <input type="file" accept="image/*" onChange={onChange} />
          <div className="photo-upload-icon" style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
          <div className="photo-upload-text" style={{ fontSize: 12 }}>{label}</div>
          <div className="photo-upload-hint" style={{ fontSize: 10 }}>{hint}</div>
        </label>
      )}
    </div>
  )
}

// ── Chip row helper ─────────────────────────────────────────────────────────────
function ChipRow({ options, value, onChange, multi = false }) {
  return (
    <div className="chip-grid">
      {options.map(opt => {
        const val  = typeof opt === 'string' ? opt : opt.value
        const lbl  = typeof opt === 'string' ? opt : opt.label
        const active = multi ? (Array.isArray(value) ? value.includes(val) : false) : value === val
        return (
          <button
            key={val}
            className={`chip-toggle ${active ? 'active' : ''}`}
            onClick={() => multi
              ? onChange(active ? value.filter(v => v !== val) : [...(value||[]), val])
              : onChange(val === value ? null : val)
            }
            style={{ textTransform: 'capitalize' }}
          >{lbl}</button>
        )
      })}
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
    sleeve_type:        piece?.sleeve_type        || null,
    length_hits_at:     piece?.length_hits_at     || null,
    silhouette:         piece?.silhouette         || null,
    hem_finish:         piece?.hem_finish         || null,
    // Fabric
    fabric_category:    piece?.fabric_category    || null,
    fabric_weight:      piece?.fabric_weight      || null,
    stretch:            piece?.stretch            || null,
    // Fit
    fit_on_body:        piece?.fit_on_body        || null,
    tuck_behavior:      piece?.tuck_behavior      || null,
    waistband_type:     piece?.waistband_type     || null,
    // Learned wisdom
    styling_rules_learned: piece?.styling_rules_learned || [],
    pairs_well_with:       piece?.pairs_well_with       || [],
    tried_and_rejected:    piece?.tried_and_rejected    || [],
    // Color
    background_color: piece?.background_color || '',
  })
  const [confidenceFlags, setConfidenceFlags] = useState({}) // field -> 'medium'|'low'

  const [hangerFile,  setHangerFile]  = useState(null)
  const [hangerPrev,  setHangerPrev]  = useState(piece?.photo      ? `/uploads/${piece.photo}`      : null)
  const [wornFile,    setWornFile]    = useState(null)
  const [wornPrev,    setWornPrev]    = useState(piece?.worn_photo  ? `/uploads/${piece.worn_photo}` : null)
  const [clearHanger, setClearHanger] = useState(false)
  const [clearWorn,   setClearWorn]   = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [tagging,     setTagging]     = useState(false)
  const [tagError,    setTagError]    = useState(null)
  const [fitNoting,   setFitNoting]   = useState(false)

  const set       = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleArr = (k, val) => setForm(f => ({
    ...f,
    [k]: f[k].includes(val) ? f[k].filter(x => x !== val) : [...f[k], val]
  }))

  // Auto-tag from hanger photo. In edit mode, this can retag the existing saved hanger photo.
  const handleTagThis = async () => {
    if (!hangerFile && !(isEdit && piece?.photo && hangerPrev && !clearHanger)) return
    setTagging(true); setTagError(null)
    try {
      let res
      if (hangerFile) {
        const fd = new FormData(); fd.append('photo', hangerFile)
        res = await fetch('/api/ai/tag-piece', { method: 'POST', body: fd })
      } else {
        res = await fetch(`/api/ai/tag-piece-existing/${piece.id}`, { method: 'POST' })
      }
      const tags = await res.json()
      if (tags.error) throw new Error(tags.error)
      setForm(f => ({
        ...f,
        category:           tags.category           || f.category,
        colors:             tags.colors             || f.colors,
        occasions:          tags.occasions          || f.occasions,
        season:             tags.season             || f.season,
        name:               f.name || tags.name_suggestion || '',
        background_color:   tags.background_color   || f.background_color,
        pattern_type:       tags.pattern_type       || f.pattern_type,
        pattern_scale:      tags.pattern_scale      || f.pattern_scale,
        pattern_complexity: tags.pattern_complexity || f.pattern_complexity,
        reads_as:           tags.reads_as           || f.reads_as,
        hem_finish:         tags.hem_finish         || f.hem_finish,
        neckline:           tags.neckline           || f.neckline,
        sleeve_type:        tags.sleeve_type        || f.sleeve_type,
        length_hits_at:     tags.length_hits_at     || f.length_hits_at,
        silhouette:         tags.silhouette         || f.silhouette,
        fabric_category:    tags.fabric_category    || f.fabric_category,
        fabric_weight:      tags.fabric_weight      || f.fabric_weight,
      }))
      // Set confidence flags for medium/low fields
      if (tags._confidence) {
        const flags = {}
        Object.entries(tags._confidence).forEach(([field, conf]) => {
          if (conf === 'medium' || conf === 'low') flags[field] = conf
        })
        setConfidenceFlags(flags)
      }
    } catch { setTagError('Tagging failed — fill in manually') }
    finally { setTagging(false) }
  }

  // Full evaluation from worn photo — sends piece context, auto-fills chips
  const handleWornPhoto = async (file) => {
    setWornFile(file); setWornPrev(URL.createObjectURL(file)); setClearWorn(false)
    setFitNoting(true)
    try {
      const fd = new FormData()
      fd.append('photo', file)
      if (form.name)     fd.append('piece_name', form.name)
      if (form.category) fd.append('piece_category', form.category)
      const res  = await fetch('/api/ai/fit-note', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.error) return
      setForm(f => {
        const updated = { ...f }
        // Replace any existing fit note rather than appending
        if (data.note) {
          const stripped = f.notes
            .replace(/\n*Fit: [^\n]*/g, '')
            .replace(/\n*Fit evaluation: [^\n]*/g, '')
            .trim()
          updated.notes = stripped ? stripped + '\n\nFit: ' + data.note : 'Fit: ' + data.note
        }
        // Always overwrite structured fields from new worn photo
        if (data.fit_on_body)    updated.fit_on_body    = data.fit_on_body
        if (data.length_hits_at) updated.length_hits_at = data.length_hits_at
        if (data.tuck_behavior)  updated.tuck_behavior  = data.tuck_behavior
        if (data.waistband_type) updated.waistband_type = data.waistband_type
        if (data.silhouette)     updated.silhouette     = data.silhouette
        return updated
      })
    } catch {}
    finally { setFitNoting(false) }
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => {
      if (v !== null && v !== undefined) fd.append(k, Array.isArray(v) ? JSON.stringify(v) : v)
    })
    if (hangerFile)   fd.append('photo', hangerFile)
    else if (clearHanger) fd.append('clear_photo', 'true')
    if (wornFile)     fd.append('worn_photo', wornFile)
    else if (clearWorn)   fd.append('clear_worn_photo', 'true')
    try {
      const res = await fetch(isEdit ? `/api/pieces/${piece.id}` : '/api/pieces', {
        method: isEdit ? 'PUT' : 'POST', body: fd
      })
      onSave(await res.json())
    } finally { setSaving(false) }
  }

  // Helper: field label with confidence indicator
  const FieldLabel = ({ field, children }) => {
    const conf = confidenceFlags[field]
    return (
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {children}
        {conf === 'low'    && <span style={{ fontSize: 9, background: '#E8A020', color: '#fff', padding: '1px 6px', borderRadius: 8, letterSpacing: '0.04em' }}>LOW — VERIFY</span>}
        {conf === 'medium' && <span style={{ fontSize: 9, background: 'var(--border)', color: 'var(--text-muted)', padding: '1px 6px', borderRadius: 8 }}>review</span>}
      </label>
    )
  }

  const cat = form.category
  const constructionConfig = CONSTRUCTION_BY_CATEGORY[cat]
  const fabricConfig = FABRIC_BY_CATEGORY[cat] || FABRIC_BY_CATEGORY.default
  const showFitFields = CLOTHING_CATEGORIES.includes(cat)

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit piece' : 'Add piece'}</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="form-body">

          {/* ── Photos ──────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <PhotoSlot
              label="Hanger photo"
              hint="Auto-tags on upload"
              preview={hangerPrev}
              onChange={e => { const f = e.target.files[0]; if (f) { setHangerFile(f); setHangerPrev(URL.createObjectURL(f)); setClearHanger(false) } }}
              onClear={() => { setHangerFile(null); setHangerPrev(null); setClearHanger(true) }}
            />
            <PhotoSlot
              label="Worn photo"
              hint={fitNoting ? '◌ Evaluating…' : 'Auto-generates fit note'}
              preview={wornPrev}
              onChange={e => { const f = e.target.files[0]; if (f) handleWornPhoto(f) }}
              onClear={() => { setWornFile(null); setWornPrev(null); setClearWorn(true) }}
            />
          </div>

          {/* Tag This button */}
          {(hangerFile || (isEdit && piece?.photo && hangerPrev && !clearHanger)) && (
            <div>
              <button onClick={handleTagThis} disabled={tagging} style={{
                width: '100%', padding: '11px',
                background: tagging ? 'var(--surface-2)' : 'var(--accent-light)',
                color: 'var(--accent)', border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: tagging ? 'default' : 'pointer', transition: 'all 0.15s',
              }}>
                {tagging
                  ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Tagging…</>
                  : (hangerFile ? '◇ Tag this with AI' : '◇ Retag existing photo with AI')}
              </button>
              {tagError && <div style={{ fontSize: 11, color: 'var(--repair)', marginTop: 4 }}>{tagError}</div>}
            </div>
          )}

          {/* ── Basics ──────────────────────────────────────────────── */}
          <Section label="Basics" />

          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="form-input" placeholder="e.g. Bold multicolor floral knit top" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Category</label>
            <ChipRow options={CATEGORIES} value={form.category} onChange={v => set('category', v || form.category)} />
          </div>

          <div className="form-group">
            <label className="form-label">Colors</label>
            <div className="chip-grid">
              {COLOR_OPTIONS.map(c => (
                <button key={c.name} className={`color-chip ${form.colors.includes(c.name) ? 'active' : ''}`} style={{ background: c.hex }} title={c.name} onClick={() => toggleArr('colors', c.name)}>
                  {form.colors.includes(c.name) && <span className="color-chip-check" style={{ color: LIGHT_COLORS.includes(c.name) ? '#666' : '#fff' }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Background color <span style={{ fontSize: 10, color: 'var(--text-light)', fontStyle: 'italic', fontWeight: 400 }}>literal base color of the garment</span></label>
            <input className="form-input" placeholder="e.g. black, navy, cream" value={form.background_color} onChange={e => set('background_color', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Occasions</label>
            <ChipRow options={OCCASIONS} value={form.occasions} onChange={v => set('occasions', v)} multi />
          </div>

          <div className="form-group">
            <label className="form-label">Season</label>
            <div className="radio-row">
              {SEASONS.map(s => <button key={s} className={`radio-btn ${form.season === s ? 'active' : ''}`} onClick={() => set('season', s)}>{s}</button>)}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* ── Recommendation Trust ───────────────────────────────── */}
          <Section label="Recommendation Trust" />

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

          {/* ── Pattern & Visual ─────────────────────────────────────── */}
          <Section label="Pattern & Visual" />

          <div className="form-group">
            <label className="form-label">Pattern type</label>
            <ChipRow options={['solid','floral','stripe','botanical','geometric','abstract','animal','graphic','plaid','other']} value={form.pattern_type} onChange={v => set('pattern_type', v)} />
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
                  <ChipRow options={['V','scoop','crew','boat','mock','cowl','off-shoulder','square','wrap','other']} value={form.neckline} onChange={v => set('neckline', v)} />
                </div>
              )}

              {constructionConfig.showSleeve && (
                <div className="form-group">
                  <label className="form-label">Sleeve</label>
                  <ChipRow options={['sleeveless','cap','short','3/4','long','bell','bishop']} value={form.sleeve_type} onChange={v => set('sleeve_type', v)} />
                </div>
              )}

              <div className="form-group">
                <FieldLabel field="silhouette">{constructionConfig.silhouetteLabel}</FieldLabel>
                <ChipRow options={constructionConfig.silhouetteOptions} value={form.silhouette} onChange={v => set('silhouette', v)} />
              </div>

              <div className="form-group">
                <label className="form-label">{constructionConfig.lengthLabel}</label>
                <ChipRow options={constructionConfig.lengthOptions} value={form.length_hits_at} onChange={v => set('length_hits_at', v)} />
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
            <FieldLabel field="fabric_category">{fabricConfig.fabricLabel}</FieldLabel>
            <ChipRow options={fabricConfig.fabricOptions} value={form.fabric_category} onChange={v => set('fabric_category', v)} />
          </div>

          <div className="form-group">
            <FieldLabel field="fabric_weight">{fabricConfig.weightLabel}</FieldLabel>
            <ChipRow options={fabricConfig.weightOptions} value={form.fabric_weight} onChange={v => set('fabric_weight', v)} />
          </div>

          {fabricConfig.showStretch && (
            <div className="form-group">
              <label className="form-label">Stretch</label>
              <ChipRow options={['none','minimal','stretchy']} value={form.stretch} onChange={v => set('stretch', v)} />
            </div>
          )}

          {/* ── Fit ──────────────────────────────────────────────────── */}
          {showFitFields && (
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
          )}

          {/* ── Styling Rules ────────────────────────────────────────── */}
          <Section label="Styling Rules" />

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Rules learned
              <span style={{ fontSize: 10, color: 'var(--text-light)', fontStyle: 'italic', fontWeight: 400 }}>authoritative — stylist follows these first</span>
            </label>
            <RuleList
              rules={form.styling_rules_learned}
              onChange={v => set('styling_rules_learned', v)}
              placeholder="e.g. needs flow on bottom, silk — wear over only, always with amber pendant"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Pairs well with</label>
            <RuleList
              rules={form.pairs_well_with}
              onChange={v => set('pairs_well_with', v)}
              placeholder="e.g. cream wide-leg pants, dark jeans"
              color="donate"
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

          {/* ── Notes ────────────────────────────────────────────────── */}
          <Section label="Notes" />

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Styling notes
              {fitNoting && <span style={{ color: 'var(--accent)', fontSize: 10, fontStyle: 'italic' }}>◌ evaluating fit…</span>}
            </label>
            <textarea className="form-textarea" placeholder="Anything you've learned about how to wear this piece…" value={form.notes} onChange={e => set('notes', e.target.value)} style={{ minHeight: 100 }} />
          </div>

        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add piece'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
