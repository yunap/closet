// top_subtype: what kind of top a piece is, as seen in the photo. Type only — nothing about
// dressiness (formality and the Occasion filter own that), length or cut (length_hits_at and
// silhouette own those). Same shape as bottom_subtype/outerwear_subtype.
//
// Owner rulings 2026-10-18/19. The guiding rule: a type must be something you can see in the
// photo, so a type page shows similar tops side by side for comparison.
// - sleeveless: any top with no sleeves (tank, shell, cami, sleeveless blouse), except a sleeveless
//   sweater or sweatshirt. Replaced separate tank and shell values: the line between them was
//   dressiness, invisible in a photo, and near-identical tops landed on two pages.
// - tee: T-shirts, kept separate from other knit tops at the owner's request.
// - knit_top: any other sleeved knit or jersey top.
// - shirt_blouse: woven tops, button-front or not. Replaced separate shirt and blouse values: the
//   owner's own picks split them by feel, and buttons can be decorative, so "button-front" is not
//   visible either. Woven vs knit is the line every surveyed retailer draws.
// - sweatshirt: sweatshirts and pullover hoodies.
// - other: anything else, e.g. a vest worn as a top — a vest has no sleeves but is not a tank, so
//   it stays 'other' rather than joining sleeveless.
//
// This is the canonical value list: the tagger schema, taggerMerge validation, PieceForm, BatchAdd
// and the wardrobe browse dropdown all read it from here.
export const TOP_SUBTYPE_VALUES = ['tee', 'knit_top', 'sleeveless', 'shirt_blouse', 'sweater', 'sweatshirt', 'other', 'unknown']

// Plural labels for the wardrobe browse filter, singular for the edit form.
export const TOP_SUBTYPE_FILTER_OPTIONS = [
  { value: 'tee',          label: 'Tees' },
  { value: 'knit_top',     label: 'Knit tops' },
  { value: 'sleeveless',   label: 'Sleeveless' },
  { value: 'shirt_blouse', label: 'Shirts & blouses' },
  { value: 'sweater',      label: 'Sweaters' },
  { value: 'sweatshirt',   label: 'Sweatshirts & hoodies' },
  { value: 'other',        label: 'Other' },
]

export const TOP_SUBTYPE_FORM_OPTIONS = [
  { value: 'tee',          label: 'Tee' },
  { value: 'knit_top',     label: 'Knit top' },
  { value: 'sleeveless',   label: 'Sleeveless' },
  { value: 'shirt_blouse', label: 'Shirt / blouse' },
  { value: 'sweater',      label: 'Sweater' },
  { value: 'sweatshirt',   label: 'Sweatshirt / hoodie' },
  { value: 'other',        label: 'Other' },
  { value: 'unknown',      label: 'Unknown' },
]

// The first top list (2026-10-18), for the one-time remap of values stored under it.
export const TOP_SUBTYPE_V1_REMAP = {
  tank: 'sleeveless',
  shell: 'sleeveless',
  shirt: 'shirt_blouse',
  blouse: 'shirt_blouse',
  vest: 'other',
}

// "No sleeves wins": a sleeveless top is 'sleeveless' whatever else it is, except these.
export const SLEEVELESS_KEEPS_TYPE = new Set(['sweater', 'sweatshirt', 'other'])
