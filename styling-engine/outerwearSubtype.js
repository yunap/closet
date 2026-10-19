// outerwear_subtype: what kind of outerwear a piece is. Type only — no length, warmth or weather
// job baked in (length lives in length_hits_at; warmth and weather adequacy are contextual
// verdicts, see docs/outerwear-role-ontology-spec.md). Same shape as bottom_subtype. Owner rulings
// 2026-10-18: sporty zip layers — hoodies, track jackets, zip-up sweatshirts — are 'hoodie', not
// 'jacket' (this reversed the same day's first call, which folded them into jacket); a fleece
// jacket stays 'jacket'.
//
// This is the canonical value list: the tagger schema, taggerMerge validation, PieceForm, BatchAdd
// and the wardrobe browse dropdown all read it from here.
export const OUTERWEAR_SUBTYPE_VALUES = ['coat', 'jacket', 'hoodie', 'blazer', 'cardigan', 'vest', 'shrug', 'other', 'unknown']

// Plural labels for the wardrobe browse filter, singular for the edit form.
export const OUTERWEAR_SUBTYPE_FILTER_OPTIONS = [
  { value: 'coat',     label: 'Coats' },
  { value: 'jacket',   label: 'Jackets' },
  { value: 'hoodie',   label: 'Hoodies & track jackets' },
  { value: 'blazer',   label: 'Blazers' },
  { value: 'cardigan', label: 'Cardigans' },
  { value: 'vest',     label: 'Vests' },
  { value: 'shrug',    label: 'Shrugs' },
  { value: 'other',    label: 'Other' },
]

export const OUTERWEAR_SUBTYPE_FORM_OPTIONS = [
  { value: 'coat',     label: 'Coat' },
  { value: 'jacket',   label: 'Jacket' },
  { value: 'hoodie',   label: 'Hoodie / track' },
  { value: 'blazer',   label: 'Blazer' },
  { value: 'cardigan', label: 'Cardigan' },
  { value: 'vest',     label: 'Vest' },
  { value: 'shrug',    label: 'Shrug' },
  { value: 'other',    label: 'Other' },
  { value: 'unknown',  label: 'Unknown' },
]
