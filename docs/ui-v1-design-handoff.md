# UI V1 design and readability handoff

**Status:** V1 foundation implemented and visually reviewed
**Last updated:** 2026-07-23
**Primary implementation:** `src/App.css`, `src/components/StylistChat.jsx`

This document records the product-design decisions behind the V1 visual pass so a future
contributor can continue the work without restarting the design discussion or undoing
deliberate choices.

It is a decision record, not a claim that every page has received a component-by-component
accessibility audit.

## Product context

This is a working wardrobe and personal-styling tool. It is not an artist portfolio, fashion
editorial, or generic image gallery.

The interface should help a person:

- understand what they own;
- compare complete outfit directions;
- solve styling and wearability problems;
- evaluate proportions, combinations, and alternatives;
- teach the stylist what does and does not work;
- move between wardrobe pieces, saved outfits, chat, generated results, and calibration
  evidence without losing context.

The product may feel refined and personal, but visual polish must not reduce legibility,
comparison value, or operational clarity. Outfit imagery is evidence, not decoration.

## Review method used for this pass

The implementation was reviewed through three required lenses:

1. **Product design:** information hierarchy, interaction clarity, consistency, responsive
   composition, and whether visual styling supports the task.
2. **UX and accessibility:** readable type size, contrast, line length, focus visibility,
   stable interactions, and whether important controls or information are visually demoted.
3. **Fashion-product design:** whether outfit directions can be understood as complete looks,
   whether garment imagery is large enough to compare silhouette and coordination, and whether
   the product behaves like a wardrobe/styling workspace rather than an editorial portfolio.

Future visual work should use all three lenses. Fashion-product review is not optional: a
technically clean UI can still fail if a user cannot imagine or compare the proposed outfits.

## Ratified visual direction

### Overall character

- Warm, quiet, and contemporary.
- Functional rather than decorative.
- Editorial typography may establish identity, but working content should behave like a
  readable application.
- Restrained surfaces and borders; avoid a field of undifferentiated beige cards.
- Images should lead where visual comparison is the task.
- Accent color should identify actions and state, not wash large repeated regions.

### Accent palette

The ratified accent is **muted aubergine**:

```css
--accent:       #684D62;
--accent-hover: #573E51;
--accent-light: #EEE5EB;
```

The accent works well for:

- primary actions;
- focus and selected states;
- navigation icons;
- short eyebrow labels;
- restrained landing-panel tints.

Do not replace the global accent merely because a repeated surface feels too lavender. Create
a semantic surface token with a lower tint concentration instead.

### Repeated user messages

The original chat bubble mixed `--accent-light` at 72% with `--surface`. Repetition made the
conversation feel lavender-heavy even though the same palette looked elegant on landing
panels, which use a much quieter tint.

V1 introduces chat-specific semantic tokens:

```css
--conversation-user-bg:
  color-mix(in srgb, var(--accent-light) 28%, var(--surface));

--conversation-user-border:
  color-mix(in srgb, var(--accent) 12%, var(--border));
```

The goal is authored-turn recognition without introducing a second palette or turning every
user message into a colored banner. Do not revert the user bubble to the 72% mixture.

## Typography decisions

### Font-family roles

Keep the existing pair:

```css
--font-serif:   'Cormorant Garamond', Georgia, serif;
--font-sans:    'DM Sans', -apple-system, sans-serif;
--font-display: var(--font-serif);
--font-reading: var(--font-sans);
```

Use **Cormorant Garamond** only for short identity-setting text:

- page titles;
- landing-panel titles;
- outfit or garment subject names;
- short section titles where an editorial voice is useful.

Use **DM Sans** for all working and reading content:

- chat prose;
- critiques and structured reads;
- outfit-result metadata;
- garment names and roles;
- controls, buttons, filters, and form labels;
- history and navigation;
- feedback and status text.

Do not use the serif face for long explanations. Its role is personality and hierarchy, not
dense reading.

### Working type scale

The shared V1 tokens are:

```css
--type-eyebrow: 12px;
--type-caption: 12px;
--type-meta:    13px;
--type-control: 14px;
--type-body:    15px;
--type-title:   28px;
```

Interpretation:

- `12px` is the floor for meaningful working UI.
- `13px` is appropriate for garment names, metadata that affects decisions, and compact
  supporting labels.
- `14px` is the normal control scale.
- `15px` is the default sustained-reading scale.
- Short serif identity text should generally be at least `18px`.

Tiny telemetry may be visually quieter, but anything needed to compare, understand, or act
must not be treated as telemetry.

### Long-form reading

Stylist prose and critiques use DM Sans at the shared body scale:

- `15px`;
- approximately `1.65–1.68` line height;
- a controlled measure of about `68ch`.

The expanded **Full structured read** is reading content, not metadata. It must retain the
same body scale and controlled measure. Never make it smaller simply because it is secondary
or disclosed on demand.

Do not shrink the type scale at the 1024px layout. Adapt columns and spacing before reducing
working text.

## Image and outfit-comparison decisions

The most important question in a generated-outfit result is usually not “Which garment is
this?” It is “Which complete direction feels better, and can I imagine wearing it?”

Therefore:

- garment photos in direction cards must be large enough to understand the outfit as a
  combination;
- direction cards should prioritize silhouette, color relationship, and coordination over
  card density;
- comparison-scale imagery is allowed to use more vertical space;
- `Generate outfit image` remains optional and cost-labelled, but the pre-render direction
  should still be imaginable from the garment composition;
- avoid reducing outfit pieces to tiny catalog thumbnails merely to fit more cards above the
  fold.

The V1 pass enlarged and clarified Stylist result imagery and supporting garment labels.

### Performance constraint

Visual improvements must preserve the existing image-performance behavior:

- use `resolveUploadThumbnailSrc(..., 'chat-garment')` or the appropriate thumbnail context;
- retain `loading="lazy"`;
- retain `decoding="async"`;
- open the full-resolution asset only for an explicit preview.

Do not solve image readability by loading full-resolution originals into every card.

## Interaction and layout decisions

### Visual Composer entry points

Visual Composer is a major product capability, not a footnote at the bottom of every chat.
Current entry points are intentionally contextual:

- the Stylist new-chat landing page;
- the Generated Outfits area in Lookbook;
- `Ask stylist about this outfit` from an outfit card;
- `Ask stylist about this piece` from a garment card.

Outfit and garment entry points lead to different landing panels because the starting object
and available decisions differ. Do not assume every chat began with an outfit.

### Chat layout

- The subject panel should identify the selected outfit, selected garment, or wardrobe-level
  task without pushing a tiny image to one edge with detached microcopy.
- The composer remains pinned at the bottom but must not cover the final result.
- Selected history rows use a quiet surface and hierarchy, not a heavy vertical brown bar.
- The Recent list and By outfit/piece list should use the same selected-state language.
- Landing panels may use a restrained aubergine tint because they occur once; repeated chat
  bubbles require the quieter semantic token documented above.

### Stable cards

Reference cards must not change height on hover. Feedback controls may appear through opacity
or visibility, but the card’s reserved layout space must remain stable. Avoid hover behavior
that makes the grid jump.

## What was implemented in this V1 pass

The pass included:

- muted-aubergine accent adoption across the primary interface;
- global font-family and type-scale tokens;
- global readable text and focus foundations;
- DM Sans long-form reading treatment;
- controlled critique and structured-read line length;
- larger, comparison-oriented Stylist outfit-direction imagery;
- readable garment names, role labels, rationales, saved states, cost details, and actions;
- chat subject-panel restructuring for outfit, garment, and wardrobe contexts;
- pinned composer placement and bottom-content clearance;
- quieter selected rows in both chat-history modes;
- removal of duplicate inline outfit critiques;
- stable Reference-card hover behavior;
- Visual Composer entry in Generated Outfits;
- authentication and Settings-page visual alignment;
- clarification that the Style Profile contextual-memory section contains outfit/generated
  result feedback, not a separate unsupported garment-feedback taxonomy;
- semantic, restrained user-message background tokens.

Relevant regression tests:

- `test/typographySystem.test.js`
- `test/outfitChatLayout.test.js`

## Scope boundary: global foundation versus completed audit

The following are global:

- font-family tokens;
- working type-scale tokens;
- base text colors;
- focus-ring foundation;
- muted-aubergine palette;
- reduced-motion foundation;
- semantic user-message surface tokens.

The most detailed component-level readability remediation was performed on:

- Stylist chat;
- generated outfit results;
- outfit critiques;
- structured reads;
- Visual Composer landing panels;
- chat history and composer.

Wardrobe, Lookbook, Visual Lab, authentication, and Settings inherit the global foundations
and received visual work during the same broader UI pass, but they have **not all received the
same exhaustive text-role audit**. A future contributor should not mark app-wide readability
complete solely because the tokens exist.

## Verification performed

For the final typography and conversation-color work:

- focused typography and outfit-layout tests passed;
- production Vite builds passed;
- the authenticated sandbox was used with real AI chat content during the readability work;
- thumbnail resolution, lazy loading, and asynchronous decoding were preserved.

Some full-suite runs in the restricted Codex environment can fail before assertions because
server-binding tests receive `listen EPERM 0.0.0.0`. Treat that as an environment limitation,
not evidence that UI tests passed or failed. Always run the full suite in an environment that
permits its test servers before merging.

## Sandbox used for visual QA

The established local sandbox commands are:

```bash
NODE_ENV=development \
PORT=3098 \
WARDROBE_DB_PATH=/Users/yuna/.wardrobe-sandbox/legacy-wardrobe.db \
WARDROBE_SYSTEM_DB_PATH=/Users/yuna/.wardrobe-sandbox/system.db \
WARDROBE_USERS_DIR=/Users/yuna/.wardrobe-sandbox/users \
WARDROBE_UPLOADS_DIR=/Users/yuna/.wardrobe-sandbox/legacy-uploads \
WARDROBE_MOCK_AI=true \
node server.js
```

```bash
VITE_PORT=5174 \
VITE_API_PROXY_TARGET=http://localhost:3098 \
npx vite
```

Use the documented sandbox account and existing chat data. The coding agent should start and
stop these services itself when performing QA; the owner does not need to keep them running.

## Handoff checklist for the next visual pass

Before proposing changes:

1. Read this document and the relevant file in `docs/flows/`.
2. Inspect the page in the authenticated sandbox with representative real data.
3. Review at 1024px and 1440px application viewports; also inspect a wide viewport without
   allowing the app to become a tiny fixed island.
4. State the user task for the page and identify the primary comparison or decision.
5. Review through product-design, accessibility, and fashion-product lenses.
6. Diagnose before changing ratified behavior or workflow placement.

While implementing:

1. Prefer semantic tokens over page-specific colors.
2. Do not globally change `--accent-light` to fix one repeated surface.
3. Keep meaningful UI at or above the V1 type floor.
4. Preserve image thumbnail and lazy-loading behavior.
5. Reserve hover content space so layouts do not jump.
6. Keep changes narrow and add regression tests for ratified decisions.

Before handing off:

1. Run focused UI tests.
2. Run `npm test` in a server-capable environment.
3. Run `npm run build`.
4. Manually inspect representative populated, empty, long-content, and selected states.
5. Capture both 1024px and 1440px evidence.
6. Record any deliberately deferred surfaces here rather than implying they are complete.

## Recommended next work

The next contributor should conduct a page-by-page text-role audit of the remaining
non-Stylist surfaces, using the global tokens already in place. This should be a conservative
consistency pass, not another visual reset.

Priority order:

1. Wardrobe inventory and garment detail/edit flows.
2. Lookbook and generated-outfit detail flows.
3. Visual Lab References, Calibration Boards, and Style Profile memory sections.
4. Settings, tasks, import, and administrative surfaces.
5. Empty, loading, error, and narrow-viewport states across all of the above.

The goal is to find residual hard-coded sizes, faint metadata that is actually
decision-relevant, inconsistent control sizing, and long-form text that bypasses the reading
tokens.
