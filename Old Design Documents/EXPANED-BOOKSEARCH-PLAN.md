# Edition-Aware Book Matching Across Add Flows

## Summary
Extend the existing single-book matcher so it uses as much reliable metadata as is available from a photo or typed input, instead of relying mainly on `title + author` with ISBN as a special case. Keep `Bookshelf Photo` as a work-level identification flow, not an edition-level matcher.

The implementation should treat:
- `Individual Photo` as the primary edition-aware flow
- `Batch Photos` as repeated runs of the exact same single-photo pipeline
- `Type It In` as the same matcher fed by manual fields instead of OCR
- `Bookshelf Photo` as a separate multi-book scene pipeline that stays mostly `title + author`

## Key Changes

### Matching model
- Introduce one shared matching/ranking layer used by:
  - `analyzeBookPhoto` results
  - manual/type-in search
  - batch-photo candidate review
- Split matching into two levels:
  - `work-level`: identify the book/work
  - `edition-level`: prefer the right publisher/year/illustrated or contributed edition when enough signals exist
- Base signals:
  - strongest: ISBN
  - primary: title, author
  - edition signals: publisher, year, edition statement, contributor
- Contributor means a single optional field that can hold illustrator, editor, introduction by, translator, or similar edition-specific credit.

### OCR and extraction
- Expand the server-side photo extraction schema in `functions/index.js` for `analyzeBookPhoto` to include:
  - `contributors` as an array of strings
  - optionally `imprint_or_city` and `illustration_note` if extraction is easy during the same pass
- Prompt `analyzeBookPhoto` to extract any edition-useful text visible in the image, including:
  - publisher/imprint
  - publication year
  - edition/printing statement
  - illustrator/editor/introduction/translator credits
  - illustration notes such as “illustrated in colour and black & white”
- The extractor must remain opportunistic:
  - missing fields are normal
  - low-confidence fields should not block search
  - sparse inputs still fall back cleanly to title/author matching

### Candidate search and ranking
- Replace the current `searchByTitleAuthor()` fallback in `functions/index.js` with a broader metadata-aware candidate fetcher:
  - still search Google Books and Open Library
  - still search by ISBN first when valid
  - when no ISBN exists, query primarily with title + author
  - optionally add publisher and contributor terms to broaden retrieval only when they are high-confidence and not likely to over-constrain the query
- Replace the current simple `scoreCandidate()` with weighted edition-aware scoring:
  - ISBN exact match dominates
  - title similarity remains strongest non-ISBN signal
  - author similarity remains next
  - publisher overlap adds score
  - publication year exact or near match adds score
  - contributor overlap adds score
  - edition-string overlap adds score when present
- Add gentle penalties for candidate mismatch on strong edition signals:
  - clearly different publisher
  - clearly different year when both are present
- Preserve top-N candidate review UI; only the ranking gets smarter.

### Individual Photo flow
- Keep `submitPhotoLookup()` and the existing review card flow in `public/index.html`.
- Continue calling `analyzeBookPhoto`, but surface richer extracted metadata in the fallback/extracted state:
  - contributor if present
  - stronger reason text like `publisher aligns`, `year aligns`, `contributor aligns`
- Update review-cue helpers (`describeReviewMatch`, `describeExtractedReview`) so the user can see why a candidate is preferred.
- Do not require multiple photos; use whatever metadata is visible in the uploaded image set.

### Batch Photos flow
- Keep `runBulkBatchAnalysis()` as a loop over `analyzeBookPhoto`.
- Do not introduce separate batch confidence rules.
- Each image gets identical extraction, candidate generation, and edition-aware scoring as `Individual Photo`.
- Update bulk review cue text (`describeBulkMatch`, alternate candidate reasons, correction results) to mention edition signals when they influenced ranking.
- Preserve current dedupe and manual-correction flow; only improve candidate quality and explanation.

### Type It In / Manual flow
- Keep the existing manual tab in `public/index.html`, but make its search use optional edition metadata instead of only `title + author`.
- Add one new optional manual field:
  - `Contributor / Illustrator / Editor`
- Continue using existing optional fields:
  - publisher
  - year
  - edition / printing
- Update `searchManualBook()` so it passes all filled metadata into the shared matcher.
- Update `searchOpenLibrary()` and `searchGoogleBooks()` usage so retrieval remains broad, but final ranking uses the extra metadata.
- Keep manual override behavior unchanged: users can still ignore results and save a typed book manually.

### Bookshelf Photo flow
- Keep `identifyBooksInImage` as the multi-book bookshelf/stack detector.
- Do not attempt full edition-aware matching here beyond opportunistic use of obvious publisher text if already available from the detected title/author search results.
- The bookshelf flow should remain mostly work-level:
  - identify visible books from spines/covers
  - search by title + author
  - let the user refine later with single-photo or manual search if edition precision matters
- Do not add contributor/publisher extraction requirements to the bookshelf AI prompt in v1.

## Public Interfaces / Behavior Changes
- `analyzeBookPhoto` response should expand to include richer extracted metadata, especially `contributors`.
- Manual search input shape should expand from `title + author` to:
  - `title`
  - `author`
  - optional `publisher`
  - optional `year`
  - optional `edition`
  - optional `contributor`
- Candidate explanation text in single-photo and batch review should mention edition evidence when used.
- No change to `identifyBooksInImage` request/response contract in v1.

## Test Plan
- Single photo with only title + author:
  - still returns reasonable candidates
  - does not require publisher/year/contributor
- Single title page photo with publisher + year + illustrator:
  - ranking prefers the matching edition over a generic reprint
- Single copyright page photo:
  - year/edition statement influences ranking when title/author are also present
- Multi-image single-photo lookup:
  - one image can provide title/author while another provides year/publisher
  - combined extraction improves ranking
- Batch photos:
  - each image is processed independently with the same quality as single-photo mode
  - mixed inputs work correctly: spine-only image, title-page image, copyright-page image
- Manual/type-in search:
  - title + author still works
  - adding publisher/year/edition/contributor improves ranking
  - user can still save manually without choosing a result
- Bookshelf photo:
  - existing identification flow still works
  - no regression in review/add flow
  - no expectation of edition-level precision
- Explanation cues:
  - match reasons include signals like publisher/year/contributor when applicable
- Backward compatibility:
  - existing add-book flows still function if only old fields are available
  - no failure when extracted contributor metadata is absent

## Assumptions
- `Batch Photos` is intentionally the same pipeline as `Individual Photo`, repeated per image.
- `Bookshelf Photo` remains a separate multi-book identification flow and is not upgraded to true edition matching in v1.
- Manual/type-in search should add one optional `Contributor / Illustrator / Editor` field, not multiple separate contributor fields.
- Retrieval should stay broad and ranking should do the precision work, to avoid over-constraining searches with noisy OCR.
