import { useState, useEffect, useRef } from 'react'

import {
  humanizeLabel,
  deriveBuilderTitle,
  getRelativeTimeLabel,
  groupThreadsByDate,
  clusterThreadsBySubject,
  getThreadDisplayTitle,
  getThreadOutcomeSummary,
  getThreadOriginalFirstMessage,
  getThreadSubjectChildTitle
} from '../utils/threadGrouping.js'
import { prefetchChatThread } from '../utils/chatThreadCache.js'

const SUBJECT_THUMB_PRELOAD_COUNT = 12

export {
  humanizeLabel,
  deriveBuilderTitle,
  getRelativeTimeLabel,
  groupThreadsByDate,
  clusterThreadsBySubject,
  getThreadDisplayTitle,
  getThreadOutcomeSummary,
  getThreadOriginalFirstMessage,
  getThreadSubjectChildTitle
}

export default function ThreadRail({
  threads = [],
  currentThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  onRenameThread,
  isMobileDrawer = false,
  onCloseDrawer,
  archivedView = false,
  onToggleArchivedView,
  onTogglePinThread,
  onToggleArchiveThread
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('stylist_rail_collapsed') === 'true'
    } catch {
      return false
    }
  })
  
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('stylist_rail_view_mode') || 'recent'
    } catch {
      return 'recent'
    }
  })
  
  const [search, setSearch] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const [olderBuilderExpanded, setOlderBuilderExpanded] = useState(false)
  const [pinnedShelfExpanded, setPinnedShelfExpanded] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [openSubjectGroups, setOpenSubjectGroups] = useState({})
  const threadPrefetchTimer = useRef(null)

  useEffect(() => {
    if (!isMobileDrawer) {
      try {
        localStorage.setItem('stylist_rail_collapsed', String(collapsed))
      } catch {}
    }
  }, [collapsed, isMobileDrawer])

  useEffect(() => {
    try {
      localStorage.setItem('stylist_rail_view_mode', viewMode)
    } catch {}
  }, [viewMode])

  useEffect(() => () => clearTimeout(threadPrefetchTimer.current), [])

  const queueThreadPrefetch = (threadId) => {
    clearTimeout(threadPrefetchTimer.current)
    threadPrefetchTimer.current = setTimeout(() => prefetchChatThread(threadId), 120)
  }

  const cancelThreadPrefetch = () => clearTimeout(threadPrefetchTimer.current)

  useEffect(() => {
    if (typeof Image === 'undefined' || !threads.length) return
    const preloadUrls = clusterThreadsBySubject(threads.filter(thread => !thread.pinned))
      .clusters
      .slice(0, SUBJECT_THUMB_PRELOAD_COUNT)
      .map(cluster => cluster.photo)
      .filter(Boolean)

    preloadUrls.forEach(src => {
      const image = new Image()
      image.decoding = 'async'
      image.src = src
    })
  }, [threads])

  const handleRenameSubmit = (id) => {
    if (renamingTitle.trim()) {
      onRenameThread(id, renamingTitle.trim())
    }
    setRenamingId(null)
    setOpenMenuId(null)
  }

  const handleDeleteClick = (e, t) => {
    e.stopPropagation()
    setOpenMenuId(null)
    const messageCount = t.message_count ?? t.messages?.length ?? 0
    if (messageCount > 2) {
      setConfirmDeleteId(t.id)
    } else {
      onDeleteThread(t.id)
    }
  }

  // Filter threads by search term
  const filteredThreads = search.trim()
    ? threads.filter(t => {
      const query = search.toLowerCase().trim()
      return [
        t.title,
        getThreadDisplayTitle(t),
        getThreadOutcomeSummary(t),
        getThreadOriginalFirstMessage(t)
      ].some(value => String(value || '').toLowerCase().includes(query))
    })
    : threads

  // Separate pinned vs regular threads
  // (Note: archived threads cannot be pinned, so pinnedThreads will be empty in archivedView)
  const pinnedThreads = filteredThreads.filter(t => t.pinned)
  const unpinnedThreads = filteredThreads.filter(t => !t.pinned)

  // Compute groupings
  const groups = groupThreadsByDate(unpinnedThreads, archivedView)
  const subjectGroups = clusterThreadsBySubject(unpinnedThreads)
  const pinnedShelfOpen = pinnedShelfExpanded

  const formatChildTitleTime = (timestamp) => {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
    return `${day} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }

  const getSubjectChildRows = (cluster) => {
    const rows = cluster.threads.map(thread => ({
      thread,
      title: getThreadSubjectChildTitle(thread, cluster)
    }))
    const titleCounts = rows.reduce((counts, row) => {
      const key = row.title.toLowerCase()
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {})

    return rows.map(row => {
      if (titleCounts[row.title.toLowerCase()] <= 1) return row
      const time = formatChildTitleTime(row.thread.updatedAt || row.thread.updated_at)
      return {
        ...row,
        title: time ? `${row.title} · ${time}` : row.title
      }
    })
  }

  const renderThreadRow = (t, options = {}) => {
    const { subject = null, childTitle = null } = options
    const isActive = t.id === currentThreadId
    const isRenaming = renamingId === t.id
    const isConfirmingDelete = confirmDeleteId === t.id
    const timeLabel = getRelativeTimeLabel(t.updatedAt || t.updated_at)
    const displayTitle = childTitle || (subject ? getThreadSubjectChildTitle(t, subject) : getThreadDisplayTitle(t))
    const displaySummary = getThreadOutcomeSummary(t)
    const originalFirstMessage = getThreadOriginalFirstMessage(t)
    const menuOpen = openMenuId === t.id
    const fullLabel = `${displayTitle}${displaySummary ? ` · ${displaySummary}` : ''}`

    return (
      <div
        key={t.id}
        className={`thread-row ${subject ? 'subject-child-row' : ''} ${isActive ? 'active' : ''}`}
        role="listitem"
      >
        {isRenaming ? (
          <div className="thread-rename-form" onClick={e => e.stopPropagation()}>
            <input
              type="text"
              className="thread-rename-input"
              value={renamingTitle}
              onChange={e => setRenamingTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRenameSubmit(t.id)
                else if (e.key === 'Escape') setRenamingId(null)
              }}
              autoFocus
            />
            <button className="thread-rename-save" onClick={() => handleRenameSubmit(t.id)}>✓</button>
            <button className="thread-rename-cancel" onClick={() => setRenamingId(null)}>✕</button>
          </div>
        ) : isConfirmingDelete ? (
          <div className="thread-delete-confirm" onClick={e => e.stopPropagation()}>
            <span className="confirm-text">Delete?</span>
            <button
              className="confirm-yes"
              onClick={() => {
                onDeleteThread(t.id)
                setConfirmDeleteId(null)
              }}
            >
              Yes
            </button>
            <button className="confirm-no" onClick={() => setConfirmDeleteId(null)}>No</button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="thread-row-main"
              aria-current={isActive ? 'page' : undefined}
              aria-label={`Open chat: ${fullLabel}`}
              title={originalFirstMessage || fullLabel}
              onMouseEnter={() => queueThreadPrefetch(t.id)}
              onMouseLeave={cancelThreadPrefetch}
              onFocus={() => prefetchChatThread(t.id)}
              onClick={() => {
                setOpenMenuId(null)
                onSelectThread(t.id)
                if (isMobileDrawer && onCloseDrawer) onCloseDrawer()
              }}
            >
              <span className="thread-row-title-line">
                <span className="thread-title-text" title={displayTitle}>{displayTitle}</span>
                <span className="thread-time">{timeLabel}</span>
              </span>
              <span className="thread-summary-text">{displaySummary}</span>
            </button>

            <div className="thread-actions">
              <button
                type="button"
                className="thread-overflow-btn"
                aria-label={`More options for ${displayTitle}`}
                aria-expanded={menuOpen}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenMenuId(menuOpen ? null : t.id)
                }}
              >
                …
              </button>
              {menuOpen && (
                <div className="thread-overflow-menu" onClick={e => e.stopPropagation()}>
                  {!archivedView && (
                  <button
                    className={`thread-menu-item pin ${t.pinned ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenMenuId(null)
                      onTogglePinThread(t.id)
                    }}
                  >
                    {t.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  )}
                  <button
                    className="thread-menu-item rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenMenuId(null)
                      setRenamingId(t.id)
                      setRenamingTitle(t.title || '')
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className={`thread-menu-item archive ${t.archived ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenMenuId(null)
                      onToggleArchiveThread(t.id)
                    }}
                  >
                    {t.archived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    className="thread-menu-item delete"
                    onClick={(e) => handleDeleteClick(e, t)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  const toggleSubjectGroup = (key) => {
    setOpenSubjectGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderSubjectCluster = (cluster, clusterIndex) => {
    const key = `${cluster.type}_${cluster.id}`
    const isActiveGroup = cluster.threads.some(t => t.id === currentThreadId)
    const isOpen = isActiveGroup || Boolean(openSubjectGroups[key])
    const countLabel = `${cluster.threads.length} ${cluster.threads.length === 1 ? 'chat' : 'chats'}`
    const childRows = getSubjectChildRows(cluster)
    const prioritizeThumbnail = clusterIndex < SUBJECT_THUMB_PRELOAD_COUNT

    return (
      <div
        key={key}
        className={`rail-group subject-cluster-group ${isOpen ? 'open' : 'collapsed'} ${isActiveGroup ? 'active-subject' : ''}`}
      >
        <button
          type="button"
          className="subject-cluster-header"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${cluster.name}, ${cluster.typeLabel}, ${countLabel}`}
          title={cluster.name}
          onClick={() => toggleSubjectGroup(key)}
        >
          <span className="subject-disclosure" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="m6 4 4 4-4 4" />
            </svg>
          </span>
          <span className="subject-thumb" aria-hidden="true">
            {cluster.photo ? (
              <img
                src={cluster.photo}
                alt=""
                loading={prioritizeThumbnail ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={prioritizeThumbnail ? 'high' : 'auto'}
              />
            ) : (
              <span className="subject-thumb-fallback">{cluster.icon}</span>
            )}
          </span>
          <span className="subject-header-text">
            <span className="subject-name" title={cluster.name}>{cluster.name}</span>
            <span className="subject-meta">
              <span className="subject-type-label">{cluster.typeLabel}</span>
              <span className="subject-count-label">{countLabel}</span>
            </span>
          </span>
        </button>
        {isOpen && (
          <div className="cluster-rows" role="list">
            {childRows.map(({ thread, title }) => renderThreadRow(thread, { subject: cluster, childTitle: title }))}
          </div>
        )}
      </div>
    )
  }

  // If collapsed and not in mobile drawer mode
  if (collapsed && !isMobileDrawer) {
    return (
      <div className="thread-rail collapsed">
        <button
          className="rail-toggle-btn"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          aria-label="Expand conversation history"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M5.5 3.25 10.25 8 5.5 12.75" />
          </svg>
        </button>
        {!archivedView && (
          <button
            className="rail-new-btn-collapsed"
            onClick={onNewThread}
            title="New chat"
            aria-label="New chat"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4.25 11.75 5 9l6.1-6.1a1.35 1.35 0 0 1 1.9 1.9L6.9 10.9l-2.65.85Z" />
              <path d="M9.85 4.15 11.75 6" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  const showSearch = threads.length > 15

  const railContent = (
    <>
      <div className="rail-header">
        {archivedView ? (
          <div className="rail-archived-title">Archived Chats</div>
        ) : (
          <button className="rail-new-btn" onClick={onNewThread}>
            <span className="rail-new-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M4.25 11.75 5 9l6.1-6.1a1.35 1.35 0 0 1 1.9 1.9L6.9 10.9l-2.65.85Z" />
                <path d="M9.85 4.15 11.75 6" />
              </svg>
            </span>
            <span>New chat</span>
          </button>
        )}
        {!isMobileDrawer && (
          <button
            className="rail-toggle-btn"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            aria-label="Collapse conversation history"
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m10.5 3.25-4.75 4.75 4.75 4.75" />
            </svg>
          </button>
        )}
        {isMobileDrawer && onCloseDrawer && (
          <button className="rail-close-drawer-btn" onClick={onCloseDrawer} title="Close history">
            ✕
          </button>
        )}
      </div>

      <div className="rail-view-toggle">
        <button
          className={`view-toggle-btn ${viewMode === 'recent' ? 'active' : ''}`}
          onClick={() => {
            setOpenMenuId(null)
            setViewMode('recent')
          }}
        >
          Recent
        </button>
        <button
          className={`view-toggle-btn ${viewMode === 'subject' ? 'active' : ''}`}
          onClick={() => {
            setOpenMenuId(null)
            setViewMode('subject')
          }}
        >
          By outfit/piece
        </button>
      </div>

      {showSearch && (
        <div className="rail-search-container">
          <input
            type="text"
            className="rail-search-input"
            placeholder="Search chats..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="rail-search-clear" onClick={() => setSearch('')}>
              ✕
            </button>
          )}
        </div>
      )}

      <div className="rail-scroll-container">
        {/* Pinned section at the very top (only when not in archivedView) */}
        {!archivedView && pinnedThreads.length > 0 && viewMode === 'recent' && (
          <div className="rail-group pinned-threads-group">
            <div className="rail-group-title">Pinned</div>
            {pinnedThreads.map(renderThreadRow)}
          </div>
        )}

        {!archivedView && pinnedThreads.length > 0 && viewMode === 'subject' && (
          <div className={`rail-group pinned-subject-shelf ${pinnedShelfOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="pinned-shelf-toggle"
              aria-expanded={pinnedShelfOpen}
              onClick={() => setPinnedShelfExpanded(current => !current)}
            >
              <span className="pinned-shelf-icon" aria-hidden="true">⌑</span>
              <span>Pinned chats</span>
              <span className="pinned-shelf-count">{pinnedThreads.length}</span>
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
            </button>
            {pinnedShelfOpen && (
              <div className="pinned-shelf-rows" role="list">
                {pinnedThreads.map(renderThreadRow)}
              </div>
            )}
          </div>
        )}

        {viewMode === 'recent' ? (
          <>
            {groups.today.length > 0 && (
              <div className="rail-group">
                <div className="rail-group-title">Today</div>
                {groups.today.map(renderThreadRow)}
              </div>
            )}

            {groups.yesterday.length > 0 && (
              <div className="rail-group">
                <div className="rail-group-title">Yesterday</div>
                {groups.yesterday.map(renderThreadRow)}
              </div>
            )}

            {groups.thisWeek.length > 0 && (
              <div className="rail-group">
                <div className="rail-group-title">This Week</div>
                {groups.thisWeek.map(renderThreadRow)}
              </div>
            )}

            {groups.earlier.length > 0 && (
              <div className="rail-group">
                <div className="rail-group-title">Earlier</div>
                {groups.earlier.map(renderThreadRow)}
              </div>
            )}

            {groups.olderBuilder.length > 0 && (
              <div className="rail-group older-builder-group">
                <button
                  className="older-builder-toggle-header"
                  onClick={() => setOlderBuilderExpanded(!olderBuilderExpanded)}
                >
                  <span>Older quick generations ({groups.olderBuilder.length})</span>
                  <span>{olderBuilderExpanded ? '▾' : '▸'}</span>
                </button>
                {olderBuilderExpanded && (
                  <div className="older-builder-rows">
                    {groups.olderBuilder.map(renderThreadRow)}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* By Outfit/Piece Subject Clusters */}
            {subjectGroups.clusters.map(renderSubjectCluster)}

            {/* Other Conversations */}
            {subjectGroups.otherConversations.length > 0 && (
              <div className="rail-group other-conversations-group">
                <div className="rail-group-title">Other conversations</div>
                {subjectGroups.otherConversations.map(renderThreadRow)}
              </div>
            )}
          </>
        )}

        {filteredThreads.length === 0 && (
          <div className="rail-empty-message">No threads found</div>
        )}
      </div>

      <div className="rail-footer">
        <button
          className={`rail-archived-toggle-btn ${archivedView ? 'active' : ''}`}
          onClick={() => onToggleArchivedView(!archivedView)}
        >
          <span className="rail-archived-icon" aria-hidden="true">
            {archivedView ? (
              <svg viewBox="0 0 16 16" fill="none"><path d="m9.75 4-4 4 4 4" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3 5.25h10v7.25H3z" />
                <path d="M2.5 3h11v2.25h-11zM6.25 8h3.5" />
              </svg>
            )}
          </span>
          <span className="rail-archived-label">
            {archivedView ? 'Back to conversations' : 'Archived conversations'}
          </span>
          {!archivedView && (
            <svg className="rail-archived-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m6 4 4 4-4 4" />
            </svg>
          )}
        </button>
      </div>
    </>
  )

  if (isMobileDrawer) {
    return (
      <div className="mobile-rail-drawer-overlay" onClick={onCloseDrawer}>
        <div className="mobile-rail-drawer" onClick={e => e.stopPropagation()}>
          {railContent}
        </div>
      </div>
    )
  }

  return (
    <div className={`thread-rail view-${viewMode}`}>
      {railContent}
    </div>
  )
}
