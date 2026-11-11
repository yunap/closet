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

## How appropriateness is judged

Whether a look is right for the room is the part a model is least reliable on: it states a norm confidently, and the
norm varies by place, age and circle. The lines above that concern it are scored by a person reading the reply, never
by a model, and a reading that is wrong for this wearer's circle is recorded as that wearer's context, not as a rule
for everyone.

