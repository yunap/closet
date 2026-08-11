export const OWNER_CONSTRAINT_SELECTOR_TYPES = ['piece_ids', 'category', 'material']
export const OWNER_CONSTRAINT_CONTEXT_DIMENSIONS = ['occasion', 'season', 'activity', 'weather']
export const OWNER_CONSTRAINT_WEATHER_VALUES = ['hot', 'cold', 'rainy', 'wet_exposure']

const normalized = value => String(value || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
const uniqueText = values => [...new Set((Array.isArray(values) ? values : [values]).map(normalized).filter(Boolean))]

export function validateOwnerConstraintInput(input = {}) {
  if (input.confirmOwnerConstraint !== true) return { error: 'Explicit owner confirmation is required.' }
  const selectorType = String(input.selectorType || '')
  const contextDimension = String(input.contextDimension || '')
  if (!OWNER_CONSTRAINT_SELECTOR_TYPES.includes(selectorType)) return { error: `Unsupported selector type: ${selectorType}` }
  if (!OWNER_CONSTRAINT_CONTEXT_DIMENSIONS.includes(contextDimension)) return { error: `Unsupported context dimension: ${contextDimension}` }
  const selectorValues = selectorType === 'piece_ids'
    ? [...new Set((input.selectorValues || []).map(Number).filter(id => Number.isInteger(id) && id > 0))]
    : uniqueText(input.selectorValues)
  const contextValues = uniqueText(input.contextValues)
  if (!selectorValues.length || !contextValues.length) return { error: 'Constraint selector and context values are required.' }
  if (contextDimension === 'weather' && contextValues.some(value => !OWNER_CONSTRAINT_WEATHER_VALUES.includes(value.replaceAll(' ', '_')))) {
    return { error: 'Unsupported weather constraint value.' }
  }
  return {
    value: {
      selectorType,
      selectorValues,
      contextDimension,
      contextValues: contextDimension === 'weather' ? contextValues.map(value => value.replaceAll(' ', '_')) : contextValues,
      sourceFeedbackId: Number(input.sourceFeedbackId) || null,
      reason: String(input.reason || '').trim().slice(0, 500),
    },
  }
}

export function createOwnerConstraint(db, input = {}) {
  const validated = validateOwnerConstraintInput(input)
  if (validated.error) return { error: validated.error, statusCode: 400 }
  const value = validated.value
  if (value.sourceFeedbackId && !db.prepare('SELECT id FROM stylist_feedback WHERE id = ?').get(value.sourceFeedbackId)) {
    return { error: 'Source owner rule was not found.', statusCode: 404 }
  }
  if (value.selectorType === 'piece_ids') {
    const placeholders = value.selectorValues.map(() => '?').join(',')
    const found = db.prepare(`SELECT id FROM pieces WHERE id IN (${placeholders})`).all(...value.selectorValues)
    if (found.length !== value.selectorValues.length) return { error: 'One or more selected garments were not found.', statusCode: 400 }
  }
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO owner_constraints
        (source_feedback_id, status, selector_type, selector_values, context_dimension, context_values, reason)
      VALUES (?, 'active', ?, ?, ?, ?, ?)
    `).run(
      value.sourceFeedbackId,
      value.selectorType,
      JSON.stringify(value.selectorValues),
      value.contextDimension,
      JSON.stringify(value.contextValues),
      value.reason,
    )
    if (value.sourceFeedbackId) db.prepare('UPDATE stylist_feedback SET archived = 1 WHERE id = ?').run(value.sourceFeedbackId)
    return { constraint: db.prepare('SELECT * FROM owner_constraints WHERE id = ?').get(result.lastInsertRowid) }
  })()
}

export function setOwnerConstraintStatus(db, id, status) {
  if (!['active', 'retired'].includes(status)) return { error: `Invalid constraint status: ${status}`, statusCode: 400 }
  const result = db.prepare('UPDATE owner_constraints SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, Number(id))
  if (!result.changes) return { error: 'Owner constraint not found.', statusCode: 404 }
  return { constraint: db.prepare('SELECT * FROM owner_constraints WHERE id = ?').get(Number(id)) }
}

export function parseOwnerConstraintRow(row = {}) {
  const parse = value => { try { return JSON.parse(value || '[]') } catch { return [] } }
  return { ...row, selector_values: parse(row.selector_values), context_values: parse(row.context_values) }
}

export function ownerConstraintApplies(row, pieceFacts = {}, requestContext = {}) {
  const constraint = Array.isArray(row?.selector_values) ? row : parseOwnerConstraintRow(row)
  const selectorMatches = constraint.selector_type === 'piece_ids'
    ? constraint.selector_values.map(Number).includes(Number(pieceFacts.id))
    : constraint.selector_type === 'category'
      ? constraint.selector_values.includes(normalized(pieceFacts.category))
      : constraint.selector_type === 'material'
        ? constraint.selector_values.some(value => (pieceFacts.materials || []).map(normalized).includes(value))
        : false
  if (!selectorMatches) return false
  const dimension = constraint.context_dimension
  if (dimension === 'weather') {
    const flags = requestContext.weather || {}
    return constraint.context_values.some(value => Boolean(flags[value]))
  }
  const requested = normalized(requestContext[dimension])
  if (!requested) return false
  return constraint.context_values.some(value => requested === value || requested.split(/[,;/|]+/).map(normalized).includes(value))
}
