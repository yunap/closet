// Stage 1 A/B scenarios, shared by the harness and the review-sheet builder. Identical context per arm.
export const SCENARIOS = {
  S1: { label: '65/50 sedentary', activity: 'none', user_weather: { high_f: 65, low_f: 50 },
    situation: "I'll be outside from about 4–8 p.m.; it will be 65°F when I leave and around 50°F by the time I return. No hiking or other physical activity." },
  S2: { label: '46°F walking', activity: 'walking', user_weather: { high_f: 46, low_f: 46 },
    situation: 'A brisk walk outside tomorrow morning; it will be 46°F and partly cloudy.' },
  S3: { label: '72/62 mild', activity: 'none', user_weather: { high_f: 72, low_f: 62 },
    situation: "I'll be out from about noon to 5 p.m.; it will be 72°F at the warmest and 62°F by the end. No hiking or other physical activity." },
}
