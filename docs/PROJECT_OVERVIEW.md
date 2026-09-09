# Context Reader Overlay — project overview

## Product intent

Context Reader Overlay is a Chrome extension for reading foreign-language web pages without replacing the page. The website continues to own its DOM, layout, styles, interactions, and application state; the extension owns an isolated visual interpretation layer.

The governing product rule is: **Do not rewrite the web. Interpret the web.**

## Repository baseline

The workspace was empty at the start of MVP task `0001`. There was no prior manifest, framework, build system, content script, service worker, UI component, project documentation, or reusable provider. The initial architecture therefore uses a small vanilla TypeScript codebase rather than introducing a UI framework.

## Current architecture

- Chrome Manifest V3 extension.
- `src/background/`: action-click/per-tab state orchestration and secure translation/interpretation backend clients.
- `src/content/analysis/`: read-only visible-region discovery, identity, reconciliation, translation cache keys, language hints, and bounded context assembly.
- `src/content/providers/`: structured provider contracts, Chrome built-in Translator adapter, service-worker remote translation/interpretation adapters, and deterministic development fallback.
- `src/content/overlay/`: one closed Shadow DOM containing passive translated surfaces and narrowly interactive controls.
- `src/content/readerController.ts`: region lifecycle, bounded translation batches, observer scheduling, provider state, selection flow, and cleanup.
- `tests/`: deterministic unit/integration tests and an unpacked-extension browser regression.

Build output is generated in `dist/` with esbuild. Vitest and jsdom provide deterministic tests.

## MVP behavior

Clicking the extension action toggles the reader for the current tab. When enabled, the content script considers at most 80 rendered semantic blocks and sends cache misses through the three-worker priority scheduler. It renders fixed translated surfaces only after linguistic output is ready. A compact toolbar switches all surfaces between translation and original view and reports capability and progress state.

Selecting original page text exposes a **맥락 해석** action. The lightweight popover stays on the page and does not become a generic chat surface.

## Semantic priority and observability

Every region is deterministically classified as `READING`, `UI`, or `AUXILIARY` from native tags/roles, interactive and semantic ancestry, metadata hints, link density, text length, and geometry. Translation priority is viewport reading (0), viewport secondary (1), near reading (2), near secondary (3), far reading (4), and far secondary (5).

`TranslationScheduler` runs three requests concurrently. It reprioritizes queued work on viewport-band changes, reuses cache and in-flight keys, removes no-longer-desired queued work, and rejects completion events after lifecycle generation invalidation. Pending regions leave the source visible. Reading surfaces favor wrapping; UI surfaces use compact visual ellipsis while retaining the full result.

The toolbar reports completed/total work and viewport readiness. Readiness is at least 80% of current viewport `READING` regions. Diagnostics include request/cache counts, queue depth, active work, average/p50/p95 latency, `timeToFirstTranslation`, `timeToFirstReadingContent`, and `timeToViewportReady`.

## Page analysis and identity contracts

`TreeWalker` reads text nodes and groups them by a nearest paragraph/list/heading-like block. Script, style, template, form-entry, hidden, SVG/canvas, and extension-owned nodes are excluded. Geometry and computed typography are read from source elements. English, Japanese, and Chinese are recognized with a small deterministic Unicode heuristic.

Region and linguistic identities are deliberately separate:

- A live source element retains its logical region ID through a `WeakMap`, even if sibling insertion changes its structural path.
- A newly created replacement element initializes its ID from a deterministic structural path, so replacement in the same slot can reconcile as the same logical region.
- `sourceKey` hashes normalized source text plus source language. A changed key invalidates the region's active translation.
- A translation request key hashes normalized text, source language, and target language. It is independent of region ID and supports content reuse across equivalent regions.

Discovery is viewport-bound and capped. It is not a whole-document extraction engine.

## Reconciliation and lifecycle

Every current analysis is compared with the prior state as `added`, `changed`, `removed`, or `unchanged`:

- Added regions create a surface and request translation only on cache miss.
- Changed regions keep logical identity but render against their new source key.
- Removed, disconnected, hidden, collapsed, or no-longer-readable regions are disposed.
- Unchanged regions reuse their surface and cached result.

The content controller owns the authoritative current region set. Async results are cached only by their linguistic request key and render only when a current region requests that key. Lifecycle generations prevent an old in-flight request from affecting a later OFF/ON generation.

`MutationObserver` watches child nodes, character data, and visibility-bearing attributes (`class`, `style`, `hidden`, `aria-hidden`, and `open`). Records are coalesced by affected semantic roots with a 120 ms debounce and 500 ms maximum wait. A targeted pass reanalyzes affected roots and cheaply refreshes active unaffected regions. Extension rendering lives outside the observed `body` and inside Shadow DOM, so it cannot recursively trigger source analysis.

Scroll always performs animation-frame geometry updates. Full visible-region discovery is scheduled only after a material scroll distance. Resize schedules reposition plus analysis. Active source elements use `ResizeObserver`, completed font loading triggers reposition, and hash/`popstate` navigation schedules full reconciliation.

Reader OFF disconnects observers, removes listeners/timers, invalidates in-flight request generations, clears active registrations, and removes the host. The bounded in-memory translation cache remains reusable during the content script's tab lifetime but cannot create presentation by itself.

Development instrumentation is enabled with `localStorage.contextReaderDebug = "1"` and reports reconciliation counts, region classifications, surface creation/disposal, translation requests/cache hits, mutation batches, and elapsed reconciliation time.

## Translation and interpretation boundary

`LinguisticProvider` accepts structured translation batches and structured interpretation context. For translation, the default `ProviderChain` tries Chrome's built-in Translator API and then the service-worker remote translation provider; if both fail, the chain reports translation as unavailable. `DemoProvider` remains available only in an explicitly opted-in development build (`CONTEXT_READER_DEMO=true npm run build`). Interpretation continues through its remote adapter, with deterministic interpretation fallback likewise present only in that demo build.

Chrome documents the Translator API as desktop-only and available from Chrome 138. The adapter evaluates `availability()` per language pair and reports `available`, `downloadable`, `downloading`, `ready`, `unavailable`, or `error`, including `downloadprogress`. Rejected translator creation is removed from the cache so a later attempt can retry. Provider modes are explicit: `browser-translator`, `production-remote`, `development-demo`, and `unavailable`.

The deterministic fallback has a deliberately tiny phrase set. The toolbar identifies it as a limited development mode; it is never presented silently as production translation.

## Remote translation boundary

`RemoteTranslationProvider` sends translation batches to the service worker and never fetches a backend from the page/content-script context. The worker revalidates a maximum of three requests, 4,000 source characters per request, unique request keys, 200-character identities, and 35-character language identifiers. It requires HTTPS except for localhost, checks exact-origin host permission, omits credentials, and applies a 15-second request timeout.

The version 1 `POST /translate` envelope contains only `requestKey`, source text, source language, target language, and an 8,000-character response bound. A successful response must return exactly one non-empty translation for each unique request key. The worker restores the local `regionId`; the backend never controls DOM-region identity. Invalid, partial, duplicate, oversized, HTTP-error, and network-error responses become provider failures, allowing `ProviderChain` to continue without affecting scheduling or rendering.

The Node backend exposes the same timeout, CORS, rate-limit, normalized-error, and no-store protections as interpretation. Its deterministic local provider returns stable fixture translations. The remote provider has no sticky failure state, so a later request retries after a temporary outage.

## Context extraction and production interpretation

Context collection is deterministic and bounded before provider invocation. Optional `previousParagraph`, `nextParagraph`, and `nearestHeading` values that are empty after normalization and bounding become `undefined` and are omitted from JSON requests, preserving the backend's non-empty-if-present contract:

- selected text: 300 characters;
- containing sentence: 600 characters;
- containing paragraph: 1,200 characters;
- one nearby paragraph per direction: 600 characters each;
- nearest heading and page title: 300 characters each;
- source and target language identifiers.

The collector rejects extension-owned selections and never sends page HTML. `RemoteInterpretationProvider` sends this structure to the service worker. The worker revalidates every bound and calls a configured backend with a versioned JSON request. HTTPS is mandatory outside localhost, `credentials` is `omit`, host permission is checked, and explanations are capped at 1,200 characters.

No private API key or production credential is accepted by the extension. The extension stores only public endpoint URLs. Provider secrets and model routing belong on the secure backend. The repository grants localhost access for development; an exact production HTTPS origin must be added to the production manifest rather than granting broad host access.

Phase 3 added a single Node HTTP backend under `server/`; Phase 5A extends it with `POST /translate`. It validates versioned bounded requests, caps responses, applies timeout, error normalization, CORS/security headers, and a basic process-local rate limit. The production adapter uses the OpenAI Responses API with a server environment key and environment-selected model (`gpt-5.6-luna` by default). The extension bundle contains no credential.

The backend now validates configuration before listening. Production requires the OpenAI provider, a server-side key, and at least one exact `chrome-extension://<32-character-id>` CORS origin. It rejects mock production mode, unknown providers, malformed origins, and invalid port, provider-timeout, retry, or rate-limit bounds. The default 12-second provider timeout and process-local 30-request-per-minute limit are configurable within bounded ranges. Provider errors remain normalized and diagnostics remain disabled in production.

The process binds plain HTTP on `0.0.0.0:$PORT` and is deployment-neutral: a generic Node.js 20+ host or the unprivileged Node.js 24 container can run it behind external HTTPS/TLS termination. `GET /health` supports deployment probes. Durable or multi-instance rate limiting and abuse controls remain deployment responsibilities.

No public endpoint was deployed because no cloud account, stable origin, or provider secret was available. The browser regression instead proves extension → service worker → local backend → provider → Korean popover. Production deployment must use HTTPS, exact installed-extension CORS origin(s), and one exact backend manifest origin; the source manifest remains localhost-only.

## Overlay geometry and website integrity

The only page-tree addition is one `<div data-context-reader-root>` appended to `document.documentElement`; all presentation lives inside its closed Shadow DOM. The renderer never writes source `textContent`, HTML, styles, structure, or framework state. Reader OFF removes the host.

Passive translation surfaces use `pointer-events: none`. Only the toolbar, selection action, and explanation popover accept pointer input.

Surfaces never exceed the current source rectangle height. Text wraps in ordinary regions, compact rectangles use one-line ellipsis, long translation density causes bounded font reduction with a 10 px floor, and the fixed viewport layer clips overflow. This favors preventing severe overlap over showing every translated character. The original-view toggle remains available for clipped content.

## Verification

The deterministic suite covers filtering, language hints, logical identity, source invalidation, four-way reconciliation, translation reuse, visibility rejection, bounded context, extension-owned exclusion, Translator status transitions, remote translation success/failure/recovery, secure backend request/response bounds, source-markup preservation, interaction, geometry bounds, cleanup, and duplicate prevention.

The unpacked-extension regression uses `test-pages/fixture.html` in an installed Chromium browser. It validates delayed article insertion; subscription plan and price replacement; CSS hide/show; node removal; 25 rapid text changes; History API plus SPA route replacement; provider-mode UI; source preservation; page-button interaction; scroll survival; full cleanup; current-state-only re-enable; and one active host.

Phase 5B extends that regression through the real unpacked MV3 service worker and a deterministic loopback backend. The browser Translator API is disabled with the Blink runtime-feature switch and verified unavailable before reader activation. The suite first injects transient backend failures, confirms the overlay and source interaction remain alive, then performs an OFF/ON request cycle and requires deterministic remote translations. A fresh-profile startup race is avoided by reloading the fixture only after the extension worker and endpoint configuration are ready. CDP discovery, WebSocket commands, page conditions, and cleanup are bounded and report their last observation plus recent browser output on failure. The test server uses a raised test-only rate limit so the intentional outage/recovery scenario is not conflated with the backend's separately tested production default limit.

## Phase 4 production and public-site findings

The Responses API adapter now validates completed/non-empty output, retries one configurable 429/5xx response with abort-aware backoff, and never returns or logs raw provider errors. Provider identity is excluded from production application responses. Interpretation request/success/failure and average/p50/p95 latency are separate from translation metrics.

`CONTEXT_READER_API_ORIGIN` adds exactly one HTTPS backend origin to the generated manifest and CSP; validation rejects broad HTTPS permission. Runtime storage supplies only the public `/translate` and `/interpret` URLs on that origin. The source manifest remains localhost-only. The container runs as the unprivileged `node` user and includes a health check. No HTTPS deployment or real provider call occurred because no deployment credential, stable origin, or `OPENAI_API_KEY` was available.

Read-only Edge 151 QA covered Wikipedia's Machine translation article, Adobe Creative Cloud plans, and React Quick Start. Every site retained one extension host through scroll and OFF/ON. Edge did not expose the Translator API, so provider mode was `unavailable` and no site reached viewport-ready. Wikipedia first measured 9/66/5 reading/UI/auxiliary and exposed navigation domination; after navigation candidate bounds it measured 64/12/4. Adobe measured 61/18/1 and one cache hit; its first limited-demo surface was 197.9 ms. React measured 56/23/1, one cache hit, and a 57.8 ms first limited-demo reading surface. These are fallback timings, not general translation or real-provider latency.

UI surfaces under 48×16 px are suppressed rather than painting unreadable ellipsis over controls; full output remains cached. Scheduler-driven presentation is coalesced to one animation frame. Discovery seeds the viewport, bounds fallback scanning and expensive visibility checks, and prevents one semantic class from exhausting the region budget.

## Known limitations

- Public production websites were not exercised in this environment; the three representative categories use deterministic fixture sections.
- Complex transforms, vertical text, overlapping source rectangles, iframes, and page-owned closed Shadow DOM remain unsupported or approximate.
- Bounded long translations can be clipped.
- Remote translation and interpretation require a configured, permitted backend endpoint; no public endpoint is deployed by this repository.
- The tested Edge 151 public-site run predates the Phase 5A remote translation path and remains evidence only for browser-provider unavailability.
- Unavailable translation work is retried after OFF/ON and can produce many fast failures on large pages.
- There is no user-facing endpoint or production host-permission settings flow.
- Backend rate limiting is per-process and keyed to the immediate peer address; production-scale distributed abuse protection is deployment-owned.
- Han-only Japanese can be classified as Chinese.
- History API calls without DOM mutation are detected only by later `popstate`/hash events or content changes.
- Browser integration requires a locally installed Chrome or Edge executable; nonstandard locations must be supplied through `CONTEXT_READER_BROWSER`.

## Required deployment follow-up

HUMAN_REQUIRED: choose a hosting vendor and stable HTTPS domain, provision infrastructure/TLS and a server-side OpenAI key, determine stable distributed extension ID(s) for exact CORS, choose deployment-level abuse controls, and run the opt-in real-provider smoke plus translation/selection browser E2E against the deployed origin.

## Status

MVP tasks `0001` through `0004`, Phase 5A task `0005`, Phase 5B task `0006`, and repository-side Phase 5C readiness task `0007` are complete. Production deployment remains HUMAN_REQUIRED and out of repository scope. Phase 5C evidence lives in `docs/tasks/0007-production-backend-readiness.md`.
