// top_subtype: what kind of top a piece is. Type only — no length or silhouette baked in (a tunic or
// crop top is typed by what it is; length lives in length_hits_at, cut in silhouette). Same shape as
// bottom_subtype/outerwear_subtype. Owner rulings 2026-10-18: tank and shell are separate — tank is
// a casual sleeveless top, shell a dressier one; pullover hoodies are sweatshirts; shirt means
// button-front; knit_top is a fine-knit or jersey top that is not a tee.
//
// This is the canonical value list: the tagger schema, taggerMerge validation, PieceForm, BatchAdd
// and the wardrobe browse dropdown all read it from here.
export const TOP_SUBTYPE_VALUES = ['tee', 'tank', 'shell', 'blouse', 'shirt', 'knit_top', 'sweater', 'sweatshirt', 'vest', 'other', 'unknown']

// Plural labels for the wardrobe browse filter, singular for the edit form.
export const TOP_SUBTYPE_FILTER_OPTIONS = [
  { value: 'tee',        label: 'Tees' },
  { value: 'tank',       label: 'Tanks' },
  { value: 'shell',      label: 'Shells' },
  { value: 'blouse',     label: 'Blouses' },
  { value: 'shirt',      label: 'Shirts' },
  { value: 'knit_top',   label: 'Knit tops' },
  { value: 'sweater',    label: 'Sweaters' },
  { value: 'sweatshirt', label: 'Sweatshirts & hoodies' },
  { value: 'vest',       label: 'Vests' },
  { value: 'other',      label: 'Other' },
]

export const TOP_SUBTYPE_FORM_OPTIONS = [
  { value: 'tee',        label: 'Tee' },
  { value: 'tank',       label: 'Tank' },
  { value: 'shell',      label: 'Shell' },
  { value: 'blouse',     label: 'Blouse' },
  { value: 'shirt',      label: 'Shirt' },
  { value: 'knit_top',   label: 'Knit top' },
  { value: 'sweater',    label: 'Sweater' },
  { value: 'sweatshirt', label: 'Sweatshirt / hoodie' },
  { value: 'vest',       label: 'Vest' },
  { value: 'other',      label: 'Other' },
  { value: 'unknown',    label: 'Unknown' },
]
