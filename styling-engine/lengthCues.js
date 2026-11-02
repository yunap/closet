// WHERE A TOP OR OUTERWEAR HEM LANDS, AS A VISIBLE BODY CUE (owner ruling 2026-10-26, thread_1793053056487).
// The length tag a user enters must be enough for a correct render — no worn photo or note required. The image model
// drew `mid_thigh` (and before it `tunic`) at about the fingertips or higher: a landmark word alone is too weak against
// its idea of a knit top. Each value is stated as something it can check on the figure it draws. The tagger is given
// the two thigh cues as definitions, so the value it assigns and the picture the renderer draws mean the same place.
//
// Dresses and bottoms are not described here: their values are skirt/pant lengths with their own meanings.
export const UPPER_LENGTH_CUES = {
  cropped: 'the hem ends above the natural waist, so the waistband of the bottom shows',
  waist: 'the hem ends at the natural waist, level with the waistband of the bottom',
  high_hip: 'the hem ends a little below the waist, at the top of the hip bones',
  hip: 'the hem ends at the widest part of the hips',
  low_hip: 'the hem ends below the hips, covering the seat, at the top of the thighs',
  mid_thigh: 'the hem ends at mid-thigh, about level with the fingertips when the arms hang relaxed',
  above_knee: 'the hem ends on the lower thigh, clearly below the fingertips when the arms hang relaxed, a few inches above the knee',
  knee: 'the hem ends at the knee',
  mid_calf: 'the hem ends at mid-calf',
  ankle: 'the hem ends at the ankle',
  full_length: 'the hem ends just above the floor',
  floor_length: 'the hem reaches the floor',
}

export function upperLengthCue(value) {
  return UPPER_LENGTH_CUES[String(value || '').trim()] || ''
}

// Told to the tagger with the length_hits_at schema: the two neighbouring thigh values, the only pair a hanger photo
// most often leaves ambiguous.
export const UPPER_THIGH_LENGTH_DEFINITIONS = `For tops and outerwear: mid_thigh = ${UPPER_LENGTH_CUES.mid_thigh}; above_knee = ${UPPER_LENGTH_CUES.above_knee}.`
