import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// ─── Constants ────────────────────────────────────────────────────────────────

const CALIBRATION_LABELS = [
  ['most_like_me', 'Most like me'],
  ['close_but_off', 'Close but off'],
  ['wrong_energy', 'Wrong energy'],
  ['looks_older_than_me', 'Looks older than me'],
  ['face_drift', 'Face drift'],
  ['expression_drift', 'Expression drift'],
  ['lost_resemblance', 'Lost resemblance'],
  ['too_polished', 'Too polished'],
  ['too_corporate', 'Too corporate'],
  ['too_conservative', 'Too conservative'],
  ['catalog_drift', 'Catalog drift'],
  ['generic_ai_woman', 'Generic AI woman drift'],
  ['mature_luxury_drift', 'Mature luxury drift'],
  ['wrong_proportions', 'Wrong proportions'],
  ['wrong_silhouette', 'Wrong silhouette'],
]

const SAVED_BOARD_FEEDBACK_LABELS = [
  ['signature', 'Signature'],
  ['works', 'Works'],
  ['almost', 'Almost'],
  ['not_me', 'Not me'],
  ['too_safe', 'Too safe'],
  ['too_boho', 'Costume drift'],
  ['too_polished', 'Too polished'],
  ['too_soft', 'Too soft'],
  ['too_generic', 'Too generic'],
  ['wrong_proportions', 'Wrong styling proportions'],
  ['body_proportions_drift', 'Body proportions drift'],
  ['wrong_silhouette', 'Wrong silhouette'],
  ['wrong_length', 'Wrong length (hem/sleeves)'],
  ['wrong_energy', 'Wrong energy'],
  ['catalog_drift', 'Catalog drift'],
  ['bad_reference', 'Bad reference'],
]

// ─── VisualLab ────────────────────────────────────────────────────────────────
// The calibration library panel. Manages:
//   - Reference images (good, bad, real photos) uploaded to calibrate
//     the visual generation renderer
//   - Saved boards (AI-generated outfit visuals the user has saved)
//     which also serve as calibration data
//
// Props:
//   activeContext   — { type, id, name } — not directly used in this panel
//                     but kept for future per-context filtering
//   boardSaveCount  — incremented by StylistChat on each board save;
//                     VisualLab watches this to refresh its saved-boards list
//   onClose         — called when the user closes the panel
// ──────────────────────────────────────────────────────────────────────────────

export default function VisualLab({ activeContext, onGoToThread } = {}) {
  const [calibrationImages, setCalibrationImages]           = useState([])
  const [calibrationFilter, setCalibrationFilter]           = useState('active')
  const [calibrationUploadFile, setCalibrationUploadFile]   = useState(null)
  const [calibrationUploadPrev, setCalibrationUploadPrev]   = useState(null)
  const [calibrationKind, setCalibrationKind]               = useState('good_reference')
  const [calibrationLabels, setCalibrationLabels]           = useState([])
  const [calibrationNotes, setCalibrationNotes]             = useState('')
  const [calibrationUploading, setCalibrationUploading]     = useState(false)
  const [calibrationEditingId, setCalibrationEditingId]     = useState(null)
  const [calibrationEditKind, setCalibrationEditKind]       = useState('good_reference')
  const [calibrationEditLabels, setCalibrationEditLabels]   = useState([])
  const [calibrationEditNotes, setCalibrationEditNotes]     = useState('')
  const [savedBoards, setSavedBoards]                       = useState([])
  const [savedBoardsLoading, setSavedBoardsLoading]         = useState(false)
  const [previewImage, setPreviewImage]                     = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  // activeSection is URL-backed (survives tab switches); sub-filters stay local.
  const VALID_SECTIONS = ['references', 'saved', 'upload']
  const rawSection  = searchParams.get('section')
  const activeSection = VALID_SECTIONS.includes(rawSection) ? rawSection : 'references'
  const setActiveSection = (section) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (!section || section === 'references') { next.delete('section') } else { next.set('section', section) }
      return next
    }, { replace: true })
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadCalibrationImages = async () => {
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (calibrationFilter === 'ignored') params.set('includeArchived', 'true')
      if (['good_reference', 'bad_reference', 'real_photo'].includes(calibrationFilter)) {
        params.set('kind', calibrationFilter)
      }
      const res = await fetch(`/api/calibration-images?${params.toString()}`)
      const rows = await res.json()
      let list = Array.isArray(rows) ? rows : []
      if (calibrationFilter === 'strong')  list = list.filter(r => r.favorite)
      if (calibrationFilter === 'ignored') list = list.filter(r => r.archived)
      setCalibrationImages(list)
    } catch {
      setCalibrationImages([])
    }
  }

  const loadSavedBoards = async () => {
    setSavedBoardsLoading(true)
    try {
      const params = new URLSearchParams({ limit: '80' })
      const res = await fetch(`/api/saved-boards?${params.toString()}`)
      const rows = await res.json()
      setSavedBoards(Array.isArray(rows) ? rows : [])
    } catch {
      setSavedBoards([])
    } finally {
      setSavedBoardsLoading(false)
    }
  }

  const refresh = async () => {
    await Promise.all([loadCalibrationImages(), loadSavedBoards()])
  }

  // Refresh when panel opens or filter changes
  useEffect(() => { refresh() }, [calibrationFilter])



  // ── Calibration image actions ─────────────────────────────────────────────────

  const handleUploadFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCalibrationUploadFile(f)
    const reader = new FileReader()
    reader.onload = ev => setCalibrationUploadPrev(ev.target.result)
    reader.readAsDataURL(f)
  }

  const toggleLabel = (label) => {
    setCalibrationLabels(prev =>
      prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
    )
  }

  const toggleEditLabel = (label) => {
    setCalibrationEditLabels(prev =>
      prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label]
    )
  }

  const saveCalibrationImage = async () => {
    if (!calibrationUploadFile) return
    setCalibrationUploading(true)
    try {
      const fd = new FormData()
      fd.append('photo', calibrationUploadFile)
      fd.append('kind', calibrationKind)
      fd.append('labels', JSON.stringify(calibrationLabels))
      fd.append('notes', calibrationNotes)
      fd.append('source', 'uploaded')
      const res = await fetch('/api/calibration-images', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      setCalibrationUploadFile(null)
      setCalibrationUploadPrev(null)
      setCalibrationLabels([])
      setCalibrationNotes('')
      await loadCalibrationImages()
    } catch (err) {
      alert(`Could not save calibration image: ${err.message}`)
    } finally {
      setCalibrationUploading(false)
    }
  }

  const archiveCalibrationImage = async (id, archived = true) => {
    await fetch(`/api/calibration-images/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    })
    await loadCalibrationImages()
  }

  const toggleFavorite = async (row) => {
    await fetch(`/api/calibration-images/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !row.favorite }),
    })
    await loadCalibrationImages()
  }

  const startEdit = (row) => {
    setCalibrationEditingId(row.id)
    setCalibrationEditKind(row.kind || 'good_reference')
    setCalibrationEditLabels(Array.isArray(row.labels) ? row.labels : [])
    setCalibrationEditNotes(row.notes || '')
  }

  const cancelEdit = () => {
    setCalibrationEditingId(null)
    setCalibrationEditLabels([])
    setCalibrationEditNotes('')
  }

  const saveEdit = async (id) => {
    await fetch(`/api/calibration-images/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: calibrationEditKind,
        labels: calibrationEditLabels,
        notes: calibrationEditNotes,
      }),
    })
    cancelEdit()
    await loadCalibrationImages()
  }

  // ── Saved board actions ───────────────────────────────────────────────────────

  const patchSavedBoard = async (row, patch) => {
    const res = await fetch(`/api/saved-boards/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return null
    const updated = await res.json().catch(() => null)
    if (updated?.id) {
      setSavedBoards(prev => prev.map(b => String(b.id) === String(updated.id) ? updated : b))
    } else {
      await loadSavedBoards()
    }
    return updated
  }

  const deleteSavedBoard = async (id) => {
    try {
      const res = await fetch(`/api/saved-boards/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await res.text())
      setSavedBoards(prev => prev.filter(b => b.id !== id))
    } catch (err) {
      alert(`Could not delete board: ${err.message}`)
    }
  }

  const toggleBoardFeedback = async (row, label) => {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
    const current = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    const isAdding = !current.includes(label)
    const nextLabels = isAdding ? [...current, label] : current.filter(x => x !== label)
    const patch = { feedbackLabels: nextLabels }
    if (label === 'signature' && isAdding) patch.favorite = true
    if (['not_me', 'bad_reference', 'catalog_drift', 'wrong_proportions', 'body_proportions_drift', 'wrong_silhouette', 'wrong_length', 'wrong_energy'].includes(label) && isAdding) {
      patch.favorite = false
    }
    await patchSavedBoard(row, patch)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="view-header sticky-header">
        <div className="view-header-top">
          <div>
            <div className="view-title">Visual Lab</div>
            <div className="view-subtitle">
              {activeSection === 'references' && `${calibrationImages.length} references`}
              {activeSection === 'saved' && `${savedBoards.length} saved boards`}
              {activeSection === 'upload' && 'Upload new reference photo'}
              {!activeSection && 'Curate visual references and calibration boards'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="chip active" onClick={refresh}>Refresh</button>
          </div>
        </div>

        <div className="filter-row" style={{ marginBottom: 0 }}>
          {[
            ['references', 'References'],
            ['saved', 'Saved boards'],
            ['upload', 'Upload Reference'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`chip ${activeSection === value ? 'active' : ''}`}
              onClick={() => setActiveSection(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 20px 24px' }}>

      {/* Upload row */}
      {activeSection === 'upload' && (
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 14, alignItems: 'start', marginBottom: 12, padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 10 }}>
          <label style={{ width: 120, height: 150, border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}>
            {calibrationUploadPrev ? (
              <img src={calibrationUploadPrev} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>Upload reference</span>
            )}
            <input type="file" accept="image/*" onChange={handleUploadFile} style={{ display: 'none' }} />
          </label>
          <div style={{ display: 'grid', gap: 8 }}>
            <select value={calibrationKind} onChange={e => setCalibrationKind(e.target.value)}
              style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
              <option value="good_reference">Good reference</option>
              <option value="bad_reference">Bad / drift reference</option>
              <option value="real_photo">Real outfit photo</option>
            </select>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {CALIBRATION_LABELS.map(([value, label]) => (
                <button key={value} type="button" onClick={() => toggleLabel(value)}
                  style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 12, cursor: 'pointer',
                    border: calibrationLabels.includes(value) ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: calibrationLabels.includes(value) ? 'var(--accent-light)' : 'var(--surface)',
                    color: calibrationLabels.includes(value) ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >{label}</button>
              ))}
            </div>
            <textarea value={calibrationNotes} onChange={e => setCalibrationNotes(e.target.value)}
              placeholder="Short note: why this feels right/wrong…" rows={2}
              style={{ width: '100%', resize: 'vertical', padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
            />
            <button className="chip" onClick={saveCalibrationImage}
              disabled={!calibrationUploadFile || calibrationUploading}
              style={{ justifySelf: 'start' }}>
              {calibrationUploading ? 'Saving…' : 'Save calibration image'}
            </button>
          </div>
        </div>
      )}

      {/* Reference images grid */}
      {activeSection === 'references' && (
        <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {[
            ['active', 'Active'],
            ['strong', 'Use strongly'],
            ['good_reference', 'Good'],
            ['bad_reference', 'Bad / drift'],
            ['real_photo', 'Real photos'],
            ['ignored', 'Ignored'],
          ].map(([value, label]) => (
            <button
              key={value}
              className="chip"
              onClick={() => setCalibrationFilter(value)}
              style={{
                fontSize: 11,
                background: calibrationFilter === value ? 'var(--accent-light)' : undefined,
                color: calibrationFilter === value ? 'var(--accent)' : undefined,
                borderColor: calibrationFilter === value ? 'var(--accent)' : undefined,
              }}
            >{label}</button>
          ))}
        </div>
        {!calibrationImages.length ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No calibration images in this filter.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
          {calibrationImages.map(row => {
            const isEditing = calibrationEditingId === row.id
            return (
              <div key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: row.archived ? 'rgba(120,120,120,0.08)' : 'var(--surface-2)', opacity: row.archived ? 0.68 : 1 }}>
                <button
                  type="button"
                  onClick={() => setPreviewImage({ src: row.image_url, title: row.kind?.replaceAll('_', ' ') || 'Calibration image', meta: row.notes || '' })}
                  style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in' }}
                  aria-label="Open calibration image preview"
                >
                  <img src={row.image_url} alt="Calibration" style={{ width: '100%', height: 170, objectFit: 'cover', display: 'block' }} />
                </button>
                <div style={{ padding: 8, display: 'grid', gap: 6 }}>
                  {isEditing ? (
                    <>
                      <select value={calibrationEditKind} onChange={e => setCalibrationEditKind(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11 }}>
                        <option value="good_reference">Good reference</option>
                        <option value="bad_reference">Bad / drift reference</option>
                        <option value="real_photo">Real outfit photo</option>
                      </select>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {CALIBRATION_LABELS.map(([value, label]) => (
                          <button key={value} type="button" onClick={() => toggleEditLabel(value)}
                            style={{
                              fontSize: 9, padding: '2px 6px', borderRadius: 12, cursor: 'pointer',
                              border: calibrationEditLabels.includes(value) ? '1px solid var(--accent)' : '1px solid var(--border)',
                              background: calibrationEditLabels.includes(value) ? 'var(--accent-light)' : 'var(--surface)',
                              color: calibrationEditLabels.includes(value) ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >{label}</button>
                        ))}
                      </div>
                      <textarea value={calibrationEditNotes} onChange={e => setCalibrationEditNotes(e.target.value)} rows={3}
                        style={{ width: '100%', resize: 'vertical', padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11 }}
                      />
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => saveEdit(row.id)}>Save</button>
                        <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={cancelEdit}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: row.kind === 'bad_reference' ? '#9b4a3f' : 'var(--accent)' }}>
                          {row.favorite ? '★ ' : ''}{row.kind?.replaceAll('_', ' ')}
                        </div>
                        {row.archived && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>ignored</span>}
                      </div>
                      {!!row.labels?.length && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {row.labels.slice(0, 6).map(label => (
                            <span key={label} style={{ fontSize: 9, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px' }}>
                              {label.replaceAll('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                      {row.notes && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{row.notes}</div>}
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => toggleFavorite(row)}>
                          {row.favorite ? 'Use normal' : 'Use strongly'}
                        </button>
                        <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => startEdit(row)}>Edit</button>
                        {row.archived ? (
                          <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => archiveCalibrationImage(row.id, false)}>Restore</button>
                        ) : (
                          <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => archiveCalibrationImage(row.id, true)}>Ignore</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          </div>
        )}
        </>
      )}

      {/* ── Saved boards sub-section ─────────────────────────────────────────── */}
      {activeSection === 'saved' && (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Saved visual boards</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Saved boards are calibration references too. Star the ones that should strongly guide future styling/rendering.
            </div>
          </div>
          <button className="chip" onClick={loadSavedBoards} disabled={savedBoardsLoading}>
            {savedBoardsLoading ? 'Loading…' : 'Refresh boards'}
          </button>
        </div>

        {!savedBoards.length ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {activeContext ? `No saved boards for ${activeContext.name} yet.` : 'No saved boards yet.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {savedBoards.map(board => (
              <div key={board.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: board.archived ? 'rgba(120,120,120,0.08)' : 'var(--surface-2)', opacity: board.archived ? 0.65 : 1 }}>
                {board.image_url && (
                  <button
                    type="button"
                    onClick={() => setPreviewImage({ src: board.image_url, title: board.title || 'Saved board', meta: board.context_name || '' })}
                    style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in' }}
                    aria-label="Open saved board preview"
                  >
                    <img src={board.image_url} alt={board.title || 'Saved board'} style={{ width: '100%', height: 190, objectFit: 'cover', display: 'block' }} />
                  </button>
                )}
                <div style={{ padding: 8, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: board.favorite ? 'var(--accent)' : 'var(--text)' }}>
                        {board.favorite ? '★ ' : ''}{board.title || 'Saved board'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {board.board_type || 'board'}{board.context_name ? ` · ${board.context_name}` : ''}
                      </div>
                    </div>
                    {board.archived && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>ignored</span>}
                  </div>
                  {Array.isArray(board.pieces) && board.pieces.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                      {board.pieces.slice(0, 4).map(p => p?.name).filter(Boolean).join(' + ')}
                    </div>
                  )}
                  {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{board.reason}</div>}
                  {board.payload?.threadId && board.payload.threadId !== 'new_chat' && (
                    <button
                      onClick={() => onGoToThread?.(board.payload.threadId)}
                      style={{
                        fontSize: 10,
                        color: 'var(--accent)',
                        background: 'transparent',
                        border: 'none',
                        padding: '2px 0',
                        cursor: 'pointer',
                        textAlign: 'left',
                        textDecoration: 'underline',
                        justifySelf: 'start',
                        marginTop: 2,
                        marginBottom: 2
                      }}
                    >
                      💬 View generating chat
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }}
                      onClick={() => patchSavedBoard(board, { favorite: !board.favorite })}>
                      {board.favorite ? 'Use normal' : 'Use strongly'}
                    </button>
                    {board.archived ? (
                      <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }}
                        onClick={() => patchSavedBoard(board, { archived: false })}>Restore</button>
                    ) : (
                      <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }}
                        onClick={() => patchSavedBoard(board, { archived: true })}>Ignore</button>
                    )}
                    <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }}
                      onClick={() => patchSavedBoard(board, { hidden_from_lookbook: !board.hidden_from_lookbook })}>
                      {board.hidden_from_lookbook ? 'Show in Lookbook' : 'Hide from Lookbook'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                    {SAVED_BOARD_FEEDBACK_LABELS.map(([label, text]) => {
                      const active = Array.isArray(board?.payload?.feedback_labels) && board.payload.feedback_labels.includes(label)
                      return (
                        <button key={label} className="chip"
                          onClick={() => toggleBoardFeedback(board, label)}
                          title="Save this board feedback as calibration memory"
                          style={{
                            fontSize: 9, padding: '2px 6px',
                            borderColor: active ? 'var(--accent)' : 'var(--border)',
                            background: active ? 'var(--accent)' : 'var(--surface)',
                            color: active ? '#fff' : 'var(--text-muted)',
                            fontWeight: active ? 800 : 500,
                            boxShadow: active ? '0 0 0 1px rgba(122,86,43,0.25)' : undefined,
                          }}
                        >{text}</button>
                      )
                    })}
                  </div>
                  {Array.isArray(board?.payload?.feedback_labels) && board.payload.feedback_labels.length > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, marginTop: 2 }}>
                      Selected: {board.payload.feedback_labels.map(label => {
                        const found = SAVED_BOARD_FEEDBACK_LABELS.find(([v]) => v === label)
                        return found ? found[1] : label
                      }).join(', ')}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-light)' }}>
                    <button
                      className="btn-danger"
                      style={{
                        padding: '4px 10px',
                        fontSize: 10,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--danger-bg)',
                        color: 'var(--danger)',
                        border: '1px solid rgba(168,64,64,0.15)',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                      onClick={async () => {
                        if (confirm(`Delete "${board.title || 'this board'}" from everywhere?`)) {
                          await deleteSavedBoard(board.id)
                        }
                      }}
                    >
                      Delete Board
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
      </div>

      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewImage(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,18,16,0.82)', display: 'grid', placeItems: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'grid', gap: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#fff' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{previewImage.title}</div>
                {previewImage.meta && <div style={{ fontSize: 12, opacity: 0.78 }}>{previewImage.meta}</div>}
              </div>
              <button className="chip" onClick={() => setPreviewImage(null)}>Close</button>
            </div>
            <img
              src={previewImage.src}
              alt={previewImage.title}
              style={{ maxWidth: '100%', maxHeight: '84vh', objectFit: 'contain', justifySelf: 'center', borderRadius: 8, boxShadow: '0 18px 60px rgba(0,0,0,0.35)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
