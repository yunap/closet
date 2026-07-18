import { useState, useEffect } from 'react'

import {
  humanizeLabel,
  deriveBuilderTitle,
  getRelativeTimeLabel,
  groupThreadsByDate,
  clusterThreadsBySubject,
  getThreadDisplayTitle,
  getThreadOutcomeSummary,
  getThreadOriginalFirstMessage
} from '../utils/threadGrouping.js'

export {
  humanizeLabel,
  deriveBuilderTitle,
  getRelativeTimeLabel,
  groupThreadsByDate,
  clusterThreadsBySubject,
  getThreadDisplayTitle,
  getThreadOutcomeSummary,
  getThreadOriginalFirstMessage
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
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)

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

  const renderThreadRow = (t) => {
    const isActive = t.id === currentThreadId
    const isRenaming = renamingId === t.id
    const isConfirmingDelete = confirmDeleteId === t.id
    const timeLabel = getRelativeTimeLabel(t.updatedAt || t.updated_at)
    const displayTitle = getThreadDisplayTitle(t)
    const displaySummary = getThreadOutcomeSummary(t)
    const originalFirstMessage = getThreadOriginalFirstMessage(t)
    const menuOpen = openMenuId === t.id

    return (
      <div
        key={t.id}
        className={`thread-row ${isActive ? 'active' : ''}`}
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
              title={originalFirstMessage || displayTitle}
              onClick={() => {
                setOpenMenuId(null)
                onSelectThread(t.id)
                if (isMobileDrawer && onCloseDrawer) onCloseDrawer()
              }}
            >
              <span className="thread-row-title-line">
                <span className="thread-title-text">{displayTitle}</span>
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

  // If collapsed and not in mobile drawer mode
  if (collapsed && !isMobileDrawer) {
    return (
      <div className="thread-rail collapsed">
        <button
          className="rail-toggle-btn"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
        >
          ⟫
        </button>
        {!archivedView && (
          <button
            className="rail-new-btn-collapsed"
            onClick={onNewThread}
            title="New chat"
          >
            +
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
            + New Chat
          </button>
        )}
        {!isMobileDrawer && (
          <button
            className="rail-toggle-btn"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
          >
            ⟪
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
          onClick={() => setViewMode('recent')}
        >
          Recent
        </button>
        <button
          className={`view-toggle-btn ${viewMode === 'subject' ? 'active' : ''}`}
          onClick={() => setViewMode('subject')}
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
        {!archivedView && pinnedThreads.length > 0 && (
          <div className="rail-group pinned-threads-group">
            <div className="rail-group-title">Pinned</div>
            {pinnedThreads.map(renderThreadRow)}
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
            {subjectGroups.clusters.map(cluster => (
              <div key={`${cluster.type}_${cluster.id}`} className="rail-group subject-cluster-group">
                <div className="rail-group-title cluster-title">
                  {cluster.type === 'outfit' ? '👗' : '🧥'} {cluster.name}
                </div>
                <div className="cluster-rows">
                  {cluster.threads.map(renderThreadRow)}
                </div>
              </div>
            ))}

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
          {archivedView ? '← Back to Active Chats' : '📦 Archived Conversations'}
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
    <div className="thread-rail">
      {railContent}
    </div>
  )
}
