import {
  STYLE_FEEDBACK,
  IDENTITY_FEEDBACK
} from '../constants/feedback'

export function getFeedbackType(label) {
  if (STYLE_FEEDBACK.includes(label)) return 'style'
  if (IDENTITY_FEEDBACK.includes(label)) return 'identity'
  return 'unknown'
}
