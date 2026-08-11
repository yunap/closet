import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import StylistSettings from '../views/StylistSettings'
import { uploadThumbnailSrc } from '../utils/uploadThumbnails.js'
import {
  OVERALL_VERDICT_LABELS,
  STYLE_DIRECTION_REASONS,
  SHAPE_BALANCE_REASONS,
  IMAGE_FIDELITY_FEEDBACK_LABELS,
  wrongLengthReasonsForCategory,
  SAVED_BOARD_FEEDBACK_DISPLAY_LABELS,
} from '../../lib/feedbackTaxonomy.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const POSITIVE_REFERENCE_LABELS = [
  ['most_like_me', 'Most like me'],
  ['right_energy', 'Right energy'],
  ['strong_silhouette', 'Strong silhouette'],
  ['right_proportions', 'Right proportions'],
  ['grounded', 'Grounded'],
  ['artistic', 'Artistic'],
]

const DRIFT_REFERENCE_LABELS = [
  ['close_but_off', 'Close but off'],
  ['wrong_energy', 'Wrong energy'],
  ['looks_older_than_me', 'Looks older than me'],
  ['face_drift', 'Face drift'],
  ['expression_drift', 'Expression drift'],
  ['lost_resemblance', 'Lost resemblance'],
  ['too_polished', 'Too polished'],
  ['too_corporate', 'Too corporate'],
  ['too_conservative', 'Too conservative'],
  ['generic_ai_woman', 'Generic AI woman drift'],
  ['mature_luxury_drift', 'Mature luxury drift'],
  ['wrong_silhouette', 'Wrong silhouette'],
]

const REAL_PHOTO_LABELS = [
  ['most_like_me', 'Feels like me'],
  ['right_energy', 'Right energy'],
  ['strong_silhouette', 'Silhouette works'],
  ['right_proportions', 'Proportions work'],
  ['close_but_off', 'Close but off'],
  ['wrong_silhouette', 'Silhouette feels off'],
]

const CALIBRATION_LABELS_BY_KIND = {
  good_reference: POSITIVE_REFERENCE_LABELS,
  bad_reference: DRIFT_REFERENCE_LABELS,
  real_photo: REAL_PHOTO_LABELS,
}

const ALL_CALIBRATION_LABELS = Array.from(new Map(
  [...POSITIVE_REFERENCE_LABELS, ...DRIFT_REFERENCE_LABELS, ...REAL_PHOTO_LABELS]
    .map(option => [option[0], option])
).values())

const calibrationLabelsForKind = (kind, selected = []) => {
  const contextual = CALIBRATION_LABELS_BY_KIND[kind] || POSITIVE_REFERENCE_LABELS
  const contextualValues = new Set(contextual.map(([value]) => value))
  const legacySelected = ALL_CALIBRATION_LABELS.filter(([value]) =>
    selected.includes(value) && !contextualValues.has(value)
  )
  return [...contextual, ...legacySelected]
}

const savedBoardReviewState = (board) => {
  const labels = Array.isArray(board?.payload?.feedback_labels) ? board.payload.feedback_labels : []
  const imageIssueValues = new Set(IMAGE_FIDELITY_FEEDBACK_LABELS.map(([value]) => value))
  const verdict = OVERALL_VERDICT_LABELS.find(([value]) => labels.includes(value))
  const hasImageIssue = labels.some(label => imageIssueValues.has(label))
  return {
    value: verdict?.[0] || 'unreviewed',
    label: verdict?.[1] || 'Not reviewed',
    hasImageIssue,
  }
}

// ─── VisualLab ────────────────────────────────────────────────────────────────
// The calibration library panel, a standalone tab. Manages:
//   - Reference images (good, bad, real photos) uploaded to calibrate
//     the visual generation renderer
//   - Saved boards (AI-generated outfit visuals the user has saved)
//     which also serve as calibration data
// ──────────────────────────────────────────────────────────────────────────────

export default function VisualLab({ onGoToThread } = {}) {
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
  const [selectedBoard, setSelectedBoard]                   = useState(null)
  const [savedBoardFilter, setSavedBoardFilter]             = useState('all')
  const [savedBoardStatusFilter, setSavedBoardStatusFilter] = useState('all')
  const [savedBoardSearch, setSavedBoardSearch]             = useState('')
  const [savedBoardsError, setSavedBoardsError]             = useState('')
  const [savedBoardPending, setSavedBoardPending]           = useState(false)
  const [savedBoardNotice, setSavedBoardNotice]             = useState('')
  const [specificFeedbackOpen, setSpecificFeedbackOpen]     = useState(false)
  const [pendingVerdictComment, setPendingVerdictComment]   = useState(null)
  const [verdictComment, setVerdictComment]                 = useState('')
  const boardDialogRef = useRef(null)
  const boardCloseRef = useRef(null)
  const previewDialogRef = useRef(null)
  const previewImageRef = useRef(null)
  const boardReturnFocusRef = useRef(null)
  const previewReturnFocusRef = useRef(null)
  const [searchParams, setSearchParams] = useSearchParams()
  previewImageRef.current = previewImage
  // activeSection is URL-backed (survives tab switches); sub-filters stay local.
  const VALID_SECTIONS = ['references', 'saved', 'profile', 'upload']
  const rawSection  = searchParams.get('section')
  const requestedBoardId = searchParams.get('boardId')
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
    setSavedBoardsError('')
    try {
      const params = new URLSearchParams({ limit: '200', includeArchived: 'true' })
      const res = await fetch(`/api/saved-boards?${params.toString()}`)
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const rows = await res.json()
      const list = Array.isArray(rows) ? rows : []
      setSavedBoards(list)
    } catch {
      setSavedBoardsError('Calibration boards could not be loaded. Your saved feedback is still safe.')
    } finally {
      setSavedBoardsLoading(false)
    }
  }

  const refresh = async () => {
    await Promise.all([loadCalibrationImages(), loadSavedBoards()])
  }

  // Refresh when panel opens or filter changes
  useEffect(() => { refresh() }, [calibrationFilter])

  useEffect(() => {
    if (!requestedBoardId) return
    const requested = savedBoards.find(board => String(board.id) === String(requestedBoardId))
    if (requested) {
      setSelectedBoard(requested)
      return
    }
    let cancelled = false
    fetch(`/api/saved-boards/${encodeURIComponent(requestedBoardId)}`)
      .then(async response => response.ok ? response.json() : null)
      .then(board => {
        if (cancelled || !board?.id) return
        setSavedBoards(previous => previous.some(row => String(row.id) === String(board.id)) ? previous : [...previous, board])
        setSelectedBoard(board)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [requestedBoardId, savedBoards])

  const closeSelectedBoard = () => {
    setSelectedBoard(null)
    if (!requestedBoardId) return
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.delete('boardId')
      return next
    }, { replace: true })
  }

  useEffect(() => {
    if (!selectedBoard) return undefined
    const labels = Array.isArray(selectedBoard?.payload?.feedback_labels) ? selectedBoard.payload.feedback_labels : []
    const hasSpecificFeedback = labels.some(label =>
      ['style_direction', 'shape_balance', ...IMAGE_FIDELITY_FEEDBACK_LABELS.map(([value]) => value)].includes(label)
    )
    setSpecificFeedbackOpen(hasSpecificFeedback || labels.some(label => ['almost', 'not_me'].includes(label)))
    setSavedBoardNotice('')

    const main = document.querySelector('.app-main')
    const previousBodyOverflow = document.body.style.overflow
    const previousMainOverflow = main?.style?.overflow
    document.body.style.overflow = 'hidden'
    if (main) main.style.overflow = 'hidden'
    requestAnimationFrame(() => boardCloseRef.current?.focus())

    const handleDialogKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (previewImageRef.current) closePreviewImage()
        else closeSelectedBoard()
        return
      }
      if (event.key !== 'Tab') return
      const scope = previewImageRef.current ? previewDialogRef.current : boardDialogRef.current
      const focusable = [...(scope?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      ) || [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown)
      document.body.style.overflow = previousBodyOverflow
      if (main) main.style.overflow = previousMainOverflow || ''
      boardReturnFocusRef.current?.focus?.()
    }
  }, [selectedBoard?.id])

  useEffect(() => {
    if (!previewImage) return
    requestAnimationFrame(() => previewDialogRef.current?.querySelector('button')?.focus())
  }, [previewImage])

  const closePreviewImage = () => {
    setPreviewImage(null)
    requestAnimationFrame(() => previewReturnFocusRef.current?.focus?.())
  }

  const filteredSavedBoards = useMemo(() => {
    const imageIssueValues = new Set(IMAGE_FIDELITY_FEEDBACK_LABELS.map(([value]) => value))
    // "Almost right" is a positive-leaning verdict (close, not rejected — see
    // getSavedBoardMemory's close-bucket handling), so it belongs with the other positive
    // verdicts, not lumped in with actual negative/critique feedback.
    const positiveValues = new Set(['signature', 'works', 'almost'])
    const flaggedValues = new Set([
      'not_me', 'style_direction', 'shape_balance',
      ...STYLE_DIRECTION_REASONS.map(([value]) => value),
      ...SHAPE_BALANCE_REASONS.map(([value]) => value),
      'wrong_energy', 'wrong_silhouette',
    ])
    const query = savedBoardSearch.trim().toLowerCase()
    return savedBoards.filter(board => {
      const labels = Array.isArray(board?.payload?.feedback_labels) ? board.payload.feedback_labels : []
      const matchesFilter = (() => {
        if (board.archived && savedBoardStatusFilter !== 'ignored') return false
        const state = savedBoardReviewState(board)
        if (savedBoardFilter === 'unreviewed') return state.value === 'unreviewed'
        if (savedBoardFilter === 'positive') return labels.some(label => positiveValues.has(label))
        if (savedBoardFilter === 'flagged') return labels.some(label => flaggedValues.has(label))
        if (savedBoardFilter === 'image') return labels.some(label => imageIssueValues.has(label))
        return true
      })()
      const matchesStatus = (() => {
        if (savedBoardStatusFilter === 'strong') return board.favorite
        if (savedBoardStatusFilter === 'hidden') return board.hidden_from_lookbook
        if (savedBoardStatusFilter === 'ignored') return board.archived
        return !board.archived
      })()
      if (!matchesFilter || !matchesStatus || !query) return matchesFilter && matchesStatus
      const searchable = [
        board.title,
        board.context_name,
        board.reason,
        ...(board.pieces || []).map(piece => piece?.name),
        ...labels.map(label => SAVED_BOARD_FEEDBACK_DISPLAY_LABELS.find(([value]) => value === label)?.[1] || label),
      ].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(query)
    })
  }, [savedBoards, savedBoardFilter, savedBoardStatusFilter, savedBoardSearch])



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

  const changeCalibrationKind = (kind) => {
    const allowed = new Set((CALIBRATION_LABELS_BY_KIND[kind] || []).map(([value]) => value))
    setCalibrationKind(kind)
    setCalibrationLabels(prev => prev.filter(label => allowed.has(label)))
  }

  const changeCalibrationEditKind = (kind) => {
    const allowed = new Set((CALIBRATION_LABELS_BY_KIND[kind] || []).map(([value]) => value))
    setCalibrationEditKind(kind)
    setCalibrationEditLabels(prev => prev.filter(label => allowed.has(label)))
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
    setSavedBoardPending(true)
    setSavedBoardNotice('')
    try {
      const res = await fetch(`/api/saved-boards/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const updated = await res.json().catch(() => null)
      if (updated?.id) {
        setSavedBoards(prev => prev.map(b => String(b.id) === String(updated.id) ? updated : b))
        setSelectedBoard(prev => String(prev?.id) === String(updated.id) ? updated : prev)
      } else {
        await loadSavedBoards()
      }
      setSavedBoardNotice('Feedback saved')
      return updated
    } catch (error) {
      setSavedBoardNotice('Could not save this change. Please try again.')
      return null
    } finally {
      setSavedBoardPending(false)
    }
  }

  const deleteSavedBoard = async (id) => {
    try {
      const res = await fetch(`/api/saved-boards/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(await res.text())
      setSavedBoards(prev => prev.filter(b => b.id !== id))
      setSelectedBoard(prev => String(prev?.id) === String(id) ? null : prev)
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
    if (label === 'wrong_length' && !isAdding) {
      patch.feedbackDetails = { ...(payload.feedback_details || {}), wrong_length: [] }
    }
    if (['body_proportions_drift', 'wrong_length', 'wrong_garment_details', 'identity_drift'].includes(label) && isAdding) {
      patch.favorite = false
    }
    await patchSavedBoard(row, patch)
  }

  const selectOverallVerdict = async (row, label, { skipCommentPrompt = false, ownerComment = null } = {}) => {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
    const current = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    const verdictValues = new Set(OVERALL_VERDICT_LABELS.map(([value]) => value))
    const isActive = current.includes(label)
    if (!isActive && !skipCommentPrompt && ['almost', 'not_me'].includes(label)) {
      setPendingVerdictComment({ row, label })
      setVerdictComment(String(payload.feedback_details?.owner_comment || ''))
      return
    }
    const wasSignature = current.includes('signature')
    const nextLabels = current.filter(value => !verdictValues.has(value))
    if (!isActive) nextLabels.push(label)
    const details = payload.feedback_details && typeof payload.feedback_details === 'object'
      ? payload.feedback_details
      : {}
    await patchSavedBoard(row, {
      feedbackLabels: nextLabels,
      ...(ownerComment === null ? {} : {
        feedbackDetails: { ...details, owner_comment: String(ownerComment || '').trim() },
      }),
      favorite: label === 'signature' && !isActive
        ? true
        : ((wasSignature || ['almost', 'not_me'].includes(label)) && !isActive ? false : undefined),
    })
  }

  const commitVerdictComment = async (comment = '') => {
    if (!pendingVerdictComment) return
    await selectOverallVerdict(pendingVerdictComment.row, pendingVerdictComment.label, {
      skipCommentPrompt: true,
      ownerComment: comment,
    })
    setPendingVerdictComment(null)
    setVerdictComment('')
  }

  const toggleStructuredFeedbackReason = async (row, label, reason) => {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
    const details = payload.feedback_details && typeof payload.feedback_details === 'object'
      ? payload.feedback_details
      : {}
    const current = Array.isArray(details[label]) ? details[label] : []
    const next = current.includes(reason) ? current.filter(value => value !== reason) : [...current, reason]
    const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    const nextLabels = next.length
      ? (labels.includes(label) ? labels : [...labels, label])
      : labels.filter(value => value !== label)
    await patchSavedBoard(row, {
      feedbackLabels: nextLabels,
      feedbackDetails: { ...details, [label]: next },
      favorite: false,
    })
  }

  const toggleWrongLengthReason = async (row, rawPieceId, issue) => {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
    const details = payload.feedback_details && typeof payload.feedback_details === 'object' ? payload.feedback_details : {}
    const current = Array.isArray(details.wrong_length) ? details.wrong_length : []
    const pieces = Array.isArray(row?.pieces) ? row.pieces.filter(piece => Number(piece?.id)) : []
    const pieceId = Number(rawPieceId)
    const piece = pieces.find(candidate => Number(candidate.id) === pieceId)
    if (!pieceId || !piece) return
    const exists = current.some(correction => Number(correction?.piece_id) === pieceId && correction?.issue === issue)
    const next = exists
      ? current.filter(correction => !(Number(correction?.piece_id) === pieceId && correction?.issue === issue))
      : [...current, { piece_id: pieceId, piece_name: piece.name || `Piece ${pieceId}`, issue }]
    const labels = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    await patchSavedBoard(row, {
      feedbackLabels: labels.includes('wrong_length') ? labels : [...labels, 'wrong_length'],
      feedbackDetails: { ...details, wrong_length: next },
      favorite: false,
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="visual-lab-page">
      <div className="view-header sticky-header visual-lab-header">
        <div className="view-header-top">
          <div>
            <div className="view-title">Visual Lab</div>
            <div className="view-subtitle">
              {activeSection === 'references' && 'Teach the stylist what feels like you — and what does not.'}
              {activeSection === 'saved' && 'Review generated boards as evidence for future styling.'}
              {activeSection === 'profile' && 'Review the working guidance your stylist uses.'}
              {activeSection === 'upload' && 'Upload new reference photo'}
              {!activeSection && 'Curate visual references and calibration boards'}
            </div>
          </div>
          <button
            className={`chip ${activeSection === 'upload' ? 'visual-lab-back-reference' : 'visual-lab-add-reference'}`}
            onClick={() => setActiveSection(activeSection === 'upload' ? 'references' : 'upload')}
          >
            {activeSection === 'upload' ? '← Back to references' : '+ Add reference'}
          </button>
        </div>

        {activeSection !== 'upload' && <div className="filter-row visual-lab-tabs" style={{ marginBottom: 0 }}>
          {[
            ['references', 'References'],
            ['saved', 'Calibration boards'],
            ['profile', 'Style profile'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`chip ${activeSection === value ? 'active' : ''}`}
              onClick={() => setActiveSection(value)}
              aria-pressed={activeSection === value}
            >
              <strong>{label}</strong>
            </button>
          ))}
        </div>}
      </div>

      <div className="visual-lab-content">

      {/* Upload row */}
      {activeSection === 'upload' && (
        <div className="visual-reference-create">
          <div className="visual-reference-create-heading">
            <div className="visual-reference-create-eyebrow">Calibration reference</div>
            <h2>Add a visual reference</h2>
            <p>Show the stylist what feels right, what drifts, or how an outfit looks on you in real life.</p>
          </div>

          <div className="visual-reference-create-layout">
          <label className="visual-reference-dropzone">
            {calibrationUploadPrev ? (
              <img src={calibrationUploadPrev} alt="Preview" />
            ) : (
              <span>
                <strong>Choose a reference image</strong>
                <small>Portraits, outfit photos, and inspiration boards all work.</small>
              </span>
            )}
            <input type="file" accept="image/*" onChange={handleUploadFile} style={{ display: 'none' }} />
          </label>
          <div className="visual-reference-create-fields">
            <div className="form-group">
              <label className="form-label">What kind of reference is this?</label>
              <div className="visual-reference-kind-options">
                {[
                  ['good_reference', 'Good reference', 'Something to move toward'],
                  ['bad_reference', 'Drift reference', 'Something to avoid'],
                  ['real_photo', 'Real outfit photo', 'How it looks on me'],
                ].map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    className={calibrationKind === value ? 'active' : ''}
                    onClick={() => changeCalibrationKind(value)}
                  >
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">What should the stylist notice?</label>
              <div className="visual-reference-signal-options">
              {calibrationLabelsForKind(calibrationKind).map(([value, label]) => (
                <button key={value} type="button" onClick={() => toggleLabel(value)}
                  className={calibrationLabels.includes(value) ? 'active' : ''}
                >{label}</button>
              ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Why does this feel right or wrong?</label>
              <textarea className="form-textarea" value={calibrationNotes} onChange={e => setCalibrationNotes(e.target.value)}
                placeholder="Add a short note in your own words…" rows={3}
              />
            </div>
          </div>
          </div>

          <div className="visual-reference-create-actions">
            <button className="btn-secondary" onClick={() => setActiveSection('references')}>Cancel</button>
            <button className="btn-primary" onClick={saveCalibrationImage}
              disabled={!calibrationUploadFile || calibrationUploading}>
              {calibrationUploading ? 'Saving…' : 'Save reference'}
            </button>
          </div>
        </div>
      )}

      {activeSection === 'profile' && (
        <StylistSettings mode="style" embedded onGoToThread={onGoToThread} />
      )}

      {/* Reference images grid */}
      {activeSection === 'references' && (
        <>
        <div className="visual-reference-toolbar">
          <div className="visual-reference-toolbar-copy">
            <h2>Reference library</h2>
            <span>{calibrationImages.length} {calibrationImages.length === 1 ? 'reference' : 'references'} shown</span>
          </div>
          <div className="visual-lab-reference-filters" aria-label="Filter references">
            <span className="visual-reference-filter-label">Show</span>
            {[
              ['active', 'All active'],
              ['strong', 'Use strongly'],
              ['good_reference', 'Good'],
              ['bad_reference', 'Drift'],
              ['real_photo', 'Real photos'],
              ['ignored', 'Ignored'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`chip ${calibrationFilter === value ? 'active' : ''}`}
                onClick={() => setCalibrationFilter(value)}
                aria-pressed={calibrationFilter === value}
              >{label}</button>
            ))}
          </div>
        </div>
        {!calibrationImages.length ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No calibration images in this filter.</div>
        ) : (
          <div className="visual-lab-reference-grid">
          {calibrationImages.map(row => {
            const isEditing = calibrationEditingId === row.id
            return (
              <div key={row.id} className={`visual-reference-card ${row.archived ? 'is-archived' : ''}`}>
                <button
                  type="button"
                  className="visual-reference-image"
                  onClick={() => setPreviewImage({ src: row.image_url, title: row.kind?.replaceAll('_', ' ') || 'Calibration image', meta: row.notes || '' })}
                  style={{ display: 'block', width: '100%', border: 0, padding: 0, background: 'transparent', cursor: 'zoom-in' }}
                  aria-label="Open calibration image preview"
                >
                  <img src={row.thumbnail_url || uploadThumbnailSrc(row.image_url, 'visual-reference')} alt="Calibration" loading="lazy" decoding="async" />
                </button>
                <div className="visual-reference-body">
                  {isEditing ? (
                    <>
                      <select className="visual-reference-edit-select" value={calibrationEditKind} onChange={e => changeCalibrationEditKind(e.target.value)}>
                        <option value="good_reference">Good reference</option>
                        <option value="bad_reference">Bad / drift reference</option>
                        <option value="real_photo">Real outfit photo</option>
                      </select>
                      <div className="visual-reference-edit-signals">
                        {calibrationLabelsForKind(calibrationEditKind, calibrationEditLabels).map(([value, label]) => (
                          <button key={value} type="button" onClick={() => toggleEditLabel(value)}
                            className={calibrationEditLabels.includes(value) ? 'active' : ''}
                          >{label}</button>
                        ))}
                      </div>
                      <textarea className="visual-reference-edit-note" value={calibrationEditNotes} onChange={e => setCalibrationEditNotes(e.target.value)} rows={3} />
                      <div className="visual-reference-edit-actions">
                        <button className="btn-primary" onClick={() => saveEdit(row.id)}>Save changes</button>
                        <button className="btn-secondary" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="visual-reference-heading">
                        <div className={`visual-reference-kind ${row.kind === 'bad_reference' ? 'is-negative' : ''}`}>
                          {row.favorite ? '★ ' : ''}{row.kind?.replaceAll('_', ' ')}
                        </div>
                        {row.archived && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>ignored</span>}
                      </div>
                      {!!row.labels?.length && (
                        <div className="visual-reference-tags">
                          {row.labels.slice(0, 3).map(label => (
                            <span key={label}>
                              {label.replaceAll('_', ' ')}
                            </span>
                          ))}
                          {row.labels.length > 3 && <span>+{row.labels.length - 3}</span>}
                        </div>
                      )}
                      {row.notes && <div className="visual-reference-note">{row.notes}</div>}
                      <div className="visual-reference-actions">
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
      <div className="calibration-board-library">
        <div className="calibration-board-library-heading">
          <div>
            <h2>Calibration boards</h2>
            <p>Review generated looks and record what should—or should not—guide future styling.</p>
          </div>
          <span>{filteredSavedBoards.length} {filteredSavedBoards.length === 1 ? 'board' : 'boards'}</span>
        </div>

        <div className="calibration-board-filters" aria-label="Filter calibration boards">
          <input
            type="search"
            value={savedBoardSearch}
            onChange={event => setSavedBoardSearch(event.target.value)}
            placeholder="Search boards, pieces, or feedback…"
            aria-label="Search calibration boards"
          />
          <div className="calibration-board-filter-groups">
          <div className="calibration-board-filter-group" role="group" aria-label="Review status">
            <span>Review</span>
            <div className="calibration-board-filter-chips">
            {[
              ['all', 'All'],
              ['unreviewed', 'Not reviewed'],
              ['positive', 'Positive'],
              ['flagged', 'Flagged'],
              ['image', 'Image issues'],
            ].map(([value, label]) => (
              <button key={value} type="button" className={`chip ${savedBoardFilter === value ? 'active' : ''}`} aria-pressed={savedBoardFilter === value} onClick={() => setSavedBoardFilter(value)}>{label}</button>
            ))}
            </div>
          </div>
          <div className="calibration-board-filter-group" role="group" aria-label="Board status">
            <span>Status</span>
            <div className="calibration-board-filter-chips">
              {[
                ['all', 'All'],
                ['strong', 'Use strongly'],
                ['hidden', 'Hidden'],
                ['ignored', 'Ignored'],
              ].map(([value, label]) => (
                <button key={value} type="button" className={`chip ${savedBoardStatusFilter === value ? 'active' : ''}`} aria-pressed={savedBoardStatusFilter === value} onClick={() => setSavedBoardStatusFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          </div>
        </div>

        {savedBoardsLoading ? (
          <div className="style-profile-empty" role="status">Loading calibration boards…</div>
        ) : savedBoardsError ? (
          <div className="style-profile-empty calibration-board-error" role="alert">
            <span>{savedBoardsError}</span>
            <button type="button" className="btn-secondary" onClick={loadSavedBoards}>Try again</button>
          </div>
        ) : !savedBoards.length ? (
          <div className="style-profile-empty">No calibration boards saved yet.</div>
        ) : !filteredSavedBoards.length ? (
          <div className="style-profile-empty calibration-board-error">
            <span>No boards match these filters.</span>
            <button type="button" className="btn-secondary" onClick={() => {
              setSavedBoardSearch('')
              setSavedBoardFilter('all')
              setSavedBoardStatusFilter('all')
            }}>Clear filters</button>
          </div>
        ) : (
          <div className="calibration-board-grid">
            {filteredSavedBoards.map(board => {
              const reviewState = savedBoardReviewState(board)
              return (
              <button key={board.id} type="button" className={`calibration-board-card ${board.archived ? 'is-archived' : ''}`} onClick={event => {
                boardReturnFocusRef.current = event.currentTarget
                setSelectedBoard(board)
              }}>
                <div className="calibration-board-image">
                  {board.image_url && <img src={uploadThumbnailSrc(board.image_url, 'lookbook-display')} alt={board.title || 'Saved board'} loading="lazy" decoding="async" />}
                  <div className="calibration-board-badges">
                    {board.favorite && <span>★ Use strongly</span>}
                    {board.archived && <span>Ignored</span>}
                    {board.hidden_from_lookbook && <span>Hidden</span>}
                  </div>
                </div>
                <div className="calibration-board-card-body">
                  <strong>{board.title || 'Saved board'}</strong>
                  <span>{board.context_name || board.board_type?.replaceAll('_', ' ') || 'Visual board'}</span>
                  <div className="calibration-board-feedback-summary">
                    <span className={`is-${reviewState.value}`}>{reviewState.label}</span>
                    {reviewState.hasImageIssue && <span className="is-image-issue">Image issue</span>}
                  </div>
                  <span className="calibration-board-open">Review board →</span>
                </div>
              </button>
            )})}
          </div>
        )}
      </div>
      )}
      </div>

      {selectedBoard && (
        <div className="modal-overlay calibration-board-detail-overlay" onClick={closeSelectedBoard}>
          <div ref={boardDialogRef} className="calibration-board-detail" role="dialog" aria-modal="true" aria-labelledby="calibration-board-detail-title" onClick={e => e.stopPropagation()}>
            <button ref={boardCloseRef} className="modal-close calibration-board-detail-close" onClick={closeSelectedBoard} aria-label="Close board details">×</button>
            <div className="calibration-board-detail-media">
              {selectedBoard.image_url && (
                <button type="button" onClick={event => {
                  previewReturnFocusRef.current = event.currentTarget
                  setPreviewImage({ src: selectedBoard.image_url, title: selectedBoard.title || 'Saved board', meta: selectedBoard.context_name || '' })
                }}>
                  <img src={uploadThumbnailSrc(selectedBoard.image_url, 'lookbook-display')} alt={selectedBoard.title || 'Saved board'} decoding="async" />
                  <span>Open full image</span>
                </button>
              )}
            </div>
            <div className="calibration-board-detail-content">
              <div className="calibration-board-detail-heading">
                <span>Calibration board</span>
                <h2 id="calibration-board-detail-title">{selectedBoard.title || 'Saved board'}</h2>
                <p>{selectedBoard.context_name || selectedBoard.board_type?.replaceAll('_', ' ')}</p>
              </div>

              {Array.isArray(selectedBoard.pieces) && selectedBoard.pieces.length > 0 && (
                <div className="calibration-board-detail-section">
                  <h3>Pieces</h3>
                  <p>{selectedBoard.pieces.map(piece => piece?.name).filter(Boolean).join(' + ')}</p>
                </div>
              )}
              {selectedBoard.reason && (
                <div className="calibration-board-detail-section">
                  <h3>Why it was suggested</h3>
                  <p>{selectedBoard.reason}</p>
                </div>
              )}

              <div className="calibration-board-detail-section">
                <h3>Your feedback</h3>
                <p>Start with the outfit direction. Report rendering problems separately—they do not mean the outfit idea is wrong.</p>
                <div className="calibration-board-feedback-group" role="group" aria-labelledby="calibration-overall-label">
                <h4 id="calibration-overall-label" className="calibration-board-feedback-group-title">Outfit direction</h4>
                <div className="calibration-board-feedback-options calibration-board-verdict-options">
                  {OVERALL_VERDICT_LABELS.map(([label, text]) => {
                    const active = Array.isArray(selectedBoard?.payload?.feedback_labels) && selectedBoard.payload.feedback_labels.includes(label)
                    return <button key={label} type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={savedBoardPending} onClick={() => selectOverallVerdict(selectedBoard, label)}>{text}</button>
                  })}
                </div>
                {(() => {
                  const labels = Array.isArray(selectedBoard?.payload?.feedback_labels) ? selectedBoard.payload.feedback_labels : []
                  const activeVerdict = ['almost', 'not_me'].find(label => labels.includes(label))
                  if (!activeVerdict) return null
                  const existingComment = String(selectedBoard?.payload?.feedback_details?.owner_comment || '').trim()
                  return (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={savedBoardPending}
                      onClick={() => {
                        setPendingVerdictComment({ row: selectedBoard, label: activeVerdict })
                        setVerdictComment(existingComment)
                      }}
                    >
                      {existingComment ? 'Edit reason' : 'Add optional reason'}
                    </button>
                  )
                })()}
                </div>

                <details className="calibration-board-specific-feedback" open={specificFeedbackOpen} onToggle={event => setSpecificFeedbackOpen(event.currentTarget.open)}>
                  <summary>Add specific feedback</summary>
                <div className="calibration-board-feedback-group" role="group" aria-labelledby="calibration-style-label">
                <h4 id="calibration-style-label" className="calibration-board-feedback-group-title">What feels wrong?</h4>
                <div className="calibration-board-feedback-options">
                  {STYLE_DIRECTION_REASONS.map(([reason, text]) => {
                    const selected = selectedBoard?.payload?.feedback_details?.style_direction
                    const active = Array.isArray(selected) && selected.includes(reason)
                    return <button key={reason} type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={savedBoardPending} onClick={() => toggleStructuredFeedbackReason(selectedBoard, 'style_direction', reason)}>{text}</button>
                  })}
                </div>
                </div>
                <div className="calibration-board-feedback-group" role="group" aria-labelledby="calibration-shape-label">
                <h4 id="calibration-shape-label" className="calibration-board-feedback-group-title">Fit and shape</h4>
                <div className="calibration-board-feedback-options">
                  {SHAPE_BALANCE_REASONS.map(([reason, text]) => {
                    const selected = selectedBoard?.payload?.feedback_details?.shape_balance
                    const active = Array.isArray(selected) && selected.includes(reason)
                    return <button key={reason} type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={savedBoardPending} onClick={() => toggleStructuredFeedbackReason(selectedBoard, 'shape_balance', reason)}>{text}</button>
                  })}
                </div>
                </div>
                <div className="calibration-board-feedback-group calibration-board-image-feedback" role="group" aria-labelledby="calibration-image-label">
                <h4 id="calibration-image-label" className="calibration-board-feedback-group-title">Problems in the generated image</h4>
                <p>These report rendering accuracy only. The outfit direction can still be useful.</p>
                <div className="calibration-board-feedback-options">
                  {IMAGE_FIDELITY_FEEDBACK_LABELS.map(([label, text]) => {
                    const active = Array.isArray(selectedBoard?.payload?.feedback_labels) && selectedBoard.payload.feedback_labels.includes(label)
                    return <button key={label} type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={savedBoardPending} onClick={() => toggleBoardFeedback(selectedBoard, label)}>{text}</button>
                  })}
                </div>
                </div>
                {Array.isArray(selectedBoard?.payload?.feedback_labels) && selectedBoard.payload.feedback_labels.includes('wrong_length') && (
                  <div className="calibration-board-feedback-detail">
                    <h4>Which garment was rendered at the wrong length?</h4>
                    <p>This creates a review suggestion; it does not change the garment automatically.</p>
                    {(selectedBoard.pieces || []).filter(piece => Number(piece?.id) && wrongLengthReasonsForCategory(piece.category).length).map(piece => {
                      const pieceId = Number(piece.id)
                      const pieceReasons = wrongLengthReasonsForCategory(piece.category)
                      const corrections = selectedBoard?.payload?.feedback_details?.wrong_length
                      const pieceCorrections = Array.isArray(corrections) ? corrections.filter(correction => Number(correction?.piece_id) === pieceId) : []
                      return (
                        <div key={piece.id} className="calibration-board-feedback-piece-detail">
                          <h5 className="calibration-board-feedback-group-title">
                            {piece.name || `Piece ${pieceId}`}{pieceCorrections.length ? ` (${pieceCorrections.length})` : ''}
                          </h5>
                          <div className="calibration-board-feedback-options">
                            {pieceReasons.map(([issue, text]) => {
                              const active = pieceCorrections.some(correction => correction?.issue === issue)
                              return <button key={issue} type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={savedBoardPending} onClick={() => toggleWrongLengthReason(selectedBoard, pieceId, issue)}>{text}</button>
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                </details>
                <div className="calibration-board-save-status" role="status" aria-live="polite">{savedBoardPending ? 'Saving…' : savedBoardNotice}</div>
              </div>

              <div className="calibration-board-detail-controls">
                <button className="btn-secondary" disabled={savedBoardPending} onClick={() => patchSavedBoard(selectedBoard, { favorite: !selectedBoard.favorite })}>{selectedBoard.favorite ? 'Use normally' : 'Use strongly'}</button>
                <button className="btn-secondary" disabled={savedBoardPending} onClick={() => patchSavedBoard(selectedBoard, { hidden_from_lookbook: !selectedBoard.hidden_from_lookbook })}>{selectedBoard.hidden_from_lookbook ? 'Show in Lookbook' : 'Hide from Lookbook'}</button>
                <button className="btn-secondary" disabled={savedBoardPending} onClick={() => patchSavedBoard(selectedBoard, { archived: !selectedBoard.archived })}>{selectedBoard.archived ? 'Restore board' : 'Ignore board'}</button>
              </div>

              <div className="calibration-board-detail-footer">
                {selectedBoard.payload?.threadId && selectedBoard.payload.threadId !== 'new_chat' && (
                  <button className="btn-secondary" onClick={() => onGoToThread?.(selectedBoard.payload.threadId)}>View generating chat</button>
                )}
                <button className="btn-danger" onClick={async () => {
                  if (confirm(`Delete "${selectedBoard.title || 'this board'}" from everywhere?`)) await deleteSavedBoard(selectedBoard.id)
                }}>Delete board</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingVerdictComment && (
        <div className="stylist-feedback-dialog-backdrop" role="presentation" style={{ zIndex: 1200 }}>
          <form
            className="stylist-feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="visual-lab-verdict-comment-title"
            onSubmit={event => {
              event.preventDefault()
              commitVerdictComment(verdictComment)
            }}
          >
            <h3 id="visual-lab-verdict-comment-title">What feels off? <span>Optional</span></h3>
            <p>Describe it however you can. Uncertainty is useful too—this stays attached to this exact outfit.</p>
            <textarea
              value={verdictComment}
              onChange={event => setVerdictComment(event.target.value)}
              placeholder="For example: the proportions feel strange, but I’m not sure why"
              autoFocus
              maxLength={500}
            />
            <div className="stylist-wrong-choice-reason-actions">
              <button type="submit" className="btn-primary">Save feedback</button>
              <button type="button" className="btn-secondary" onClick={() => commitVerdictComment('')}>Skip comment</button>
              <button type="button" className="btn-link" onClick={() => { setPendingVerdictComment(null); setVerdictComment('') }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {previewImage && (
        <div
          ref={previewDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="calibration-preview-title"
          onClick={closePreviewImage}
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(20,18,16,0.82)', display: 'grid', placeItems: 'center', padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'grid', gap: 10 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#fff' }}>
              <div style={{ minWidth: 0 }}>
                <div id="calibration-preview-title" style={{ fontSize: 14, fontWeight: 700 }}>{previewImage.title}</div>
                {previewImage.meta && <div style={{ fontSize: 12, opacity: 0.78 }}>{previewImage.meta}</div>}
              </div>
              <button className="chip" onClick={closePreviewImage}>Close</button>
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
