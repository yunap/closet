import { useState, useRef } from 'react'
import { GATE_CRITICAL_FIELDS } from '../../styling-engine/attributes.js'
import { confidenceMapForPiece, intakeReviewSummary, intakeReviewSummaryText } from '../utils/intakeReview.js'
import { COLOR_OPTIONS, LIGHT_COLORS } from '../utils/colors.js'

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
const OCCASIONS  = ['casual', 'city', 'evening', 'smart-casual', 'outdoor', 'home', 'walking']
const SEASONS    = ['warm', 'cool', 'year-round']
const FORMALITY_OPTIONS = [
  { value: 'lounge', label: 'Lounge' },
  { value: 'everyday', label: 'Everyday' },
  { value: 'elevated', label: 'Elevated' },
  { value: 'dressy', label: 'Dressy' },
]
const FABRIC_WEIGHT_OPTIONS = [
  { value: 'ultralight', label: 'Ultralight' },
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
]
const FIBER_OPTIONS = [
  'cotton', 'linen', 'silk', 'wool', 'merino', 'cashmere', 
  'alpaca', 'mohair', 'fleece', 'down', 'tencel', 'modal', 
  'rayon', 'viscose', 'polyester', 'nylon', 'acrylic', 
  'spandex', 'leather', 'suede', 'denim', 'unknown'
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
const REVIEW_CONSTRUCTION_CONFIG = {
  top: {
    showNeckline: true,
    showSleeve: true,
    silhouetteOptions: ['fitted','slim','relaxed','boxy','drop-shoulder','oversized','peplum','wrap'],
    lengthOptions: ['crop','waist','hip','tunic','mid-thigh'],
    hemOptions: ['straight_loose', 'banded_elastic', 'ribbed', 'design_hem'],
  },
  bottom: {
    silhouetteOptions: ['straight leg','wide leg','bootcut','flare','tapered','barrel','A-line skirt','pencil skirt','full skirt','slip skirt','relaxed','structured'],
    lengthOptions: ['short','above-knee','knee','midi','maxi','ankle','full-length','cropped'],
    hemOptions: ['straight_loose', 'cuffed', 'raw', 'tapered', 'banded_elastic', 'slit', 'asymmetrical', 'design_hem'],
  },
  dress: {
    showNeckline: true,
    silhouetteOptions: ['fitted','sheath','shift','A-line','wrap','slip','column','fit-and-flare','relaxed'],
    lengthOptions: ['mini','above-knee','knee','midi','maxi'],
  },
  outerwear: {
    showSleeve: true,
    silhouetteOptions: ['cropped','fitted','boxy','relaxed','oversized','structured','longline'],
    lengthOptions: ['waist','hip','mid-thigh','knee','longline'],
  },
  shoes: {
    silhouetteOptions: ['pointed','almond','round','square','open-toe','mule','loafer','boot','sandal','heel','flat','sneaker'],
    lengthOptions: ['open','closed','ankle','mid-calf','knee','over-knee'],
  }
}

function emptyForm() {
  return {
    name: '', category: 'top', colors: [], occasions: [], season: 'year-round', notes: '', status: 'active',
    pattern_type: null, pattern_scale: null, pattern_complexity: null, reads_as: '',
    hem_finish: null, neckline: null, sleeve_type: null, length_hits_at: null,
    silhouette: null, fabric_category: null, fabric_weight: null, opacity: null, fiber_content: [],
    formality: null, heel_height: null, walk_support: null,
    stretch: null, fit_on_body: null, tuck_behavior: null, waistband_type: null,
    style_profile_json: {},
    tagger_version: null,
    manual_overrides: [],
  }
}

function ThumbnailSizeControl({ value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
      Image size
      <input
        type="range"
        min="180"
        max="520"
        step="20"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        aria-label="Image size"
        style={{ width: 120, accentColor: 'var(--accent)' }}
      />
    </label>
  )
}

// ── Phase: Select ──────────────────────────────────────────────────────────────
function SelectPhase({ onFiles, onClose }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  const handleFiles = (fileList) => {
    const images = Array.from(fileList).filter(f => f.type.startsWith('image/'))
    if (images.length) onFiles(images)
  }

  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, overflowY: 'auto', flex: 1 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, textAlign: 'center', marginBottom: 6 }}>Batch add pieces</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          Select multiple photos at once. Claude will tag each one, then you review and save.
        </div>
      </div>

      <div
        onClick={() => inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        style={{
          width: '100%',
          maxWidth: 400,
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-lg)',
          padding: '48px 32px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'var(--accent-light)' : 'var(--surface)',
          transition: 'all 0.15s',
        }}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
        <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Choose photos</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tap to select · or drag and drop<br />Select as many as you like</div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-light)', textAlign: 'center', lineHeight: 1.7 }}>
        Hanger or flat lay photos work best.<br />
        Worn photos can be added later per piece.
      </div>

      <button
        type="button"
        className="btn-secondary"
        onClick={onClose}
        style={{ width: '100%', maxWidth: 200, marginTop: 12 }}
      >
        Close / Exit
      </button>
    </div>
  )
}

// ── Phase: Processing ──────────────────────────────────────────────────────────
function ProcessingPhase({ items, thumbnailSize }) {
  const done    = items.filter(i => i.status === 'ready' || i.status === 'error').length
  const total   = items.length
  const pct     = Math.round((done / total) * 100)
  const current = items.find(i => i.status === 'tagging')
  const currentThumbSize = Math.max(52, Math.round(thumbnailSize / 4))
  const gridThumbSize = Math.max(72, Math.round(thumbnailSize / 3))

  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24, overflowY: 'auto', flex: 1 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, marginBottom: 4 }}>Tagging your pieces…</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{done} of {total} done</div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s ease' }} />
      </div>

      {/* Current item */}
      {current && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border-light)' }}>
          <img src={current.preview} alt="" style={{ width: currentThumbSize, height: currentThumbSize, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Analyzing photo {items.indexOf(current) + 1}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Model is reading this piece
            </div>
          </div>
        </div>
      )}

      {/* Thumbnail grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${gridThumbSize}px, 1fr))`, gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-light)' }}>
            <img src={item.preview} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--surface-2)', display: 'block' }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: item.status === 'ready'  ? 'rgba(90,122,90,0.35)' :
                          item.status === 'tagging' ? 'rgba(124,95,60,0.2)' :
                          item.status === 'error'   ? 'rgba(168,64,64,0.35)' : 'rgba(38,32,26,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: '#fff',
              transition: 'background 0.3s',
            }}>
              {item.status === 'ready'   && '✓'}
              {item.status === 'tagging' && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span>}
              {item.status === 'error'   && '!'}
              {item.status === 'pending' && ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Phase: Grouping (Staging Area) ───────────────────────────────────────────
function GroupingPhase({ items, onLink, onUnlink, onStart, onAddFiles, onCancel, onRemove, linkingFromId, setLinkingFromId }) {
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const fileInputRef = useRef()

  const handleFiles = (fileList) => {
    const newFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'))
    if (newFiles.length) onAddFiles(newFiles)
  }

  return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
      {/* Visual Header & Description */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
          Group Garment Photos
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, padding: '0 10px' }}>
          💡 Drag a <strong>worn photo</strong> and drop it onto a <strong>hanger photo</strong> to pair them. 
          Or click <strong>"Link"</strong> on the worn photo, then click the hanger photo.
        </div>
      </div>

      {/* Linking instructions banner */}
      {linkingFromId && (
        <div style={{
          padding: '10px 14px',
          background: 'var(--accent-light)',
          color: 'var(--accent)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          fontWeight: 500,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          animation: 'pulse 2s infinite ease-in-out'
        }}>
          <span>Select the hanger/flat lay photo for this worn photo...</span>
          <button style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: 11 }} onClick={() => setLinkingFromId(null)}>Cancel</button>
        </div>
      )}

      {/* Grid of staged items */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 16,
        padding: '4px 0'
      }}>
        {items.map((item) => {
          const isLinkingSource = linkingFromId === item.id
          const isLinkingTarget = linkingFromId && linkingFromId !== item.id
          const isDragged = draggedId === item.id
          const isDragOver = dragOverId === item.id

          return (
            <div
              key={item.id}
              draggable={!linkingFromId}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', item.id)
                setDraggedId(item.id)
              }}
              onDragEnd={() => {
                setDraggedId(null)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (draggedId && draggedId !== item.id) {
                  setDragOverId(item.id)
                }
              }}
              onDragLeave={() => {
                setDragOverId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const sourceId = e.dataTransfer.getData('text/plain') || draggedId
                if (sourceId && sourceId !== item.id) {
                  onLink(sourceId, item.id)
                }
                setDragOverId(null)
                setDraggedId(null)
              }}
              style={{
                background: 'var(--surface)',
                borderRadius: 'var(--radius)',
                border: isLinkingSource ? '2px solid var(--accent)' :
                        isDragOver ? '2px dashed var(--accent)' :
                        isLinkingTarget ? '2px dashed var(--border)' : '1px solid var(--border-light)',
                padding: 10,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                boxShadow: isDragged ? 'var(--shadow-lg)' : 'var(--shadow)',
                opacity: isDragged ? 0.4 : 1,
                transform: isDragOver ? 'scale(1.03)' : 'none',
                transition: 'all 0.2s ease',
                cursor: linkingFromId ? 'default' : 'grab'
              }}
            >
              {/* Image containers */}
              <div style={{ position: 'relative', aspectRatio: '1', width: '100%', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <img src={item.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                
                {/* Delete button to remove from batch */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'rgba(38, 32, 26, 0.7)',
                    color: '#fff',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    cursor: 'pointer',
                    zIndex: 10,
                  }}
                  title="Remove from batch"
                >
                  ✕
                </button>
                
                {/* Standalone label */}
                {!item.wornPreview && (
                  <span style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 6px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.85)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-light)'
                  }}>
                    Standalone
                  </span>
                )}

                {/* Overlapping worn preview if grouped */}
                {item.wornPreview && (
                  <>
                    <span style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      padding: '2px 6px',
                      borderRadius: 10,
                      background: 'var(--accent-light)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent)'
                    }}>
                      Paired
                    </span>
                    <div style={{
                      position: 'absolute',
                      bottom: 4,
                      right: 4,
                      width: 52,
                      height: 52,
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      border: '2px solid var(--surface)',
                      boxShadow: 'var(--shadow-lg)',
                      background: 'var(--surface-2)'
                    }}>
                      <img src={item.wornPreview} alt="Worn" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* If linking target, show button to pair here */}
                {isLinkingTarget ? (
                  <button
                    className="btn-primary"
                    style={{ padding: '6px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)' }}
                    onClick={() => onLink(linkingFromId, item.id)}
                  >
                    🎯 Pair here
                  </button>
                ) : item.wornPreview ? (
                  /* If already paired, show unlink option */
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', color: 'var(--danger)', borderColor: 'rgba(168, 64, 64, 0.2)' }}
                    onClick={() => onUnlink(item.id)}
                  >
                    ✕ Unlink
                  </button>
                ) : !linkingFromId ? (
                  /* Normal link button */
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)' }}
                    onClick={() => setLinkingFromId(item.id)}
                  >
                    🔗 Link...
                  </button>
                ) : (
                  /* While linking, disable normal buttons */
                  <button
                    className="btn-secondary"
                    disabled
                    style={{ padding: '6px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', opacity: 0.3 }}
                  >
                    🔗 Link...
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* ➕ Add photos card */}
        <div
          onClick={() => fileInputRef.current.click()}
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 'var(--radius)',
            aspectRatio: '1',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            background: 'rgba(124, 95, 60, 0.02)',
            transition: 'all 0.15s ease',
            padding: 10,
            gap: 8,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'rgba(124, 95, 60, 0.02)' }}
        >
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <span style={{ fontSize: 24 }}>➕</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>Add photos</span>
        </div>
      </div>

      {/* Footer Actions */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginTop: 20,
        paddingTop: 16,
        borderTop: '1px solid var(--border-light)'
      }}>
        <button className="btn-secondary" onClick={onCancel} style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={onStart}
          disabled={items.length === 0}
          style={{ flex: 2 }}
        >
          Analyze items ({items.length} garments) →
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.9; }
          50% { opacity: 0.65; }
          100% { opacity: 0.9; }
        }
      `}</style>
    </div>
  )
}

// ── Phase: Review (one item at a time) ────────────────────────────────────────
function ReviewPhase({ items, currentIndex, onSave, onSkip, onSwap, onPrev, thumbnailSize }) {
  const item = items[currentIndex]
  const total = items.length
  const [form, setForm] = useState({ ...emptyForm(), ...item.form })
  const [saving, setSaving] = useState(false)
  const summary = intakeReviewSummary(form)
  const confidence = confidenceMapForPiece(form)

  const patternConstFields = [
    'pattern_type', 'pattern_scale', 'pattern_complexity', 'reads_as',
    'neckline', 'sleeve_type', 'silhouette', 'length_hits_at', 'hem_finish'
  ]
  const hasLowConfidencePatternConst = patternConstFields.some(field => 
    String(confidence[field] || '').toLowerCase() === 'low'
  )
  const [detailsExpanded, setDetailsExpanded] = useState(() => {
    return item.status === 'error' || hasLowConfidencePatternConst
  })

  const set = (k, v) => setForm(f => {
    const nextOverrides = f.manual_overrides.includes(k) ? f.manual_overrides : [...f.manual_overrides, k]
    return { ...f, [k]: v, manual_overrides: nextOverrides }
  })
  const toggleArr = (k, val) => setForm(f => {
    const nextOverrides = f.manual_overrides.includes(k) ? f.manual_overrides : [...f.manual_overrides, k]
    return {
      ...f,
      [k]: f[k].includes(val) ? f[k].filter(x => x !== val) : [...f[k], val],
      manual_overrides: nextOverrides
    }
  })
  const FieldLabel = ({ field, children }) => {
    const isGate = GATE_CRITICAL_FIELDS.includes(field)
    const isManual = form.manual_overrides.includes(field)
    const isLow = !isManual && String(confidence[field] || '').toLowerCase() === 'low'
    return (
      <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {children}
        {isGate && <span title="Gate-critical field" style={{ fontSize: 9, background: 'var(--accent-light)', color: 'var(--accent)', padding: '1px 6px', borderRadius: 8 }}>gate</span>}
        {isLow && <span title="AI unsure" style={{ fontSize: 9, background: '#E8A020', color: '#fff', padding: '1px 6px', borderRadius: 8 }}>AI unsure</span>}
      </label>
    )
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => {
        if (v !== null && v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v)
      })
      fd.append('photo', item.file)
      if (item.wornFile) {
        fd.append('worn_photo', item.wornFile)
      }
      
      const method = item.dbId ? 'PUT' : 'POST'
      const url = item.dbId ? `/api/pieces/${item.dbId}` : '/api/pieces'
      
      const res = await fetch(url, { method, body: fd })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Server returned status ${res.status}: ${text}`)
      }
      const savedPiece = await res.json()
      onSave(savedPiece.id, form)
    } catch (err) {
      console.error('Failed to save item:', err)
      alert(`Error saving piece: ${err.message}`)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Progress header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500 }}>Review</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{currentIndex + 1} of {total}</div>
        </div>
        {/* Mini progress dots */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 180, justifyContent: 'flex-end' }}>
          {items.map((it, i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: it.status === 'saved'   ? 'var(--donate)' :
                          it.status === 'skipped' ? 'var(--border)' :
                          i === currentIndex      ? 'var(--accent)' : 'var(--border-light)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Photos */}
        {item.wornPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hanger (Garment Detail)</div>
                <img src={item.preview} alt="Hanger" style={{ width: '100%', maxHeight: thumbnailSize, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border-light)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Worn (Fit & drape)</div>
                <img src={item.wornPreview} alt="Worn" style={{ width: '100%', maxHeight: thumbnailSize, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border-light)' }} />
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={onSwap}
              style={{ padding: '6px 12px', fontSize: 11, alignSelf: 'center', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              🔄 Swap Hanger & Worn Photos
            </button>
          </div>
        ) : (
          <img src={item.preview} alt="" style={{ width: '100%', maxHeight: thumbnailSize, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }} />
        )}

        {item.status === 'error' && (
          <div style={{ padding: '10px 14px', background: 'var(--repair-bg)', color: 'var(--repair)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
            Tagging failed for this photo — fill in manually.
          </div>
        )}
        {item.status !== 'error' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ padding: '4px 9px', borderRadius: 999, background: summary.missingGateCount ? 'var(--repair-bg)' : 'var(--surface-2)', border: '1px solid var(--border-light)', color: summary.missingGateCount ? 'var(--repair)' : 'var(--text-muted)', fontSize: 11 }}>
              {intakeReviewSummaryText(form)}
            </span>
            {summary.missingGateFields.length > 0 && (
              <span style={{ padding: '4px 9px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--text-muted)', fontSize: 11 }}>
                Gate fields missing: {summary.missingGateFields.join(', ')}
              </span>
            )}
          </div>
        )}

        {/* Name */}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" placeholder="e.g. Cream wide-leg pants" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
        </div>

        {/* Category */}
        <div className="form-group">
          <label className="form-label">Category</label>
          <div className="chip-grid">
            {CATEGORIES.map(c => <button key={c} className={`chip-toggle ${form.category === c ? 'active' : ''}`} onClick={() => set('category', c)}>{c}</button>)}
          </div>
        </div>

        {/* Colors */}
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

        {/* Occasions */}
        <div className="form-group">
          <FieldLabel field="occasions">Occasions</FieldLabel>
          <div className="chip-grid">
            {OCCASIONS.map(o => <button key={o} className={`chip-toggle ${form.occasions.includes(o) ? 'active' : ''}`} onClick={() => toggleArr('occasions', o)}>{o}</button>)}
          </div>
        </div>

        {/* Season */}
        <div className="form-group">
          <label className="form-label">Season</label>
          <div className="radio-row">
            {SEASONS.map(s => <button key={s} className={`radio-btn ${form.season === s ? 'active' : ''}`} onClick={() => set('season', s)}>{s}</button>)}
          </div>
        </div>

        {form.category !== 'accessory' && (
          <div className="form-group">
            <FieldLabel field="formality">Formality</FieldLabel>
            <div className="radio-row">
              {FORMALITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`radio-btn ${form.formality === opt.value ? 'active' : ''}`}
                  onClick={() => set('formality', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <FieldLabel field="fabric_category">Fabric Category</FieldLabel>
          <select
            className="form-select"
            value={form.fabric_category || ''}
            onChange={e => set('fabric_category', e.target.value || null)}
          >
            <option value="">-- Select Fabric --</option>
            {(form.category === 'shoes'
              ? ['leather','suede','patent','canvas','mesh','synthetic','textile','rubber','other']
              : form.category === 'accessory'
              ? ['leather','suede','metal','straw','canvas','synthetic','textile','rubber','other']
              : ['jersey','knit','rib knit','ponte','sweatshirt fleece','fleece','cotton','poplin','linen','linen blend','rayon','viscose','modal','silk','satin','crepe','chiffon','lace','crochet','wool','cashmere','denim','twill','canvas','corduroy','tweed','velvet','leather','faux leather','suede','faux suede','mesh','technical/performance','synthetic','other']
            ).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <FieldLabel field="fabric_weight">Fabric Weight</FieldLabel>
          <div className="radio-row">
            {FABRIC_WEIGHT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`radio-btn ${form.fabric_weight === opt.value ? 'active' : ''}`}
                onClick={() => set('fabric_weight', opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <FieldLabel field="fiber_content">Fiber Content</FieldLabel>
          <div className="chip-grid">
            {FIBER_OPTIONS.map(fib => (
              <button
                key={fib}
                className={`chip-toggle ${form.fiber_content && form.fiber_content.includes(fib) ? 'active' : ''}`}
                onClick={() => toggleArr('fiber_content', fib)}
                style={{ textTransform: 'capitalize' }}
              >
                {fib}
              </button>
            ))}
          </div>
        </div>

        {form.category === 'shoes' && (
          <>
            <div className="form-group">
              <FieldLabel field="heel_height">Heel Height</FieldLabel>
              <div className="radio-row">
                {HEEL_HEIGHT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`radio-btn ${form.heel_height === opt.value ? 'active' : ''}`}
                    onClick={() => set('heel_height', opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <FieldLabel field="walk_support">Walk Support</FieldLabel>
              <div className="radio-row">
                {WALK_SUPPORT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`radio-btn ${form.walk_support === opt.value ? 'active' : ''}`}
                    onClick={() => set('walk_support', opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Collapsible Pattern & Construction Details Drawer */}
        <div style={{ margin: '12px 0 6px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '10px 14px' }}
          >
            <span>{detailsExpanded ? '▼ Hide' : '▶ Show'} Pattern & Construction Details</span>
            {hasLowConfidencePatternConst && (
              <span style={{ fontSize: 10, background: '#E8A020', color: '#fff', padding: '1px 6px', borderRadius: 8 }}>
                AI unsure of details
              </span>
            )}
          </button>
        </div>

        {detailsExpanded && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', background: 'rgba(124, 95, 60, 0.02)' }}>
            
            {/* Pattern Type */}
            <div className="form-group">
              <FieldLabel field="pattern_type">Pattern Type</FieldLabel>
              <select className="form-select" value={form.pattern_type || ''} onChange={e => set('pattern_type', e.target.value || null)}>
                <option value="">-- Select Pattern Type --</option>
                {['solid','floral','stripe','botanical','geometric','abstract','animal','graphic','plaid','other'].map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Pattern Scale */}
            <div className="form-group">
              <FieldLabel field="pattern_scale">Pattern Scale</FieldLabel>
              <select className="form-select" value={form.pattern_scale || ''} onChange={e => set('pattern_scale', e.target.value || null)}>
                <option value="">-- Select Pattern Scale --</option>
                {['none','subtle','medium','bold'].map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Pattern Complexity */}
            <div className="form-group">
              <FieldLabel field="pattern_complexity">Pattern Complexity</FieldLabel>
              <select className="form-select" value={form.pattern_complexity || ''} onChange={e => set('pattern_complexity', e.target.value || null)}>
                <option value="">-- Select Pattern Complexity --</option>
                {['solid','quiet','medium','loud'].map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Reads As */}
            <div className="form-group">
              <FieldLabel field="reads_as">Reads As</FieldLabel>
              <input className="form-input" placeholder="e.g. bold warm statement" value={form.reads_as || ''} onChange={e => set('reads_as', e.target.value)} />
            </div>

            {/* Neckline */}
            {REVIEW_CONSTRUCTION_CONFIG[form.category]?.showNeckline && (
              <div className="form-group">
                <FieldLabel field="neckline">Neckline</FieldLabel>
                <select className="form-select" value={form.neckline || ''} onChange={e => set('neckline', e.target.value || null)}>
                  <option value="">-- Select Neckline --</option>
                  {['V','scoop','crew','boat','mock','cowl','off-shoulder','square','wrap','other'].map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Sleeve Type */}
            {REVIEW_CONSTRUCTION_CONFIG[form.category]?.showSleeve && (
              <div className="form-group">
                <FieldLabel field="sleeve_type">Sleeve</FieldLabel>
                <select className="form-select" value={form.sleeve_type || ''} onChange={e => set('sleeve_type', e.target.value || null)}>
                  <option value="">-- Select Sleeve --</option>
                  {['sleeveless','cap','short','3/4','long','bell','bishop'].map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Silhouette */}
            {REVIEW_CONSTRUCTION_CONFIG[form.category]?.silhouetteOptions && (
              <div className="form-group">
                <FieldLabel field="silhouette">Silhouette / Shape</FieldLabel>
                <select className="form-select" value={form.silhouette || ''} onChange={e => set('silhouette', e.target.value || null)}>
                  <option value="">-- Select Silhouette --</option>
                  {REVIEW_CONSTRUCTION_CONFIG[form.category].silhouetteOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Length */}
            {REVIEW_CONSTRUCTION_CONFIG[form.category]?.lengthOptions && (
              <div className="form-group">
                <FieldLabel field="length_hits_at">Length / Coverage</FieldLabel>
                <select className="form-select" value={form.length_hits_at || ''} onChange={e => set('length_hits_at', e.target.value || null)}>
                  <option value="">-- Select Length --</option>
                  {REVIEW_CONSTRUCTION_CONFIG[form.category].lengthOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Hem Finish */}
            {REVIEW_CONSTRUCTION_CONFIG[form.category]?.hemOptions && (
              <div className="form-group">
                <FieldLabel field="hem_finish">Hem / Leg Opening</FieldLabel>
                <select className="form-select" value={form.hem_finish || ''} onChange={e => set('hem_finish', e.target.value || null)}>
                  <option value="">-- Select Hem --</option>
                  {REVIEW_CONSTRUCTION_CONFIG[form.category].hemOptions.map(opt => {
                    const val = typeof opt === 'string' ? opt : opt.value
                    const lbl = typeof opt === 'string' ? opt : opt.label
                    return <option key={val} value={val}>{lbl}</option>
                  })}
                </select>
              </div>
            )}

          </div>
        )}

        {/* Notes */}
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" placeholder="Optional…" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

      </div>

      {/* Fixed bottom actions */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 10 }}>
        {onPrev && (
          <button type="button" className="btn-secondary" onClick={onPrev} style={{ minWidth: 80 }}>
            ← Back
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onSkip} style={{ minWidth: 80 }}>Skip</button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()} style={{ flex: 1 }}>
          {saving ? 'Saving…' : currentIndex < total - 1 ? 'Save & next →' : 'Save & finish'}
        </button>
      </div>
    </div>
  )
}

// ── Phase: Summary ─────────────────────────────────────────────────────────────
function SummaryPhase({ items, onDone, thumbnailSize }) {
  const saved   = items.filter(i => i.status === 'saved').length
  const skipped = items.filter(i => i.status === 'skipped').length
  const savedThumbSize = Math.max(72, Math.round(thumbnailSize / 3))

  return (
    <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center', overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 48 }}>✦</div>
      <div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, marginBottom: 8 }}>All done</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          {saved > 0   && <><strong style={{ color: 'var(--text)' }}>{saved} {saved === 1 ? 'piece' : 'pieces'}</strong> added to your wardrobe<br /></>}
          {skipped > 0 && <>{skipped} {skipped === 1 ? 'photo' : 'photos'} skipped</>}
        </div>
      </div>

      {/* Saved thumbnails */}
      {saved > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${savedThumbSize}px, 1fr))`, gap: 8, width: '100%', maxWidth: 420 }}>
          {items.filter(i => i.status === 'saved').map((item, i) => (
            <div key={i} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-light)', position: 'relative' }}>
              <img src={item.preview} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'var(--surface-2)', display: 'block' }} />
              {item.wornPreview && (
                <div style={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  border: '1px solid var(--surface)',
                  overflow: 'hidden',
                  background: 'var(--surface-2)'
                }}>
                  <img src={item.wornPreview} alt="Worn" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              )}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(90,122,90,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>✓</div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-primary" onClick={onDone} style={{ width: '100%', maxWidth: 280, flex: 'none' }}>
        Back to wardrobe
      </button>
    </div>
  )
}

// ── Main BatchAdd orchestrator ─────────────────────────────────────────────────
export default function BatchAdd({ onDone }) {
  const [phase,   setPhase]   = useState('select')   // select | grouping | processing | reviewing | summary
  const [items,   setItems]   = useState([])
  const [current, setCurrent] = useState(0)
  const [thumbnailSize, setThumbnailSize] = useState(260)
  const [linkingFromId, setLinkingFromId] = useState(null)

  const updateItem = (index, patch) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, ...patch } : it))
  }

  // ── File Selection ──────────────────────────────────────────────────────────
  const handleFilesSelected = (files) => {
    const initial = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      wornFile: null,
      wornPreview: null,
      tags:    null,
      form:    emptyForm(),
      status:  'pending',
    }))
    setItems(initial)
    setPhase('grouping')
  }

  // ── Grouping Actions ────────────────────────────────────────────────────────
  const handleLink = (fromId, toId) => {
    const wornItem = items.find(it => it.id === fromId)
    if (!wornItem) return
    setItems(prev => {
      const updated = prev.map(item => {
        if (item.id === toId) {
          return {
            ...item,
            wornFile: wornItem.file,
            wornPreview: wornItem.preview
          }
        }
        return item
      })
      return updated.filter(item => item.id !== fromId)
    })
    setLinkingFromId(null)
  }

  const handleUnlink = (itemId) => {
    const item = items.find(it => it.id === itemId)
    if (!item || !item.wornFile) return
    const restoredItem = {
      id: Math.random().toString(36).substr(2, 9),
      file: item.wornFile,
      preview: item.wornPreview,
      wornFile: null,
      wornPreview: null,
      tags: null,
      form: emptyForm(),
      status: 'pending'
    }
    setItems(prev => {
      const updated = prev.map(it => {
        if (it.id === itemId) {
          return { ...it, wornFile: null, wornPreview: null }
        }
        return it
      })
      return [...updated, restoredItem]
    })
  }

  const handleAddFiles = (newFiles) => {
    const additional = newFiles.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      wornFile: null,
      wornPreview: null,
      tags:    null,
      form:    emptyForm(),
      status:  'pending',
    }))
    setItems(prev => [...prev, ...additional])
  }

  const handleRemove = (itemId) => {
    setItems(prev => {
      const target = prev.find(it => it.id === itemId)
      if (target) {
        if (target.preview) URL.revokeObjectURL(target.preview)
        if (target.wornPreview) URL.revokeObjectURL(target.wornPreview)
      }
      return prev.filter(it => it.id !== itemId)
    })
  }

  const handleSwapPhotos = (index) => {
    setItems(prev => prev.map((it, i) => {
      if (i === index) {
        return {
          ...it,
          file:        it.wornFile,
          preview:     it.wornPreview,
          wornFile:    it.file,
          wornPreview: it.preview
        }
      }
      return it
    }))
  }

  const handleCancel = () => {
    items.forEach(it => {
      if (it.preview) URL.revokeObjectURL(it.preview)
      if (it.wornPreview) URL.revokeObjectURL(it.wornPreview)
    })
    setItems([])
    setPhase('select')
  }

  // ── Start processing: tag all photos sequentially ──────────────────────────
  const startProcessing = async () => {
    setPhase('processing')
    
    const updated = items.map(it => ({ ...it, status: 'pending' }))
    setItems(updated)

    for (let i = 0; i < updated.length; i++) {
      updated[i] = { ...updated[i], status: 'tagging' }
      setItems([...updated])

      try {
        const fd = new FormData()
        fd.append('photo', updated[i].file)
        if (updated[i].wornFile) {
          fd.append('worn_photo', updated[i].wornFile)
        }
        
        const res  = await fetch('/api/ai/tag-piece', { method: 'POST', body: fd })
        const tags = await res.json()

        if (tags.error) throw new Error(tags.error)

        updated[i] = {
          ...updated[i],
          tags,
          form: {
            ...emptyForm(),
            name:               tags.name_suggestion    || '',
            category:           tags.category           || 'top',
            colors:             tags.colors             || [],
            occasions:          tags.occasions          || [],
            season:             tags.season             || 'year-round',
            notes:              tags.notes_suggestion   || '',
            pattern_type:       tags.pattern_type       || null,
            pattern_scale:      tags.pattern_scale      || null,
            pattern_complexity: tags.pattern_complexity || null,
            reads_as:           tags.reads_as           || '',
            hem_finish:         tags.hem_finish         || null,
            neckline:           tags.neckline           || null,
            sleeve_type:        tags.sleeve_type        || null,
            length_hits_at:     tags.length_hits_at     || null,
            silhouette:         tags.silhouette         || null,
            fabric_category:    tags.fabric_category    || null,
            fabric_weight:      tags.fabric_weight      || null,
            opacity:            tags.opacity            || null,
            fiber_content:      tags.fiber_content      || [],
            formality:          tags.formality          || null,
            heel_height:        tags.heel_height        || null,
            walk_support:       tags.walk_support       || null,
            style_profile_json: tags.style_profile_json || {},
            tagger_version:     tags.tagger_version     || null,
          },
          status: 'ready',
        }
      } catch {
        updated[i] = { ...updated[i], status: 'error', form: emptyForm() }
      }
      setItems([...updated])
    }

    setCurrent(0)
    setPhase('reviewing')
  }

  // ── Save current item ──────────────────────────────────────────────────────
  const handleSave = (dbId, finalForm) => {
    updateItem(current, { status: 'saved', dbId, form: finalForm })
    if (current + 1 < items.length) {
      setCurrent(current + 1)
    } else {
      setPhase('summary')
    }
  }

  // ── Skip current item ──────────────────────────────────────────────────────
  const handleSkip = () => {
    updateItem(current, { status: 'skipped' })
    if (current + 1 < items.length) {
      setCurrent(current + 1)
    } else {
      setPhase('summary')
    }
  }

  // ── Back to previous item ──────────────────────────────────────────────────
  const handlePrev = () => {
    if (current > 0) {
      setCurrent(current - 1)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface)', zIndex: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-light)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18 }}>Batch Add</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {phase !== 'select' && (
            <ThumbnailSizeControl value={thumbnailSize} onChange={setThumbnailSize} />
          )}
          {phase !== 'processing' && (
            <button className="modal-close" onClick={onDone}>✕</button>
          )}
        </div>
      </div>

      {/* Phase content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: 560, margin: '0 auto', width: '100%', overflow: 'hidden' }}>
        {phase === 'select'     && <SelectPhase onFiles={handleFilesSelected} onClose={onDone} />}
        {phase === 'grouping'   && (
          <GroupingPhase
            items={items}
            onLink={handleLink}
            onUnlink={handleUnlink}
            onStart={startProcessing}
            onAddFiles={handleAddFiles}
            onCancel={handleCancel}
            onRemove={handleRemove}
            linkingFromId={linkingFromId}
            setLinkingFromId={setLinkingFromId}
          />
        )}
        {phase === 'processing' && <ProcessingPhase items={items} thumbnailSize={thumbnailSize} />}
        {phase === 'reviewing'  && (
          <ReviewPhase
            key={current}
            items={items}
            currentIndex={current}
            onSave={handleSave}
            onSkip={handleSkip}
            onSwap={() => handleSwapPhotos(current)}
            onPrev={current > 0 ? handlePrev : null}
            thumbnailSize={thumbnailSize}
          />
        )}
        {phase === 'summary'    && <SummaryPhase items={items} onDone={onDone} thumbnailSize={thumbnailSize} />}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
