import { useCallback, useEffect, useState } from 'react'

export default function usePendingWardrobeTaskCount() {
  const [pendingCount, setPendingCount] = useState(0)

  const refreshPendingCount = useCallback(async () => {
    try {
      const res = await fetch('/api/todos')
      if (!res.ok) return
      const data = await res.json()
      setPendingCount(data.filter(todo => !todo.completed).length)
    } catch {}
  }, [])

  useEffect(() => {
    refreshPendingCount()
    window.addEventListener('todos-changed', refreshPendingCount)
    return () => window.removeEventListener('todos-changed', refreshPendingCount)
  }, [refreshPendingCount])

  return pendingCount
}
