# A/B Rankings Comparison Report (Pre-remediation vs. Post-remediation)

Generated on: 2026-06-11T07:13:47.503Z

This report compares top-12 garment recommendations side-by-side to identify semantic changes.

## Scenario 1: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `casual`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **oatmeal crochet knit midi skirt** (ID: 93) (Rank #1) [score: 32]
- **olive ruffle hem midi skirt** (ID: 97) (Rank #2) [score: 28]
- **dark navy straight leg denim** (ID: 109) (Rank #3) [score: 28]
- **Gray maxi skirt** (ID: 152) (Rank #4) [score: 28]
- **mauve corduroy slim fit pants** (ID: 232) (Rank #5) [score: 26]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #6) [score: 25]
- **dark blue slim straight jeans** (ID: 107) (Rank #7) [score: 25]
- **white slim crop jeans** (ID: 110) (Rank #8) [score: 25]
- **Gray Pencil jeans** (ID: 121) (Rank #9) [score: 25]
- **Olive Cargo pants** (ID: 230) (Rank #10) [score: 25]
- **wide leg trousers** (ID: 101) (Rank #11 → #12) [score: 22]

### Entered the Top-12
- **black cream botanical tiered midi skirt** (ID: 92) [Current Rank #11, score 23 (was #49)]
  - *Reasons*: needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; soft + soft risk; two expressive pieces risk

### Left the Top-12
- **light grey zip detail skinny pants** (ID: 111) [Baseline Rank #12, score 22 (now #13)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom

EXPLAINED BY: [repaired bottomKind mini-skirt substring match on "minimal" in notes. ID 92 now correctly classified as midi skirt instead of mini, increasing its score and ranking.]

---

## Scenario 2: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `casual`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed (softness classification Fix A and grounding cap Fix B correctly prevents visual gravity anchor gate from firing for Whale stripe tee, preserving baseline hot weather ranking and returning beige linen shorts to top-12)]

---

## Scenario 3: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `casual`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 4: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `going-out`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 5: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `going-out`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed (softness classification Fix A and grounding cap Fix B correctly prevents visual gravity anchor gate from firing for Whale stripe tee, preserving baseline hot weather ranking and returning beige linen shorts to top-12)]

---

## Scenario 6: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `going-out`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 7: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `hiking`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 8: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `hiking`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed (softness classification Fix A and grounding cap Fix B correctly prevents visual gravity anchor gate from firing for Whale stripe tee, preserving baseline hot weather ranking and returning beige linen shorts to top-12)]

---

## Scenario 9: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `hiking`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 10: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `casual`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 11: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `casual`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 12: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `casual`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 13: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `going-out`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 14: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `going-out`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 15: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `going-out`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 16: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `hiking`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 17: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `hiking`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 18: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `hiking`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 19: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `casual`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 20: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `casual`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 21: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `casual`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 22: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `going-out`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 23: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `going-out`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 24: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `going-out`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 25: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `hiking`
- **Mood/Weather**: `(none)`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 26: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `hiking`
- **Mood/Weather**: `it is really hot`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

## Scenario 27: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `hiking`
- **Mood/Weather**: `freezing today`

*No rank or score changes detected in the top-12.*

EXPLAINED BY: [expected no-op, confirmed]

---

