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

### Step 1 — one look per day it covers · done 2026-10-30, uncommitted, not run live
- `plan_outfit_set` slots take `dates`: every day the use case happens. The no-rotation sentence now tells her to
  list them.
- In a `coordinated_plan`, `normalizePlanSlots` keeps real dates inside the plan's range (deduplicated, in order) and
  sets the slot's look ceiling from how many there are; `count` is not used. A slot on one date is dated to it, so it
  takes that day's weather. More than 3 days gives 3 looks, disclosed as "covers N days and shows 3 looks"; the plan
  cap of 8 trims as before and keeps the larger number it recorded. `shiftSlotDate` moves `dates` with `date`.
- The shortlist's use-case line shows the slot's days instead of the plan's first day standing in; the composer's
  slot carries `dates`.
- Trips and capsules: unchanged. A slot without `dates` keeps today's `count` (lenient default, chosen while the
  owner's decision is open).
- Tests: `test/planSlotDates.test.js`. Offline rebuild of `thread_1793331990443`'s plan call with the mornings
  `home` and dated Fri–Sun: "Mornings at Home (…, 2026-10-30, 2026-10-31, 2026-11-01, at home, no travel or time
  outdoors; …) — up to 3 outfits".
- **Not done:** tying each composed look to one of its dates. The coordinated composer has no `worn_on_date` (the
  trip composer does), and a slot over several days still takes the whole plan's weather range, not its own days'.
  Worth doing only if a run shows a look dressed for the wrong day.
- **Decide:** a recurring slot with no `dates` — keep the lenient fallback, or return the call once asking for them?

### Step 2 — one paid check before building more (≈ 2–4 cents)
Rerun the original request once on **3.7 Flash** and once on **Flash-Lite**, after steps 0–1. Read: does she choose
`home` for the mornings; how many morning looks; which tops the shortlist takes and why. This decides how much of
steps 3–5 is needed: if the honest temperature alone moves the shortlist to practical, good-looking tops, step 3
shrinks to the pieces the run still shows missing.
**Decide:** which model(s) — the app's configured stylist model only, or both?

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
