import { useState, useEffect, useRef, useCallback } from 'react'

const SUGGESTIONS = [
  'What should I wear for a city dinner?',
  'Help me style my cream wide-leg pants',
  'What outfit would work for a smart casual event?',
  'I\'m going hiking this weekend — what should I wear?',
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

const calculateOpenAICost = (timings) => {
  if (!timings || !timings.usage) return null
  const input = (timings.usage.input_tokens || 0) * 0.0000025
  const output = (timings.usage.output_tokens || 0) * 0.00001
  const imgSize = timings.imageSize || '1024x1536'
  const imgCost = imgSize === '1024x1024' ? 0.04 : 0.08
  return input + output + imgCost
}

const renderCost = (timings) => {
  const cost = calculateOpenAICost(timings)
  if (cost === null) return ''
  return ` · Measured cost: $${cost.toFixed(3)}`
}

const VISUAL_FOLLOWUP_PATTERN = /\b(look|again|photo|image|visible|read|missed|shoe|shoes|hem|cuff|floor|fit|waist|rise|pull|bunch|color|colour|sleeve|neckline|length|drape|fabric|texture|pattern|lighting|crop|cropped)\b/i
const OUTFIT_FOLLOWUP_PATTERN = /\b(this|it|outfit|idea|look|piece|pieces|make|change|swap|instead|sharper|stronger|softer|better|work|works|risk|risky|why|how|what)\b/i

const currentChatDateContext = () => {
  const now = new Date()
  const timezone = 'America/Los_Angeles'
  return {
    currentDate: now.toISOString(),
    currentDateLabel: new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone,
    }).format(now),
    timezone,
  }
}

const classifyChatTurn = (text, { hasThreadMemory = false } = {}) => {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return 'new_request'
  if (/\b(i disagree|you are wrong|that's wrong|that is wrong|not true|actually|you missed|you ignored|you said|but you|today is|it is|it isn't|it is not|these are|this is)\b/.test(q)) {
    return 'correction'
  }
  if (/^(why|how did|how do you know|what made|which|do you see|can you see|did you see|where|what date|which season|what season)\b/.test(q)) {
    return 'explanation'
  }
  if (/\b(i like|i don't like|i do not like|not me|too safe|too soft|too generic|more like|less like)\b/.test(q)) {
    return 'preference_reaction'
  }
  if (/\b(last|previous|above|earlier|that one|first one|second one|third one|those outfits|these outfits|this outfit|that outfit)\b/.test(q) || hasThreadMemory) {
    return 'followup'
  }
  return 'new_request'
}

const compactThreadContext = (memory = null, activeContext = null) => {
  const parts = []
  if (activeContext?.type && activeContext?.name) {
    parts.push(`Active context: ${activeContext.type} "${activeContext.name}".`)
  }
  if (memory?.type === 'generated_outfits' && memory.latestContextText) {
    parts.push(`Generated outfit cards in this thread:\n${memory.latestContextText}`)
  } else if ((memory?.type === 'outfit' || memory?.type === 'generated_outfit') && memory.latestEvaluationText) {
    parts.push(`Most recent outfit evaluation memory:\n${memory.latestEvaluationText}`)
  }
  return parts.join('\n\n')
}

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



export default function AskClaude({
  initialOutfit,
  initialPiece,
  onClearOutfit,
  onClearPiece,
  activeContext: externalActiveContext,
  onContextChange,
}) {
  const [threads, setThreads] = useState(() => {
    try {
      const saved = localStorage.getItem('stylist_chat_threads')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch (e) {
      console.error('Failed to load stylist_chat_threads from localStorage:', e)
    }
    
    // Migration: Wrap legacy single-thread conversation into a thread
    try {
      const savedMessages = localStorage.getItem('stylist_chat_messages')
      if (savedMessages) {
        const messages = JSON.parse(savedMessages)
        if (Array.isArray(messages) && messages.length > 0) {
          const savedHistory = localStorage.getItem('stylist_chat_history')
          const chatHistory = savedHistory ? JSON.parse(savedHistory) : []
          const savedMemory = localStorage.getItem('stylist_thread_memory')
          const threadMemory = savedMemory ? JSON.parse(savedMemory) : null
          
          let title = 'Active Conversation'
          const firstUser = messages.find(m => m.role === 'user')
          if (firstUser && firstUser.text) {
            title = firstUser.text.slice(0, 30) + (firstUser.text.length > 30 ? '...' : '')
          }
          
          const legacyThread = {
            id: 'legacy_active',
            title,
            messages,
            chatHistory,
            threadMemory,
            updatedAt: Date.now()
          }
          
          localStorage.removeItem('stylist_chat_messages')
          localStorage.removeItem('stylist_chat_history')
          localStorage.removeItem('stylist_thread_memory')
          
          return [legacyThread]
        }
      }
    } catch (e) {
      console.error('Migration to multi-thread failed:', e)
    }

    return [{
      id: 'default',
      title: 'New Chat',
      messages: [{ role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }],
      chatHistory: [],
      threadMemory: null,
      updatedAt: Date.now()
    }]
  })

  const [currentThreadId, setCurrentThreadId] = useState(() => {
    try {
      const saved = localStorage.getItem('stylist_current_thread_id')
      if (saved && threads.some(t => t.id === saved)) return saved
    } catch (e) {}
    return threads[0]?.id || 'default'
  })

  const activeThread = threads.find(t => t.id === currentThreadId) || threads[0]

  const [messages, setMessages] = useState(() => activeThread?.messages || [
    { role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }
  ])
  const [chatHistory, setChatHistory] = useState(() => activeThread?.chatHistory || [])
  const [threadMemory, setThreadMemory] = useState(() => activeThread?.threadMemory || null)
  const [evaluatedKeys, setEvaluatedKeys] = useState(() => new Set(activeThread?.evaluatedKeys || []))
  const [boardResults, setBoardResults] = useState(() => activeThread?.boardResults || {})
  const [editorialVisualResults, setEditorialVisualResults] = useState(() => activeThread?.editorialVisualResults || {})
  const [evaluationResultsByKey, setEvaluationResultsByKey] = useState(() => activeThread?.evaluationResultsByKey || {})
  const [internalActiveContext, setInternalActiveContext] = useState(null)
  const activeContext = externalActiveContext ?? internalActiveContext
  const setActiveContext = useCallback((nextContext) => {
    setInternalActiveContext(nextContext)
    onContextChange?.(nextContext)
  }, [onContextChange])

  const [toastMessage, setToastMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  const triggerToast = useCallback((msg) => {
    setToastMessage(msg)
    setShowToast(true)
  }, [])

  useEffect(() => {
    if (!showToast) return
    const timer = setTimeout(() => {
      setShowToast(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [showToast])
  const lastThreadIdRef = useRef(currentThreadId)

  useEffect(() => {
    if (lastThreadIdRef.current !== currentThreadId) {
      lastThreadIdRef.current = currentThreadId
      return
    }

    setThreads(prev => {
      const nextThreads = prev.map(t => {
        if (t.id === currentThreadId) {
          let title = t.title
          if (!t.userRenamed && (title === 'New Chat' || title === 'Active Conversation' || title.startsWith('Wardrobe:'))) {
            const firstUser = messages.find(m => m.role === 'user')
            if (firstUser && firstUser.text) {
              title = firstUser.text.slice(0, 30) + (firstUser.text.length > 30 ? '...' : '')
            }
          }
          return {
            ...t,
            title,
            messages,
            chatHistory,
            threadMemory,
            activeContext,
            evaluatedKeys: Array.from(evaluatedKeys),
            boardResults,
            editorialVisualResults,
            evaluationResultsByKey,
            updatedAt: Date.now()
          }
        }
        return t
      })
      try {
        localStorage.setItem('stylist_chat_threads', JSON.stringify(nextThreads))
      } catch (e) {
        console.error('Failed to save stylist_chat_threads to localStorage:', e)
      }
      return nextThreads
    })
  }, [messages, chatHistory, threadMemory, activeContext, currentThreadId, evaluatedKeys, boardResults, editorialVisualResults, evaluationResultsByKey])

  const createNewChat = (title = 'New Chat') => {
    const newId = 'thread_' + Date.now()
    const newThread = {
      id: newId,
      title,
      messages: [{ role: 'assistant', text: 'Hi! I\'m your personal stylist. I know your full wardrobe — ask me anything. You can also upload a photo of an outfit for feedback.' }],
      chatHistory: [],
      threadMemory: null,
      activeContext: null,
      evaluatedKeys: [],
      boardResults: {},
      editorialVisualResults: {},
      evaluationResultsByKey: {},
      updatedAt: Date.now()
    }
    
    setThreads(prev => [newThread, ...prev])
    setCurrentThreadId(newId)
    setMessages(newThread.messages)
    setChatHistory(newThread.chatHistory)
    setThreadMemory(newThread.threadMemory)
    setActiveContext(newThread.activeContext)
    setEvaluatedKeys(new Set())
    setBoardResults({})
    setEditorialVisualResults({})
    setEvaluationResultsByKey({})
    
    try {
      localStorage.setItem('stylist_current_thread_id', newId)
    } catch (e) {}
  }

  const switchThread = (threadId) => {
    setThreads(prev => {
      const nextThreads = prev.map(t => {
        if (t.id === currentThreadId) {
          return {
            ...t,
            messages,
            chatHistory,
            threadMemory,
            activeContext,
            evaluatedKeys: Array.from(evaluatedKeys),
            boardResults,
            editorialVisualResults,
            evaluationResultsByKey,
            updatedAt: Date.now()
          }
        }
        return t
      })
      try {
        localStorage.setItem('stylist_chat_threads', JSON.stringify(nextThreads))
      } catch (e) {}
      return nextThreads
    })

    const target = threads.find(t => t.id === threadId)
    if (target) {
      setCurrentThreadId(threadId)
      setMessages(target.messages || [])
      setChatHistory(target.chatHistory || [])
      setThreadMemory(target.threadMemory || null)
      setActiveContext(target.activeContext || null)
      setEvaluatedKeys(new Set(target.evaluatedKeys || []))
      setBoardResults(target.boardResults || {})
      setEditorialVisualResults(target.editorialVisualResults || {})
      setEvaluationResultsByKey(target.evaluationResultsByKey || {})
      try {
        localStorage.setItem('stylist_current_thread_id', threadId)
      } catch (e) {}
    }
  }

  const deleteThread = (threadId) => {
    if (threads.length <= 1) return
    const remaining = threads.filter(t => t.id !== threadId)
    const nextThread = remaining[0]
    
    setThreads(remaining)
    setCurrentThreadId(nextThread.id)
    setMessages(nextThread.messages || [])
    setChatHistory(nextThread.chatHistory || [])
    setThreadMemory(nextThread.threadMemory || null)
    setActiveContext(nextThread.activeContext || null)
    setEvaluatedKeys(new Set(nextThread.evaluatedKeys || []))
    setBoardResults(nextThread.boardResults || {})
    setEditorialVisualResults(nextThread.editorialVisualResults || {})
    setEvaluationResultsByKey(nextThread.evaluationResultsByKey || {})
    
    try {
      localStorage.setItem('stylist_chat_threads', JSON.stringify(remaining))
      localStorage.setItem('stylist_current_thread_id', nextThread.id)
    } catch (e) {}
  }

  const renameThread = (threadId, newTitle) => {
    if (!newTitle.trim()) return
    setThreads(prev => prev.map(t => {
      if (t.id === threadId) {
        return {
          ...t,
          title: newTitle.trim(),
          userRenamed: true,
          updatedAt: Date.now()
        }
      }
      return t
    }))
  }

  const [input, setInput] = useState('')
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [renamingThreadId, setRenamingThreadId] = useState(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [pendingPieceMode, setPendingPieceMode] = useState('wardrobe')
  const [occasionMenuOpen, setOccasionMenuOpen] = useState(false)
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false)
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
  const [wardrobeBuilderOpen, setWardrobeBuilderOpen] = useState(false)
  const [includeMissingPieces, setIncludeMissingPieces] = useState(false)
  const [idealOnlyMode, setIdealOnlyMode] = useState(false)
  const [editorialVisualMode, setEditorialVisualMode] = useState(false)
  const [generateOccasion, setGenerateOccasion] = useState('casual')
  const [generateSeason, setGenerateSeason] = useState('current season')
  const [generateMission, setGenerateMission] = useState('mix')
  const [generateMood, setGenerateMood] = useState('')
  const [missionMenuOpen, setMissionMenuOpen] = useState(false)
  const [wardrobeOutfitOccasion, setWardrobeOutfitOccasion] = useState('casual')
  const [wardrobeOutfitSeason, setWardrobeOutfitSeason] = useState('current season')
  const [wardrobeOutfitMood, setWardrobeOutfitMood] = useState('artistic minimalist')
  const [wardrobeOutfitMission, setWardrobeOutfitMission] = useState('mix')
  const [recentMemoryStatus, setRecentMemoryStatus] = useState('')
  const [recentMemoryResetting, setRecentMemoryResetting] = useState(false)
  const [savedIndices, setSavedIndices] = useState(new Set())
  const [feedbackSaved, setFeedbackSaved] = useState(new Set())
  const [feedbackIdsByKey, setFeedbackIdsByKey] = useState({})
  const [boardFeedbackLabels, setBoardFeedbackLabels] = useState({})
  const [boardLearningStatus, setBoardLearningStatus] = useState({})
  const [savedBoardKeys, setSavedBoardKeys] = useState(new Set())
  const [learningOpen, setLearningOpen] = useState(false)
  const [learningRows, setLearningRows] = useState([])

  const [boardLoadingIndex, setBoardLoadingIndex] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const bottomRef = useRef(null)
  const pendingActionRef = useRef(null)
  const holdActionScrollRef = useRef(false)
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
      const actionKey = `${initialOutfit.id || initialOutfit.name || 'outfit'}:${initialOutfit.imageGenerationMode ? `variants-${initialOutfit.variantMode || 'similar'}` : 'critique'}:${prompt}`
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
    setInput('')
    setImageFile(null); setImagePrev(null)
    onClearPiece?.()
  }, [initialPiece])

  useEffect(() => {
    const openingWithAction = initialPiece || (initialOutfit && initialOutfit.autoSend !== true) || pendingPiece || pendingOutfit
    if (openingWithAction && messages.length <= 1 && !loading) return
    if (holdActionScrollRef.current) {
      if (!loading) holdActionScrollRef.current = false
      return
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, pendingPiece, pendingOutfit, initialPiece, initialOutfit])

  useEffect(() => {
    if (!pendingPiece && !pendingOutfit) return
    const t = setTimeout(() => {
      pendingActionRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' })
    }, 0)
    return () => clearTimeout(t)
  }, [pendingPiece, pendingOutfit])

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
    if (message?.wholeWardrobe) return 'Outfits built from saved wardrobe pieces. Garment photos are shown below; image generation is optional.'
    const text = String(message?.text || '')
    const titleMatch = text.match(/Generated outfit ideas for:\*\*\s*([^\n]+)/i)
    const itemName = titleMatch ? titleMatch[1].replace(/\*/g, '').trim() : activeContext?.name
    if (hasBoards) return `Outfit directions for ${itemName}. Visuals are shown below for selected ideas.`
    return `Outfit ideas for ${itemName}. Saved wardrobe pieces are shown when available; image generation is optional.`
  }

  const hydrateDisplayPiece = (piece = {}) => {
    const saved = piece?.id ? pieces.find(p => Number(p.id) === Number(piece.id)) : null
    return {
      ...piece,
      ...(saved || {}),
      name: piece?.name || saved?.name || 'Garment',
      category: piece?.category || saved?.category || '',
      photo: piece?.photo || saved?.photo || null,
      worn_photo: piece?.worn_photo || saved?.worn_photo || null,
    }
  }

  const compactGeneratedOutfitContext = (outfits = [], meta = {}) => {
    if (!Array.isArray(outfits) || !outfits.length) return ''
    const pipelineNote = meta.source === 'whole_wardrobe'
      ? 'Generation pipeline: whole-wardrobe outfit generation. Candidate ranking includes a visual critic pass over garment-photo contact sheets before the final text composer chooses returned cards.'
      : meta.source === 'selected_piece'
        ? 'Generation pipeline: selected-piece outfit generation. The selector first ranks saved garment records, style notes, tags, feedback, and outfit memory, then runs a compact visual critic pass over the selected garment and shortlisted support-piece photos before the final cards are composed. The card thumbnails reflect the pieces reviewed; unless a rendered outfit image exists, discuss garment photos and card context rather than a full worn outfit image.'
        : ''
    const cardContext = outfits.slice(0, 5).map((outfit, index) => {
      const displayPieces = Array.isArray(outfit?.pieces) ? outfit.pieces : []
      const pieceLines = displayPieces.map(piece => {
        const hydrated = hydrateDisplayPiece(piece)
        const photoStatus = hydrated.photo || hydrated.worn_photo
          ? `, thumbnail available${hydrated.photo ? ' on hanger' : ''}${hydrated.worn_photo ? `${hydrated.photo ? ' and' : ''} worn` : ''}`
          : ''
        return `- ${hydrated.name || 'Garment'}${hydrated.category ? ` (${hydrated.category})` : ''}${hydrated.id ? `, id ${hydrated.id}` : ''}${photoStatus}`
      }).join('\n')

      return [
        `Outfit ${index + 1}: ${outfit.label || outfit.title || `Generated outfit ${index + 1}`}`,
        outfit.strength ? `Strength: ${outfit.strength}` : '',
        outfit.dominantDirection ? `Direction: ${outfit.dominantDirection}` : '',
        outfit.silhouette ? `Silhouette: ${outfit.silhouette}` : '',
        outfit.bestFor ? `Best for: ${outfit.bestFor}` : '',
        pieceLines ? `Pieces:\n${pieceLines}` : '',
        outfit.reason ? `Reason: ${outfit.reason}` : '',
        outfit.watchFor ? `Watch: ${outfit.watchFor}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n\n')
    return [pipelineNote, cardContext].filter(Boolean).join('\n\n')
  }

  // ── Render one editorial direction image on demand ──────────────────────────
  const renderOneEditorialDirection = async (outfit, messageIndex, idx) => {
    const key = `${messageIndex}:${idx}`
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(key)
    setImageStatusByKey(prev => ({ ...prev, [key]: 'Loading garment reference photos...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [key]: 'Sending direction details to GPT-4o...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [key]: 'Rendering outfit image. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [key]: 'Still rendering...' })), 45000),
    ]
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
      clearImageTimers()
      setImageStatusByKey(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      setBoardLoadingIndex(null)
    }
  }

  const renderStructuredAdvice = (message, messageIndex) => {
    const outfits = Array.isArray(message?.structuredOutfits) ? message.structuredOutfits : []
    if (!outfits.length) return null

    const KNOWN_COLORS = {
      black: '#222222',
      charcoal: '#3c3f41',
      grey: '#7a7a7a',
      gray: '#7a7a7a',
      white: '#f9f9fb',
      cream: '#f9f6e5',
      oatmeal: '#e6dfd3',
      tan: '#c5a075',
      brown: '#5a4538',
      cognac: '#8e4c32',
      rust: '#b15a3a',
      navy: '#2b3b4c',
      blue: '#6b8ca6',
      green: '#547257',
      olive: '#5e684a',
      emerald: '#296b4f',
      red: '#a53d38',
      orange: '#d97d43',
      yellow: '#e0b845',
      plum: '#52344a',
      burgundy: '#6b2d35',
      pink: '#e8afb3',
      gold: '#cfab4a',
      silver: '#b3b6b7',
      amber: '#d9a03b',
      mustard: '#c8a23b',
      multi: 'repeating-linear-gradient(45deg, #d8d8d8, #d8d8d8 3px, #f0f0f0 3px, #f0f0f0 6px)',
      stripe: 'repeating-linear-gradient(45deg, #c0c0c0, #c0c0c0 3px, #f8f8f8 3px, #f8f8f8 6px)',
      print: 'repeating-linear-gradient(45deg, #d0d0d0, #d0d0d0 3px, #ebebeb 3px, #ebebeb 6px)',
      floral: 'repeating-linear-gradient(45deg, #e0d0d0, #e0d0d0 3px, #f5f0f0 3px, #f5f0f0 6px)',
    }

    const detectColor = (text, fallback = '#d0d2d4') => {
      if (!text) return fallback
      const lower = text.toLowerCase()
      if (lower.includes('stripe') || lower.includes('stripes') || lower.includes('striped')) return KNOWN_COLORS.stripe
      if (lower.includes('print') || lower.includes('printed')) return KNOWN_COLORS.print
      if (lower.includes('floral') || lower.includes('flower')) return KNOWN_COLORS.floral
      if (lower.includes('multi') || lower.includes('pattern') || lower.includes('patterned')) return KNOWN_COLORS.multi
      
      for (const [colorName, hex] of Object.entries(KNOWN_COLORS)) {
        if (lower.includes(colorName)) return hex
      }
      return fallback
    }

    const detectCategory = (text) => {
      const lower = text.toLowerCase()
      if (lower.includes('pants') || lower.includes('trousers') || lower.includes('jeans') || lower.includes('skirt') || lower.includes('leggings') || lower.includes('shorts') || lower.includes('denim') || lower.includes('pant')) {
        return 'bottom'
      }
      if (lower.includes('boot') || lower.includes('sandal') || lower.includes('mule') || lower.includes('flat') || lower.includes('sneaker') || lower.includes('shoe') || lower.includes('heels') || lower.includes('espadrille') || lower.includes('shoes') || lower.includes('flats') || lower.includes('boots') || lower.includes('sandals')) {
        return 'shoes'
      }
      if (lower.includes('jacket') || lower.includes('coat') || lower.includes('cardigan') || lower.includes('hoodie') || lower.includes('vest') || lower.includes('blazer') || lower.includes('trench') || lower.includes('sweater') || lower.includes('knitwear')) {
        return 'outerwear'
      }
      if (lower.includes('bag') || lower.includes('necklace') || lower.includes('scarf') || lower.includes('belt') || lower.includes('hat') || lower.includes('pendant') || lower.includes('purse') || lower.includes('tote') || lower.includes('wristlet')) {
        return 'accessory'
      }
      if (lower.includes('dress') || lower.includes('jumpsuit') || lower.includes('gown')) {
        return 'dress'
      }
      return 'top'
    }
    const getPreviewPieces = (outfit) => {
      const list = []
      const seenCategories = new Set()

      // Look up target piece from outfit.pieceId first, then fallback to activeContext
      const targetPieceId = outfit.pieceId || (activeContext?.type === 'piece' ? activeContext.id : null)
      const targetPiece = targetPieceId ? pieces.find(p => Number(p.id) === Number(targetPieceId)) : null

      if (targetPiece) {
        const cat = targetPiece.category || 'top'
        list.push({
          id: 'active',
          name: targetPiece.name,
          category: cat,
          color: detectColor(targetPiece.colors?.[0] || targetPiece.name, '#888888'),
          colors: targetPiece.colors || [],
          isAnchor: true
        })
        seenCategories.add(cat)
      } else if (activeContext) {
        const cat = activeContext.category || 'top'
        const fullPiece = pieces.find(p => Number(p.id) === Number(activeContext.id))
        const colors = fullPiece?.colors || activeContext.colors || []
        list.push({
          id: 'active',
          name: activeContext.name,
          category: cat,
          color: detectColor(colors[0] || activeContext.name, '#888888'),
          colors: colors,
          isAnchor: true
        })
        seenCategories.add(cat)
      }

      const rawPieces = Array.isArray(outfit.pieces) ? outfit.pieces : []
      rawPieces.forEach((raw) => {
        const piece = hydrateDisplayPiece(raw)
        if (targetPieceId && Number(piece.id) === Number(targetPieceId)) return
        if (activeContext && Number(piece.id) === Number(activeContext.id)) return
        const cat = piece.category
        if (cat && !seenCategories.has(cat)) {
          list.push({
            id: piece.id,
            name: piece.name,
            category: cat,
            color: detectColor(piece.colors?.[0] || piece.name, '#888888'),
            colors: piece.colors || [],
            isAnchor: false
          })
          seenCategories.add(cat)
        }
      })

      const additions = Array.isArray(outfit.missingPieces) ? outfit.missingPieces : []
      additions.forEach((addition, addIdx) => {
        const cat = detectCategory(addition)
        if (cat && !seenCategories.has(cat)) {
          list.push({
            id: `addition-${addIdx}`,
            name: addition,
            category: cat,
            color: detectColor(addition, '#c8c8c8'),
            colors: [],
            isAnchor: false
          })
          seenCategories.add(cat)
        }
      })
      return list
    }

    const getSwatchStyle = (piece) => {
      const textToSearch = `${piece.name} ${Array.isArray(piece.colors) ? piece.colors.join(' ') : (piece.colors || '')}`.toLowerCase()
      
      const foundColors = []
      for (const colorName of Object.keys(KNOWN_COLORS)) {
        if (['stripe', 'print', 'floral', 'multi'].includes(colorName)) continue
        const regex = new RegExp(`\\b${colorName}\\b`)
        if (regex.test(textToSearch)) {
          foundColors.push(colorName)
        }
      }

      const isStripe = textToSearch.includes('stripe') || textToSearch.includes('striped')
      const isPrint = textToSearch.includes('print') || textToSearch.includes('printed') || textToSearch.includes('pattern') || textToSearch.includes('patterned') || textToSearch.includes('floral') || textToSearch.includes('flower')
      const isKnit = textToSearch.includes('knit') || textToSearch.includes('patchwork') || textToSearch.includes('marled') || textToSearch.includes('mixed') || textToSearch.includes('multi')

      let background = '#d0d2d4'
      let label = ''

      if (isStripe) {
        const c1 = foundColors[0] ? KNOWN_COLORS[foundColors[0]] : '#888888'
        const c2 = foundColors[1] ? KNOWN_COLORS[foundColors[1]] : '#f9f9fb'
        background = `repeating-linear-gradient(45deg, ${c1}, ${c1} 4px, ${c2} 4px, ${c2} 8px)`
        label = foundColors.length ? `${foundColors.join('/')} stripe` : 'stripe'
      } else if (isKnit) {
        const c1 = foundColors[0] ? KNOWN_COLORS[foundColors[0]] : '#888888'
        const c2 = foundColors[1] ? KNOWN_COLORS[foundColors[1]] : '#b3b6b7'
        background = `repeating-linear-gradient(-45deg, ${c1}, ${c1} 3px, ${c2} 3px, ${c2} 6px)`
        label = foundColors.length ? `${foundColors.join('/')} knit` : 'mixed knit'
      } else if (isPrint) {
        const c1 = foundColors[0] ? KNOWN_COLORS[foundColors[0]] : '#888888'
        const c2 = foundColors[1] ? KNOWN_COLORS[foundColors[1]] : '#e6dfd3'
        background = `repeating-linear-gradient(90deg, ${c1}, ${c1} 5px, ${c2} 5px, ${c2} 10px)`
        label = foundColors.length ? `${foundColors.join('/')} print` : 'print'
      } else {
        const colorName = foundColors[0]
        background = colorName ? KNOWN_COLORS[colorName] : (piece.color || '#d0d2d4')
        label = colorName || piece.name.toLowerCase().split(' ')[0] || 'neutral'
      }

      return { background, label }
    }

    const getProportions = (pieces) => {
      const hasOuterwear = pieces.some(p => p.category === 'outerwear')
      const hasDress = pieces.some(p => p.category === 'dress')
      const hasTop = pieces.some(p => p.category === 'top')
      const hasBottom = pieces.some(p => p.category === 'bottom')
      const hasShoes = pieces.some(p => p.category === 'shoes')
      const hasAccessory = pieces.some(p => p.category === 'accessory')

      let weights = {}
      if (hasDress) {
        weights.dress = hasOuterwear ? 55 : 85
        if (hasOuterwear) weights.outerwear = 30
        if (hasTop) weights.top = 5
        weights.bottom = 0
      } else {
        if (hasOuterwear) {
          weights.outerwear = 35
          weights.top = hasTop ? 15 : 0
          weights.bottom = hasBottom ? 35 : 0
        } else {
          weights.top = hasTop ? 40 : 0
          weights.bottom = hasBottom ? 45 : 0
        }
      }
      weights.shoes = hasShoes ? 10 : 0
      weights.accessory = hasAccessory ? 5 : 0

      let totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0)
      if (totalWeight === 0) {
        const count = pieces.length
        return pieces.map(p => ({ ...p, percentage: Math.round(100 / count) }))
      }

      const result = pieces.map(p => {
        const catWeight = weights[p.category] || 0
        const shareCount = pieces.filter(x => x.category === p.category).length || 1
        const weight = catWeight / shareCount
        const percentage = Math.round((weight / totalWeight) * 100)
        return {
          ...p,
          percentage
        }
      })

      const sumPercentage = result.reduce((sum, p) => sum + p.percentage, 0)
      if (sumPercentage !== 100 && result.length > 0) {
        const diff = 100 - sumPercentage
        let maxIdx = 0
        let maxVal = -1
        for (let i = 0; i < result.length; i++) {
          if (result[i].percentage > maxVal) {
            maxVal = result[i].percentage
            maxIdx = i
          }
        }
        result[maxIdx].percentage += diff
      }

      return result.filter(p => p.percentage > 0)
    }

    const renderColorBalanceBar = (outfit) => {
      const pieces = getPreviewPieces(outfit)
      const proportioned = getProportions(pieces)

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginTop: 6,
          marginBottom: 6
        }}>
          <div style={{
            fontSize: 11,
            color: 'var(--text-light)',
            fontWeight: 500,
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Color balance</span>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 8px',
              fontSize: 10,
              color: 'var(--text-muted)'
            }}>
              {proportioned.map((p, pIdx) => {
                const swatch = getSwatchStyle(p)
                return (
                  <span key={pIdx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: swatch.background,
                      border: '1px solid rgba(0,0,0,0.1)',
                      display: 'inline-block'
                    }} />
                    <span>{swatch.label} {p.percentage}%</span>
                  </span>
                )
              })}
            </div>
          </div>
          <div style={{
            width: '100%',
            maxWidth: 240,
            height: 10,
            borderRadius: 5,
            overflow: 'hidden',
            display: 'flex',
            border: '1px solid var(--border-light)',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
            background: 'var(--surface-3)'
          }}>
            {proportioned.map((p, pIdx) => {
              const swatch = getSwatchStyle(p)
              return (
                <div
                  key={pIdx}
                  title={`${swatch.label} (${p.percentage}%)`}
                  style={{
                    width: `${p.percentage}%`,
                    height: '100%',
                    background: swatch.background,
                    transition: 'width 0.3s ease'
                  }}
                />
              )
            })}
          </div>
        </div>
      )
    }

    const strengthLabel = (value, index) => {
      const v = String(value || '').toLowerCase()
      if (v === 'signature' || index === 0) return 'signature'
      if (v === 'strong') return 'strong'
      if (v === 'usable') return 'usable'
      if (v === 'experimental') return 'experimental'
      return 'direction'
    }

    const comparisonKey = `whole-wardrobe-comparison:${messageIndex}`
    const comparisonBoards = boardResults[comparisonKey] || []
    const isGeneratingComparison = boardLoadingIndex === comparisonKey
    const isPreviewSet = Boolean(outfits[0]?.previewOnly)
    const canGenerateComparison = !isPreviewSet && outfits.length >= 2 && outfits.some(outfit => {
      if (Array.isArray(outfit?.pieceIds) && outfit.pieceIds.length >= 2) return true
      return Array.isArray(outfit?.pieces) && outfit.pieces.filter(piece => piece?.id).length >= 2
    })

    // Note: previewOnly is overloaded.
    // 1. On rendered board objects (e.g. whole-wardrobe preview sheets), it means "this IS a preview sheet".
    // 2. On direction cards (e.g. ideal-additions editorial directions), it means "text-only direction, not yet rendered".
    // We explicitly check previewOnly && pieceId to target only the text-only editorial direction cards.
    const isIdealAdditions = outfits.length >= 2 &&
      outfits.some(outfit => outfit.previewOnly && outfit.pieceId)

    return (
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {(message?.wholeWardrobe || message?.wardrobeEvaluation) && message?.debug?.timings && (
          <div style={{ fontSize: 10, color: 'var(--text-light)', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
            Timing: {timingSummary(message.debug.timings)}{renderCost(message.debug.timings)}
          </div>
        )}
        {canGenerateComparison && (
          <div style={{ display: 'grid', gap: 8, padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Rough visual preview</div>
                <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>One quick comparison image for the visible cards. Use individual renders for garment-faithful final images.</div>
              </div>
              <button
                type="button"
                onClick={() => generateWholeWardrobeComparisonSheet(messageIndex, outfits)}
                disabled={isGeneratingComparison}
                style={{ fontSize: 12, color: 'var(--accent)', padding: '5px 11px', borderRadius: 14, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isGeneratingComparison ? 'default' : 'pointer', opacity: isGeneratingComparison ? 0.65 : 1 }}
              >
                {isGeneratingComparison ? 'Generating rough preview...' : (comparisonBoards.length ? 'Regenerate rough preview' : 'Generate rough preview')}
              </button>
            </div>
            {(isGeneratingComparison || comparisonBoards.length > 0) && (
              <div className="generated-visual-grid" style={{ marginTop: 8 }}>
                {isGeneratingComparison && (
                  <div className="generated-visual-card skeleton-pulse" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 20, border: '1px dashed var(--accent)', background: 'var(--surface-2)', borderRadius: 12 }}>
                    <div className="typing-dots" style={{ marginBottom: 12 }}><span /><span /><span /></div>
                    <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textAlign: 'center', lineHeight: 1.45 }}>
                      {imageStatusByKey[comparisonKey] || 'Generating rough preview...'}
                    </div>
                  </div>
                )}
                {comparisonBoards.map((board, boardIdx) => (
                  <div key={boardIdx} className="generated-visual-card">
                    {board.error ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview error: {board.error}</div>
                    ) : (
                      <>
                        <button type="button" className="generated-visual-preview-btn" onClick={() => setPreviewImage({ src: board.imageUrl, title: board.label || 'Comparison sheet', meta: board.reason || '' })} aria-label="Open comparison sheet preview">
                          <img src={board.imageUrl} alt={board.label || 'Comparison sheet'} className="generated-visual-image" />
                        </button>
                        <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label || 'Comparison sheet'}</div>
                        {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{board.reason}</div>}
                        {board.debug?.timings && (
                          <div style={{ fontSize: 9, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.35 }}>
                            Render timing: {timingSummary(board.debug.timings)}{board.debug.renderer ? ` · renderer: ${board.debug.renderer}` : ''}{renderCost(board.debug.timings)}
                          </div>
                        )}
                        {(() => {
                          const saveKey = `whole-wardrobe-preview-sheet:${messageIndex}:${boardIdx}`
                          const isSaved = savedBoardKeys.has(saveKey)
                          return (
                            <button
                              type="button"
                              onClick={() => saveGeneratedBoard({
                                key: saveKey,
                                board,
                                boardType: 'whole_wardrobe_preview_sheet',
                                messageIndex,
                                boardIndex: boardIdx,
                                contextOverride: { type: 'wardrobe', id: null, name: 'Whole wardrobe' }
                              })}
                              disabled={isSaved}
                              style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer', marginTop: 7 }}
                            >
                              {isSaved ? '✓ Saved preview board' : 'Save preview board'}
                            </button>
                          )
                        })()}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {isIdealAdditions && (() => {
          const idealComparisonKey = `ideal-additions-comparison:${messageIndex}`
          const idealComparisonBoards = boardResults[idealComparisonKey] || []
          const isGeneratingIdealComparison = boardLoadingIndex === idealComparisonKey
          return (
            <div style={{ display: 'grid', gap: 8, padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Rough visual preview</div>
                  <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>One quick comparison image for all directions. Use individual renders for garment-faithful final images.</div>
                </div>
                 <button
                  type="button"
                  onClick={() => generateIdealAdditionsComparisonSheet(messageIndex, outfits)}
                  disabled={isGeneratingIdealComparison}
                  style={{ fontSize: 12, color: 'var(--accent)', padding: '5px 11px', borderRadius: 14, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isGeneratingIdealComparison ? 'default' : 'pointer', opacity: isGeneratingIdealComparison ? 0.65 : 1 }}
                >
                  {isGeneratingIdealComparison ? 'Generating rough preview...' : (idealComparisonBoards.length ? 'Regenerate rough preview' : 'Rough preview · all directions (~$0.07)')}
                </button>
              </div>
              {(isGeneratingIdealComparison || idealComparisonBoards.length > 0) && (
                <div className="generated-visual-grid" style={{ marginTop: 8 }}>
                  {isGeneratingIdealComparison && (
                    <div className="generated-visual-card skeleton-pulse" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 20, border: '1px dashed var(--accent)', background: 'var(--surface-2)', borderRadius: 12 }}>
                      <div className="typing-dots" style={{ marginBottom: 12 }}><span /><span /><span /></div>
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textAlign: 'center', lineHeight: 1.45 }}>
                        {imageStatusByKey[idealComparisonKey] || 'Generating rough preview...'}
                      </div>
                    </div>
                  )}
                  {idealComparisonBoards.map((board, boardIdx) => (
                    <div key={boardIdx} className="generated-visual-card">
                      {board.error ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview error: {board.error}</div>
                      ) : (
                        <>
                          <button type="button" className="generated-visual-preview-btn" onClick={() => setPreviewImage({ src: board.imageUrl, title: board.label || 'Comparison sheet', meta: board.reason || '' })} aria-label="Open comparison sheet preview">
                            <img src={board.imageUrl} alt={board.label || 'Comparison sheet'} className="generated-visual-image" />
                          </button>
                          <div style={{ fontSize: 12, fontWeight: 650, marginTop: 7, color: 'var(--text)' }}>{board.label || 'Comparison sheet'}</div>
                          {board.reason && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{board.reason}</div>}
                          {board.debug?.timings && (
                            <div style={{ fontSize: 9, color: 'var(--text-light)', marginTop: 4, lineHeight: 1.35 }}>
                              Render timing: {timingSummary(board.debug.timings)}{board.debug.renderer ? ` · renderer: ${board.debug.renderer}` : ''}{renderCost(board.debug.timings)}
                            </div>
                          )}
                          {(() => {
                            const saveKey = `ideal-additions-preview-sheet:${messageIndex}:${boardIdx}`
                            const isSaved = savedBoardKeys.has(saveKey)
                            return (
                              <button
                                type="button"
                                onClick={() => saveGeneratedBoard({
                                  key: saveKey,
                                  board,
                                  boardType: 'ideal_additions_preview_sheet',
                                  messageIndex,
                                  boardIndex: boardIdx,
                                  contextOverride: (() => {
                                    if (activeContext) return activeContext
                                    const targetPiece = pieces.find(p => Number(p.id) === Number(firstOutfit?.pieceId))
                                    if (targetPiece) {
                                      return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                    }
                                    return null
                                  })()
                                })}
                                disabled={isSaved}
                                style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: isSaved ? 'default' : 'pointer', marginTop: 7 }}
                              >
                                {isSaved ? '✓ Saved preview board' : 'Save preview board'}
                              </button>
                            )
                          })()}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
        {outfits.slice(0, message?.wholeWardrobe ? 5 : 4).map((outfit, idx) => {
          const strength = strengthLabel(outfit.strength, idx)
          const pieces = Array.isArray(outfit.pieces) ? outfit.pieces.map(p => p?.name).filter(Boolean) : []
          const boardKey = `${messageIndex}:${idx}`
          const isPreview = Boolean(outfit.previewOnly)
          const isTextOnly = Boolean(outfit.textOnly || message?.textOnly || message?.wholeWardrobe)
          const hasRendered = Boolean(boardResults[boardKey]?.length)
          const isRendering = boardLoadingIndex === boardKey
          const isEvaluating = boardLoadingIndex === `evaluate:${boardKey}`
          const showSilhouette = isPreview && !isTextOnly

          const outfitTitle = outfit.label || outfit.title || `Direction ${idx + 1}`
          const historicalCritique = messages.find(msg => msg.role === 'assistant' && msg.wardrobeEvaluation && (msg.outfitName === outfitTitle || msg.outfitName === outfit.label || msg.outfitName === outfit.title))?.text
          const critiqueText = evaluationResultsByKey[boardKey] || historicalCritique
          const hasCritique = Boolean(critiqueText)

          return (
            <div key={idx} style={{
              padding: '10px 12px',
              background: idx === 0 ? 'var(--surface)' : 'var(--surface-2)',
              borderRadius: 12,
              border: idx === 0 ? '1px solid var(--accent)' : '1px solid var(--border)',
              boxShadow: idx === 0 ? '0 2px 8px rgba(0,0,0,0.04)' : 'none',
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start'
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{outfit.label || outfit.title || `Direction ${idx + 1}`}</div>
                  <div style={{ fontSize: 10, color: idx === 0 ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{strength}</div>
                </div>
                {showSilhouette && renderColorBalanceBar(outfit)}
              {(outfit.missionLabel || outfit.dominantDirection || outfit.silhouette || outfit.bestFor) && (
                <div style={{ display: 'grid', gap: 2, marginTop: 6, fontSize: 13, color: 'var(--text-light)', lineHeight: 1.45 }}>
                  {outfit.missionLabel && <div><strong>Mission:</strong> {outfit.missionLabel}</div>}
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
              {Array.isArray(outfit.pieces) && outfit.pieces.length > 0 && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                  {outfit.pieces.map((rawPiece, pieceIdx) => {
                    const piece = hydrateDisplayPiece(rawPiece)
                    const photo = piece?.photo || piece?.worn_photo
                    return (
                      <div key={`${piece?.id || pieceIdx}-${pieceIdx}`} title={piece?.name || 'Garment'} style={{ width: 58, display: 'grid', gap: 4 }}>
                        <button
                          type="button"
                          disabled={!photo}
                          onClick={() => photo && setPreviewImage({ src: `/uploads/${photo}`, title: piece?.name || 'Garment', meta: piece?.category || '' })}
                          style={{ width: 58, height: 58, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: photo ? 'zoom-in' : 'default' }}
                          aria-label={photo ? `Open ${piece?.name || 'garment'} preview` : undefined}
                        >
                          {photo ? (
                            <img src={`/uploads/${photo}`} alt={piece?.name || 'Garment'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          ) : (
                            <span style={{ fontSize: 9, color: 'var(--text-light)', textAlign: 'center', lineHeight: 1.1, padding: 4 }}>
                              <span style={{ display: 'block', color: 'var(--accent)', fontWeight: 650 }}>needs photo</span>
                              <span style={{ display: 'block', marginTop: 2 }}>{piece?.category || 'piece'}</span>
                            </span>
                          )}
                        </button>
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
                            title="Tell the engine this garment was the wrong choice for this outfit"
                          >
                            {feedbackSaved.has(`whole-wardrobe-piece:${messageIndex}:${idx}:${piece?.id || pieceIdx}:wrong_item_read`) ? '✓ issue' : 'piece issue'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {outfit.reason && (
                <details style={{ marginTop: 8, border: '1px solid var(--border-light)', borderRadius: 8, background: 'var(--surface-2)', padding: '6px 10px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', userSelect: 'none' }}>
                    🔍 Styling Justification & Watchout
                  </summary>
                  <div style={{ marginTop: 6, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {outfit.reason}
                    </div>
                    {outfit.watchFor && !/^none$/i.test(String(outfit.watchFor).trim()) && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 6 }}>
                        <strong>Watch:</strong> {outfit.watchFor}
                      </div>
                    )}
                  </div>
                </details>
              )}

              {isEvaluating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>
                  <span className="typing-dots"><span /><span /></span>
                  <span>Evaluating this outfit...</span>
                </div>
              )}
              {hasCritique && (
                <details defaultOpen={true} style={{ width: '100%', marginTop: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 650, color: 'var(--accent)', fontSize: 12, userSelect: 'none' }}>
                    🔍 View Outfit Critique
                  </summary>
                  <div style={{ marginTop: 6, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                    {critiqueText.split('\n').filter(Boolean).map((line, j) => (
                      <p key={j} style={{ fontSize: 13, lineHeight: 1.45, margin: '0 0 6px', color: 'var(--text)' }}>{line}</p>
                    ))}
                  </div>
                </details>
              )}

              {message?.wholeWardrobe && (
                <>
                  <div style={{ marginTop: 9, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      onClick={() => generateWholeWardrobeImage(boardKey, outfit)}
                      disabled={isRendering}
                      style={{ fontSize: 10, color: 'var(--accent)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--accent)', background: 'var(--surface)', cursor: isRendering ? 'default' : 'pointer', opacity: isRendering ? 0.65 : 1 }}
                    >
                      {isRendering ? 'Generating image...' : (hasRendered ? 'Regenerate outfit image' : 'Generate outfit image')}
                    </button>
                    <button
                      onClick={() => evaluateWholeWardrobeOutfit(boardKey, outfit)}
                      disabled={isEvaluating}
                      style={{ fontSize: 10, color: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--donate)' : 'var(--text-muted)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--surface-2)' : 'var(--surface)', cursor: isEvaluating ? 'default' : 'pointer' }}
                    >
                      {isEvaluating ? 'Evaluating...' : ((evaluatedKeys.has(boardKey) || hasCritique) ? '✓ Evaluated' : 'Evaluate outfit')}
                    </button>
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
                              ...(message?.source === 'visual_composer' ? { source: 'visual_composer' } : {})
                            },
                            appendToPiece: activeContext?.type === 'piece'
                          })}
                          disabled={isSaved}
                          style={{ fontSize: 10, color: isSaved ? 'var(--donate)' : 'var(--text-muted)', padding: '2px 7px', borderRadius: 10, border: '1px solid var(--border)', background: isSaved ? 'var(--surface-2)' : 'var(--surface)', cursor: 'pointer' }}
                        >
                          {isSaved ? '✓ ' : ''}{label}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {(activeContext?.type === 'piece' || outfit.pieceId) && !isTextOnly && (
                <>
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
                        {isRendering ? 'Rendering…' : hasRendered ? '✓ Rendered' : 'Generate outfit image (~$0.07)'}
                      </button>
                    ) : (
                      // Wardrobe-board generation button (original mode)
                      <>
                        <button
                          onClick={() => generateWholeWardrobeImage(boardKey, outfit, { occasion: generateOccasion, season: generateSeason })}
                          disabled={isRendering}
                          style={{
                            fontSize: 12, color: 'var(--accent)', padding: '3px 9px', borderRadius: 12,
                            border: '1px solid var(--accent)', background: 'var(--surface)',
                            cursor: isRendering ? 'default' : 'pointer', opacity: isRendering ? 0.65 : 1,
                          }}
                        >
                          {isRendering ? 'Rendering this outfit…' : (hasRendered ? 'Regenerate outfit image' : 'Generate outfit image')}
                        </button>
                        <button
                          onClick={() => evaluateWholeWardrobeOutfit(boardKey, outfit)}
                          disabled={isEvaluating}
                          style={{
                            fontSize: 12, color: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--donate)' : 'var(--text-muted)', padding: '3px 9px', borderRadius: 12,
                            border: '1px solid var(--border)', background: (evaluatedKeys.has(boardKey) || hasCritique) ? 'var(--surface-2)' : 'var(--surface)',
                            cursor: isEvaluating ? 'default' : 'pointer', opacity: isEvaluating ? 0.65 : 1,
                          }}
                        >
                          {isEvaluating ? 'Evaluating...' : ((evaluatedKeys.has(boardKey) || hasCritique) ? '✓ Evaluated' : 'Evaluate outfit')}
                        </button>
                      </>
                    )}
                    {!isPreview && <span style={{ fontSize: 12, color: 'var(--text-light)' }}>Image generation cost: one outfit only.</span>}
                  </div>
                  {isEvaluating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>
                      <span className="typing-dots"><span /><span /></span>
                      <span>Evaluating this outfit...</span>
                    </div>
                  )}
                  {hasCritique && (
                    <details defaultOpen={true} style={{ width: '100%', marginTop: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 650, color: 'var(--accent)', fontSize: 12, userSelect: 'none' }}>
                        🔍 View Outfit Critique
                      </summary>
                      <div style={{ marginTop: 6, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                        {critiqueText.split('\n').filter(Boolean).map((line, j) => (
                          <p key={j} style={{ fontSize: 13, lineHeight: 1.45, margin: '0 0 6px', color: 'var(--text)' }}>{line}</p>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}

              {/* Rendered image for this direction */}
              {(isRendering || hasRendered) && (
                <div className="generated-visual-grid" style={{ marginTop: 10 }}>
                  {isRendering && (
                    <div className="generated-visual-card skeleton-pulse" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 20, border: '1px dashed var(--accent)', background: 'var(--surface-2)', borderRadius: 12 }}>
                      <div className="typing-dots" style={{ marginBottom: 12 }}><span /><span /><span /></div>
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, textAlign: 'center', lineHeight: 1.4 }}>
                        {imageStatusByKey[boardKey] || 'Rendering outfit image...'}
                      </div>
                    </div>
                  )}
                  {hasRendered && boardResults[boardKey].map((board, boardIdx) => (
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
                              Render timing: {timingSummary(board.debug.timings)}{board.debug.renderer ? ` · renderer: ${board.debug.renderer}` : ''}{renderCost(board.debug.timings)}
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
                                    contextOverride: message?.wholeWardrobe 
                                      ? { type: 'wardrobe', id: null, name: 'Whole wardrobe' } 
                                      : (() => {
                                          if (activeContext) return activeContext
                                          const targetPiece = pieces.find(p => Number(p.id) === Number(outfit.pieceId))
                                          if (targetPiece) {
                                            return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                          }
                                          return null
                                        })()
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
                                  onClick={() => saveStylistFeedback({
                                    key,
                                    feedbackType: type,
                                    targetType: 'generated_visual_board',
                                    label: `${board.label || outfit.title || label}`,
                                    note: board.reason || outfit.reason || '',
                                    payload: { board, outfit, messageIndex, outfitIndex: idx, boardIndex: boardIdx },
                                    appendToPiece: (activeContext?.type === 'piece' || outfit.pieceId) && ['signature','works','not_me','too_safe','too_soft','too_generic','wrong_proportions','wrong_silhouette','catalog_drift','weak_structure','weak_contrast','bad_grounding'].includes(type),
                                    contextOverride: (() => {
                                      if (activeContext) return activeContext
                                      const targetPiece = pieces.find(p => Number(p.id) === Number(outfit.pieceId))
                                      if (targetPiece) {
                                        return { type: 'piece', id: targetPiece.id, name: targetPiece.name }
                                      }
                                      return null
                                    })()
                                  })}
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
      too_boho: 'Learning saved: reducing costume/festival stereotype drift, not bohemian or folk-artisan style itself.',
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

  const generateWholeWardrobeImage = async (resultKey, outfit, options = {}) => {
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
        body: JSON.stringify({
          outfit,
          pieceIds: ids,
          occasion: options.occasion || wardrobeOutfitOccasion,
          season: options.season || wardrobeOutfitSeason
        })
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

  const generateWholeWardrobeComparisonSheet = async (messageIndex, outfits = []) => {
    const visibleOutfits = outfits.slice(0, 5)
    if (visibleOutfits.length < 2) return
    const resultKey = `whole-wardrobe-comparison:${messageIndex}`
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(resultKey)
    setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Loading garment reference photos...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Sending visible outfit cards to GPT-4o...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Rendering one rough comparison image. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Still rendering the preview sheet...' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfit-comparison-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outfits: visibleOutfits,
          occasion: activeContext?.type === 'piece' ? generateOccasion : wardrobeOutfitOccasion,
          season: activeContext?.type === 'piece' ? generateSeason : wardrobeOutfitSeason
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new comparison sheet route is loaded.'
          : `Image route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate comparison sheet')
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

  const generateIdealAdditionsComparisonSheet = async (messageIndex, outfits = []) => {
    if (outfits.length < 2) return
    const firstOutfit = outfits[0]
    const pieceId = firstOutfit?.pieceId || activeContext?.id
    if (!pieceId) return
    const resultKey = `ideal-additions-comparison:${messageIndex}`
    let statusTimers = []
    const clearImageTimers = () => {
      statusTimers.forEach(clearTimeout)
      statusTimers = []
    }
    setBoardLoadingIndex(resultKey)
    setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Loading garment reference photo...' }))
    statusTimers = [
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Sending directions to GPT-4o...' })), 4000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Rendering rough preview sheet. This can take a minute.' })), 14000),
      setTimeout(() => setImageStatusByKey(prev => ({ ...prev, [resultKey]: 'Still rendering preview sheet...' })), 45000),
    ]
    try {
      const res = await fetch('/api/ai/generate-ideal-additions-preview-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pieceId,
          directions: outfits.map(d => ({
            label: d.label || d.title || 'Ideal direction',
            additions: d.missingPieces || [],
            reason: d.reason || ''
          })),
          occasion: firstOutfit?.occasion || generateOccasion,
          season: firstOutfit?.season || generateSeason
        })
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        const text = await res.text()
        throw new Error(text.startsWith('<!DOCTYPE')
          ? 'Image route returned HTML instead of JSON. Restart the backend/dev server so the new route is loaded.'
          : `Image route returned ${contentType || 'non-JSON'} response.`)
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate comparison sheet')
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
      setEvaluationResultsByKey(prev => ({ ...prev, [resultKey]: replyText }))
      const evaluatedOutfit = { ...outfit, label: outfitTitle, title: outfitTitle, pieceIds: ids }
      setThreadMemory({
        type: 'generated_outfit',
        source: outfit?.wholeWardrobe ? 'whole_wardrobe' : 'selected_piece',
        name: outfitTitle,
        latestOutfit: evaluatedOutfit,
        latestEvaluation: data.evaluation || null,
        latestEvaluationText: compactEvaluationMemory(data.evaluation),
        latestContextText: compactGeneratedOutfitContext([evaluatedOutfit], { source: outfit?.wholeWardrobe ? 'whole_wardrobe' : 'selected_piece' }),
      })
      setEvaluatedKeys(prev => {
        const next = new Set(prev)
        next.add(resultKey)
        return next
      })
    } catch (err) {
      const errText = `Error: ${err.message}`
      setEvaluationResultsByKey(prev => ({ ...prev, [resultKey]: errText }))
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
          mission: generateMission,
          mood: generateMood,
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

      setMessages(m => [...m, { role: 'assistant', text: replyText, structuredOutfits: replyStructuredOutfits, mode: 'ideal_styling_directions' }])
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
    const mission = wardrobeOutfitMission || 'mix'
    const userText = `Use my wardrobe to create outfits for ${occasion}, ${season}${mood ? `, ${mood}` : ''}${mission !== 'mix' ? `, mission: ${mission}` : ''}.`

    // Automatically spin up a dedicated thread for this wardrobe generation
    const newId = 'thread_' + Date.now()
    const title = `Wardrobe: ${occasion}, ${season}`
    const newThread = {
      id: newId,
      title,
      messages: [
        { role: 'user', text: userText, contextName: 'Use my wardrobe' }
      ],
      chatHistory: [
        { role: 'user', content: userText }
      ],
      threadMemory: null,
      activeContext: null,
      updatedAt: Date.now()
    }

    setThreads(prev => [newThread, ...prev])
    setCurrentThreadId(newId)
    setMessages(newThread.messages)
    setChatHistory(newThread.chatHistory)
    setThreadMemory(null)
    setActiveContext(null)

    try {
      localStorage.setItem('stylist_current_thread_id', newId)
    } catch (e) {}

    setRecentMemoryStatus('')
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
        body: JSON.stringify({ occasion, season, mood, mission, limit: 5 })
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
        queryOptions: { occasion, season, mood, mission },
      }])
      setThreadMemory({
        type: 'generated_outfits',
        source: 'whole_wardrobe',
        name: 'Whole wardrobe generated outfits',
        latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source: 'whole_wardrobe' }),
        latestOutfits: replyStructuredOutfits,
      })
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

  const generateWholeWardrobeOutfitsVisual = async () => {
    if (loading) return
    const occasion = wardrobeOutfitOccasion || 'casual'
    const season = wardrobeOutfitSeason || 'current season'
    const mood = wardrobeOutfitMood || ''
    const userText = `Use my wardrobe to compose outfits (visual composer) for ${occasion}, ${season}${mood ? `, ${mood}` : ''}.`

    // Automatically spin up a dedicated thread for this wardrobe generation
    const newId = 'thread_' + Date.now()
    const title = `Visual: ${occasion}, ${season}`
    const newThread = {
      id: newId,
      title,
      messages: [
        { role: 'user', text: userText, contextName: 'Visual composer' }
      ],
      chatHistory: [
        { role: 'user', content: userText }
      ],
      threadMemory: null,
      activeContext: null,
      updatedAt: Date.now()
    }

    setThreads(prev => [newThread, ...prev])
    setCurrentThreadId(newId)
    setMessages(newThread.messages)
    setChatHistory(newThread.chatHistory)
    setThreadMemory(null)
    setActiveContext(null)

    try {
      localStorage.setItem('stylist_current_thread_id', newId)
    } catch (e) {}

    setRecentMemoryStatus('')
    setLoading(true)
    startStatusSequence([
      { ms: 0, text: 'Preparing wardrobe photos…' },
      { ms: 6000, text: 'The stylist is looking at your full wardrobe…' },
      { ms: 22000, text: 'Composing outfits…' },
      { ms: 40000, text: 'Still working. Sending many images takes a moment.' },
    ])

    try {
      const res = await fetch('/api/ai/generate-wardrobe-outfits-visual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occasion, season, mood, limit: 5 })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not generate wardrobe outfits')
      const replyText = data.feedback || 'Here are the outfits composed from your wardrobe.'
      const replyStructuredOutfits = Array.isArray(data.structuredOutfits)
        ? data.structuredOutfits.map(outfit => ({ ...outfit, textOnly: true, wholeWardrobe: true }))
        : null
      setMessages(m => [...m, {
        role: 'assistant',
        text: replyText,
        structuredOutfits: replyStructuredOutfits,
        wholeWardrobe: true,
        source: 'visual_composer',
        textOnly: true,
        debug: data.debug || null,
        queryOptions: { occasion, season, mood },
      }])
      setThreadMemory({
        type: 'generated_outfits',
        source: 'whole_wardrobe',
        name: 'Whole wardrobe generated outfits',
        latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source: 'whole_wardrobe' }),
        latestOutfits: replyStructuredOutfits,
      })
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

  const resetWholeWardrobeSessionMemory = async () => {
    if (recentMemoryResetting) return
    setRecentMemoryResetting(true)
    setRecentMemoryStatus('')

    try {
      const res = await fetch('/api/ai/whole-wardrobe-session-memory', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not reset recent outfit memory')
      const clearedCount = Number(data.clearedCount || 0)
      setRecentMemoryStatus(clearedCount
        ? `Cleared ${clearedCount} recent result ${clearedCount === 1 ? 'set' : 'sets'}.`
        : 'Recent outfit memory is already clear.')
    } catch (err) {
      setRecentMemoryStatus(`Reset failed: ${err.message}`)
    } finally {
      setRecentMemoryResetting(false)
    }
  }

  const send = async (overrides = {}) => {
    const q = (overrides.input ?? input).trim()
    const outfitToSend = overrides.outfit ?? pendingOutfit
    const pieceToSend = overrides.piece ?? pendingPiece
    const fileToSend = overrides.imageFile ?? imageFile
    if (!q && !fileToSend) return
    if ((overrides.piece || overrides.outfit) && (pendingPiece || pendingOutfit)) {
      holdActionScrollRef.current = true
    }

    const assistantIndex = messages.length + 1
    const compareId = overrides.compareOutfitId ?? compareOutfitId
    const effectiveGenerateOutfitMode = overrides.generateOutfitMode ?? generateOutfitMode
    const effectiveEditorialVisualMode = overrides.editorialVisualMode ?? editorialVisualMode
    const effectiveIncludeMissingPieces = overrides.includeMissingPieces ?? includeMissingPieces
    const effectiveIdealOnlyMode = overrides.idealOnlyMode ?? idealOnlyMode
    const effectiveGenerateOccasion = overrides.generateOccasion ?? generateOccasion
    const effectiveGenerateSeason = overrides.generateSeason ?? generateSeason
    const effectiveGenerateMission = overrides.generateMission ?? generateMission
    const effectiveGenerateMood = overrides.generateMood ?? generateMood
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
      : shouldGenerateOutfits ? `${effectiveIdealOnlyMode ? 'New ideal ideas for' : effectiveIncludeMissingPieces ? 'Ideal directions for' : 'Use my wardrobe with'} ${pieceToSend?.name}`
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
      let replyOutfitName = null
      let replyDebug = null
      let replyMode = null

      if (outfitToSend && compareId) {
        const res = await fetch('/api/ai/compare-outfits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outfitAId: outfitToSend.id, outfitBId: compareId, question: q || 'Which outfit works better for me?', history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (outfitToSend?.imageGenerationMode) {
        const savedOutfitVariantMode = outfitToSend.variantMode === 'creative' ? 'creative' : 'similar'
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
            variantMode: savedOutfitVariantMode,
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
        replyText = data.feedback || (savedOutfitVariantMode === 'creative'
          ? 'Generated creative outfit alternatives from the saved outfit photo and linked garment references.'
          : 'Generated similar outfit variants from the saved outfit photo and linked garment references.')
        setBoardResults(prev => ({ ...prev, [assistantIndex]: data.boards || [data.board || data] }))

      } else if (outfitToSend) {
        const outfitPieceIds = Array.isArray(outfitToSend.pieces)
          ? outfitToSend.pieces.map(p => p?.id).filter(Boolean)
          : []
        const priorEvaluationText = outfitToSend.threadMemory?.latestEvaluationText || ''
        const shouldAttachOutfitPhoto = outfitToSend.attachVisualContext !== false
        const res = await fetch('/api/ai/evaluate-wardrobe-outfit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outfit: {
              id: outfitToSend.id,
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
        replyOutfitName = outfitToSend.name
        replyDebug = data.debug || null
        setThreadMemory({
          type: 'outfit',
          id: outfitToSend.id,
          name: outfitToSend.name,
          latestEvaluation: data.evaluation || null,
          latestEvaluationText: compactEvaluationMemory(data.evaluation),
        })

      } else if (pieceToSend && shouldGenerateEditorialVisuals) {
        // ── PREVIEW MODE: text directions only, no images yet ────────────────
        const res = await fetch('/api/ai/editorial-directions-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: pieceToSend.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, mission: effectiveGenerateMission, mood: effectiveGenerateMood, question: q || 'Suggest ideal new pieces for this selected item.', history: historySnapshot })
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
        replyMode = 'ideal_styling_directions'

      } else if (pieceToSend && shouldGenerateOutfits) {
        const res = await fetch('/api/ai/generate-outfits-for-piece', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceId: pieceToSend.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, mission: effectiveGenerateMission, mood: effectiveGenerateMood, question: q || (effectiveIncludeMissingPieces ? 'Generate ideal outfit directions for this piece, using my wardrobe when possible and missing-piece ideas when needed.' : 'Generate outfit ideas for this piece.'), includeMissingPieces: effectiveIncludeMissingPieces, idealOnly: effectiveIdealOnlyMode, history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'
        replyStructuredOutfits = data.structuredOutfits || null
        if (Array.isArray(replyStructuredOutfits) && replyStructuredOutfits.length) {
          setThreadMemory({
            type: 'generated_outfits',
            source: 'selected_piece',
            id: pieceToSend.id,
            name: pieceToSend.name,
            latestContextText: compactGeneratedOutfitContext(replyStructuredOutfits, { source: 'selected_piece' }),
            latestOutfits: replyStructuredOutfits,
          })
        }

      } else if (pieceToSend) {
        const res = await fetch('/api/ai/evaluate-piece', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceId: pieceToSend.id, question: q || 'How should I style this piece?', history: historySnapshot }) })
        const data = await res.json()
        replyText = data.feedback || data.error || 'Something went wrong.'

      } else if (shouldGenerateActiveEditorialVisuals) {
        // ── PREVIEW MODE for active context ──────────────────────────────────
        const res = await fetch('/api/ai/editorial-directions-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pieceId: activeContext.id, occasion: effectiveGenerateOccasion, season: effectiveGenerateSeason, mission: effectiveGenerateMission, mood: effectiveGenerateMood, question: q || 'Suggest ideal new pieces for this selected item.', history: historySnapshot })
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
        replyMode = 'ideal_styling_directions'

      } else if (fileToSend) {
        const fd = new FormData()
        fd.append('photo', fileToSend)
        fd.append('question', q || 'What do you think of this outfit?')
        const data = await (await fetch('/api/ai/outfit-feedback', { method: 'POST', body: fd })).json()
        replyText = data.feedback || data.error || 'Something went wrong.'
      } else if (threadMemory?.type === 'generated_outfit' && OUTFIT_FOLLOWUP_PATTERN.test(q)) {
        const rememberedOutfit = threadMemory.latestOutfit || {}
        const outfitPieceIds = Array.isArray(rememberedOutfit.pieceIds) && rememberedOutfit.pieceIds.length
          ? rememberedOutfit.pieceIds
          : (Array.isArray(rememberedOutfit.pieces) ? rememberedOutfit.pieces.map(p => p?.id).filter(Boolean) : [])
        if (!outfitPieceIds.length) {
          throw new Error('Generated outfit context is missing linked pieces. Re-evaluate the outfit card and try again.')
        }
        const conversationMode = classifyChatTurn(q, { hasThreadMemory: true })
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q || 'Continue discussing this generated outfit.',
            pieces,
            history: historySnapshot,
            conversationMode,
            threadContext: threadMemory.latestEvaluationText || '',
            outfit: rememberedOutfit,
            pieceIds: outfitPieceIds,
            activeContext,
            ...currentChatDateContext(),
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not continue generated outfit evaluation')
        replyText = data.answer || 'Outfit follow-up complete.'
        replyWardrobeEvaluation = false
        replyDebug = data.debug || null
        if (data.savedCorrections && data.savedCorrections.length > 0) {
          const lastCorrection = data.savedCorrections[data.savedCorrections.length - 1]
          triggerToast(`Saved styling preference: "${lastCorrection.note}"`)
        }
        setThreadMemory({
          ...threadMemory,
          type: 'generated_outfit',
          latestOutfit: rememberedOutfit,
        })

      } else if (activeContext?.type === 'outfit' || (threadMemory?.type === 'outfit' && OUTFIT_FOLLOWUP_PATTERN.test(q))) {
        const activeOutfitId = activeContext?.type === 'outfit' ? activeContext.id : threadMemory.id
        const activeOutfit = outfits.find(o => String(o.id) === String(activeOutfitId))
        if (!activeOutfit) throw new Error('Active outfit context was not found. Reopen the outfit and try again.')
        const outfitPieceIds = Array.isArray(activeOutfit.pieces)
          ? activeOutfit.pieces.map(p => p?.id).filter(Boolean)
          : []
        const memoryText = threadMemory?.type === 'outfit' && String(threadMemory.id) === String(activeOutfit.id)
          ? threadMemory.latestEvaluationText
          : ''
        const conversationMode = classifyChatTurn(q, { hasThreadMemory: true })
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q || 'Continue evaluating this outfit.',
            pieces,
            history: historySnapshot,
            conversationMode,
            threadContext: memoryText,
            outfit: {
              label: activeOutfit.name,
              title: activeOutfit.name,
              photo: activeOutfit.photo || '',
              bestFor: activeOutfit.occasion || '',
              pieces: activeOutfit.pieces || [],
              pieceIds: outfitPieceIds,
              reason: activeOutfit.notes || '',
            },
            pieceIds: outfitPieceIds,
            activeContext,
            ...currentChatDateContext(),
          })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not continue outfit evaluation')
        replyText = data.answer || 'Outfit follow-up complete.'
        replyWardrobeEvaluation = false
        replyDebug = data.debug || null
        if (data.savedCorrections && data.savedCorrections.length > 0) {
          const lastCorrection = data.savedCorrections[data.savedCorrections.length - 1]
          triggerToast(`Saved styling preference: "${lastCorrection.note}"`)
        }
        setThreadMemory({
          type: 'outfit',
          id: activeOutfit.id,
          name: activeOutfit.name,
          latestEvaluation: threadMemory?.latestEvaluation || null,
          latestEvaluationText: memoryText,
        })

      } else {
        const generatedContext = threadMemory?.type === 'generated_outfits'
          ? threadMemory.latestContextText
          : ''
        const generatedOutfits = threadMemory?.type === 'generated_outfits'
          ? threadMemory.latestOutfits || []
          : []
        const conversationMode = classifyChatTurn(q, { hasThreadMemory: Boolean(threadMemory || activeContext) })
        const threadContext = compactThreadContext(threadMemory, activeContext)
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            pieces,
            history: historySnapshot,
            generatedContext,
            generatedOutfits,
            conversationMode,
            threadContext,
            activeContext,
            ...currentChatDateContext(),
          })
        })
        const data = await res.json()
        replyText = data.answer || data.error || 'Something went wrong.'
        replyDebug = data.debug || null
        if (data.savedCorrections && data.savedCorrections.length > 0) {
          const lastCorrection = data.savedCorrections[data.savedCorrections.length - 1]
          triggerToast(`Saved styling preference: "${lastCorrection.note}"`)
        }
      }
      setMessages(m => [...m, {
        role: 'assistant',
        text: replyText,
        structuredOutfits: replyStructuredOutfits,
        wardrobeEvaluation: replyWardrobeEvaluation,
        textOnly: replyWardrobeEvaluation,
        outfitName: replyOutfitName,
        debug: replyDebug,
        mode: replyMode,
        queryOptions: shouldGenerateOutfits || shouldGenerateEditorialVisuals || shouldGenerateActiveEditorialVisuals ? {
          occasion: effectiveGenerateOccasion,
          season: effectiveGenerateSeason,
          idealOnly: effectiveIdealOnlyMode,
          includeMissingPieces: effectiveIncludeMissingPieces,
          mission: effectiveGenerateMission,
          mood: effectiveGenerateMood,
        } : null
      }])
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
    setSavedIndices(new Set()); setFeedbackSaved(new Set()); setFeedbackIdsByKey({}); setSavedBoardKeys(new Set()); setEvaluatedKeys(new Set())
    setBoardResults({}); setEditorialVisualResults({}); setEvaluationResultsByKey({})
    setBoardLoadingIndex(null); setLearningOpen(false); setLearningRows([])
    
    setThreads(prev => prev.map(t => {
      if (t.id === currentThreadId) {
        return {
          ...t,
          title: 'New Chat',
          messages: [{ role: 'assistant', text: 'Starting fresh! What can I help you with?' }],
          chatHistory: [],
          threadMemory: null,
          activeContext: null,
          evaluatedKeys: [],
          boardResults: {},
          editorialVisualResults: {},
          evaluationResultsByKey: {},
          updatedAt: Date.now()
        }
      }
      return t
    }))
  }

  const latestAssistantIndex = (() => {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      if (messages[idx].role === 'assistant') return idx
    }
    return -1
  })()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Toast Notification */}
      {showToast && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(18, 18, 18, 0.95)',
          backdropFilter: 'blur(8px)',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '24px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          zIndex: 99999,
          fontSize: '14px',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          maxWidth: '90%',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {toastMessage}
        </div>
      )}      {/* Header */}
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
            <button className="chip" style={{ marginTop: 4 }} onClick={() => setWardrobeBuilderOpen(v => !v)}>
              {wardrobeBuilderOpen ? 'Close builder' : 'Use wardrobe'}
            </button>
            {activeContext && (
              <button className="chip" style={{ marginTop: 4 }} onClick={() => setLearningOpen(v => !v)}>
                Learning{learningRows.length ? ` · ${learningRows.length}` : ''}
              </button>
            )}
            <div className="custom-select-container" style={{ marginTop: 4 }}>
              <button 
                className={`custom-select-btn ${threadMenuOpen ? 'active' : ''}`}
                style={{ 
                  height: 30, 
                  minWidth: 140, 
                  borderRadius: 15, 
                  padding: '0 12px', 
                  fontSize: 12, 
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
                onClick={(e) => { e.stopPropagation(); setThreadMenuOpen(!threadMenuOpen); }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                  💬 {threads.find(t => t.id === currentThreadId)?.title || 'Chat'}
                </span>
                <span className="custom-select-arrow">▾</span>
              </button>
              {threadMenuOpen && (
                <>
                  <div className="custom-select-backdrop" onClick={() => setThreadMenuOpen(false)} />
                  <div className="custom-select-dropdown" style={{ minWidth: 200, fontSize: 13, left: 'auto', right: 0 }}>
                    <div style={{ padding: '6px 12px 4px', fontSize: 10, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Recent Conversations
                    </div>
                    {threads.map(t => {
                      const isActive = t.id === currentThreadId;
                      const isRenaming = renamingThreadId === t.id;
                      return (
                        <div
                          key={t.id}
                          className={`custom-select-option ${isActive ? 'active' : ''}`}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                          onClick={() => {
                            if (!isRenaming) {
                              switchThread(t.id);
                              setThreadMenuOpen(false);
                            }
                          }}
                        >
                          {isRenaming ? (
                            <>
                              <input
                                type="text"
                                value={renamingTitle}
                                onChange={(e) => setRenamingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.stopPropagation();
                                    renameThread(t.id, renamingTitle);
                                    setRenamingThreadId(null);
                                  } else if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    setRenamingThreadId(null);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  flex: 1,
                                  fontSize: 12,
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                  color: 'var(--text)',
                                  outline: 'none',
                                }}
                                autoFocus
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  renameThread(t.id, renamingTitle);
                                  setRenamingThreadId(null);
                                }}
                                style={{
                                  color: 'var(--donate)',
                                  fontSize: 12,
                                  padding: '2px 4px',
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                }}
                                title="Save"
                              >
                                ✓
                              </button>
                            </>
                          ) : (
                            <>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {t.title}
                              </span>
                              <div style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingThreadId(t.id);
                                    setRenamingTitle(t.title);
                                  }}
                                  style={{
                                    color: 'var(--text-light)',
                                    fontSize: 12,
                                    padding: '2px 4px',
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                  }}
                                  title="Rename thread"
                                >
                                  ✎
                                </button>
                                {!isActive && threads.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(`Delete thread "${t.title}"?`)) {
                                        deleteThread(t.id);
                                      }
                                    }}
                                    style={{
                                      color: 'var(--text-light)',
                                      fontSize: 14,
                                      padding: '2px 4px',
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                    }}
                                    title="Delete thread"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                    <div className="divider" style={{ margin: '4px 0' }} />
                    <button
                      className="custom-select-option"
                      onClick={() => {
                        createNewChat('New Chat');
                        setThreadMenuOpen(false);
                      }}
                      style={{ color: 'var(--accent)', fontWeight: 500 }}
                    >
                      + New chat thread
                    </button>
                    {chatHistory.length > 0 && (
                      <button
                        className="custom-select-option"
                        onClick={() => {
                          if (confirm('Clear current chat conversation?')) {
                            resetChat();
                          }
                          setThreadMenuOpen(false);
                        }}
                      >
                        ↺ Clear conversation
                      </button>
                    )}
                    {threads.length > 1 && (
                      <button
                        className="custom-select-option"
                        style={{ color: '#a64b4b' }}
                        onClick={() => {
                          if (confirm('Delete this chat thread completely?')) {
                            deleteThread(currentThreadId);
                          }
                          setThreadMenuOpen(false);
                        }}
                      >
                        ✕ Delete current thread
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {recentMemoryStatus && (
          <div style={{ marginTop: 6, fontSize: 11, color: recentMemoryStatus.startsWith('Reset failed') ? '#a64b4b' : 'var(--text-light)' }}>
            {recentMemoryStatus}
          </div>
        )}
      </div>

      {/* Wardrobe Builder Panel */}
      {wardrobeBuilderOpen && (
        <div style={{ margin: '0 16px 10px', padding: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Use my wardrobe</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Create outfits from saved pieces. Images can be generated after you choose a card.</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                onClick={resetWholeWardrobeSessionMemory}
                disabled={recentMemoryResetting || loading}
                title="Clears only recently shown Generate 5 outfit memory. Saved feedback and learning stay intact."
                style={{ fontSize: 11, color: 'var(--text-muted)', padding: '7px 10px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', cursor: recentMemoryResetting || loading ? 'default' : 'pointer', opacity: recentMemoryResetting || loading ? 0.65 : 1 }}
              >
                {recentMemoryResetting ? 'Resetting...' : 'Reset recent memory'}
              </button>
              <button
                onClick={generateWholeWardrobeOutfitsVisual}
                disabled={loading}
                style={{ fontSize: 12, color: '#fff', padding: '7px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
              >
                {loading ? 'Creating...' : 'Create (visual composer)'}
              </button>
              <button
                onClick={generateWholeWardrobeOutfits}
                disabled={loading}
                style={{ fontSize: 12, color: '#fff', padding: '7px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
              >
                {loading ? 'Creating...' : 'Create outfits'}
              </button>
            </div>
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
            <select value={wardrobeOutfitMission} onChange={e => setWardrobeOutfitMission(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
              <option value="mix">Mix of missions</option>
              <option value="controlled_print">Controlled Print</option>
              <option value="monochrome_texture">Monochrome Texture</option>
              <option value="structured_soft">Structured + Soft</option>
              <option value="color_anchor">Color Anchor</option>
              <option value="unexpected_pairing">Unexpected Pairing</option>
              <option value="soft_architecture">Soft Architecture</option>
            </select>
            <input value={wardrobeOutfitMood} onChange={e => setWardrobeOutfitMood(e.target.value)} placeholder="Mood" style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }} />
          </div>
          {recentMemoryStatus && (
            <div style={{ fontSize: 11, color: recentMemoryStatus.startsWith('Reset failed') ? '#a64b4b' : 'var(--text-light)' }}>
              {recentMemoryStatus}
            </div>
          )}
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
            {!pending && (
              <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text)' }}>Use my wardrobe</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Create outfits from saved pieces. Images can be generated after you choose a card.</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      onClick={resetWholeWardrobeSessionMemory}
                      disabled={recentMemoryResetting || loading}
                      title="Clears only recently shown Generate 5 outfit memory. Saved feedback and learning stay intact."
                      style={{ fontSize: 11, color: 'var(--text-muted)', padding: '7px 10px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', cursor: recentMemoryResetting || loading ? 'default' : 'pointer', opacity: recentMemoryResetting || loading ? 0.65 : 1 }}
                    >
                      {recentMemoryResetting ? 'Resetting...' : 'Reset recent memory'}
                    </button>
                    <button
                      onClick={generateWholeWardrobeOutfitsVisual}
                      disabled={loading}
                      style={{ fontSize: 12, color: '#fff', padding: '7px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
                    >
                      {loading ? 'Creating...' : 'Create (visual composer)'}
                    </button>
                    <button
                      onClick={generateWholeWardrobeOutfits}
                      disabled={loading}
                      style={{ fontSize: 12, color: '#fff', padding: '7px 12px', borderRadius: 12, border: '1px solid var(--accent)', background: 'var(--accent)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
                    >
                      {loading ? 'Creating...' : 'Create outfits'}
                    </button>
                  </div>
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
                  <select value={wardrobeOutfitMission} onChange={e => setWardrobeOutfitMission(e.target.value)} style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }}>
                    <option value="mix">Mix of missions</option>
                    <option value="controlled_print">Controlled Print</option>
                    <option value="monochrome_texture">Monochrome Texture</option>
                    <option value="structured_soft">Structured + Soft</option>
                    <option value="color_anchor">Color Anchor</option>
                    <option value="unexpected_pairing">Unexpected Pairing</option>
                    <option value="soft_architecture">Soft Architecture</option>
                  </select>
                  <input value={wardrobeOutfitMood} onChange={e => setWardrobeOutfitMood(e.target.value)} placeholder="Mood" style={{ padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12 }} />
                </div>
                {recentMemoryStatus && (
                  <div style={{ fontSize: 11, color: recentMemoryStatus.startsWith('Reset failed') ? '#a64b4b' : 'var(--text-light)' }}>
                    {recentMemoryStatus}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="chat-thread">
          {messages.map((m, i) => {
            if (m.wardrobeEvaluation || m.contextName === 'Whole wardrobe evaluation') {
              return null
            }
            return (
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
                if (m.role === 'assistant' && m.wardrobeEvaluation) {
                  return (
                    <div className={`ai-message ${m.role}`} style={{ padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12 }}>
                      <details style={{ width: '100%' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent)', fontSize: 13, userSelect: 'none' }}>
                          🔍 View Outfit Critique: {m.outfitName || 'Generated Outfit'}
                        </summary>
                        <div style={{ marginTop: 10, borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
                          {m.text.split('\n').filter(Boolean).map((line, j) => (
                            <p key={j} style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 8px', color: 'var(--text)' }}>{line}</p>
                          ))}
                        </div>
                      </details>
                    </div>
                  )
                }
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
                      {m.queryOptions && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 12px' }}>
                          {m.queryOptions.occasion && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🎯 {m.queryOptions.occasion}
                            </span>
                          )}
                          {m.queryOptions.season && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', textTransform: 'capitalize', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              🌤️ {m.queryOptions.season}
                            </span>
                          )}
                          {m.queryOptions.mission && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              ⚗️ {m.queryOptions.mission === 'mix' ? 'Mix of missions' : m.queryOptions.mission}
                            </span>
                          )}
                          {m.queryOptions.mood && m.queryOptions.mood !== 'artistic minimalist' && (
                            <span style={{ fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '3px 8px', color: 'var(--text-muted)', fontStyle: 'italic', display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Stylist mood/notes">
                              💬 "{m.queryOptions.mood}"
                            </span>
                          )}
                        </div>
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

              {m.role === 'assistant' && i > 0 && activeContext && i === latestAssistantIndex && (
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
          )})}

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
        <div ref={pendingActionRef} style={{ margin: '0 16px 8px', padding: '12px 14px', background: 'var(--accent-light)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {pendingPhoto && <img src={`/uploads/${pendingPhoto}`} alt={pending.name} style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 6, background: 'var(--surface-2)', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--accent)', marginBottom: 1 }}>{pendingPiece ? 'Choose how to use this piece' : 'Choose how to use this outfit'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pending.name}</div>
            {pendingConfidence && <div style={{ marginTop: 6 }}><span style={confidenceBadgeStyle(pendingConfidence.tone)}>{pendingConfidence.label} {pendingConfidence.detail}</span></div>}
            {pendingPiece && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{
                  display: 'flex',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 20,
                  padding: 3,
                  position: 'relative',
                  width: '100%',
                  userSelect: 'none'
                }}>
                  <div style={{
                    position: 'absolute',
                    top: 3,
                    bottom: 3,
                    left: pendingPieceMode === 'wardrobe' ? 3 : 'calc(50% + 1px)',
                    width: 'calc(50% - 4px)',
                    background: 'var(--accent)',
                    borderRadius: 17,
                    zIndex: 1,
                    transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                  }} />
                  <button
                    type="button"
                    onClick={() => setPendingPieceMode('wardrobe')}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '7px 0',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      color: pendingPieceMode === 'wardrobe' ? '#fff' : 'var(--text-muted)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      zIndex: 2,
                      transition: 'color 0.15s ease'
                    }}
                  >
                    Use my wardrobe
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingPieceMode('ideal')}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '7px 0',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      color: pendingPieceMode === 'ideal' ? '#fff' : 'var(--text-muted)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      zIndex: 2,
                      transition: 'color 0.15s ease'
                    }}
                  >
                    Explore additions
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div className="custom-select-container">
                    <button
                      type="button"
                      className={`custom-select-btn ${occasionMenuOpen ? 'active' : ''}`}
                      style={{
                        height: 32,
                        minWidth: '100%',
                        borderRadius: 8,
                        padding: '0 10px',
                        fontSize: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOccasionMenuOpen(!occasionMenuOpen);
                        setSeasonMenuOpen(false);
                        setMissionMenuOpen(false);
                      }}
                    >
                      <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                        {generateOccasion}
                      </span>
                      <span className="custom-select-arrow">▾</span>
                    </button>
                    {occasionMenuOpen && (
                      <>
                        <div className="custom-select-backdrop" onClick={() => setOccasionMenuOpen(false)} />
                        <div className="custom-select-dropdown" style={{ minWidth: 150, fontSize: 12, left: 0, right: 'auto' }}>
                          {['casual', 'city', 'smart casual', 'evening', 'gallery / art event', 'travel'].map(occ => (
                            <button
                              key={occ}
                              type="button"
                              className={`custom-select-option ${generateOccasion === occ ? 'active' : ''}`}
                              style={{ textTransform: 'capitalize' }}
                              onClick={() => {
                                setGenerateOccasion(occ);
                                setOccasionMenuOpen(false);
                              }}
                            >
                              {occ}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="custom-select-container">
                    <button
                      type="button"
                      className={`custom-select-btn ${seasonMenuOpen ? 'active' : ''}`}
                      style={{
                        height: 32,
                        minWidth: '100%',
                        borderRadius: 8,
                        padding: '0 10px',
                        fontSize: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSeasonMenuOpen(!seasonMenuOpen);
                        setOccasionMenuOpen(false);
                        setMissionMenuOpen(false);
                      }}
                    >
                      <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                        {generateSeason.startsWith('early spring') ? 'Early spring' : generateSeason}
                      </span>
                      <span className="custom-select-arrow">▾</span>
                    </button>
                    {seasonMenuOpen && (
                      <>
                        <div className="custom-select-backdrop" onClick={() => setSeasonMenuOpen(false)} />
                        <div className="custom-select-dropdown" style={{ minWidth: 165, fontSize: 12, left: 'auto', right: 0 }}>
                          {[
                            { value: 'current season', label: 'Current season' },
                            { value: 'early spring / cool mild weather', label: 'Early spring' },
                            { value: 'spring / summer', label: 'Spring / summer' },
                            { value: 'fall', label: 'Fall' },
                            { value: 'winter', label: 'Winter' },
                            { value: 'year-round', label: 'Year-round' }
                          ].map(s => (
                            <button
                              key={s.value}
                              type="button"
                              className={`custom-select-option ${generateSeason === s.value ? 'active' : ''}`}
                              onClick={() => {
                                setGenerateSeason(s.value);
                                setSeasonMenuOpen(false);
                              }}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="custom-select-container">
                    <button
                      type="button"
                      className={`custom-select-btn ${missionMenuOpen ? 'active' : ''}`}
                      style={{
                        height: 32,
                        minWidth: '100%',
                        borderRadius: 8,
                        padding: '0 10px',
                        fontSize: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMissionMenuOpen(!missionMenuOpen);
                        setOccasionMenuOpen(false);
                        setSeasonMenuOpen(false);
                      }}
                    >
                      <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                        {{
                          mix: 'Mix of missions',
                          controlled_print: 'Controlled Print',
                          monochrome_texture: 'Monochrome Texture',
                          structured_soft: 'Structured + Soft',
                          color_anchor: 'Color Anchor',
                          unexpected_pairing: 'Unexpected Pairing',
                          soft_architecture: 'Soft Architecture'
                        }[generateMission] || generateMission}
                      </span>
                      <span className="custom-select-arrow">▾</span>
                    </button>
                    {missionMenuOpen && (
                      <>
                        <div className="custom-select-backdrop" onClick={() => setMissionMenuOpen(false)} />
                        <div className="custom-select-dropdown" style={{ minWidth: 165, fontSize: 12, left: 0, right: 'auto' }}>
                          {[
                            { value: 'mix', label: 'Mix of missions' },
                            { value: 'controlled_print', label: 'Controlled Print' },
                            { value: 'monochrome_texture', label: 'Monochrome Texture' },
                            { value: 'structured_soft', label: 'Structured + Soft' },
                            { value: 'color_anchor', label: 'Color Anchor' },
                            { value: 'unexpected_pairing', label: 'Unexpected Pairing' },
                            { value: 'soft_architecture', label: 'Soft Architecture' }
                          ].map(m => (
                            <button
                              key={m.value}
                              type="button"
                              className={`custom-select-option ${generateMission === m.value ? 'active' : ''}`}
                              onClick={() => {
                                setGenerateMission(m.value);
                                setMissionMenuOpen(false);
                              }}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <input
                    type="text"
                    value={generateMood}
                    onChange={e => setGenerateMood(e.target.value)}
                    placeholder="Mood (e.g. moody, soft)"
                    style={{
                      height: 32,
                      width: '100%',
                      borderRadius: 8,
                      padding: '0 10px',
                      fontSize: 12,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    if (pendingPieceMode === 'wardrobe') {
                      send({ piece: pendingPiece, input: 'Style this piece using my existing wardrobe.', generateOutfitMode: true, editorialVisualMode: false, includeMissingPieces: false, idealOnlyMode: false });
                    } else {
                      send({ piece: pendingPiece, input: 'Suggest ideal new pieces for this selected item. Ignore my wardrobe except for the selected item.', generateOutfitMode: false, editorialVisualMode: true, includeMissingPieces: false, idealOnlyMode: true });
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--accent)',
                    background: 'var(--accent)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 650,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {pendingPieceMode === 'wardrobe' ? 'Style with my wardrobe' : 'Suggest ideal additions'}
                </button>
              </div>
            )}
            {pendingOutfit && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
                  <button
                    onClick={() => send({ outfit: pendingOutfit, input: 'Evaluate this outfit. Tell me whether the pieces work together, what feels risky, and what I should change first.', compareOutfitId: '' })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Critique outfit
                  </button>
                  <button
                    onClick={() => send({ outfit: { ...pendingOutfit, imageGenerationMode: true, variantMode: 'similar' }, input: 'Generate similar variants from this saved outfit photo and linked garment references.', compareOutfitId: '' })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Similar variants
                  </button>
                  <button
                    onClick={() => send({ outfit: { ...pendingOutfit, imageGenerationMode: true, variantMode: 'creative' }, input: 'Generate creative alternatives from this saved outfit photo and linked garment references.', compareOutfitId: '' })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)', cursor: 'pointer', textAlign: 'center' }}
                  >
                    Creative alternatives
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
          <textarea ref={textRef} className="ai-input" placeholder={pending ? `Ask a custom question about ${pending.name}...` : 'Ask about your wardrobe...'} value={input} onChange={handleInputChange} onKeyDown={handleKey} rows={1} />
          <button className="ai-send-btn" onClick={send} disabled={loading || (!input.trim() && !imageFile)}>↑</button>
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
