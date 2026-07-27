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
VITE_STYLIST_DEBUG=true \
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

## Stylist pages — panel findings and owner ruling

**Status:** panel diagnosis completed 2026-07-24 (product-design, UX/accessibility, and
fashion-product reviewers, live in the sandbox at 1440/1024/768px, across all four entry points
and every output type). Nothing has been changed yet. The owner ruled on the debug/diagnostic-
card question (theme A) the same day; implementation scope and sequencing are still open — see
**Open questions** below before starting work.

### What the panel reviewed

All four Stylist entry points (new-chat landing, Generated Outfits → Visual Composer, `Ask
stylist about this outfit`, `Ask stylist about this piece`) and every output type (chat prose,
outfit-direction cards, critiques, structured reads, diagnostic/"needs review" cards, the
comparison sheet) were inspected live, not from static mocks. The three reviews were
complementary rather than conflicting and converged strongly on two consensus themes.

### Consensus theme A — engine internals were leaking onto the styling surface

Independently the top finding for two reviewers and a blocking item for the third:

- an ungated debug trace appended to "Why this outfit" rationales and critique structured
  reads (`Styling Engine Trace: Activity: none · Walkable: false · Register Ceiling: elevated
  · Roster: tops: 2, dresss: 2, shoess: 4`), rendered whenever debug is present with no flag
  (`StylistChat.jsx:2818`);
- a real typo from naive pluralization — `dresss` / `shoess` (`StylistChat.jsx:2827`);
- "Needs review" diagnostic cards rendering raw console/gate vocabulary (`source:
  model-rejected`, `Rejected reason: structural: missing bottom`), sometimes as a near-duplicate
  competing with the real answer (two identical cards for the same look);
- cost-bearing actions (`Generate image ~$0.07`) offered on those broken/rejected cards;
- a provider-name leak ("One GPT-4o call generated…") and a Telemetry chip sitting inside the
  semantic filter-chip row.

The existence of diagnostic/"needs review" cards is itself deliberate — it is the advisor-mode
"we don't repair, we show the rejected proposal" behavior already documented in
`docs/flows/use-my-wardrobe.md`. The panel was not asking to delete them; it was flagging that
the *register and execution* fail: raw gate vocabulary, an ungated debug payload, a
pluralization typo, and paid actions offered on invalid cards.

**Owner ruling (2026-07-24):**

- The debug trace exists on purpose — it was left on for prototype testing. It's time to clean
  it up: gate it behind an explicit dev-only env flag rather than relying on debug simply being
  absent in production.
- Time/tokens-to-complete stays something the owner wants to see, but it goes behind that same
  dev flag rather than rendering on the default surface.
- The typo (`dresss` / `shoess`) is a plain bug and must be fixed regardless of the flag — not
  a design question.
- Keep the "needs review" diagnostic card concept, but change its composition: show the card
  the model actually produced, *plus* a separate disclaimer from the engine explaining why it
  was flagged — in plain language, not raw gate vocabulary — so the owner can still use it to
  tune the model or the engine. This engine disclaimer can also live behind the dev flag.

Not yet explicitly ruled on by the owner (carry forward from the panel's diagnosis, treat as
open until confirmed): the provider-name leak, cost-bearing actions on rejected/broken cards,
and the Telemetry chip's placement inside the semantic filter-chip row.

### Consensus theme B — feedback/calibration controls (blocking for UX, high severity for fashion)

The "teach the stylist what works" mechanism is the weakest cluster on the surface, all tracing
to one class-less, inline-styled feedback layer:

- 10px chips at 17–19px height — below the ratified 12px type floor and well under touch-target
  minimums; unusable at 768px (UX, blocking);
- no `aria-pressed`, no accent focus ring — selected verdict is conveyed by color alone;
- three disjoint vocabularies that don't nest: un-rendered cards get 2 options (`More like
  this` / `Not for me`), rendered boards get 4 verdicts + disclosure, saved boards get ~16 flat
  chips — and the richest vocabulary only appears after the owner pays to render (fashion);
- asymmetric depth: rich negative vocabulary, blunt positive (`Signature` / `Works`) — the model
  learns dislikes precisely and loves coarsely.

Componentizing this into one tokenized, accessible, consistent control (in the spirit of the
Calibration Boards Review/Status filter work above) would resolve multiple findings at once.

**Owner ruling (2026-07-24):**

- Keep the vocabulary staged, do not unify it into one universal control. Richness legitimately
  scales with what's visible at each stage — some judgments (silhouette, structure, grounding)
  can only be made once the image is actually rendered. What needs to change is that each
  stage's control is standardized: proper size (12px floor, real touch targets), accessible
  (`aria-pressed`, focus rings), and visually grouped rather than a flat chip-wrap.
  Scope explicitly includes the freeform chat's own rendered/saved-board feedback row (the
  `Signature` / `saved Works` / `Almost` / `Not me` + ~10 reason-chip row that appears under a
  generated image inside a Stylist chat thread), not only Visual Lab's Saved Boards page.
- Do **not** expand positive feedback to match the negative vocabulary's specificity right now.
  Held for a more important reason surfaced during this review: negative feedback captured via
  these chips does not always reach the model even today — the capture/delivery pipeline itself
  may be unreliable, which matters more than chip design and would make new positive vocabulary
  premature. The owner explicitly deferred investigating that pipeline gap for now ("not now") —
  it is a **known open issue**, not scoped into PR B. Do not start a diagnosis of it without the
  owner asking.

### Consensus-adjacent blockers (single reviewer, high severity)

- The async chat is silent to assistive tech — zero `aria-live`/`role="status"` anywhere; a
  screen-reader user gets no signal the stylist is working or that a reply/card/render arrived
  (UX, blocking).
- The image preview lightbox: Escape doesn't close it, no focus trap, no focus return —
  diverges from the dialog management already ratified on sibling surfaces (garment detail,
  Lookbook, Calibration Boards) (UX, blocking).

### Other findings (not blocking)

- Critique buries the answer — action guidance ("what to change first") renders last, after a
  dozen diagnostic/score rows (fashion).
- After `Create outfits`, the pane shows the generic empty/start-over state instead of a
  contextual generating state (product).
- Editorial shop-the-gap directions are only comparable-on-silhouette once the owner pays to
  render each one (fashion).
- Comparison sheet: baked-in caption text is illegible, and a `Saved` pill overlaps a column
  label (fashion).
- Smaller items: post-send focus drops to `<body>`; `Suggested additions` text sits at 4.48:1
  contrast (marginal); the mobile history drawer lacks dialog semantics; the send (↑) and
  remove-image (✕) controls are unlabeled; "N looks" counts are unstable; thread-rail subtitles
  are lossy.

### What is working (do not undo)

- The four entry points are legibly distinct and form a coherent wayfinding system.
- The anchor panel's compose-vs-explore fork is excellent.
- Result cards convey complete, imaginable looks with real photos at comparison scale.
- The per-piece `…` menu (`Replace this piece` / `Exclude`) is exactly right for a workspace.
- Prose voice is on-brand.
- Cost is always labeled and opt-in.
- V1 tokens and serif-for-identity are respected.
- Responsive layout holds at 768px without shrinking type.

### Open questions

1. ~~Priority/scope~~ — **decided 2026-07-24:** separate PRs by theme, not one combined pass:
   - **PR A:** de-leak engine internals behind the dev flag + fix the `dresss`/`shoess` typo +
     rework the diagnostic card (model's card + engine disclaimer), per the owner ruling above.
   - **PR B:** rebuild the feedback/calibration control (theme B).
   - **PR C:** chat `aria-live` + lightbox focus management (consensus-adjacent blockers).
2. Confirm the still-open theme-A items above (provider-name leak, paid actions on
   rejected/broken cards, Telemetry chip placement) before or alongside implementing PR A.
3. ~~Theme B~~ — **decided 2026-07-24:** ruled on, see above. PR B scope is standardizing each
   staged control's size/accessibility/grouping, not unifying vocabulary or expanding positive
   feedback. The consensus-adjacent blockers (chat `aria-live`, lightbox focus / PR C) still have
   not been ruled on — they carry the panel's severity ratings (blocking for UX) but need an
   explicit owner decision before PR C per the `AGENTS.md` panel protocol.
4. **Known open issue, not scoped into PR B:** negative feedback captured via these chips does
   not always reach the model. Owner-deferred ("not now") — do not investigate or fix without
   being asked.

### PR A — implemented 2026-07-24

All items the owner ruled on, plus two additional theme-A items confirmed with the owner
before implementation (provider-name leak: fix now; Telemetry placement: separate it; cost on
broken cards: explicitly left as-is for now, not yet decided):

- Added `STYLIST_DEBUG_ENABLED` (`import.meta.env.VITE_STYLIST_DEBUG === 'true'`) in
  `StylistChat.jsx`. It gates the "Styling Engine Trace" block under `Why this outfit`, the raw
  rejection reason/resolution note and rejected-pieces list and debug trace on "needs review"
  cards, and the generation timing/token `Dev telemetry` disclosure. Off by default (real dev
  pair `wardrobe-web`); on by default for `sandbox-web` via `.claude/launch.json` and documented
  in `CLAUDE.md`'s sandbox section.
- Fixed the `dresss`/`shoess` naive-pluralization typo with a `ROSTER_CATEGORY_PLURAL_LABELS`
  map (`pluralizeRosterCategory`), applied at both roster-count call sites, unconditionally
  (not gated by the dev flag).
- Reworked the "needs review" diagnostic card: removed the raw "Broken diagnostic card: shown
  to inspect a rejected model proposal." line and the raw `Rejected reason:` / `Rejected
  pieces:` / debug-trace content from the default view. Regular users now see the model's card
  as-is plus one honest, plain-language engine disclaimer ("This direction didn't clear one of
  the engine's structural checks, so it's shown here for review rather than as a validated
  suggestion."). The raw rejection reason, resolution note, rejected-pieces list, and debug
  trace are still available, labelled `Dev:`, behind `STYLIST_DEBUG_ENABLED`.
- Genericized the provider-name leak: image-generation loading status copy
  ("Sending direction details to GPT-4o...", etc.) now reads "...to the image model...", and
  the saved-outfit variant summary in `routes/ai.js` now reads "One image-generation call
  produced..." instead of "One GPT-4o call generated...".
- Moved the `Dev telemetry` disclosure out of the semantic filter-chip row into its own
  dashed-top-border container (`.stylist-response-dev-telemetry`) so it doesn't read as one of
  the response chips when the dev flag is on.
- Left as-is, not yet decided: cost-bearing `Generate outfit image` / `Evaluate outfit` actions
  are still offered on broken/"needs review" cards.

Verified live in the authenticated sandbox (`VITE_STYLIST_DEBUG=true`) against a real
whole-wardrobe generation that reproduced the panel's exact "Butter and Black" near-duplicate
broken-card scenario: the "needs review" card showed the plain-language disclaimer plus,
correctly gated, `Dev: rejected reason: navy wool blazer: hot weather: insulating fiber` and
`Dev: styling engine debug trace`; the `Dev telemetry` pill rendered visibly separated below
the semantic chip row. `npm run build` passed. `test/aiEndpointContracts.test.js`,
`test/typographySystem.test.js`, and `test/outfitChatLayout.test.js` passed (the 6 pre-existing
`aiEndpointContracts.test.js` failures are unrelated to this change — confirmed present on the
pre-change baseline). A regression test
(`StylistChat gates raw engine internals behind the STYLIST_DEBUG_ENABLED dev flag`) was added
alongside an update to the pre-existing broken-card test to match the new copy.

Not yet done: full `npm test` in a server-capable environment (this environment's
server-binding tests fail with `listen EPERM 0.0.0.0`, a known environment limitation, not
evidence either way — see Verification performed above).

### PR A follow-on — broken/corrected duplicate-card dedup (2026-07-24)

Live testing surfaced a second, related bug in the same "needs review" surface, still open
after the above: when the model calls `propose_outfit`, gets hard-gate-rejected, and then
correctly retries with the same pieces (e.g. adding `anchor:true` after the tool's own
remediation instructions), **both** the failed attempt and the corrected retry rendered as
separate competing "Direction" cards for the same outfit — this is the exact "two identical
'Butter and Black' cards" case from the original panel diagnosis, not something the earlier
theme-A ruling had addressed (that ruling covered the broken card's *content*, not whether a
superseded retry should still surface as its own card).

**Owner ruling:** if it's a duplicate, show only one card, and carry the engine's notes forward
onto the surviving card.

**Implemented:**

- `styling-engine/tools.js`'s `propose_outfit` handler now checks, before pushing a successful
  proposal into `toolContext.generatedOutfits`, whether an earlier `broken` entry in the same
  turn has the identical (sorted) piece-ID set. If so, that broken entry is dropped rather than
  rendered as a second card, and its `rejectionReason` carries forward onto the surviving card
  as `engineNote` (e.g. "Approved with an exception: navy wool blazer: hot weather: insulating
  fiber").
- `StylistChat.jsx` renders `outfit.engineNote` as a small italic, always-visible note (not
  gated by `STYLIST_DEBUG_ENABLED` — this is the "engine's notes" the owner asked to keep
  visible on the surviving card, distinct from the raw dev-only internals).
- A dedup only fires on an exact piece-ID-set match — a retry that changes pieces (a genuinely
  different attempt, not a correction of the same one) still renders as its own card.

**Verification status:** a new regression test,
`test/aiEndpointContracts.test.js`'s "a corrected retry with the same pieces supersedes its own
earlier rejected attempt instead of duplicating the card", exercises the exact reject-then-
anchor-retry sequence directly against `executeTool` (no model/network call) and passes,
alongside the full existing suite with no new failures. **Live browser verification in the
sandbox was not completed**: the mock AI handler (`styling-engine/mockAiHandler.js`) has no
scripted response for the freeform tool-calling loop — `askStylistWithTools` treats any mock
response as a final answer and never dispatches `propose_outfit` under
`WARDROBE_MOCK_AI=true`, so this scenario cannot be reproduced live without a real, billed model
call. Given the owner's low-token-budget constraint, that live check was deferred; the owner
verified by hand later.

**Owner-verified 2026-07-24.** Live in the sandbox, a real turn produced two directions
("Rust Wrap — Evening Sharp" and "Rust Wrap — Relaxed Evening"), each of which hard-gate-
rejected its layer piece on the first `propose_outfit` attempt (navy wool blazer / tan cotton
trench coat, both flagged for hot weather) and succeeded on retry. Both rendered as a single
card each — no duplicate "needs review" card alongside the corrected one — with the plain-
language `engineNote` ("Approved with an exception: navy wool blazer: hot weather: insulating
fiber" / "...tan cotton trench coat with belt: hot weather: insulating piece") visible on the
surviving card. This fix is now owner-ratified.

## PR B — Stylist feedback control standardization (implemented 2026-07-24)

Scope per the owner ruling above: standardize each staged feedback control's size,
accessibility, and grouping. Do not unify vocabulary across stages, do not expand positive
feedback vocabulary (that's held on the separate "feedback doesn't always reach the model"
open issue).

**Shared CSS** (`src/App.css`): a new `.stylist-feedback-*` class set — `.stylist-feedback-row`,
`.stylist-feedback-chip` (34px min-height, `var(--type-caption)` = 12px, pill-shaped,
`[aria-pressed='true']` selected state), `.stylist-feedback-chip.is-quiet` (the text-style
disclosure toggle), `.stylist-feedback-group-title`, `.stylist-feedback-disclosure`. Selected
state and hover are handled by the class; keyboard focus relies on the existing global
`:focus-visible` foundation (`src/App.css:64`) rather than a redundant chip-local rule.

**Three surfaces standardized in `StylistChat.jsx`:**

1. **Un-rendered direction cards** (`OUTFIT_FEEDBACK_LABELS`, `renderOutfitFeedbackButtons`) —
   swapped inline styles for the shared class, added `aria-pressed`. No structural change; this
   stage's 2-option vocabulary (`More like this` / `Not for me`) is unchanged.
2. **Plain-text assistant replies** (`FEEDBACK_ACTIONS`, now split into
   `FEEDBACK_PRIMARY_ACTIONS` and `FEEDBACK_REASON_ACTIONS`) — this was the flat, ungrouped
   14-chip row from the owner's screenshot. Restructured to verdict-first + progressive
   disclosure: the 4 primary verdicts (`Signature`/`Works`/`Almost`/`Not me`) plus a
   `More feedback` toggle are always visible; the 10 reason chips render behind that toggle,
   auto-expanded if one is already saved. Reuses the existing `expandedFeedbackCards` /
   `collapsedFeedbackCards` / `toggleFeedbackCardExpansion` state (already used by the rendered-
   board surface below) with a `message-feedback:${i}` key — no new state mechanism.
3. **Rendered/saved boards** (`GENERATED_BOARD_FEEDBACK_LABELS`, two call sites — editorial-idea
   boards and freeform-chat visual boards) — already had verdict-first + progressive disclosure
   structurally; swapped inline styles for the shared class and added `aria-pressed`/
   `aria-expanded`. No logic changes (verdict computation, key schemes, and `contextOverride`
   resolution were left untouched to avoid risk in the two independent closures).

**Not touched:** the "Save as styling rule" / "Generate visual boards" / "Save board" action
buttons adjacent to these controls (not feedback vocabulary, out of scope); the `boardResults[i]`
("wardrobe-board") surface, which has no verdict/feedback chips at all today — not flagged by the
panel, and adding new feedback capability there would be scope creep beyond "standardize what
exists."

**Verification:** `npm run build` passed. `test/aiEndpointContracts.test.js`,
`test/chatFeedbackTaxonomy.test.js`, `test/typographySystem.test.js`, and
`test/outfitChatLayout.test.js` passed with no new failures (same 6 pre-existing, unrelated
`aiEndpointContracts.test.js` failures as the PR A baseline). Live-verified in the authenticated
sandbox against real thread data: confirmed 12px/34px sizing on both the message-level and
board-level controls (previously 10px/17-19px), `aria-pressed` and `aria-expanded` reflect state
correctly, the disclosure toggle expands/collapses the reason-chip group, and real keyboard Tab
navigation produces the global focus ring (2px solid accent) on the new chips. No new console
errors (the one observed `fetchPriority` warning is pre-existing and unrelated).

### PR B follow-on, two post-render board surfaces use different taxonomies — resolved 2026-07-27

Discovered 2026-07-24 while explaining the staged-vocabulary ruling to the owner using two
screenshots from the same thread (`stylist/thread_1784839837475`). Traced live in the DOM
(not from code reading alone):

- A board rendered from a **structured Direction card** (one of a multi-direction proposal, e.g.
  "3 ways to style X") lives in `.stylist-outfit-result-card` → `.generated-visual-grid` and uses
  the shared `lib/feedbackTaxonomy.js` taxonomy (`STYLE_DIRECTION_REASONS` +
  `SHAPE_BALANCE_REASONS`, grouped under real headers `What feels wrong?` / `Fit and shape` /
  `Problems in the generated image`) — the same taxonomy Visual Lab's Calibration Boards use.
- A board generated **ad hoc from a plain conversational reply** (via the `Generate visual
  boards` button under ordinary chat prose) renders directly in the chat thread, outside any
  result-card wrapper, and uses `StylistChat.jsx`'s own separate, flat, ungrouped vocabulary
  (`FEEDBACK_PRIMARY_ACTIONS`/`FEEDBACK_REASON_ACTIONS` — `Too safe`, `Weak structure`, etc.,
  never wired to the shared taxonomy).

Both boards are already fully rendered photos by the time feedback is being given — so the
"some judgments need the image" reasoning behind keeping vocabulary staged (see the theme-B
ruling above) does not actually explain why *these two* differ. The real split is which flow
produced the image (structured multi-direction proposal vs. ad hoc conversational board), not
render stage. This is a real inconsistency, distinct from PR A/B's scope.

**Update 2026-07-27:** by the time this was picked back up, the ad hoc surface's own flat
vocabulary (`FEEDBACK_PRIMARY_ACTIONS`/`FEEDBACK_REASON_ACTIONS`) no longer existed — deleted
along with the rest of message-level feedback (see below) — leaving that surface with **no
feedback UI whatsoever**, not just a different one. A second, previously-undocumented surface
(`m.renderedBoards`, the model's own `render_preview` tool call mid-answer) turned out to be in
the same state. Both were unified onto the shared taxonomy in the same pass that fixed the
chat/Visual Lab desync (`docs/board-feedback-desync-spec.md`) — same components, same canonical
read/write helpers, so the marginal cost of extending them was small. All four board-rendering
surfaces in the Stylist now show the same verdict/reason/wrong-length UI. See
`docs/app-surface-map.md`'s board-feedback-chips entry for the current, accurate surface table.

## Generating-state fix — "Create outfits" showed the empty/start-over state (implemented 2026-07-24)

From the panel's "Other findings (not blocking)" list: "After `Create outfits`, the pane shows
the generic empty/start-over state instead of a contextual generating state (product)."

**Root cause:** the pane's only signal for "is this an empty new chat?" was `messages.length ===
1`. Submitting the wardrobe-builder brief, the piece-styling panel, or the outfit-styling panel
all immediately cleared the panel's own open/pending state (`wardrobeBuilderOpen` /
`pendingPiece` / `pendingOutfit`) and pushed the user's message (bringing `messages.length` to 1)
*before* the async generation call resolved. That's the exact condition that renders the full
"Ask anything about your wardrobe" empty-state hero — headline, "Try asking" suggestions, and the
same entry button just clicked — for the whole duration of the request (composer calls have run
close to 40s elsewhere in this session). It reads as the app losing the request, not as it being
in progress.

**Owner-ruled fix (approach A — "keep the panel open, but generating"):** applies to all three
Visual Composer entry landing panels, not just the wardrobe builder.

- `generateWholeWardrobeOutfits` and `send()` no longer clear `wardrobeBuilderOpen` /
  `pendingPiece` / `pendingOutfit` at the start of the request — clearing moved to each
  function's `finally` block, once the request actually settles (success or error).
- Each panel's fields/option-cards are wrapped in `<fieldset disabled={loading}>` (propagates
  disabled state to all nested `<button>`/`<input>`/`<select>` controls natively, no changes
  needed to `OptionCard`/`StylistSelect`).
- Wardrobe-builder and piece-styling panels each have one primary action button, which already
  had (wardrobe-builder) or now has (piece-styling) a `{loading ? 'Generating...' : ...}` label
  swap plus `disabled={loading}`.
- Outfit-styling has three independent `OptionCard` triggers plus a question input. A new
  `pendingOutfitAction` state (`'review' | 'similar' | 'restyle' | 'question'`) is set right
  before each trigger fires, so the specific card that was clicked swaps its own title to a
  present-tense label ("Reviewing…", "Finding similar looks…", "Restyling…") while the fieldset
  disables the other two.
- Each panel shows a contextual status line while generating (`loadingStatus` if the timed
  status sequence has one queued, else a static fallback naming what's being composed and, for
  the piece panel, the anchor piece's name).
- "Back to chat" remains enabled during generation on all three panels as a deliberate escape
  hatch — closing early re-exposes the empty-state hero, but only as a result of the user's own
  choice to navigate away, not as the default behavior.

**Verification:** `npm run build` passed; full relevant suite passed with no new failures (same
6 pre-existing, unrelated `aiEndpointContracts.test.js` failures). Live-verified in the sandbox,
following the corrected restart procedure above (killed and relaunched both servers, confirmed
`WARDROBE_MOCK_AI=true` on the running process before testing):

- Wardrobe-builder: fields disabled, button read "Generating...", contextual status shown, clean
  transition to real results.
- Piece-styling (Green jacket): same, confirmed start-to-finish under a real call before the
  mock-flag issue below was caught.
- Outfit-styling (Dad's sweater, "Review this outfit"): confirmed under `WARDROBE_MOCK_AI=true`
  — generating state renders correctly and transitions cleanly to the critique reply.

**Incident during this verification:** partway through, a live generation round was
inadvertently run against a `sandbox-api` process that had `WARDROBE_MOCK_AI=false` (the owner's
own local servers commonly sit on the same ports 3098/5174) — 3 real, billed calls were made
before this was caught. `CLAUDE.md`'s "Dev servers" section was rewritten the same day: sandbox
testing must now unconditionally kill and relaunch both servers before every session rather than
attaching to whatever's already running on those ports. See the `low-token-budget-avoid-
unnecessary-model-calls` memory for the full incident record.

## PR C — chat aria-live + lightbox focus management (implemented 2026-07-24)

From the panel's consensus-adjacent blockers (single reviewer, high severity; not ruled on
individually since both are standard, unambiguous accessibility fixes with an established,
already-ratified pattern to follow):

- "The async chat is silent to assistive tech — zero `aria-live`/`role=\"status\"` anywhere; a
  screen-reader user gets no signal the stylist is working or that a reply/card/render arrived."
- "The image preview lightbox: Escape doesn't close it, no focus trap, no focus return —
  diverges from the dialog management already ratified on sibling surfaces (garment detail,
  Lookbook, Calibration Boards)."

**Lightbox dialog management** — mirrors the exact pattern already ratified for Calibration
Boards (`VisualLab.jsx`), not a new invention:

- `previewDialogRef`, `previewCloseRef`, `previewReturnFocusRef` added alongside the existing
  `previewImage` state.
- All 10 call sites that open the lightbox (`setPreviewImage({...})`, scattered across direction
  cards, garment piece photos, generated/comparison board previews, and the piece/outfit-styling
  landing panels) now capture `previewReturnFocusRef.current = event.currentTarget` before
  opening.
- A `useEffect` keyed on `previewImage` locks `document.body` and `.app-main` scroll, focuses the
  Close button, installs a `keydown` handler for Escape (closes) and Tab (cycles focus within
  `previewDialogRef`'s focusable elements, wrapping first↔last), and on cleanup restores scroll
  and returns focus to `previewReturnFocusRef.current`.
- `role="dialog" aria-modal="true" aria-labelledby="stylist-preview-title"` added to the overlay;
  the visible title text now has that id.
- **One deliberate divergence from VisualLab's exact mechanism:** initial focus is called
  synchronously in the effect body rather than deferred through
  `requestAnimationFrame(() => ref.current?.focus())`. `useEffect` already runs after the DOM is
  committed and refs are attached, so the extra frame of deferral is unnecessary — and it made
  the behavior untestable in the sandbox browser tab, which reports `document.hidden = true` in
  this automation environment (`document.hasFocus()` stays `true`, so keyboard events still work
  correctly; only rAF-gated code is affected). Real user tabs are foregrounded, so this wasn't a
  functional bug for them, but the synchronous call is simpler and removes the dependency on
  paint timing entirely. VisualLab's own dialogs were not touched.

**Chat activity announcements:**

- Added a global `.sr-only` utility class (`src/App.css`) — the codebase had an inline
  visually-hidden pattern for one nav label but no reusable one.
- The existing typing-dots "stylist is working" indicator gained `role="status"
  aria-live="polite"`; its status text (already shown to sighted users via the timed
  `loadingStatus` sequence — "Preparing wardrobe photos…", "Composing outfits…", etc.) is now
  also what screen readers hear, with a "Stylist is working…" fallback for the moment before the
  first timed status lands.
- A separate, always-present `chatAnnouncement` sr-only live region announces "Stylist replied."
  (or "Stylist reply failed." on error) once a request that was loading settles with a new
  assistant message — needed because *removing* content from a live region (the typing dots
  disappearing) is not itself announced, so "the reply arrived" needed its own explicit signal.

**Verification:** `npm run build` passed; full relevant suite passed (143 passing, same 6
pre-existing unrelated failures) including two new regression tests locking in the dialog
attributes/handlers and the announcement wiring. Live-verified in the sandbox following the
corrected restart procedure (fresh `WARDROBE_MOCK_AI=true` confirmed before testing):

- Lightbox: initial focus lands on Close immediately; Shift+Tab from Close stays on Close (only
  one focusable control in this case, trap holds); Escape closes, restores scroll, and returns
  focus to the exact trigger element (confirmed via `document.activeElement` matching the
  original button, not just "some element").
- Chat: sending a message and receiving a mocked reply produced `chatAnnouncement` = "Stylist
  replied." (the loading-state region itself resolved too quickly to catch mid-flight against
  the near-instant mock response, same limitation encountered verifying PR A/B — the code path is
  unconditional on mock vs. real, so this doesn't weaken the finding).
- No new console errors (two stale `[hmr] Failed to reload` messages were from the intermediate
  broken-syntax state during editing, before the fix and a full page reload; the one persistent
  `fetchPriority` warning is pre-existing and unrelated).

## Small mechanical batch (implemented 2026-07-24)

From the panel's "Other findings," the items small and unambiguous enough not to need a design
ruling, plus one added mid-batch by the owner. Diagnosed individually before batching — two
similarly small-sounding findings (unstable "N looks" counts, lossy thread-rail subtitles) were
explicitly left out because they need root-cause diagnosis first, not just a markup/CSS fix.

1. **Post-send focus drops to `<body>`.** Root cause: `setInput('')` inside `send()` disables
   the send button (`disabled={loading || !input.trim()}`); if focus was on that button,
   disabling it drops focus to `<body>` per standard browser behavior. Fix: `textRef.current?.
   focus()` right after clearing input, returning focus to the still-enabled composer textarea.
2. **`Suggested additions` contrast (4.48:1, marginal).** The flagged occurrence used
   `color: 'var(--accent)'` at 10px; swapped to `var(--text-light)`, the token already
   documented in `App.css` as the app's lowest-contrast readable text color (≥4.8:1). The other
   occurrence of this label already used `--text-light` and didn't need changing.
3. **Mobile history drawer lacks dialog semantics.** `ThreadRail.jsx`'s `mobile-rail-drawer`
   gained the same dialog pattern as PR C's lightbox: `role="dialog" aria-modal="true"
   aria-label="Chat history"`, initial focus on Close, Tab focus trap, Escape to close, scroll
   lock, and focus return to whatever was focused before the drawer opened (captured via
   `document.activeElement` at mount rather than a threaded return-focus prop, since the mobile
   drawer is its own conditionally-mounted `<ThreadRail>` instance). Escape defers to an
   in-progress rename or delete-confirmation's own local Escape handling first, read through a
   ref (not a `useEffect` dependency) so the dialog-setup effect doesn't re-run — and re-steal
   focus from the rename input — on every keystroke.
4. **Send (↑) / remove-image (✕) controls unlabeled.** Added `aria-label="Send message"` and
   `aria-label="Remove attached photo"`. The drawer's own close button (`✕`, only had a `title`)
   also gained `aria-label="Close chat history"` while touching that file.
5. **Comparison sheet: `Saved` pill overlaps a column label** (added by the owner mid-batch,
   after diagnosis split it from the sibling finding — see below). All 6 `saved-board-badge`
   occurrences across generated/comparison board previews changed from an absolutely-positioned
   overlay (`position: absolute, top: 8, right: 8, zIndex: 10`) sitting on top of the image to a
   normal-flow pill rendered above it (`width: fit-content, marginBottom: 6`). The badge was
   already first in JSX source order relative to the image button at every site, so removing
   `position: absolute` was sufficient — no structural reordering needed.

**Diagnosed but explicitly not fixed as part of this — a genuine AI-generation limitation, not a
code bug:** the *other* half of the comparison-sheet finding, "baked-in caption text is
illegible." The comparison-sheet prompt (`styling-engine/core.js`'s
`wholeWardrobeComparisonSheetPrompt`) already explicitly instructs the model: `"No text of any
kind may appear inside the image"`, and separately lists captions/labels/titles/typography as
forbidden. The illegible text the panel saw is the image model occasionally not complying with
an instruction that's already correct — not a prompt-wording bug fixable by editing code. Owner
was asked whether to also try strengthening the prompt wording; declined to answer that question
for now — it remains open, undecided, and untouched.

**Verification:** `npm run build` passed. Full relevant suite passed (172 tests, 166 passing,
same 6 pre-existing unrelated `aiEndpointContracts.test.js` failures), including two new
regression tests (one in `aiEndpointContracts.test.js` covering items 1/2/4/5, one dedicated to
the `ThreadRail` drawer). Live-verified in a freshly-restarted mocked sandbox:

- Post-send focus: confirmed `document.activeElement` is the composer textarea immediately
  after sending, not `<body>`.
- Mobile drawer (375×812 viewport): initial focus lands on the close button; Shift+Tab from
  Close stays on Close (trap holds); Escape closes, unlocks scroll, and returns focus to the
  exact "History" trigger button that opened it (confirmed via DOM identity, not just "some
  button"). The nested rename-vs-drawer Escape guard was verified by code review rather than a
  live click-through — the thread row's overflow menu didn't open via a synthetic `.click()` in
  this automated environment (likely a hover/touch-state quirk), but the guard reads a ref
  populated fresh every render, so it reflects the correct `renamingId`/`confirmDeleteId` state
  at the moment any Escape keypress is handled regardless of how the menu was reached.
- Send/remove-photo/drawer-close buttons all report their new `aria-label` via the accessibility
  tree.
- Saved-board badge: verified in source (all 6 sites) that it no longer collides with the
  photo — not re-verified against an actual comparison-sheet render with visible baked-in text,
  since reproducing that specific model output isn't controllable on demand.

## Two more small removals (implemented 2026-07-24)

Owner-requested while reviewing a screenshot, not from the panel synthesis:

1. **"✓ Rendered" badge removed.** The `isPreview`-mode "Generate outfit image (~$0.07)" button
   disabled itself and showed a static `✓ Rendered` checkmark once used, with no way to
   regenerate — inconsistent with the two other render-button variants elsewhere on the same
   page (whole-wardrobe / non-preview), which stay enabled and offer `Regenerate outfit image`
   instead. Made this variant consistent with those: stays enabled after rendering, label
   becomes `Regenerate outfit image (~$0.07)` (cost stays labelled since each regenerate is a
   new paid call).
2. **"AI · propose_outfit" removed from the UI.** This was `getCardAuthorLabel`'s output — a
   QA/debug aid (see the code comment history: found during 2026-07-14 testing #87-89 that the
   model sometimes bypasses `plan_outfit_set` and silently re-composes via `propose_outfit`)
   that was rendering unconditionally on every outfit card for every user, not gated by
   `STYLIST_DEBUG_ENABLED` like the rest of PR A's engine internals. Owner asked to confirm the
   AI-vs-engine distinction stays traceable via logs before removing it from the UI — confirmed:
   every tool call (`propose_outfit`, `plan_outfit_set`, etc.) is already unconditionally logged
   server-side via `styling-engine/tools.js`'s `executeTool` wrapper (`🤖 [Agent Tool Call]
   <name> (...)`), in every environment, so grepping server logs already answers this without
   needing the UI label. Removed both the render call and the now-dead `getCardAuthorLabel`
   function; kept the historical incident context as a comment, relocated to explain why the
   card no longer shows its composing source and where to find it instead.

**Verification:** `npm run build` passed; `npm test`'s relevant suites passed with no new
failures (same 6 pre-existing unrelated failures); no test referenced either removed element.
Live-verified in a freshly-restarted mocked sandbox against the exact thread from the owner's
screenshot ("cream ribbed knit sweater styling"): the previously-rendered "Butter & Espresso"
direction now shows `Regenerate outfit image (~$0.07)` instead of a disabled `✓ Rendered`
badge, and no `AI · propose_outfit` (or any other source label) appears anywhere in the
transcript. No new console errors.

## Editorial shop-the-gap directions — free silhouette comparison (implemented 2026-07-24)

From the panel's "Other findings" list: "Editorial shop-the-gap directions are only
comparable-on-silhouette once the owner pays to render each one (fashion)." Owner explicitly
did not want to solve this by rendering images automatically (still opt-in/paid) — asked what
could be done short of that.

**What was already there, unused:** the editorial-directions-preview text call
(`EDITORIAL_NEW_PIECES_SYSTEM`, `styling-engine/prompts.js:965`) already asks the model for a
`visualPrompt` per direction — "exact silhouette... fabric feel... one specific color story...
posture/energy" — in the same free text call as `title`/`missingPieces`/`reason`. It was being
sent to the frontend (`...d` spread includes it) but never rendered anywhere in the UI; it was
only read server-side when actually generating an image. There is also a pre-existing free
silhouette sketch (`renderOutfitSketch`, a small CSS croquis with garment-shaped, color-swatched
blocks inferred from garment names) already shown on each un-rendered direction card
(`showOutfitSketch`), but each direction's sketch lived in its own separate card, stacked
vertically — nothing put them side by side for comparison.

**Implemented, both free (no new model calls):**

1. **Surface the existing `visualPrompt` text.** Added a "Full look:" line under each
   direction's sketch (`StylistChat.jsx`, gated on the same `showOutfitSketch` condition so it
   only appears for editorial ideal-additions cards, not other preview card types).
2. **Free side-by-side silhouette comparison strip.** Refactored `renderOutfitSketch` to accept
   an options arg (`{ compact = false }`) — `compact: true` returns just the 70×106 croquis
   graphic without the outer bordered row or piece-name legend, so the same sketch logic can be
   reused standalone. Added a "Compare silhouettes" strip (`.stylist-directions-compare-strip`
   in `App.css`, matching the existing `.stylist-feedback-*` token/spacing pattern) that renders
   above the existing paid "Preview all directions (~$0.07)" comparison-sheet action, gated on
   the same `isIdealAdditions` flag already used for that paid action. Shows all directions'
   compact croquis + title in one horizontal row, so a person can narrow down by rough
   silhouette/color before paying to render anything.

**Deliberately not done:** no change to the sketch's underlying category/color inference
(`detectCategory`/`detectColor` regex guessing) — that's pre-existing logic shared with the
per-card sketch and out of scope for this pass. No auto-rendering of images — the paid
comparison-sheet action is untouched and still the way to get a real photorealistic comparison.

**Verification:** `npm run build` passed. Full relevant suite passed with no new failures once
one pre-existing regex-matching test
(`StylistChat uses outfit sketch instead of color balance on ideal direction cards`, which
asserted the exact old `renderOutfitSketch` function signature) was updated to match the new
`{ compact = false }` signature — same 6 pre-existing unrelated failures as every prior PR in
this section. `dist/` (tracked in this repo) was accidentally regenerated by a local
`npm run build` during verification and reverted before committing — not part of this change.
Live-verified in a freshly-restarted mocked sandbox against the seeded "cream ribbed knit
sweater styling" thread (3 directions: Butter & Espresso, Dark Plaid Ground, Ink Denim Clean
Line): confirmed via DOM inspection that all 3 direction cards render both their own sketch and
a "Full look:" description, and that the new compare strip renders all 3 titles with compact
sketches above the existing paid comparison-sheet button. No new console errors (the
`fetchPriority` warning and `unauthorized`/recent-outfit-memory errors are pre-existing and
unrelated to this change).

## PR B follow-on — post-render board taxonomy unification (status: partially superseded, owner testing in progress — NOT ratified)

> **Correction, same day:** items 2 and 4 below (reworking the message-level feedback block,
> and its interaction-model change) were **reversed** after owner live-testing found a deeper
> problem than the vocabulary mismatch this section originally set out to fix — see "Message-
> level feedback under plain-text replies — removed entirely" further below. Item 1 (the three
> new shared-taxonomy reasons) and item 3's underlying storage-scheme reasoning remain true for
> the two board-level surfaces that still exist. The "Deliberately not preserved 1:1" tradeoffs
> below were choices about what to port onto the message-level surface specifically, so they are
> now moot — that surface no longer exists to port anything onto. Left in place as a historical
> record of what was tried and why, per this doc's usual practice, rather than deleted.

Resolves the deferred finding above: message-level plain-text-reply feedback used its own
flat, ungrouped vocabulary (`FEEDBACK_PRIMARY_ACTIONS`/`FEEDBACK_REASON_ACTIONS`, 10 reasons,
no grouping) while every rendered-board surface (structured-direction boards, editorial ideal-
additions boards, Visual Lab Calibration Boards) already shared one taxonomy
(`lib/feedbackTaxonomy.js`: `STYLE_DIRECTION_REASONS` + `SHAPE_BALANCE_REASONS`, grouped under
"What feels wrong?" / "Fit and shape"). Owner ruling: proceed with unification; owner will
verify live rather than have this session spend sandbox-testing tokens on it.

**Confirmed model-facing before implementing** (this was not a pure UI/CSS change): traced the
full path from a saved reason key to the model. `getStylistFeedbackMemory`
(`styling-engine/rules.js:1262`) builds a "Saved reactions" prompt block from
`feedback_type`/`payload.feedback_reason`, spliced into real stylist prompts at
`styling-engine/core.js:3685-3697` and `routes/ai.js:1106-1110`. For `style_direction`/
`shape_balance` feedback specifically, the reason text comes from
`FEEDBACK_REASON_LABELS[feedbackPayload.feedback_reason]` — a lookup directly against the
shared taxonomy file — so adding entries there is sufficient for the server to pick them up in
prompt text; no server-side code changes were needed for the new reasons themselves.

**Implemented:**

1. **`lib/feedbackTaxonomy.js`** — added three reasons to `STYLE_DIRECTION_REASONS` that the ad
   hoc list had but the shared taxonomy didn't: `weak_structure` ("Not enough structure"),
   `weak_contrast` ("Not enough contrast"), `bad_grounding` ("Shoes do not ground the look").
   Because `GENERATED_BOARD_FEEDBACK_LABELS` (`StylistChat.jsx`) and Visual Lab's Calibration
   Boards both consume this same array, these three options now also appear on those surfaces —
   a deliberate ripple, not a scope leak: the whole point of one shared taxonomy is that adding
   a real reason once makes it available everywhere reason chips already exist.
2. **`StylistChat.jsx`** — deleted `FEEDBACK_PRIMARY_ACTIONS`/`FEEDBACK_REASON_ACTIONS` entirely.
   Reworked the message-level feedback block (plain-text assistant replies, before any board
   renders) to match the exact pattern already used by `editorialVisualResults` board feedback:
   verdict-first row (`OVERALL_VERDICT_LABELS` via `selectGeneratedBoardVerdict` — mutually
   exclusive, not write-once) + "More feedback" disclosure revealing two grouped reason rows
   ("What feels wrong?" / "Fit and shape", via `toggleStylistFeedback` — multi-select, re-
   toggleable). The "Problems in the generated image" group (`IMAGE_FIDELITY_FEEDBACK_LABELS`)
   was deliberately left out for messages, since a plain-text reply may have no image at all.
3. **Storage scheme changed for new message-level rows going forward**: previously each ad hoc
   reason saved directly as its own top-level `feedback_type` (e.g. `feedback_type: 'too_safe'`).
   Now reason chips save `feedback_type: 'style_direction'` or `'shape_balance'` with
   `payload.feedback_reason: <key>` — the same grouped shape boards already use. This is a
   forward-only change: existing historical rows saved under the old flat scheme are untouched
   and still correctly interpreted by the pre-existing legacy code paths in
   `styling-engine/rules.js` (the weight table, the reasons-array explainability helper, and
   `routes/crud.js`'s "Learning saved" copy) — none of that legacy interpretation code was
   removed, since it still owns real historical data.
4. **Interaction model changed, not just vocabulary**: message-level verdicts were previously
   write-once (`disabled={isSaved}`, no way to change your mind); they're now mutually-exclusive
   and re-selectable, matching every other verdict row in the app. This wasn't explicitly asked
   for but follows directly from reusing the same generic `selectGeneratedBoardVerdict` function
   boards already use — treating it as a bug fix (a stuck verdict was never a deliberate design
   choice), not scope creep.

**Deliberately not preserved 1:1 — flagged for the owner to notice while testing, not hidden:**

- `too_safe` / `too_soft` / `too_generic` existed as keys in **both** taxonomies already, with
  **different display text** on each surface (e.g. `too_safe` read "Too plain" on boards but
  "Too safe" in the ad hoc list) — a live inconsistency discovered while doing this work. After
  unification there is only the shared taxonomy's existing, already-ratified text ("Too plain",
  "Feels too delicate", "Does not feel personal").
- `proportion_problem` and `catalog_drift` (ad hoc-only keys) have no identical replacement, but
  a close conceptual equivalent exists in the shared taxonomy already (`unbalanced_proportions`/
  `shape_lost` for proportion; `catalog_like` for catalog drift) — different specific wording,
  same underlying judgment, offered under group headers instead of a flat row.
- `wrong_silhouette` was **not** ported into the grouped taxonomy, and is no longer offered as a
  message-level reason at all. Investigated before dropping it: it's still alive and used by
  Visual Lab's *reference-photo* calibration (`VisualLab.jsx`'s `DRIFT_REFERENCE_LABELS`/
  `REAL_PHOTO_LABELS` — an unrelated identity-drift feature, not the outfit-board taxonomy), and
  it has its own bespoke server-side prompt caveat in `rules.js` ("do NOT globally avoid this
  silhouette family") keyed on `feedback_type === 'wrong_silhouette'` directly rather than
  through the grouped `feedback_reason` lookup — folding it into `STYLE_DIRECTION_REASONS` would
  have silently bypassed that caveat rather than preserved it. Given the mismatch, the safer
  choice was to drop the option from this surface rather than half-preserve it incorrectly; the
  closest remaining equivalent on this surface is `shape_lost` ("My shape disappears").
- `wrong_item_read` (ad hoc-only) was not ported. It already has an established, different
  per-piece meaning elsewhere (`StylistChat.jsx`'s whole-wardrobe "Swap this out" action, scoped
  to one piece within an outfit) — reusing the same key for a distinct "the reply misdescribed a
  piece" concept on a different surface, even in a different DB column, was judged more likely
  to confuse than help. Not replaced with anything.

**Verification:** `npm run build` passed. Full `node --test` suite passed with no new failures:
778/785 passing, same 7 pre-existing unrelated failures as the baseline (confirmed via
`git stash`) — 6 already known from prior PRs in this section, plus one
(`Outfit detail modal separates identity, composition, and styling actions`,
`test/outfitLookbook.test.js`) newly surfaced only because this was the first time the full
suite was run in this phase rather than a targeted subset; confirmed present on baseline,
unrelated to `OutfitLookbook.jsx` (a file untouched by this work). `test/chatFeedbackTaxonomy.test.js`
— which already asserted `StylistChat.jsx` must not contain a duplicate tuple-form definition of
`weak_structure`/`wrong_silhouette` — passed without modification, since this change satisfies
rather than violates that guard. **Not live-verified in the sandbox by this session** at the
time this paragraph was written — see the correction note at the top of this section and the
new section immediately below: the message-level surface this paragraph describes checking has
since been removed entirely.

### Data-hygiene fix found and fixed while testing this: Visual Lab's structured-reason sync (implemented, currently inert)

While devising a test scenario for the taxonomy work above, the owner spotted that Visual Lab
(Calibration Boards) and the chat's board feedback showed **different selected chip states**
for what looked like the same board. Traced to a real bug: Visual Lab writes reason chips
straight to `saved_boards.payload.feedback_details` via `PATCH /api/saved-boards/:id`; the
route's existing `syncFeedbackFromSavedBoard` (`routes/crud.js`) mirrors *group*-level labels
(`style_direction`/`shape_balance`) into `stylist_feedback` for the model to read, but has no
concept of the *specific reason* nested inside that group — so a Visual-Lab-picked reason like
`weak_structure` was mirrored as one reason-less `feedback_type: 'style_direction'` row instead
of the specific-reason row the chat's own writes produce.

**Implemented:** a new `syncStructuredReasonsFromSavedBoard` (`routes/crud.js`, exported for
testing) that syncs at the individual-reason level instead — one `stylist_feedback` row per
reason, each carrying `payload.feedback_reason`, matching exactly what the chat already writes.
`syncFeedbackFromSavedBoard` now skips `style_direction`/`shape_balance` (handled by the new
function) to avoid inserting a redundant reason-less row alongside the specific ones. Three new
regression tests in `test/savedBoardMemorySemantics.test.js` cover add/add-second/remove.

**Important finding while testing this fix — it currently has no observable effect.** The one
place that reads `payload.feedback_reason` (`getStylistFeedbackMemory`'s reactionLines builder)
deliberately **excludes** any `stylist_feedback` row whose board already exists in
`saved_boards` — specifically to avoid double-counting with `getSavedBoardMemory`, which reads
structured reasons **directly from `saved_boards.payload`** and was already correct before this
fix (see "style direction reasons reach stylist memory in plain language" earlier in this file).
Since Visual Lab only ever operates on already-saved boards, every row this fix produces is
excluded from that prompt path regardless of whether it's specific or generic. Nothing else in
`styling-engine/rules.js` reads `feedback_type === 'style_direction'`/`'shape_balance'` with a
nested reason either (`getFeedbackInfluenceForPair`'s specific-key matching expects an older,
flat `feedback_type` scheme that neither the old nor new sync produces for grouped categories).
**This is real data-shape correctness, worth keeping, but it does not fix the display mismatch
the owner originally reported** — that mismatch is a separate, frontend-only problem (the chat
reads a frozen per-thread local snapshot instead of the same canonical `saved_boards.payload`
Visual Lab reads). It's been diagnosed (fix would mean indexing full saved-board records by
imageUrl on load, and branching feedback reads/writes through the canonical `saved_boards`
record once a board is saved) but **not yet implemented** — deferred while the owner tests the
message-level removal below first.

## Message-level feedback under plain-text replies — removed entirely (2026-07-24, owner testing in progress — NOT ratified)

**What happened:** the owner tested the reworked message-level feedback block above live and
found a category error the panel's original diagnosis didn't anticipate: the verdict/reason
taxonomy (built for judging a *look* — silhouette, structure, grounding, "does this feel like
me") was rendering under **plain conversational text that isn't proposing or describing an
outfit at all** — e.g. an assistant reply answering "any accessory ideas?" with reasoning about
which existing accessories to use. Chips like "Shoes do not ground the look" or "Feels like a
costume" make no sense attached to that kind of reply; there is no look being shown to judge.

This gating problem predates this session — the same broad condition (any plain-text reply
that isn't a multi-outfit response, board, or editorial-visual result) applied to the old ad hoc
`FEEDBACK_PRIMARY_ACTIONS`/`FEEDBACK_REASON_ACTIONS` row too. The taxonomy-unification work
above made the mismatch more visible by swapping in the shared taxonomy's more explicitly
look-specific vocabulary in place of the old vaguer ad hoc list.

**Owner ruling:** do not show any feedback UI under plain text at all, even when the text
describes a look — a text description can't be judged as reliably/precisely as an actual image,
so feedback captured that way isn't accurate data. This is a full removal, not a narrower gate.

**Implemented:** deleted the entire message-level feedback block from `StylistChat.jsx`
(verdict row, "More feedback" disclosure, both reason groups — everything introduced by PR B
and reworked by the taxonomy-unification pass above). Left untouched: the adjacent "Save as
styling rule for X" / "Generate visual boards" action buttons (not feedback, not affected by
this ruling), and every board-level feedback surface (`editorialVisualResults`, whole-wardrobe
board feedback, the un-rendered direction-card "More like this"/"Not for me" row) — those stay,
since they're attached to an actual visual, not prose.

**Verification:** `npm run build` passed. Full `node --test` suite passed with no new failures
(781/788, same 7 pre-existing unrelated failures as baseline). No test in the suite referenced
the removed block. Live-verified in a freshly-restarted mocked sandbox on the seeded "cream
ribbed knit sweater styling" thread (a reply that explicitly reacts to/describes a look — the
hardest case for this ruling): confirmed the reply now shows only its Save/action buttons, no
verdict or reason chips. No new console errors.

**Status: owner-tested and ratified 2026-07-24.** Later re-verified directly against the exact
"Green jacket styling" thread the owner screenshotted (the earlier attempt's automated thread
click hadn't registered) — confirmed no verdict/reason chips under any plain-text reply there
either.

## Diagnostic "needs review" card fixes found while owner-testing the above (implemented 2026-07-24)

While re-testing against "Green jacket styling," the owner found two more problems with the
diagnostic card mechanism from PR A (already merged in #172, not new to this session):

### Issue 1 — the disclaimer's genericness made it useless for tuning

The unconditional plain-language disclaimer ("This direction didn't clear one of the engine's
structural checks...") named no piece and no check — useless for the owner's stated purpose of
using it to tune the model/engine. The specific reason (`outfit.rejectionReason`, e.g. "burgundy
suede ankle boots: register: elevated exceeds everyday ceiling") was already piece-named and
reasonably plain, not raw internals — but it was gated behind `STYLIST_DEBUG_ENABLED`, which is
off by design on `wardrobe-web` (the real dev pair). PR A's "not raw gate vocabulary" instruction
had gotten implemented as "no specifics at all" rather than "specific, but plain."

**Fix:** `outfit.rejectionReason` now renders unconditionally as "What didn't clear: ..." inside
the same always-visible disclaimer block. Removed the now-redundant `Dev: rejected reason:` line.
`outfit.resolutionNote` (a separate, less-common field) stays dev-gated, relabeled `Dev:
resolution note:`. The truly raw internals — `brokenReasonRows` ("Dev: rejected pieces:") and the
styling-engine debug trace (roster counts, register ceiling, resolved activity) — are untouched,
still dev-only.

### Issue 2 — the double-card dedup (already merged in #172) missed the common case

The PR A follow-on dedup (superseding a broken card with its corrected retry) only matched an
**exact** piece-ID set — designed for the `anchor:true` retry pattern. It missed the more common
real pattern: the model keeps the same direction (same `label`) and most pieces, but swaps out
the *specific piece that failed the gate* for a different one (e.g. "Warm Plaid Hero" retried
with cream sneakers after burgundy ankle boots were rejected for exceeding the register
ceiling — the assistant's own follow-up text even narrated the swap: *"they flagged as too
elevated for casual register, which is why I swapped them for sneakers here"*). Since the piece
IDs no longer matched exactly, both the broken and corrected cards rendered as separate,
competing "Direction" cards — and each consumed its own slot in the `Direction ${idx + 1}`
numbering (`StylistChat.jsx:1758`), inflating "2 directions" into "4."

**Owner requirement:** dedupe into one card, but still show which piece was swapped and why —
don't just silently drop the information.

**Fix** (`styling-engine/tools.js`): broadened the match to also catch same-label retries that
differ by at most one piece (not just exact matches). When the superseding retry isn't an exact
piece match, the surviving card's `engineNote` now names the swap explicitly — e.g. *"Approved
after a substitution: burgundy suede ankle boots: register: elevated exceeds everyday ceiling.
Swapped in cream leather lace-up sneakers to replace it."* — instead of the older "Approved with
an exception" wording, which is now reserved for genuine exact-match cases (e.g. `anchor:true`
retries) where nothing was actually swapped. The `Direction ${idx + 1}` numbering needed no
separate fix — it's driven by the (now correctly deduped) outfit array length, so it self-
corrects once the superseded card no longer reaches the frontend.

**Verification:** `npm run build` passed. Full `node --test` suite passed with no new failures
(782/788 passing, same 7 pre-existing unrelated failures as baseline). One pre-existing
regression test (`StylistChat gates raw engine internals behind the STYLIST_DEBUG_ENABLED dev
flag`) was updated to match the new, intentional unconditional-disclaimer behavior rather than
the old fully-gated one. A new regression test (`a corrected retry that swaps out the specific
rejected piece supersedes the broken card too`) exercises the exact boots→sneakers substitution
pattern directly against `executeTool`, asserting the card is deduped and the engine note names
both the rejected piece and its replacement.

Live-verified in a freshly-restarted mocked sandbox against the owner's exact "Green jacket
styling" thread: confirmed both broken cards ("Earthy Texture Stack" / "Warm Plaid Hero") now
show "What didn't clear: [piece]: [reason]" unconditionally, with the raw debug trace still
correctly dev-only underneath, and no duplicate "Dev: rejected reason:" line. **The dedup
broadening itself could not be re-verified live in this pass** — it only affects new
`propose_outfit` calls, and this stored thread predates the fix (can't retroactively merge
already-stored history); reproducing it live would require a fresh register-ceiling
rejection+retry, which needs a real, billed model call (the mocked tool-loop can't produce one —
same limitation as the earlier "Rust Wrap" dedup verification). Confirmed correct via the new
unit test's exact real-world piece/reason data instead.

### Broadened dedup — live verification (2026-07-25)

Owner attempted a live re-verification via real (billed) freeform-chat turns first. Two findings
from that attempt, both informative:

- Naming a flagged piece directly in the request (e.g. "propose an outfit using the trench coat
  as the layer") makes the model set `anchor:true` on it — which mechanically **skips** the hard
  gate entirely (`styling-engine/tools.js`: `if (piece.anchor) return []`, "the user asking to
  wear it overrides auto-use suitability gates"). So directly asking for a flagged piece can
  never trigger this bug/fix — there's nothing to reject. This isn't a bug, just a real
  architectural reason the scenario can't be steered by prompt wording alone.
- A "what can I use as a layer" style advice question gets answered in prose, without any
  `propose_outfit` call at all — the tool-loop only fires when the model decides to compose an
  actual card, which conversational/advice-style phrasing doesn't reliably trigger.

Given the mock AI handler can't drive a real multi-step tool-calling sequence either (see above —
`takeTestAiResponse` returns one flat value, which `askStylistWithTools` treats as a finished
prose answer, never dispatching to `executeTool`), building a scripted AI response wasn't a
viable shortcut. Instead: `scratch/build_dedup_fix_demo_thread.js` calls the real
`executeTool('propose_outfit', ...)` directly, twice, against the durable sandbox DB — no AI
call, no approximation, the actual production gate-evaluation and dedup code:

1. `{ dress (anchor), tan cotton trench coat with belt (outerwear), black lace-up ankle boots (shoes) }`,
   occasion `city`, season `hot July day` → real rejection:
   `tan cotton trench coat with belt: hot weather: insulating piece`, broken card recorded.
2. Same label, trench swapped for the (lightweight, linen-blend) green jacket → real `success`;
   `toolContext.generatedOutfits.length` stayed at 1; the surviving card's `engineNote`: *"Approved
   after a substitution: tan cotton trench coat with belt: hot weather: insulating piece. Swapped
   in Green jacket to replace it."*

The script then inserts the resulting exchange as a normal `chat_threads` row
(`thread_dedupfix_demo_*`, titled "Dedup fix demo — Rust Dress Layered (scripted, real
executeTool)"), so it's browsable live in the sandbox exactly like any other chat — confirmed via
direct URL (`/stylist/thread_dedupfix_demo_1784946587334`): single "Rust Dress Layered" card,
`DIRECTION` badge, the italic engine note visible under the title, all three real pieces resolved
to actual sandbox photos, no duplicate broken card anywhere. **The broadened dedup fix is now
live-verified**, closing the gap the unit test alone couldn't close. Re-runnable any time by
setting the sandbox DB env vars (see script header) and running
`node scratch/build_dedup_fix_demo_thread.js` — useful for the panel review and for any future
regression check without spending on a real model call.

## E1 — critique buries the answer (implemented 2026-07-24)

"Action guidance ('what to change first') renders last, after a dozen diagnostic/score rows"
(fashion review finding, panel synthesis). Traced to `formatSharedOutfitEvaluation`
(`styling-engine/core.js`), which builds the collapsed "Full structured read" details behind
`CritiqueBody`'s toggle. `structuredDetailParts` put diagnostic fields (visible facts, tension,
scores, roles, style idea, viability, execution gap, main success) first and the actionable
fields (`firstVisibleIssue`, `recommendation.smallestAdjustment` as `Next:`, `avoidForNow`,
`tryNext`) dead last — so anyone expanding "Full structured read" for the specific fix had to
scroll past everything else first. Confirmed this wasn't a one-off: `fallbackFollowupFeedback` a
few lines below already puts `firstVisibleIssue`/`Next:` first — an "answer first" convention
already established elsewhere in the same file, just not applied to the main construction.

Note: `critiqueProse` (the always-visible text above the collapsed toggle) is separately
instructed by the system prompt to already synthesize the recommendation in natural voice
("Write critiqueProse LAST... it is the only part the user reads by default, so it must stand
alone" — `styling-engine/prompts.js:577`). This fix is specifically about the *expanded*
structured-detail view, for whoever opens it looking for the specific fix in field form, not a
claim that the always-visible prose itself was broken.

**Fix:** reordered `structuredDetailParts` so `First visible issue:` and the three
recommendation fields (`Next:`, `Avoid for now:`, `Try next:`) lead the list, ahead of the
supporting diagnostic dump. No other fields' relative order changed.

**Verification:** `npm run build` passed. Full `node --test` suite passed with no new failures
(782/789, same 7 pre-existing unrelated failures as baseline). Extended the existing "saved
outfit cards use the shared wardrobe evaluator with linked garment images" regression test with
explicit ordering assertions (`First visible issue:` before `Next:` before `Visible facts:`
before `Scores:`), using the same realistic mock evaluation shape already exercised there — no
new fixture needed. **Not live-verified in the sandbox** — mock AI mode returns canned text for
critiques ("Mock sandbox critique: WARDROBE_MOCK_AI is on...") rather than real structured
evaluation data, so this specific ordering isn't observable there; confirmed via the unit test
exercising the real `formatSharedOutfitEvaluation` function through the actual endpoint instead.

**Live verification, real data (2026-07-25).** Owner ran a real (billed) "Evaluate outfit" call
in the sandbox against the "Cream Ribbed Knit + Denim Jacket" critique
(`thread_1784944553649`). The real structured response confirms the fix in production: after
`Verdict: revise`, the "Full structured read" leads with `First visible issue:` (jacket/sweater
hem colliding at the hip) then the three recommendation fields (`Next:`, `Avoid for now:`,
`Try next:`) — all four appearing before `Intent:`, `Success criteria:`, `Visible facts:`,
`Tension:`, `Scores:`, `Roles:`, and the rest of the diagnostic dump. This is now live-verified
with real (non-mock) data, not just the unit test.

## "Recommended design direction" feedback — audit and follow-up (2026-07-24)

Owner surfaced a separate piece of feedback that had never been logged in this document (search
turned up nothing for its distinctive terms — "dressing table", "body column", "visual thesis",
"finishing area", "anchor garment", "optional confirmation", "comparison set", `artistic_minimal`
— before this entry). Recorded verbatim here so it isn't lost again, followed by a point-by-point
audit against the code as it stood at the start of this session:

> Recommended design direction
> For generated styling results:
> * Build a category-aware "dressing table" composition:
>    * top and bottom form the body column;
>    * outer layers overlap that column;
>    * footwear grounds it;
>    * accessories occupy a finishing area.
> * Keep the anchor garment in the same position across selected-piece directions.
> * Give each direction one plain-language visual thesis, such as:
>    * "Floral top leads; dark jeans ground it; cream shoes keep the finish light."
> * Replace ambiguous rankings like "Signature / Strong / Usable" with:
>    * "Closest to your brief"
>    * "Strong alternative"
>    * "More exploratory"
>    * "Needs review"
> * Move telemetry, source labels, internal vocabulary such as `artistic_minimal`, and technical
>   diagnostics behind disclosure.
> * Make two-to-four results function as a comparison set before the user generates a worn image.
> * Keep generated images optional confirmation — not the first point where an outfit becomes
>   understandable.

**Audit at time of question, before any new work in this entry:**

1. Dressing-table composition — **already matched**, pre-existing. `renderOutfitSketch`
   (`StylistChat.jsx`) already draws a category-based croquis: top/dress form a vertical column,
   outerwear overlaps as a border layer, bottom continues the column, shoes sit at the base, and
   the accessory occupies its own corner slot. Predates this session; not built in response to
   this feedback, but satisfies it.
2. Anchor garment same position across directions — plausible as an emergent property of the
   same category-slot layout (anchor's category always maps to the same visual slot), but never
   explicitly implemented or tested against this specific requirement.
3. One plain-language visual thesis per direction — **not present**. The existing `reason`
   (one analytical sentence) and the `visualPrompt` field surfaced this session as "Full look:"
   (silhouette/fabric/color/posture, `styling-engine/prompts.js:965`) are both denser and
   differently-shaped than the terse "leads / grounds it / finish" example given here.
4. Rename Signature/Strong/Usable/Experimental → Closest to your brief / Strong alternative /
   More exploratory / Needs review — **not done**. `strengthLabel` (`StylistChat.jsx`) still
   emitted the raw internal words as the visible badge text and section-heading text.
5. Move telemetry/source labels/`artistic_minimal`-style vocabulary behind disclosure — **mostly
   already done** by this session's own PR A (dev-flag-gated engine trace/telemetry) and the
   later "AI · propose_outfit" label removal. `artistic_minimal` itself never reaches the client;
   it's a style-lane key used only inside the server-side system prompt
   (`styling-engine/prompts.js`).
6. Two-to-four results as a comparison set before rendering — **done this session**, via the
   "Editorial shop-the-gap directions — free silhouette comparison" entry above (same day, earlier
   in this session, before this feedback was raised) — the free "Compare silhouettes" strip.
7. Generated images as optional confirmation, not the first point of understanding — **done**,
   same change as #6 (sketch + "Full look:" text now let someone evaluate a direction without
   paying to render).

Net: 3 of 7 already satisfied (by code that predates or was written earlier the same day without
knowing this was the source feedback), 2 genuinely open (#3, #4), 1 partial (#5, with the one
concrete named term `artistic_minimal` confirmed clean), 1 unverified rather than confirmed (#2).

**Follow-up work done in this entry (points #3 and #4):**

- **#4 — renamed the strength vocabulary.** Added `DIRECTION_RANK_LABELS`
  (`StylistChat.jsx`, module scope) mapping `signature → 'Closest to your brief'`,
  `strong → 'Strong alternative'`, `usable → 'More exploratory'`,
  `experimental → 'Needs review'` — a direct 1:1 substitution matching the four raw values the
  code already had to the four replacement phrases the feedback gave, in the same order. Both
  the per-card badge (`strengthLabel`) and the section-heading builder (`buildResponseSections`'s
  `rankLabel`, which previously produced awkward strings like "Alternate direction") now go
  through this shared map. Card behavior that depended on the *raw* value (`isRankedCard`, which
  drives the `is-ranked` highlight styling) was repointed to check `outfit.strength` directly
  instead of the display string, so it can't silently break if the label wording changes again.
  Known accepted overlap: the broken/diagnostic-card path already showed literal "needs review"
  text for a different reason (an engine-level structural rejection, not a low-confidence
  direction) — it now coincidentally shares wording with the renamed `experimental` tier. Left
  as-is; the two states are still visually distinguished by the existing `is-broken` styling,
  accompanying disclaimer text, and (for broken cards) the rejected-piece list.
- **#3 — added a plain-language visual thesis line.** New `buildVisualThesis` helper
  (`StylistChat.jsx`), reusing the same role-extraction data (`getPreviewPieces`) that
  `renderOutfitSketch` already computes, so the thesis always describes the same composition
  shown in the sketch next to it. Deliberately does not reuse `simplifyPieceTitle` (which strips
  color words for compact trip-card titles) — color is exactly what the feedback's own example
  relies on ("dark jeans", "cream shoes") to make one direction read differently from another.
  Renders as `"{lead}, grounded by {ground}, finished with {finish}."` — passive-participle
  connectors deliberately chosen over conjugated verbs ("leads"/"grounds"/"finishes") because
  garment names are free text of unpredictable grammatical number ("Cream Loafers" vs. "Denim
  Jacket"), and "X leads" vs. "X lead" agreement can't be determined reliably client-side.
  Rendered above the existing "Full look:" line, gated on the same `showOutfitSketch` condition
  (editorial ideal-additions direction cards only).
- **CSS fix found during verification.** The longer rename phrases broke the card heading's
  layout on narrow viewports: `.stylist-outfit-result-heading` used `justify-content:
  space-between` with no wrap, so a badge like "CLOSEST TO YOUR BRIEF" (fixed-width, uppercase,
  letter-spaced) squeezed the title into an unnaturally narrow column (measured: title box
  dropped to 79px wide, wrapping to 3 lines, on a 375px mobile viewport). Fixed by adding
  `flex-wrap: wrap` to the heading and `flex: 1 1 160px; min-width: 0` to the title, so the badge
  now drops to its own line under the title when space is tight instead of crushing it. Verified
  via direct `getBoundingClientRect()` measurement before/after on the actual rendered card, not
  just visual inspection.
- **Not done:** #2 (anchor-position consistency) was left unverified/unimplemented — it appears
  to already hold structurally given the category-slot layout, but no explicit test or dedicated
  code exists for it, and confirming it properly would mean auditing every direction-generation
  path, which is out of scope for this pass.

**Verification:** `npm run build` passed both before and after the CSS fix. Full `node --test`
suite (`aiEndpointContracts.test.js` + `threadRail.test.js`) passed with the same 6 pre-existing
unrelated failures as baseline (confirmed identical via `git stash`/re-run — no new failures, no
fixed failures). Live-verified in a freshly-restarted mocked sandbox:
  - The seeded "cream ribbed knit sweater styling" thread (same 3-direction thread used for the
    E3 silhouette-comparison verification) now shows, for each direction, a bolded thesis line
    above "Full look:" — e.g. "cream ribbed knit sweater, grounded by deep espresso straight-leg
    trouser with clean pressed hem and slight structure." and (for the direction with a shoe
    role) "...grounded by ink navy structured pencil skirt..., finished with dark cognac or
    oxblood chunky ankle boot...".
  - The seeded "Casual" whole-wardrobe thread (5 looks) now shows section headings "Closest to
    your brief" / "Strong alternative" and matching card badges "CLOSEST TO YOUR BRIEF" /
    "STRONG ALTERNATIVE", with the pre-existing broken-card badge still correctly reading "NEEDS
    REVIEW".
  - Confirmed via DOM measurement (not just screenshot) that the heading no longer squeezes the
    title at 375px width after the CSS fix — title renders full-width on its own line, badge
    wraps to the line below it.

## Panel-readiness cleanup (2026-07-25)

Two defects fixed ahead of the first Mode B expert panel (see `docs/expert-panel-brief.md`), both
recorded in full in `docs/stylist-bugfix-spec.md` (addendum items 8 and 9):

- **Legacy stored diagnostic cards still leaked raw gate vocabulary.** PR 175 fixed this
  source-side in `routes/ai.js`, but thread payloads are durable and there is no migration, so
  cards stored before that fix still carried `watchFor` / `systemFlags` / a
  `Rejected because …` suffix on `reason` and still rendered them. Now stripped and dev-gated at
  render. **General rule worth remembering: render-side fixes apply retroactively to stored
  threads, generation-side fixes do not.**
- **The plan overview's `Useful repeats` label was a keyword guess** over the planner's own prose.
  Both planner branches contain the word "repeats", so a plan with zero repeats announced "Useful
  repeats: Every look is distinct." Now read from the structured `pieceReuse.repeated` the planner
  already attaches.

**New launch config: `sandbox-web-asuser` (port 5176)** — the sandbox web server without
`VITE_STYLIST_DEBUG`. `sandbox-web` has the dev flag on, so anyone reviewing the Stylist there
sees engine internals no real user ever sees. Use the `-asuser` server for panel evidence and for
any "what does the owner actually see" question; the two share `sandbox-api` and can run
side by side.

## Outstanding issues — before re-assembling the expert panel

Consolidated list of what's still open, so the panel re-review targets real gaps rather than
already-fixed ground. Everything above this point in the document is owner-tested and ratified.

1. **Chat vs. Visual Lab board feedback show different selected states for the same board.**
   **Fixed 2026-07-27** — see `docs/board-feedback-desync-spec.md`'s "The display fix" section
   for what shipped. Chat now indexes full saved-board records by `imageUrl` on load and branches
   board-feedback reads/writes through the canonical `saved_boards` record once a board is saved,
   exactly as scoped below; the per-thread snapshot remains the fallback for never-saved boards.
   Live-verified both directions in the sandbox. (Note: the *data-shape* half of this area —
   Visual Lab's reason-chip sync writing a reason-less row — was already fixed in the taxonomy-
   unification pass above; that fix is real but has no observable effect, since nothing reads it
   for already-saved boards, and remains that way on purpose — see the desync spec's "Deliberately
   not touched" note.)

2. **The chat and Visual Lab write board feedback to two different stores** — expanded from
   issue 1 on 2026-07-26, after a false alarm worth recording so it is not repeated.

   **False alarm, corrected:** counting `saved_boards.payload` showed no writes after 2026-07-23
   and zero `style_direction` values ever, which looked like the taxonomy unification (#173,
   2026-07-24) having broken the write path. It had not. Feedback writing is healthy — the most
   recent `stylist_feedback` row is `2026-07-26 08:30:10`. **`saved_boards.payload` is only the
   Visual Lab path; the chat writes to `stylist_feedback` instead**, which is the desync already
   diagnosed and deferred earlier in this document. Counting one store and concluding the feature
   was broken is the error; do not repeat it.

   **What the corrected counts do show, and it is still worth a look:** of 367 `stylist_feedback`
   rows, **none carries `payload.feedback_reason`** — the specific-reason key the grouped
   `style_direction` / `shape_balance` scheme is supposed to write. `style_direction` rows exist
   (e.g. 2026-07-23) but are reason-less, which is precisely the shape the deferred
   `syncStructuredReasonsFromSavedBoard` work was meant to correct and was then found to be inert
   for already-saved boards. So the open question is not "is feedback captured" — it is **whether
   the specific reason inside a grouped chip ever reaches the model**, on either path.

   Unblocked, free, no model call: trace one `style_direction` row from write to prompt text and
   confirm whether its reason survives. Until that is answered, any judgement about whether the
   grouped reason vocabulary earns its place is judging a channel whose delivery is unverified.

   **Answered, 2026-07-27:** yes, the specific reason survives — `getSavedBoardMemory` reads
   `saved_boards.payload.feedback_details` directly and renders it into plain language for the
   model, for any board that's been saved. The channel was never broken; only the *display* (issue
   1, now fixed) and the `stylist_feedback` mirror (deliberately still inert, not a bug — see
   `docs/board-feedback-desync-spec.md`) were in question. "Two different stores" is also no
   longer quite the right frame post-fix: once a board is saved, chat reads and writes the same
   canonical `saved_boards` record Visual Lab does; `stylist_feedback` remains the store only for
   boards that were never saved.

3. **Gate-generated metadata tasks have stopped appearing, and the plan path never generated them
   at all.** Owner-reported 2026-07-26 ("I have not seen any tasks from the gates lately"),
   confirmed against `wardrobe.db` the same day. **Not diagnosed.**

   Measured: **zero `metadata` todos exist**, while **7 active pieces are missing `formality`** —
   exactly the field the register gate excludes on and writes a task for. Other todo types are
   present and current (3 retag-suggestions, plus user-created repair/donate/shopping), so the
   table and the UI are fine.

   Two candidates, and they are not exclusive:

   - **The plan path cannot create them by construction.** `ensureMetadataTodo` is called only from
     `buildVisualComposerRoster` (`styling-engine/rules.js`). Capsule and trip planning gates
     through `filterWholeWardrobePiecesForGeneration` instead, which never calls it — so a garment
     dropped from a plan for missing metadata is dropped **silently**, with no task and no other
     surfacing. Given how much recent use has been plans, this alone may explain the absence.
   - **Something else prevents it on the composer path too.** `recordMetadataTodos` defaults to
     `true` and no caller overrides it, so the flag is not the cause. With 7 pieces missing
     `formality`, at least one composer run over a pool containing them should have written a task.
     Worth confirming whether those 7 are reaching the pool at all — they may be filtered earlier,
     e.g. by status or occasion, before the register gate sees them.

   **Why it matters beyond the queue:** these tasks are the only surface that tells the owner *which
   garments the engine could not consider, and why*. Without them a mistagged piece is invisible to
   recommendations indefinitely, and the only way to discover it is a manual diagnostic — which is
   how the 2026-07-25 shoe investigation went, at a cost of two hours.

   Free to investigate: replay `buildVisualComposerRoster` against the real wardrobe with the 7
   untagged pieces in the pool and see whether a task is written. No model call.

4. **Build the engine-behaviour map — the companion to `docs/app-surface-map.md`.** Raised
   2026-07-26. The surface map is derived UI-first (`scratch/derive_surface_skeleton.js` walks
   routes, tabs, mode gates and dialogs), so it is structurally blind to anything that never
   renders. Every non-UI behaviour that reached it got there by accident — the retag-suggestion
   loop from a screenshot, the gate-task mechanism from an unrelated grep, the whole-wardrobe
   recency memory only because the owner pointed at a panel footer.

   What a second map should cover, derived on a different axis (writes, prompt splices, retry
   loops — all greppable):

   - **Write-triggered side effects.** One `PATCH /api/saved-boards/:id` also writes retag tasks,
     mirrors feedback into `stylist_feedback`, and syncs structured reasons. One user action, four
     writes, one landing in a different feature.
   - **Output guards and retries.** `applyFreeformOutputChecks` re-prompts the model up to six
     times on a guard violation — invisible, and it costs money.
   - **Memory builders.** `getSavedBoardMemory`, `getStylistFeedbackMemory`, session recency,
     owner rules: what reaches the prompt, from where, in what words.
   - **Scoring.** `planWorkbenchPieceScore`, `capsuleVersatilityScore`,
     `compatibilityScoreForSelectedItem` — including weightings like the 30-point `fit_confidence`
     bonus, found only by reading.
   - **Caches and invalidation**, **sweeps** (`clear-orphaned`), and **CI ratchets** (text-matching
     ratchet, style-claims guard) that constrain what future code may do.

   This is where the expensive surprises live, because none of it is visible to the owner or to a
   panel. Not started.

5. **Decide video import: optimise or disable.** Owner position 2026-07-26 — *"prohibitively
   expensive and not very productive, so most likely will disable it. But maybe we should review it
   and see if it can somehow be optimised first."* Already hidden from users, owner-flagged only.

   **The expensive part is not the API bill — it is false positives.** Owner's correction, and it
   changes what optimisation would even mean: video produces many garment-shaped proposals that are
   not garments, and each one costs owner attention in the review gate. Anything mistakenly accepted
   then needs tagging, and a badly-tagged garment is precisely what the hard gates exclude silently
   (see issue 3).

   **Why precision is poor by construction:** sampling is `fps=1` — one frame per *second*, so a
   two-minute walkthrough is ~120 images. The only automatic filter is a blur check
   (`FRAME_MIN_STDDEV = 10`); nothing deduplicates near-identical consecutive frames, so a slow pan
   over one rail survives as dozens of near-copies. And a garment seen at an angle, half-occluded,
   in motion is weak evidence — the classifier proposes it anyway.

   **The single most expensive step is AI tagging** (owner, 2026-07-26) — a model call per garment,
   so spend scales with *proposals carried forward*, not with frames. That is why false positives
   cost twice: once in review attention, once in tagging anything mistakenly accepted.
   **Optimising the tagging step may be the better first move**, and it pays off across every
   import path and the wardrobe generally — not just video. Treat that as a possible precursor to
   this decision rather than part of it.

   **The number that decides this is precision, and it is measurable for free.** `import_clusters`
   carries a `status` reaching `accepted` when a cluster becomes a real piece, so
   accepted-vs-proposed for video-origin sessions can be computed from past imports — no new video,
   no model call. **If precision is low, sampling tuning cannot rescue it**, because the problem is
   evidence quality rather than frame count, and the honest answer is to disable.

   **Levers only worth trying if precision turns out to be decent:** drop to `fps=1/3` or lower;
   perceptual-hash dedup between consecutive frames before classification; classify a cheap
   subsample first and expand only where garments are found.

6. **The chat message fold is annoying to read against, and folding may be the wrong mechanism
   entirely.** Owner-reported 2026-07-25. `INITIAL_SAVED_MESSAGE_COUNT = 8`
   (`src/components/StylistChat.jsx`) renders only the last 8 messages when a thread opens, so a
   long thread opens mid-conversation and earlier turns are hidden behind a control. It came from
   `701690b` *"Speed up garment and chat loading (#162)"* (2026-07-22) and is a genuine **render**
   optimisation — all the data arrives regardless; the fold cuts DOM and image work on photo-heavy
   threads. So the goal is real; the mechanism hides content to achieve it.

   The sibling `INITIAL_SAVED_OUTFIT_COUNT = 4` fold was already narrowed in PR #176 — plans and
   whole-wardrobe responses are exempt, because a plan is one artifact and splitting it cut the
   thing the owner asked for in half. Ordinary multi-result replies still fold. **The message fold
   is untouched and is the one the owner finds annoying.**

   Options, in rough order of preference:
   - **`content-visibility: auto`** on message containers — the browser skips layout and paint for
     offscreen content with essentially no JS, nothing hidden, no "show more" control. Would let
     both folds be deleted rather than tuned. Needs `contain-intrinsic-size` to avoid scrollbar
     jump, and measurement against a long photo-heavy thread.
   - **Windowing/virtualisation** — strictly better scroll performance, materially more complexity,
     and it interacts badly with in-thread anchors and find-in-page.
   - **Keep folding, raise the number** — cheapest, addresses the annoyance without addressing the
     mechanism.

   Not started. Measure first: the fold was added for a real load problem, so any replacement has
   to be checked against the thread it was added for, not against a short one.

7. **Plan outfit cap does two different jobs.** `planTotalOutfitCapForBudget`
   (`styling-engine/outfitSetPlanner.js`) caps a plan at 8 outfits below an 18-piece budget. For a
   trip that is sensible — the axis is days. For a capsule it is the wrong axis: a 14-piece capsule
   is 5 tops × 5 bottoms, so ~25 combinations presented as 8, and both capsules examined carried
   `plan trimmed` notices where the model asked for more and was cut. Owner decision on approach:
   split the cap by plan shape (trips day-driven, capsules combinatorial), as the general rule
   "a plan's cap comes from its own shape". The number is unresolved on purpose — it should come
   from real capsule-wardrobe practice, not a guess. **Deferred to the panel:** if the capsule flow
   doesn't survive Stage 1 in this shape, the number is moot. Full detail in
   `docs/stylist-bugfix-spec.md`.

8. **Anchor-garment position consistency across selected-piece directions is unverified.**
   From the "Recommended design direction" feedback (entry above). Appears to hold structurally
   — `renderOutfitSketch`'s layout is category-slotted, so the anchor lands in the same visual
   slot across cards as a side effect of the layout, not by deliberate design — but no explicit
   test or code exists confirming this holds across every direction-generation path. Needs a
   dedicated look before it can be called ratified rather than assumed.

**Resolved, not open:**
- "Recommended design direction" feedback, points #3 and #4 (visual-thesis line, strength-label
  rename) — implemented, see entry above. Points #1, #6, #7 were already satisfied by
  pre-existing code or this session's earlier E3 work. Point #5 (telemetry/vocabulary
  disclosure) confirmed mostly already done, with the one named term (`artistic_minimal`)
  confirmed clean of any client-side leak.
- E3 (editorial shop-the-gap silhouette comparison) — implemented (free `visualPrompt` text +
  compare-silhouettes strip).
- **Garment IDs in stylist prose** ("The tan leather tote (ID 12)…") — owner ruling 2026-07-25:
  **deliberate and requested**, not an internals leak. The IDs are there so a recommendation that
  exposes a mistagged garment leads straight to the record that needs fixing — and because garment
  names collide constantly, especially auto-tagger-written ones, so the ID is what makes a
  recommendation point at one unambiguous record. Not a defect, so it belongs on every future
  exclusion list. **But the presentation is open:** the owner invites panels to propose
  alternatives, provided they actually solve garment disambiguation rather than just hiding the
  number.
- A4 (cost-bearing actions on broken/"needs review" cards) — owner ruling: leave as-is, cards
  are usually fine, the engine is what's broken. Not a bug.
- E4b (comparison-sheet illegible baked-in captions) — owner ruling: leave alone, it's the image
  model not complying with an already-correct "no text" instruction, not a fixable prompt bug.
- PR B follow-on (post-render board taxonomy unification) — implemented, then partially
  superseded by the message-level feedback removal above; what remains (three new shared
  reasons, crud.js sync correctness) is ratified.
- Message-level feedback under plain text — removed entirely, ratified.
- Diagnostic-card disclaimer specificity + double-card dedup broadening — implemented, ratified.
- E1 (critique buries the answer) — implemented, ratified: the actionable answer now leads the
  collapsed "Full structured read" details instead of trailing the diagnostic dump.
- E9 (unstable "N looks" counts) — implemented. Root cause: two independent, disagreeing
  counting rules for the same data. The in-chat header (`StylistChat.jsx`'s
  `lookCount = visible.length || outfits.length`) already excluded `diagnosticOnly` cards; the
  thread-rail sidebar subtitle (`threadGrouping.js`'s `getThreadOutcomeSummary`) counted
  `memory.latestOutfits.length` raw, diagnostic cards included — so a thread with any lingering
  diagnostic card showed a different count in the sidebar than in the chat itself. Confirmed via
  `git blame`/diff review that PR 174 (E1) didn't touch this — different function, different
  file, no overlap. Fix: `getThreadOutcomeSummary` now filters `diagnosticOnly` outfits before
  counting/deriving themes, with the same empty-set fallback (count everything if the filtered
  set is empty) the header already uses, so an all-diagnostic thread still shows a real number
  instead of falling through to the no-outfits branch. Verified via two new precise assertions
  in `test/threadRail.test.js` (mixed diagnostic+real, and all-diagnostic) using the actual
  function's real output, not hand-derived expected strings. `npm run build` passed; full
  relevant suite passed with no new failures. Live-verified in a freshly-restarted mocked
  sandbox that the sidebar renders normally with no regressions for ordinary threads — the
  specific mixed-diagnostic scenario itself wasn't reproduced live, since (like the PR A-follow-
  on dedup fix) that requires an uncontrollable real model response the mock can't produce; the
  unit test's use of real function output is the verification for that part.
- E10 (lossy thread-rail subtitles) — implemented. Root cause: critique, similar-variants,
  creative-alternatives, adjacent-variants, and comparison threads all share
  `activeContext.type === 'outfit'` and `thread.kind === 'outfit_critique'`, and
  `getThreadDisplayTitle`/`getThreadOutcomeSummary` (the flat "Recent" list — the default rail
  view) both collapsed every one of them to the same generic `"<name> critique"` title /
  `"Outfit critique"` subtitle regardless of which action it actually was. The differentiation
  logic already existed and worked correctly — `outfitSubjectActionTitle`, pattern-matching the
  turn's prompt/title/source text for creative/adjacent/similar/comparison/critique keywords —
  but was only wired into `getThreadSubjectChildTitle` (the "By outfit/piece" clustered view's
  child rows), not the default flat list. Fix: both flat-list functions now call
  `outfitSubjectActionTitle`, falling back to the old generic text only if it can't tell (empty
  prompt/title/source). Added `SHORT_OUTFIT_ACTION_LABELS` so the title's terse
  `"<name> · <action>"` suffix convention (already established for Similar/Creative at thread-
  creation time in `StylistChat.jsx`'s `send()`) extends to the two actions that convention never
  labeled (comparison, adjacent variants); the subtitle uses the full descriptive form directly
  since it reads naturally as a standalone summary line. Verified via 8 new precise assertions in
  `test/threadRail.test.js` (four action categories × title + subtitle) using real function
  output. `npm run build` passed; full relevant suite passed with no new failures. Live-verified
  in a freshly-restarted mocked sandbox against real existing threads: confirmed genuinely
  differentiated output across both the flat list (`"Boston bench · Critique"` / `"Outfit
  critique"`, `"Whole-wardrobe comparison sheet · Compari…"` / `"Outfit comparison"`, `"with my
  camera · Creative"` / `"Creative alternatives"` — previously all identical) and the clustered
  view (no regression: `getThreadSubjectChildTitle`'s internal call to `getThreadDisplayTitle`
  still correctly separates "Outfit critique" and "Creative alternatives" as distinct child rows
  under the same "with my camera" subject).

**Deliberately not built / by design — not defects, do not re-file:**

This list exists because the *Resolved, not open* list above only covers things that were built
and then decided; it says nothing about absences that look like bugs but are either intentional
behaviour or simply never built. That gap let the same four non-defects get independently
rediscovered and reported as bugs four times in one working session (2026-07-25) before anyone
wrote them down in one place. If a panel or a future session finds an absence that isn't on this
list, that is a real finding — but check here first.

- **"City stroll" implying comfortable walking shoes.** Owner ruling 2026-07-25: by design. A slot
  described as a city stroll should get walking-suitable footwear; the inference already fires
  only on the `smart_casual_outing` slot whose `bestFor` names it, not on the other four slots.
  Full trace in `docs/stylist-bugfix-spec.md`.
- **One shoe carrying 7 of 8 looks in a 14-piece capsule.** Diagnosed, not a variety failure: the
  budget buys exactly 3 shoe slots (`capsuleQuotas`), one of which the register-floor guarantee
  spends on an evening-capable shoe. Correct behaviour given the current shoe-quota math. The
  underlying "is 3 shoe slots the right number for a 14-piece capsule" question is still open —
  see item 2 above (plan outfit cap) — but the 7-of-8 distribution itself is not a bug.
- **Plans not absorbing their own revisions.** Never built. Ask a plan for a change and the
  revision arrives as a separate `proposed` card beside the plan rather than folding in — a second
  cost of the same gap is that a revised plan gets progressively harder to find in the thread rail
  the more it's refined, since the rail summarises from only the latest turn's outfits. Judge
  whether the merge *should* exist; its absence is not itself a defect to report. Full detail in
  `docs/stylist-bugfix-spec.md`.
- **Garment IDs in stylist prose** — also listed under *Resolved, not open* above; repeated here
  because it is the paradigm case (an absence-of-obfuscation that reads as an internals leak but is
  a deliberate, requested disambiguation mechanism).

## Stylist bugfix spec cleanup (implemented 2026-07-24, see `docs/stylist-bugfix-spec.md`)

Defect cleanup pass from a fresh expert-panel review, done as its own spec so the *next* panel
has nothing mechanical left to report. All items below are code-only fixes on the Stylist
surface unless noted.

1. **Raw gate vocabulary leaked onto diagnostic cards (highest priority).** `routes/ai.js`'s
   `buildBrokenModelCard` and `buildBrokenDiagnosticCard` each set the same raw rejection text
   three times: the structured `rejectionReason` field (correctly gated behind
   `STYLIST_DEBUG_ENABLED`/rendered as the plain-language "What didn't clear" line), plus
   `watchFor`, a `systemFlags` entry, and a "Rejected because …"/"Broken because …" suffix on
   `reason` — all three of which render ungated inside the "Why this outfit" disclosure. Fixed
   at the source: both builders now set only `rejectionReason` (added to
   `buildBrokenDiagnosticCard`, which previously didn't have it at all) and leave `reason` as the
   model's/local-fill's own text, with no raw internals duplicated into `watchFor` or
   `systemFlags`. `resolutionNote` was already correctly gated and untouched. Updated
   `test/aiEndpointContracts.test.js`'s existing broken-card assertions (systemFlags check →
   rejectionReason check) and `test/walkableComfortDivergence.test.js`'s resolutionNote test, and
   added a new regression assertion in `aiEndpointContracts.test.js` (both broken-card tests) that
   walks every ungated field and confirms the raw `rejectionReason` string doesn't reappear in
   `reason`, `watchFor`, or any `systemFlags` message — testing the invariant per the spec's
   guidance, not per-string copy.
2. **`--text-light` was shadowed inside `.stylist-response-shell`.** The shell locally redefined
   the global `--text-light` (documented ≥4.8:1 contrast token) to a lighter
   `color-mix(in srgb, var(--text) 62%, #fff)`, silently breaking that guarantee for every
   `--text-light` consumer inside the shell (the panel measured `Suggested additions` at 4.48:1).
   No design rationale for the override exists anywhere in this doc or in code comments, so
   removed it entirely rather than promoting it to a separate semantic token — verified via
   computed style in a live sandbox render that `.stylist-response-shell`'s `--text-light` now
   resolves to the global `#776958`.
3. **Four async/paid indicators were silent to assistive technology.** Added
   `role="status" aria-live="polite"` (matching PR C's established pattern) to the `isEvaluating`
   "Evaluating this outfit…" indicator and the three skeleton-loading cards (whole-wardrobe
   comparison, ideal-additions comparison, per-direction board render) — three of which sit behind
   paid actions.
4. **Ungated renderer/timing telemetry in the "Details" disclosure.** All three "ⓘ Details"
   sites (comparison sheet, ideal-additions sheet, per-direction render) rendered
   `Render timing: … · renderer: …` with no debug gate, missed by PR A's separate `Dev telemetry`
   disclosure. Split the block: added a shared `renderTelemetryDetailBody` helper so render
   timing and `renderer` only appear under `STYLIST_DEBUG_ENABLED`, while the measured-cost line
   stays unconditionally visible per the product's paid-action-honesty rule. Live-verified in the
   mocked sandbox (where `VITE_STYLIST_DEBUG=true`) that the details body still renders timing +
   renderer correctly with debug on.
5. **`detectColor` missed colors with no base color word.** Extended `KNOWN_COLORS` in
   `StylistChat.jsx` with the shade terms the stylist actually emits that had no entry: `camel`,
   `sand`, `ecru`, `taupe`, `chocolate`, `espresso`, `tobacco`, `oxblood`, `ink` — kept the
   existing word-boundary regex (no substring matching). Text inference is the only source
   available here (these are editorial ideal-additions pieces the owner doesn't own, so there's
   no DB `color` field), so extending the map is the correct fix, not a violation of the
   structured-data-over-text-inference house rule. **Left open, per the spec:** whether an
   unmatched color should still fall back to grey, or render an explicit "unknown" treatment, is
   a design question, not a mechanical one — not decided here.
6. **Lower-priority items, same surface:**
   - `GeneratedBoardLengthFeedback`'s raw inline-styled chips (piece selector + wrong-length
     reasons) ported to the shared `.stylist-feedback-chip` class with `aria-pressed`; vocabulary
     unchanged per PR B's standardize-don't-unify ruling.
   - Found the actual winning selector for the 30px/34px button-height inconsistency:
     `.stylist-outfit-actions > button` (class+element, specificity 0-1-1) was overriding
     `.stylist-feedback-chip` (0-1-0) for feedback chips rendered inside that action row. Fixed
     by excluding chips from the compound selector
     (`.stylist-outfit-actions > button:not(.stylist-feedback-chip)`) rather than adding
     `!important`. Updated the matching selector-text assertion in
     `test/typographySystem.test.js`.
   - `Board error: Model did not return JSON` (and its "Render/Preview error:" siblings) reached
     the UI as the raw thrown message. Added a small `friendlyBoardErrorMessage` translation at
     the five client-side catch sites that currently only recognizes that one known technical
     string (translated to "The image model returned an unexpected response. Try generating
     again."); everything else passes through unchanged so a genuinely useful error (e.g. a real
     provider/auth error) isn't hidden. Added a `console.error` at the `styling-engine/core.js`
     `safeJsonFromModel` throw site (previously silent; only the *other* parse-failure branch
     logged) so the raw text is still in the server log.
   - Lookbook `BoardDetail` focus-return: the normal close/Escape/backdrop-click path already
     correctly restores focus to the triggering card (`closeBoardDetail`, committed in #171,
     predates this spec). The actual gap found live-reading the code: `handleBoardDelete` (the
     dialog's delete action) called `setBoardDetail(null)` directly, bypassing
     `closeBoardDetail`'s focus restoration entirely. Fixed by routing it through
     `closeBoardDetail`.
7. **Raw DB piece IDs in the stylist's own prose — not fixed, diagnosis only, per the spec's
   "consult before behavior fixes" instruction.** Not reproduced live this session (would need an
   uncontrolled real model response; the mocked sandbox returns canned JSON, not freeform prose,
   so it can't surface this). Code reading of `styling-engine/prompts.js` found a plausible
   mechanism: the whole-wardrobe visual composer roster prompt
   (`wholeWardrobeVisualComposerTemplate`) tells the model every piece is "labeled with its ID and
   name," and the freeform system prompt repeatedly instructs the model to reference pieces "by
   ID" for `propose_outfit`/re-render calls — necessary since ID resolution is load-bearing
   (`styling-engine/tools.js`) — but neither prompt explicitly tells the model to keep IDs out of
   conversational prose shown to the user. That's a plausible root cause, not a confirmed one.
   Do not act on this without reproducing it first.

Verification: `npm run build` passed. Full `node --test` suite: 7 known pre-existing failures
before and after (confirmed via `git stash`), no new failures — two tests needed updating to
match the intentionally-changed behavior (see item 1 and item 6 above), not to paper over a
regression. Live-verified items 2–4 and the render/evaluate flow in a freshly-restarted mocked
sandbox using `scratch/build_dedup_fix_demo_thread.js` to seed a browsable thread (the freeform
tool-loop path, not `routes/ai.js`'s builders directly — item 1's exact code path is covered by
the updated/added unit tests instead, since reproducing it live would need an uncontrolled real
model rejection). Items 5's map extension and 6's mechanical fixes were verified by code reading
and the full test suite, not live-clicked individually (no user-facing flow isolates them from
data already covered above).
