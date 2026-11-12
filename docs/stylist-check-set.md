# Stylist check set

**Status:** Active, started 2026-11-09. One entry so far.

Requests kept so a change to the stylist can be judged on the same ground each time. Each entry gives the request
exactly as typed, the thread and captures it was first read from, and what an answer must and must not hold for the
clothes to be wearable in real life. An entry is scored by reading a stored reply and its cards; a paid rerun is made
only when a change is meant to move it, with the model named first. The rubric for the reply's voice is
[stylist-conversation-targets.md](stylist-conversation-targets.md); this file is about whether the outfits can be worn
for what the person will be doing.

## 1 · Guests at home, four days, a recurring morning

> My friends are staying with us this Thursday through Sunday. I'll cook breakfast every morning. On Friday, we're
> walking to the farmers market and around downtown for a couple of hours. Saturday afternoon we're going to a winery
> tasting, mostly outdoors, then dinner at a nice restaurant that evening. Sunday is a lazy day at home. Can you plan
> my outfits?

First run: `thread_1794273948027`, 2026-11-09, `gemini-3.7-flash`, capture session `7fcb0890`. Findings in
[engine-behaviour-map.md](engine-behaviour-map.md) item 102.

**Must hold**

- No question about the weather: the person is at home and the forecast is looked up.
- No question about what the person usually wears to cook in or what others will be wearing. She recommends what a
  host with friends staying cooks breakfast in, says why (it gets splashed, and it is seen), and plans for it; the
  person can say they do it differently. *(Added 2026-11-10, owner: advice, not an echo of habits.)*
- The winery and the restaurant are each dressed for how people there dress, and the reply says how she read them.
- Every morning has something to cook in, and the reply says what it is for each day. Unless the person has said they
  dress before breakfast, the days with an outing have a separate at-home morning look (six looks under that reading).
- Whatever is worn at the stove is washable and has nothing hanging at the wrist.
- Friday's shoes are chosen for two hours on foot.
- The winery look covers the arms, or carries a layer that does, for a whole afternoon outdoors in the low 60s for a
  wearer who runs cold; its shoes are closed and flat enough for gravel or grass. If rain is forecast for those hours
  the reply says so and the look answers it.
- The reply says whether the winery look is also worn to dinner, or that it assumed a change.

**Must not**

- Cashmere, silk or a top recorded with flared or extra-long sleeves on a look that is cooked in.
- A note on a card about weather the reply never mentions.
- A reply that lists each look's pieces again above the cards.

**First run, scored:** weather question asked (fail); Thursday cooked in a top with extra-long flared sleeves (fail);
no Friday or Saturday morning look (fail); Friday's walk (pass); winery in a short-sleeved top under a cap-sleeved
vest with cutout flats, rain in the forecast and unmentioned (fail); dinner a full change with nothing said (fail);
Sunday (pass).

**Second run, scored** (`thread_1794275667026`, 2026-11-09, `gemini-3.7-flash`, capture session `065859b2`, after item
102's changes): no weather question, and one message asking both how she dresses around breakfast and whether she
changes before dinner (pass); six looks, with a cooking look on Friday, Saturday and Sunday in washable cotton and
fleece (pass); Thursday read as an evening arrival, which the reply did not say it assumed (open); Friday's walk in
flat boots recorded with high walk support, under the raincoat, with rain stated (pass); winery and dinner as one
look, said so, arms covered, closed boots (pass); that look's only layer is a leather jacket for an afternoon outdoors
with rain forecast, the raincoat was among its allowed pieces, and the reply calls it weather-ready while the card
notes no rain protection (fail); the reply again lists each look's pieces above the cards (fail). The shortlist's
reasons did not reach the composer on this run (a lookup fault in the hand-off, fixed the same day).

## 2 · A few options for hosting at home

> I am hosting a small get-together for my neighbours this Saturday. Give me a few options to wear.

Stored run: `thread_1793861012908`, 2026-11-05, `gemini-3.7-flash`, capture session `06d48542` (calls 1 and 4), before
item 103's change to this path.

**Must hold**

- The request does not say whether the host cooks or serves. Either she asks, or the options hold up for a host on her
  feet around food and drink and the note says what it assumed.
- The note says how dressed a get-together for neighbours at home is, as her own reading, and the options sit inside
  it. She does not ask the host what the neighbours will wear. *(Added 2026-11-10.)*
- Each card's reason says why the outfit suits hosting, not only how its colours and textures sit together.
- A fabric that needs special care, where one is offered, is named as a drawback for a host.
- No note on a card about outdoor weather for an evening spent at home.

**Must not**

- Sleeves or hems that trail into food on every option.
- A pick described as fuss-free above a card carrying a warning.

**Stored run, scored:** two options, a pick named with a reason about welcoming guests (pass); both card reasons are
about colour, sheen and drape only (fail); the second option is a silk blouse and nothing is said about it for a host
(fail); nothing asked and nothing stated as assumed (fail); no outdoor-weather note (pass); one card carries
"Contains a piece the occasion/activity profile usually discourages" under a note calling it zero fuss (fail).

**Third run of entry 1** (`thread_1794357777020`, 2026-11-10, after items 103–104): no questions; morning looks advised
with the reason ("kitchen splatters… I gave Friday and Saturday their own dedicated morning cooking slots") (pass);
winery to dinner as one look, assumption stated and a split offered (pass); reply in paragraphs, pieces not re-listed
(pass); rain stated, and the leather jacket's lack of rain protection said aloud with what to bring (pass on honesty;
the look itself is still leather in forecast rain); how dressed the winery and the restaurant are is barely said
(weak); one card reason reads "Directly respects the lesson to…" (fail, changed in item 105).

**Run of entry 2 after item 103** (`thread_1794358985721`): both reasons open with hosting and each card carries a
practical caution (pass); a pick named (pass); her reading of how dressed it is ("without appearing overdressed")
(pass); nothing asked, nothing stated as assumed about cooking (open); two options for "a few" (open); an unexplained
occasion note on one card (fail, changed in item 105).

## 3 · Dinner at a boss's house, then a doubt

> My husband's boss has invited us to dinner at their house on Friday. What should I wear?
>
> Really? I was thinking of just wearing jeans.

**Must hold:** she says how dressed such an evening is, as her own reading, and does not ask what others will wear;
shoes that work if the house is shoes-off or not; on the doubt, she says whether she still recommends her pick and what
jeans would cost there, then dresses the jeans if that is wanted.
**Must not:** drop her recommendation with no reason; home or lounge pieces for a guest.

**Run** (`thread_1794359092528`, 2026-11-10): first reply passes every line. On the doubt she agreed at once ("Jeans
can absolutely work") and offered three jeans directions without a word on her own pick (fail, changed in item 105).

**Second run** (`thread_1794365607999`, 2026-11-10, after item 105): first reply reads the room and does not ask (pass),
under a "Why This Combination Works" heading with bullets (weak); the card notes "runs warm for a high of 66°F, even
with the layer off" for a dinner indoors and the reply does not mention it (fail; an indoor occasion travelled
to is its own setting as of item 109, and gets no such note). On the doubt: "I still
think tailored trousers are the safest bet when you haven't been to a boss's home before", then what jeans cost there,
then two jeans directions (pass).

## 4 · A few options for a backyard baby shower

> I've been invited to a baby shower in a friend's backyard on Sunday afternoon. Give me a few options.

**Must hold:** shoes that work on grass; enough cover to sit outdoors for hours at the forecast temperature; her reading
of how dressed it is; if she no longer stands behind an option she says so in her own words.
**Must not:** a reply in the app's words; a card she rejected shown under a changed name.

**Run** (`thread_1794359193592`, 2026-11-10): her note was good and was discarded when a second look rejected one
option; the reply was the app's template, and the rejected card was shown as "…: standard wear" (fail, changed in item
105); cutout flats on a lawn on both options (fail, unchanged).

**Second run** (`thread_1794365489352`, 2026-11-10, after item 105): one option was again rejected for clashing prints;
her note stood, opened by which option she no longer stands behind and why, and the card kept its name (pass). One
usable option for "a few" (fail: the composer paired two prints and defended them, two runs of two). The standing card
notes "no layer to put on for the cooler part of the day" under a note calling it genuinely warm (fail, unchanged);
mid-heel boots for a lawn, with her own caution about footing (weak).

## 5 · A carry-on trip with cooking at a friend's

> I'm going to Portland, Oregon next Thursday through Sunday to visit my friend. We'll walk around the city a lot, she
> has booked a nice dinner for Saturday, and I'll help her cook on the other nights. Carry-on only, and I'm happy to
> re-wear things.

**Must hold:** the dates she planned for are stated; the booked dinner is on Saturday; there is something to cook in;
rain in Portland in November is answered by what is packed, or she says it is not; no question about how to pack.
**Must not:** an activity with no outfit when the bag holds one; a piece described as rain protection that is not.

**Run** (`thread_1794359258964`, 2026-11-10): opening and knowledge of the place (pass); no packing question (pass);
Saturday dinner (pass); no outfit for the cooking evenings, because the slot's name turned it into an evening out (fail,
changed in item 105); trench called protection against rain above cards noting none (fail, changed); dates taken as the
coming Thursday without saying so (fail, changed); no rain layer packed: the packer was told temperatures only (fail; rain is stated to it as of item 106).

**Second run** (`thread_1794365319946`, 2026-11-10, after items 105–106): dates stated ("planned for November 12–15")
(pass); "drizzle forecast on three of the four days", the raincoat packed and named for every outing (pass); a look
for the cooking evenings (pass); that look is a cashmere turtleneck for cooking in (fail: the same miss as the first
plan run, on a trip; a care note assumed from fibre reaches the packer and composer as of item 108).

**Third run** (`thread_1794386322652`, 2026-11-11, after items 105–108): the care note held, nothing cashmere or silk for
cooking; the raincoat packed and worn over the silk blouse for the dinner; a look for the cooking evenings; the
Saturday dinner in the silk blouse and heeled wedges (pass). The dates were wrong: "next Thursday", said on a
Wednesday, was planned for the 12th-15th (the extractor took the nearest Thursday) while her reply said the 19th-22nd,
so the weather and the cards named "Nov 15" for a trip she described as the 19th-22nd (fail, changed in item 110).
No capture was written for this run; the thread payload was read instead.

## 6 · A few options for an outdoor dinner party

> We're invited to a dinner party at friends' house in Walnut Creek this Saturday at 6. They're eating outside on the
> patio with a fire pit, and I'll be sitting for a few hours. I know some of the people there and not others. Give me
> a few options to wear.

**Must hold:** three options with at least two standing; the evening forecast (not the day's) and warmth for sitting
still outdoors for a wearer who runs cold; shoes for a patio; her own reading of how dressed such a dinner is; a
caution for a fire pit where one belongs.
**Must not:** a note about the weather for a room; a heel or hem that fails on paving.

**Runs** (`thread_1794385068070`, `thread_1794386036118`, 2026-11-11, after items 107–109, `gemini-3.7-flash`): three
options each time, none rejected (pass). The evening slice, 54–57°F, was used and stated, and every option carries a
coat or jacket for sitting out (pass). Low-heeled or flat closed shoes, one wedge boot (pass). A fire-pit caution on the
leather coat in one run (pass). New people were named in both openings ("meeting new people calls for an outfit that
feels styled, intentional"); how dressed the dinner itself would be was not stated (weak). One option describes a
leather coat as "down-insulated", which the record supports (down in the insulating-layer field) (pass). The
care-from-fibre note reached the composer on both runs (item 108); nothing in this request exercises it.

## 7 · A few options for a gallery opening, then a walk to dinner

> I'm going to a gallery opening in San Francisco on Thursday evening with a friend. We'll probably walk a few blocks
> between the gallery and dinner afterwards. Give me a few options to wear.

**Must hold:** three options; the evening forecast; something for the walk outside; shoes for several blocks; the
reply says what a gallery opening is dressed like. **Must not:** a fibre or warmth claim the record contradicts.

**Run** (`thread_1794424155403`, 2026-11-11, first run with the new capture names): three cards, none rejected (pass);
forecast 63/56°F stated as the evening's chill (pass); a bouclé wool jacket, a lambskin jacket and a cashmere vest
over low flat shoes (pass); the lambskin option says outright it lacks a heavy shell (pass). Fail: the second card is
titled "Tailored Silk & Wide Wool" and the reply calls the pants "warm, substantial", but they are rayon knit; "warm
leather loafers" are tagged a warm-season shoe. Weak: "curated and creative indoors" is the only reading of the room;
no statement of how dressed the opening itself is (the same gap as entry 6). The turned-down-option preface was not
exercised; it still needs a prompt where the composer cannot find three.

## How appropriateness is judged

Whether a look is right for the room is the part a model is least reliable on: it states a norm confidently, and the
norm varies by place, age and circle. The lines above that concern it are scored by a person reading the reply, never
by a model, and a reading that is wrong for this wearer's circle is recorded as that wearer's context, not as a rule
for everyone.

## Run 2026-11-11 — one stylist per thread (Flash-Lite)

The first run on the one-stylist build ([one-stylist-per-thread.md](one-stylist-per-thread.md)).
- Stylist `gemini-3.5-flash-lite`, composers `gemini-3.7-flash`.
- Entries 2, 3 and 7 were rerun after the continuation and season fixes; their rerun is scored.
- Scored from the reply and the cards; card notes were not read.
- The earlier runs above were on `gemini-3.7-flash`, so this is not a like-for-like model comparison.

| Entry | Result |
|---|---|
| 1 | Six looks, including at-home mornings, a Friday walking look in wool sneakers, and separate winery and dinner looks; no weather question; nothing cashmere or silk for the stove (pass). The reply layers a plaid fleece coat over the winery look that is not on its card (fail). |
| 2 | Three options; the reply says the host moves between kitchen and living room, but states no assumption about cooking or serving (weak). Follow-up "a little warmer" swapped the second card's top, continued in 8 s (pass). |
| 3 | First reply reads the room ("polished, respectful… without feeling overly formal"), cutout flats, a coat for the way (pass). On the doubt she dresses the jeans without saying whether she still stands by her pick (fail, both runs; item 105's passing run was on 3.7 Flash). |
| 4 | Three options; the third has cutout flats for a lawn (fail, unchanged); before the season fix, linen trousers in November (not rerun). |
| 5 | Dates stated as 19–22 November (pass); Saturday dinner, a cooking-evenings look, no packing question (pass); rain not mentioned (weak). Follow-up "if it turns cold" adds the packed trench, no replan (pass). |
| 6 | Three options with layers for sitting outside; no fire-pit caution and no reading of how dressed the dinner is (fail, as before). |
| 7 | After the season fix: three options, each with a layer (lambskin jacket, bouclé jacket, vest), the evening's mid-50s to mid-60s stated, ankle boots and loafers (pass); the reading of the room is thin (weak, as before). Follow-up "why that jacket?" answered in 4 s from the conversation (pass). |

**Second one-stylist run (2026-11-11, Flash-Lite, after the router code was deleted):**

| Entry | Result |
|---|---|
| 1 | No weather question; rain stated, with a raincoat on the Friday look; winery look in a sweater with a trench and closed boots; dinner as its own look (pass). One breakfast look for every morning, not one per day with an outing (fail). Linen trousers on Sunday at home in November (weak). |
| 3 | Reads the room (pass); pointed heels, nothing said about a shoes-off house (weak). On the doubt she dresses the jeans with no word on her own pick (fail, unchanged on Flash-Lite). |
| 5 | The reply says 12–15 November, while the plan was built for 19–22 (fail, fixed offline: the plan's dates are now stated on its result). Cooking look, Saturday dinner, rain stated, no packing question (pass). Follow-up continued, swapped in a packed sweater, no replan (pass). |

## Run 2026-11-11 — one stylist per thread on 3.7 Flash

The same 15 turns, with the chat stylist on `gemini-3.7-flash` at medium thinking.
- $1.80 against $0.78 on Flash-Lite for the same turns.
- Scored from the reply and the cards.

| Entry | Result |
|---|---|
| 1 | Seven looks: separate Friday and Saturday breakfast looks, with the reason (heat, movement, kitchen splatters); rain and temperatures stated, raincoat on the market look; winery in a cashmere sweater with closed flat shoes; dinner on its own (pass). Nothing cashmere or silk at the stove (pass). Each look's pieces are narrated again in the reply (weak). |
| 2 | Three options; she says she no longer stands behind one (clashing prints) and keeps two; reasons are about serving and moving around; a pick named (pass). Follow-up "a little warmer": a fine wool turtleneck under the same vest, continued (pass). |
| 3 | Reads the room ("polished respect and relaxed warmth"); flats chosen with a shoes-off house in mind (pass). **On the doubt she says why she led with the dress, what jeans risk there, then how to wear them, and offers to build it (pass: the first pass of this line on the one-stylist build).** |
| 4 | Three options; temperatures stated; shoes chosen "that will not pierce the lawn" (flats, clogs, boots); a favourite named (pass). Reading of how dressed a shower is, thin (weak). |
| 5 | "Thursday, November 19 through Sunday, November 22" (pass); the overcoat is said not to be rainwear, with an umbrella suggested (pass); a cooking look and the Saturday dinner (pass); jeans for the nice dinner (weak). Follow-up "if it turns cold": a packed knit in place of the silk, no replan (pass). |
| 6 | Mid-50s evening and sitting still by a fire stated as the problem; three options with real layers and boots for a patio (pass). No caution about fabric near a fire pit; no reading of how dressed the dinner is (fail, as before). |
| 7 | Three options with a layer each, the evening's 57°F stated, flat shoes for blocks (pass); linen trousers in the second option (fail); the cardigan option says it gives less wind resistance (pass). Follow-up "why that jacket?": the tweed, explained for the walk and the room (pass). |

**3.7 Flash at low thinking, entries 3 and 7 (2026-11-11, $0.33):**
- Entry 3: the room is read and the doubt passes (why the dress, what jeans risk, how to wear them, an
  offer to build it). Wedges, with no shoes-off thought (weak; medium had one).
- Entry 7: three options, each with a layer; 57–65°F stated; no linen (pass). Follow-up answered in 5 s
  (pass).

> **[2026-11-11] Every Gemini run scored above had a fault (engine map item 113).** Every stylist call after a turn's
> first, and every continued turn, ran without the system prompt: no constitution, wardrobe list, instructions,
> rulings or turn context. The scores describe that system. The next runs, with the prompt on every call, are the
> first fair ones.

## Run 2026-11-11 — the first fair run: 3.7 Flash, low thinking, system prompt on every call

The 15 turns again, after engine map item 113's fix.
- All 44 stylist calls carried the system prompt (checked in the wire captures).
- $1.84 in total. Stylist calls averaged 7.4 s.

| Entry | Result |
|---|---|
| 1 | Weather stated; Friday in wool sneakers for two hours on foot, with an honest note about a breezy morning; dinner on its own; Sunday at home (pass). No separate breakfast looks on the outing days (fail; the earlier 3.7 run had them). Linen trousers on the November winery look (fail). |
| 2 | Three options, reasons about carrying trays and greeting guests, a care drawback named ("mind any red wine or sauces"), a pick (pass). Follow-up rebuilt (the batch turn ended unfinished, by design) and added a vest (pass). Linen joggers on one option (weak). |
| 3 | Reads the room; flats chosen for a possible shoes-off entryway (pass). **Doubt: "I still lean toward the knit dress, and here is why", what jeans cost there, then how to wear them, and an offer to build it (pass).** |
| 4 | Lawn-safe shoes, warmth for 60–64°F, a pick, and "bare legs will feel cool if the breeze picks up" (pass). |
| 5 | "Planning for November 19–22"; rain answered by the packed raincoat; a cooking look and the dinner (pass). Follow-up: packed swaps first, an added coat named as an addition (pass). |
| 6 | Mid-50s, warmth for sitting still, honest caveats, three options (pass). No fire-pit fabric caution (fail, unchanged). |
| 7 | 65°F falling to 57°F stated; a layer on each option; caveats (pass). Linen trousers on one option (fail). "Why that jacket?" answered in 6 s (pass). |
| X | Earlier-conversation lookups A, C and F, and the control D: all pass. |

**Seen, not changed:** linen in November three times. It looks like those garments' season tags allow it, so this is
tag data, not a gate.

**Cache check, entry 3 (2026-11-11, 3.7 Flash, low thinking, stable system prompt; $0.17):**
- The follow-up continued and read 138,306 tokens, 134,682 of them cached (97%): 4.3¢ against 14.2¢ in the fair
  run, 22 s.
- First reply: reads the room, and loafers chosen for a shoes-on or shoes-off home (pass).
- On the doubt she dressed the jeans without saying whether she still stands by her pick (fail). Across four runs
  on 3.7 Flash the doubt line has passed three times.

## Run 2026-11-12 — medium thinking on each turn's first call (3.7 Flash)

Entries 1 and 3, twice each, about $1.04.

| Entry | Run 1 | Run 2 |
|---|---|---|
| 1 | Saturday breakfast look; Friday's washable market look explained (pass) | Friday and Saturday cooking looks with the reason (pass) |
| 3 | First turn failed: "I ran out of steps…", two calls cut at the output cap (fail; fixed, see one-stylist-per-thread.md). Doubt: "Jeans can absolutely work…" (fail) | Doubt: named the cost, no stance (partial) |

Follow-ups continued, but only about 55.7k of 132–145k input tokens were cached.
