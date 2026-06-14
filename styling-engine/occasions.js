// Occasion Profiles and Rules
// Taste-adjacent lists governed by the Style Constitution amendment rule.
// AI models may add only entries marked `// [proposed]`, with no force until ratified by Yuna.
//
// FROZEN (Yuna 2026-06-12). No new profiles. New occasions rely on piece occasion metadata + model judgment + the weather layer. Personal rules enter via per-piece occasion exclusions (user feedback) or a Style Constitution amendment — not new profiles.

export const OCCASION_PROFILES = [
  {
    id: "outdoor_daytime_social",
    label: "Outdoor Daytime Social / Festivals",
    keywords: ["festival", "crafts", "wine festival", "market", "fair", "picnic", "outdoor cafe"],
    vibe: "relaxed, creative, textured, airy, intentional",
    rules: {
      discouraged_materials_warm: ["cashmere", "heavy wool", "dense knits", "thick corduroy"],
      discouraged_footwear_summer: ["heavy boot", "heavy boots", "zip ankle boot", "zip ankle boots", "shearling boot", "shearling boots", "thick winter boot", "thick winter boots"],
      preferred_materials: ["linen", "cotton", "light silk", "tencel", "light textured knits", "knit"],
      preferred_footwear: ["canvas slip shoes", "sandals", "loafers", "lightweight flats"]
    }
  },
  {
    id: "city_smart_casual",
    label: "City Smart Casual / Everyday",
    keywords: ["city", "museum", "shopping", "dinner", "brunch", "office", "everyday", "work"],
    vibe: "polished, comfortable, walk-friendly, clean columns",
    rules: {
      discouraged_footwear: ["athletic running shoe", "athletic running shoes"],
      preferred_materials: ["tailored linen", "structured denim", "cardigans", "light outerwear"],
      preferred_footwear: ["loafers", "slip-ons", "low block heels", "clean leather sneakers"]
    }
  },
  {
    id: "evening_social",
    label: "Evening Social / Dining",
    keywords: ["evening", "dinner date", "wine bar", "theater", "evening drinks", "night out"],
    vibe: "sharp, artistic, low-key drama, deep color palettes, rich textures",
    rules: {
      preferred_materials: ["silk", "satin", "textured knits", "fine wool"],
      preferred_footwear: ["mules", "block heels", "dress flats", "refined boots"]
    }
  },
  {
    id: "home_loungewear",
    label: "Home / Loungewear",
    keywords: ["home", "lounge", "sleep", "lazy day", "bed"],
    vibe: "comfort-first, soft, unstructured",
    rules: {
      discouraged_footwear: ["heeled shoe", "heeled shoes"],
      discouraged_pieces: ["structured denim", "outerwear coat", "outerwear coats", "formal blazer", "formal blazers"],
      preferred_materials: ["soft elastic", "fleece", "soft cotton jersey"],
      preferred_footwear: ["slippers", "soft flats", "barefoot"]
    }
  }
]

export function resolveOccasionProfile(occasion = '', mood = '') {
  const normOccasion = String(occasion || '').toLowerCase().trim()
  
  // 1. Direct ID match check
  const normOccasionId = normOccasion.replace(/[-\s]+/g, '_')
  const matchedById = OCCASION_PROFILES.find(p => p.id === normOccasionId)
  if (matchedById) return matchedById

  // 2. Keyword check on occasion string (primary)
  if (normOccasion) {
    for (const profile of OCCASION_PROFILES) {
      for (const keyword of profile.keywords) {
        const cleanKeyword = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
        const regex = new RegExp(`\\b${cleanKeyword}\\b`, 'i')
        if (regex.test(normOccasion)) {
          return profile
        }
      }
    }
  }
  
  return null
}

// Startup validation assertion
export function runOccasionStartupAssertions() {
  for (const profile of OCCASION_PROFILES) {
    const lists = [
      profile.keywords,
      profile.rules?.prohibited_materials,
      profile.rules?.prohibited_materials_warm,
      profile.rules?.prohibited_footwear,
      profile.rules?.prohibited_footwear_summer,
      profile.rules?.prohibited_pieces,
      profile.rules?.discouraged_materials,
      profile.rules?.discouraged_materials_warm,
      profile.rules?.discouraged_footwear,
      profile.rules?.discouraged_footwear_summer,
      profile.rules?.discouraged_footwear_warm,
      profile.rules?.discouraged_pieces,
      profile.rules?.preferred_materials,
      profile.rules?.preferred_footwear,
      profile.rules?.required_footwear
    ];
    for (const list of lists) {
      if (!list) continue;
      for (const entry of list) {
        if (entry.includes('(') || entry.split(/\s+/).length > 4) {
          console.warn(`[occasions.js] Startup Warning: Entry "${entry}" in profile "${profile.id}" contains "(" or is longer than 4 words.`);
        }
      }
    }
  }
}

runOccasionStartupAssertions();
