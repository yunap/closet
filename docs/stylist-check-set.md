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

