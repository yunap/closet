export const OVERALL_VERDICT_LABELS = [
  ['signature', 'This feels exactly like me'],
  ['works', 'Looks good'],
  ['almost', 'Almost right'],
  ['not_me', 'Not for me'],
]

export const STYLE_DIRECTION_REASONS = [
  ['too_safe', 'Too plain'],
  ['too_polished', 'Too polished or dressed-up'],
  ['too_soft', 'Feels too delicate'],
  ['too_generic', 'Does not feel personal'],
  ['too_formal', 'Too formal'],
  ['too_casual', 'Too casual'],
  ['too_severe', 'Feels too harsh'],
  ['too_youthful', 'Feels too young'],
  ['too_sporty', 'Too sporty'],
  ['too_subdued', 'Feels too quiet or dull'],
  ['costume_like', 'Feels like a costume'],
  ['catalog_like', 'Looks like a generic store outfit'],
]

export const SHAPE_BALANCE_REASONS = [
  ['too_much_volume', 'Looks too bulky'],
  ['shape_lost', 'My shape disappears'],
  ['unbalanced_proportions', 'Top and bottom do not work together'],
  ['layer_too_long', 'Top or jacket looks too long'],
  ['competing_hemlines', 'The layer lengths look awkward'],
  ['too_columnar', 'Looks too straight up and down'],
  ['too_fitted', 'Looks too tight'],
]

export const IMAGE_FIDELITY_FEEDBACK_LABELS = [
  ['wrong_length', 'A garment is the wrong length'],
  ['wrong_garment_details', 'Garment details look wrong'],
  ['body_proportions_drift', 'My body proportions look wrong'],
  ['identity_drift', 'This does not look like me'],
]

export const WRONG_LENGTH_REASONS = [
  ['sleeves_too_long', 'Sleeves too long'],
  ['sleeves_too_short', 'Sleeves too short'],
  ['upper_hem_too_long', 'Top or jacket hem too long'],
  ['upper_hem_too_short', 'Top or jacket hem too short'],
  ['lower_hem_too_long', 'Pants, skirt, or dress too long'],
  ['lower_hem_too_short', 'Pants, skirt, or dress too short'],
]

export const FEEDBACK_REASON_LABELS = Object.fromEntries([
  ...STYLE_DIRECTION_REASONS,
  ...SHAPE_BALANCE_REASONS,
])
