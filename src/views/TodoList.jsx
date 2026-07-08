import { useState, useEffect } from 'react'

const TYPE_META = {
  repair:   { label: 'Repairs',  color: 'var(--repair)',   bg: 'var(--repair-bg)',   dot: '#B86B2A', icon: '⚠' },
  donate:   { label: 'Donate?',  color: 'var(--donate)',   bg: 'var(--donate-bg)',   dot: '#6B8C6B', icon: '◌' },
  shopping: { label: 'Shopping', color: 'var(--shopping)', bg: 'var(--shopping-bg)', dot: '#5A6E8A', icon: '◎' },
  metadata: { label: 'Tagging gaps', color: 'var(--metadata, #8A6D3B)', bg: 'var(--metadata-bg, #F5EFE3)', dot: '#8A6D3B', icon: '◆' },
}

export default function TodoList({ isModal, onClose, onPieceClick }) {
  const [todos, setTodos]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)
  const [newType, setNewType]   = useState('shopping')
  const [newText, setNewText]   = useState('')
  const [saving, setSaving]     = useState(false)

  const fetchTodos = async () => {
    const res = await fetch('/api/todos')
    const data = await res.json()
    setTodos(data)
    setLoading(false)
    window.dispatchEvent(new CustomEvent('todos-changed'))
  }
  useEffect(() => { fetchTodos() }, [])

  const toggle = async (id) => {
    await fetch(`/api/todos/${id}/toggle`, { method: 'PATCH' })
    fetchTodos()
  }

  const remove = async (id) => {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    fetchTodos()
  }

  const add = async () => {
    if (!newText.trim()) return
    setSaving(true)
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: newType, description: newText.trim() })
    })
    setNewText('')
    setShowAdd(false)
    setSaving(false)
    fetchTodos()
  }

  const clearOrphaned = async () => {
    const res = await fetch('/api/todos/clear-orphaned', { method: 'POST' })
    if (res.ok) {
      fetchTodos()
    }
  }

  const grouped = ['repair', 'donate', 'shopping', 'metadata'].reduce((acc, type) => {
    acc[type] = todos.filter(t => t.type === type)
    return acc
  }, {})

  const groupMetadataByField = (metadataItems) => {
    return metadataItems.reduce((acc, item) => {
      const f = item.field || 'other'
      if (!acc[f]) acc[f] = []
      acc[f].push(item)
      return acc
    }, {})
  }

  const pending = todos.filter(t => !t.completed).length

  const renderTodoItem = (t, meta) => {
    const isActivePiece = t.linked_piece_id && t.piece && t.piece.status === 'active'
    return (
      <div key={t.id} className="todo-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button
            className={`todo-check ${t.completed ? 'done' : ''}`}
            style={{ borderColor: t.completed ? 'var(--accent)' : meta.dot }}
            onClick={() => toggle(t.id)}
          >
            {t.completed ? '✓' : ''}
          </button>
          <span className={`todo-text ${t.completed ? 'done' : ''}`}>{t.description}</span>
          <button className="todo-delete" onClick={() => remove(t.id)}>✕</button>
        </div>
        {t.type === 'metadata' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 32, marginTop: -2 }}>
            {isActivePiece ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {t.piece.photo ? (
                  <img
                    src={`/uploads/${t.piece.photo}`}
                    alt={t.piece.name}
                    className="todo-thumbnail"
                    onClick={() => onPieceClick && onPieceClick(t.linked_piece_id)}
                  />
                ) : (
                  <div
                    className="todo-thumbnail placeholder"
                    onClick={() => onPieceClick && onPieceClick(t.linked_piece_id)}
                  >
                    {t.piece.name?.charAt(0)}
                  </div>
                )}
                <button
                  className="todo-link"
                  onClick={() => onPieceClick && onPieceClick(t.linked_piece_id)}
                >
                  {t.piece.name}
                </button>
              </div>
            ) : (
              <span className="todo-orphaned-label">
                piece no longer in wardrobe
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="view-header" style={isModal ? { position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)' } : undefined}>
        <div className="view-header-top">
          <div>
            <div className="view-title">To-Do</div>
            <div className="view-subtitle">{pending} pending · {todos.length - pending} done</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="chip active" onClick={() => setShowAdd(s => !s)}>+ Add</button>
            {isModal && (
              <button className="modal-close" onClick={onClose} style={{ width: 28, height: 28, margin: 0 }}>✕</button>
            )}
          </div>
        </div>

        {showAdd && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(TYPE_META).map(([k, v]) => {
                if (k === 'metadata') return null // Do not allow manual addition of metadata todos
                return (
                  <button
                    key={k}
                    className={`chip-toggle ${newType === k ? 'active' : ''}`}
                    onClick={() => setNewType(k)}
                    style={{ flex: 1, textAlign: 'center' }}
                  >
                    {v.icon} {v.label}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                style={{ flex: 1 }}
                placeholder="Describe the task…"
                value={newText}
                onChange={e => setNewText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && add()}
                autoFocus
              />
              <button className="btn-primary" style={{ padding: '11px 16px', flexShrink: 0 }} onClick={add} disabled={saving || !newText.trim()}>
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : todos.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">○</div>
          <div className="empty-state-title">All clear</div>
          <div className="empty-state-text">No pending tasks. Add repairs, donation candidates, or shopping items.</div>
        </div>
      ) : (
        <div style={{ paddingTop: 16 }}>
          {Object.entries(grouped).map(([type, items]) => {
            if (items.length === 0) return null
            const meta = TYPE_META[type]

            if (type === 'metadata') {
              const subGrouped = groupMetadataByField(items)
              const hasOrphaned = items.some(t => !t.linked_piece_id || !t.piece || t.piece.status !== 'active')

              return (
                <div key={type} className="todo-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 10px' }}>
                    <div className="todo-section-label" style={{ color: meta.color, padding: 0, margin: 0 }}>
                      {meta.icon} {meta.label}
                    </div>
                    {hasOrphaned && (
                      <button
                        className="chip text-danger"
                        style={{ fontSize: '11px', padding: '2px 8px', borderColor: 'var(--danger)', color: 'var(--danger)', background: 'var(--danger-bg)' }}
                        onClick={clearOrphaned}
                      >
                        Clear Orphaned
                      </button>
                    )}
                  </div>

                  {Object.entries(subGrouped).map(([field, fieldItems]) => {
                    const displayField = field.replace(/[._]+/g, ' ')
                    return (
                      <div key={field} className="todo-field-group" style={{ marginBottom: 16 }}>
                        <div className="todo-field-header">
                          {displayField} ({fieldItems.length})
                        </div>
                        {fieldItems.map(t => renderTodoItem(t, meta))}
                      </div>
                    )
                  })}
                </div>
              )
            }

            return (
              <div key={type} className="todo-section">
                <div className="todo-section-label" style={{ color: meta.color }}>
                  {meta.icon} {meta.label}
                </div>
                {items.map(t => renderTodoItem(t, meta))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
