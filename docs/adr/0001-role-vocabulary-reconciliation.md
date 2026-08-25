# Role vocabulary: document the split, defer the fix

**Status:** Active — decision record introduced by PR 253 on 2026-08-24.

The tagger writes a piece's compositional role using unsuffixed values (`hero`, `support`,
`grounding`, ...). Code that matches roles against outfit archetypes reads only the suffixed
form (`hero_piece`, `support_piece`, `grounding_piece`). A third, overlapping vocabulary exists
on `garment_intelligence.best_outfit_role`. The result: the tagger's unsuffixed values are
written but currently scored on by nothing — dead vocabulary, not just a naming quirk.

We chose to document the suffixed, code-side form as canonical in `CONTEXT.md` now, rather than
silently reconciling the tagger's output to match (or reconciling the code to match the
tagger). Fixing which side moves is a real design decision on its own — it touches tagger
prompts, archetype-matching logic, and possibly a data migration for already-tagged pieces —
and doing it as a side effect of a vocabulary-naming pass would be exactly the kind of
"fixing something that was deliberate, or that deserves its own scoping" this codebase's own
CLAUDE.md warns against. The fix is tracked as separate future work; this ADR exists so a
future reader finds the reasoning instead of assuming nobody noticed.
