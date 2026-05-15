export function buildScopedFeedback({
  feedbackType,
  pieceId,
  rendererMode = 'identity'
}) {
  const rendererFeedback = [
    'too_old',
    'catalog_drift',
    'teacher_drift',
    'identity_loss'
  ]

  if (rendererFeedback.includes(feedbackType)) {
    return {
      domain: 'renderer',
      scopeType: 'renderer',
      scopeId: rendererMode
    }
  }

  return {
    domain: 'styling',
    scopeType: 'piece',
    scopeId: pieceId
  }
}
