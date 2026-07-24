# UI V1 design and readability handoff

**Status:** V1 foundation implemented and visually reviewed
**Last updated:** 2026-07-23
**Primary implementation:** `src/App.css`, `src/components/StylistChat.jsx`,
`src/views/PieceInventory.jsx`

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

### Recreating the panel in a future session

The individual reviewer agents are not persistent identities. What persists is the required
panel protocol in `AGENTS.md` and this rubric. A future implementation session should create
three independent reviewers with these briefs:

- **Product-design reviewer:** inspect information hierarchy, task flow, action priority,
  responsive composition, and consistency with already-ratified product surfaces.
- **UX/accessibility reviewer:** inspect readable type and contrast, focus order and return,
  keyboard and Escape behavior, touch targets, stable layout, scrolling, and loading/empty
  states.
- **Fashion-product reviewer:** inspect whether the page helps a person understand a real
  garment or outfit, compare styling evidence, reason about fit and wearability, and take the
  next useful wardrobe action. Reject portfolio or catalog conventions that weaken the
  working styling task.

All three reviewers should receive the same evidence: the user task, relevant flow
documentation, representative real sandbox data, and browser captures at the target
viewports. They should return **blocking issues**, **important refinements**, and **what is
already working** separately. The implementing agent should resolve consensus findings,
surface genuine conflicts to Yuna, and record the final owner-reviewed decision here.

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

### Wardrobe inventory index

The Wardrobe index was reviewed on 2026-07-23 through the same three required lenses. The
ratified direction is a calm, comparison-friendly personal wardrobe index—not an ecommerce
catalog, masonry gallery, or metadata dashboard.

Keep these decisions:

- Every garment card has the same stable `4:5` outer image stage.
- Preserve the complete garment with `object-fit: scale-down`; do not crop clothing merely to
  make photographs look more uniform.
- Use a minimum card width of approximately `250px`, with a responsive progression of four
  columns at 1440px, three at 1024px, and two at 768px.
- The card-level decision payload is deliberately restrained: garment name plus no more than
  two color swatches/names.
- Do not add brand, database ID, wear count, occasion, season, or fabric to every card. Those
  belong in search/filtering or garment detail unless user research establishes a repeated
  comparison need.
- Reserve card badges for actionable states such as repair, donate, or retag.
- Preserve optimized garment-display thumbnails, lazy loading, asynchronous decoding, and
  relationship prefetching.
- Search language should describe what a person knows about clothing—name, color, fabric, or
  shape—not database identifiers.
- Sort labels should describe styling activity rather than claiming that an item was worn.
  Current labels are **Balanced mix**, **Recently styled**, **Most styled**, and
  **Ready to rediscover**.
- Filtering, searching, and sorting must announce result changes, maintain clear selected
  semantics, restore focus when menus close, and prevent stale requests from replacing newer
  results.

The uniform outer stage and uncropped garment are the foundation. Any future improvement to
unusually shaped photos must adjust only the *inner* presentation; it must not introduce
variable card heights or masonry.

#### Deliberately deferred Wardrobe ideas

These are follow-up hypotheses, not requirements for the completed index pass:

1. Add category/orientation-aware inner scaling or focal framing for landscape footwear and
   very small accessories while keeping the identical `4:5` outer stage and never hiding part
   of the garment.
2. Revisit **Balanced mix** only if usability testing shows that its meaning remains unclear.
3. Consider warmer season labels such as **Warm weather / summer** and
   **Cool weather / winter**.
4. Consider exposing **Needs worn photo** on a card only if repeated use shows it is a frequent
   index-level decision; otherwise keep it in Tasks or garment detail.
5. Complete richer menu keyboard behavior such as Home, End, and typeahead.
6. Increase compact mobile targets toward `40–44px`, even where the current controls satisfy
   the minimum accessibility requirement.
7. Include repair, donate, and retag state in each card’s accessible description.
8. Add direct Add/Import actions to the truly empty Wardrobe state.
9. Announce favorite mutations to assistive technology.
10. Audit the Tasks modal as a dialog, including focus trapping and focus return.

Garment detail/edit and the Tasks modal remain separate product surfaces. Do not treat this
inventory-index ratification as their completed design audit.

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
- semantic, restrained user-message background tokens;
- stable, uncropped Wardrobe inventory cards with responsive four/three/two-column density;
- Wardrobe search, filter, sort, empty/error, focus, announcement, and request-ordering
  improvements;
- a verdict-first Visual Lab Calibration Boards review workflow with separated Review/Status
  filters, a distinct image-fidelity signal, progressive specific-feedback disclosure, live
  save/error feedback, and dialog focus management.

Relevant regression tests:

- `test/typographySystem.test.js`
- `test/outfitChatLayout.test.js`
- `test/wardrobeVisualIndex.test.js`
- `test/visualLabImageSurfaces.test.js`

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

The Wardrobe inventory index has now received a focused product, fashion-product,
accessibility, responsiveness, and text-role review. Wardrobe garment detail/edit, Lookbook,
Visual Lab, authentication, and Settings inherit the global foundations and received visual
work during the same broader UI pass, but they have **not all received the same exhaustive
text-role audit**. A future contributor should not mark app-wide readability complete solely
because the tokens exist.

## Wardrobe garment-detail ruling

**Status:** owner-reviewed and ratified on 2026-07-23.

This ruling covers the read-only garment detail modal only. It does **not** ratify the Add
piece or Edit piece workflows.

The modal should behave as a working garment record:

- garment identity and useful metadata come before system or database details;
- the photograph remains the primary recognition surface without turning the modal into an
  editorial lightbox;
- styling memory is presented as readable guidance (`Works well` and
  `Avoid or reconsider`), with raw feedback tags and embedded Markdown stripped;
- real linked outfits appear before generated boards because lived evidence is more useful
  than speculative exploration;
- a garment with no worn photo offers `Add worn photo`; a garment that already has one offers
  `Review fit details`;
- `Ask stylist about this piece` is the primary next action, Edit is secondary, and Delete is
  quiet and isolated;
- the two-column desktop layout becomes a stacked layout before either column becomes
  unreadable, with the action dock kept reachable;
- the main dialog and full-photo preview trap focus, close with Escape, and return focus to
  their trigger;
- existing thumbnail derivatives, lazy loading, and priority loading are preserved.

Validated states included hanger-only and hanger-plus-worn photography, provisional fit data,
styling memory, linked outfits, generated boards, keyboard navigation, and 1024px/768px
responsive layouts using the authenticated sandbox.

### Deliberately deferred garment-detail refinement

There are no blocking product or accessibility items left for the ratified detail modal. One
non-blocking hypothesis remains: if real garments commonly produce enough linked outfits or
generated boards to overflow the relationship strip, test whether the horizontal scroll needs
a clearer affordance such as restrained edge fades or explicit previous/next controls. Do not
add this treatment without an observed overflow/discovery problem, and do not replace the
compact relationship strip with a large gallery.

## Wardrobe Edit Piece direction

**Status:** implemented for owner review on 2026-07-23; not yet ratified.

Edit Piece is a management surface, not a second garment-detail page and not an engine
console. The current implementation preserves every existing metadata field and the optimized
image pipeline while changing the hierarchy:

- the title identifies the garment being edited;
- hanger and worn photos remain together, with explicit remove/restore behavior;
- owner-recognizable basics remain open;
- fit and lived-wear notes remain easy to reach;
- construction/material metadata is grouped under `Garment character`;
- recommendation permissions and AI interpretation are grouped under `Stylist controls`;
- accumulated styling guidance is grouped under `What the stylist should remember`;
- missing recommendation metadata appears as neutral, non-blocking completion help; each
  missing field opens and focuses its corresponding control instead of behaving like a
  validation error;
- AI retagging reports what changed, leaves results reviewable, and cannot race Save;
- dirty-state dismissal requires confirmation, while errors remain visible in the form;
- the dialog traps focus, supports Escape, restores focus, and stacks before 768px overflow.

The Add Piece flow should not automatically reuse this complete expert form. It should begin
with the shortest viable owner task—photos, recognizable identity, and essential context—and
offer deeper metadata only after the garment exists.

### Deliberately deferred Edit Piece questions

1. Decide whether worn-photo analysis should update broad garment metadata or be limited to
   fit-and-wear fields. This is a product behavior decision and must not be changed implicitly
   during visual work.
2. Consider first-class lived-wear fields such as itch, restriction, slipping, required
   underlayers, pockets, temperature comfort, and maintenance only as a separate data-model
   project. Do not encode them as ad hoc text parsing.
3. Validate whether owners understand `Stylist controls`; if not, improve the explanation
   before exposing more engine vocabulary.

## Wardrobe Add Piece direction

**Status:** focused three-role review completed on 2026-07-23; not yet ratified.

The three-role panel reviewed the complete Edit Piece workflow and explicitly agreed that Add
Piece should not inherit that exhaustive management form. The short-intake direction below
implements that shared recommendation. Product design, fashion-product, and
UX/accessibility reviewers then inspected the actual empty Add flow at desktop and 768px.
They agreed with the overall short-intake direction but did not ratify the completed workflow.

Mechanical issues identified by that review and corrected in the same pass:

- hanger photo is the primary photo and its AI-draft action appears immediately after it;
- worn photo remains visibly secondary and optional;
- the stacked layout has an independently scrolling body and persistent action footer;
- the disabled action explains `Add a name to continue`;
- the required name has visible guidance without being announced invalid before submission;
- category, color, occasion, and season controls have programmatic group labels and button
  state semantics;
- small instructional labels were raised to the shared caption size and the header metadata
  no longer forces title case.

Add Piece is a short intake flow, not the complete Edit Piece management surface. The owner
can start with a photo or enter the recognizable identity manually. The implemented hierarchy
is:

- hanger and optional worn photos, with `Fill details with AI` when a source photo exists;
- visible creation essentials: name, category, colors, background color, occasions, and season;
- optional `Refine garment details` for pattern, construction, material, and silhouette;
- optional `Fit and wear` for lived fit behavior;
- optional `Add a note` for context the photo cannot show;
- no new-piece status choice, recommendation permissions, engine notes, learned rules, protected
  overrides, or rejection history.

AI prepares a reviewable first draft and does not save automatically. New pieces continue to
use the same upload, tagging, thumbnail, display-derivative, and persistence paths as before.

Validation completed for the implemented Add flow:

- manual creation persisted the selected identity and essential context to the authenticated
  sandbox database;
- desktop and 768px stacked layouts were inspected in the sandbox browser;
- Add omits Edit-only status, recommendation controls, engine notes, and styling-memory
  administration;
- the existing image derivative and upload paths remain unchanged;
- focused garment-surface and Wardrobe regression tests passed, and the production build
  completed successfully.

### Deliberately deferred Add Piece questions

These are product-behavior decisions and require owner agreement before implementation:

1. **Trustworthy minimum:** preserve quick manual capture, but decide whether incomplete
   pieces should be explicitly provisional (`Needs details`) and excluded from automatic
   recommendations until they have either a clear source photo or a minimum manual identity.
2. **Worn-photo scope:** the UI promises a fit note, while the current AI tagging path can
   revise broader identity and style fields. Prefer scoping worn-photo analysis to fit, drape,
   and wear behavior unless the broader draft is made explicit and separately reviewable.
3. **Base color:** move universal `Background color` into `Refine garment details` and reveal
   it only for patterned pieces, labeled `Base color of the print`, unless owner testing shows
   that it is reliably understood as a visible creation essential.
4. Consider a post-create refinement invitation only after observing whether owners abandon
   the optional disclosures; do not add another step preemptively.

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

1. Wardrobe garment detail/edit and Tasks-modal flows.
2. Lookbook and generated-outfit detail flows.
3. Visual Lab References and Style Profile memory sections. (Calibration Boards received its
   own focused workflow pass on 2026-07-23 — see the ruling below.)
4. Settings, import, and administrative surfaces.
5. Empty, loading, error, and narrow-viewport states across all of the above.

The goal is to find residual hard-coded sizes, faint metadata that is actually
decision-relevant, inconsistent control sizing, and long-form text that bypasses the reading
tokens.

## Lookbook — My Outfits panel ruling and implementation

The product-design, accessibility, and fashion-product reviewers evaluated the same populated
sandbox collection at 1440px, 1024px, and 768px. The ratified direction is an outfit-working
index, not an editorial gallery:

- keep three columns at 1440px and two columns at 1024px/768px;
- preserve complete real photos and the existing `lookbook-display` thumbnail, lazy-loading,
  and async-decoding paths;
- use one stable 4:5 media stage with `object-fit: contain`, so portrait and landscape source
  photos create aligned comparison rows without cropping the owner;
- keep card copy compact, but expose occasion/season, Trying status when applicable, and
  linked-piece completeness (`N linked pieces` / `No pieces linked`);
- keep actions in detail, with only the separate Pin control on the index card;
- use a real button for the card open action and a sibling Pin button. Do not put one
  interactive control inside another;
- expose selected and expanded state for collection, pin ordering, filter, and sort controls;
- distinguish a genuinely empty collection from a filtered-empty result and give each a
  direct next action;
- describe the garment-aware search honestly as `Search outfits or pieces…`.

The existing implementation did **not** filter to pinned outfits. It sorted pinned outfits
first while labeling the segmented control `Pinned`. For this pass the UI is corrected to
`Pinned first`, matching existing behavior without silently changing retrieval semantics.
If the owner later wants a true pinned-only collection, change both the filter behavior and
the label together.

### Owner-ratified My Outfits status and ordering semantics

The owner resolved the remaining behavior questions on 2026-07-23:

- `Pinned first` remains an ordering preference, not a pinned-only retrieval filter.
- `Confirmed` is an owner assertion that the outfit was worn or intentionally chosen to wear.
  It must not be downgraded because a record lacks linked-piece metadata or another form field.
- `Trying` remains available for an outfit used as styling evidence before the owner decides
  to wear it.
- Outfits do not have a meaningful archive lifecycle. The legacy `Archived` choice is removed
  from the Add/Edit Outfit UI and must not be reintroduced without a new owner-approved use
  case. Chat archives, ignored Visual Lab references, and archived feedback are unrelated
  concepts.

Do not add wear scoring, editorial overlays, masonry layout, automatic cropping, or dense
garment-name payloads to the cards. Those were explicitly deferred by the panel.

## Lookbook — Generated Outfits panel ruling and implementation

Generated Outfits is an inspiration and review collection. It contains stylist hypotheses,
not evidence that the owner wore, tried, or confirmed an outfit. The collection therefore
uses proposal language and does not borrow My Outfits status semantics.

The implemented direction is:

- keep `Generated idea` provenance in the detail view and any mixed-context surface, but omit
  it from cards inside the Generated Outfits tab, where the selected collection already
  establishes provenance;
- show a compact review signal (`Signature`, `Works`, `Needs review`, or `Not reviewed`) and
  the board's actual scope (`Whole-wardrobe direction`, `Direction around a piece`, or
  `Single generated look`; outfit-seeded boards use `Direction from an outfit`);
- describe composition honestly as wardrobe-piece count plus ideal additions, rather than
  presenting all pieces as owned;
- use a stable 4:5 media stage, with an inset document treatment for comparison boards, while
  preserving existing thumbnail URLs, lazy loading, and async decoding;
- keep pinning as `Pinned first` ordering and report pin failures visibly;
- omit Occasion and Season controls until generated-board briefs persist those fields. Do not
  infer them from garment metadata;
- omit piece-count sorting because ideal additions and wardrobe pieces are not equivalent;
- use generated-specific search copy and distinguish loading, fetch failure, true empty, and
  search-empty states, each with an appropriate recovery action;
- make the generated detail a real modal dialog with initial focus, focus containment,
  Escape dismissal, and focus return to the originating card;
- rename `Stylist feedback` to `Your feedback` and `Why this works` to
  `Why it was suggested`;
- offer `Start a new outfit brief` from detail. It opens an honest unseeded Visual Composer
  brief; it must not imply that it will preserve the selected generated direction.

Do not attach owner-truth labels such as Confirmed or Trying to generated ideas. A generated
idea becomes owner evidence only through a separate, explicit owner action in a future
workflow.

## Lookbook — detail-view completion and deferred work

Both My Outfit and Generated Outfit detail views were completed in the same pass as their
collections. The shared interaction ruling is:

- the dialog owns its vertical scrolling and locks both the document and application content
  behind it; wheel/touch scrolling must never move the Lookbook while a detail dialog is open;
- size the desktop sheet against the dynamic viewport and keep its inner content min-height
  constrained so CSS grid children cannot expand the dialog beyond the viewport;
- retain a complete, uncropped outfit image and use the existing thumbnail-first display path;
- keep the close control visible, use labelled dialog semantics, contain keyboard focus, allow
  Escape dismissal, and return focus to the originating card;
- do not hide ordinary management actions in an overflow menu merely to make the surface look
  quieter.

For **My Outfit** detail, action placement follows the object being changed:

- `Edit linked pieces` (or `Link wardrobe pieces`) belongs directly under the composition;
- `Ask stylist about this outfit` remains the primary styling action;
- `Edit outfit` is a visible secondary action;
- `Delete outfit` is a visible, quiet destructive action alongside outfit management—not in
  an ellipsis menu.

For **Generated Outfit** detail, keep proposal context, suggestion rationale, review feedback,
and composition visible before the handoff actions. Removing a generated idea from Lookbook is
not the same as deleting a confirmed My Outfit.

### Deliberately deferred Lookbook workflow

One substantive Lookbook question remains for a future product pass: whether and how a
generated idea can be explicitly promoted into **My Outfits**. That workflow must ask for an
owner action and must not automatically label the result Confirmed or Trying. It may require
choosing or uploading a real outfit photo and resolving ideal additions versus owned wardrobe
pieces. Do not implement it as a status toggle on a generated card.

The following are **not** open TODOs:

- a true pinned-only filter (the ratified behavior is `Pinned first`);
- outfit archiving (there is no approved outfit archive lifecycle);
- reintroducing generated-provenance badges on every Generated Outfits card;
- wear scoring, masonry, cropped editorial cards, or dense garment-name overlays.

## Visual Lab — Calibration Boards review workflow

**Status:** ruling implemented and verified in the authenticated sandbox on 2026-07-23; not
yet owner-ratified.

Calibration Boards are an evidence inbox for teaching the stylist, not another inspiration
gallery. The owner must be able to judge an outfit direction quickly, then add diagnostic
detail only when useful.

The ratified first pass — now implemented in `src/components/VisualLab.jsx`, with the shared
`SAVED_BOARD_FEEDBACK_DISPLAY_LABELS` map relocated to `lib/feedbackTaxonomy.js` — is:

- preserve complete board imagery with `object-fit: contain`, the existing display derivative,
  lazy loading, and async decoding;
- show a stable, explicit card verdict (`Not reviewed`, `Looks good`, `Almost right`, and so
  on) rather than whichever feedback labels happen to occur first;
- show image-fidelity trouble as a separate `Image issue` signal. A bad render does not reject
  the underlying outfit direction;
- separate collection filtering into **Review** (`Not reviewed`, `Positive`, `Needs review`,
  `Image issues`) and **Status** (`Use strongly`, `Hidden`, `Ignored`). These are different
  questions and must not be mixed into one row of ambiguous chips;
- distinguish loading, fetch failure with retry, a genuinely empty library, and no search or
  filter matches;
- make the detail sheet verdict-first. Specific style, shape, and rendering diagnoses use
  progressive disclosure;
- keep styling-direction feedback, fit/shape feedback, and generated-image fidelity in
  labelled groups with persistent selected states and visible save/error feedback;
- use `Why it was suggested`, not gallery/editorial language such as `Why this look`;
- make detail and full-image previews named modal dialogs with initial focus, focus
  containment, Escape dismissal, and focus return to the exact originating control;
- constrain the desktop grid children with `min-height: 0` so the detail content—not the
  background page—owns vertical scrolling. Lock both the document and application scroll
  containers while the dialog is open.

### Verification performed

The implemented workflow was checked live in the authenticated sandbox on 2026-07-23 against
the seeded ten-board library:

- the collection card verdict is derived from the board's stored overall verdict, not from
  whichever feedback label happens to occur first, and shows `Not reviewed`, `Looks good`,
  `Almost right`, and so on with a distinct, separate `Image issue` signal;
- the two filter rows (**Review** and **Status**) carry `role="group"`, per-option
  `aria-pressed`, and drive independent client-side filtering; loading, fetch-failure retry,
  empty-library, and no-match states each render their own copy and recovery action;
- the detail sheet is verdict-first: `Outfit direction` verdicts are mutually exclusive, and
  style, shape, and generated-image diagnoses live behind an `Add specific feedback`
  progressive disclosure that auto-opens only when such feedback already exists;
- changing a verdict PATCHes the saved board, updates the card summary, and surfaces
  `Saving…`/`Feedback saved`/error through a polite live region; controls disable while a
  write is in flight;
- the detail and full-image previews are labelled modal dialogs that take initial focus on the
  close control, trap Tab, dismiss on Escape, lock document and `.app-main` scrolling, and
  return focus to the exact originating card or trigger;
- board imagery stays complete via `object-fit: contain` and keeps the existing
  `lookbook-display` derivative, lazy loading, and async decoding.

Focused regression coverage lives in `test/visualLabImageSurfaces.test.js` (nine passing
tests, including the review-dialog behavior). The production Vite build passed. A verdict
change made during QA was reverted so the sandbox library was left as found.

The next substantive Calibration Boards feature is intentionally deferred: a comparison mode
for two to four boards, using uncropped images and a compact decision table. It should help the
owner answer “which direction is better and why?” and must not become a moodboard or portfolio
layout. Also defer bulk review, keyboard shortcuts beyond dialog behavior, and new feedback
taxonomy until the current workflow has been used enough to reveal a real need.
