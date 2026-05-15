export function getLearningMessage(feedback) {
  switch (feedback) {
    case 'Ages me up':
      return 'Learning saved: preserving younger emotional vitality.'

    case 'Catalog maturity drift':
      return 'Learning saved: reducing mature-catalog casting.'

    case 'Lost artistic presence':
      return 'Learning saved: preserving artistic identity.'

    case 'Wrong silhouette':
      return 'Learning saved: adjusting silhouette geometry only.'

    default:
      return 'Learning saved.'
  }
}
