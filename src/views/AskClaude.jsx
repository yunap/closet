import { useState, useEffect, useRef, useCallback } from 'react'

const SUGGESTIONS = [
  'What should I wear for a city dinner?',
  'Help me style my cream wide-leg pants',
  'What outfit would work for a smart casual event?',
  'I\'m going hiking this weekend — what should I wear?',
]


const SAVED_BOARD_FEEDBACK_LABELS = [
  ['signature', 'Signature'],
  ['works', 'Works'],
  ['almost', 'Almost'],
  ['not_me', 'Not me'],
  ['too_safe', 'Too safe'],
  ['too_boho', 'Too boho'],
  ['too_polished', 'Too polished'],
  ['too_soft', 'Too soft'],
  ['too_generic', 'Too generic'],
  ['wrong_proportions', 'Wrong proportions'],
  ['wrong_silhouette', 'Wrong silhouette'],
  ['wrong_energy', 'Wrong energy'],
  ['catalog_drift', 'Catalog drift'],
  ['bad_reference', 'Bad reference'],
]


const GENERATED_BOARD_FEEDBACK_LABELS = [
  ['signature', 'Signature'],
  ['works', 'Works'],
  ['almost', 'Almost'],
  ['not_me', 'Not me'],
  ['too_safe', 'Too safe'],
  ['too_generic', 'Too generic'],
  ['too_soft', 'Too soft'],
  ['wrong_proportions', 'Wrong proportions'],
  ['wrong_silhouette', 'Wrong silhouette'],
  ['catalog_drift', 'Catalog drift'],
  ['weak_structure', 'Weak structure'],
  ['weak_contrast', 'Weak contrast'],
  ['bad_grounding', 'Bad grounding'],
]

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

export default function AskClaude({
  initialOutfit,
  initialPiece,
  onClearOutfit,
  onClearPiece,
  activeContext: externalActiveContext,
  onContextChange,
  calibrationLibraryOpen: externalCalibrationLibraryOpen,
  onToggleCalibration,
  onBoardSaved,
  onResetVisuals,
}) {
  const [messages, setMessages]           = useState([
    { role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }
  ])
  const [chatHistory, setChatHistory]     = useState([])

  // Active context — persists through the conversation for save-to-notes
  const [internalActiveContext, setInternalActiveContext] = useState(null) // { type: 'piece'|'outfit', id, name }
  const activeContext = externalActiveContext ?? internalActiveContext
  const setActiveContext = useCallback((nextContext) => {
    setInternalActiveContext(nextContext)
    onContextChange?.(nextContext)
  }, [onContextChange])

  const [input, setInput]                 = useState('')
  const [imageFile, setImageFile]         = useState(null)
  const [imagePrev, setImagePrev]         = useState(null)
  const [pendingOutfit, setPendingOutfit] = useState(null)
  const [pendingPiece,  setPendingPiece]  = useState(null)
  const [loading, setLoading]             = useState(false)
  const [pieces, setPieces]               = useState([])
  const [outfits, setOutfits]             = useState([])
  const [compareOutfitId, setCompareOutfitId] = useState('')
  const [generateOutfitMode, setGenerateOutfitMode] = useState(false)
  const [includeMissingPieces, setIncludeMissingPieces] = useState(false)
  const [idealOnlyMode, setIdealOnlyMode] = useState(false)
  const [editorialVisualMode, setEditorialVisualMode] = useState(false)
  const [calibrationMode, setCalibrationMode] = useState(false)
  const [identityEditMode, setIdentityEditMode] = useState(false)
  const [generateOccasion, setGenerateOccasion] = useState('casual')
  const [generateSeason, setGenerateSeason] = useState('current season')
  const [savedIndices, setSavedIndices]   = useState(new Set())
  const [feedbackSaved, setFeedbackSaved] = useState(new Set())
  const [boardFeedbackLabels, setBoardFeedbackLabels] = useState({})
  const [boardLearningStatus, setBoardLearningStatus] = useState({})
  const [savedBoardKeys, setSavedBoardKeys] = useState(new Set())
  const [learningOpen, setLearningOpen] = useState(false)
  const [learningRows, setLearningRows] = useState([])
  const [internalCalibrationLibraryOpen, setInternalCalibrationLibraryOpen] = useState(false)
  const calibrationLibraryOpen = externalCalibrationLibraryOpen ?? internalCalibrationLibraryOpen
  const setCalibrationLibraryOpen = useCallback((nextOpen) => {
    const resolvedOpen = typeof nextOpen === 'function'
      ? nextOpen(externalCalibrationLibraryOpen ?? internalCalibrationLibraryOpen)
      : nextOpen
    setInternalCalibrationLibraryOpen(resolvedOpen)
    onToggleCalibration?.(resolvedOpen)
  }, [externalCalibrationLibraryOpen, internalCalibrationLibraryOpen, onToggleCalibration])
  const [calibrationImages, setCalibrationImages] = useState([])
  const [savedBoards, setSavedBoards] = useState([])
  const [savedBoardsLoading, setSavedBoardsLoading] = useState(false)
  const [calibrationUploadFile, setCalibrationUploadFile] = useState(null)
  const [calibrationUploadPrev, setCalibrationUploadPrev] = useState(null)
  const [calibrationKind, setCalibrationKind] = useState('good_reference')
  const [calibrationLabels, setCalibrationLabels] = useState([])
  const [calibrationNotes, setCalibrationNotes] = useState('')
  const [calibrationUploading, setCalibrationUploading] = useState(false)
  const [calibrationFilter, setCalibrationFilter] = useState('active')
  const [calibrationEditingId, setCalibrationEditingId] = useState(null)
  const [calibrationEditKind, setCalibrationEditKind] = useState('good_reference')
  const [calibrationEditLabels, setCalibrationEditLabels] = useState([])
  const [calibrationEditNotes, setCalibrationEditNotes] = useState('')
  const [boardResults, setBoardResults]   = useState({})
  const [editorialVisualResults, setEditorialVisualResults] = useState({})
  const [boardLoadingIndex, setBoardLoadingIndex] = useState(null)
  const [fileInputKey, setFileInputKey]   = useState(0) // forces file input reset // which message indices have been saved
  const bottomRef                         = useRef(null)
  const textRef                           = useRef(null)

  useEffect(() => {
    fetch('/api/pieces').then(r => r.json()).then(setPieces)
    fetch('/api/outfits').then(r => r.json()).then(setOutfits).catch(() => setOutfits([]))
  }, [])

  useEffect(() => {
    if (!initialOutfit) return
    setPendingOutfit(initialOutfit)
    setPendingPiece(null)
    setCompareOutfitId('')
    setGenerateOutfitMode(false)
    setIncludeMissingPieces(false)
    setIdealOnlyMode(false)
    setEditorialVisualMode(false)
    setCalibrationMode(false)
    setIdentityEditMode(false)
        setActiveContext({ type: 'outfit', id: initialOutfit.id, name: initialOutfit.name })
    setInput('What do you think of this outfit?')
    setImageFile(null); setImagePrev(null)
    onClearOutfit?.()
  }, [initialOutfit])

  useEffect(() => {
    if (!initialPiece) return
    setPendingPiece(initialPiece)
    setPendingOutfit(null)
    setCompareOutfitId('')
    // Item-page entry defaults to wardrobe mode, with a clear alternate button for ideal additions.
    setGenerateOutfitMode(true)
    setIncludeMissingPieces(false)
    setIdealOnlyMode(false)
    setEditorialVisualMode(false)
    setCalibrationMode(false)
    setIdentityEditMode(false)
        setActiveContext({ type: 'piece', id: initialPiece.id, name: initialPiece.name })
    setInput('Style this piece using my existing wardrobe.')
    setImageFile(null); setImagePrev(null)
    onClearPiece?.()
  }, [initialPiece])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const loadLearningRows = async (context = activeContext) => {
    if (!context) { setLearningRows([]); return }
    try {
      const res = await fetch(`/api/stylist-feedback?contextType=${encodeURIComponent(context.type)}&contextId=${encodeURIComponent(context.id)}&limit=80`)
      const rows = await res.json()
      setLearningRows(Array.isArray(rows) ? rows : [])
    } catch {
      setLearningRows([])
    }
  }

  useEffect(() => { loadLearningRows(activeContext) }, [activeContext?.type, activeContext?.id])

  const updateLearningRow = async (id, patch) => {
    await fetch(`/api/stylist-feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    await loadLearningRows()
  }

  const archiveLearningRow = async (id) => {
    await fetch(`/api/stylist-feedback/${id}`, { method: 'DELETE' })
    await loadLearningRows()
  }

  const loadCalibrationImages = async () => {
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (calibrationFilter === 'ignored') params.set('includeArchived', 'true')
      if (['good_reference', 'bad_reference', 'real_photo'].includes(calibrationFilter)) params.set('kind', calibrationFilter)
      const res = await fetch(`/api/calibration-images?${params.toString()}`)
      const rows = await res.json()
      let list = Array.isArray(rows) ? rows : []
      if (calibrationFilter === 'strong') list = list.filter(r => r.favorite)
      if (calibrationFilter === 'ignored') list = list.filter(r => r.archived)
      setCalibrationImages(list)
    } catch {
      setCalibrationImages([])
    }
  }

  const loadSavedBoardsForCalibration = async () => {
    setSavedBoardsLoading(true)
    try {
      const res = await fetch('/api/saved-boards?limit=80')
      const rows = await res.json()
      setSavedBoards(Array.isArray(rows) ? rows : [])
    } catch (err) {
      setSavedBoards([])
    } finally {
      setSavedBoardsLoading(false)
    }
  }

  const refreshCalibrationPanel = async () => {
    await Promise.all([loadCalibrationImages(), loadSavedBoardsForCalibration()])
  }

  const patchSavedBoard = async (row, patch) => {
    const res = await fetch(`/api/saved-boards/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    if (!res.ok) return null
    const updated = await res.json().catch(() => null)
    if (updated?.id) {
      setSavedBoards(prev => prev.map(b => String(b.id) === String(updated.id) ? updated : b))
    } else {
      await loadSavedBoardsForCalibration()
    }
    return updated
  }

  const toggleSavedBoardFeedback = async (row, label) => {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
    const current = Array.isArray(payload.feedback_labels) ? payload.feedback_labels : []
    const isAdding = !current.includes(label)
    const nextLabels = isAdding
      ? [...current, label]
      : current.filter(x => x !== label)
    const patch = { feedbackLabels: nextLabels }
    if (label === 'signature' && isAdding) patch.favorite = true
    if (['not_me', 'bad_reference', 'catalog_drift', 'wrong_proportions', 'wrong_silhouette', 'wrong_energy'].includes(label) && isAdding) patch.favorite = false
    await patchSavedBoard(row, patch)
  }

  useEffect(() => { if (calibrationLibraryOpen) refreshCalibrationPanel() }, [calibrationLibraryOpen, calibrationFilter])

  const handleCalibrationUploadFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCalibrationUploadFile(f)
    const reader = new FileReader()
    reader.onload = ev => setCalibrationUploadPrev(ev.target.result)
    reader.readAsDataURL(f)
  }

  const toggleCalibrationLabel = (label) => {
    setCalibrationLabels(prev => prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label])
  }

  const toggleCalibrationEditLabel = (label) => {
    setCalibrationEditLabels(prev => prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label])
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
      body: JSON.stringify({ archived })
    })
    await loadCalibrationImages()
  }

  const toggleCalibrationFavorite = async (row) => {
    await fetch(`/api/calibration-images/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: !row.favorite })
    })
    await loadCalibrationImages()
  }

  const startEditCalibrationImage = (row) => {
    setCalibrationEditingId(row.id)
    setCalibrationEditKind(row.kind || 'good_reference')
    setCalibrationEditLabels(Array.isArray(row.labels) ? row.labels : [])
    setCalibrationEditNotes(row.notes || '')
  }

  const cancelEditCalibrationImage = () => {
    setCalibrationEditingId(null)
    setCalibrationEditLabels([])
    setCalibrationEditNotes('')
  }

  const saveCalibrationEdit = async (id) => {
    await fetch(`/api/calibration-images/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: calibrationEditKind,
        labels: calibrationEditLabels,
        notes: calibrationEditNotes
      })
    })
    cancelEditCalibrationImage()
    await loadCalibrationImages()
  }

  const addToHistory = (role, content) => setChatHistory(h => [...h, { role, content }])

  const handleImage = (e) => {
    const f = e.target.files[0]; if (!f) return
    setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId(''); setGenerateOutfitMode(false); setEditorialVisualMode(false); setCalibrationMode(false); setIdentityEditMode(false); setIncludeMissingPieces(false); setIdealOnlyMode(false); setEditorialVisualMode(false)
    setImageFile(f); setImagePrev(URL.createObjectURL(f))
  }

  const getOutfitConfidenceMode = (outfit) => {
    if (!outfit) return null
    const linkedCount = Array.isArray(outfit.pieces) ? outfit.pieces.length : 0
    if (linkedCount > 0) {
      return {
        label: 'Wardrobe-aware analysis',
        detail: `${linkedCount} linked garment${linkedCount === 1 ? '' : 's'}`,
        tone: 'strong',
      }
    }
    return {
      label: 'Visual analysis only',
      detail: 'Link saved pieces to improve precision',
      tone: 'soft',
    }
  }

  const getCompareConfidenceText = (outfitA, outfitB) => {
    const a = getOutfitConfidenceMode(outfitA)
    const b = getOutfitConfidenceMode(outfitB)
    if (!a || !b) return ''
    const aLinked = Array.isArray(outfitA?.pieces) ? outfitA.pieces.length : 0
    const bLinked = Array.isArray(outfitB?.pieces) ? outfitB.pieces.length : 0
    if (aLinked && bLinked) return `Wardrobe-aware comparison · A: ${aLinked} linked · B: ${bLinked} linked`
    if (!aLinked && !bLinked) return 'Visual comparison only · link saved pieces to improve precision'
    return `Mixed-confidence comparison · A: ${a.label} · B: ${b.label}`
  }

  const confidenceBadgeStyle = (tone) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    width: 'fit-content',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 11,
    lineHeight: 1.2,
    border: tone === 'strong' ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: tone === 'strong' ? 'var(--surface)' : 'var(--surface-2)',
    color: tone === 'strong' ? 'var(--accent)' : 'var(--text-muted)',
  })

  const saveMessageToNotes = async (messageIndex, text) => {
    if (!activeContext) return
    const url = activeContext.type === 'piece'
      ? `/api/pieces/${activeContext.id}/append-note`
      : `/api/outfits/${activeContext.id}/append-note`
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
    setSavedIndices(prev => new Set([...prev, messageIndex]))
  }


  const FEEDBACK_ACTIONS = [
    { type: 'signature', label: 'Signature' },
    { type: 'works', label: 'Works' },
    { type: 'almost', label: 'Almost' },
    { type: 'not_me', label: 'Not me' },
    { type: 'too_safe', label: 'Too safe' },
    { type: 'too_soft', label: 'Too soft' },
    { type: 'too_generic', label: 'Too generic' },
    { type: 'weak_structure', label: 'Weak structure' },
    { type: 'weak_contrast', label: 'Weak contrast' },
    { type: 'bad_grounding', label: 'Bad grounding' },
    { type: 'proportion_problem', label: 'Proportion problem' },
    { type: 'wrong_silhouette', label: 'Wrong silhouette' },
    { type: 'catalog_drift', label: 'Catalog drift' },
    { type: 'wrong_item_read', label: 'Wrong item read' },
  ]

  const isMultiOutfitResponse = (message) => {
    if (!message || message.role !== 'assistant') return false
    if (Array.isArray(message.structuredOutfits) && message.structuredOutfits.length) return true
    const text = String(message.text || '')
    return /Generated outfit ideas for:|Signature \/ strongest direction|Best owned wardrobe direction|Ideal editorial completion|Usable variation|Optional experimental direction/i.test(text)
  }



  const getEditorialNotes = (text = '') => {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
    const notes = []
    let mode = null
    for (const rawLine of lines) {
      const line = rawLine.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim()
      const clean = line.replace(/^[-–]\s*/, '').trim()
      if (/^I would skip/i.test(line)) { mode = 'skip'; continue }
      if (/^Avoid for this garment/i.test(line)) { mode = 'avoid'; continue }
      if (/^Saveable learning/i.test(line)) { mode = 'learning'; continue }
      if (/^(Signature|Usable variation|Optional experimental direction|Best owned wardrobe direction|Ideal editorial completion|Pieces:|Why it works:|Watch for:|Generated outfit ideas|Occasion)/i.test(line)) {
        mode = null
        continue
      }
      if (!mode || !clean || /^none$/i.test(clean) || /^---+$/.test(clean)) continue
      if (mode === 'skip') notes.push(`Skip: ${clean}`)
      if (mode === 'avoid') notes.push(`Avoid: ${clean}`)
      if (mode === 'learning') notes.push(`Learning: ${clean}`)
    }
    const seen = new Set()
    return notes.filter(note => {
      const key = note.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 5)
  }


  const getCompactOutfitIntro = (message, hasBoards = false) => {
    const text = String(message?.text || '')
    const titleMatch = text.match(/Generated outfit ideas for:\*\*\s*([^\n]+)/i)
    const itemName = titleMatch ? titleMatch[1].replace(/\*/g, '').trim() : activeContext?.name
    if (hasBoards) return `Outfit directions for ${itemName}. Visuals are shown below for selected ideas.`
    return `Text outfit ideas generated for ${itemName}. Use “Generate visual for this outfit” only on the ideas you want to see.`
  }

  const renderStructuredAdvice = (message, messageIndex) => {
    const outfits = Array.isArray(message?.structuredOutfits) ? message.structuredOutfits : []
    if (!outfits.length) return null

    const strengthLabel = (value, index) => {
      const v = String(value || '').toLowerCase()
      if (v === 'signature' || index === 0) return 'signature'
      if (v === 'strong') return 'strong'
      if (v === 'usable') return 'usable'
      if (v === 'experimental') return 'experimental'
      return 'direction'
    }

    return (
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {outfits.slice(0, 4).map((outfit, idx) => {
          const strength = strengthLabel(outfit.strength, idx)
          const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean) : []
          return (
            <div key={idx} style={{
              padding: '10px 12px',
              background: idx === 0 ? 'var(--surface)' : 'var(--surface-2)',
              borderRadius: 12,
              border: idx === 0 ? '1px solid var(--accent)' : '1px solid var(--border)',
              boxShadow: idx === 0 ? '0 2px 8px rgba(0,0,0,0.04)' : 'none'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{outfit.label || `Outfit direction ${idx + 1}`}</div>
                <div style={{ fontSize: 10, color: idx === 0 ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{strength}</div>
              </div>
              {(outfit.dominantDirection || outfit.silhouette || outfit.bestFor) && (
                <div style={{ display: 'grid', gap: 2, marginTop: 6, fontSize: 13, color: 'var(--text-light)', lineHeight: 1.45 }}>
                  {outfit.dominantDirection && <div><strong>Direction:</strong> {outfit.dominantDirection}</div>}
                  {outfit.silhouette && <div><strong>Silhouette:</strong> {outfit.silhouette}</div>}
                  {outfit.bestFor && <div><strong>Best for:</strong> {outfit.bestFor}</div>}
                </div>
              )}
              {pieces.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 7, lineHeight: 1.45 }}>
                  <strong>Pieces:</strong> {pieces.join(' + ')}
                </div>
              )}
              {outfit.reason && <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 7 }}>{outfit.reason}</div>}
              {outfit.watchFor && !/^none$/i.test(String(outfit.watchFor).trim()) && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 5 }}><strong>Watch:</strong> {outfit.watchFor}</div>
              )}
              {activeContext?.type === 'piece' && (
                <div style={{ marginTop: 9, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    onClick={() => generateVisualBoards(`${messageIndex}:${idx}`, message.text, [outfit], activeContext.id, messageIndex)}
                    disabled={boardLoadingIndex === `${messageIndex}:${idx}`}
                    style={{
                      fontSize: 12,
                      color: 'var(--accent)',
                      padding: '3px 9px',
                      borderRadius: 12,
                      border: '1px solid var(--accent)',
                      background: 'var(--surface)',
                      cursor: boardLoadingIndex === `${messageIndex}:${idx}` ? 'default' : 'pointer',
                      opacity: boardLoadingIndex === `${messageIndex}:${idx}` ? 0.65 : 1,
                    }}
                  >
                    {boardLoadingIndex === `${messageIndex}:${idx}` ? 'Rendering this outfit…' : (boardResults[`${messageIndex}:${idx}`]?.length ? 'Regenerate this visual' : 'Generate visual for this outfit')}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Image generation cost: one outfit only.</span>
                </div>
              )}
              {boardResults[`${messageIndex}:${idx}`]?.length > 0 && (
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {boardResults[`${messageIndex}:${idx}`].map((board, boardIdx) => (
                    <div key={boardIdx} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
                      {board.error ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Board error: {board.error}</div>
                      ) : (
                        <>
                          <img src={board.imageUrl} alt={board.label} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)' }} />
                          <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label}</div>
                          {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{board.reason}</div>}
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
                            {(() => {
                              const saveKey = `wardrobe-board:${messageIndex}:${idx}:${boardIdx}`
                              const isBoardSaved = savedBoardKeys.has(saveKey)
                              return (
                                <button
                                  onClick={() => saveGeneratedBoard({ key: saveKey, board, boardType: 'wardrobe_board', messageIndex, boardIndex: idx })}
                                  disabled={isBoardSaved}
                                  style={{ fontSize: 10, color: isBoardSaved ? 'var(--donate)' : 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isBoardSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isBoardSaved ? 'default' : 'pointer' }}
                                >
                                  {isBoardSaved ? '✓ Saved board' : 'Save board'}
                                </button>
                              )
                            })()}
                            {FEEDBACK_ACTIONS.map(action => {
                              const key = `wardrobe-idea-board:${messageIndex}:${idx}:${boardIdx}:${action.type}`
                              const isSaved = feedbackSaved.has(key)
                              return (
                                <button
                                  key={key}
                                  onClick={() => saveStylistFeedback({
                                    key,
                                    feedbackType: action.type,
                                    targetType: 'board',
                                    label: board.label || outfit.title || action.label,
                                    note: board.reason || outfit.reason || '',
                                    payload: { board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx },
                                    appendToPiece: activeContext?.type === 'piece' && ['signature', 'works', 'not_me', 'wrong_item_read'].includes(action.type),
                                  })}
                                  disabled={isSaved}
                                  style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer' }}
                                >
                                  {isSaved ? '✓ ' : ''}{action.label}
                                </button>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }


  const feedbackBucketKey = (targetType, payload = {}) => {
    if (!payload || !Number.isInteger(payload.messageIndex) || !Number.isInteger(payload.boardIndex)) return null
    if (targetType === 'generated_visual_board' || targetType === 'board' || targetType === 'renderer_calibration') {
      return `${targetType}:${payload.messageIndex}:${payload.boardIndex}`
    }
    return null
  }

  const feedbackLearningCopy = (feedbackType) => {
    const copy = {
      signature: 'Learning saved: boosting this as a signature direction. The board itself is not saved unless you click Save board.',
      works: 'Learning saved: boosting similar outfit logic. The board itself is not saved unless you click Save board.',
      almost: 'Learning saved: treating this as close but not fully solved.',
      not_me: 'Learning saved: reducing this direction for future suggestions.',
      too_safe: 'Learning saved: reducing safe/over-balanced styling.',
      too_generic: 'Learning saved: reducing generic outfit logic.',
      too_soft: 'Learning saved: reducing excessive softness.',
      wrong_proportions: 'Learning saved: avoiding this proportion behavior.',
      wrong_silhouette: 'Learning saved: avoiding this silhouette behavior.',
      catalog_drift: 'Learning saved: reducing catalog/mature-casual drift.',
      weak_structure: 'Learning saved: requiring stronger structure next time.',
      weak_contrast: 'Learning saved: requiring clearer contrast/tension next time.',
      bad_grounding: 'Learning saved: improving shoe/grounding logic next time.',
      bad_reference: 'Learning saved: using this as a negative reference.'
    }
    return copy[feedbackType] || 'Learning saved. The board itself is not saved unless you click Save board.'
  }

  const saveStylistFeedback = async ({ key, feedbackType, targetType = 'message', label = '', note = '', payload = {}, appendToPiece = false }) => {
    if (!activeContext) return
    const res = await fetch('/api/stylist-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedbackType,
        targetType,
        contextType: activeContext.type,
        contextId: activeContext.id,
        contextName: activeContext.name,
        label,
        note,
        payload,
        appendToPiece,
      })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || 'Could not save feedback')
    }
    setFeedbackSaved(prev => new Set([...prev, key]))
    const bucket = feedbackBucketKey(targetType, payload)
    if (bucket) {
      setBoardFeedbackLabels(prev => {
        const existing = Array.isArray(prev[bucket]) ? prev[bucket] : []
        return { ...prev, [bucket]: [...new Set([...existing, feedbackType])] }
      })
      setBoardLearningStatus(prev => ({ ...prev, [bucket]: data.learningMessage || feedbackLearningCopy(feedbackType) }))
    }
    loadLearningRows()
  }


  const saveGeneratedBoard = async ({ key, board, boardType = 'wardrobe', messageIndex = null, boardIndex = null }) => {
    if (!activeContext || !board || !board.imageUrl) return
    const feedbackBucket = Number.isInteger(messageIndex) && Number.isInteger(boardIndex)
      ? `${boardType === 'editorial_direction' ? 'generated_visual_board' : 'board'}:${messageIndex}:${boardIndex}`
      : null
    const existingFeedbackLabels = feedbackBucket && Array.isArray(boardFeedbackLabels[feedbackBucket]) ? boardFeedbackLabels[feedbackBucket] : []
    const payload = {
      boardType,
      contextType: activeContext.type,
      contextId: activeContext.id,
      contextName: activeContext.name,
      title: board.label || board.title || 'Saved board',
      imageUrl: board.imageUrl,
      pieces: board.pieces || [],
      missingPieces: board.missingPieces || [],
      reason: board.reason || '',
      watchFor: board.watchFor || '',
      payload: { board, messageIndex, boardIndex, feedback_labels: existingFeedbackLabels },
      feedbackLabels: existingFeedbackLabels,
    }
    const res = await fetch('/api/saved-boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Could not save board')
    }
    setSavedBoardKeys(prev => new Set([...prev, key]))
    if (calibrationLibraryOpen) loadSavedBoardsForCalibration()
  }

  const generateVisualBoards = async (resultKey, conceptText, structuredOverride = null, pieceIdOverride = null, sourceMessageIndex = null) => {
    const pieceId = pieceIdOverride || (activeContext?.type === 'piece' ? activeContext.id : null)
    if (!pieceId) return
    const messageForFallback = Number.isInteger(sourceMessageIndex) ? messages[sourceMessageIndex] : messages[resultKey]
    setBoardLoadingIndex(resultKey)
    try {
      const res = await fetch('/api/ai/generate-outfit-boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId,
          conceptsText: conceptText,
          structuredOutfits: structuredOverride || messageForFallback?.structuredOutfits || null,
          occasion: generateOccasion,
          season: generateSeason,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate boards')
      setBoardResults(prev => ({ ...prev, [resultKey]: data.boards || [] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: err.message }] }))
    } finally {
      setBoardLoadingIndex(null)
    }
  }



  const generateEditorialVisuals = async (messageIndex, pieceIdOverride = null, questionOverride = '') => {
    const pieceId = pieceIdOverride || (activeContext?.type === 'piece' ? activeContext.id : null)
    if (!pieceId) return
    setBoardLoadingIndex(messageIndex)
    try {
      const res = await fetch('/api/ai/editorial-new-piece-visuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId,
          occasion: generateOccasion,
          season: generateSeason,
          question: questionOverride || 'Suggest ideal additions for this selected item. Ignore my wardrobe except for the selected garment. Show realistic rendered outfit concepts with suggested new pieces only.',
          history: chatHistory,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate editorial visuals')
      setEditorialVisualResults(prev => ({ ...prev, [messageIndex]: data.visuals || [] }))
    } catch (err) {
      setEditorialVisualResults(prev => ({ ...prev, [messageIndex]: [{ error: err.message }] }))
    } finally {
      setBoardLoadingIndex(null)
    }
  }


  const generateCalibrationVisuals = async (messageIndex, pieceIdOverride = null, questionOverride = '') => {
    const pieceId = pieceIdOverride || (activeContext?.type === 'piece' ? activeContext.id : null)
    if (!pieceId) return
    setBoardLoadingIndex(messageIndex)
    try {
      const res = await fetch('/api/ai/generate-calibration-boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId,
          occasion: generateOccasion,
          season: generateSeason,
          question: questionOverride || 'Generate three renderer calibration variations for this selected item.',
          history: chatHistory,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate calibration boards')
      setEditorialVisualResults(prev => ({ ...prev, [messageIndex]: data.visuals || [] }))
    } catch (err) {
      setEditorialVisualResults(prev => ({ ...prev, [messageIndex]: [{ error: err.message }] }))
    } finally {
      setBoardLoadingIndex(null)
    }
  }


  const generateIdentityEditVisuals = async (messageIndex, pieceIdOverride = null, questionOverride = '') => {
    const pieceId = pieceIdOverride || (activeContext?.type === 'piece' ? activeContext.id : null)
    if (!pieceId) return
    setBoardLoadingIndex(messageIndex)
    try {
      const res = await fetch('/api/ai/identity-edit-visuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId,
          occasion: generateOccasion,
          season: generateSeason,
          question: questionOverride || 'Edit my actual photo with ideal styling additions. Preserve my body, posture, face, age, and the selected garment.',
          history: chatHistory,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate identity-preserving edits')
      setEditorialVisualResults(prev => ({ ...prev, [messageIndex]: data.visuals || [] }))
    } catch (err) {
      setEditorialVisualResults(prev => ({ ...prev, [messageIndex]: [{ error: err.message }] }))
    } finally {
      setBoardLoadingIndex(null)
    }
  }

  const send = async () => {
    const q = input.trim()
    if (!q && !imageFile && !pendingOutfit && !pendingPiece) return

    const outfitToSend = pendingOutfit
    const pieceToSend  = pendingPiece
    const fileToSend   = imageFile
    const assistantIndex = messages.length + 1
    const compareId    = compareOutfitId
    const editorialRequestPattern = /suggest ideal|ideal addition|ideal new|new pieces|completion|completions|missing-piece|missing piece|not.*wardrobe|beyond my wardrobe|ignore my wardrobe|do not use my wardrobe|don't use my wardrobe|dont use my wardrobe|selected garment only|new item/i
    const typedEditorialRequest = editorialRequestPattern.test(q)
    const shouldGenerateIdentityEditVisuals = Boolean(pieceToSend && editorialVisualMode && identityEditMode)
    const shouldGenerateCalibrationVisuals = Boolean(pieceToSend && editorialVisualMode && calibrationMode && !shouldGenerateIdentityEditVisuals)
    const shouldGenerateEditorialVisuals = Boolean(pieceToSend && (editorialVisualMode || typedEditorialRequest) && !shouldGenerateCalibrationVisuals && !shouldGenerateIdentityEditVisuals)
    const shouldGenerateOutfits = Boolean(pieceToSend && generateOutfitMode && !shouldGenerateEditorialVisuals && !shouldGenerateCalibrationVisuals && !shouldGenerateIdentityEditVisuals)
    const shouldGenerateActiveIdentityEditVisuals = Boolean(!pieceToSend && activeContext?.type === 'piece' && identityEditMode && editorialRequestPattern.test(q))
    const shouldGenerateActiveCalibrationVisuals = Boolean(!pieceToSend && activeContext?.type === 'piece' && calibrationMode && editorialRequestPattern.test(q) && !shouldGenerateActiveIdentityEditVisuals)
    const shouldGenerateActiveEditorialVisuals = Boolean(!pieceToSend && activeContext?.type === 'piece' && editorialRequestPattern.test(q) && !shouldGenerateActiveCalibrationVisuals && !shouldGenerateActiveIdentityEditVisuals)
    const compareOutfit = compareId ? outfits.find(o => String(o.id) === String(compareId)) : null

    let displayPrev = null
    if (outfitToSend?.photo)        displayPrev = `/uploads/${outfitToSend.photo}`
    else if (pieceToSend) {
      const photo = pieceToSend.worn_photo || pieceToSend.photo
      if (photo) displayPrev = `/uploads/${photo}`
    } else if (imagePrev)           displayPrev = imagePrev

    const userContextName = compareOutfit && outfitToSend
      ? `${outfitToSend.name} vs ${compareOutfit.name}`
      : shouldGenerateIdentityEditVisuals
        ? `Identity-preserving edits for ${pieceToSend?.name}`
        : shouldGenerateCalibrationVisuals
          ? `Calibration variations for ${pieceToSend?.name}`
        : shouldGenerateEditorialVisuals
          ? `Rendered ideal additions for ${pieceToSend?.name}`
          : shouldGenerateActiveIdentityEditVisuals
            ? `Identity-preserving edits for ${activeContext?.name}`
            : shouldGenerateActiveCalibrationVisuals
              ? `Calibration variations for ${activeContext?.name}`
            : shouldGenerateActiveEditorialVisuals
              ? `Rendered ideal additions for ${activeContext?.name}`
              : shouldGenerateOutfits
                ? `${idealOnlyMode ? 'New ideal ideas for' : includeMissingPieces ? 'Ideal directions for' : 'Generate outfits for'} ${pieceToSend?.name}`
                : (outfitToSend?.name || pieceToSend?.name)

    setMessages(m => [...m, {
      role: 'user', text: q,
      imagePrev: displayPrev,
      contextName: userContextName,
      contextMode: compareOutfit && outfitToSend ? getCompareConfidenceText(outfitToSend, compareOutfit) : (outfitToSend ? `${getOutfitConfidenceMode(outfitToSend)?.label} · ${getOutfitConfidenceMode(outfitToSend)?.detail}` : ''),
    }])
    addToHistory('user', q || 'What do you think?')

    setInput(''); setImageFile(null); setImagePrev(null)
    setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId(''); setGenerateOutfitMode(false); setEditorialVisualMode(false); setCalibrationMode(false); setIdentityEditMode(false)
    setFileInputKey(k => k + 1)
    setLoading(true)

    const historySnapshot = chatHistory

    try {
      let replyText
      let replyStructuredOutfits = null

      if (outfitToSend && compareId) {
        const res = await fetch('/api/ai/compare-outfits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outfitAId: outfitToSend.id,
            outfitBId: compareId,
            question: q || 'Which outfit works better for me?',
            history: historySnapshot
          })
        })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (outfitToSend) {
        const res = await fetch('/api/ai/evaluate-outfit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outfitId: outfitToSend.id, question: q || 'What do you think of this outfit?', history: historySnapshot })
        })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (pieceToSend && shouldGenerateIdentityEditVisuals) {
        const res = await fetch('/api/ai/identity-edit-visuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: pieceToSend.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || 'Edit my actual photo with ideal styling additions. Preserve my body, posture, face, age, and the selected garment.',
            history: historySnapshot
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate identity-preserving edits')
        replyText = `Identity-preserving styling edits for ${pieceToSend.name}. These use your actual photo as the starting point.`
        replyStructuredOutfits = null
        setEditorialVisualResults(prev => ({ ...prev, [assistantIndex]: data.visuals || [] }))

      } else if (pieceToSend && shouldGenerateCalibrationVisuals) {
        const res = await fetch('/api/ai/generate-calibration-boards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: pieceToSend.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || 'Generate three renderer calibration variations for this selected item.',
            history: historySnapshot
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate calibration boards')
        replyText = `Renderer calibration variations for ${pieceToSend.name}. Pick the one that feels most like you, or label what drifted.`
        replyStructuredOutfits = null
        setEditorialVisualResults(prev => ({ ...prev, [assistantIndex]: data.visuals || [] }))

      } else if (pieceToSend && shouldGenerateEditorialVisuals) {
        const res = await fetch('/api/ai/editorial-new-piece-visuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: pieceToSend.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || 'Suggest ideal additions for this selected item. Ignore my wardrobe except for the selected garment. Show realistic rendered outfit concepts with suggested new pieces only.',
            history: historySnapshot
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate editorial visuals')
        replyText = `Rendered ideal new-piece directions for ${pieceToSend.name}.`
        replyStructuredOutfits = null
        setEditorialVisualResults(prev => ({ ...prev, [assistantIndex]: data.visuals || [] }))

      } else if (pieceToSend && shouldGenerateOutfits) {
        const res = await fetch('/api/ai/generate-outfits-for-piece', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: pieceToSend.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || (includeMissingPieces ? 'Generate ideal outfit directions for this piece, using my wardrobe when possible and missing-piece ideas when needed.' : 'Generate outfit ideas for this piece.'),
            includeMissingPieces,
            idealOnly: idealOnlyMode,
            history: historySnapshot
          })
        })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'
        replyStructuredOutfits = data.structuredOutfits || null

      } else if (pieceToSend) {
        const res = await fetch('/api/ai/evaluate-piece', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: pieceToSend.id, question: q || 'How should I style this piece?', history: historySnapshot })
        })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (shouldGenerateActiveIdentityEditVisuals) {
        const res = await fetch('/api/ai/identity-edit-visuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: activeContext.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || 'Edit my actual photo with ideal styling additions. Preserve my body, posture, face, age, and the selected garment.',
            history: historySnapshot
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate identity-preserving edits')
        replyText = `Identity-preserving styling edits for ${activeContext.name}. These use your actual photo as the starting point.`
        setEditorialVisualResults(prev => ({ ...prev, [assistantIndex]: data.visuals || [] }))

      } else if (shouldGenerateActiveCalibrationVisuals) {
        const res = await fetch('/api/ai/generate-calibration-boards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: activeContext.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || 'Generate three renderer calibration variations for this selected item.',
            history: historySnapshot
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate calibration boards')
        replyText = `Renderer calibration variations for ${activeContext.name}. Pick the one that feels most like you, or label what drifted.`
        setEditorialVisualResults(prev => ({ ...prev, [assistantIndex]: data.visuals || [] }))

      } else if (shouldGenerateActiveEditorialVisuals) {
        const res = await fetch('/api/ai/editorial-new-piece-visuals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pieceId: activeContext.id,
            occasion: generateOccasion,
            season: generateSeason,
            question: q || 'Suggest ideal additions for this selected item. Ignore my wardrobe except for the selected garment. Show realistic rendered outfit concepts with suggested new pieces only.',
            history: historySnapshot
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate editorial visuals')
        replyText = `Rendered ideal new-piece directions for ${activeContext.name}.`
        setEditorialVisualResults(prev => ({ ...prev, [assistantIndex]: data.visuals || [] }))

      } else if (fileToSend) {
        const fd = new FormData()
        fd.append('photo', fileToSend)
        fd.append('question', q || 'What do you think of this outfit?')
        const data = await (await fetch('/api/ai/outfit-feedback', { method: 'POST', body: fd })).json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else {
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, pieces, history: historySnapshot })
        })
        const data = await res.json()
        replyText = data.answer || data.error || 'Something went wrong.'
      }

      setMessages(m => [...m, { role: 'assistant', text: replyText, structuredOutfits: replyStructuredOutfits }])
      addToHistory('assistant', replyText)


    } catch (err) {
      const errText = `Error: ${err.message}`
      setMessages(m => [...m, { role: 'assistant', text: errText }])
      addToHistory('assistant', errText)
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  const handleInputChange = (e) => {
    setInput(e.target.value)
    const ta = textRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }
  }

  const pending = pendingPiece || pendingOutfit
  const compareOptions = pendingOutfit ? outfits.filter(o => o.id !== pendingOutfit.id) : []
  const pendingPhoto = pendingPiece
    ? (pendingPiece.worn_photo || pendingPiece.photo)
    : pendingOutfit?.photo
  const pendingConfidence = pendingOutfit ? getOutfitConfidenceMode(pendingOutfit) : null
  const compareOutfit = compareOutfitId ? outfits.find(o => String(o.id) === String(compareOutfitId)) : null
  const compareConfidenceText = pendingOutfit && compareOutfit ? getCompareConfidenceText(pendingOutfit, compareOutfit) : ''

  const resetChat = () => {
    setMessages([{ role: 'assistant', text: 'Starting fresh! What can I help you with?' }])
    setChatHistory([])
    setActiveContext(null)
    setSavedIndices(new Set())
    setFeedbackSaved(new Set())
    setSavedBoardKeys(new Set())
    setBoardResults({})
    setEditorialVisualResults({})
    setBoardLoadingIndex(null)
    setLearningOpen(false)
    setLearningRows([])
    setCalibrationLibraryOpen(false)
    setIdentityEditMode(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="view-header">
        <div className="view-header-top">
          <div>
            <div className="view-title">Ask Your Stylist</div>
            <div className="view-subtitle">
              {pieces.length} pieces
              {activeContext ? ` · about ${activeContext.name}` : ''}
              {chatHistory.length > 0 && !activeContext ? ` · ${Math.ceil(chatHistory.length / 2)} exchanges` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="chip" style={{ marginTop: 4 }} onClick={() => setCalibrationLibraryOpen(v => !v)}>
              Calibration{calibrationImages.length ? ` · ${calibrationImages.length}` : ''}
            </button>
            {activeContext && (
              <button className="chip" style={{ marginTop: 4 }} onClick={() => setLearningOpen(v => !v)}>
                Learning{learningRows.length ? ` · ${learningRows.length}` : ''}
              </button>
            )}
            {chatHistory.length > 0 && (
              <button className="chip" style={{ marginTop: 4 }} onClick={resetChat}>New chat</button>
            )}
          </div>
        </div>
      </div>

      {calibrationLibraryOpen && (
        <div style={{ margin: '0 16px 10px', padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Calibration Library</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Curate visual references. Star means “use strongly”; Archive means “ignore unless you restore it.”</div>
            </div>
            <button className="chip" onClick={refreshCalibrationPanel}>Refresh</button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[
              ['active', 'Active'],
              ['strong', 'Use strongly'],
              ['good_reference', 'Good'],
              ['bad_reference', 'Bad / drift'],
              ['real_photo', 'Real photos'],
              ['ignored', 'Ignored']
            ].map(([value, label]) => (
              <button
                key={value}
                className="chip"
                onClick={() => setCalibrationFilter(value)}
                style={{
                  fontSize: 11,
                  background: calibrationFilter === value ? 'var(--accent-light)' : undefined,
                  color: calibrationFilter === value ? 'var(--accent)' : undefined,
                  borderColor: calibrationFilter === value ? 'var(--accent)' : undefined
                }}
              >{label}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, alignItems: 'start', marginBottom: 12 }}>
            <label style={{ width: 92, height: 116, border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}>
              {calibrationUploadPrev ? (
                <img src={calibrationUploadPrev} alt="Calibration preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>Upload reference</span>
              )}
              <input type="file" accept="image/*" onChange={handleCalibrationUploadFile} style={{ display: 'none' }} />
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
              <select value={calibrationKind} onChange={e => setCalibrationKind(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
                <option value="good_reference">Good reference</option>
                <option value="bad_reference">Bad / drift reference</option>
                <option value="real_photo">Real outfit photo</option>
              </select>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {CALIBRATION_LABELS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleCalibrationLabel(value)}
                    style={{
                      fontSize: 10, padding: '3px 8px', borderRadius: 12,
                      border: calibrationLabels.includes(value) ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: calibrationLabels.includes(value) ? 'var(--accent-light)' : 'var(--surface)',
                      color: calibrationLabels.includes(value) ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >{label}</button>
                ))}
              </div>
              <textarea
                value={calibrationNotes}
                onChange={e => setCalibrationNotes(e.target.value)}
                placeholder="Short note: why this feels right/wrong…"
                rows={2}
                style={{ width: '100%', resize: 'vertical', padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}
              />
              <button className="chip" onClick={saveCalibrationImage} disabled={!calibrationUploadFile || calibrationUploading} style={{ justifySelf: 'start' }}>
                {calibrationUploading ? 'Saving…' : 'Save calibration image'}
              </button>
            </div>
          </div>

          {!calibrationImages.length ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No calibration images in this filter.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, maxHeight: 480, overflowY: 'auto' }}>
              {calibrationImages.map(row => {
                const isEditing = calibrationEditingId === row.id
                return (
                  <div key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: row.archived ? 'rgba(120,120,120,0.08)' : 'var(--surface-2)', opacity: row.archived ? 0.68 : 1 }}>
                    <img src={row.image_url} alt="Calibration" style={{ width: '100%', height: 170, objectFit: 'cover', display: 'block' }} />
                    <div style={{ padding: 8, display: 'grid', gap: 6 }}>
                      {isEditing ? (
                        <>
                          <select value={calibrationEditKind} onChange={e => setCalibrationEditKind(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11 }}>
                            <option value="good_reference">Good reference</option>
                            <option value="bad_reference">Bad / drift reference</option>
                            <option value="real_photo">Real outfit photo</option>
                          </select>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {CALIBRATION_LABELS.map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => toggleCalibrationEditLabel(value)}
                                style={{
                                  fontSize: 9, padding: '2px 6px', borderRadius: 12,
                                  border: calibrationEditLabels.includes(value) ? '1px solid var(--accent)' : '1px solid var(--border)',
                                  background: calibrationEditLabels.includes(value) ? 'var(--accent-light)' : 'var(--surface)',
                                  color: calibrationEditLabels.includes(value) ? 'var(--accent)' : 'var(--text-muted)',
                                  cursor: 'pointer'
                                }}
                              >{label}</button>
                            ))}
                          </div>
                          <textarea
                            value={calibrationEditNotes}
                            onChange={e => setCalibrationEditNotes(e.target.value)}
                            rows={3}
                            style={{ width: '100%', resize: 'vertical', padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11 }}
                          />
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => saveCalibrationEdit(row.id)}>Save</button>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={cancelEditCalibrationImage}>Cancel</button>
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
                              {row.labels.slice(0, 6).map(label => <span key={label} style={{ fontSize: 9, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px' }}>{label.replaceAll('_', ' ')}</span>)}
                            </div>
                          )}
                          {row.notes && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{row.notes}</div>}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => toggleCalibrationFavorite(row)}>{row.favorite ? 'Use normal' : 'Use strongly'}</button>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => startEditCalibrationImage(row)}>Edit</button>
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

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Saved visual boards</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saved boards are calibration references too. Star the ones that should strongly guide future styling/rendering.</div>
              </div>
              <button className="chip" onClick={loadSavedBoardsForCalibration} disabled={savedBoardsLoading}>{savedBoardsLoading ? 'Loading…' : 'Refresh boards'}</button>
            </div>
            {!savedBoards.length ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No saved boards yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, maxHeight: 430, overflowY: 'auto' }}>
                {savedBoards.map(board => (
                  <div key={board.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: board.archived ? 'rgba(120,120,120,0.08)' : 'var(--surface-2)', opacity: board.archived ? 0.65 : 1 }}>
                    {board.image_url && <img src={board.image_url} alt={board.title || 'Saved board'} style={{ width: '100%', height: 190, objectFit: 'cover', display: 'block' }} />}
                    <div style={{ padding: 8, display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: board.favorite ? 'var(--accent)' : 'var(--text)' }}>{board.favorite ? '★ ' : ''}{board.title || 'Saved board'}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{board.board_type || 'board'}{board.context_name ? ` · ${board.context_name}` : ''}</div>
                        </div>
                        {board.archived && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>ignored</span>}
                      </div>
                      {Array.isArray(board.pieces) && board.pieces.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                          {board.pieces.slice(0, 4).map(p => p?.name).filter(Boolean).join(' + ')}
                        </div>
                      )}
                      {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{board.reason}</div>}
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => patchSavedBoard(board, { favorite: !board.favorite })}>{board.favorite ? 'Use normal' : 'Use strongly'}</button>
                        {board.archived ? (
                          <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => patchSavedBoard(board, { archived: false })}>Restore</button>
                        ) : (
                          <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => patchSavedBoard(board, { archived: true })}>Ignore</button>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                        {SAVED_BOARD_FEEDBACK_LABELS.map(([label, text]) => {
                          const active = Array.isArray(board?.payload?.feedback_labels) && board.payload.feedback_labels.includes(label)
                          return (
                            <button
                              key={label}
                              className="chip"
                              style={{
                                fontSize: 9,
                                padding: '2px 6px',
                                borderColor: active ? 'var(--accent)' : 'var(--border)',
                                background: active ? 'var(--accent)' : 'var(--surface)',
                                color: active ? '#fff' : 'var(--text-muted)',
                                fontWeight: active ? 800 : 500,
                                boxShadow: active ? '0 0 0 1px rgba(122,86,43,0.25)' : undefined
                              }}
                              onClick={() => toggleSavedBoardFeedback(board, label)}
                              title="Save this board feedback as calibration memory"
                            >
                              {text}
                            </button>
                          )
                        })}
                      </div>
                      {Array.isArray(board?.payload?.feedback_labels) && board.payload.feedback_labels.length > 0 && (
                        <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, marginTop: 2 }}>
                          Selected: {board.payload.feedback_labels.map(label => {
                            const found = SAVED_BOARD_FEEDBACK_LABELS.find(([value]) => value === label)
                            return found ? found[1] : label
                          }).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {learningOpen && activeContext && (
        <div style={{ margin: '0 16px 10px', padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Saved stylist learning</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gold rules strongly affect future outfit ranking. Archive bad learning instead of letting it accumulate.</div>
            </div>
            <button className="chip" onClick={() => loadLearningRows()}>Refresh</button>
          </div>
          {!learningRows.length ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No saved feedback for this context yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {learningRows.map(row => (
                <div key={row.id} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: row.is_gold ? 'var(--accent-light)' : 'var(--surface-2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: row.is_gold ? 'var(--accent)' : 'var(--text)' }}>
                        {row.is_gold ? '★ Gold · ' : ''}{row.feedback_type}{row.label ? ` · ${row.label}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.note || 'No note'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                      <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => updateLearningRow(row.id, { isGold: !row.is_gold })}>{row.is_gold ? 'Ungold' : 'Gold'}</button>
                      <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => archiveLearningRow(row.id)}>Archive</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat thread */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
        {messages.length === 1 && !pending && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Try asking…</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => setInput(s)} style={{
                  textAlign: 'left', padding: '10px 14px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div className="chat-thread">
          {messages.map((m, i) => (
            <div key={i}>
              {(m.imagePrev || m.contextName) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, gap: 8, alignItems: 'flex-end' }}>
                  {(m.contextName || m.contextMode) && (
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      {m.contextName && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>{m.contextName}</span>}
                      {m.contextMode && <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{m.contextMode}</span>}
                    </span>
                  )}
                  {m.imagePrev && <img src={m.imagePrev} alt="" style={{ maxWidth: 140, borderRadius: 'var(--radius)', objectFit: 'contain', background: 'var(--surface-2)' }} />}
                </div>
              )}
              {(() => {
                const multi = isMultiOutfitResponse(m)
                const hasBoards = Boolean(boardResults[i]?.length)
                if (m.role === 'assistant' && multi) {
                  const hasStructuredIdeas = Array.isArray(m.structuredOutfits) && m.structuredOutfits.length > 0
                  return (
                    <div className={`ai-message ${m.role}`} style={{ padding: '12px 14px' }}>
                      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.45 }}>{getCompactOutfitIntro(m, hasBoards)}</p>
                      {hasStructuredIdeas ? renderStructuredAdvice(m, i) : (
                        <div style={{ marginTop: 10 }}>
                          {m.text.split('\n').filter(Boolean).map((line, j) => (
                            <p key={j} style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 7px', color: 'var(--text)' }}>{line}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                return (
                  <div className={`ai-message ${m.role}`}>
                    {m.text.split('\n').filter(Boolean).map((line, j) => <p key={j}>{line}</p>)}
                  </div>
                )
              })()}

              {/* Assistant actions — save notes and visual boards */}
              {m.role === 'assistant' && i > 0 && activeContext && (
                <div style={{ marginTop: 4, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
                    {(!boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text)) && (savedIndices.has(i) ? (
                      <span style={{ fontSize: 11, color: 'var(--donate)', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px' }}>
                        ✓ Saved to {activeContext.name}
                      </span>
                    ) : (
                      <button
                        onClick={() => saveMessageToNotes(i, m.text)}
                        style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          padding: '3px 10px', borderRadius: 12,
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          display: 'flex', alignItems: 'center', gap: 4,
                          transition: 'all 0.15s',
                          cursor: 'pointer',
                        }}
                      >
                        ◇ Save as styling rule for {activeContext.name}
                      </button>
                    ))}
                    {activeContext.type === 'piece' && !isMultiOutfitResponse(m) && !boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text) && (
                      <button
                        onClick={() => generateVisualBoards(i, m.text, null, null, i)}
                        disabled={boardLoadingIndex === i}
                        style={{
                          fontSize: 11, color: 'var(--accent)',
                          padding: '3px 10px', borderRadius: 12,
                          border: '1px solid var(--accent)',
                          background: 'var(--surface)',
                          display: 'flex', alignItems: 'center', gap: 4,
                          transition: 'all 0.15s',
                          cursor: boardLoadingIndex === i ? 'default' : 'pointer',
                          opacity: boardLoadingIndex === i ? 0.65 : 1,
                        }}
                      >
                        {boardLoadingIndex === i ? 'Generating boards…' : (boardResults[i]?.length ? '▧ Regenerate boards' : '▧ Generate visual boards')}
                      </button>
                    )}

                    {!isMultiOutfitResponse(m) && !boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text) && FEEDBACK_ACTIONS.map(action => {
                      const key = `message:${i}:${action.type}`
                      const isSaved = feedbackSaved.has(key)
                      return (
                        <button
                          key={key}
                          onClick={() => saveStylistFeedback({
                            key,
                            feedbackType: action.type,
                            targetType: 'message',
                            label: action.label,
                            note: m.text,
                            payload: { messageIndex: i, text: m.text },
                            appendToPiece: activeContext.type === 'piece' && ['signature', 'works', 'not_me', 'too_soft', 'proportion_problem', 'wrong_item_read'].includes(action.type),
                          })}
                          disabled={isSaved}
                          style={{
                            fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)',
                            padding: '3px 8px', borderRadius: 12,
                            border: '1px solid var(--border)',
                            background: isSaved ? 'var(--surface-2)' : 'var(--surface)',
                            cursor: isSaved ? 'default' : 'pointer',
                          }}
                        >
                          {isSaved ? '✓ ' : ''}{action.label}
                        </button>
                      )
                    })}
                  </div>

                  {editorialVisualResults[i]?.length > 0 && (
                    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                      {editorialVisualResults[i].map((visual, idx) => (
                        <div key={idx} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                          {visual.error ? (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Visual error: {visual.error}</div>
                          ) : (
                            <>
                              <img src={visual.imageUrl} alt={visual.label} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)' }} />
                              <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{visual.label}</div>
                              {Array.isArray(visual.missingPieces) && visual.missingPieces.length > 0 && (
                                <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>
                                  Suggested additions: {visual.missingPieces.join(' + ')}
                                </div>
                              )}
                              {visual.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>{visual.reason}</div>}
                              {visual.watchFor && <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.4 }}><strong>Watch:</strong> {visual.watchFor}</div>}
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                                {(() => {
                                  const key = `editorial-board:${i}:${idx}`
                                  const isSaved = savedBoardKeys.has(key)
                                  return (
                                    <button
                                      onClick={() => saveGeneratedBoard({ key, board: visual, boardType: 'editorial_direction', messageIndex: i, boardIndex: idx })}
                                      disabled={isSaved}
                                      style={{
                                        fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--accent)',
                                        padding: '3px 8px', borderRadius: 12,
                                        border: '1px solid var(--border)',
                                        background: isSaved ? 'var(--surface-2)' : 'var(--surface)',
                                        cursor: isSaved ? 'default' : 'pointer',
                                      }}
                                    >
                                      {isSaved ? '✓ Saved board' : 'Save board'}
                                    </button>
                                  )
                                })()}
                                {visual.mode !== 'renderer_calibration' && GENERATED_BOARD_FEEDBACK_LABELS.map(([type, label]) => {
                                  const key = `visual-board:${i}:${idx}:${type}`
                                  const isSaved = feedbackSaved.has(key)
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => saveStylistFeedback({
                                        key,
                                        feedbackType: type,
                                        targetType: 'generated_visual_board',
                                        label: `${visual.label || 'visual board'} · ${label}`,
                                        note: visual.reason || visual.watchFor || '',
                                        payload: { visual, messageIndex: i, boardIndex: idx, feedbackLabel: type },
                                        appendToPiece: activeContext?.type === 'piece' && ['signature','works','not_me','too_safe','too_soft','too_generic','wrong_proportions','wrong_silhouette','catalog_drift','weak_structure','weak_contrast','bad_grounding'].includes(type),
                                      })}
                                      disabled={isSaved}
                                      style={{
                                        fontSize: 10,
                                        color: isSaved ? 'var(--donate)' : 'var(--text-muted)',
                                        padding: '3px 8px', borderRadius: 12,
                                        border: isSaved ? '1px solid var(--donate)' : '1px solid var(--border)',
                                        background: isSaved ? 'rgba(91, 124, 76, 0.10)' : 'var(--surface)',
                                        cursor: isSaved ? 'default' : 'pointer',
                                      }}
                                    >
                                      {isSaved ? '✓ ' : ''}{label}
                                    </button>
                                  )
                                })}
                                {visual.mode !== 'renderer_calibration' && boardLearningStatus[`generated_visual_board:${i}:${idx}`] && (
                                  <div style={{ width: '100%', fontSize: 10, color: 'var(--donate)', marginTop: 2 }}>
                                    {boardLearningStatus[`generated_visual_board:${i}:${idx}`]}
                                  </div>
                                )}
                                {visual.mode === 'renderer_calibration' && ['most_like_me','strong_direction','too_safe','too_soft','too_boho','too_polished','wrong_proportions','wrong_silhouette','wrong_energy','close_but_off'].map(type => {
                                  const labelMap = {
                                    most_like_me: 'Most like me', close_but_off: 'Close but off', wrong_energy: 'Wrong energy', looks_older_than_me: 'Looks older than me', face_drift: 'Face drift', expression_drift: 'Expression drift', lost_resemblance: 'Lost resemblance', too_polished: 'Too polished', too_corporate: 'Too corporate', too_conservative: 'Too conservative', catalog_drift: 'Catalog drift', generic_ai_woman: 'Generic AI woman drift', mature_luxury_drift: 'Mature luxury drift', wrong_proportions: 'Wrong proportions', wrong_silhouette: 'Wrong silhouette'
                                  }
                                  const key = `calibration:${i}:${idx}:${type}`
                                  const isSaved = feedbackSaved.has(key)
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => saveStylistFeedback({
                                        key,
                                        feedbackType: type,
                                        targetType: 'renderer_calibration',
                                        label: `${visual.variation || visual.label || 'variation'} · ${labelMap[type]}`,
                                        note: visual.reason || visual.watchFor || '',
                                        payload: { visual, messageIndex: i, boardIndex: idx, calibration: true },
                                        appendToPiece: activeContext?.type === 'piece' && ['most_like_me','strong_direction','wrong_proportions','wrong_silhouette','wrong_energy'].includes(type),
                                      })}
                                      disabled={isSaved}
                                      style={{
                                        fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)',
                                        padding: '3px 8px', borderRadius: 12,
                                        border: '1px solid var(--border)',
                                        background: isSaved ? 'var(--surface-2)' : 'var(--surface)',
                                        cursor: isSaved ? 'default' : 'pointer',
                                      }}
                                    >
                                      {isSaved ? '✓ ' : ''}{labelMap[type]}
                                    </button>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {boardResults[i]?.length > 0 && (
                    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                      {boardResults[i].map((board, idx) => (
                        <div key={idx} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                          {board.error ? (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Board error: {board.error}</div>
                          ) : (
                            <>
                              <img src={board.imageUrl} alt={board.label} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)' }} />
                              <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{board.label}</div>
                              {Array.isArray(board.pieces) && board.pieces.length > 0 && (
                                <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 2 }}>
                                  {board.pieces.map(p => p.name || p.label).filter(Boolean).join(' + ')}
                                </div>
                              )}
                              {board.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>{board.reason}</div>}
                              {board.watchFor && <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.4 }}><strong>Watch:</strong> {board.watchFor}</div>}
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                                {(() => {
                                  const saveKey = `wardrobe-board:${i}:${idx}`
                                  const isBoardSaved = savedBoardKeys.has(saveKey)
                                  return (
                                    <button
                                      onClick={() => saveGeneratedBoard({ key: saveKey, board, boardType: 'wardrobe_board', messageIndex: i, boardIndex: idx })}
                                      disabled={isBoardSaved}
                                      style={{
                                        fontSize: 10, color: isBoardSaved ? 'var(--donate)' : 'var(--accent)',
                                        padding: '2px 7px', borderRadius: 10,
                                        border: '1px solid var(--border)',
                                        background: isBoardSaved ? 'var(--surface-2)' : 'var(--surface)',
                                        cursor: isBoardSaved ? 'default' : 'pointer',
                                      }}
                                    >
                                      {isBoardSaved ? '✓ Saved board' : 'Save board'}
                                    </button>
                                  )
                                })()}
                                {GENERATED_BOARD_FEEDBACK_LABELS.map(([type, label]) => {
                                  const key = `board:${i}:${idx}:${type}`
                                  const isSaved = feedbackSaved.has(key)
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => saveStylistFeedback({
                                        key,
                                        feedbackType: type,
                                        targetType: 'board',
                                        label: `${board.label || 'board'} · ${label}`,
                                        note: board.reason || board.watchFor || '',
                                        payload: { board, messageIndex: i, boardIndex: idx, feedbackLabel: type },
                                        appendToPiece: activeContext.type === 'piece' && ['signature', 'works', 'not_me', 'too_safe', 'too_soft', 'too_generic', 'wrong_proportions', 'wrong_silhouette', 'catalog_drift', 'weak_structure', 'weak_contrast', 'bad_grounding'].includes(type),
                                      })}
                                      disabled={isSaved}
                                      style={{
                                        fontSize: 10,
                                        color: isSaved ? 'var(--donate)' : 'var(--text-muted)',
                                        padding: '2px 7px', borderRadius: 10,
                                        border: isSaved ? '1px solid var(--donate)' : '1px solid var(--border)',
                                        background: isSaved ? 'rgba(91, 124, 76, 0.10)' : 'var(--surface)',
                                        cursor: isSaved ? 'default' : 'pointer',
                                      }}
                                    >
                                      {isSaved ? '✓ ' : ''}{label}
                                    </button>
                                  )
                                })}
                                {boardLearningStatus[`board:${i}:${idx}`] && (
                                  <div style={{ width: '100%', fontSize: 10, color: 'var(--donate)', marginTop: 2 }}>
                                    {boardLearningStatus[`board:${i}:${idx}`]}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {isMultiOutfitResponse(m) && getEditorialNotes(m.text).length > 0 && (
                    <details style={{ marginTop: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Stylist notes / avoid</summary>
                      <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
                        {getEditorialNotes(m.text).map((note, idx) => (
                          <div key={idx} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>{note}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="ai-message assistant">
              <div className="typing-dots"><span /><span /><span /></div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Pending context banner */}
      {pending && (
        <div style={{ margin: '0 16px 8px', padding: '10px 14px', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {pendingPhoto && (
            <img src={`/uploads/${pendingPhoto}`} alt={pending.name} style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 6, background: 'var(--surface-2)', flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', marginBottom: 1 }}>
              {pendingPiece ? 'Piece ready to style' : 'Outfit ready to evaluate'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pending.name}</div>
            {pendingConfidence && (
              <div style={{ marginTop: 6 }}>
                <span style={confidenceBadgeStyle(pendingConfidence.tone)}>
                  {pendingConfidence.label}
                  <span style={{ opacity: 0.75 }}>· {pendingConfidence.detail}</span>
                </span>
              </div>
            )}
            {pendingPiece && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    onClick={() => {
                      setGenerateOutfitMode(true)
                      setEditorialVisualMode(false)
                      setCalibrationMode(false)
                      setIdentityEditMode(false)
                      setIncludeMissingPieces(false)
                      setIdealOnlyMode(false)
                      setInput('Style this piece using my existing wardrobe.')
                    }}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: generateOutfitMode && !editorialVisualMode ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: generateOutfitMode && !editorialVisualMode ? 'var(--accent)' : 'var(--surface)',
                      color: generateOutfitMode && !editorialVisualMode ? '#fff' : 'var(--text)',
                      fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center'
                    }}
                  >
                    {generateOutfitMode && !editorialVisualMode ? '✓ Style with my wardrobe' : 'Style with my wardrobe'}
                  </button>
                  <button
                    onClick={() => {
                      setEditorialVisualMode(true)
                      setCalibrationMode(false)
                      setIdentityEditMode(false)
                      setGenerateOutfitMode(false)
                      setIncludeMissingPieces(false)
                      setIdealOnlyMode(true)
                      setInput('Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.')
                    }}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: editorialVisualMode ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: editorialVisualMode ? 'var(--accent)' : 'var(--surface)',
                      color: editorialVisualMode ? '#fff' : 'var(--text)',
                      fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center'
                    }}
                  >
                    {editorialVisualMode ? '✓ Suggest ideal additions' : 'Suggest ideal additions'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {editorialVisualMode
                    ? (identityEditMode ? 'Edits your actual worn photo so body, posture, age read, and garment reality stay grounded.' : calibrationMode ? 'Generates three controlled synthetic variations so you can calibrate the renderer.' : 'Uses only the selected item as the anchor and suggests new-piece directions.')
                    : 'Uses saved wardrobe pieces and generates visual outfit boards.'}
                </div>
                {editorialVisualMode && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-muted)' }}>
                      <input
                        type="checkbox"
                        checked={identityEditMode}
                        onChange={e => {
                          setIdentityEditMode(e.target.checked)
                          if (e.target.checked) {
                            setCalibrationMode(false)
                            setInput('Edit my actual photo with ideal styling additions. Preserve my body, posture, face, age, and the selected garment.')
                          } else {
                            setInput(calibrationMode
                              ? 'Generate three renderer calibration variations for this selected item.'
                              : 'Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.'
                            )
                          }
                        }}
                      />
                      Use my actual photo: identity-preserving styling edits
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-muted)', opacity: identityEditMode ? 0.55 : 1 }}>
                      <input
                        type="checkbox"
                        checked={calibrationMode}
                        disabled={identityEditMode}
                        onChange={e => {
                          setCalibrationMode(e.target.checked)
                          setInput(e.target.checked
                            ? 'Generate three renderer calibration variations for this selected item.'
                            : 'Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.'
                          )
                        }}
                      />
                      Calibration mode: generate A/B/C synthetic variations to compare renderer direction
                    </label>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <select value={generateOccasion} onChange={e => setGenerateOccasion(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
                    <option value="casual">Casual</option>
                    <option value="city">City</option>
                    <option value="smart casual">Smart casual</option>
                    <option value="evening">Evening</option>
                    <option value="gallery / art event">Gallery / art event</option>
                    <option value="travel">Travel</option>
                  </select>
                  <select value={generateSeason} onChange={e => setGenerateSeason(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
                    <option value="current season">Current season</option>
                    <option value="early spring / cool mild weather">Early spring</option>
                    <option value="spring / summer">Spring / summer</option>
                    <option value="fall">Fall</option>
                    <option value="winter">Winter</option>
                    <option value="year-round">Year-round</option>
                  </select>
                </div>
              </div>
            )}
            {pendingOutfit && (
              <div style={{ marginTop: 8 }}>
                <select
                  value={compareOutfitId}
                  onChange={e => {
                    setCompareOutfitId(e.target.value)
                    if (e.target.value && (!input.trim() || input === 'What do you think of this outfit?')) {
                      setInput('Which outfit works better for me?')
                    }
                  }}
                  style={{
                    width: '100%', padding: '7px 9px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)'
                  }}
                >
                  <option value="">Evaluate this outfit only</option>
                  {compareOptions.map(o => (
                    <option key={o.id} value={o.id}>Compare with: {o.name}</option>
                  ))}
                </select>
                {compareOutfitId && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                    {compareConfidenceText || 'Compare mode will use both outfit photos, linked garments, notes, and statuses.'}
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={() => { setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId(''); setGenerateOutfitMode(false); setEditorialVisualMode(false); setCalibrationMode(false); setIdentityEditMode(false); setIdealOnlyMode(false); setInput('') }} style={{ color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Manual image preview */}
      {imagePrev && (
        <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <img src={imagePrev} alt="" style={{ height: 56, width: 56, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }} />
            <button onClick={() => { setImageFile(null); setImagePrev(null) }} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, background: 'var(--text)', color: '#fff', borderRadius: '50%', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Photo attached</span>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '8px 16px 16px' }}>
        <div className="ai-input-row">
          <label className={`ai-upload-btn ${imagePrev ? 'has-image' : ''}`} title="Attach photo">
            <input key={fileInputKey} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
            📷
          </label>
          <textarea
            ref={textRef}
            className="ai-input"
            placeholder={pending ? `Ask about ${pending.name}…` : 'Ask about your wardrobe…'}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKey}
            rows={1}
          />
          <button className="ai-send-btn" onClick={send} disabled={loading || (!input.trim() && !imageFile && !pending)}>↑</button>
        </div>
      </div>
    </div>
  )
}
