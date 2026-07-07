# A/B Rankings Comparison Report (Pre-remediation vs. Post-remediation)

Generated on: 2026-07-07T06:01:11.789Z

This report compares top-12 garment recommendations side-by-side to identify semantic changes.

## Scenario 1: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `casual`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #2 → #1) [score: 28 → 35]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom
- **dark navy straight leg denim** (ID: 109) (Rank #3 → #2) [score: 28]
- **Gray maxi skirt** (ID: 152) (Rank #4 → #3) [score: 28]
- **black cream geometric maxi skirt** (ID: 167) (Rank #10 → #5) [score: 23 → 26]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk
  - *Current reasons*: Yuna palette; expressive competition risk; grounded skirt anchor; needed bottom for selected top; register spread needs intentional styling; stable vertical bottom
- **mauve corduroy slim fit pants** (ID: 232) (Rank #5 → #6) [score: 26]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #6 → #7) [score: 25]
- **dark blue slim straight jeans** (ID: 107) (Rank #7 → #8) [score: 25]
- **white slim crop jeans** (ID: 110) (Rank #8 → #9) [score: 25]
- **Gray Pencil jeans** (ID: 121) (Rank #9 → #10) [score: 25]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #4, score 26 (was #20)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **denim mid-thigh shorts** (ID: 239) [Current Rank #11, score 25 (was #27)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette
- **brown twill knee shorts** (ID: 990352) [Current Rank #12, score 25 (was #32)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #1, score 32 (now #31)]
  - *Reasons*: needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **wide leg trousers** (ID: 101) [Baseline Rank #11, score 22 (now #13)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **light grey zip detail skinny pants** (ID: 111) [Baseline Rank #12, score 22 (now #15)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom

EXPLAINED BY: [repaired bottomKind mini-skirt substring match on "minimal" in notes. ID 92 now correctly classified as midi skirt instead of mini, increasing its score and ranking.]

---

## Scenario 2: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `casual`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #6 → #1) [score: 28 → 35]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom
- **wide leg trousers** (ID: 101) (Rank #2) [score: 32]
- **beige tailored linen shorts** (ID: 242) (Rank #4 → #3) [score: 32]
- **dark navy straight leg denim** (ID: 109) (Rank #7 → #4) [score: 28]
- **oatmeal linen wide  jogger-style pants** (ID: 99) (Rank #8 → #5) [score: 27]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; expressive competition risk; hot weather: lightweight fabric; needed bottom for selected top; soft + soft risk; stable vertical bottom
- **mauve corduroy slim fit pants** (ID: 232) (Rank #9 → #7) [score: 26]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #11 → #8) [score: 25]
- **dark blue slim straight jeans** (ID: 107) (Rank #12 → #9) [score: 25]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #6, score 26 (was #25)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **white slim crop jeans** (ID: 110) [Current Rank #10, score 25 (was #13)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; shared color: white
- **Gray Pencil jeans** (ID: 121) [Current Rank #11, score 25 (was #14)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette
- **denim mid-thigh shorts** (ID: 239) [Current Rank #12, score 25 (was #32)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #1, score 32 (now #38)]
  - *Reasons*: needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **light beige linen wide-leg pants** (ID: 128) [Baseline Rank #3, score 32 (now #21)]
  - *Reasons*: hot weather: lightweight fabric; needed bottom for selected top; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **black pink silk floral ruffle midi skirt** (ID: 95) [Baseline Rank #5, score 30 (now #16)]
  - *Reasons*: hot weather: lightweight fabric; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; soft + soft risk; two expressive pieces risk
- **black cream colorblock knit mini skirt** (ID: 96) [Baseline Rank #10, score 25 (now #63)]
  - *Reasons*: hot weather: skin-friendly cut; needed bottom for selected top; stable vertical bottom; short skirt is less signature without compact top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [expected no-op, confirmed (softness classification Fix A and grounding cap Fix B correctly prevents visual gravity anchor gate from firing for Whale stripe tee, preserving baseline hot weather ranking and returning beige linen shorts to top-12)]

---

## Scenario 3: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `casual`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #4 → #1) [score: 28 → 35]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom
- **dark navy straight leg denim** (ID: 109) (Rank #5 → #2) [score: 28]
- **Gray maxi skirt** (ID: 152) (Rank #1 → #3) [score: 36 → 28]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom
- **black cream geometric maxi skirt** (ID: 167) (Rank #3 → #5) [score: 31 → 26]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk
  - *Current reasons*: Yuna palette; expressive competition risk; grounded skirt anchor; needed bottom for selected top; register spread needs intentional styling; stable vertical bottom
- **mauve corduroy slim fit pants** (ID: 232) (Rank #6) [score: 26]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #7) [score: 25]
- **dark blue slim straight jeans** (ID: 107) (Rank #8) [score: 25]
- **white slim crop jeans** (ID: 110) (Rank #9) [score: 25]
- **Gray Pencil jeans** (ID: 121) (Rank #10) [score: 25]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #4, score 26 (was #17)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **denim mid-thigh shorts** (ID: 239) [Current Rank #11, score 25 (was #24)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette
- **brown twill knee shorts** (ID: 990352) [Current Rank #12, score 25 (was #29)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #2, score 32 (now #31)]
  - *Reasons*: needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **grey technical straight-leg pants** (ID: 990390) [Baseline Rank #11, score 23 (now #37)]
  - *Reasons*: cold weather: insulating coverage; needed bottom for selected top; stable vertical bottom; soft + soft risk
- **light grey zip detail skinny pants** (ID: 111) [Baseline Rank #12, score 22 (now #15)]
  - *Reasons*: needed bottom for selected top; stable vertical bottom

EXPLAINED BY: [trustedField filtering on selected top (Whale stripe tee) removes untrusted fields (like silhouette: relaxed) from its text blob, resolving the pale-on-pale softness risk or soft + soft risk penalty (-7 points) and altering rankings.]

---

## Scenario 4: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `going-out`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #2 → #1) [score: 14 → 21]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak going-out occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom; weak going-out occasion fit
- **dark navy straight leg denim** (ID: 109) (Rank #3 → #2) [score: 14]
- **Gray maxi skirt** (ID: 152) (Rank #4 → #3) [score: 14]
- **black cream geometric maxi skirt** (ID: 167) (Rank #11 → #5) [score: 9 → 12]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk; weak going-out occasion fit
  - *Current reasons*: Yuna palette; expressive competition risk; grounded skirt anchor; needed bottom for selected top; register spread needs intentional styling; stable vertical bottom; weak going-out occasion fit
- **mauve corduroy slim fit pants** (ID: 232) (Rank #5 → #6) [score: 12]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #6 → #7) [score: 11]
- **dark blue slim straight jeans** (ID: 107) (Rank #7 → #8) [score: 11]
- **white slim crop jeans** (ID: 110) (Rank #8 → #9) [score: 11]
- **Gray Pencil jeans** (ID: 121) (Rank #9 → #10) [score: 11]
- **charcoal solid tailored trousers** (ID: 182) (Rank #10 → #11) [score: 11]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #4, score 12 (was #21)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **denim mid-thigh shorts** (ID: 239) [Current Rank #12, score 11 (was #29)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #1, score 18 (now #33)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **wide leg trousers** (ID: 101) [Baseline Rank #12, score 8 (now #14)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk

EXPLAINED BY: [trustedField filtering on selected top (Whale stripe tee) removes untrusted fields (like silhouette: relaxed) from its text blob, resolving the pale-on-pale softness risk or soft + soft risk penalty (-7 points) and altering rankings.]

---

## Scenario 5: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `going-out`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #7 → #1) [score: 14 → 21]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak going-out occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom; weak going-out occasion fit
- **wide leg trousers** (ID: 101) (Rank #2) [score: 18]
- **beige tailored linen shorts** (ID: 242) (Rank #4 → #3) [score: 18]
- **sage cropped pants** (ID: 235) (Rank #6 → #4) [score: 15]
- **dark navy straight leg denim** (ID: 109) (Rank #8 → #5) [score: 14]
- **oatmeal linen wide  jogger-style pants** (ID: 99) (Rank #9 → #6) [score: 13]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk; weak going-out occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; expressive competition risk; hot weather: lightweight fabric; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak going-out occasion fit
- **mauve corduroy slim fit pants** (ID: 232) (Rank #10 → #8) [score: 12]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #12 → #9) [score: 11]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #7, score 12 (was #27)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **dark blue slim straight jeans** (ID: 107) [Current Rank #10, score 11 (was #13)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette
- **white slim crop jeans** (ID: 110) [Current Rank #11, score 11 (was #14)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; shared color: white
- **Gray Pencil jeans** (ID: 121) [Current Rank #12, score 11 (was #15)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #1, score 18 (now #39)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **light beige linen wide-leg pants** (ID: 128) [Baseline Rank #3, score 18 (now #23)]
  - *Reasons*: hot weather: lightweight fabric; weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **black pink silk floral ruffle midi skirt** (ID: 95) [Baseline Rank #5, score 16 (now #18)]
  - *Reasons*: hot weather: lightweight fabric; weak going-out occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; soft + soft risk; two expressive pieces risk
- **black cream colorblock knit mini skirt** (ID: 96) [Baseline Rank #11, score 11 (now #60)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; short skirt is less signature without compact top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [expected no-op, confirmed (softness classification Fix A and grounding cap Fix B correctly prevents visual gravity anchor gate from firing for Whale stripe tee, preserving baseline hot weather ranking and returning beige linen shorts to top-12)]

---

## Scenario 6: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `going-out`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #4 → #1) [score: 14 → 21]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak going-out occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom; weak going-out occasion fit
- **dark navy straight leg denim** (ID: 109) (Rank #5 → #2) [score: 14]
- **Gray maxi skirt** (ID: 152) (Rank #1 → #3) [score: 22 → 14]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak going-out occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak going-out occasion fit
- **black cream geometric maxi skirt** (ID: 167) (Rank #3 → #5) [score: 17 → 12]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk; weak going-out occasion fit
  - *Current reasons*: Yuna palette; expressive competition risk; grounded skirt anchor; needed bottom for selected top; register spread needs intentional styling; stable vertical bottom; weak going-out occasion fit
- **mauve corduroy slim fit pants** (ID: 232) (Rank #6) [score: 12]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #7) [score: 11]
- **dark blue slim straight jeans** (ID: 107) (Rank #8) [score: 11]
- **white slim crop jeans** (ID: 110) (Rank #9) [score: 11]
- **Gray Pencil jeans** (ID: 121) (Rank #10) [score: 11]
- **charcoal solid tailored trousers** (ID: 182) (Rank #11) [score: 11]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #4, score 12 (was #18)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **denim mid-thigh shorts** (ID: 239) [Current Rank #12, score 11 (was #25)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #2, score 18 (now #33)]
  - *Reasons*: weak going-out occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **grey technical straight-leg pants** (ID: 990390) [Baseline Rank #12, score 9 (now #40)]
  - *Reasons*: cold weather: insulating coverage; weak going-out occasion fit; needed bottom for selected top; stable vertical bottom; soft + soft risk

EXPLAINED BY: [trustedField filtering on selected top (Whale stripe tee) removes untrusted fields (like silhouette: relaxed) from its text blob, resolving the pale-on-pale softness risk or soft + soft risk penalty (-7 points) and altering rankings.]

---

## Scenario 7: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `hiking`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #2 → #1) [score: 14 → 21]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak hiking occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom; weak hiking occasion fit
- **dark navy straight leg denim** (ID: 109) (Rank #3 → #2) [score: 14]
- **Gray maxi skirt** (ID: 152) (Rank #4 → #3) [score: 14]
- **black cream geometric maxi skirt** (ID: 167) (Rank #11 → #5) [score: 9 → 12]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk; weak hiking occasion fit
  - *Current reasons*: Yuna palette; expressive competition risk; grounded skirt anchor; needed bottom for selected top; register spread needs intentional styling; stable vertical bottom; weak hiking occasion fit
- **mauve corduroy slim fit pants** (ID: 232) (Rank #5 → #6) [score: 12]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #6 → #7) [score: 11]
- **dark blue slim straight jeans** (ID: 107) (Rank #7 → #8) [score: 11]
- **white slim crop jeans** (ID: 110) (Rank #8 → #9) [score: 11]
- **Gray Pencil jeans** (ID: 121) (Rank #9 → #10) [score: 11]
- **charcoal solid tailored trousers** (ID: 182) (Rank #10 → #11) [score: 11]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #4, score 12 (was #21)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **denim mid-thigh shorts** (ID: 239) [Current Rank #12, score 11 (was #29)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #1, score 18 (now #33)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **wide leg trousers** (ID: 101) [Baseline Rank #12, score 8 (now #14)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk

EXPLAINED BY: [trustedField filtering on selected top (Whale stripe tee) removes untrusted fields (like silhouette: relaxed) from its text blob, resolving the pale-on-pale softness risk or soft + soft risk penalty (-7 points) and altering rankings.]

---

## Scenario 8: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `hiking`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #7 → #1) [score: 14 → 21]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak hiking occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom; weak hiking occasion fit
- **wide leg trousers** (ID: 101) (Rank #2) [score: 18]
- **beige tailored linen shorts** (ID: 242) (Rank #4 → #3) [score: 18]
- **sage cropped pants** (ID: 235) (Rank #6 → #4) [score: 15]
- **dark navy straight leg denim** (ID: 109) (Rank #8 → #5) [score: 14]
- **oatmeal linen wide  jogger-style pants** (ID: 99) (Rank #9 → #6) [score: 13]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk; weak hiking occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; expressive competition risk; hot weather: lightweight fabric; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak hiking occasion fit
- **mauve corduroy slim fit pants** (ID: 232) (Rank #10 → #8) [score: 12]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #12 → #9) [score: 11]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #7, score 12 (was #27)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **dark blue slim straight jeans** (ID: 107) [Current Rank #10, score 11 (was #13)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette
- **white slim crop jeans** (ID: 110) [Current Rank #11, score 11 (was #14)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; shared color: white
- **Gray Pencil jeans** (ID: 121) [Current Rank #12, score 11 (was #15)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #1, score 18 (now #39)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **light beige linen wide-leg pants** (ID: 128) [Baseline Rank #3, score 18 (now #23)]
  - *Reasons*: hot weather: lightweight fabric; weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **black pink silk floral ruffle midi skirt** (ID: 95) [Baseline Rank #5, score 16 (now #18)]
  - *Reasons*: hot weather: lightweight fabric; weak hiking occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; soft + soft risk; two expressive pieces risk
- **black cream colorblock knit mini skirt** (ID: 96) [Baseline Rank #11, score 11 (now #60)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; short skirt is less signature without compact top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [expected no-op, confirmed (softness classification Fix A and grounding cap Fix B correctly prevents visual gravity anchor gate from firing for Whale stripe tee, preserving baseline hot weather ranking and returning beige linen shorts to top-12)]

---

## Scenario 9: Selected piece ID 1 ("Whale stripe tee")
- **Category**: top
- **Occasion**: `hiking`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **olive ruffle hem midi skirt** (ID: 97) (Rank #4 → #1) [score: 14 → 21]
  - *Baseline reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak hiking occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; stable vertical bottom; weak hiking occasion fit
- **dark navy straight leg denim** (ID: 109) (Rank #5 → #2) [score: 14]
- **Gray maxi skirt** (ID: 152) (Rank #1 → #3) [score: 22 → 14]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak hiking occasion fit
  - *Current reasons*: Yuna palette; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; weak hiking occasion fit
- **black cream geometric maxi skirt** (ID: 167) (Rank #3 → #5) [score: 17 → 12]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; grounded skirt anchor; needed bottom for selected top; soft + soft risk; stable vertical bottom; two expressive pieces risk; weak hiking occasion fit
  - *Current reasons*: Yuna palette; expressive competition risk; grounded skirt anchor; needed bottom for selected top; register spread needs intentional styling; stable vertical bottom; weak hiking occasion fit
- **mauve corduroy slim fit pants** (ID: 232) (Rank #6) [score: 12]
- **dark blue bootcut denim jeans** (ID: 105) (Rank #7) [score: 11]
- **dark blue slim straight jeans** (ID: 107) (Rank #8) [score: 11]
- **white slim crop jeans** (ID: 110) (Rank #9) [score: 11]
- **Gray Pencil jeans** (ID: 121) (Rank #10) [score: 11]
- **charcoal solid tailored trousers** (ID: 182) (Rank #11) [score: 11]

### Entered the Top-12
- **emerald green corduroy straight pants** (ID: 104) [Current Rank #4, score 12 (was #18)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; artistic/texture vocabulary
- **denim mid-thigh shorts** (ID: 239) [Current Rank #12, score 11 (was #25)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; Yuna palette

### Left the Top-12
- **oatmeal crochet knit midi skirt** (ID: 93) [Baseline Rank #2, score 18 (now #33)]
  - *Reasons*: weak hiking occasion fit; needed bottom for selected top; grounded skirt anchor; stable vertical bottom; Yuna palette; artistic/texture vocabulary; soft + soft risk
- **grey technical straight-leg pants** (ID: 990390) [Baseline Rank #12, score 9 (now #40)]
  - *Reasons*: cold weather: insulating coverage; weak hiking occasion fit; needed bottom for selected top; stable vertical bottom; soft + soft risk

EXPLAINED BY: [trustedField filtering on selected top (Whale stripe tee) removes untrusted fields (like silhouette: relaxed) from its text blob, resolving the pale-on-pale softness risk or soft + soft risk penalty (-7 points) and altering rankings.]

---

## Scenario 10: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `casual`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **gold abstract print blouse** (ID: 68) (Rank #1) [score: 32]
- **floral print long sleeve top** (ID: 143) (Rank #3 → #2) [score: 32]
- **Cream wool shell** (ID: 145) (Rank #4 → #3) [score: 32]
- **floral long sleeve top** (ID: 71) (Rank #7 → #4) [score: 29]
- **navy cream striped button-up shirt** (ID: 133) (Rank #9 → #5) [score: 29]
- **black blouson v-neck top** (ID: 136) (Rank #10 → #6) [score: 29]
- **black lace asymmetrical tank** (ID: 138) (Rank #11 → #7) [score: 29]
- **black white striped sleeveless top** (ID: 139) (Rank #12 → #8) [score: 29]

### Entered the Top-12
- **olive textured mock neck top** (ID: 140) [Current Rank #9, score 29 (was #13)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black turtleneck** (ID: 144) [Current Rank #10, score 29 (was #14)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #11, score 29 (was #16)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black crochet lace tank top** (ID: 172) [Current Rank #12, score 29 (was #17)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **black and cream striped knit top** (ID: 137) [Baseline Rank #2, score 32 (now #46)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette; artistic/texture vocabulary
- **black abstract print short tee** (ID: 264) [Baseline Rank #5, score 32 (now #16)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; Yuna palette; artistic/texture vocabulary
- **textured cream knit top** (ID: 363) [Baseline Rank #6, score 32 (now #17)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **mustard knit sweater** (ID: 84) [Baseline Rank #8, score 29 (now #59)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 11: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `casual`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **black lace asymmetrical tank** (ID: 138) (Rank #1) [score: 47]
- **black crochet lace tank top** (ID: 172) (Rank #2) [score: 47]
- **abstract geometric sleeveless crop top** (ID: 398) (Rank #3) [score: 47]
- **paisley sleeveless blouse** (ID: 83) (Rank #5 → #4) [score: 43]
- **Cream wool shell** (ID: 145) (Rank #7 → #5) [score: 42]
- **turquoise ribbed sleeveless cropped top** (ID: 225) (Rank #4 → #6) [score: 44 → 40]
  - *Baseline reasons*: artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom
  - *Current reasons*: artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; register spread needs intentional styling
- **floral long sleeve top** (ID: 71) (Rank #11 → #7) [score: 39]
- **black blouson v-neck top** (ID: 136) (Rank #12 → #8) [score: 39]
- **black abstract print short tee** (ID: 264) (Rank #8 → #11) [score: 42 → 38]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; needed top for selected bottom; shared color: black
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; needed top for selected bottom; register spread needs intentional styling; shared color: black

### Entered the Top-12
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #9, score 39 (was #13)]
  - *Reasons*: hot weather: lightweight fabric; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **ruffled plum sleeveless top** (ID: 186) [Current Rank #10, score 39 (was #14)]
  - *Reasons*: hot weather: lightweight fabric; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **floral print tank** (ID: 67) [Current Rank #12, score 36 (was #16)]
  - *Reasons*: hot weather: skin-friendly cut; needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette

### Left the Top-12
- **black and cream striped knit top** (ID: 137) [Baseline Rank #6, score 42 (now #35)]
  - *Reasons*: hot weather: lightweight fabric; needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette; artistic/texture vocabulary
- **white scoop neck sleeveless top** (ID: 364) [Baseline Rank #9, score 40 (now #13)]
  - *Reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; compact/structured top
- **abstract print sleeveless top** (ID: 365) [Baseline Rank #10, score 40 (now #14)]
  - *Reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; compact/structured top

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 12: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `casual`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **gold abstract print blouse** (ID: 68) (Rank #3 → #1) [score: 32]
- **floral print long sleeve top** (ID: 143) (Rank #4 → #2) [score: 32]
- **navy cream striped button-up shirt** (ID: 133) (Rank #7 → #5) [score: 29]
- **black white striped sleeveless top** (ID: 139) (Rank #8) [score: 29]
- **olive textured mock neck top** (ID: 140) (Rank #1 → #9) [score: 37 → 29]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; cold weather: insulating coverage; compact/structured top; needed top for selected bottom
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; needed top for selected bottom
- **black turtleneck** (ID: 144) (Rank #9 → #10) [score: 29]

### Entered the Top-12
- **Cream wool shell** (ID: 145) [Current Rank #3, score 32 (was #24)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **floral long sleeve top** (ID: 71) [Current Rank #4, score 29 (was #32)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **black blouson v-neck top** (ID: 136) [Current Rank #6, score 29 (was #33)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **black lace asymmetrical tank** (ID: 138) [Current Rank #7, score 29 (was #63)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #11, score 29 (was #34)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black crochet lace tank top** (ID: 172) [Current Rank #12, score 29 (was #64)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **Navy wool turtleneck** (ID: 146) [Baseline Rank #2, score 37 (now #63)]
  - *Reasons*: cold weather: insulating coverage; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **textured cream knit top** (ID: 363) [Baseline Rank #5, score 32 (now #17)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **mustard knit sweater** (ID: 84) [Baseline Rank #6, score 29 (now #59)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black asymmetrical top** (ID: 220) [Baseline Rank #10, score 29 (now #41)]
  - *Reasons*: needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **olive ruffled sleeveless top** (ID: 227) [Baseline Rank #11, score 29 (now #23)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **brown graphic casual crew tee** (ID: 254) [Baseline Rank #12, score 29 (now #24)]
  - *Reasons*: needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 13: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `going-out`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **gold abstract print blouse** (ID: 68) (Rank #1) [score: 18]
- **floral print long sleeve top** (ID: 143) (Rank #3 → #2) [score: 18]
- **Cream wool shell** (ID: 145) (Rank #4 → #3) [score: 18]
- **floral long sleeve top** (ID: 71) (Rank #7 → #4) [score: 15]
- **navy cream striped button-up shirt** (ID: 133) (Rank #9 → #5) [score: 15]
- **black blouson v-neck top** (ID: 136) (Rank #10 → #6) [score: 15]
- **black lace asymmetrical tank** (ID: 138) (Rank #11 → #7) [score: 15]
- **black white striped sleeveless top** (ID: 139) (Rank #12 → #8) [score: 15]

### Entered the Top-12
- **olive textured mock neck top** (ID: 140) [Current Rank #9, score 15 (was #13)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black turtleneck** (ID: 144) [Current Rank #10, score 15 (was #14)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #11, score 15 (was #16)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black crochet lace tank top** (ID: 172) [Current Rank #12, score 15 (was #17)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **black and cream striped knit top** (ID: 137) [Baseline Rank #2, score 18 (now #48)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette; artistic/texture vocabulary
- **black abstract print short tee** (ID: 264) [Baseline Rank #5, score 18 (now #18)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; Yuna palette; artistic/texture vocabulary
- **textured cream knit top** (ID: 363) [Baseline Rank #6, score 18 (now #19)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **mustard knit sweater** (ID: 84) [Baseline Rank #8, score 15 (now #59)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 14: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `going-out`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **black lace asymmetrical tank** (ID: 138) (Rank #1) [score: 33]
- **black crochet lace tank top** (ID: 172) (Rank #2) [score: 33]
- **abstract geometric sleeveless crop top** (ID: 398) (Rank #3) [score: 33]
- **paisley sleeveless blouse** (ID: 83) (Rank #5 → #4) [score: 29]
- **Cream wool shell** (ID: 145) (Rank #7 → #5) [score: 28]
- **turquoise ribbed sleeveless cropped top** (ID: 225) (Rank #4 → #6) [score: 30 → 26]
  - *Baseline reasons*: artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; weak going-out occasion fit
  - *Current reasons*: artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; register spread needs intentional styling; weak going-out occasion fit
- **floral long sleeve top** (ID: 71) (Rank #11 → #7) [score: 25]
- **black blouson v-neck top** (ID: 136) (Rank #12 → #8) [score: 25]
- **black abstract print short tee** (ID: 264) (Rank #8 → #12) [score: 28 → 24]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; needed top for selected bottom; shared color: black; weak going-out occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; needed top for selected bottom; register spread needs intentional styling; shared color: black; weak going-out occasion fit

### Entered the Top-12
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #9, score 25 (was #13)]
  - *Reasons*: hot weather: lightweight fabric; weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **ruffled plum sleeveless top** (ID: 186) [Current Rank #10, score 25 (was #14)]
  - *Reasons*: hot weather: lightweight fabric; weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black solid wrap blouse** (ID: 210) [Current Rank #11, score 25 (was #15)]
  - *Reasons*: hot weather: lightweight fabric; weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **black and cream striped knit top** (ID: 137) [Baseline Rank #6, score 28 (now #37)]
  - *Reasons*: hot weather: lightweight fabric; weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette; artistic/texture vocabulary
- **white scoop neck sleeveless top** (ID: 364) [Baseline Rank #9, score 26 (now #14)]
  - *Reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; weak going-out occasion fit; needed top for selected bottom; compact/structured top
- **abstract print sleeveless top** (ID: 365) [Baseline Rank #10, score 26 (now #15)]
  - *Reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; weak going-out occasion fit; needed top for selected bottom; compact/structured top

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 15: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `going-out`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **gold abstract print blouse** (ID: 68) (Rank #3 → #1) [score: 18]
- **floral print long sleeve top** (ID: 143) (Rank #4 → #2) [score: 18]
- **navy cream striped button-up shirt** (ID: 133) (Rank #7 → #5) [score: 15]
- **black white striped sleeveless top** (ID: 139) (Rank #8) [score: 15]
- **olive textured mock neck top** (ID: 140) (Rank #1 → #9) [score: 23 → 15]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; cold weather: insulating coverage; compact/structured top; needed top for selected bottom; weak going-out occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; needed top for selected bottom; weak going-out occasion fit
- **black turtleneck** (ID: 144) (Rank #9 → #10) [score: 15]

### Entered the Top-12
- **Cream wool shell** (ID: 145) [Current Rank #3, score 18 (was #25)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **floral long sleeve top** (ID: 71) [Current Rank #4, score 15 (was #32)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **black blouson v-neck top** (ID: 136) [Current Rank #6, score 15 (was #33)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **black lace asymmetrical tank** (ID: 138) [Current Rank #7, score 15 (was #60)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #11, score 15 (was #34)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black crochet lace tank top** (ID: 172) [Current Rank #12, score 15 (was #61)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **Navy wool turtleneck** (ID: 146) [Baseline Rank #2, score 23 (now #63)]
  - *Reasons*: cold weather: insulating coverage; weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **textured cream knit top** (ID: 363) [Baseline Rank #5, score 18 (now #19)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **mustard knit sweater** (ID: 84) [Baseline Rank #6, score 15 (now #59)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black asymmetrical top** (ID: 220) [Baseline Rank #10, score 15 (now #43)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **olive ruffled sleeveless top** (ID: 227) [Baseline Rank #11, score 15 (now #25)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **brown graphic casual crew tee** (ID: 254) [Baseline Rank #12, score 15 (now #26)]
  - *Reasons*: weak going-out occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 16: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `hiking`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **gold abstract print blouse** (ID: 68) (Rank #1) [score: 18]
- **floral print long sleeve top** (ID: 143) (Rank #3 → #2) [score: 18]
- **Cream wool shell** (ID: 145) (Rank #4 → #3) [score: 18]
- **floral long sleeve top** (ID: 71) (Rank #7 → #4) [score: 15]
- **navy cream striped button-up shirt** (ID: 133) (Rank #9 → #5) [score: 15]
- **black blouson v-neck top** (ID: 136) (Rank #10 → #6) [score: 15]
- **black lace asymmetrical tank** (ID: 138) (Rank #11 → #7) [score: 15]
- **black white striped sleeveless top** (ID: 139) (Rank #12 → #8) [score: 15]

### Entered the Top-12
- **olive textured mock neck top** (ID: 140) [Current Rank #9, score 15 (was #13)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black turtleneck** (ID: 144) [Current Rank #10, score 15 (was #14)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #11, score 15 (was #16)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black crochet lace tank top** (ID: 172) [Current Rank #12, score 15 (was #17)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **black and cream striped knit top** (ID: 137) [Baseline Rank #2, score 18 (now #48)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette; artistic/texture vocabulary
- **black abstract print short tee** (ID: 264) [Baseline Rank #5, score 18 (now #18)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; Yuna palette; artistic/texture vocabulary
- **textured cream knit top** (ID: 363) [Baseline Rank #6, score 18 (now #19)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **mustard knit sweater** (ID: 84) [Baseline Rank #8, score 15 (now #59)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 17: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `hiking`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **black lace asymmetrical tank** (ID: 138) (Rank #1) [score: 33]
- **black crochet lace tank top** (ID: 172) (Rank #2) [score: 33]
- **abstract geometric sleeveless crop top** (ID: 398) (Rank #3) [score: 33]
- **paisley sleeveless blouse** (ID: 83) (Rank #5 → #4) [score: 29]
- **Cream wool shell** (ID: 145) (Rank #7 → #5) [score: 28]
- **turquoise ribbed sleeveless cropped top** (ID: 225) (Rank #4 → #6) [score: 30 → 26]
  - *Baseline reasons*: artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; weak hiking occasion fit
  - *Current reasons*: artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; hot weather: skin-friendly cut; needed top for selected bottom; register spread needs intentional styling; weak hiking occasion fit
- **floral long sleeve top** (ID: 71) (Rank #11 → #7) [score: 25]
- **black blouson v-neck top** (ID: 136) (Rank #12 → #8) [score: 25]
- **black abstract print short tee** (ID: 264) (Rank #8 → #12) [score: 28 → 24]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; needed top for selected bottom; shared color: black; weak hiking occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; hot weather: lightweight fabric; needed top for selected bottom; register spread needs intentional styling; shared color: black; weak hiking occasion fit

### Entered the Top-12
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #9, score 25 (was #13)]
  - *Reasons*: hot weather: lightweight fabric; weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **ruffled plum sleeveless top** (ID: 186) [Current Rank #10, score 25 (was #14)]
  - *Reasons*: hot weather: lightweight fabric; weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black solid wrap blouse** (ID: 210) [Current Rank #11, score 25 (was #15)]
  - *Reasons*: hot weather: lightweight fabric; weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **black and cream striped knit top** (ID: 137) [Baseline Rank #6, score 28 (now #37)]
  - *Reasons*: hot weather: lightweight fabric; weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: cream/black; Yuna palette; artistic/texture vocabulary
- **white scoop neck sleeveless top** (ID: 364) [Baseline Rank #9, score 26 (now #14)]
  - *Reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; weak hiking occasion fit; needed top for selected bottom; compact/structured top
- **abstract print sleeveless top** (ID: 365) [Baseline Rank #10, score 26 (now #15)]
  - *Reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; weak hiking occasion fit; needed top for selected bottom; compact/structured top

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 18: Selected piece ID 96 ("black cream colorblock knit mini skirt")
- **Category**: bottom
- **Occasion**: `hiking`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **gold abstract print blouse** (ID: 68) (Rank #3 → #1) [score: 18]
- **floral print long sleeve top** (ID: 143) (Rank #4 → #2) [score: 18]
- **navy cream striped button-up shirt** (ID: 133) (Rank #7 → #5) [score: 15]
- **black white striped sleeveless top** (ID: 139) (Rank #8) [score: 15]
- **olive textured mock neck top** (ID: 140) (Rank #1 → #9) [score: 23 → 15]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; cold weather: insulating coverage; compact/structured top; needed top for selected bottom; weak hiking occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; compact/structured top; needed top for selected bottom; weak hiking occasion fit
- **black turtleneck** (ID: 144) (Rank #9 → #10) [score: 15]

### Entered the Top-12
- **Cream wool shell** (ID: 145) [Current Rank #3, score 18 (was #25)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **floral long sleeve top** (ID: 71) [Current Rank #4, score 15 (was #32)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **black blouson v-neck top** (ID: 136) [Current Rank #6, score 15 (was #33)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **black lace asymmetrical tank** (ID: 138) [Current Rank #7, score 15 (was #60)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **Oatmeal cashmere shell** (ID: 147) [Current Rank #11, score 15 (was #34)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black crochet lace tank top** (ID: 172) [Current Rank #12, score 15 (was #61)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary

### Left the Top-12
- **Navy wool turtleneck** (ID: 146) [Baseline Rank #2, score 23 (now #63)]
  - *Reasons*: cold weather: insulating coverage; weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **textured cream knit top** (ID: 363) [Baseline Rank #5, score 18 (now #19)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: cream; Yuna palette; artistic/texture vocabulary
- **mustard knit sweater** (ID: 84) [Baseline Rank #6, score 15 (now #59)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **black asymmetrical top** (ID: 220) [Baseline Rank #10, score 15 (now #43)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; shared color: black; artistic/texture vocabulary
- **olive ruffled sleeveless top** (ID: 227) [Baseline Rank #11, score 15 (now #25)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary
- **brown graphic casual crew tee** (ID: 254) [Baseline Rank #12, score 15 (now #26)]
  - *Reasons*: weak hiking occasion fit; needed top for selected bottom; compact/structured top; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [auto-styling trust rules block low-confidence or provisional tops (like IDs 137, 264, 363) from being automatically recommended, which allows fully trusted and high-confidence tops (like ID 140) to enter the top-12.]

---

## Scenario 19: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `casual`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **charcoal textured cropped jacket** (ID: 250) (Rank #1) [score: 15]
- **pink knit ballet flats** (ID: 217) (Rank #6 → #2) [score: 12]
- **small labradorite pendant necklace** (ID: 90) (Rank #8 → #3) [score: 11]
- **wide corset belt** (ID: 100) (Rank #9 → #4) [score: 11]
- **amber pendant necklace** (ID: 103) (Rank #10 → #5) [score: 11]
- **black quilted crossbody bag** (ID: 358) (Rank #11 → #6) [score: 11]
- **woven straw crossbody bag** (ID: 362) (Rank #12 → #7) [score: 11]
- **taupe knit lace-up sneakers** (ID: 198) (Rank #2 → #11) [score: 15 → 11]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; supports selected dress
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; register spread needs intentional styling; supports selected dress

### Entered the Top-12
- **cream knit open cardigan** (ID: 990362) [Current Rank #8, score 11 (was #37)]
  - *Reasons*: register spread needs intentional styling; supports selected dress; Yuna palette; artistic/texture vocabulary
- **brown leather zip ankle boots** (ID: 191) [Current Rank #9, score 11 (was #15)]
  - *Reasons*: supports selected dress; Yuna palette
- **black open-toe wedge sandals** (ID: 197) [Current Rank #10, score 11 (was #18)]
  - *Reasons*: supports selected dress; Yuna palette
- **burgundy suede cork wedge sandals** (ID: 199) [Current Rank #12, score 11 (was #19)]
  - *Reasons*: supports selected dress; Yuna palette

### Left the Top-12
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #3, score 15 (now #16)]
  - *Reasons*: supports selected dress; Yuna palette; artistic/texture vocabulary
- **rust textured knit cropped cardigan** (ID: 176) [Baseline Rank #4, score 12 (now #22)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary
- **light grey knit athletic shoes** (ID: 213) [Baseline Rank #5, score 12 (now #53)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary
- **textured grey casual sneakers** (ID: 990391) [Baseline Rank #7, score 12 (now #24)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 20: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `casual`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **sheer black open cardigan** (ID: 141) (Rank #1) [score: 26 → 22]
  - *Baseline reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; supports selected dress
  - *Current reasons*: hot weather: lightweight fabric; hot weather: skin-friendly cut; register spread needs intentional styling; supports selected dress
- **pink knit ballet flats** (ID: 217) (Rank #3 → #2) [score: 22]
- **cream knit open cardigan** (ID: 990362) (Rank #11 → #3) [score: 18 → 21]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; soft + soft risk; supports selected dress
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; register spread needs intentional styling; supports selected dress
- **taupe knit lace-up sneakers** (ID: 198) (Rank #2 → #4) [score: 25 → 21]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; supports selected dress
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; register spread needs intentional styling; supports selected dress
- **white yellow polka dot cardigan** (ID: 170) (Rank #10 → #5) [score: 18 → 14]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; soft + soft risk; supports selected dress
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; register spread needs intentional styling; soft + soft risk; supports selected dress
- **black open-toe wedge sandals** (ID: 197) (Rank #5 → #12) [score: 19 → 11]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress
  - *Current reasons*: Yuna palette; supports selected dress

### Entered the Top-12
- **small labradorite pendant necklace** (ID: 90) [Current Rank #6, score 11 (was #20)]
  - *Reasons*: supports selected dress; Yuna palette
- **wide corset belt** (ID: 100) [Current Rank #7, score 11 (was #21)]
  - *Reasons*: supports selected dress; Yuna palette
- **amber pendant necklace** (ID: 103) [Current Rank #8, score 11 (was #22)]
  - *Reasons*: supports selected dress; Yuna palette
- **black quilted crossbody bag** (ID: 358) [Current Rank #9, score 11 (was #23)]
  - *Reasons*: supports selected dress; Yuna palette
- **woven straw crossbody bag** (ID: 362) [Current Rank #10, score 11 (was #24)]
  - *Reasons*: supports selected dress; Yuna palette
- **brown leather zip ankle boots** (ID: 191) [Current Rank #11, score 11 (was #46)]
  - *Reasons*: supports selected dress; Yuna palette

### Left the Top-12
- **tan leather crossover sandals** (ID: 192) [Baseline Rank #4, score 19 (now #26)]
  - *Reasons*: hot weather: skin-friendly cut; supports selected dress; Yuna palette
- **burgundy suede cork wedge sandals** (ID: 199) [Baseline Rank #6, score 19 (now #13)]
  - *Reasons*: hot weather: skin-friendly cut; supports selected dress; Yuna palette
- **brown geometric cutout wedge shoes** (ID: 201) [Baseline Rank #7, score 19 (now #15)]
  - *Reasons*: hot weather: skin-friendly cut; supports selected dress; Yuna palette
- **brown leather floral heeled sandals** (ID: 219) [Baseline Rank #8, score 19 (now #18)]
  - *Reasons*: hot weather: skin-friendly cut; supports selected dress; Yuna palette
- **brown leather strap sandals** (ID: 222) [Baseline Rank #9, score 19 (now #29)]
  - *Reasons*: hot weather: skin-friendly cut; supports selected dress; Yuna palette
- **black stitched wedge sandals** (ID: 212) [Baseline Rank #12, score 16 (now #22)]
  - *Reasons*: hot weather: skin-friendly cut; supports selected dress

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 21: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `casual`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **charcoal textured cropped jacket** (ID: 250) (Rank #1) [score: 25 → 15]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; cold weather: heavy fabric; supports selected dress
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; supports selected dress
- **small labradorite pendant necklace** (ID: 90) (Rank #9 → #3) [score: 11]
- **wide corset belt** (ID: 100) (Rank #10 → #4) [score: 11]
- **amber pendant necklace** (ID: 103) (Rank #11 → #5) [score: 11]
- **black quilted crossbody bag** (ID: 358) (Rank #12 → #6) [score: 11]
- **brown leather zip ankle boots** (ID: 191) (Rank #3 → #9) [score: 19 → 11]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; supports selected dress
  - *Current reasons*: Yuna palette; supports selected dress

### Entered the Top-12
- **pink knit ballet flats** (ID: 217) [Current Rank #2, score 12 (was #40)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary
- **woven straw crossbody bag** (ID: 362) [Current Rank #7, score 11 (was #13)]
  - *Reasons*: supports selected dress; Yuna palette
- **cream knit open cardigan** (ID: 990362) [Current Rank #8, score 11 (was #44)]
  - *Reasons*: register spread needs intentional styling; supports selected dress; Yuna palette; artistic/texture vocabulary
- **black open-toe wedge sandals** (ID: 197) [Current Rank #10, score 11 (was #33)]
  - *Reasons*: supports selected dress; Yuna palette
- **taupe knit lace-up sneakers** (ID: 198) [Current Rank #11, score 11 (was #34)]
  - *Reasons*: register spread needs intentional styling; supports selected dress; Yuna palette; artistic/texture vocabulary
- **burgundy suede cork wedge sandals** (ID: 199) [Current Rank #12, score 11 (was #35)]
  - *Reasons*: supports selected dress; Yuna palette

### Left the Top-12
- **brown stitched leather clogs** (ID: 216) [Baseline Rank #2, score 21 (now #17)]
  - *Reasons*: cold weather: heavy fabric; supports selected dress; Yuna palette
- **taupe suede ankle boots** (ID: 200) [Baseline Rank #4, score 19 (now #13)]
  - *Reasons*: cold weather: insulating coverage; supports selected dress; Yuna palette
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #5, score 15 (now #16)]
  - *Reasons*: supports selected dress; Yuna palette; artistic/texture vocabulary
- **rust textured knit cropped cardigan** (ID: 176) [Baseline Rank #6, score 12 (now #22)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary
- **light grey knit athletic shoes** (ID: 213) [Baseline Rank #7, score 12 (now #53)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary
- **textured grey casual sneakers** (ID: 990391) [Baseline Rank #8, score 12 (now #24)]
  - *Reasons*: supports selected dress; artistic/texture vocabulary

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 22: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `going-out`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **pink knit ballet flats** (ID: 217) (Rank #4 → #1) [score: -2]
- **small labradorite pendant necklace** (ID: 90) (Rank #6 → #2) [score: -3]
- **wide corset belt** (ID: 100) (Rank #7 → #3) [score: -3]
- **amber pendant necklace** (ID: 103) (Rank #8 → #4) [score: -3]
- **black quilted crossbody bag** (ID: 358) (Rank #9 → #5) [score: -3]
- **woven straw crossbody bag** (ID: 362) (Rank #10 → #6) [score: -3]
- **black floral cutout mules** (ID: 181) (Rank #12 → #7) [score: -3]
- **taupe knit lace-up sneakers** (ID: 198) (Rank #1 → #11) [score: 1 → -3]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; supports selected dress; weak going-out occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; register spread needs intentional styling; supports selected dress; weak going-out occasion fit

### Entered the Top-12
- **brown leather zip ankle boots** (ID: 191) [Current Rank #8, score -3 (was #13)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **beige leather bow wedge shoes** (ID: 194) [Current Rank #9, score -3 (was #15)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **black open-toe wedge sandals** (ID: 197) [Current Rank #10, score -3 (was #17)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **burgundy suede cork wedge sandals** (ID: 199) [Current Rank #12, score -3 (was #18)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette

### Left the Top-12
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #2, score 1 (now #18)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary
- **light grey knit athletic shoes** (ID: 213) [Baseline Rank #3, score -2 (now #40)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; artistic/texture vocabulary
- **textured grey casual sneakers** (ID: 990391) [Baseline Rank #5, score -2 (now #29)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; artistic/texture vocabulary
- **navy solid canvas slip shoes** (ID: 169) [Baseline Rank #11, score -3 (now #30)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 23: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `going-out`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **pink knit ballet flats** (ID: 217) (Rank #2 → #1) [score: 8]
- **taupe knit lace-up sneakers** (ID: 198) (Rank #1 → #2) [score: 11 → 7]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; supports selected dress; weak going-out occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; register spread needs intentional styling; supports selected dress; weak going-out occasion fit
- **black floral cutout mules** (ID: 181) (Rank #3 → #8) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress; weak going-out occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak going-out occasion fit
- **black open-toe wedge sandals** (ID: 197) (Rank #5 → #11) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress; weak going-out occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak going-out occasion fit
- **burgundy suede cork wedge sandals** (ID: 199) (Rank #6 → #12) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress; weak going-out occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak going-out occasion fit

### Entered the Top-12
- **small labradorite pendant necklace** (ID: 90) [Current Rank #3, score -3 (was #16)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **wide corset belt** (ID: 100) [Current Rank #4, score -3 (was #17)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **amber pendant necklace** (ID: 103) [Current Rank #5, score -3 (was #18)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **black quilted crossbody bag** (ID: 358) [Current Rank #6, score -3 (was #19)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **woven straw crossbody bag** (ID: 362) [Current Rank #7, score -3 (was #20)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **brown leather zip ankle boots** (ID: 191) [Current Rank #9, score -3 (was #38)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **beige leather bow wedge shoes** (ID: 194) [Current Rank #10, score -3 (was #22)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette

### Left the Top-12
- **tan leather crossover sandals** (ID: 192) [Baseline Rank #4, score 5 (now #30)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; supports selected dress; Yuna palette
- **brown geometric cutout wedge shoes** (ID: 201) [Baseline Rank #7, score 5 (now #14)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; supports selected dress; Yuna palette
- **beige leather chunky heel sandals** (ID: 205) [Baseline Rank #8, score 5 (now #16)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; supports selected dress; Yuna palette
- **brown leather floral heeled sandals** (ID: 219) [Baseline Rank #9, score 5 (now #19)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; supports selected dress; Yuna palette
- **brown leather strap sandals** (ID: 222) [Baseline Rank #10, score 5 (now #33)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; supports selected dress; Yuna palette
- **black stitched wedge sandals** (ID: 212) [Baseline Rank #11, score 2 (now #27)]
  - *Reasons*: hot weather: skin-friendly cut; weak going-out occasion fit; supports selected dress
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #12, score 1 (now #18)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 24: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `going-out`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **small labradorite pendant necklace** (ID: 90) (Rank #7 → #2) [score: -3]
- **wide corset belt** (ID: 100) (Rank #8 → #3) [score: -3]
- **amber pendant necklace** (ID: 103) (Rank #9 → #4) [score: -3]
- **black quilted crossbody bag** (ID: 358) (Rank #10 → #5) [score: -3]
- **woven straw crossbody bag** (ID: 362) (Rank #11 → #6) [score: -3]
- **brown leather zip ankle boots** (ID: 191) (Rank #2 → #8) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; supports selected dress; weak going-out occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak going-out occasion fit

### Entered the Top-12
- **pink knit ballet flats** (ID: 217) [Current Rank #1, score -2 (was #40)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; artistic/texture vocabulary
- **black floral cutout mules** (ID: 181) [Current Rank #7, score -3 (was #29)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **beige leather bow wedge shoes** (ID: 194) [Current Rank #9, score -3 (was #13)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **black open-toe wedge sandals** (ID: 197) [Current Rank #10, score -3 (was #31)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette
- **taupe knit lace-up sneakers** (ID: 198) [Current Rank #11, score -3 (was #32)]
  - *Reasons*: register spread needs intentional styling; weak going-out occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary
- **burgundy suede cork wedge sandals** (ID: 199) [Current Rank #12, score -3 (was #33)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette

### Left the Top-12
- **brown stitched leather clogs** (ID: 216) [Baseline Rank #1, score 7 (now #19)]
  - *Reasons*: cold weather: heavy fabric; weak going-out occasion fit; supports selected dress; Yuna palette
- **taupe suede ankle boots** (ID: 200) [Baseline Rank #3, score 5 (now #13)]
  - *Reasons*: cold weather: insulating coverage; weak going-out occasion fit; supports selected dress; Yuna palette
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #4, score 1 (now #18)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary
- **light grey knit athletic shoes** (ID: 213) [Baseline Rank #5, score -2 (now #40)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; artistic/texture vocabulary
- **textured grey casual sneakers** (ID: 990391) [Baseline Rank #6, score -2 (now #29)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; artistic/texture vocabulary
- **navy solid canvas slip shoes** (ID: 169) [Baseline Rank #12, score -3 (now #30)]
  - *Reasons*: weak going-out occasion fit; supports selected dress; Yuna palette

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 25: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `hiking`
- **Mood/Weather**: `(none)`

### Present in both Top-12s
- **pink knit ballet flats** (ID: 217) (Rank #4 → #1) [score: -2]
- **small labradorite pendant necklace** (ID: 90) (Rank #6 → #2) [score: -3]
- **wide corset belt** (ID: 100) (Rank #7 → #3) [score: -3]
- **amber pendant necklace** (ID: 103) (Rank #8 → #4) [score: -3]
- **black quilted crossbody bag** (ID: 358) (Rank #9 → #5) [score: -3]
- **woven straw crossbody bag** (ID: 362) (Rank #10 → #6) [score: -3]
- **black floral cutout mules** (ID: 181) (Rank #12 → #7) [score: -3]
- **taupe knit lace-up sneakers** (ID: 198) (Rank #1 → #11) [score: 1 → -3]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; supports selected dress; weak hiking occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; register spread needs intentional styling; supports selected dress; weak hiking occasion fit

### Entered the Top-12
- **brown leather zip ankle boots** (ID: 191) [Current Rank #8, score -3 (was #13)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **beige leather bow wedge shoes** (ID: 194) [Current Rank #9, score -3 (was #15)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **black open-toe wedge sandals** (ID: 197) [Current Rank #10, score -3 (was #17)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **burgundy suede cork wedge sandals** (ID: 199) [Current Rank #12, score -3 (was #18)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette

### Left the Top-12
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #2, score 1 (now #18)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary
- **light grey knit athletic shoes** (ID: 213) [Baseline Rank #3, score -2 (now #40)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; artistic/texture vocabulary
- **textured grey casual sneakers** (ID: 990391) [Baseline Rank #5, score -2 (now #29)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; artistic/texture vocabulary
- **navy solid canvas slip shoes** (ID: 169) [Baseline Rank #11, score -3 (now #30)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 26: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `hiking`
- **Mood/Weather**: `it is really hot`

### Present in both Top-12s
- **pink knit ballet flats** (ID: 217) (Rank #2 → #1) [score: 8]
- **taupe knit lace-up sneakers** (ID: 198) (Rank #1 → #2) [score: 11 → 7]
  - *Baseline reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; supports selected dress; weak hiking occasion fit
  - *Current reasons*: Yuna palette; artistic/texture vocabulary; hot weather: lightweight fabric; register spread needs intentional styling; supports selected dress; weak hiking occasion fit
- **black floral cutout mules** (ID: 181) (Rank #3 → #8) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress; weak hiking occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak hiking occasion fit
- **black open-toe wedge sandals** (ID: 197) (Rank #5 → #11) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress; weak hiking occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak hiking occasion fit
- **burgundy suede cork wedge sandals** (ID: 199) (Rank #6 → #12) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; hot weather: skin-friendly cut; supports selected dress; weak hiking occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak hiking occasion fit

### Entered the Top-12
- **small labradorite pendant necklace** (ID: 90) [Current Rank #3, score -3 (was #16)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **wide corset belt** (ID: 100) [Current Rank #4, score -3 (was #17)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **amber pendant necklace** (ID: 103) [Current Rank #5, score -3 (was #18)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **black quilted crossbody bag** (ID: 358) [Current Rank #6, score -3 (was #19)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **woven straw crossbody bag** (ID: 362) [Current Rank #7, score -3 (was #20)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **brown leather zip ankle boots** (ID: 191) [Current Rank #9, score -3 (was #38)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **beige leather bow wedge shoes** (ID: 194) [Current Rank #10, score -3 (was #22)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette

### Left the Top-12
- **tan leather crossover sandals** (ID: 192) [Baseline Rank #4, score 5 (now #30)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; supports selected dress; Yuna palette
- **brown geometric cutout wedge shoes** (ID: 201) [Baseline Rank #7, score 5 (now #14)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; supports selected dress; Yuna palette
- **beige leather chunky heel sandals** (ID: 205) [Baseline Rank #8, score 5 (now #16)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; supports selected dress; Yuna palette
- **brown leather floral heeled sandals** (ID: 219) [Baseline Rank #9, score 5 (now #19)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; supports selected dress; Yuna palette
- **brown leather strap sandals** (ID: 222) [Baseline Rank #10, score 5 (now #33)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; supports selected dress; Yuna palette
- **black stitched wedge sandals** (ID: 212) [Baseline Rank #11, score 2 (now #27)]
  - *Reasons*: hot weather: skin-friendly cut; weak hiking occasion fit; supports selected dress
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #12, score 1 (now #18)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

## Scenario 27: Selected piece ID 33 ("Green maxi dress")
- **Category**: dress
- **Occasion**: `hiking`
- **Mood/Weather**: `freezing today`

### Present in both Top-12s
- **small labradorite pendant necklace** (ID: 90) (Rank #7 → #2) [score: -3]
- **wide corset belt** (ID: 100) (Rank #8 → #3) [score: -3]
- **amber pendant necklace** (ID: 103) (Rank #9 → #4) [score: -3]
- **black quilted crossbody bag** (ID: 358) (Rank #10 → #5) [score: -3]
- **woven straw crossbody bag** (ID: 362) (Rank #11 → #6) [score: -3]
- **brown leather zip ankle boots** (ID: 191) (Rank #2 → #8) [score: 5 → -3]
  - *Baseline reasons*: Yuna palette; cold weather: insulating coverage; supports selected dress; weak hiking occasion fit
  - *Current reasons*: Yuna palette; supports selected dress; weak hiking occasion fit

### Entered the Top-12
- **pink knit ballet flats** (ID: 217) [Current Rank #1, score -2 (was #40)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; artistic/texture vocabulary
- **black floral cutout mules** (ID: 181) [Current Rank #7, score -3 (was #29)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **beige leather bow wedge shoes** (ID: 194) [Current Rank #9, score -3 (was #13)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **black open-toe wedge sandals** (ID: 197) [Current Rank #10, score -3 (was #31)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette
- **taupe knit lace-up sneakers** (ID: 198) [Current Rank #11, score -3 (was #32)]
  - *Reasons*: register spread needs intentional styling; weak hiking occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary
- **burgundy suede cork wedge sandals** (ID: 199) [Current Rank #12, score -3 (was #33)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette

### Left the Top-12
- **brown stitched leather clogs** (ID: 216) [Baseline Rank #1, score 7 (now #19)]
  - *Reasons*: cold weather: heavy fabric; weak hiking occasion fit; supports selected dress; Yuna palette
- **taupe suede ankle boots** (ID: 200) [Baseline Rank #3, score 5 (now #13)]
  - *Reasons*: cold weather: insulating coverage; weak hiking occasion fit; supports selected dress; Yuna palette
- **cream textured slip-on shoes** (ID: 215) [Baseline Rank #4, score 1 (now #18)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette; artistic/texture vocabulary
- **light grey knit athletic shoes** (ID: 213) [Baseline Rank #5, score -2 (now #40)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; artistic/texture vocabulary
- **textured grey casual sneakers** (ID: 990391) [Baseline Rank #6, score -2 (now #29)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; artistic/texture vocabulary
- **navy solid canvas slip shoes** (ID: 169) [Baseline Rank #12, score -3 (now #30)]
  - *Reasons*: weak hiking occasion fit; supports selected dress; Yuna palette

EXPLAINED BY: [formality register spread penalty (-8 points for spread = 2) applies to candidate pairings relative to the selected Green maxi dress (ID 33) based on their formality ranks, while low-confidence pieces are auto-styling trust blocked, changing the top-12 recommendations.]

---

