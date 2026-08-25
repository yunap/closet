import { resolveActivityProfile, resolveComfortFootwearConstraint } from './footwear-comfort.js'
import { resolveOccasionProfile } from './occasions.js'
import { weatherProfileFromContext } from './rules.js'
import { normalizeActivity, normalizeOccasion } from './stylingIntent.js'
import { getCurrentWeatherProfile } from './weather.js'

const SOURCE_ORDER = [
  ['explicit_request', 'explicitRequest'],
  ['action_artifact', 'actionArtifact'],
  ['established_state', 'establishedState'],
  ['inference', 'inferred'],
]

const hasText = value => String(value ?? '').trim() !== ''
const text = value => String(value ?? '').trim()
const identity = value => value
const normalizeSeason = value => text(value) || 'current season'
const normalizeRequestText = value => text(value)
const normalizeDate = value => value || null

function valueForField(source = {}, field = '') {
  if (field === 'requestText') return source.requestText ?? source.request ?? source.question
  if (field === 'date') return source.date ?? source.currentDate
  if (field === 'weatherProfile') return source.weatherProfile ?? source.resolvedWeatherProfile
  if (field === 'statedWeather') return source.statedWeather ?? source.weather
  return source[field]
}

function isPresent(value, field = '') {
  if (field === 'weatherProfile') return Boolean(value && typeof value === 'object')
  if (field === 'date') return value !== undefined && value !== null && value !== ''
  return hasText(value)
}

function chooseField({ evidence, field, normalize = identity, fallback, conflict = true }) {
  const candidates = SOURCE_ORDER.map(([source, key]) => ({
    source,
    raw: valueForField(evidence[key] || {}, field),
  })).filter(candidate => isPresent(candidate.raw, field))

  const chosen = candidates[0] || { source: 'default', raw: fallback }
  const value = normalize(chosen.raw)
  const ignored = conflict
    ? candidates.slice(1).map(candidate => ({
        source: candidate.source,
        value: normalize(candidate.raw),
      })).filter(candidate => JSON.stringify(candidate.value) !== JSON.stringify(value))
    : []

  return {
    value,
    provenance: {
      source: chosen.source,
      raw: chosen.raw ?? null,
    },
    conflict: ignored.length
      ? { field, chosenSource: chosen.source, chosenValue: value, ignored }
      : null,
  }
}

function weatherSummary(profile = {}) {
  const high = profile.highF ?? profile.high_f
  const low = profile.lowF ?? profile.low_f
  return {
    weatherSource: profile.weatherSource || profile.source || 'unknown',
    isHot: Boolean(profile.isHot ?? profile.is_hot),
    isCold: Boolean(profile.isCold ?? profile.is_cold),
    isExtremeHeat: Boolean(profile.isExtremeHeat ?? profile.is_extreme_heat),
    ...(high !== null && high !== '' && Number.isFinite(Number(high))
      ? { highF: Number(high) }
      : {}),
    ...(low !== null && low !== '' && Number.isFinite(Number(low))
      ? { lowF: Number(low) }
      : {}),
  }
}

function profileCandidate(evidence, sourceKey) {
  const profile = valueForField(evidence[sourceKey] || {}, 'weatherProfile')
  return profile && typeof profile === 'object' ? profile : null
}

function statedWeatherCandidate(evidence) {
  for (const [source, key] of SOURCE_ORDER) {
    const raw = valueForField(evidence[key] || {}, 'statedWeather')
    if (hasText(raw)) return { source, value: text(raw) }
  }
  return null
}

function isCurrentSeason(value = '') {
  return ['current season', 'current'].includes(text(value).toLowerCase())
}

function heuristicWeather({ mood, requestText, season, date }) {
  return {
    ...weatherProfileFromContext({
      mood: [mood, requestText].filter(Boolean).join(' '),
      season,
      currentDate: date || new Date(),
    }),
    weatherSource: 'heuristic',
  }
}

function statedWeatherProfile({ statedWeather, mood, requestText, date }) {
  return {
    ...weatherProfileFromContext({
      mood: [mood, requestText].filter(Boolean).join(' '),
      season: statedWeather,
      currentDate: date || new Date(),
    }),
    weatherSource: 'stated',
    statedWeather,
  }
}

async function resolveWeather({
  evidence,
  season,
  seasonProvenance,
  mood,
  requestText,
  location,
  date,
  allowLiveWeather,
  weatherResolver,
}) {
  const stated = statedWeatherCandidate(evidence)
  if (stated) {
    return {
      profile: statedWeatherProfile({ statedWeather: stated.value, mood, requestText, date }),
      provenance: { source: `${stated.source}.stated_weather` },
    }
  }

  const explicitProfile = profileCandidate(evidence, 'explicitRequest')
  if (explicitProfile) {
    return {
      profile: explicitProfile,
      provenance: { source: 'explicit_request.weather_profile' },
    }
  }

  const actionProfile = profileCandidate(evidence, 'actionArtifact')
  const stateProfile = profileCandidate(evidence, 'establishedState')
  const inferredProfile = profileCandidate(evidence, 'inferred')
  const savedSnapshot = actionProfile || stateProfile || inferredProfile
  const savedSnapshotSource = actionProfile
    ? 'action_artifact.weather_profile'
    : stateProfile
      ? 'established_state.weather_profile'
      : inferredProfile
        ? 'inference.weather_profile'
        : ''

  if (allowLiveWeather && isCurrentSeason(season) && hasText(location)) {
    const live = await weatherResolver({
      date: date || new Date(),
      location,
      mood: [mood, requestText].filter(Boolean).join(' '),
      season,
    })
    if (live?.weatherSource === 'live') {
      return { profile: live, provenance: { source: 'live_weather' } }
    }
    if (live?.weatherSource === 'unavailable' && savedSnapshot) {
      return {
        profile: savedSnapshot,
        provenance: {
          source: savedSnapshotSource,
          fallbackFrom: 'live_weather_unavailable',
        },
      }
    }
    if (live && typeof live === 'object') {
      return {
        profile: live,
        provenance: { source: live.weatherSource === 'unavailable' ? 'live_weather_unavailable' : 'live_weather' },
      }
    }
  }

  // A current explicit seasonal brief is a new instruction. It may reuse an explicitly supplied
  // current weather profile above, but it must not silently inherit a derived snapshot from an
  // older card or thread.
  if (savedSnapshot && seasonProvenance.source !== 'explicit_request') {
    return { profile: savedSnapshot, provenance: { source: savedSnapshotSource } }
  }

  return {
    profile: heuristicWeather({ mood, requestText, season, date }),
    provenance: { source: 'heuristic' },
  }
}

export function createStylingContextResolver({ weatherResolver = getCurrentWeatherProfile } = {}) {
  return async function resolveStylingContextWithEvidence({
    explicitRequest = {},
    actionArtifact = {},
    establishedState = {},
    inferred = {},
    policy = {},
  } = {}) {
    const evidence = {
      explicitRequest: { ...explicitRequest },
      actionArtifact: { ...actionArtifact },
      establishedState: { ...establishedState },
      inferred: { ...inferred },
    }
    // Established activity belongs to its established occasion. A freeform action that explicitly
    // switches occasion without declaring a new activity must not drag an older hiking/walking
    // constraint into dinner. This is field-specific precedence owned here, not a tool-local reset.
    const explicitOccasion = valueForField(evidence.explicitRequest, 'occasion')
    const explicitActivity = valueForField(evidence.explicitRequest, 'activity')
    const establishedOccasion = valueForField(evidence.establishedState, 'occasion')
    if (policy.mode === 'freeform_action' && hasText(explicitOccasion) && !hasText(explicitActivity) &&
        hasText(establishedOccasion) && normalizeOccasion(explicitOccasion) !== normalizeOccasion(establishedOccasion)) {
      delete evidence.establishedState.activity
    }
    const occasionChoice = chooseField({
      evidence,
      field: 'occasion',
      normalize: policy.requireOccasion === false
        ? value => hasText(value) ? normalizeOccasion(value) : ''
        : normalizeOccasion,
      fallback: policy.requireOccasion === false ? '' : 'casual',
    })
    const activityChoice = chooseField({ evidence, field: 'activity', normalize: normalizeActivity, fallback: 'none' })
    const seasonChoice = chooseField({ evidence, field: 'season', normalize: normalizeSeason, fallback: 'current season' })
    // Visual-composer missions include strategy values beyond stylingIntent.js's narrower
    // freeform routing axis. Context authority chooses the source; the owning composer continues
    // to interpret its mission vocabulary.
    const missionChoice = chooseField({ evidence, field: 'mission', normalize: text, fallback: 'mix' })
    const moodChoice = chooseField({ evidence, field: 'mood', normalize: text, fallback: '' })
    const requestChoice = chooseField({ evidence, field: 'requestText', normalize: normalizeRequestText, fallback: '', conflict: false })
    const locationChoice = chooseField({ evidence, field: 'location', normalize: text, fallback: '' })
    const dateChoice = chooseField({ evidence, field: 'date', normalize: normalizeDate, fallback: policy.now || new Date(), conflict: false })

    const occasion = occasionChoice.value
    const requestText = requestChoice.value
    const mood = moodChoice.value
    const occasionProfile = resolveOccasionProfile(occasion, mood)
    const activityProfile = resolveActivityProfile({
      activity: activityChoice.value,
      occasion,
      mood,
      request: requestText,
    })
    const activity = activityChoice.value || 'none'
    const resolvedActivity = activityProfile?.id || activity
    const activitySource = activity && activity !== 'none'
      ? 'dropdown'
      : activityProfile
        ? 'inferred'
        : 'none'
    const comfortConstraint = resolveComfortFootwearConstraint({ occasion, mood, request: requestText, activity })
    const weather = await resolveWeather({
      evidence,
      season: seasonChoice.value,
      seasonProvenance: seasonChoice.provenance,
      mood,
      requestText,
      location: locationChoice.value,
      date: dateChoice.value,
      allowLiveWeather: policy.allowLiveWeather !== false,
      weatherResolver,
    })

    const provenanceByField = {
      occasion: occasionChoice.provenance,
      activity: {
        ...activityChoice.provenance,
        ...(resolvedActivity !== activity ? { resolvedFromRequest: true } : {}),
      },
      season: seasonChoice.provenance,
      mission: missionChoice.provenance,
      mood: moodChoice.provenance,
      requestText: requestChoice.provenance,
      location: locationChoice.provenance,
      date: dateChoice.provenance,
      weatherProfile: weather.provenance,
    }

    const conflicts = [
      occasionChoice.conflict,
      activityChoice.conflict,
      seasonChoice.conflict,
      missionChoice.conflict,
      moodChoice.conflict,
      locationChoice.conflict,
    ].filter(Boolean)

    return {
      occasion,
      activity,
      resolvedActivity,
      activitySource,
      season: seasonChoice.value,
      mission: missionChoice.value,
      mood,
      requestText,
      location: locationChoice.value,
      date: dateChoice.value,
      weatherProfile: weather.profile,
      occasionProfile,
      activityProfile,
      comfortConstraint,
      provenanceByField,
      conflicts,
      debug: {
        resolved: {
          occasion,
          activity: resolvedActivity,
          declaredActivity: activity,
          activitySource,
          season: seasonChoice.value,
          mission: missionChoice.value,
          weather: weatherSummary(weather.profile),
        },
        provenanceByField,
        conflicts,
      },
    }
  }
}

export const resolveStylingContext = createStylingContextResolver()
