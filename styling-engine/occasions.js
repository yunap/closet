export const OCCASION_PROFILES = [
  {
    id: "outdoor_active",
    label: "Outdoor Active / Walking Heavy",
    keywords: ["walk", "hike", "beach walk", "trail", "active", "park walk", "city walk"],
    vibe: "practical, comfortable, highly durable, movement-focused",
    rules: {
      prohibited_materials: ["silk", "satin", "chiffon", "delicate lace", "high-maintenance fabrics"],
      prohibited_footwear: ["heels", "wedges", "delicate sandals", "dress shoes"],
      preferred_materials: ["cotton", "knitwear", "denim", "utility canvas"],
      preferred_footwear: ["sneakers", "walking flats", "flat rugged boots"]
    }
  },
  {
    id: "outdoor_daytime_social",
    label: "Outdoor Daytime Social / Festivals",
    keywords: ["festival", "crafts", "wine festival", "market", "fair", "picnic", "outdoor cafe"],
    vibe: "relaxed, creative, textured, 'Urban Artisan', airy but intentional",
    rules: {
      prohibited_materials_warm: ["cashmere", "heavy wool", "dense knits", "thick corduroy"],
      prohibited_footwear_summer: ["heavy boots", "zip ankle boots", "shearling boots", "thick winter boots"],
      preferred_materials: ["linen", "cotton", "light silk", "tencel", "light textured knits"],
      preferred_footwear: ["canvas slip shoes", "sandals", "loafers", "lightweight flats"]
    }
  },
  {
    id: "city_smart_casual",
    label: "City Smart Casual / Everyday",
    keywords: ["city", "museum", "shopping", "dinner", "brunch", "office", "everyday", "work"],
    vibe: "polished, comfortable, walk-friendly, clean columns",
    rules: {
      prohibited_footwear: ["uncomfortable heels", "athletic running shoes (unless styled deliberately)"],
      preferred_materials: ["tailored linen", "structured denim", "cardigans", "light outerwear"],
      preferred_footwear: ["loafers", "slip-ons", "low block heels", "clean leather sneakers"]
    }
  },
  {
    id: "evening_social",
    label: "Evening Social / Dining",
    keywords: ["dinner date", "wine bar", "theater", "evening drinks", "night out"],
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
      prohibited_pieces: ["structured denim", "outerwear coats", "heeled shoes", "formal blazers"],
      preferred_materials: ["soft elastic", "fleece", "soft cotton jersey"],
      preferred_footwear: ["slippers", "soft flats", "barefoot"]
    }
  }
]
