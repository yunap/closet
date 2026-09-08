export function classifyChatTurn(text, { hasThreadMemory = false } = {}) {
  const q = String(text || '').trim().toLowerCase()
  if (!q || !hasThreadMemory) return 'new_request'
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
