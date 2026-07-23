import { useCallback, useEffect, useState } from 'react'

let sharedPendingCount = 0
let latestRequestId = 0
const pendingCountListeners = new Set()

const publishPendingCount = (count) => {
  sharedPendingCount = count
  pendingCountListeners.forEach(listener => listener(count))
}

export default function usePendingWardrobeTaskCount() {
  const [pendingCount, setPendingCount] = useState(sharedPendingCount)

  const refreshPendingCount = useCallback(async () => {
    const requestId = ++latestRequestId
    try {
      const res = await fetch('/api/todos')
      if (!res.ok) return
      const data = await res.json()
      if (requestId !== latestRequestId || !Array.isArray(data)) return
      publishPendingCount(data.filter(todo => !todo.completed).length)
    } catch {}
  }, [])

  useEffect(() => {
    pendingCountListeners.add(setPendingCount)
    setPendingCount(sharedPendingCount)
    refreshPendingCount()
    window.addEventListener('todos-changed', refreshPendingCount)
    return () => {
      pendingCountListeners.delete(setPendingCount)
      window.removeEventListener('todos-changed', refreshPendingCount)
    }
  }, [refreshPendingCount])

  return pendingCount
}
