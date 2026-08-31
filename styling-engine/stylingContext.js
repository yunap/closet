import { resolveActivityProfile, resolveComfortFootwearConstraint } from './footwear-comfort.js'
import { resolveOccasionProfile } from './occasions.js'
import { weatherProfileFromContext } from './rules.js'
import { normalizeActivity, normalizeOccasion } from './stylingIntent.js'
import { getCurrentWeatherProfile, resolveWeatherContext, validateUserWeather, validateWeatherEstimate } from './weather.js'
import { resolveCalendarSeason } from '../lib/seasonContext.js'

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
    isRainy: Boolean(profile.isRainy ?? profile.is_rainy),
    isWetExposure: Boolean(profile.isWetExposure ?? profile.is_wet_exposure),
    ...(high !== null && high !== '' && Number.isFinite(Number(high))
      ? { highF: Number(high) }
      : {}),
    ...(low !== null && low !== '' && Number.isFinite(Number(low))
      ? { lowF: Number(low) }
      : {}),
  }
}

export function projectStylingApplicabilityContext(context = {}, overrides = {}) {
  const weatherProfile = overrides.weatherProfile || context.weatherProfile || {}
  const currentDate = overrides.currentDate ?? context.date ?? null
  const calendarSeason = overrides.calendarSeason || (
    overrides.season !== undefined
      ? resolveCalendarSeason(overrides.season, currentDate)
      : (context.calendarSeason || resolveCalendarSeason(context.season, currentDate))
  )
  return {
    occasion: overrides.occasion ?? context.occasion ?? '',
    activity: overrides.activity ?? context.activity ?? '',
    season: calendarSeason,
    calendarSeason,
    currentDate,
    weather: {
      hot: Boolean(weatherProfile.isHot ?? weatherProfile.is_hot ?? weatherProfile.hot),
      cold: Boolean(weatherProfile.isCold ?? weatherProfile.is_cold ?? weatherProfile.cold),
      rainy: Boolean(weatherProfile.isRainy ?? weatherProfile.is_rainy ?? weatherProfile.rainy),
      wet_exposure: Boolean(weatherProfile.isWetExposure ?? weatherProfile.is_wet_exposure ?? weatherProfile.wet_exposure),
    },
    weatherProfile,
    weatherText: String(overrides.weatherText ?? context.statedWeather ?? ''),
    requestText: String(overrides.requestText ?? context.requestText ?? ''),
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

// Spec docs/future-trip-weather-estimate-spec.md §6.1/§6.5: a named
// destination/date (or a bare structured user_weather/weather_estimate)
// resolves through the ONE structured contract (weather.js's
// resolveWeatherContext, fed a live lookup via the same injectable
// weatherResolver the legacy branch below uses) exclusively — never
// season/mood/prose, including this file's own statedWeatherCandidate
// free-text path below. Returns null (meaning "not a named-destination
// case") when there is neither a location+date nor any structured weather
// input, so every other caller of resolveStylingContext (direct/non-chat
// generation, at-home freeform turns) falls through to the unchanged
// legacy behavior beneath this function.
//
// toolContext caches the resolved context (spec §6.5: "search stores its
// resolved context in toolContext; proposal consumes the matching
// context") — a second call with the same location+date identity and no
// NEW structured weather input reuses the cached result instead of
// re-resolving (re-geocoding, re-fetching).
async function resolveNamedDestinationWeather({ explicitRequest = {}, toolContext = {}, weatherResolver, mood = '', season = '' }) {
  // Deliberately NOT falling back to toolContext.location: that field is the
  // route-level home-location default (routes/ai.js: req.body.location ||
  // getHomeLocation()), set once at turn start and never a signal that THIS
  // call is actually about a named destination. Only this call's own
  // explicit location arg counts as "named" — an ordinary local/at-home
  // request must keep falling through to the unchanged legacy heuristic
  // below, not silently resolve live weather for the owner's home city on
  // every single tool call.
  const explicitLocation = text(explicitRequest.location)
  // Reads ONLY explicitRequest.dateRange, a field this function owns
  // exclusively — never the generic explicitRequest.date some callers
  // default all the way to today for unrelated legacy season/date
  // resolution (e.g. generate_outfits' `date || toolContext.currentDate ||
  // new Date()`). Reading that shared field here would make every call
  // look like it named an explicit date.
  // Falls back to the plain `date` field only when the caller never mentioned
  // `dateRange` at all (key absent). A caller that explicitly sets
  // `dateRange: null` (generate_outfits, whose own `date` field is
  // separately defaulted all the way to today for unrelated legacy
  // resolution) is deliberately NOT falling through to that unreliable value.
  const explicitDateRange = explicitRequest.dateRange && typeof explicitRequest.dateRange === 'object' && explicitRequest.dateRange.start
    ? explicitRequest.dateRange
    : null
  const singleDate = explicitRequest.dateRange === undefined ? text(explicitRequest.date) : ''
  const dateRange = explicitDateRange || (singleDate ? { start: singleDate, end: singleDate } : null)

  const cached = toolContext && typeof toolContext === 'object' ? toolContext.resolvedWeatherContext : null
  const userWeather = validateUserWeather(explicitRequest.userWeather)
  const modelEstimate = validateWeatherEstimate(explicitRequest.weatherEstimate)

  // Trigger the structured contract when THIS call supplies fresh evidence
  // of either shape — a destination WITH a date (matching plan_outfit_set's
  // own "named destination/date" gate), or a structured user_weather/
  // weather_estimate on its own (a bare "it's supposed to be cold today"
  // with no named place is still a real, structured claim; resolveWeatherContext
  // below already handles a null location — userWeather/modelEstimate still
  // win there ahead of the heuristic). Deliberately NOT a location by itself
  // with no date and no structured weather: that is the ordinary "what
  // should I wear today in [city]" case, already correctly served by the
  // legacy live-for-today branch further down — routing it through here too
  // would silently downgrade it to heuristic (no date means no live lookup
  // is even attempted below, so the result would fall straight to
  // 'unavailable'/'heuristic' instead of the live lookup the legacy path
  // already knows how to do for a same-day, no-date request).
  // With NOTHING fresh, only reuse an already-resolved destination context
  // from earlier in the SAME turn (spec §6.5: "search stores its resolved
  // context in toolContext; proposal consumes the matching context") —
  // never invent one.
  // isCurrentSeason mirrors the legacy live branch's own gate further down:
  // an explicit HYPOTHETICAL season ("show me winter looks for my trip")
  // must keep bypassing any live lookup — a location+date alone, with no
  // structured weather input, is not enough to override that existing,
  // documented behavior. A structured user_weather/weather_estimate is a
  // stronger, independent signal and triggers regardless of season text.
  const hasFreshDestination = Boolean(explicitLocation && dateRange?.start && isCurrentSeason(season))
  const hasFreshStructuredWeather = Boolean(userWeather || modelEstimate)
  if (!hasFreshDestination && !hasFreshStructuredWeather) {
    return cached || null
  }

  const cachedEnd = cached?.dateRange?.end || cached?.dateRange?.start
  const requestedEnd = dateRange ? (dateRange.end || dateRange.start) : null
  const identityMatches = cached &&
    (cached.location || '') === explicitLocation &&
    (cached.dateRange?.start || null) === (dateRange?.start || null) &&
    cachedEnd === requestedEnd
  if (identityMatches && !userWeather && !modelEstimate) return cached

  // Reuses the SAME injectable weatherResolver seam resolveWeather's own
  // legacy live branch below already uses (defaults to
  // getCurrentWeatherProfile, which has its own NODE_ENV=test network guard)
  // — a caller/test that injects a custom weatherResolver mock must
  // transparently intercept this path too, not silently fall through to a
  // real network fetch. Single-date/exclusive semantics are correct here:
  // unlike plan_outfit_set's multi-day date_range, these tools' `date` is a
  // single day.
  let liveWeather = null
  // Same isCurrentSeason gate as hasFreshDestination above: a hypothetical
  // season paired with a structured weather_estimate (e.g. "winter looks
  // for my October Vienna trip") must go straight to the estimate, never
  // attempt a live lookup that would silently override the stated
  // hypothetical.
  if (explicitLocation && dateRange?.start && isCurrentSeason(season)) {
    try {
      const live = await weatherResolver({ date: dateRange.start, location: explicitLocation, mood, season })
      if (live?.weatherSource === 'live') liveWeather = live
    } catch {
      liveWeather = null
    }
  }
  const resolved = resolveWeatherContext({ userWeather, liveWeather, modelEstimate, location: explicitLocation, dateRange })
  if (toolContext && typeof toolContext === 'object') toolContext.resolvedWeatherContext = resolved
  return resolved
}

function profileFromResolvedWeatherContext(resolved) {
  const t = resolved.temperature
  return {
    isHot: t.isHot, isCold: t.isCold, isExtremeHeat: t.isExtremeHeat,
    ...(Number.isFinite(t.highF) ? { highF: t.highF } : {}),
    ...(Number.isFinite(t.lowF) ? { lowF: t.lowF } : {}),
    isRainy: resolved.precipitation?.value === 'rain',
    isWetExposure: resolved.precipitation?.value === 'rain' || resolved.precipitation?.value === 'mixed',
    weatherSource: t.source,
    resolvedWeatherContext: resolved,
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
  toolContext,
}) {
  // Spec docs/future-trip-weather-estimate-spec.md §6.5: structured
  // resolution slots in exactly where the legacy live-weather branch used to
  // sit — AFTER an explicit prose statedWeather or an already-resolved
  // weatherProfile object, both of which represent a caller (or an earlier
  // stage of the SAME turn, e.g. plan_outfit_set threading its own already-
  // resolved weather through for occasion/activity purposes only) that has
  // already settled the question and must not be silently re-resolved.
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

  if (allowLiveWeather) {
    const namedDestination = await resolveNamedDestinationWeather({ explicitRequest: evidence.explicitRequest || {}, toolContext, weatherResolver, mood, season })
    if (namedDestination) {
      if (namedDestination.temperature.source === 'unavailable' && savedSnapshot) {
        return {
          profile: savedSnapshot,
          provenance: { source: savedSnapshotSource, fallbackFrom: 'named_destination_unavailable' },
        }
      }
      return {
        profile: profileFromResolvedWeatherContext(namedDestination),
        provenance: { source: `named_destination.${namedDestination.temperature.source}` },
      }
    }
  }

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
    toolContext = {},
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
      toolContext,
    })
    const calendarSeason = resolveCalendarSeason(seasonChoice.value, dateChoice.value)
    const applicabilityContext = projectStylingApplicabilityContext({
      occasion,
      activity,
      season: seasonChoice.value,
      calendarSeason,
      date: dateChoice.value,
      weatherProfile: weather.profile,
      statedWeather: statedWeatherCandidate(evidence)?.value || '',
      requestText,
    })

    const provenanceByField = {
      occasion: occasionChoice.provenance,
      activity: {
        ...activityChoice.provenance,
        ...(resolvedActivity !== activity ? { resolvedFromRequest: true } : {}),
      },
      season: seasonChoice.provenance,
      calendarSeason: {
        source: 'derived_from_resolved_season',
        raw: seasonChoice.value,
        referenceDate: dateChoice.value || null,
      },
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
      calendarSeason,
      applicabilityContext,
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
          calendarSeason,
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
