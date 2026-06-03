import { useState, useRef } from 'react'

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']
const OCCASIONS  = ['casual', 'city', 'evening', 'smart-casual', 'outdoor', 'home']
const SEASONS    = ['warm', 'cool', 'year-round']
const COLOR_OPTIONS = [
  { name: 'black', hex: '#2A2420' }, { name: 'white', hex: '#F5F2EC' },
  { name: 'cream', hex: '#E8DFC8' }, { name: 'beige', hex: '#D6C3A3' },
  { name: 'taupe', hex: '#9C8B78' }, { name: 'grey', hex: '#9A9A9A' },
  { name: 'charcoal', hex: '#484848' }, { name: 'navy', hex: '#1E2D4A' },
  { name: 'denim', hex: '#4F6F8F' }, { name: 'brown', hex: '#7A5A3A' },
  { name: 'tan', hex: '#C0A070' }, { name: 'oatmeal', hex: '#D8C8B0' },
  { name: 'amber', hex: '#B07820' }, { name: 'mustard', hex: '#B89020' },
  { name: 'orange', hex: '#C86030' }, { name: 'red', hex: '#A83A2A' },
  { name: 'pink', hex: '#C07080' }, { name: 'mauve', hex: '#A7798A' },
  { name: 'lavender', hex: '#A99AC2' }, { name: 'lilac', hex: '#C4B2D8' },
  { name: 'plum', hex: '#5A3060' },
  { name: 'green', hex: '#3A6A3A' }, { name: 'olive', hex: '#5A6030' },
  { name: 'turquoise', hex: '#2A8080' }, { name: 'light blue', hex: '#7AADCC' },
  { name: 'periwinkle', hex: '#8888CC' }, { name: 'dark blue', hex: '#1A2040' },
  { name: 'dark grey', hex: '#484848' }, { name: 'light grey', hex: '#B8B8B8' },
  { name: 'multi', hex: '#8A6848' },
]
const LIGHT_COLORS = ['white', 'cream', 'beige', 'oatmeal', 'light grey', 'lavender', 'lilac']

function emptyForm() {
  return {
    name: '', category: 'top', colors: [], occasions: [], season: 'year-round', notes: '', status: 'active',
    pattern_type: null, pattern_scale: null, pattern_complexity: null, reads_as: '',
    hem_finish: null, neckline: null, sleeve_type: null, length_hits_at: null,
    silhouette: null, fabric_category: null, fabric_weight: null,
    stretch: null, fit_on_body: null, tuck_behavior: null, waistband_type: null,
    style_profile_json: {},
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
function SelectPhase({ onFiles }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  const handleFiles = (fileList) => {
    const images = Array.from(fileList).filter(f => f.type.startsWith('image/'))
    if (images.length) onFiles(images)
  }

  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
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
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
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
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Claude is reading this piece
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

// ── Phase: Review (one item at a time) ────────────────────────────────────────
function ReviewPhase({ items, currentIndex, onSave, onSkip, thumbnailSize }) {
  const item = items[currentIndex]
  const total = items.length
  const [form, setForm] = useState({ ...emptyForm(), ...item.form })
  const [saving, setSaving] = useState(false)

  const set       = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleArr = (k, val) => setForm(f => ({
    ...f,
    [k]: f[k].includes(val) ? f[k].filter(x => x !== val) : [...f[k], val]
  }))

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => {
        if (v !== null && v !== undefined) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v)
      })
      fd.append('photo', item.file)
      const res = await fetch('/api/pieces', { method: 'POST', body: fd })
      await res.json()
      onSave()
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

        {/* Photo */}
        <img src={item.preview} alt="" style={{ width: '100%', maxHeight: thumbnailSize, objectFit: 'contain', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }} />

        {item.status === 'error' && (
          <div style={{ padding: '10px 14px', background: 'var(--repair-bg)', color: 'var(--repair)', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
            Tagging failed for this photo — fill in manually.
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
          <label className="form-label">Occasions</label>
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

        {/* Notes */}
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" placeholder="Optional…" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

      </div>

      {/* Fixed bottom actions */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: 10 }}>
        <button className="btn-secondary" onClick={onSkip} style={{ minWidth: 80 }}>Skip</button>
        <button className="btn-primary" onClick={handleSave} disabled={saving || !form.name.trim()} style={{ flex: 1 }}>
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
    <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center' }}>
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
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(90,122,90,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>✓</div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-primary" onClick={onDone} style={{ width: '100%', maxWidth: 280 }}>
        Back to wardrobe
      </button>
    </div>
  )
}

// ── Main BatchAdd orchestrator ─────────────────────────────────────────────────
export default function BatchAdd({ onDone }) {
  const [phase,   setPhase]   = useState('select')   // select | processing | reviewing | summary
  const [items,   setItems]   = useState([])
  const [current, setCurrent] = useState(0)
  const [thumbnailSize, setThumbnailSize] = useState(260)

  const updateItem = (index, patch) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, ...patch } : it))
  }

  // ── Start processing: tag all photos sequentially ──────────────────────────
  const startProcessing = async (files) => {
    const initial = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      tags:    null,
      form:    emptyForm(),
      status:  'pending',
    }))
    setItems(initial)
    setPhase('processing')

    const updated = [...initial]
    for (let i = 0; i < files.length; i++) {
      // mark as tagging
      updated[i] = { ...updated[i], status: 'tagging' }
      setItems([...updated])

      try {
        const fd = new FormData()
        fd.append('photo', files[i])
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
            style_profile_json: tags.style_profile_json || {},
          },
          status: 'ready',
        }
      } catch {
        updated[i] = { ...updated[i], status: 'error', form: emptyForm() }
      }
      setItems([...updated])
    }

    // All done — move to review
    setCurrent(0)
    setPhase('reviewing')
  }

  // ── Save current item ──────────────────────────────────────────────────────
  const handleSave = () => {
    updateItem(current, { status: 'saved' })
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--surface)', zIndex: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: 560, margin: '0 auto', width: '100%' }}>
        {phase === 'select'     && <SelectPhase onFiles={startProcessing} />}
        {phase === 'processing' && <ProcessingPhase items={items} thumbnailSize={thumbnailSize} />}
        {phase === 'reviewing'  && (
          <ReviewPhase
            key={current}
            items={items}
            currentIndex={current}
            onSave={handleSave}
            onSkip={handleSkip}
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
