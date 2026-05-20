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

const WHOLE_WARDROBE_FEEDBACK_LABELS = [
  ['works', 'Use more like this'],
  ['good_formula', 'Good formula'],
  ['good_pieces', 'Good pieces'],
  ['not_me', 'Not me'],
  ['wrong_item_read', 'Bad piece choice'],
  ['bad_occasion', 'Bad occasion'],
  ['fit_issue', 'Fit issue'],
]

const formatMs = (ms) => {
  const n = Number(ms)
  if (!Number.isFinite(n)) return null
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

const timingSummary = (timings = {}) => Object.entries(timings || {})
  .filter(([, value]) => typeof value === 'number')
  .map(([key, value]) => `${key.replace(/Ms$/, '')}: ${formatMs(value)}`)
  .join(' · ')

const VISUAL_FOLLOWUP_PATTERN = /\b(look|again|photo|image|visible|read|missed|shoe|shoes|hem|cuff|floor|fit|waist|rise|pull|bunch|color|colour|sleeve|neckline|length|drape|fabric|texture|pattern|lighting|crop|cropped)\b/i

const compactEvaluationMemory = (evaluation = null) => {
  if (!evaluation || typeof evaluation !== 'object') return ''
  const facts = evaluation.visibleFacts || {}
  const intent = evaluation.inferredIntent || {}
  const shoe = facts.shoeAnalysis || {}
  return [
    intent.label ? `Intent: ${intent.label}` : '',
    evaluation.verdict ? `Verdict: ${evaluation.verdict}` : '',
    facts.floorLine ? `Floor line: ${facts.floorLine}` : '',
    facts.fitPlacement ? `Fit placement: ${facts.fitPlacement}` : '',
    shoe.visibility || shoe.read || shoe.effect
      ? `Shoe read: ${[shoe.visibility, shoe.read, shoe.effect, shoe.confidence].filter(Boolean).join(' · ')}`
      : '',
    evaluation.firstVisibleIssue ? `First visible issue: ${evaluation.firstVisibleIssue}` : '',
    evaluation.recommendation ? `Last recommendation: ${evaluation.recommendation}` : '',
  ].filter(Boolean).join('\n')
}

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
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }
  ])
  const [chatHistory, setChatHistory] = useState([])
  const [threadMemory, setThreadMemory] = useState(null)
  const [internalActiveContext, setInternalActiveContext] = useState(null)
  const activeContext = externalActiveContext ?? internalActiveContext
  const setActiveContext = useCallback((nextContext) => {
    setInternalActiveContext(nextContext)
    onContextChange?.(nextContext)
  }, [onContextChange])
  const [input, setInput] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePrev, setImagePrev] = useState(null)
  const [pendingOutfit, setPendingOutfit] = useState(null)
  const [pendingPiece, setPendingPiece] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState('')
  const [imageStatusByKey, setImageStatusByKey] = useState({})
  const [pieces, setPieces] = useState([])
  const [outfits, setOutfits] = useState([])
  const [compareOutfitId, setCompareOutfitId] = useState('')
  const [generateOutfitMode, setGenerateOutfitMode] = useState(false)
  const [includeMissingPieces, setIncludeMissingPieces] = useState(false)
  const [idealOnlyMode, setIdealOnlyMode] = useState(false)
  const [editorialVisualMode, setEditorialVisualMode] = useState(false)
  const [generateOccasion, setGenerateOccasion] = useState('casual')
  const [generateSeason, setGenerateSeason] = useState('current season')
  const [wardrobeOutfitOccasion, setWardrobeOutfitOccasion] = useState('casual')
  const [wardrobeOutfitSeason, setWardrobeOutfitSeason] = useState('current season')
  const [wardrobeOutfitMood, setWardrobeOutfitMood] = useState('artistic minimalist')
  const [savedIndices, setSavedIndices] = useState(new Set())
  const [feedbackSaved, setFeedbackSaved] = useState(new Set())
  const [feedbackIdsByKey, setFeedbackIdsByKey] = useState({})
  const [boardFeedbackLabels, setBoardFeedbackLabels] = useState({})
  const [boardLearningStatus, setBoardLearningStatus] = useState({})
  const [savedBoardKeys, setSavedBoardKeys] = useState(new Set())
  const [learningOpen, setLearningOpen] = useState(false)
  const [learningRows, setLearningRows] = useState([])
  const [internalCalibrationLibraryOpen, setInternalCalibrationLibraryOpen] = useState(false)
  const hasExternalCalibrationLibraryOpen = externalCalibrationLibraryOpen !== undefined
  const calibrationLibraryOpen = externalCalibrationLibraryOpen ?? internalCalibrationLibraryOpen
  const setCalibrationLibraryOpen = useCallback((nextOpen) => {
    const resolvedOpen = typeof nextOpen === 'function'
      ? nextOpen(calibrationLibraryOpen)
      : nextOpen
    setInternalCalibrationLibraryOpen(resolvedOpen)
    if (resolvedOpen !== calibrationLibraryOpen) onToggleCalibration?.(resolvedOpen)
  }, [calibrationLibraryOpen, onToggleCalibration])
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
  const [boardResults, setBoardResults] = useState({})
  const [editorialVisualResults, setEditorialVisualResults] = useState({})
  const [boardLoadingIndex, setBoardLoadingIndex] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const bottomRef = useRef(null)
  const textRef = useRef(null)
  const loadingTimersRef = useRef([])
  const lastAutoOutfitActionRef = useRef('')

  const clearLoadingTimers = () => {
    loadingTimersRef.current.forEach(clearTimeout)
    loadingTimersRef.current = []
  }

  const startStatusSequence = (steps, setter = setLoadingStatus) => {
    clearLoadingTimers()
    if (!Array.isArray(steps) || !steps.length) return
    setter(steps[0].text)
    loadingTimersRef.current = steps.slice(1).map(step => setTimeout(() => setter(step.text), step.ms))
  }

  useEffect(() => () => clearLoadingTimers(), [])

  useEffect(() => {
    fetch('/api/pieces').then(r => r.json()).then(setPieces)
    fetch('/api/outfits').then(r => r.json()).then(setOutfits).catch(() => setOutfits([]))
  }, [])

  useEffect(() => {
    if (!initialOutfit) return
    const shouldAutoSend = initialOutfit.autoSend === true
    setPendingOutfit(shouldAutoSend ? null : initialOutfit)
    setPendingPiece(null)
    setCompareOutfitId('')
    setGenerateOutfitMode(false)
    setIncludeMissingPieces(false)
    setIdealOnlyMode(false)
    setEditorialVisualMode(false)
    setActiveContext({ type: 'outfit', id: initialOutfit.id, name: initialOutfit.name })
    const prompt = initialOutfit.stylistPrompt || 'What do you think of this outfit?'
    setInput(shouldAutoSend ? '' : prompt)
    setImageFile(null); setImagePrev(null)
    onClearOutfit?.()
    if (shouldAutoSend) {
      const actionKey = `${initialOutfit.id || initialOutfit.name || 'outfit'}:${initialOutfit.imageGenerationMode ? 'variants' : 'critique'}:${prompt}`
      if (lastAutoOutfitActionRef.current === actionKey) return
      lastAutoOutfitActionRef.current = actionKey
      setTimeout(() => send({ outfit: initialOutfit, input: prompt }), 0)
    }
  }, [initialOutfit])

  useEffect(() => {
    if (!initialPiece) return
    setPendingPiece(initialPiece)
    setPendingOutfit(null)
    setCompareOutfitId('')
    setGenerateOutfitMode(true)
    setIncludeMissingPieces(false)
    setIdealOnlyMode(false)
    setEditorialVisualMode(false)
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
    } catch { setLearningRows([]) }
  }

  useEffect(() => { loadLearningRows(activeContext) }, [activeContext?.type, activeContext?.id])

  const updateLearningRow = async (id, patch) => {
    await fetch(`/api/stylist-feedback/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
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
    } catch { setCalibrationImages([]) }
  }

  const loadSavedBoardsForCalibration = async () => {
    setSavedBoardsLoading(true)
    try {
      const res = await fetch('/api/saved-boards?limit=80')
      const rows = await res.json()
      setSavedBoards(Array.isArray(rows) ? rows : [])
    } catch { setSavedBoards([]) }
    finally { setSavedBoardsLoading(false) }
  }

  const refreshCalibrationPanel = async () => {
    await Promise.all([loadCalibrationImages(), loadSavedBoardsForCalibration()])
  }

  const patchSavedBoard = async (row, patch) => {
    const res = await fetch(`/api/saved-boards/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
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
    const nextLabels = isAdding ? [...current, label] : current.filter(x => x !== label)
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

  const toggleCalibrationLabel = (label) => setCalibrationLabels(prev => prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label])
  const toggleCalibrationEditLabel = (label) => setCalibrationEditLabels(prev => prev.includes(label) ? prev.filter(x => x !== label) : [...prev, label])

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
      setCalibrationUploadFile(null); setCalibrationUploadPrev(null)
      setCalibrationLabels([]); setCalibrationNotes('')
      await loadCalibrationImages()
    } catch (err) { alert(`Could not save calibration image: ${err.message}`) }
    finally { setCalibrationUploading(false) }
  }

  const archiveCalibrationImage = async (id, archived = true) => {
    await fetch(`/api/calibration-images/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }) })
    await loadCalibrationImages()
  }

  const toggleCalibrationFavorite = async (row) => {
    await fetch(`/api/calibration-images/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !row.favorite }) })
    await loadCalibrationImages()
  }

  const startEditCalibrationImage = (row) => {
    setCalibrationEditingId(row.id)
    setCalibrationEditKind(row.kind || 'good_reference')
    setCalibrationEditLabels(Array.isArray(row.labels) ? row.labels : [])
    setCalibrationEditNotes(row.notes || '')
  }

  const cancelEditCalibrationImage = () => { setCalibrationEditingId(null); setCalibrationEditLabels([]); setCalibrationEditNotes('') }

  const saveCalibrationEdit = async (id) => {
    await fetch(`/api/calibration-images/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: calibrationEditKind, labels: calibrationEditLabels, notes: calibrationEditNotes }) })
    cancelEditCalibrationImage()
    await loadCalibrationImages()
  }

  const addToHistory = (role, content) => setChatHistory(h => [...h, { role, content }])

  const handleImage = (e) => {
    const f = e.target.files[0]; if (!f) return
    setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId('')
    setGenerateOutfitMode(false); setEditorialVisualMode(false); setIncludeMissingPieces(false); setIdealOnlyMode(false)
    setImageFile(f); setImagePrev(URL.createObjectURL(f))
  }

  const getOutfitConfidenceMode = (outfit) => {
    if (!outfit) return null
    const linkedCount = Array.isArray(outfit.pieces) ? outfit.pieces.length : 0
    if (linkedCount > 0) return { label: 'Wardrobe-aware analysis', detail: `${linkedCount} linked garment${linkedCount === 1 ? '' : 's'}`, tone: 'strong' }
    return { label: 'Visual analysis only', detail: 'Link saved pieces to improve precision', tone: 'soft' }
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
    display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content',
    padding: '3px 8px', borderRadius: 999, fontSize: 11, lineHeight: 1.2,
    border: tone === 'strong' ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: tone === 'strong' ? 'var(--surface)' : 'var(--surface-2)',
    color: tone === 'strong' ? 'var(--accent)' : 'var(--text-muted)',
  })

  const saveMessageToNotes = async (messageIndex, text) => {
    if (!activeContext) return
    const url = activeContext.type === 'piece' ? `/api/pieces/${activeContext.id}/append-note` : `/api/outfits/${activeContext.id}/append-note`
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
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
    return /Generated outfit ideas for:|Signature \/ strongest direction|Best owned wardrobe direction|Ideal editorial completion|Usable variation|Optional experimental direction|styling directions for/i.test(text)
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
      if (/^(Signature|Usable variation|Optional experimental direction|Best owned wardrobe direction|Ideal editorial completion|Pieces:|Why it works:|Watch for:|Generated outfit ideas|Occasion)/i.test(line)) { mode = null; continue }
      if (!mode || !clean || /^none$/i.test(clean) || /^---+$/.test(clean)) continue
      if (mode === 'skip') notes.push(`Skip: ${clean}`)
      if (mode === 'avoid') notes.push(`Avoid: ${clean}`)
      if (mode === 'learning') notes.push(`Learning: ${clean}`)
    }
    const seen = new Set()
    return notes.filter(note => { const k = note.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5)
  }

  const getCompactOutfitIntro = (message, hasBoards = false) => {
    if (message?.wholeWardrobe) return 'Strongest whole-wardrobe outfits for right now. Text only for this phase.'
    const text = String(message?.text || '')
    const titleMatch = text.match(/Generated outfit ideas for:\*\*\s*([^\n]+)/i)
    const itemName = titleMatch ? titleMatch[1].replace(/\*/g, '').trim() : activeContext?.name
    if (hasBoards) return `Outfit directions for ${itemName}. Visuals are shown below for selected ideas.`
    return `Text outfit ideas generated for ${itemName}. Use "Generate visual for this outfit" only on the ideas you want to see.`
  }

  // ── Render one editorial direction image on demand ──────────────────────────
  const renderOneEditorialDirection = async (outfit, messageIndex, idx) => {
    const key = `${messageIndex}:${idx}`
    setBoardLoadingIndex(key)
    try {
      const res = await fetch('/api/ai/editorial-render-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId: outfit.pieceId || activeContext?.id,
          direction: outfit,
          occasion: outfit.occasion || generateOccasion,
          season: outfit.season || generateSeason,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Render failed')
      setBoardResults(prev => ({ ...prev, [key]: [data] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [key]: [{ error: err.message }] }))
    } finally {
      setBoardLoadingIndex(null)
    }
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
        {(message?.wholeWardrobe || message?.wardrobeEvaluation) && message?.debug?.timings && (
          <div style={{ fontSize: 10, color: 'var(--text-light)', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
            Timing: {timingSummary(message.debug.timings)}
          </div>
        )}
        {outfits.slice(0, message?.wholeWardrobe ? 5 : 4).map((outfit, idx) => {
          const strength = strengthLabel(outfit.strength, idx)
          const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean) : []
          const boardKey = `${messageIndex}:${idx}`
          const isPreview = Boolean(outfit.previewOnly)
          const isTextOnly = Boolean(outfit.textOnly || message?.textOnly || message?.wholeWardrobe)
          const hasRendered = Boolean(boardResults[boardKey]?.length)
          const isRendering = boardLoadingIndex === boardKey
          const isEvaluating = boardLoadingIndex === `evaluate:${boardKey}`

          return (
            <div key={idx} style={{
              padding: '10px 12px',
              background: idx === 0 ? 'var(--surface)' : 'var(--surface-2)',
              borderRadius: 12,
              border: idx === 0 ? '1px solid var(--accent)' : '1px solid var(--border)',
              boxShadow: idx === 0 ? '0 2px 8px rgba(0,0,0,0.04)' : 'none'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{outfit.label || outfit.title || `Direction ${idx + 1}`}</div>
                <div style={{ fontSize: 10, color: idx === 0 ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{strength}</div>
              </div>
              {(outfit.dominantDirection || outfit.silhouette || outfit.bestFor) && (
                <div style={{ display: 'grid', gap: 2, marginTop: 6, fontSize: 13, color: 'var(--text-light)', lineHeight: 1.45 }}>
                  {outfit.dominantDirection && <div><strong>Direction:</strong> {outfit.dominantDirection}</div>}
                  {outfit.silhouette && <div><strong>Silhouette:</strong> {outfit.silhouette}</div>}
                  {outfit.bestFor && <div><strong>Best for:</strong> {outfit.bestFor}</div>}
                </div>
              )}
              {/* Show missingPieces for preview directions */}
              {isPreview && Array.isArray(outfit.missingPieces) && outfit.missingPieces.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 7, lineHeight: 1.45 }}>
                  <strong>Suggested additions:</strong> {outfit.missingPieces.join(' + ')}
                </div>
              )}
              {pieces.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 7, lineHeight: 1.45 }}>
                  <strong>Pieces:</strong> {pieces.join(' + ')}
                </div>
              )}
              {message?.wholeWardrobe && Array.isArray(outfit.pieces) && outfit.pieces.length > 0 && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                  {outfit.pieces.map((piece, pieceIdx) => {
                    const photo = piece?.worn_photo || piece?.photo
                    return (
                      <div key={`${piece?.id || pieceIdx}-${pieceIdx}`} title={piece?.name || 'Garment'} style={{ width: 58, display: 'grid', gap: 4 }}>
                        <div style={{ width: 58, height: 58, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {photo ? (
                            <img src={`/uploads/${photo}`} alt={piece?.name || 'Garment'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontSize: 9, color: 'var(--text-light)', textAlign: 'center', lineHeight: 1.1, padding: 4 }}>{piece?.category || 'piece'}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.15, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{piece?.name || 'Garment'}</div>
                        {message?.wholeWardrobe && (
                          <button
                            type="button"
                            onClick={() => {
                              const key = `whole-wardrobe-piece:${messageIndex}:${idx}:${piece?.id || pieceIdx}:wrong_item_read`
                              toggleStylistFeedback({
                                key,
                                feedbackType: 'wrong_item_read',
                                targetType: 'whole_wardrobe_outfit',
                                label: `Bad piece: ${piece?.name || 'Garment'}`,
                                note: `${piece?.name || 'This piece'} was the bad piece choice in ${outfit.label || `outfit ${idx + 1}`}.`,
                                payload: {
                                  outfit,
                                  messageIndex,
                                  outfitIndex: idx,
                                  pieceId: piece?.id || null,
                                  pieceName: piece?.name || '',
                                  pieceCategory: piece?.category || '',
                                  pieceIds: outfit.pieceIds || [],
                                  pieces: outfit.pieces || [],
                                  formulaFamily: outfit.formulaFamily || '',
                                  archetypeId: outfit.archetypeId || '',
                                  occasion: wardrobeOutfitOccasion,
                                  season: wardrobeOutfitSeason,
                                  mood: wardrobeOutfitMood,
                                },
                                contextOverride: { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                              })
                            }}
                            style={{ fontSize: 9, lineHeight: 1, color: feedbackSaved.has(`whole-wardrobe-piece:${messageIndex}:${idx}:${piece?.id || pieceIdx}:wrong_item_read`) ? 'var(--donate)' : 'var(--text-light)', padding: '3px 4px', borderRadius: 8, border: '1px solid var(--border)', background: feedbackSaved.has(`whole-wardrobe-piece:${messageIndex}:${idx}:${piece?.id || pieceIdx}:wrong_item_read`) ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                            title="Mark this specific garment as the bad piece choice"
                          >
                            {feedbackSaved.has(`whole-wardrobe-piece:${messageIndex}:${idx}:${piece?.id || pieceIdx}:wrong_item_read`) ? '✓ bad' : 'bad piece'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {outfit.reason && <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 7 }}>{outfit.reason}</div>}
              {outfit.watchFor && !/^none$/i.test(String(outfit.watchFor).trim()) && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 5 }}><strong>Watch:</strong> {outfit.watchFor}</div>
              )}

              {message?.wholeWardrobe && (
                <div style={{ marginTop: 9, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    onClick={() => generateWholeWardrobeImage(boardKey, outfit)}
                    disabled={isRendering}
                    style={{ fontSize: 10, color: 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isRendering ? 'default' : 'pointer', opacity: isRendering ? 0.65 : 1 }}
                  >
                    {isRendering ? 'Generating image...' : (hasRendered ? 'Regenerate image' : 'Generate image')}
                  </button>
                  <button
                    onClick={() => evaluateWholeWardrobeOutfit(boardKey, outfit)}
                    disabled={isEvaluating}
                    style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', cursor: isEvaluating ? 'default' : 'pointer', opacity: isEvaluating ? 0.65 : 1 }}
                  >
                    {isEvaluating ? 'Evaluating...' : 'Evaluate outfit'}
                  </button>
                  {imageStatusByKey[boardKey] && <span style={{ fontSize: 10, color: 'var(--text-light)' }}>{imageStatusByKey[boardKey]}</span>}
                  {WHOLE_WARDROBE_FEEDBACK_LABELS.map(([type, label]) => {
                    const key = `whole-wardrobe:${messageIndex}:${idx}:${type}`
                    const isSaved = feedbackSaved.has(key)
                    return (
                      <button
                        key={key}
                        onClick={() => toggleStylistFeedback({
                          key,
                          feedbackType: type,
                          targetType: 'whole_wardrobe_outfit',
                          label: outfit.label || `Outfit ${idx + 1}`,
                          note: [outfit.reason, outfit.watchFor].filter(Boolean).join(' Watch: '),
                          payload: {
                            outfit,
                            messageIndex,
                            outfitIndex: idx,
                            pieceIds: outfit.pieceIds || [],
                            pieces: outfit.pieces || [],
                            formulaFamily: outfit.formulaFamily || '',
                            archetypeId: outfit.archetypeId || '',
                            occasion: wardrobeOutfitOccasion,
                            season: wardrobeOutfitSeason,
                            mood: wardrobeOutfitMood,
                          },
                          contextOverride: { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                        })}
                        style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                      >
                        {isSaved ? '✓ ' : ''}{label}
                      </button>
                    )
                  })}
                </div>
              )}

              {activeContext?.type === 'piece' && !isTextOnly && (
                <div style={{ marginTop: 9, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {isPreview ? (
                    // Preview mode: render this single direction on demand
                    <button
                      onClick={() => renderOneEditorialDirection(outfit, messageIndex, idx)}
                      disabled={isRendering || hasRendered}
                      style={{
                        fontSize: 12, color: hasRendered ? 'var(--donate)' : 'var(--accent)',
                        padding: '3px 9px', borderRadius: 12,
                        border: `1px solid ${hasRendered ? 'var(--donate)' : 'var(--accent)'}`,
                        background: 'var(--surface)',
                        cursor: (isRendering || hasRendered) ? 'default' : 'pointer',
                        opacity: isRendering ? 0.65 : 1,
                      }}
                    >
                      {isRendering ? 'Rendering…' : hasRendered ? '✓ Rendered' : '▧ Generate image (~$0.07)'}
                    </button>
                  ) : (
                    // Wardrobe-board generation button (original mode)
                    <button
                      onClick={() => generateVisualBoards(boardKey, message.text, [outfit], activeContext.id, messageIndex)}
                      disabled={isRendering}
                      style={{
                        fontSize: 12, color: 'var(--accent)', padding: '3px 9px', borderRadius: 12,
                        border: '1px solid var(--accent)', background: 'var(--surface)',
                        cursor: isRendering ? 'default' : 'pointer', opacity: isRendering ? 0.65 : 1,
                      }}
                    >
                      {isRendering ? 'Rendering this outfit…' : (hasRendered ? 'Regenerate this visual' : 'Generate visual for this outfit')}
                    </button>
                  )}
                  {!isPreview && <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Image generation cost: one outfit only.</span>}
                </div>
              )}

              {/* Rendered image for this direction */}
              {hasRendered && (
                <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                  {boardResults[boardKey].map((board, boardIdx) => (
                    <div key={boardIdx} className="generated-visual-card">
                      {board.error ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Render error: {board.error}</div>
                      ) : (
                        <>
                          <button type="button" className="generated-visual-preview-btn" onClick={() => setPreviewImage({ src: board.imageUrl, title: board.label || outfit.label || 'Generated visual', meta: board.reason || outfit.reason || '' })} aria-label="Open generated visual preview">
                            <img src={board.imageUrl} alt={board.label} className="generated-visual-image" />
                          </button>
                          <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label}</div>
                          {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{board.reason}</div>}
                          {board.debug?.timings && (
                            <div style={{ fontSize: 9, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.35 }}>
                              Render timing: {timingSummary(board.debug.timings)}{board.debug.renderer ? ` · renderer: ${board.debug.renderer}` : ''}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
                            {!isPreview && activeContext?.type === 'piece' && (() => {
                              const idealKey = `ideal:${messageIndex}:${idx}:${boardIdx}`
                              const isExploring = boardLoadingIndex === idealKey
                              return (
                                <button
                                  onClick={() => exploreIdealAdditionsFromBoard({ board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx })}
                                  disabled={isExploring}
                                  style={{ fontSize: 10, color: 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isExploring ? 'default' : 'pointer', opacity: isExploring ? 0.65 : 1 }}
                                >
                                  {isExploring ? 'Exploring...' : 'Explore ideal additions'}
                                </button>
                              )
                            })()}
                            {(() => {
                              const saveKey = message?.wholeWardrobe ? `whole-wardrobe-board:${messageIndex}:${idx}:${boardIdx}` : `editorial-board:${messageIndex}:${idx}:${boardIdx}`
                              const isBoardSaved = savedBoardKeys.has(saveKey)
                              return (
                                <button
                                  onClick={() => saveGeneratedBoard({
                                    key: saveKey,
                                    board,
                                    boardType: message?.wholeWardrobe ? 'whole_wardrobe_board' : 'editorial_direction',
                                    messageIndex,
                                    boardIndex: idx,
                                    contextOverride: message?.wholeWardrobe ? { type: 'wardrobe', id: null, name: 'Whole wardrobe' } : null
                                  })}
                                  disabled={isBoardSaved}
                                  style={{ fontSize: 10, color: isBoardSaved ? 'var(--donate)' : 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isBoardSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isBoardSaved ? 'default' : 'pointer' }}
                                >
                                  {isBoardSaved ? '✓ Saved board' : 'Save board'}
                                </button>
                              )
                            })()}
                            {GENERATED_BOARD_FEEDBACK_LABELS.map(([type, label]) => {
                              const key = `editorial-idea-board:${messageIndex}:${idx}:${boardIdx}:${type}`
                              const isSaved = feedbackSaved.has(key)
                              return (
                                <button key={key}
                                  onClick={() => saveStylistFeedback({ key, feedbackType: type, targetType: 'generated_visual_board', label: `${board.label || outfit.title || label}`, note: board.reason || outfit.reason || '', payload: { board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx }, appendToPiece: activeContext?.type === 'piece' && ['signature','works','not_me','too_safe','too_soft','too_generic','wrong_proportions','wrong_silhouette','catalog_drift','weak_structure','weak_contrast','bad_grounding'].includes(type) })}
                                  disabled={isSaved}
                                  style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer' }}
                                >
                                  {isSaved ? '✓ ' : ''}{label}
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
    if (['generated_visual_board', 'board', 'renderer_calibration'].includes(targetType)) return `${targetType}:${payload.messageIndex}:${payload.boardIndex}`
    return null
  }

  const feedbackLearningCopy = (feedbackType) => {
    const copy = {
      signature: 'Learning saved: boosting this as a signature direction.',
      works: 'Learning saved: boosting similar outfit logic.',
      good_formula: 'Learning saved: boosting this formula without overcommitting to every exact piece.',
      good_pieces: 'Learning saved: these pieces look promising together.',
      almost: 'Learning saved: treating this as close but not fully solved.',
      not_me: 'Learning saved: reducing this direction for future suggestions.',
      bad_occasion: 'Learning saved: reducing this formula for this occasion.',
      fit_issue: 'Learning saved: treating this as a fit-risk combination.',
      too_safe: 'Learning saved: reducing safe/over-balanced styling.',
      too_generic: 'Learning saved: reducing generic outfit logic.',
      too_soft: 'Learning saved: reducing excessive softness.',
      wrong_proportions: 'Learning saved: avoiding this proportion behavior.',
      wrong_silhouette: 'Learning saved: avoiding this silhouette behavior.',
      catalog_drift: 'Learning saved: reducing catalog/mature-casual drift.',
      weak_structure: 'Learning saved: requiring stronger structure next time.',
      weak_contrast: 'Learning saved: requiring clearer contrast/tension next time.',
      bad_grounding: 'Learning saved: improving shoe/grounding logic next time.',
      bad_reference: 'Learning saved: using this as a negative reference.',
    }
    return copy[feedbackType] || 'Learning saved.'
  }

  const saveStylistFeedback = async ({ key, feedbackType, targetType = 'message', label = '', note = '', payload = {}, appendToPiece = false, contextOverride = null }) => {
    const context = contextOverride || activeContext || { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
    const res = await fetch('/api/stylist-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackType, targetType, contextType: context.type, contextId: context.id, contextName: context.name, label, note, payload, appendToPiece })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not save feedback')
    setFeedbackSaved(prev => new Set([...prev, key]))
    if (data.id) setFeedbackIdsByKey(prev => ({ ...prev, [key]: data.id }))
    const bucket = feedbackBucketKey(targetType, payload)
    if (bucket) {
      setBoardFeedbackLabels(prev => { const existing = Array.isArray(prev[bucket]) ? prev[bucket] : []; return { ...prev, [bucket]: [...new Set([...existing, feedbackType])] } })
      setBoardLearningStatus(prev => ({ ...prev, [bucket]: data.learningMessage || feedbackLearningCopy(feedbackType) }))
    }
    loadLearningRows()
  }

  const toggleStylistFeedback = async (args) => {
    if (feedbackSaved.has(args.key)) {
      const id = feedbackIdsByKey[args.key]
      if (id) await fetch(`/api/stylist-feedback/${id}`, { method: 'DELETE' })
      setFeedbackSaved(prev => {
        const next = new Set(prev)
        next.delete(args.key)
        return next
      })
      setFeedbackIdsByKey(prev => {
        const next = { ...prev }
        delete next[args.key]
        return next
      })
      await loadLearningRows()
      return
    }
    await saveStylistFeedback(args)
  }

  const saveGeneratedBoard = async ({ key, board, boardType = 'wardrobe', messageIndex = null, boardIndex = null, contextOverride = null }) => {
    const context = contextOverride || activeContext || { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
    if (!board || !board.imageUrl) return
    const feedbackBucket = Number.isInteger(messageIndex) && Number.isInteger(boardIndex)
      ? `${boardType === 'editorial_direction' ? 'generated_visual_board' : 'board'}:${messageIndex}:${boardIndex}` : null
    const existingFeedbackLabels = feedbackBucket && Array.isArray(boardFeedbackLabels[feedbackBucket]) ? boardFeedbackLabels[feedbackBucket] : []
    const res = await fetch('/api/saved-boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardType, contextType: context.type, contextId: context.id, contextName: context.name, title: board.label || board.title || 'Saved board', imageUrl: board.imageUrl, pieces: board.pieces || [], missingPieces: board.missingPieces || [], reason: board.reason || '', watchFor: board.watchFor || '', payload: { board, messageIndex, boardIndex, feedback_labels: existingFeedbackLabels }, feedbackLabels: existingFeedbackLabels })
    })
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Could not save board') }
    setSavedBoardKeys(prev => new Set([...prev, key]))
    onBoardSaved?.()
    if (calibrationLibraryOpen) loadSavedBoardsForCalibration()
  }

  const generateVisualBoards = async (resultKey, conceptText, structuredOverride = null, pieceIdOverride = null, sourceMessageIndex = null) => {
    const pieceId = pieceIdOverride || (activeContext?.type === 'piece' ? activeContext.id : null)
    if (!pieceId) return
    const messageForFallback = Number.isInteger(sourceMessageIndex) ? messages[sourceMessageIndex] : messages[resultKey]
    setBoardLoadingIndex(resultKey)
    try {
      const res = await fetch('/api/ai/generate-outfit-boards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieceId, conceptsText: conceptText, structuredOutfits: structuredOverride || messageForFallback?.structuredOutfits || null, occasion: generateOccasion, season: generateSeason })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate boards')
      setBoardResults(prev => ({ ...prev, [resultKey]: data.boards || [] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: err.message }] }))
    } finally { setBoardLoadingIndex(null) }
  }

  const generateWholeWardrobeImage = async (resultKey, outfit) => {
    const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
      ? outfit.pieceIds
      : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(p => p?.id).filter(Boolean) : [])
    if (!ids.length) return
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(resultKey)
    setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Loading garment reference photos...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Sending the outfit pieces to GPT-4o...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Rendering the outfit image. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Still rendering. Image generation is the slow step.' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outfit, pieceIds: ids, occasion: wardrobeOutfitOccasion, season: wardrobeOutfitSeason })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new /api/ai/generate-wardrobe-outfit-image route is loaded.'
          : `Image route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate outfit image')
      setBoardResults(prev => ({ ...prev, [resultKey]: [data.board || data] }))
    } catch (err) {
      setBoardResults(prev => ({ ...prev, [resultKey]: [{ error: err.message }] }))
    } finally {
      clearImageTimers()
      setImageStatusByKey(prev => {
        const next = { ...prev }
        delete next[resultKey]
        return next
      })
      setBoardLoadingIndex(null)
    }
  }

  const evaluateWholeWardrobeOutfit = async (resultKey, outfit) => {
    const ids = Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length
      ? outfit.pieceIds
      : (Array.isArray(outfit?.pieces) ? outfit.pieces.map(p => p?.id).filter(Boolean) : [])
    if (!ids.length) return
    const loadingKey = `evaluate:${resultKey}`
    const outfitTitle = outfit?.label || outfit?.title || 'this outfit'
    const userText = `Evaluate ${outfitTitle}.`

    setMessages(m => [...m, { role: 'user', text: userText, contextName: 'Whole wardrobe evaluation' }])
    addToHistory('user', userText)
    setBoardLoadingIndex(loadingKey)

    try {
      const res = await fetch('/api/ai/evaluate-wardrobe-outfit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outfit,
          pieceIds: ids,
          occasion: wardrobeOutfitOccasion,
          season: wardrobeOutfitSeason,
          mood: wardrobeOutfitMood,
          question: 'Evaluate this generated whole-wardrobe outfit.'
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Evaluation route returned HTML instead of JSON. Restart the backend/dev server so the new /api/ai/evaluate-wardrobe-outfit route is loaded.'
          : `Evaluation route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not evaluate outfit')
      const replyText = data.feedback || 'Outfit evaluation complete.'
      setMessages(m => [...m, {
        role: 'assistant',
        text: replyText,
        wardrobeEvaluation: true,
        textOnly: true,
        debug: data.debug || null,
      }])
      addToHistory('assistant', replyText)
    } catch (err) {
      const errText = `Error: ${err.message}`
      setMessages(m => [...m, { role: 'assistant', text: errText }])
      addToHistory('assistant', errText)
    } finally {
      setBoardLoadingIndex(null)
    }
  }

  const exploreIdealAdditionsFromBoard = async ({ board, outfit, messageIndex, outfitIndex, boardIndex }) => {
    if (!activeContext || activeContext.type !== 'piece' || !board) return
    const loadingKey = `ideal:${messageIndex}:${outfitIndex}:${boardIndex}`
    const boardTitle = board.label || outfit?.label || outfit?.title || 'this wardrobe look'
    const userText = `Explore ideal additions from ${boardTitle}.`
    const historySnapshot = chatHistory

    setMessages(m => [...m, { role: 'user', text: userText, contextName: `Ideal additions from ${boardTitle}` }])
    addToHistory('user', userText)
    setBoardLoadingIndex(loadingKey)

    try {
      const res = await fetch('/api/ai/editorial-directions-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId: activeContext.id,
          occasion: outfit?.occasion || generateOccasion,
          season: outfit?.season || generateSeason,
          question: `Suggest ideal new additions inspired by this rendered wardrobe look. Use the board as the taste seed, but do not limit the additions to my existing wardrobe.`,
          history: historySnapshot,
          seedLook: { board, outfit }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate ideal additions')

      const replyText = `Here are three ideal-additions directions inspired by ${boardTitle}. Review them and click "Generate image (~$0.07)" on any you want to render.`
      const replyStructuredOutfits = (data.directions || []).map(d => ({
        ...d,
        label: d.title,
        previewOnly: true,
        pieceId: activeContext.id,
        occasion: outfit?.occasion || generateOccasion,
        season: outfit?.season || generateSeason,
        seedBoard: {
          label: board.label || '',
          reason: board.reason || '',
          pieces: board.pieces || [],
        },
      }))

      setMessages(m => [...m, { role: 'assistant', text: replyText, structuredOutfits: replyStructuredOutfits }])
      addToHistory('assistant', replyText)
    } catch (err) {
      const errText = `Error: ${err.message}`
      setMessages(m => [...m, { role: 'assistant', text: errText }])
      addToHistory('assistant', errText)
    } finally {
      setBoardLoadingIndex(null)
    }
  }

  const generateWholeWardrobeOutfits = async () => {
    if (loading) return
    const occasion = wardrobeOutfitOccasion || 'casual'
    const season = wardrobeOutfitSeason || 'current season'
    const mood = wardrobeOutfitMood || 'artistic minimalist'
    const userText = `Generate 5 outfits from my wardrobe for ${occasion}, ${season}${mood ? `, ${mood}` : ''}.`

    setMessages(m => [...m, { role: 'user', text: userText, contextName: 'Whole wardrobe' }])
    addToHistory('user', userText)
    setLoading(true)
    startStatusSequence([
      { ms: 0, text: 'Building outfit candidates from your wardrobe...' },
      { ms: 5000, text: 'Checking the visual mix from garment photos...' },
      { ms: 18000, text: 'Composing the strongest set and applying your feedback...' },
      { ms: 36000, text: 'Still working. The visual critic can take a little while.' },
    ])

    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, season, mood, limit: 5 })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate wardrobe outfits')
      const replyText = data.feedback || 'Here are the strongest wardrobe outfits I found.'
      const replyStructuredOutfits = Array.isArray(data.structuredOutfits)
        ? data.structuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
        : null
      setMessages(m => [...m, {
        role: 'assistant',
        text: replyText,
        structuredOutfits: replyStructuredOutfits,
        wholeWardrobe: true,
        textOnly: true,
        debug: data.debug || null,
      }])
      addToHistory('assistant', replyText)
    } catch (err) {
      const errText = `Error: ${err.message}`
      setMessages(m => [...m, { role: 'assistant', text: errText }])
      addToHistory('assistant', errText)
    } finally {
      clearLoadingTimers()
      setLoadingStatus('')
      setLoading(false)
    }
  }

  const send = async (overrides = {}) => {
    const q = (overrides.input ?? input).trim()
    const outfitToSend = overrides.outfit ?? pendingOutfit
    const pieceToSend = overrides.piece ?? pendingPiece
    const fileToSend = overrides.imageFile ?? imageFile
    if (!q && !fileToSend && !outfitToSend && !pieceToSend) return

    const assistantIndex = messages.length + 1
    const compareId = overrides.compareOutfitId ?? compareOutfitId
    const effectiveGenerateOutfitMode = overrides.generateOutfitMode ?? generateOutfitMode
    const effectiveEditorialVisualMode = overrides.editorialVisualMode ?? editorialVisualMode
    const effectiveIncludeMissingPieces = overrides.includeMissingPieces ?? includeMissingPieces
    const effectiveIdealOnlyMode = overrides.idealOnlyMode ?? idealOnlyMode
    const effectiveGenerateOccasion = overrides.generateOccasion ?? generateOccasion
    const effectiveGenerateSeason = overrides.generateSeason ?? generateSeason
    const editorialRequestPattern = /suggest ideal|ideal addition|ideal new|new pieces|completion|completions|missing-piece|missing piece|not.*wardrobe|beyond my wardrobe|ignore my wardrobe|do not use my wardrobe|don't use my wardrobe|dont use my wardrobe|selected garment only|new item/i
    const typedEditorialRequest = editorialRequestPattern.test(q)
    const shouldGenerateEditorialVisuals = Boolean(pieceToSend && (effectiveEditorialVisualMode || typedEditorialRequest))
    const shouldGenerateOutfits = Boolean(pieceToSend && effectiveGenerateOutfitMode && !shouldGenerateEditorialVisuals)
    const shouldGenerateActiveEditorialVisuals = Boolean(!pieceToSend && activeContext?.type === 'piece' && editorialRequestPattern.test(q))
    const compareOutfit = compareId ? outfits.find(o => String(o.id) === String(compareId)) : null

    let displayPrev = null
    if (outfitToSend?.photo) displayPrev = `/uploads/${outfitToSend.photo}`
    else if (pieceToSend) { const photo = pieceToSend.worn_photo || pieceToSend.photo; if (photo) displayPrev = `/uploads/${photo}` }
    else if (imagePrev) displayPrev = imagePrev

    const userContextName = compareOutfit && outfitToSend ? `${outfitToSend.name} vs ${compareOutfit.name}`
      : shouldGenerateEditorialVisuals ? `Ideal additions preview for ${pieceToSend?.name}`
      : shouldGenerateActiveEditorialVisuals ? `Ideal additions preview for ${activeContext?.name}`
      : shouldGenerateOutfits ? `${effectiveIdealOnlyMode ? 'New ideal ideas for' : effectiveIncludeMissingPieces ? 'Ideal directions for' : 'Generate outfits for'} ${pieceToSend?.name}`
      : (outfitToSend?.name || pieceToSend?.name)

    setMessages(m => [...m, {
      role: 'user', text: q, imagePrev: displayPrev, contextName: userContextName,
      contextMode: compareOutfit && outfitToSend ? getCompareConfidenceText(outfitToSend, compareOutfit) : (outfitToSend ? `${getOutfitConfidenceMode(outfitToSend)?.label} · ${getOutfitConfidenceMode(outfitToSend)?.detail}` : ''),
    }])
    addToHistory('user', q || 'What do you think?')

    setInput(''); setImageFile(null); setImagePrev(null)
    setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId('')
    setGenerateOutfitMode(false); setEditorialVisualMode(false)
    setFileInputKey(k => k + 1)
    setLoading(true)

    const historySnapshot = chatHistory

    try {
      let replyText
      let replyStructuredOutfits = null
      let replyWardrobeEvaluation = false
      let replyDebug = null

      if (outfitToSend && compareId) {
        const res = await fetch('/api/ai/compare-outfits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outfitAId: outfitToSend.id, outfitBId: compareId, question: q || 'Which outfit works better for me?', history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (outfitToSend?.imageGenerationMode) {
        const outfitPieceIds = Array.isArray(outfitToSend.pieces)
          ? outfitToSend.pieces.map(p => p?.id).filter(Boolean)
          : []
        const res = await fetch('/api/ai/generate-saved-outfit-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outfit: {
              id: outfitToSend.id,
              label: outfitToSend.name,
              title: outfitToSend.name,
              photo: outfitToSend.photo || '',
              bestFor: outfitToSend.occasion || '',
              pieces: outfitToSend.pieces || [],
              pieceIds: outfitPieceIds,
              reason: outfitToSend.notes || '',
            },
            pieceIds: outfitPieceIds,
            occasion: outfitToSend.occasion || effectiveGenerateOccasion,
            season: outfitToSend.season || effectiveGenerateSeason,
          })
        })
        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          const text = await res.text()
          throw new Error(text.startsWith('<!DOCTYPE')
            ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new /api/ai/generate-saved-outfit-image route is loaded.'
            : `Image route returned ${contentType || 'non-JSON'} response.`)
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate outfit variants')
        replyText = data.feedback || 'Generated outfit variants from the saved outfit photo and linked garment references.'
        setBoardResults(prev => ({ ...prev, [assistantIndex]: data.boards || [data.board || data] }))

      } else if (outfitToSend) {
        const outfitPieceIds = Array.isArray(outfitToSend.pieces)
          ? outfitToSend.pieces.map(p => p?.id).filter(Boolean)
          : []
        const priorEvaluationText = outfitToSend.threadMemory?.latestEvaluationText || ''
        const shouldAttachOutfitPhoto = outfitToSend.attachVisualContext !== false
        const useWardrobeEvaluator = Boolean(outfitToSend.photo || outfitPieceIds.length >= 2)
        if (useWardrobeEvaluator) {
          const res = await fetch('/api/ai/evaluate-wardrobe-outfit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              outfit: {
                label: outfitToSend.name,
                title: outfitToSend.name,
                photo: shouldAttachOutfitPhoto ? (outfitToSend.photo || '') : '',
                bestFor: outfitToSend.occasion || '',
                pieces: outfitToSend.pieces || [],
                pieceIds: outfitPieceIds,
                reason: outfitToSend.notes || '',
              },
              pieceIds: outfitPieceIds,
              occasion: outfitToSend.occasion || effectiveGenerateOccasion,
              season: outfitToSend.season || effectiveGenerateSeason,
              mood: wardrobeOutfitMood,
              previousEvaluation: priorEvaluationText,
              question: q || 'Evaluate this outfit.'
            })
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Could not evaluate outfit')
          replyText = data.feedback || 'Outfit evaluation complete.'
          replyWardrobeEvaluation = true
          replyDebug = data.debug || null
          setThreadMemory({
            type: 'outfit',
            id: outfitToSend.id,
            name: outfitToSend.name,
            latestEvaluation: data.evaluation || null,
            latestEvaluationText: compactEvaluationMemory(data.evaluation),
          })
        } else {
          const res = await fetch('/api/ai/evaluate-outfit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outfitId: outfitToSend.id, question: q || 'What do you think of this outfit?', history: historySnapshot }) })
          const data = await res.json()
          replyText = data.feedback || data.error || 'Something went wrong.'
        }

      } else if (pieceToSend && shouldGenerateEditorialVisuals) {
        // ── PREVIEW MODE: text directions only, no images yet ────────────────
        const res = await fetch('/api/ai/editorial-directions-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: pieceToSend.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, question: q || 'Suggest ideal new pieces for this selected item.', history: historySnapshot })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate directions')
        replyText = `Here are three styling directions for ${pieceToSend.name}. Review them and click "Generate image (~$0.07)" on any you want to render.`
        replyStructuredOutfits = (data.directions || []).map(d => ({
          ...d,
          label: d.title,
          previewOnly: true,
          pieceId: pieceToSend.id,
          occasion: effectiveGenerateOccasion,
          season: effectiveGenerateSeason,
        }))

      } else if (pieceToSend && shouldGenerateOutfits) {
        const res = await fetch('/api/ai/generate-outfits-for-piece', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceId: pieceToSend.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, question: q || (effectiveIncludeMissingPieces ? 'Generate ideal outfit directions for this piece, using my wardrobe when possible and missing-piece ideas when needed.' : 'Generate outfit ideas for this piece.'), includeMissingPieces: effectiveIncludeMissingPieces, idealOnly: effectiveIdealOnlyMode, history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'
        replyStructuredOutfits = data.structuredOutfits || null

      } else if (pieceToSend) {
        const res = await fetch('/api/ai/evaluate-piece', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceId: pieceToSend.id, question: q || 'How should I style this piece?', history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (shouldGenerateActiveEditorialVisuals) {
        // ── PREVIEW MODE for active context ──────────────────────────────────
        const res = await fetch('/api/ai/editorial-directions-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: activeContext.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, question: q || 'Suggest ideal new pieces for this selected item.', history: historySnapshot })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate directions')
        replyText = `Here are three styling directions for ${activeContext.name}. Review them and click "Generate image (~$0.07)" on any you want to render.`
        replyStructuredOutfits = (data.directions || []).map(d => ({
          ...d,
          label: d.title,
          previewOnly: true,
          pieceId: activeContext.id,
          occasion: effectiveGenerateOccasion,
          season: effectiveGenerateSeason,
        }))

      } else if (fileToSend) {
        const fd = new FormData()
        fd.append('photo', fileToSend)
        fd.append('question', q || 'What do you think of this outfit?')
        const data = await (await fetch('/api/ai/outfit-feedback', { method: 'POST', body: fd })).json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (activeContext?.type === 'outfit') {
        const activeOutfit = outfits.find(o => String(o.id) === String(activeContext.id))
        if (!activeOutfit) throw new Error('Active outfit context was not found. Reopen the outfit and try again.')
        const outfitPieceIds = Array.isArray(activeOutfit.pieces)
          ? activeOutfit.pieces.map(p => p?.id).filter(Boolean)
          : []
        const visualFollowUp = VISUAL_FOLLOWUP_PATTERN.test(q)
        const mustAttachPhoto = visualFollowUp || outfitPieceIds.length < 2
        const memoryText = threadMemory?.type === 'outfit' && String(threadMemory.id) === String(activeOutfit.id)
          ? threadMemory.latestEvaluationText
          : ''
        const res = await fetch('/api/ai/evaluate-wardrobe-outfit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outfit: {
              label: activeOutfit.name,
              title: activeOutfit.name,
              photo: mustAttachPhoto ? (activeOutfit.photo || '') : '',
              bestFor: activeOutfit.occasion || '',
              pieces: activeOutfit.pieces || [],
              pieceIds: outfitPieceIds,
              reason: activeOutfit.notes || '',
            },
            pieceIds: outfitPieceIds,
            occasion: activeOutfit.occasion || effectiveGenerateOccasion,
            season: activeOutfit.season || effectiveGenerateSeason,
            mood: wardrobeOutfitMood,
            previousEvaluation: memoryText,
            responseMode: 'followup',
            question: q || 'Continue evaluating this outfit.'
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not continue outfit evaluation')
        replyText = data.feedback || 'Outfit follow-up complete.'
        replyWardrobeEvaluation = true
        replyDebug = data.debug || null
        setThreadMemory({
          type: 'outfit',
          id: activeOutfit.id,
          name: activeOutfit.name,
          latestEvaluation: data.evaluation || null,
          latestEvaluationText: compactEvaluationMemory(data.evaluation),
        })

      } else {
        const res = await fetch('/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, pieces, history: historySnapshot }) })
        const data = await res.json()
        replyText = data.answer || data.error || 'Something went wrong.'
      }

      setMessages(m => [...m, { role: 'assistant', text: replyText, structuredOutfits: replyStructuredOutfits, wardrobeEvaluation: replyWardrobeEvaluation, textOnly: replyWardrobeEvaluation, debug: replyDebug }])
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
  const pendingPhoto = pendingPiece ? (pendingPiece.worn_photo || pendingPiece.photo) : pendingOutfit?.photo
  const pendingConfidence = pendingOutfit ? getOutfitConfidenceMode(pendingOutfit) : null
  const compareOutfit = compareOutfitId ? outfits.find(o => String(o.id) === String(compareOutfitId)) : null
  const compareConfidenceText = pendingOutfit && compareOutfit ? getCompareConfidenceText(pendingOutfit, compareOutfit) : ''

  const resetChat = () => {
    setMessages([{ role: 'assistant', text: 'Starting fresh! What can I help you with?' }])
    setChatHistory([])
    setThreadMemory(null)
    setActiveContext(null)
    setSavedIndices(new Set()); setFeedbackSaved(new Set()); setFeedbackIdsByKey({}); setSavedBoardKeys(new Set())
    setBoardResults({}); setEditorialVisualResults({})
    setBoardLoadingIndex(null); setLearningOpen(false); setLearningRows([])
    setCalibrationLibraryOpen(false)
    onResetVisuals?.()
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
              {calibrationLibraryOpen ? 'Close calibration' : 'Calibration'}{calibrationImages.length ? ` · ${calibrationImages.length}` : ''}
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

      {/* Calibration Library */}
      {calibrationLibraryOpen && !hasExternalCalibrationLibraryOpen && (
        <div style={{ margin: '0 16px 10px', padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Calibration Library</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Curate visual references. Star means "use strongly"; Archive means "ignore unless you restore it."</div>
            </div>
            <button className="chip" onClick={refreshCalibrationPanel}>Refresh</button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[['active','Active'],['strong','Use strongly'],['good_reference','Good'],['bad_reference','Bad / drift'],['real_photo','Real photos'],['ignored','Ignored']].map(([value, label]) => (
              <button key={value} className="chip" onClick={() => setCalibrationFilter(value)} style={{ fontSize: 11, background: calibrationFilter === value ? 'var(--accent-light)' : undefined, color: calibrationFilter === value ? 'var(--accent)' : undefined, borderColor: calibrationFilter === value ? 'var(--accent)' : undefined }}>{label}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, alignItems: 'start', marginBottom: 12 }}>
            <label style={{ width: 92, height: 116, border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}>
              {calibrationUploadPrev ? <img src={calibrationUploadPrev} alt="Calibration preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>Upload reference</span>}
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
                  <button key={value} type="button" onClick={() => toggleCalibrationLabel(value)} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 12, border: calibrationLabels.includes(value) ? '1px solid var(--accent)' : '1px solid var(--border)', background: calibrationLabels.includes(value) ? 'var(--accent-light)' : 'var(--surface)', color: calibrationLabels.includes(value) ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}>{label}</button>
                ))}
              </div>
              <textarea value={calibrationNotes} onChange={e => setCalibrationNotes(e.target.value)} placeholder="Short note: why this feels right/wrong…" rows={2} style={{ width: '100%', resize: 'vertical', padding: '8px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }} />
              <button className="chip" onClick={saveCalibrationImage} disabled={!calibrationUploadFile || calibrationUploading} style={{ justifySelf: 'start' }}>{calibrationUploading ? 'Saving…' : 'Save calibration image'}</button>
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
                              <button key={value} type="button" onClick={() => toggleCalibrationEditLabel(value)} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 12, border: calibrationEditLabels.includes(value) ? '1px solid var(--accent)' : '1px solid var(--border)', background: calibrationEditLabels.includes(value) ? 'var(--accent-light)' : 'var(--surface)', color: calibrationEditLabels.includes(value) ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }}>{label}</button>
                            ))}
                          </div>
                          <textarea value={calibrationEditNotes} onChange={e => setCalibrationEditNotes(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical', padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 11 }} />
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => saveCalibrationEdit(row.id)}>Save</button>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={cancelEditCalibrationImage}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: row.kind === 'bad_reference' ? '#9b4a3f' : 'var(--accent)' }}>{row.favorite ? '★ ' : ''}{row.kind?.replaceAll('_', ' ')}</div>
                            {row.archived && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>ignored</span>}
                          </div>
                          {!!row.labels?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{row.labels.slice(0, 6).map(label => <span key={label} style={{ fontSize: 9, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px' }}>{label.replaceAll('_', ' ')}</span>)}</div>}
                          {row.notes && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{row.notes}</div>}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => toggleCalibrationFavorite(row)}>{row.favorite ? 'Use normal' : 'Use strongly'}</button>
                            <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => startEditCalibrationImage(row)}>Edit</button>
                            {row.archived ? <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => archiveCalibrationImage(row.id, false)}>Restore</button> : <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => archiveCalibrationImage(row.id, true)}>Ignore</button>}
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
                      {Array.isArray(board.pieces) && board.pieces.length > 0 && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{board.pieces.slice(0, 4).map(p => p?.name).filter(Boolean).join(' + ')}</div>}
                      {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.35 }}>{board.reason}</div>}
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => patchSavedBoard(board, { favorite: !board.favorite })}>{board.favorite ? 'Use normal' : 'Use strongly'}</button>
                        {board.archived ? <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => patchSavedBoard(board, { archived: false })}>Restore</button> : <button className="chip" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => patchSavedBoard(board, { archived: true })}>Ignore</button>}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                        {SAVED_BOARD_FEEDBACK_LABELS.map(([label, text]) => {
                          const active = Array.isArray(board?.payload?.feedback_labels) && board.payload.feedback_labels.includes(label)
                          return <button key={label} className="chip" style={{ fontSize: 9, padding: '2px 6px', borderColor: active ? 'var(--accent)' : 'var(--border)', background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-muted)', fontWeight: active ? 800 : 500, boxShadow: active ? '0 0 0 1px rgba(122,86,43,0.25)' : undefined }} onClick={() => toggleSavedBoardFeedback(board, label)} title="Save this board feedback as calibration memory">{text}</button>
                        })}
                      </div>
                      {Array.isArray(board?.payload?.feedback_labels) && board.payload.feedback_labels.length > 0 && (
                        <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, marginTop: 2 }}>
                          Selected: {board.payload.feedback_labels.map(label => { const found = SAVED_BOARD_FEEDBACK_LABELS.find(([value]) => value === label); return found ? found[1] : label }).join(', ')}
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

      {/* Learning Panel */}
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
                      <div style={{ fontSize: 11, fontWeight: 600, color: row.is_gold ? 'var(--accent)' : 'var(--text)' }}>{row.is_gold ? '★ Gold · ' : ''}{row.feedback_type}{row.label ? ` · ${row.label}` : ''}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.note || 'No note'}</div>
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
      <div style={{ flex: pending ? '0 0 auto' : 1, overflowY: pending ? 'visible' : 'auto', padding: '16px 16px 8px' }}>
        {messages.length === 1 && (
          <div style={{ marginBottom: 16 }}>
            {!pending && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Try asking...</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUGGESTIONS.map(s => <button key={s} onClick={() => setInput(s)} style={{ textAlign: 'left', padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>{s}</button>)}
                </div>
              </>
            )}
            <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text)' }}>Whole wardrobe</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Text-only outfit generation. No image render.</div>
                </div>
                <button
                  onClick={generateWholeWardrobeOutfits}
                  disabled={loading}
                  style={{ fontSize: 12, color: '#fff', padding: '7px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
                >
                  {loading ? 'Generating...' : 'Generate 5 outfits from my wardrobe'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 }}>
                <select value={wardrobeOutfitOccasion} onChange={e => setWardrobeOutfitOccasion(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
                  <option value="casual">Casual</option>
                  <option value="city">City</option>
                  <option value="smart casual">Smart casual</option>
                  <option value="evening">Evening</option>
                  <option value="gallery / art event">Gallery / art event</option>
                  <option value="travel">Travel</option>
                </select>
                <select value={wardrobeOutfitSeason} onChange={e => setWardrobeOutfitSeason(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
                  <option value="current season">Current season</option>
                  <option value="spring">Spring</option>
                  <option value="summer">Summer</option>
                  <option value="fall">Fall</option>
                  <option value="winter">Winter</option>
                </select>
                <input value={wardrobeOutfitMood} onChange={e => setWardrobeOutfitMood(e.target.value)} placeholder="Mood" style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }} />
              </div>
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
                  const isPreviewResponse = hasStructuredIdeas && m.structuredOutfits[0]?.previewOnly
                  return (
                    <div className={`ai-message ${m.role}`} style={{ padding: '12px 14px' }}>
                      {isPreviewResponse ? (
                        <p style={{ margin: '0 0 10px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.45 }}>{m.text}</p>
                      ) : (
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.45 }}>{getCompactOutfitIntro(m, hasBoards)}</p>
                      )}
                      {hasStructuredIdeas ? renderStructuredAdvice(m, i) : (
                        <div style={{ marginTop: 10 }}>
                          {m.text.split('\n').filter(Boolean).map((line, j) => <p key={j} style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 7px', color: 'var(--text)' }}>{line}</p>)}
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

              {m.role === 'assistant' && i > 0 && activeContext && (
                <div style={{ marginTop: 4, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
                    {(!boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text)) && (savedIndices.has(i) ? (
                      <span style={{ fontSize: 11, color: 'var(--donate)', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px' }}>Saved to {activeContext.name}</span>
                    ) : (
                      <button onClick={() => saveMessageToNotes(i, m.text)} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '3px 10px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        Save as styling rule for {activeContext.name}
                      </button>
                    ))}
                    {activeContext.type === 'piece' && !isMultiOutfitResponse(m) && !boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text) && (
                      <button onClick={() => generateVisualBoards(i, m.text, null, null, i)} disabled={boardLoadingIndex === i} style={{ fontSize: 11, color: 'var(--accent)', padding: '3px 10px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 4, cursor: boardLoadingIndex === i ? 'default' : 'pointer', opacity: boardLoadingIndex === i ? 0.65 : 1 }}>
                        {boardLoadingIndex === i ? 'Generating boards...' : (boardResults[i]?.length ? 'Regenerate boards' : 'Generate visual boards')}
                      </button>
                    )}
                    {!isMultiOutfitResponse(m) && !boardResults[i]?.length && !editorialVisualResults[i]?.length && !/Identity-preserving styling edits|visual boards/i.test(m.text) && FEEDBACK_ACTIONS.map(action => {
                      const key = `message:${i}:${action.type}`
                      const isSaved = feedbackSaved.has(key)
                      return (
                        <button key={key} onClick={() => saveStylistFeedback({ key, feedbackType: action.type, targetType: 'message', label: action.label, note: m.text, payload: { messageIndex: i, text: m.text }, appendToPiece: activeContext.type === 'piece' && ['signature','works','not_me','too_soft','proportion_problem','wrong_item_read'].includes(action.type) })} disabled={isSaved} style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)', padding: '3px 8px', borderRadius: 12, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer' }}>
                          {isSaved ? 'saved ' : ''}{action.label}
                        </button>
                      )
                    })}
                  </div>

                  {editorialVisualResults[i]?.length > 0 && (
                    <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                      {editorialVisualResults[i].map((visual, idx) => (
                        <div key={idx} className="generated-visual-card">
                          {visual.error ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Visual error: {visual.error}</div> : (
                            <>
                              <button type="button" className="generated-visual-preview-btn" onClick={() => setPreviewImage({ src: visual.imageUrl, title: visual.label || 'Generated visual', meta: visual.reason || '' })} aria-label="Open generated visual preview">
                                <img src={visual.imageUrl} alt={visual.label} className="generated-visual-image" />
                              </button>
                              <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{visual.label}</div>
                              {Array.isArray(visual.missingPieces) && visual.missingPieces.length > 0 && <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>Suggested additions: {visual.missingPieces.join(' + ')}</div>}
                              {visual.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>{visual.reason}</div>}
                              {visual.watchFor && <div style={{ fontSize: 10, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.4 }}><strong>Watch:</strong> {visual.watchFor}</div>}
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                                {(() => {
                                  const key = `editorial-board:${i}:${idx}`
                                  const isSaved = savedBoardKeys.has(key)
                                  return <button onClick={() => saveGeneratedBoard({ key, board: visual, boardType: 'editorial_direction', messageIndex: i, boardIndex: idx })} disabled={isSaved} style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--accent)', padding: '3px 8px', borderRadius: 12, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer' }}>{isSaved ? 'Saved board' : 'Save board'}</button>
                                })()}
                                {GENERATED_BOARD_FEEDBACK_LABELS.map(([type, label]) => {
                                  const key = `visual-board:${i}:${idx}:${type}`
                                  const isSaved = feedbackSaved.has(key)
                                  return <button key={key} onClick={() => saveStylistFeedback({ key, feedbackType: type, targetType: 'generated_visual_board', label: `${visual.label || 'visual board'} - ${label}`, note: visual.reason || '', payload: { visual, messageIndex: i, boardIndex: idx, feedbackLabel: type }, appendToPiece: activeContext?.type === 'piece' })} disabled={isSaved} style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)', padding: '3px 8px', borderRadius: 12, border: '1px solid var(--border)', background: isSaved ? 'rgba(91,124,76,0.10)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer' }}>{isSaved ? 'saved ' : ''}{label}</button>
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {boardResults[i]?.length > 0 && !isMultiOutfitResponse(m) && (
                    <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                      {boardResults[i].map((board, idx) => (
                        <div key={idx} className="generated-visual-card">
                          {board.error ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Board error: {board.error}</div> : (
                            <>
                              <button type="button" className="generated-visual-preview-btn" onClick={() => setPreviewImage({ src: board.imageUrl, title: board.label || 'Generated board', meta: board.reason || '' })} aria-label="Open generated board preview">
                                <img src={board.imageUrl} alt={board.label} className="generated-visual-image" />
                              </button>
                              <div style={{ fontSize: 13, fontWeight: 650, marginTop: 8, color: 'var(--text)' }}>{board.label}</div>
                              {board.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.45 }}>{board.reason}</div>}
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
                                {(() => {
                                  const saveKey = `wardrobe-board:${i}:${idx}`
                                  const isBoardSaved = savedBoardKeys.has(saveKey)
                                  return <button onClick={() => saveGeneratedBoard({ key: saveKey, board, boardType: 'wardrobe_board', messageIndex: i, boardIndex: idx })} disabled={isBoardSaved} style={{ fontSize: 10, color: isBoardSaved ? 'var(--donate)' : 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isBoardSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isBoardSaved ? 'default' : 'pointer' }}>{isBoardSaved ? 'Saved board' : 'Save board'}</button>
                                })()}
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
                        {getEditorialNotes(m.text).map((note, idx) => <div key={idx} style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>{note}</div>)}
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
              {loadingStatus && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>{loadingStatus}</div>}
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {pending && (
        <div style={{ margin: '0 16px 8px', padding: '10px 14px', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {pendingPhoto && <img src={`/uploads/${pendingPhoto}`} alt={pending.name} style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 6, background: 'var(--surface-2)', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)', marginBottom: 1 }}>{pendingPiece ? 'Piece ready to style' : 'Outfit ready to evaluate'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pending.name}</div>
            {pendingConfidence && <div style={{ marginTop: 6 }}><span style={confidenceBadgeStyle(pendingConfidence.tone)}>{pendingConfidence.label} {pendingConfidence.detail}</span></div>}
            {pendingPiece && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    onClick={() => send({ piece: pendingPiece, input: 'Style this piece using my existing wardrobe.', generateOutfitMode: true, editorialVisualMode: false, includeMissingPieces: false, idealOnlyMode: false })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Style with wardrobe
                  </button>
                  <button
                    onClick={() => send({ piece: pendingPiece, input: 'Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.', generateOutfitMode: false, editorialVisualMode: true, includeMissingPieces: false, idealOnlyMode: true })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Suggest ideal additions
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35 }}>Choose a direct action, or use the message box below for a custom question.</div>
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
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    onClick={() => send({ outfit: pendingOutfit, input: 'Evaluate this outfit. Tell me whether the pieces work together, what feels risky, and what I should change first.', compareOutfitId: '' })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Critique outfit
                  </button>
                  <button
                    onClick={() => send({ outfit: { ...pendingOutfit, imageGenerationMode: true }, input: 'Generate outfit variants from this saved outfit photo and linked garment references.', compareOutfitId: '' })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Generate 3 variants
                  </button>
                </div>
                <select value={compareOutfitId} onChange={e => { setCompareOutfitId(e.target.value); if (e.target.value && (!input.trim() || input === 'What do you think of this outfit?')) setInput('Which outfit works better for me?') }} style={{ width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
                  <option value="">Compare with another outfit...</option>
                  {compareOptions.map(o => <option key={o.id} value={o.id}>Compare with: {o.name}</option>)}
                </select>
                {compareOutfitId && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>{compareConfidenceText || 'Compare mode will use both outfit photos, linked garments, notes, and statuses.'}</div>}
              </div>
            )}
          </div>
          <button onClick={() => { setPendingOutfit(null); setPendingPiece(null); setCompareOutfitId(''); setGenerateOutfitMode(false); setEditorialVisualMode(false); setIdealOnlyMode(false); setInput('') }} style={{ color: 'var(--text-muted)', fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {imagePrev && (
        <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <img src={imagePrev} alt="" style={{ height: 56, width: 56, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }} />
            <button onClick={() => { setImageFile(null); setImagePrev(null) }} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, background: 'var(--text)', color: '#fff', borderRadius: '50%', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Photo attached</span>
        </div>
      )}

      <div style={{ padding: '8px 16px 16px' }}>
        <div className="ai-input-row">
          <label className={`ai-upload-btn ${imagePrev ? 'has-image' : ''}`} title="Attach photo">
            <input key={fileInputKey} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
            📷
          </label>
          <textarea ref={textRef} className="ai-input" placeholder={pending ? `Ask about ${pending.name}...` : 'Ask about your wardrobe...'} value={input} onChange={handleInputChange} onKeyDown={handleKey} rows={1} />
          <button className="ai-send-btn" onClick={send} disabled={loading || (!input.trim() && !imageFile && !pending)}>↑</button>
        </div>
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
