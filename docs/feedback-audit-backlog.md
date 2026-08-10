# Feedback-surface audit tooling — engineering backlog

Ideas for hardening the verification tooling behind
[`feedback-and-memory-map.md`](feedback-and-memory-map.md). **None of these blocks that document**,
which is ratified as the baseline description of the current system. They are here so the ideas are
not lost and not mistaken for prerequisites.

The map's current check —
[`scratch/audit_feedback_surface_completeness.js`](../scratch/audit_feedback_surface_completeness.js)
against [`scratch/feedback_surface_inventory.json`](../scratch/feedback_surface_inventory.json) — is
a **drift detector**: it catches a store being added without being classified. Everything below
would extend it from drift detection toward stronger guarantees.

## 1. AST analysis instead of grep for writers and readers

The writer and reader censuses are `grep` over `INSERT INTO x` / `FROM x`. That misses dynamic SQL,
table names built by interpolation, and helper functions that wrap a query. An AST pass over the
server modules could resolve the actual query targets and callers, and would have caught the
`storeUserCorrection` and conversation-state shadowing cases mechanically rather than by reading.

**Value:** high. **Cost:** a real parser dependency and ongoing maintenance.

## 2. Recursive file classification

The filesystem sweep classifies top-level `uploads/` subdirectories and resolves referenced
filenames. It does not descend, so a nested directory is unclassified in practice, and it does not
resolve files referenced from **inside payload JSON** rather than a dedicated column — currently
marked `[unverified]` in the map's category 11.

**Value:** medium. **Cost:** low; mostly a recursive walk plus a JSON scan for path-shaped strings.

## 3. Cache discovery

Medium 4 (runtime and prompt caches) has no enumerable inventory. The script prints
`refreshPrompts` / `buildForUser` sites and states that the check there is manual. A discovery pass
could find module-level `Map`/object caches keyed by user or session and require each to be
classified.

**Value:** medium — this is the medium most likely to hide a store. **Cost:** hard to do without
false positives; most module-level state is not user memory.

## 4. Semantic inventories within a table — shipped 2026-08-09

`stylist_feedback` is one table holding multiple behavioural destinations. The audit now compares
the code registry of accepted `feedback_type` values and scoped-evidence kinds against explicit
semantic dispositions in `feedback_surface_inventory.json`, then checks live values from both
`stylist_feedback` and `saved_boards`. The generic feedback endpoint rejects an unregistered type,
so adding a meaning requires classifying it rather than silently creating a new destination.

`app_meta` keys are still classified only at the table level; extending semantic enumeration there
remains a possible follow-up if that store gains more user-facing meanings.

**Value:** high — this is the most likely place for a real gap to hide today. **Cost:** medium;
needs an enumeration of live type/key values and a rule for what "new" means.

## 5. Other browser persistence

The sweep covers `localStorage` and greps for `sessionStorage`, `indexedDB` and `document.cookie`
(none currently used in `src/`). It does not cover service-worker caches or origin-private
filesystem, neither of which the app uses today.

**Value:** low while the app stays as it is. **Cost:** low.

---

## What would actually change the risk

Item 4 is now shipped for the feedback-bearing tables. Item 1 is the highest-value remaining
hardening work: the failures that survived five review rounds were all **scope** failures — a
store, a category or a medium absent from the search — and AST analysis would make the writer and
reader census less dependent on naming conventions.
