export function saveIdentityLearning(board, feedback) {
  const existing = JSON.parse(
    localStorage.getItem('identityCalibration') || '{}'
  )

  const next = {
    ...existing,
    feedbackHistory: [
      ...(existing.feedbackHistory || []),
      {
        boardId: board.id,
        feedback,
        timestamp: Date.now()
      }
    ]
  }

  localStorage.setItem(
    'identityCalibration',
    JSON.stringify(next)
  )
}
