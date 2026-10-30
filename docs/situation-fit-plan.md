# Situation fit: outfits that suit what the day holds

**Status:** draft plan for owner review, 2026-10-30. Step 0 is done (commit `0a1e292`); nothing else is implemented.
Owner decisions are marked **Decide**.

## 1 · Why

Two runs of one request (`thread_1793331707106` on Flash-Lite, `thread_1793331990443` on 3.7 Flash):

> have guests coming to stay with us from today through Sunday. Can you put together a set of outfits for me to use in
> the mornings? Then a few for daytime outings and one to go out to the restaurant on Saturday.

What went wrong, read from the captures:

- **The mornings were dressed for 48°F outside.** The slot was `indoor`, so it carried "indoor; transit: mornings
  48–63°F" although nobody was going out. The shortlist's own prompt tells it to read tops "against the temperatures
  they will actually be worn in", and the only temperature it had was the outdoor low. It shortlisted cashmere
  sweaters "to keep morning hosting warm", with washable cotton tops in the candidate list. *(Fixed by step 0.)*
- **Too few looks.** Both models gave the mornings `count: 2` for three mornings (Fri–Sun; it was Thursday evening).
  The no-rotation ruling (2026-10-27) was in the tool description word for word, and nothing checks the count.
- **The cards were judged by the slot's name, not its use.** Neither the shortlist nor the composer weighed fabric
  care, spills, sleeves or fuss against the likely moments of a hosting morning, and nothing reviewed the finished
  looks. The same gap let through a ditsy floral blouse under a tapestry jacket over tweed (3.7 Flash, outing 2).

The outside review (2026-10-30) set the direction: understand the situation before choosing garments (who the wearer
is in it, what is likely, the conditions, what is uncertain); choose outfits that hold up across the plausible moments
without losing their looks; ask only when the answer would change the clothes; prove it with a rerun of this request,
judged on practical and interesting clothes, not merely "no cashmere".

## 2 · What was already tried (do not repeat blind)

On `wip/situation-read-set-aside` (set aside 2026-10-29: "live runs showed no better outfits"):

| Tried | What it showed |
|---|---|
| Situation read turn + `get_weather` | Her read of the days was good; it did not reach the garments. |
| `wearing_strategy` per slot (free text, to shortlist and composer) | With strategies written by hand from her read: no sweaters in 2 paid runs. Live, she wrote **moods** ("Cozy, relaxed morning host look"), and the shortlist took cashmere again. |
| `time_outside` (`none` / `brief` / `to_and_from`) | Built offline, never shown live. Step 0's `home` is its `none`; `brief` was not carried over. |
| Asking the model to critique a finished look | Rejected the stripe-on-stripe cardigan look 2/2 with the same fix (`scratch/garment_read_runs/2026-10-29/critique_sunday/`, $0.016). **The judgment exists; the plan never asks for it.** |

Lesson carried forward: free text from the stylist turns into moods, and wording alone has not moved the shortlist.
What has worked is **facts** (the honest temperature) and **asking the model a direct question about a finished
look**.

## 3 · Steps

Each step lands and is verified offline before the next. Paid runs only where marked, with the model named.

### Step 0 — home slots get no outdoor weather · done (`0a1e292`)
`environment: 'home'`: no travel or time outdoors; no outside numbers, "the indoor temperature was not stated".

### Step 1 — one look per day · built, then removed (2026-10-30)
A `dates` field per slot set the look count from the days a use case happens (commit `709f6c3`). Step 2's run did
not fill it in, and it did not inform any styling decision: a home slot has no weather, a multi-day slot kept the
plan's weather range, and a one-day slot already had `date`. Owner: "unless having dates will help the model make the
right styling decisions I do not need dates." Removed; slots use `count` as before. The no-rotation ruling's sentence
is unchanged, and it is still not followed (three mornings got two looks in all three runs).

### Step 2 — one paid check before building more (≈ 2–4 cents)
Rerun the original request once on **3.7 Flash** and once on **Flash-Lite**, after steps 0–1. Read: does she choose
`home` for the mornings; how many morning looks; which tops the shortlist takes and why. This decides how much of
steps 3–5 is needed: if the honest temperature alone moves the shortlist to practical, good-looking tops, step 3
shrinks to the pieces the run still shows missing.
**Run 2026-10-30, 3.7 Flash (owner's choice), one turn, $0.137** (estimate was wrong: 6 calls, the roster call
alone $0.042). `scratch/freeform_turn_on_model_now.mjs`, DB copy, Thursday 21:44 PT like the original; output and
captures in `scratch/garment_read_runs/2026-10-30/guests_step2_37flash*`.
- She set the mornings `environment: 'home'`; the shortlist and composer saw no outdoor weather for them, and her
  reply said "Indoor lounging with guests (no outdoor transit)".
- **She did not send `dates`** (mornings `count: 2` again; the plan still ran Thursday–Sunday). Step 1's lenient
  fallback kept the bug.
- Shortlist: no cashmere for the mornings. Morning tops were the striped cotton tee, the mauve terry knit
  (polyester/nylon) and the grey cowl lounge top, with sage and grey knit trousers and the striped wool cardigan;
  the two cashmere sweaters went to the outings. Morning looks: mauve knit + sage lounge pants + olive slip-ons; grey
  cowl top + grey knit trousers + slip-ons. Practical and washable; plain rather than interesting, and the cardigan
  went unused.
- Outings: stripe tee + boyfriend jeans + wool sneakers, plaid fleece coat assigned; floral cashmere + emerald
  corduroy + wool sneakers (the corduroy picks up the sweater's green hem — checked on the photos). Dinner: charcoal
  wrap dress + low black ankle boots, herringbone coat assigned.
- The reply named neither assigned coat and told her to "bring a light jacket" for the outing whose card carries the
  fleece coat; it again described the mornings as "making coffee, chatting over breakfast" (inferred, unflagged).

Reading for steps 3–5: the honest temperature alone removed the cashmere from the mornings, so steps 3–4 are no
longer driven by this case; what remains is whether the looks are interesting (owner's rating), the missing `dates`,
and the reply not matching its cards.

### Step 3 — the situation, as facts the shortlist and composer read (code + schema)
Not free text: each slot gains short structured lists the stylist fills when she plans:

- `known` — what the user said happens ("restaurant dinner on Saturday").
- `likely` — what she infers, labelled as inferred ("breakfast and coffee with guests; some kitchen time").
- `uncertain` — what she does not know and has not asked ("whether you cook").

They reach the shortlist's use-case line and the composer's slot verbatim, under one sentence: the outfits must hold
up across the likely moments, and an inferred moment is never treated as a requirement. No keyword reader touches
them (pinned by a test, as `wearing_strategy` was). Asking for activities rather than a "strategy" is the change
meant to stop moods; step 2's run and this step's offline rebuild show whether it does.

### Step 4 — the shortlist answers two questions per piece (schema)
`piece_jobs` entries split into `look` (what it brings to a good-looking outfit) and `use` (which known or likely
moments and conditions it suits, and any practical cost — care, spills, sleeves, warmth, fuss). The selection prompt
says a piece needs both; a practical piece that adds nothing to a look is as weak as a beautiful one that fights the
day. Shown to the wearer as today (one plain sentence each).

### Step 5 — review the finished looks against the situation (one added call)
After composition, one call shows each card's photographs with its slot's `known` / `likely` / conditions and asks,
per card: keep, or what is wrong and which shortlisted piece fixes it. A fix must use shortlisted pieces and is
re-validated; otherwise the card stays and the review's note is shown, or it becomes a slot gap. This is the
critique that already rejected the stripe-on-stripe look; it would also have caught the print clash here.
Cost: one 3.7 Flash call per plan (≈ 1 cent, measured from the critique replay).
**Decide:** adopt the extra call per plan?

### Step 6 — ask only when the answer changes the clothes (wording)
The router's clarifying rule and the stylist's ask rule both say to ask when a fact "would change the outfit". Tighten
both to: ask only when the plausible answers lead to *different outfits*; otherwise choose clothes that suit the whole
likely range and say what was assumed. No examples or case lists (no-spelling-out-every-case ruling). Verified offline
by replaying the router on its captured requests (≈ $0.0025 a call).

### Step 7 — the acceptance run (paid, owner-rated)
The original request, plus one other at-home plan from the captures, on the configured stylist model. Rated by the
owner on practical **and** interesting looks; a run that only avoids cashmere does not pass.

## 4 · Not in this plan

- Re-landing the situation read turn or `get_weather` from the set-aside branch.
- `time_outside: brief` (a coffee run from home): only if step 2 or 7 shows a home slot with real time outside.
- The `core_is_warm_enough` label on looks with a layer; empty `operational_ease` / `movement` fields.
