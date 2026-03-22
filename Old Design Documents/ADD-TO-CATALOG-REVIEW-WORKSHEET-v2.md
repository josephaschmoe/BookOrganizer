# Add To Catalog Review Worksheet v2

## Summary
This worksheet reviews Add to Catalog as a set of explicit cataloging decisions, not just lookup paths.

It is intended to evaluate whether each journey makes a clear and consistent save promise.

Every journey should be evaluated against three questions:

1. Did we identify the work?
2. Did we establish authority to preserve edition detail?
3. What record are we promising to save?

The worksheet uses two cataloging modes throughout:

- `Quick Add`: Catalog the book fast. Best when you do not need exact edition details.
- `Specific Edition`: Capture this exact edition when enough detail can be confirmed.

## Decision Framework

### Cataloging Levels
- `Work-level record`
  - `title`
  - `author`
  - `original publication year` when confidently known
  - `cover`
  - `source`
- `Edition-level record`
  - work-level fields plus edition metadata supported by authoritative evidence
- `Unknown / partial record`
  - enough to continue review, but not enough to decide save shape confidently
  - this is a temporary review state, not a preferred final save state unless the product later chooses to allow partial saves

### Match Confidence vs Save Authority
- `Match confidence` answers: is this probably the same work?
- `Save authority` answers: are we allowed to retain edition-specific fields?

Use these three tiers consistently:

1. `Exact ISBN authoritative`
   - The selected result explicitly contains the same scanned or extracted ISBN.
2. `Work-confirming but non-authoritative`
   - Title and author strongly match the work, but the selected result does not contain that ISBN.
3. `Weak / uncertain`
   - Match is incomplete, ambiguous, or low confidence.

### Authority Rule
- `Quick Add` saves a work-level record unless exact ISBN authority is established.
- Exact ISBN authority permits retaining `ISBN` and edition metadata.
- Visible or extracted ISBN alone is not enough; the selected result must also contain that exact ISBN.
- In `Specific Edition`, exact ISBN is preferred, but other strong evidence may also justify retaining edition metadata after review.
- Strong non-ISBN evidence may include strong photo evidence or other explicit edition signals visible to the user during review.
- Strong photo evidence may include a clearly readable title page or copyright page showing matching publisher, year, edition statement, contributor credit, or other edition-specific details.

### Cover Rule
- Cover choice is independent of metadata authority.
- The user may choose a personal photo or an API cover regardless of whether the record saves as work-level or edition-level.

### Year Rule
- In `Quick Add`, the target is `original publication year`.
- If only edition year is available and original publication year cannot be confidently established, save year as blank rather than silently substituting edition year.

### Edition Metadata Definition
For this worksheet, edition metadata means at minimum:

- `ISBN`
- `publisher`
- `publication date / edition year`
- `edition statement`
- edition-specific contributors when sourced from authoritative edition data
- `illustration note`
- any other persisted edition-tied identifiers

## Journey 1: Entry and Global Mode Choice

### User Goal
Choose the right add path and understand what kind of record the app will save.

### Entry Conditions / Mode State
- User opens Add to Catalog.
- The app may restore the last-used tab and sub-mode from local storage.
- The `Specific Edition` toggle is visible before the user starts deeper work.

### Current User Journey
1. User sees:
   - `Identify One Book`
   - `Add Many Books`
   - `Type It In`
2. User may also see a remembered prior state instead of a neutral default.
3. User may toggle `Specific Edition` on or off.

### Current Save Outcome
- The toggle changes the eventual save shape, field visibility, and downstream flow behavior.
- That effect is broader than the UI currently communicates.

### Intended Governing Rules
- The toggle is a record-shape decision, not just a search preference.
- `Quick Add` means: catalog the book fast when exact edition detail is not needed.
- `Specific Edition` means: capture this exact edition when enough detail can be confirmed.

### Where Current Behavior Violates or Blurs the Rules
- The toggle reads like a search/detail preference rather than a save-contract choice.
- Restored state may drop the user back into an old workflow without restating the current cataloging intent.

### Proposed Direction
- Treat the top of the add flow as a cataloging-mode choice.
- Make the saved-record promise explicit before the user starts lookup work.
- Re-state mode meaning whenever the app shifts the user into a different subflow.

### Acceptance Checks
- User can explain the difference between `Quick Add` and `Specific Edition` before starting lookup.
- User can tell whether the current path is aiming for a work-level or edition-level record.

## Journey 2: Single Book by ISBN

### User Goal
Scan or enter an ISBN and save the right record with minimal friction.

### Entry Conditions / Mode State
- `Identify One Book`
- `Look Up by ISBN`
- `Quick Add` or `Specific Edition`

### Current User Journey
1. User enters or scans an ISBN.
2. App looks up candidate sources and fills a pending book.
3. User adjusts shared form fields and saves.

### Current Save Outcome
- In `Specific Edition`, richer metadata may be retained.
- In `Quick Add`, metadata is currently reduced aggressively.

### Intended Governing Rules
- Review selection behavior, not just whether lookup succeeds.
- In `Quick Add`:
  - exact ISBN authoritative result keeps `ISBN` and edition metadata
  - work-confirming but non-authoritative result saves a work-level record only
- Exact ISBN authority should dominate save authority, not just lookup source.

### Where Current Behavior Violates or Blurs the Rules
- `Quick Add` can collapse fields even when ISBN should be authoritative.
- The workflow does not clearly distinguish:
  - exact ISBN authoritative
  - work-confirming but non-authoritative
  - weak / uncertain

### Proposed Direction
- Treat ISBN lookup as one of the cleanest authority-driven flows.
- Preserve ISBN and edition metadata in `Quick Add` only when the selected result explicitly contains the same ISBN.
- If the user picks a different result that lacks the scanned ISBN, downgrade to a work-level save.

### Acceptance Checks
- ISBN lookup with exact matching ISBN in selected result
- ISBN lookup where multiple results appear and only one contains the scanned ISBN
- ISBN lookup where user selects a result that does not contain the scanned ISBN

## Journey 3: Single Book by Photo, Quick Add

### User Goal
Photograph a book and quickly save a reliable work-level record.

### Entry Conditions / Mode State
- `Identify One Book`
- `Identify from Photos`
- `Quick Add`

### Current User Journey
1. User uploads up to 3 images.
2. Frontend resizes them and sends them to `analyzeBookPhoto`.
3. The backend extracts visible metadata and searches candidate sources.
4. User is shown a review card and candidate list, or extracted fallback data.
5. User selects a match or proceeds with extracted metadata.
6. User chooses API cover or personal photo when both exist.
7. User saves.

### Current Save Outcome
- Intended output is a simplified work-level record.
- Candidate matches are often used for work confirmation and cover choice.

### Intended Governing Rules
- Core success criteria:
  - `title`
  - `author`
  - `original publication year` when confidently known
  - chosen cover
- Candidate matches may confirm the work and provide cover options without granting authority to retain edition fields.
- Exact ISBN authority upgrades save shape only when the chosen result contains that same ISBN.

### Where Current Behavior Violates or Blurs the Rules
- Work identification and edition authority can get conflated.
- A strong candidate may feel "good enough" to users even when it should not preserve edition metadata.
- Year handling needs trust discipline when only edition year is available.

### Proposed Direction
- Review this path as the primary work-level consumer flow.
- Make the review task explicit:
  - Did we identify the work?
  - Which cover should we keep?
  - Do we know original publication year confidently enough to save it?
- Use exact ISBN authority as the only upgrade path for retaining edition fields in `Quick Add`.

### Acceptance Checks
- Photo flow with visible ISBN and selected result containing the same ISBN
- Photo flow with visible or noisy ISBN and selected result confirming the work but not that ISBN
- Photo flow in `Quick Add` with only title, author, and year recovered
- Photo flow in `Quick Add` where original publication year cannot be confirmed
- Photo flow in `Quick Add` with user photo chosen as cover

## Journey 4: Single Book by Photo, Specific Edition

### User Goal
Photograph this copy and identify the exact edition if possible.

### Entry Conditions / Mode State
- `Identify One Book`
- `Identify from Photos`
- `Specific Edition`

### Current User Journey
1. User uploads photos.
2. App extracts visible metadata.
3. If no exact ISBN authority is found and title metadata exists, the app may redirect into the manual entry UI with prefilled fields and enrichment context.
4. User may continue through candidate search, cover selection, and optional edition enrichment.
5. User saves or abandons the flow.

### Current Save Outcome
- The path aims to retain richer bibliographic detail.
- The current redirect into manual UI changes the apparent workflow midstream.

### Intended Governing Rules
- Treat this as a distinct `Specific Edition` journey, even if it reuses manual controls.
- The user expectation is: "help me identify this exact copy."
- Edition metadata retention should still depend on authoritative support, but in `Specific Edition` that support may come from exact ISBN or other strong evidence, including strong photo evidence.
- If exact edition confirmation fails, the fallback decision should be explicit: continue as a Work-Level record or continue Edition-Level review.

### Where Current Behavior Violates or Blurs the Rules
- The redirect into `Type It In` can make the edition-photo journey feel like the user was dropped into a different subsystem.
- The current UI may not make it clear whether the system is still trying to identify the photographed copy versus just asking for manual cleanup.

### Proposed Direction
- Keep this journey conceptually separate from generic manual entry.
- If manual controls are reused, preserve visible context from the photographed copy:
  - extracted metadata
  - any extracted ISBN
  - current cover choice
  - edition-intent framing
- Review whether this should become a visibly distinct "Review this edition" step rather than a silent redirect.
- If exact edition confirmation fails, present an explicit user choice between `Save as Work-Level` and `Continue Edition Review`.

### Acceptance Checks
- Photo flow in `Specific Edition` with enrichment
- `Specific Edition` flow where no exact edition can be confirmed
- `Specific Edition` flow where the user still understands they are reviewing the photographed copy

## Journey 5: Type It In / Manual Search as Standalone Entry

### User Goal
Find or enter a book by title and author without using images.

### Entry Conditions / Mode State
- `Type It In`
- User starts here intentionally
- `Quick Add` or `Specific Edition`

### Current User Journey
1. User enters title and optional author.
2. App searches Open Library and Google Books.
3. User reviews merged results.
4. User selects a result or enters details manually.
5. User saves.

### Current Save Outcome
- Save shape depends on current cataloging mode.
- Selected results can populate the form directly.

### Intended Governing Rules
- Review manual search as a true standalone journey.
- In `Quick Add`, selection should aim to confirm the work and basic save shape.
- In `Specific Edition`, selection should be evaluated for authority to preserve richer metadata.

### Where Current Behavior Violates or Blurs the Rules
- The same manual search UI is used for both work-level and edition-level goals without always making the distinction explicit.
- Result selection may appear to mean "use this edition" even when the save shape should remain work-level.

### Proposed Direction
- Keep standalone manual entry conceptually separate from rescue mode.
- Review result selection language so it reflects whether the user is selecting:
  - a work
  - an exact edition
- Use the governing rules to determine save authority after selection.

### Acceptance Checks
- Standalone manual entry in `Quick Add`
- Standalone manual entry in `Specific Edition`
- Manual search where user ignores results and saves typed data manually

## Journey 6: Manual Search as Rescue / Continuation Path

### User Goal
Recover from a failed or partial scan/photo flow without losing context.

### Entry Conditions / Mode State
- User arrives here from photo or scan flow
- There may already be extracted metadata, a possible ISBN, and a chosen or pending cover

### Current User Journey
1. Photo or scan flow fails to produce a complete or authoritative result.
2. User lands in manual-style controls.
3. User may search candidates, adjust fields, choose cover, and save.

### Current Save Outcome
- The save path may preserve hidden context from the earlier flow.
- The user may not be fully aware which parts of the record still come from the original photo analysis.

### Intended Governing Rules
- Rescue mode should preserve prior context whenever possible:
  - extracted title
  - extracted author
  - extracted ISBN if any
  - current cover choice
  - edition-intent state
- The user should feel they are continuing the same task, not restarting in a different tool.

### Where Current Behavior Violates or Blurs the Rules
- The transition from image flow to manual search can feel discontinuous.
- The same result-selection action can mean different things depending on hidden prior context.

### Proposed Direction
- Review rescue mode as a separate continuity problem.
- Make inherited context visible so the user knows what remains from the prior step.
- Preserve work-level versus edition-level intent through the handoff.

### Acceptance Checks
- Manual rescue flow preserving prior extracted context
- Manual rescue flow preserving cover choice
- Manual rescue flow preserving extracted ISBN without overstating authority

## Journey 7: Shared Save Step and Duplicate Handling

### User Goal
Save the record the app actually promised and avoid incorrect duplicate decisions.

### Entry Conditions / Mode State
- User has come through any add path and is ready to save.

### Current User Journey
1. App assembles the save object based on the active flow and hidden context.
2. Duplicate detection runs.
3. User may be asked to override duplicate protection.
4. Record is saved and cover upload may happen afterward.

### Current Save Outcome
- Save construction varies by:
  - current tab
  - edition mode
  - extracted ISBN state
  - selected candidate state
  - enrichment state
- Duplicate logic currently centers on `ISBN` or `title + author`.

### Intended Governing Rules
- Review save construction against the cataloging model, not just the code path.
- Ask explicitly:
  - Is duplicate handling confirming the same work or the same edition?
- Save authority rules should be honored consistently at the final construction step.
- The catalog model must permit same-work, different-edition records when edition authority supports distinct entries.

### Where Current Behavior Violates or Blurs the Rules
- Hidden state can affect the saved record more than the visible form suggests.
- Duplicate checks may treat same-work and same-edition conflicts as the same problem.

### Proposed Direction
- Review final save assembly as a contract-enforcement step.
- Distinguish duplicate handling for:
  - same work, different edition
  - true same-edition duplicate
- Ensure save output aligns with the mode and authority rules established earlier in the journey.
- Final save construction should be explainable from visible review decisions, not hidden state alone.

### Acceptance Checks
- Duplicate detection for same work, different edition
- Duplicate detection for true same-edition match
- Save output matches visible mode and authority state

## Journey 8: Bulk Shelf Photo

### User Goal
Add many books from a shelf or stack quickly.

### Entry Conditions / Mode State
- `Add Many Books`
- `Bookshelf Photo`

### Current User Journey
1. User uploads one shelf or stack image.
2. AI identifies visible books.
3. Frontend searches source catalogs for each title and author.
4. User reviews list results, toggles items in or out, and may enter second-pass or correction steps.

### Current Save Outcome
- Output is effectively throughput-oriented and work-level.

### Intended Governing Rules
- This is inherently a work-level, approximate, high-throughput path.
- It is a contrast case, not a model for edition-sensitive review.

### Where Current Behavior Violates or Blurs the Rules
- The flow may sit near edition-aware features in the UI even though its purpose is different.

### Proposed Direction
- Keep this path positioned as work-level and approximate.
- Use it in the worksheet to explain why edition-sensitive review should not be forced into the same pattern.

### Acceptance Checks
- Bulk shelf photo remains optimized for throughput
- Users can exclude bad matches and move to correction when needed
- No implied promise of edition precision

## Journey 9: Bulk Batch Photos, Quick Add

### User Goal
Add many separately photographed books quickly while still reviewing each result.

### Entry Conditions / Mode State
- `Add Many Books`
- `Batch Photos`
- `Quick Add`

### Current User Journey
1. User uploads up to 20 separate photos.
2. Each image is analyzed independently.
3. Results are deduped into one review list.
4. User toggles each result, may switch candidates, and may choose API cover or personal photo.
5. Failures move into manual correction.

### Current Save Outcome
- Saves a fast, list-reviewed, mostly work-level batch.

### Intended Governing Rules
- Current list review is appropriate for speed and broad confirmation.
- This path should focus on:
  - clarity of result status
  - candidate switching
  - cover choice
  - manual fallback

### Where Current Behavior Violates or Blurs the Rules
- Work confirmation and save authority can still blur if a confident-looking result appears more authoritative than it is.

### Proposed Direction
- Review this as a high-throughput `Quick Add` flow.
- Keep list review as the default interaction model here.
- Ensure the save contract remains clearly work-level unless exact ISBN authority is established item-by-item.

### Acceptance Checks
- Batch Photos in `Quick Add`
- Candidate switching in `Quick Add`
- Cover choice in `Quick Add`
- Manual fallback for failed items

## Journey 10: Bulk Batch Photos, Specific Edition

### User Goal
Review many individually photographed books while preserving edition detail where support is strong enough.

### Entry Conditions / Mode State
- `Add Many Books`
- `Batch Photos`
- `Specific Edition`

### Current User Journey
1. User uploads multiple separate photos.
2. App analyzes each image and produces a combined review list.
3. User currently reviews results in a list-oriented batch UI.
4. Manual correction handles failures after the list review.

### Current Save Outcome
- Current batch review favors throughput over focused edition confirmation.

### Intended Governing Rules
- Edition-sensitive batch review is a distinct UX problem.
- Proposed target behavior:
  1. batch identify first
  2. then review one book at a time
  3. each step shows extracted metadata, candidate matches, cover choice, and edition-sensitive controls
  4. each item ends in explicit confirm and continue logic

### Where Current Behavior Violates or Blurs the Rules
- Current list review is fast but weak for edition-specific decisions.
- Ambiguous items are easy to miss in a combined list.
- The UI does not currently give each photographed copy the same focused review treatment as the single-book edition-aware path.

### Proposed Direction
- Evaluate this path against a sequential-review target for `Specific Edition`.
- Include a direct comparison:
  - `Current list review`
    - faster
    - good for obvious work-level matches
    - weak for edition-sensitive confirmation
  - `Proposed sequential review`
    - slower
    - better focus
    - better for exact-edition confirmation
    - clearer per-book cover and metadata decisions

### Acceptance Checks
- Batch Photos in `Specific Edition` with confident matches
- Batch Photos in `Specific Edition` with uncertain or unmatched books
- Users can review one photographed copy at a time without losing batch momentum

## Journey 11: Bulk Text Extraction

### User Goal
Add books mentioned in a text-heavy image such as a reading list, bibliography, or article.

### Entry Conditions / Mode State
- `Add Many Books`
- `Titles in Text`

### Current User Journey
1. User uploads a text-heavy image.
2. AI extracts titles and authors.
3. App searches source catalogs for each extracted item.
4. User reviews and adds confirmed items.

### Current Save Outcome
- This path is fundamentally low-authority and work-level unless enriched later through another flow.

### Intended Governing Rules
- Keep this primarily work-level.
- Do not imply edition confidence from text extraction alone.

### Where Current Behavior Violates or Blurs the Rules
- Because it sits beside richer add paths, users may overestimate how authoritative this path is.

### Proposed Direction
- Review this path as a low-authority intake workflow.
- Keep it simple and fast.
- Treat later enrichment as a separate step if edition-level confidence is needed.

### Acceptance Checks
- Bulk text extraction with partial or low-authority matches
- No implied edition-level promise

## Consolidated Acceptance Scenarios
### ISBN Authority
- ISBN lookup with exact matching ISBN in selected result
- ISBN lookup where user selects a different result that does not contain the scanned ISBN

### Photo Flows: Quick Add
- Photo flow with visible ISBN and selected result containing the same ISBN
- Photo flow with visible or noisy ISBN and selected result confirming the work but not that ISBN
- Photo flow in `Quick Add` with only title, author, and year recovered
- Photo flow in `Quick Add` where original publication year cannot be confirmed
- Photo flow in `Quick Add` with user photo chosen as cover

### Photo Flows: Specific Edition
- Photo flow in `Specific Edition` with enrichment
- `Specific Edition` flow where strong photo evidence supports retaining edition metadata without exact ISBN
- `Specific Edition` flow where no exact edition can be confirmed and the user chooses between `Save as Work-Level` and `Continue Edition Review`

### Manual and Rescue
- Standalone manual entry
- Manual rescue flow preserving prior extracted context

### Save Contract and Duplicates
- Duplicate detection for same work, different edition
- Duplicate detection for true same-edition match

### Batch Flows
- Batch Photos in `Quick Add`
- Batch Photos in `Specific Edition` with confident matches
- Batch Photos in `Specific Edition` with uncertain or unmatched books

### Low-Authority Bulk Intake
- Bulk text extraction with partial or low-authority matches

## Assumptions
- This document is a review worksheet and product-spec artifact, not implementation.
- The worksheet optimizes for product and UX clarity first, with enough rule precision to guide later implementation.
- `Bookshelf Photo` and `Titles in Text` remain mostly unchanged for now except where comparison helps define the model.
