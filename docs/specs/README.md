# Spec archive — historical, not authoritative

35 design specs, written 2026-07-08 → 2026-07-20, copied into the repo on **2026-08-16** from
`~/Downloads/spec_*.md` where they were invisible to every search a session runs.

**They are here for provenance — *why* something was once done — and for nothing else.**

---

## The one thing to know

**These specs span several generations of this app, and their decisions have been revisited,
reversed and deleted since. Their own `Status:` lines are frozen at authoring time and are often
wrong.** Verified examples: `spec_29`, `spec_32` and `spec_33` all say *"Proposed. Not
implemented."* — all three are merged. Conversely, some specs marked "Ready for implementation"
were superseded before anyone built them.

Every file in this directory carries a banner saying so, immediately under its title. That banner
is enforced by `npm test` (`scratch/check_docs_health.js`) precisely because a grep hit opens the
*file*, not this README.

## Authority order — owner ruling, 2026-07-30

When this archive disagrees with anything:

1. **The code** — what actually runs.
2. **Ratified docs** — [occasion profiles](../occasion_profiles_ratification.md),
   [style constitution](../style_constitution.md), and the three maps
   ([engine](../engine-behaviour-map.md) · [feedback/memory](../feedback-and-memory-map.md) ·
   [surface](../app-surface-map.md)).
3. **This archive** — why something was once done that way.

And the method, set by the owner after a session reversed two live-tested decisions on the strength
of an unvetted old spec:

- A decision made from **fresh evidence** — a live run, a measurement — **stands.** It is not
  reverted because a historical document disagrees.
- The disagreement is **recorded**, with the quote, so the reasoning is not lost.
- **Testing settles it, not archaeology.**

> "An old spec decided otherwise" is an **unverified claim, not a finding.**

Full reasoning, including the concrete 2026-07-30 case that prompted the ruling:
[../spec-archive-index.md](../spec-archive-index.md).

## Deliberately no status column here

The obvious thing to add is a table of which specs shipped. **Not doing it, on purpose.** A derived
status table would need maintaining, would go stale, and would then be a *second* wrong authority
about the same 35 files — the exact failure this whole exercise exists to fix. Git-derived counts
are also unreliable for the low numbers: specs 1, 2, 5 and 6 shipped but their commits never cite a
spec number.

**To find out whether a spec shipped, ask the sources that are actually maintained:**

```bash
git log --all -E --grep="[Ss]pec 24([^0-9]|$)" --oneline    # implementing commits, if they cite it
grep -rn "spec 24\|Spec 24" docs/*.md styling-engine/ routes/  # the maps and code comments cite specs by number
```

- [freeform-rearchitecture-handoff.md](../freeform-rearchitecture-handoff.md) — the maintained
  spec-by-spec record for the `/ask` arc, with the live failures that motivated each.
- [capsule-index-and-plan.md](../capsule-index-and-plan.md) — the same for capsule work.
- [engine-behaviour-map.md](../engine-behaviour-map.md) — cites specs by number where their
  behaviour survives, which is the strongest evidence a spec is still live.
- The code itself: `styling-engine/` comments cite "spec N" at the sites that implement them.

## What this archive is genuinely good for

Live code does something odd and no comment explains it. A spec may say why — including the
alternatives that were rejected and the reason. That is worth real money occasionally, and it is
the only claim this directory makes.

## Notes on specific files

- **`spec_3_freeform_observability.md` and `spec_3_freeform_observability_rev_a.md` are both kept.**
  They are different revisions, not duplicates. `rev_a` is the earlier one and carries a **Part 0**
  section (unproposed-outfit prose; the zero-result contradiction block) that the final file
  dropped — and Part 0 **shipped**: `styling-engine/provider.js` cites "Spec 3 Part 0a" and
  "Spec 3 Part 0b" at the implementing functions. The earlier revision is the better record of that
  work's rationale.
- **`spec_chat_markdown_rendering.md`** is the only unnumbered spec.
- Specs 11 and 35+ do not exist in this archive; the numbering has gaps.
