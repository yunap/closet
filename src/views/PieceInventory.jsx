import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import PieceCard from '../components/PieceCard'
import InfoTooltip from '../components/InfoTooltip'
import PieceForm from '../components/PieceForm'
import PieceDetail from '../components/PieceDetail'
import BatchAdd from '../components/BatchAdd'
import TodoList from './TodoList'
import usePendingWardrobeTaskCount from '../utils/usePendingWardrobeTaskCount'
import { wardrobeMixSort } from '../utils/wardrobeMixSort'
import { sortColorNames, COLOR_FAMILY_LABELS, colorTaxonomyEntry } from '../utils/colors'
import { ColorFamilyFilter } from '../components/ColorSelector'

const CATEGORIES = [
  { value: '',          label: 'All' },
  { value: 'top',       label: 'Tops' },
  { value: 'bottom',    label: 'Bottoms' },
  { value: 'dress',     label: 'Dresses' },
  { value: 'outerwear', label: 'Outerwear' },
  { value: 'shoes',     label: 'Shoes' },
  { value: 'accessory', label: 'Accessories' },
]

// Bottoms and Accessories get a subtype dropdown directly on their category chip (split-button:
// clicking the label selects "all of this category", clicking the chevron opens the menu).
// Keep in sync with the tagger's own enum for each field.
const BOTTOM_SUBTYPE_OPTIONS = [
  { value: 'pants',    label: 'Pants' },
  { value: 'shorts',   label: 'Shorts' },
  { value: 'skirt',    label: 'Skirts' },
  { value: 'culottes', label: 'Culottes' },
  { value: 'overalls', label: 'Overalls' },
  { value: 'other',    label: 'Other' },
]

const SHOE_TYPE_OPTIONS = [
  { value: 'mule',    label: 'Mules' },
  { value: 'loafer',  label: 'Loafers' },
  { value: 'boot',    label: 'Boots' },
  { value: 'sandal',  label: 'Sandals' },
  { value: 'pump',    label: 'Pumps' },
  { value: 'flat',    label: 'Flats' },
  { value: 'sneaker', label: 'Sneakers' },
  { value: 'slip_on', label: 'Slip-ons' },
  { value: 'other',   label: 'Other' },
]

// 'jewelry' is deliberately not a plain option here — it opens a nested submenu (JEWELRY_TYPE_OPTIONS)
// instead of being directly selectable, since accessory_subtype=jewelry alone is one of the states
// that submenu itself offers ("All jewelry").
const ACCESSORY_SUBTYPE_OPTIONS = [
  { value: 'belt',    label: 'Belts' },
  { value: 'bag',     label: 'Bags' },
  { value: 'scarf',   label: 'Scarves' },
  { value: 'hat',     label: 'Hats' },
  { value: 'watch',   label: 'Watches' },
  { value: 'glasses', label: 'Glasses' },
  { value: 'gloves',  label: 'Gloves' },
  { value: 'other',   label: 'Other' },
]

const JEWELRY_TYPE_OPTIONS = [
  { value: 'necklace', label: 'Necklaces' },
  { value: 'earrings', label: 'Earrings' },
  { value: 'bracelet', label: 'Bracelets' },
  { value: 'ring',     label: 'Rings' },
  { value: 'pin',      label: 'Pins' },
]

const OCCASIONS = [
  { value: '',             label: 'All occasions' },
  { value: 'casual',       label: 'Casual' },
  { value: 'city',         label: 'City' },
  { value: 'evening',      label: 'Evening' },
  { value: 'smart-casual', label: 'Smart Casual' },
  { value: 'outdoor',      label: 'Outdoor' },
  { value: 'home',         label: 'Home' },
  { value: 'walking',      label: 'Walking' },
]

const SEASONS = [
  { value: '',           label: 'All seasons' },
  { value: 'warm',       label: 'Warm / Summer' },
  { value: 'cool',       label: 'Cool / Winter' },
  { value: 'year-round', label: 'Year-Round' },
]

// Same tiers pieceWarmthTier (styling-engine/attributes.js) derives from fabric_weight + an
// insulating fiber (wool, cashmere, etc) — the same two signals the styling engine weighs
// against hot/cold weather when composing outfits.
const WARMTHS = [
  { value: '',       label: 'All warmths' },
  { value: 'light',  label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy',  label: 'Heavy' },
]

const SORT_OPTIONS = [
  { value: 'mix',      label: 'Balanced mix' },
  { value: 'added',    label: 'Recently added' },
  { value: 'used',     label: 'Recently styled' },
  { value: 'worn',     label: 'Most styled' },
  { value: 'rediscover', label: 'Ready to rediscover' },
  { value: 'name',     label: 'Name A–Z' },
]

export default function PieceInventory({ onSendToStylist }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // Filter state — backed by URL query params so state survives tab switches.
  // Reads fall back to the same defaults as the old useState initialisers.
  const search       = searchParams.get('q')        ?? ''
  const filterCat    = searchParams.get('category') ?? ''
  const filterSubtype = searchParams.get('subtype') ?? ''
  const filterJewelryType = searchParams.get('jewelry_type') ?? ''
  const filterOcc    = searchParams.get('occasion') ?? ''
  const filterSeason = searchParams.get('season')   ?? ''
  const filterColor  = searchParams.get('color')    ?? ''
  const filterColorFamily = searchParams.get('color_family') ?? ''
  const activeColorFamily = filterColorFamily || (filterColor ? colorTaxonomyEntry(filterColor).family : '')
  const filterFabric = searchParams.get('fabric')   ?? ''
  const filterWarmth = searchParams.get('warmth')   ?? ''
  const favOnly      = searchParams.get('fav') === '1'
  const sort         = searchParams.get('sort')     || 'mix'

  // Helper: write one or more params, omitting defaults to keep URLs clean.
  // Always uses replace:true — filter changes are not history entries.
  const setFilter = useCallback((updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === false || value === '0') {
          next.delete(key)
        } else {
          next.set(key, value === true ? '1' : String(value))
        }
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [pieces, setPieces]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(false)
  // showTodo is a modal-open flag — intentionally NOT URL-backed (modal should open fresh each visit)
  const [showTodo, setShowTodo]       = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [showBatch, setShowBatch]     = useState(false)
  const [editPiece, setEditPiece]     = useState(null)
  const [detailPiece, setDetailPiece] = useState(null)
  const [openFilterMenu, setOpenFilterMenu] = useState(null)
  const [jewelrySubmenuOpen, setJewelrySubmenuOpen] = useState(false)
  const [fabricSearch, setFabricSearch] = useState('')
  const compactFilterRef = useRef(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef(null)
  const addMenuTriggerRef = useRef(null)
  const [availableColors, setAvailableColors]   = useState([])
  const [colorFamilyCounts, setColorFamilyCounts] = useState({})
  const [availableFabrics, setAvailableFabrics] = useState([])
  const [usageStats, setUsageStats] = useState({})
  const [demoWardrobe, setDemoWardrobe] = useState(null)
  const [demoLoading, setDemoLoading] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const piecesRequestRef = useRef({ controller: null, id: 0 })
  const pendingCount = usePendingWardrobeTaskCount()

  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/pieces/meta')
      const data = await res.json()
      setAvailableColors(sortColorNames(data.colors || []))
      setColorFamilyCounts(data.family_counts || {})
      setAvailableFabrics(data.fabrics || [])
    } catch {}
  }, [])

  const fetchUsageStats = useCallback(async () => {
    try {
      const res = await fetch('/api/pieces/usage-stats')
      const data = await res.json()
      setUsageStats(data && typeof data === 'object' ? data : {})
    } catch {}
  }, [])

  useEffect(() => { fetchMeta() }, [fetchMeta])
  useEffect(() => { fetchUsageStats() }, [fetchUsageStats])

  const fetchPieces = useCallback(async () => {
    piecesRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const requestId = piecesRequestRef.current.id + 1
    piecesRequestRef.current = { controller, id: requestId }
    const params = new URLSearchParams()
    if (filterCat)    params.set('category', filterCat)
    if (filterSubtype && (filterCat === 'bottom' || filterCat === 'accessory' || filterCat === 'shoes')) {
      params.set('subtype', filterSubtype)
      if (filterCat === 'accessory' && filterSubtype === 'jewelry' && filterJewelryType) {
        params.set('jewelry_type', filterJewelryType)
      }
    }
    if (filterOcc)    params.set('occasion', filterOcc)
    if (filterSeason) params.set('season', filterSeason)
    if (filterColor)  params.set('color', filterColor)
    else if (filterColorFamily) params.set('color_family', filterColorFamily)
    if (filterFabric) params.set('fabric', filterFabric)
    if (filterWarmth) params.set('warmth', filterWarmth)
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (favOnly)      params.set('favorites', 'true')
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/pieces?${params}`, { signal: controller.signal })
      // A 401 (or any error) returns {error} — storing that in pieces crashes the grid's
      // .map and blanks the whole app before the auth redirect can run.
      const data = await res.json().catch(() => null)
      if (piecesRequestRef.current.id !== requestId) return
      if (!res.ok || !Array.isArray(data)) {
        setLoadError(true)
        return
      }
      setPieces(data)
    } catch (error) {
      if (error?.name !== 'AbortError' && piecesRequestRef.current.id === requestId) setLoadError(true)
    } finally {
      if (piecesRequestRef.current.id === requestId) setLoading(false)
    }
  }, [filterCat, filterSubtype, filterJewelryType, filterOcc, filterSeason, filterColor, filterColorFamily, filterFabric, filterWarmth, debouncedSearch, favOnly])

  useEffect(() => { fetchPieces() }, [fetchPieces])
  useEffect(() => () => piecesRequestRef.current.controller?.abort(), [])
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const isUnfilteredWardrobe = !search && !filterCat && !filterOcc && !filterSeason && !filterColor && !filterColorFamily && !filterFabric && !filterWarmth && !favOnly

  useEffect(() => {
    if (loading || pieces.length > 0 || !isUnfilteredWardrobe) return
    fetch('/api/settings/demo-wardrobe')
      .then(res => res.json())
      .then(data => setDemoWardrobe(data))
      .catch(() => setDemoWardrobe(null))
  }, [loading, pieces.length, isUnfilteredWardrobe])

  const loadDemoWardrobe = async () => {
    setDemoLoading(true)
    try {
      const res = await fetch('/api/settings/demo-wardrobe', { method: 'POST' })
      if (!res.ok) return
      await Promise.all([fetchPieces(), fetchMeta()])
    } finally {
      setDemoLoading(false)
    }
  }

  // Deep link from elsewhere in the app (e.g. the Stylist piece landing) straight
  // into this piece's detail card. One-shot: the param is consumed and cleared so
  // closing the modal and reloading doesn't reopen it.
  useEffect(() => {
    const pieceId = searchParams.get('pieceId')
    if (!pieceId || !pieces.length) return
    const match = pieces.find(p => String(p.id) === String(pieceId))
    if (match) setDetailPiece(match)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('pieceId')
      return next
    }, { replace: true })
  }, [pieces, searchParams, setSearchParams])

  // Sorting is applied client-side over the already-filtered `pieces` list —
  // the server keeps its own default order (favorite, date_added), and the
  // sort modes here are pure reorderings of that same result set. "Used"/"worn"
  // reflect usageStats (Visual Composer + Stylist chat references), not literal
  // real-world wear — the app has no way to observe that.
  const sortedPieces = useMemo(() => {
    if (sort === 'name') return [...pieces].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    if (sort === 'added') return [...pieces].sort((a, b) => new Date(b.date_added || 0) - new Date(a.date_added || 0))
    if (sort === 'used') {
      return [...pieces].sort((a, b) => {
        const at = usageStats[a.id]?.lastUsedAt || ''
        const bt = usageStats[b.id]?.lastUsedAt || ''
        return bt.localeCompare(at)
      })
    }
    if (sort === 'worn') {
      return [...pieces].sort((a, b) => (usageStats[b.id]?.count || 0) - (usageStats[a.id]?.count || 0))
    }
    if (sort === 'rediscover') {
      return [...pieces].sort((a, b) => {
        const countDiff = (usageStats[a.id]?.count || 0) - (usageStats[b.id]?.count || 0)
        if (countDiff !== 0) return countDiff
        const at = usageStats[a.id]?.lastUsedAt || ''
        const bt = usageStats[b.id]?.lastUsedAt || ''
        return at.localeCompare(bt)
      })
    }
    return wardrobeMixSort(pieces, { usageStats })
  }, [pieces, sort, usageStats])
  const closeAddMenu = useCallback((restoreFocus = true) => {
    setShowAddMenu(false)
    if (restoreFocus) addMenuTriggerRef.current?.focus()
  }, [])
  useEffect(() => {
    if (!showAddMenu) return undefined
    addMenuRef.current?.querySelector('[role="menuitem"]')?.focus()
    const handlePointerDown = (event) => {
      if (!addMenuRef.current?.contains(event.target)) closeAddMenu(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeAddMenu(true)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showAddMenu, closeAddMenu])
  useEffect(() => {
    if (!openFilterMenu) return undefined
    const menu = compactFilterRef.current?.querySelector(`[data-filter-menu="${openFilterMenu}"]`)
    const initialTarget = openFilterMenu === 'fabric'
      ? menu?.querySelector('input')
      : menu?.querySelector('[role="option"], button')
    initialTarget?.focus()
    const handlePointerDown = (event) => {
      if (!compactFilterRef.current?.contains(event.target)) {
        setOpenFilterMenu(null)
        setFabricSearch('')
        setJewelrySubmenuOpen(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        const trigger = compactFilterRef.current?.querySelector(`[data-filter-trigger="${openFilterMenu}"]`)
        setOpenFilterMenu(null)
        setFabricSearch('')
        setJewelrySubmenuOpen(false)
        trigger?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openFilterMenu])

  // Whichever menu the user just opened, the jewelry submenu should not still be showing from
  // a previous visit to the Accessories menu.
  useEffect(() => {
    if (openFilterMenu !== 'category:accessory') setJewelrySubmenuOpen(false)
  }, [openFilterMenu])

  const handleFavorite = async (piece) => {
    await fetch(`/api/pieces/${piece.id}/favorite`, { method: 'PATCH' })
    fetchPieces()
  }
  const handleSave = () => { setShowForm(false); setEditPiece(null); setDetailPiece(null); fetchPieces(); fetchMeta() }
  const handleDelete = async (piece) => { await fetch(`/api/pieces/${piece.id}`, { method: 'DELETE' }); setDetailPiece(null); fetchPieces(); fetchMeta() }
  const handleEdit = (piece) => { setDetailPiece(null); setEditPiece(piece); setShowForm(true) }
  const occasionLabel = OCCASIONS.find(o => o.value === filterOcc)?.label
  const seasonLabel   = SEASONS.find(s => s.value === filterSeason)?.label
  const warmthLabel   = WARMTHS.find(w => w.value === filterWarmth)?.label
  // Category chip resting labels collapse the hierarchy: a jewelry_type selection reads
  // "Accessories · Necklaces", never "Accessories · Jewelry · Necklaces" — the intermediate
  // level is only meaningful inside the open menu, not in the closed-state label.
  const bottomSubtypeLabel = BOTTOM_SUBTYPE_OPTIONS.find(o => o.value === filterSubtype)?.label
  const bottomsLabel = (filterCat === 'bottom' && bottomSubtypeLabel) ? `Bottoms · ${bottomSubtypeLabel}` : 'Bottoms'
  const shoeTypeLabel = SHOE_TYPE_OPTIONS.find(o => o.value === filterSubtype)?.label
  const shoesLabel = (filterCat === 'shoes' && shoeTypeLabel) ? `Shoes · ${shoeTypeLabel}` : 'Shoes'
  const accessorySubtypeLabel = ACCESSORY_SUBTYPE_OPTIONS.find(o => o.value === filterSubtype)?.label
  const jewelryTypeLabel = JEWELRY_TYPE_OPTIONS.find(o => o.value === filterJewelryType)?.label
  const accessoriesLabel = filterCat !== 'accessory' ? 'Accessories'
    : filterSubtype === 'jewelry' ? (jewelryTypeLabel ? `Accessories · ${jewelryTypeLabel}` : 'Accessories · Jewelry')
    : accessorySubtypeLabel ? `Accessories · ${accessorySubtypeLabel}`
    : 'Accessories'
  const activeCompactFilters = [
    filterOcc    ? { key: 'occasion', label: occasionLabel, clear: () => setFilter({ occasion: '' }) } : null,
    filterSeason ? { key: 'season',   label: seasonLabel,   clear: () => setFilter({ season: '' }) } : null,
    (filterColor || filterColorFamily) ? { key: 'color', label: filterColor ? `${COLOR_FAMILY_LABELS[activeColorFamily]} · ${filterColor}` : COLOR_FAMILY_LABELS[filterColorFamily], clear: () => setFilter({ color: '', color_family: '' }) } : null,
    filterFabric ? { key: 'fabric',   label: filterFabric,  clear: () => setFilter({ fabric: '' }) } : null,
    filterWarmth ? { key: 'warmth',   label: warmthLabel,   clear: () => setFilter({ warmth: '' }) } : null,
  ].filter(Boolean)
  const clearAllCompactFilters = () => setFilter({ occasion: '', season: '', color: '', color_family: '', fabric: '', warmth: '' })
  const hasActiveFilters = Boolean(search || filterCat || filterSubtype || filterJewelryType || filterOcc || filterSeason || filterColor || filterColorFamily || filterFabric || filterWarmth || favOnly)
  const clearWardrobeFilters = () => setFilter({
    q: '',
    category: '',
    subtype: '',
    jewelry_type: '',
    occasion: '',
    season: '',
    color: '',
    color_family: '',
    fabric: '',
    warmth: '',
    fav: false,
  })
  const resultLabel = loading || search !== debouncedSearch
    ? 'Updating pieces…'
    : hasActiveFilters
      ? `${pieces.length} matching ${pieces.length === 1 ? 'piece' : 'pieces'}`
      : `${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}`
  const visibleFabrics = availableFabrics.filter(fabric => fabric.toLowerCase().includes(fabricSearch.trim().toLowerCase()))
  const addPiece = () => { setEditPiece(null); setShowForm(true) }

  const addMenuItems = [
    {
      key: 'single',
      label: 'Add one piece',
      description: 'Upload or enter one garment.',
      onSelect: addPiece,
    },
    {
      key: 'import',
      label: 'Import pieces',
      description: 'Bring pieces in through the existing import flow.',
      onSelect: () => navigate('/import'),
    },
    {
      key: 'batch',
      label: 'Add paired hanger + worn photos',
      description: 'Add multiple garments while matching each hanger photo to its worn photo.',
      onSelect: () => setShowBatch(true),
    },
  ]
  const handleAddMenuKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(addMenuRef.current?.querySelectorAll('[role="menuitem"]') || [])
    const index = items.indexOf(document.activeElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const next = items[(index + delta + items.length) % items.length]
    next?.focus()
  }
  const handleFilterMenuKeyDown = (event) => {
    const menu = event.currentTarget
    const items = Array.from(menu.querySelectorAll('[role="option"], button')).filter(item => !item.disabled)
    if (!items.length) return
    if (/^[a-z0-9]$/i.test(event.key)) {
      const match = items.find(item => item.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()))
      match?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement)
    if (event.key === 'Home') {
      items[0]?.focus()
      return
    }
    if (event.key === 'End') {
      items[items.length - 1]?.focus()
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = index < 0
      ? (delta > 0 ? 0 : items.length - 1)
      : (index + delta + items.length) % items.length
    items[nextIndex]?.focus()
  }
  const selectFilterOption = (menuName, updates, { clearFabric = false } = {}) => {
    setFilter(updates)
    setOpenFilterMenu(null)
    if (clearFabric) setFabricSearch('')
    requestAnimationFrame(() => {
      compactFilterRef.current?.querySelector(`[data-filter-trigger="${menuName}"]`)?.focus()
    })
  }

  return (
    <div aria-busy={loading}>
      {/* Header */}
      <div className="view-header wardrobe-view-header">
        <div className="view-header-top wardrobe-header-primary">
          <div className="wardrobe-header-title">
            <div className="view-title">The Wardrobe Room</div>
            <div className="view-subtitle" aria-live="polite">{resultLabel}</div>
          </div>
          <div className="search-bar wardrobe-header-search">
            <span className="search-icon" aria-hidden="true">◎</span>
            <input aria-label="Search wardrobe" type="search" placeholder="Search by name, color, fabric, or shape…" value={search} onChange={e => setFilter({ q: e.target.value })} />
            {search && (
              <button type="button" className="wardrobe-search-clear" onClick={() => setFilter({ q: '' })} aria-label="Clear wardrobe search">
                ×
              </button>
            )}
          </div>
          <div className="wardrobe-header-actions">
            <div className="wardrobe-add-menu" ref={addMenuRef}>
              <button
                ref={addMenuTriggerRef}
                className="chip wardrobe-add-piece wardrobe-add-menu-trigger"
                onClick={() => setShowAddMenu(v => !v)}
                aria-haspopup="menu"
                aria-expanded={showAddMenu}
              >
                <span className="wardrobe-add-menu-icon" aria-hidden="true">+</span>
                Add pieces
                <span className="filter-menu-chevron" aria-hidden="true">⌄</span>
              </button>
              {showAddMenu && (
                <div
                  className="filter-menu-popover wardrobe-add-menu-popover"
                  role="menu"
                  onKeyDown={handleAddMenuKeyDown}
                >
                  {addMenuItems.map(item => (
                    <button
                      key={item.key}
                      role="menuitem"
                      className="wardrobe-add-menu-item"
                      onClick={() => { closeAddMenu(true); item.onSelect() }}
                    >
                      <span className="wardrobe-add-menu-item-label">{item.label}</span>
                      <span className="wardrobe-add-menu-item-desc">{item.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="chip wardrobe-tasks-btn"
              onClick={() => setShowTodo(true)}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="12" height="13" rx="2" />
                <path d="M7.5 4V2.75h5V4M7 8h6M7 11h6M7 14h3.5" />
              </svg>
              <span>Tasks</span>
              {pendingCount > 0 && <span className="badge-count">{pendingCount}</span>}
            </button>
          </div>
        </div>

        <div className="wardrobe-filter-and-compact-rows" ref={compactFilterRef}>
        <div className="wardrobe-filter-group">
          <div className={`filter-row ${openFilterMenu?.startsWith('category:') ? 'filter-row-menu-open' : ''}`} aria-label="Wardrobe categories">
            {CATEGORIES.map(c => {
              if (c.value === 'bottom') {
                return (
                  <div key="bottom" className="wardrobe-filter-menu wardrobe-category-menu">
                    <div className={`chip-split ${filterCat === 'bottom' ? 'active' : ''}`}>
                      <button
                        className="chip-split-label"
                        onClick={() => { setFilter({ category: 'bottom', subtype: '' }); setOpenFilterMenu(null) }}
                        aria-pressed={filterCat === 'bottom'}
                      >
                        {bottomsLabel}
                      </button>
                      <button
                        className="chip-split-chevron"
                        onClick={() => setOpenFilterMenu(openFilterMenu === 'category:bottom' ? null : 'category:bottom')}
                        aria-expanded={openFilterMenu === 'category:bottom'}
                        aria-haspopup="listbox"
                        aria-label="Bottoms subtypes"
                        data-filter-trigger="category:bottom"
                      >
                        <span className="filter-menu-chevron">⌄</span>
                      </button>
                    </div>
                    {openFilterMenu === 'category:bottom' && (
                      <div className="filter-menu-popover" role="listbox" aria-label="Bottoms" data-filter-menu="category:bottom" onKeyDown={handleFilterMenuKeyDown}>
                        <button
                          className={`custom-select-option ${filterCat === 'bottom' && !filterSubtype ? 'active' : ''}`}
                          onClick={() => selectFilterOption('category:bottom', { category: 'bottom', subtype: '' })}
                          role="option"
                          aria-selected={filterCat === 'bottom' && !filterSubtype}
                        >
                          <span>All bottoms</span>
                          {filterCat === 'bottom' && !filterSubtype && <span aria-hidden="true">✓</span>}
                        </button>
                        {BOTTOM_SUBTYPE_OPTIONS.map(o => (
                          <button
                            key={o.value}
                            className={`custom-select-option ${filterCat === 'bottom' && filterSubtype === o.value ? 'active' : ''}`}
                            onClick={() => selectFilterOption('category:bottom', { category: 'bottom', subtype: o.value })}
                            role="option"
                            aria-selected={filterCat === 'bottom' && filterSubtype === o.value}
                          >
                            <span>{o.label}</span>
                            {filterCat === 'bottom' && filterSubtype === o.value && <span aria-hidden="true">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }
              if (c.value === 'shoes') {
                return (
                  <div key="shoes" className="wardrobe-filter-menu wardrobe-category-menu">
                    <div className={`chip-split ${filterCat === 'shoes' ? 'active' : ''}`}>
                      <button
                        className="chip-split-label"
                        onClick={() => { setFilter({ category: 'shoes', subtype: '' }); setOpenFilterMenu(null) }}
                        aria-pressed={filterCat === 'shoes'}
                      >
                        {shoesLabel}
                      </button>
                      <button
                        className="chip-split-chevron"
                        onClick={() => setOpenFilterMenu(openFilterMenu === 'category:shoes' ? null : 'category:shoes')}
                        aria-expanded={openFilterMenu === 'category:shoes'}
                        aria-haspopup="listbox"
                        aria-label="Shoe subtypes"
                        data-filter-trigger="category:shoes"
                      >
                        <span className="filter-menu-chevron">⌄</span>
                      </button>
                    </div>
                    {openFilterMenu === 'category:shoes' && (
                      <div className="filter-menu-popover" role="listbox" aria-label="Shoes" data-filter-menu="category:shoes" onKeyDown={handleFilterMenuKeyDown}>
                        <button
                          className={`custom-select-option ${filterCat === 'shoes' && !filterSubtype ? 'active' : ''}`}
                          onClick={() => selectFilterOption('category:shoes', { category: 'shoes', subtype: '' })}
                          role="option"
                          aria-selected={filterCat === 'shoes' && !filterSubtype}
                        >
                          <span>All shoes</span>
                          {filterCat === 'shoes' && !filterSubtype && <span aria-hidden="true">✓</span>}
                        </button>
                        {SHOE_TYPE_OPTIONS.map(o => (
                          <button
                            key={o.value}
                            className={`custom-select-option ${filterCat === 'shoes' && filterSubtype === o.value ? 'active' : ''}`}
                            onClick={() => selectFilterOption('category:shoes', { category: 'shoes', subtype: o.value })}
                            role="option"
                            aria-selected={filterCat === 'shoes' && filterSubtype === o.value}
                          >
                            <span>{o.label}</span>
                            {filterCat === 'shoes' && filterSubtype === o.value && <span aria-hidden="true">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }
              if (c.value === 'accessory') {
                return (
                  <div key="accessory" className="wardrobe-filter-menu wardrobe-category-menu">
                    <div className={`chip-split ${filterCat === 'accessory' ? 'active' : ''}`}>
                      <button
                        className="chip-split-label"
                        onClick={() => { setFilter({ category: 'accessory', subtype: '', jewelry_type: '' }); setOpenFilterMenu(null) }}
                        aria-pressed={filterCat === 'accessory'}
                      >
                        {accessoriesLabel}
                      </button>
                      <button
                        className="chip-split-chevron"
                        onClick={() => setOpenFilterMenu(openFilterMenu === 'category:accessory' ? null : 'category:accessory')}
                        aria-expanded={openFilterMenu === 'category:accessory'}
                        aria-haspopup="listbox"
                        aria-label="Accessory subtypes"
                        data-filter-trigger="category:accessory"
                      >
                        <span className="filter-menu-chevron">⌄</span>
                      </button>
                    </div>
                    {openFilterMenu === 'category:accessory' && (
                      <div className="filter-menu-popover" role="listbox" aria-label="Accessories" data-filter-menu="category:accessory" onKeyDown={handleFilterMenuKeyDown}>
                        <button
                          className={`custom-select-option ${filterCat === 'accessory' && !filterSubtype ? 'active' : ''}`}
                          onClick={() => selectFilterOption('category:accessory', { category: 'accessory', subtype: '', jewelry_type: '' })}
                          role="option"
                          aria-selected={filterCat === 'accessory' && !filterSubtype}
                        >
                          <span>All accessories</span>
                          {filterCat === 'accessory' && !filterSubtype && <span aria-hidden="true">✓</span>}
                        </button>
                        {ACCESSORY_SUBTYPE_OPTIONS.slice(0, 2).map(o => (
                          <button
                            key={o.value}
                            className={`custom-select-option ${filterCat === 'accessory' && filterSubtype === o.value ? 'active' : ''}`}
                            onClick={() => selectFilterOption('category:accessory', { category: 'accessory', subtype: o.value, jewelry_type: '' })}
                            role="option"
                            aria-selected={filterCat === 'accessory' && filterSubtype === o.value}
                          >
                            <span>{o.label}</span>
                            {filterCat === 'accessory' && filterSubtype === o.value && <span aria-hidden="true">✓</span>}
                          </button>
                        ))}
                        <div
                          className="custom-select-submenu-wrap"
                          onMouseEnter={() => setJewelrySubmenuOpen(true)}
                          onMouseLeave={() => setJewelrySubmenuOpen(false)}
                        >
                          <button
                            className={`custom-select-option custom-select-option-submenu ${filterCat === 'accessory' && filterSubtype === 'jewelry' ? 'active' : ''}`}
                            onClick={() => setJewelrySubmenuOpen(true)}
                            role="option"
                            aria-haspopup="listbox"
                            aria-expanded={jewelrySubmenuOpen}
                            aria-selected={filterCat === 'accessory' && filterSubtype === 'jewelry'}
                          >
                            <span>Jewelry</span>
                            <span aria-hidden="true">{filterCat === 'accessory' && filterSubtype === 'jewelry' ? '✓ ' : ''}›</span>
                          </button>
                          {jewelrySubmenuOpen && (
                            <div className="filter-menu-popover filter-menu-submenu" role="listbox" aria-label="Jewelry">
                              <button
                                className={`custom-select-option ${filterCat === 'accessory' && filterSubtype === 'jewelry' && !filterJewelryType ? 'active' : ''}`}
                                onClick={() => selectFilterOption('category:accessory', { category: 'accessory', subtype: 'jewelry', jewelry_type: '' })}
                                role="option"
                                aria-selected={filterCat === 'accessory' && filterSubtype === 'jewelry' && !filterJewelryType}
                              >
                                <span>All jewelry</span>
                                {filterCat === 'accessory' && filterSubtype === 'jewelry' && !filterJewelryType && <span aria-hidden="true">✓</span>}
                              </button>
                              {JEWELRY_TYPE_OPTIONS.map(o => (
                                <button
                                  key={o.value}
                                  className={`custom-select-option ${filterJewelryType === o.value ? 'active' : ''}`}
                                  onClick={() => selectFilterOption('category:accessory', { category: 'accessory', subtype: 'jewelry', jewelry_type: o.value })}
                                  role="option"
                                  aria-selected={filterJewelryType === o.value}
                                >
                                  <span>{o.label}</span>
                                  {filterJewelryType === o.value && <span aria-hidden="true">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {ACCESSORY_SUBTYPE_OPTIONS.slice(2).map(o => (
                          <button
                            key={o.value}
                            className={`custom-select-option ${filterCat === 'accessory' && filterSubtype === o.value ? 'active' : ''}`}
                            onClick={() => selectFilterOption('category:accessory', { category: 'accessory', subtype: o.value, jewelry_type: '' })}
                            role="option"
                            aria-selected={filterCat === 'accessory' && filterSubtype === o.value}
                          >
                            <span>{o.label}</span>
                            {filterCat === 'accessory' && filterSubtype === o.value && <span aria-hidden="true">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }
              return (
                <button key={c.value} className={`chip ${filterCat === c.value ? 'active' : ''}`} onClick={() => { setFilter({ category: c.value, subtype: '', jewelry_type: '' }); setOpenFilterMenu(null) }} aria-pressed={filterCat === c.value}>{c.label}</button>
              )
            })}
          </div>
        </div>

        <div className="wardrobe-compact-filter-row">
          <div className="wardrobe-filter-menu">
            <button
              className={`filter-menu-btn ${openFilterMenu === 'occasion' || filterOcc ? 'active' : ''}`}
              onClick={() => setOpenFilterMenu(openFilterMenu === 'occasion' ? null : 'occasion')}
              aria-expanded={openFilterMenu === 'occasion'}
              aria-haspopup="listbox"
              data-filter-trigger="occasion"
            >
              <span>{filterOcc ? `Occasion: ${occasionLabel}` : 'Occasion'}</span>
              <span className="filter-menu-chevron">⌄</span>
            </button>
            {openFilterMenu === 'occasion' && (
              <div className="filter-menu-popover" role="listbox" aria-label="Occasion" data-filter-menu="occasion" onKeyDown={handleFilterMenuKeyDown}>
                {OCCASIONS.map(o => (
                  <button
                    key={o.value}
                    className={`custom-select-option ${filterOcc === o.value ? 'active' : ''}`}
                    onClick={() => selectFilterOption('occasion', { occasion: o.value })}
                    role="option"
                    aria-selected={filterOcc === o.value}
                  >
                    <span>{o.label}</span>
                    {filterOcc === o.value && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="wardrobe-filter-menu">
            <button
              className={`filter-menu-btn ${openFilterMenu === 'season' || filterSeason ? 'active' : ''}`}
              onClick={() => setOpenFilterMenu(openFilterMenu === 'season' ? null : 'season')}
              aria-expanded={openFilterMenu === 'season'}
              aria-haspopup="listbox"
              data-filter-trigger="season"
            >
              <span>{filterSeason ? `Season: ${seasonLabel}` : 'Season'}</span>
              <span className="filter-menu-chevron">⌄</span>
            </button>
            {openFilterMenu === 'season' && (
              <div className="filter-menu-popover" role="listbox" aria-label="Season" data-filter-menu="season" onKeyDown={handleFilterMenuKeyDown}>
                {SEASONS.map(s => (
                  <button
                    key={s.value}
                    className={`custom-select-option ${filterSeason === s.value ? 'active' : ''}`}
                    onClick={() => selectFilterOption('season', { season: s.value })}
                    role="option"
                    aria-selected={filterSeason === s.value}
                  >
                    <span>{s.label}</span>
                    {filterSeason === s.value && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="wardrobe-filter-menu">
            <button
              className={`filter-menu-btn ${openFilterMenu === 'warmth' || filterWarmth ? 'active' : ''}`}
              onClick={() => setOpenFilterMenu(openFilterMenu === 'warmth' ? null : 'warmth')}
              aria-expanded={openFilterMenu === 'warmth'}
              aria-haspopup="listbox"
              data-filter-trigger="warmth"
            >
              <span>{filterWarmth ? `Warmth: ${warmthLabel}` : 'Warmth'}</span>
              <span className="filter-menu-chevron">⌄</span>
            </button>
            {openFilterMenu === 'warmth' && (
              <div className="filter-menu-popover" role="listbox" aria-label="Warmth" data-filter-menu="warmth" onKeyDown={handleFilterMenuKeyDown}>
                {WARMTHS.map(w => (
                  <button
                    key={w.value}
                    className={`custom-select-option ${filterWarmth === w.value ? 'active' : ''}`}
                    onClick={() => selectFilterOption('warmth', { warmth: w.value })}
                    role="option"
                    aria-selected={filterWarmth === w.value}
                  >
                    <span>{w.label}</span>
                    {filterWarmth === w.value && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {availableColors.length > 0 && (
            <div className="wardrobe-filter-menu">
              <button
                className={`filter-menu-btn ${openFilterMenu === 'color' || filterColor || filterColorFamily ? 'active' : ''}`}
                onClick={() => { setFabricSearch(''); setOpenFilterMenu(openFilterMenu === 'color' ? null : 'color') }}
                aria-expanded={openFilterMenu === 'color'}
                data-filter-trigger="color"
              >
                <span>{filterColor ? `${COLOR_FAMILY_LABELS[activeColorFamily]} · ${filterColor}` : filterColorFamily ? COLOR_FAMILY_LABELS[filterColorFamily] : 'Color'}</span>
                <span className="filter-menu-chevron">⌄</span>
              </button>
              {openFilterMenu === 'color' && (
                <div className="filter-menu-popover wardrobe-color-popover" aria-label="Color" data-filter-menu="color" onKeyDown={handleFilterMenuKeyDown}>
                  <ColorFamilyFilter
                    availableColors={availableColors}
                    familyCounts={colorFamilyCounts}
                    valueFamily={activeColorFamily}
                    valueColor={filterColor}
                    onChange={({ family, color }) => setFilter({ color_family: family, color })}
                    compact
                  />
                </div>
              )}
            </div>
          )}

          {availableFabrics.length > 0 && (
            <div className="wardrobe-filter-menu">
              <button
                className={`filter-menu-btn ${openFilterMenu === 'fabric' || filterFabric ? 'active' : ''}`}
                onClick={() => setOpenFilterMenu(openFilterMenu === 'fabric' ? null : 'fabric')}
                aria-expanded={openFilterMenu === 'fabric'}
                aria-haspopup="listbox"
                data-filter-trigger="fabric"
              >
                <span>{filterFabric ? `Fabric: ${filterFabric}` : 'Fabric'}</span>
                <span className="filter-menu-chevron">⌄</span>
              </button>
              {openFilterMenu === 'fabric' && (
                <div className="filter-menu-popover wardrobe-fabric-popover" data-filter-menu="fabric" onKeyDown={handleFilterMenuKeyDown}>
                  <div className="wardrobe-fabric-search-shell">
                    <input
                      className="wardrobe-fabric-search"
                      type="search"
                      placeholder="Search fabrics..."
                      aria-label="Search fabrics"
                      value={fabricSearch}
                      onChange={event => setFabricSearch(event.target.value)}
                    />
                  </div>
                  <div role="listbox" aria-label="Fabric">
                    <button
                      className={`custom-select-option ${!filterFabric ? 'active' : ''}`}
                      onClick={() => selectFilterOption('fabric', { fabric: '' }, { clearFabric: true })}
                      role="option"
                      aria-selected={!filterFabric}
                    >
                      <span>All</span>
                      {!filterFabric && <span aria-hidden="true">✓</span>}
                    </button>
                    {visibleFabrics.map(fabric => (
                      <button
                        key={fabric}
                        className={`custom-select-option ${filterFabric === fabric ? 'active' : ''}`}
                        onClick={() => selectFilterOption('fabric', { fabric: filterFabric === fabric ? '' : fabric }, { clearFabric: true })}
                        role="option"
                        aria-selected={filterFabric === fabric}
                        style={{ textTransform: 'capitalize' }}
                      >
                        <span>{fabric}</span>
                        {filterFabric === fabric && <span aria-hidden="true">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            className={`chip wardrobe-favorite-filter ${favOnly ? 'active' : ''}`}
            onClick={() => setFilter({ fav: !favOnly })}
            title="Show favorite pieces"
            aria-label="Show favorite pieces"
            aria-pressed={favOnly}
          >
            {favOnly ? '♥ Favorites' : '♡ Favorites'}
          </button>

          <div className="wardrobe-sort-group">
            <div className="wardrobe-filter-menu wardrobe-sort-menu">
              <button
                className={`filter-menu-btn ${openFilterMenu === 'sort' ? 'active' : ''}`}
                onClick={() => setOpenFilterMenu(openFilterMenu === 'sort' ? null : 'sort')}
                aria-expanded={openFilterMenu === 'sort'}
                aria-haspopup="listbox"
                data-filter-trigger="sort"
              >
                <span>Sort: {SORT_OPTIONS.find(o => o.value === sort)?.label}</span>
                <span className="filter-menu-chevron">⌄</span>
              </button>
              {openFilterMenu === 'sort' && (
                <div className="filter-menu-popover wardrobe-sort-popover" role="listbox" aria-label="Sort wardrobe" data-filter-menu="sort" onKeyDown={handleFilterMenuKeyDown}>
                  {SORT_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      className={`custom-select-option ${sort === o.value ? 'active' : ''}`}
                      onClick={() => selectFilterOption('sort', { sort: o.value === 'mix' ? '' : o.value })}
                      role="option"
                      aria-selected={sort === o.value}
                    >
                      <span>{o.label}</span>
                      {sort === o.value && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <InfoTooltip
              className="wardrobe-sort-info"
              label="How wardrobe activity affects sorting"
              align="right"
              side="bottom"
              width={276}
              open={openFilterMenu === 'sortInfo'}
              onToggle={(next) => setOpenFilterMenu(next ? 'sortInfo' : null)}
            >
              <div className="wardrobe-sort-info-title">Styling activity in Closet</div>
              <div className="wardrobe-sort-info-row">
                <strong>Most styled</strong>
                <span>Pieces used most often in saved outfits and boards.</span>
              </div>
              <div className="wardrobe-sort-info-row">
                <strong>Recently styled</strong>
                <span>Pieces most recently used there.</span>
              </div>
              <div className="wardrobe-sort-info-row">
                <strong>Ready to rediscover</strong>
                <span>Pieces used least often in saved outfits and boards.</span>
              </div>
            </InfoTooltip>
          </div>
        </div>
        </div>

        {activeCompactFilters.length > 0 && (
          <div className="active-filter-row wardrobe-active-filter-row">
            {activeCompactFilters.map(filter => (
              <button key={filter.key} className="active-filter-chip" onClick={filter.clear}>
                {filter.label} ×
              </button>
            ))}
            {activeCompactFilters.length >= 2 && (
              <button className="clear-filters-btn" onClick={clearAllCompactFilters}>
                Clear all
              </button>
            )}
          </div>
        )}

      </div>

      {/* Grid */}
      {loading ? (
        <div className="loading" aria-live="polite">Loading your wardrobe…</div>
      ) : loadError ? (
        <div className="empty-state wardrobe-empty-state" role="alert">
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">Wardrobe could not load</div>
          <div className="empty-state-text">Your pieces are still here. Check the connection and try again.</div>
          <button className="btn-secondary wardrobe-clear-empty" onClick={fetchPieces}>Try again</button>
        </div>
      ) : pieces.length === 0 ? (
        <div className="empty-state wardrobe-empty-state">
          <div className="empty-state-icon">◈</div>
          <div className="empty-state-title">{hasActiveFilters ? 'No matching pieces' : 'Your wardrobe is ready for its first piece'}</div>
          <div className="empty-state-text">
            {hasActiveFilters ? 'Try another search or clear the current filters.' : 'Add one piece, import existing pieces, or add several at once.'}
          </div>
          {hasActiveFilters && (
            <button className="btn-secondary wardrobe-clear-empty" onClick={clearWardrobeFilters}>
              Clear filters
            </button>
          )}
          {isUnfilteredWardrobe && demoWardrobe?.count === 0 && (
            <button className="btn-secondary wardrobe-demo-cta" onClick={loadDemoWardrobe} disabled={demoLoading}>
              {demoLoading ? 'Adding sample wardrobe…' : `Explore with ${demoWardrobe.available || ''} sample pieces`}
            </button>
          )}
        </div>
      ) : (
        <div className="piece-grid">
          {sortedPieces.map(p => (
            <PieceCard key={p.id} piece={p} onTap={setDetailPiece} onFavorite={handleFavorite} />
          ))}
        </div>
      )}

      {/* FAB */}
      <button className="fab wardrobe-mobile-fab" onClick={addPiece} aria-label="Add one piece">+</button>

      {/* Modals */}
      {showForm && <PieceForm piece={editPiece} onSave={handleSave} onCancel={() => { setShowForm(false); setEditPiece(null) }} />}
      {detailPiece && !showForm && <PieceDetail piece={detailPiece} onEdit={handleEdit} onDelete={handleDelete} onClose={() => setDetailPiece(null)} onSendToStylist={(piece) => { setDetailPiece(null); onSendToStylist(piece) }} />}
      {showBatch && <BatchAdd onDone={() => { setShowBatch(false); fetchPieces() }} />}
      {showTodo && (
        <div className="modal-overlay" onClick={() => setShowTodo(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '88dvh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-handle" />
            <div style={{ overflowY: 'auto', flex: 1, paddingBottom: 24 }}>
              <TodoList
                isModal={true}
                onClose={() => setShowTodo(false)}
                onPieceClick={async (pieceId) => {
                  const res = await fetch(`/api/pieces/${pieceId}`)
                  if (res.ok) {
                    const piece = await res.json()
                    setShowTodo(false)
                    setDetailPiece(piece)
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
