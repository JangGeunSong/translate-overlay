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

Phase 5F-2 uses one per-analysis text eligibility reader for viewport seeds, TreeWalker discovery, and targeted refresh. Automatic translation excludes standalone amounts/currencies, quantities/units, explicit SKU/order identifiers, and recognized compact transaction data rows. Matching normalizes whitespace and full-width characters without modifying source text. Numeric product titles and ordinary sentences remain eligible. Native form entries, inherited `contenteditable` (including `plaintext-only`), and ARIA textbox/searchbox/combobox/spinbutton regions are protected; a valid `contenteditable=false` island ends editing inheritance, unless another exclusion applies.

A parent containing protected descendants is not a translation surface or request. Separate safe label elements can be promoted, including nested label markup; inseparable label/value text remains original. This prevents a filtered parent label from masking its protected value. No renderer, provider contract, token substitution, or page data transmission path was added. The rules are conservative and bounded, not exhaustive transaction recognition: unsupported currencies/units/identifier conventions and arbitrary input echoes cannot be inferred reliably. Prose with separate numeric descendant elements can remain original; ordinary unsplit numeric prose remains translated. Generic overlapping layout, ancestor clipping, and title typography remain outside this task.

## Reconciliation and lifecycle

Every current analysis is compared with the prior state as `added`, `changed`, `removed`, or `unchanged`:

- Added regions create a surface and request translation only on cache miss.
- Changed regions keep logical identity but render against their new source key.
- Removed, disconnected, hidden, collapsed, or no-longer-readable regions are disposed.
- Unchanged regions reuse their surface and cached result.

The content controller owns the authoritative current region set. Async results are cached only by their linguistic request key and render only when a current region requests that key. Lifecycle generations prevent an old in-flight request from affecting a later OFF/ON generation.

`MutationObserver` watches child nodes, character data, visibility-bearing attributes (`class`, `style`, `hidden`, `aria-hidden`, and `open`), plus targeting attributes `contenteditable` and `role`. Unsafe or changed affected surfaces and their queued work are removed in the mutation callback, before discovery is coalesced by affected semantic roots with a 120 ms debounce and 500 ms maximum wait. A targeted pass reanalyzes affected roots and cheaply refreshes active unaffected regions. Already sent requests may finish but cannot restore a removed region. Extension rendering lives outside the observed `body` and inside Shadow DOM, so it cannot recursively trigger source analysis.

Scroll always performs animation-frame geometry updates. Full visible-region discovery is scheduled only after a material scroll distance. Resize schedules reposition plus analysis. Active source elements use `ResizeObserver`, completed font loading triggers reposition, and hash/`popstate` navigation schedules full reconciliation.

Reader OFF disconnects observers, removes listeners/timers, invalidates in-flight request generations, clears active registrations, and removes the host. The bounded in-memory translation cache remains reusable during the content script's tab lifetime but cannot create presentation by itself.

Phase 5F-1 gives selection interpretation its own activation generation and request identity. Selection identity includes connected source endpoint nodes/offsets and the bounded context snapshot. Selection changes and source replacement/removal/context changes invalidate pending actions and explanations; success, failure, and latency/diagnostic updates require the current identity. Closing an explanation invalidates its pending response. Selection-action timers are tracked and cancelled on invalidation/OFF; a pre-activation selection is a baseline, so a queued browser selection event cannot revive the previous activation's action. Keyboard selection changes use the same lifecycle. Provider requests already sent may finish, but stale results cannot recreate presentation.

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

Phase 5D successfully deployed a public HTTPS endpoint on Railway and verified `/health`, exact Chrome extension origin CORS, and both `/translate` and `/interpret` through the Railway backend to OpenAI. Real MV3 remote translation worked on Dictionary.com. Selection interpretation initially returned HTTP 400 because `previousParagraph` was an empty string; after the collector fix described above, the live Railway/OpenAI browser E2E rerun confirmed both translation and selection interpretation working. The Railway deployment was removed after verification, so the service is currently offline. Production deployment must use HTTPS, exact installed-extension CORS origin(s), and one exact backend manifest origin; the source manifest remains localhost-only.

## Overlay geometry and website integrity

The only page-tree addition is one `<div data-context-reader-root>` appended to `document.documentElement`; all presentation lives inside its closed Shadow DOM. The renderer never writes source `textContent`, HTML, styles, structure, or framework state. Reader OFF removes the host.

Passive translation surfaces use `pointer-events: none`. Only the toolbar, selection action, and explanation popover accept pointer input.

Pointer activation of the original-view toggle, selection action, and close button preserves source focus/selection by preventing those buttons' mouse-down default. Keyboard activation remains available. No passive-surface event forwarding or source DOM writes are used.

Phase 5F-3 measures source text with read-only Ranges and uses its fractional rectangular envelope, contained by the source and viewport. Surfaces exclude element padding/borders. Overflow/scroll ancestors are checked at their inner clip edges; a partially clipped text envelope remains original. Computed fractional border widths avoid false clipping at non-integer device scales. Adjacent sibling boxes along the ancestor path and bounded hit testing guard overlapping controls/values. Mixed controls, transforms, nonrectangular clips, paint containment, opacity/filter effects and uncertain backgrounds conservatively remain original. The renderer inherits source typography/color and the nearest solid opaque background (or the default Canvas); it does not infer image/gradient backgrounds.

Headings, including UI-classified linked titles, and body text wrap. Single-line UI text uses a compact policy without ellipsis. The renderer measures the complete translated text at up to five sizes, reducing at most 20% with a 12 px floor unless the source is already smaller. Both scroll extents and actual text Range rectangles must fit; otherwise the original stays visible. Tiny UI suppression remains. Original-view return remeasures surfaces, so hidden layout cannot falsely count as fitting. No classifier, scheduler/cache, provider protocol or interpretation architecture changes are involved.

This is a bounded rectangular rendering policy, not a general layout/occlusion engine. Very long translations, partial clips, complex effects and inseparable geometry can remain original. Sampled hit testing does not prove arbitrary animated, pseudo-element or out-of-flow descendants safe on every site. Broad dynamic continuity, zoom/font-loading combinations and manual shopping/article journeys remain separate unverified gates.

## Verification

The deterministic suite covers filtering, language hints, logical identity, source invalidation, four-way reconciliation, translation reuse, visibility rejection, bounded context, extension-owned exclusion, Translator status transitions, remote translation success/failure/recovery, secure backend request/response bounds, source-markup preservation, interaction, geometry bounds, cleanup, and duplicate prevention.

The unpacked-extension regression uses `test-pages/fixture.html` in an installed Chromium browser. It validates delayed article insertion; subscription plan and price replacement; CSS hide/show; node removal; 25 rapid text changes; History API plus SPA route replacement; provider-mode UI; source preservation; page-button interaction; scroll survival; full cleanup; current-state-only re-enable; and one active host.

Phase 5B extends that regression through the real unpacked MV3 service worker and a deterministic loopback backend. The browser Translator API is disabled with the Blink runtime-feature switch and verified unavailable before reader activation. The suite first injects transient backend failures, confirms the overlay and source interaction remain alive, then performs an OFF/ON request cycle and requires deterministic remote translations. A fresh-profile startup race is avoided by reloading the fixture only after the extension worker and endpoint configuration are ready. CDP discovery, WebSocket commands, page conditions, and cleanup are bounded and report their last observation plus recent browser output on failure. The test server uses a raised test-only rate limit so the intentional outage/recovery scenario is not conflated with the backend's separately tested production default limit.

Phase 5F-1 adds an identical OFF/ON journey driven by CDP coordinate pointer events and keyboard events: local link/button activation, required-field validation, search entry/replacement/selection, checkbox, select, and fixture-only form submission. It asserts trusted event counts, values/checked/selected state, focus and selection offsets, submission data, site state, source markup, and source-mutation records. Comparing both runs permits the fixture's own mutations without attributing them to the extension. Original-view toggling and OFF/ON preserve the edited input state. Pointer-drag text selection and actual extension-control clicks exercise interpretation and pending-close behavior. Ten cycles hold both provider operations pending, turn OFF, finish success/failure responses, and require no host/surface/action/popover resurrection or further backend work while OFF.

Sixteen deterministic controller regressions cover reversed A/B success/failure (including identical text at different offsets), activation changes, close, source edit/replacement/removal, scheduled-action cancellation, current failure/recovery, existing translation generation protection and reversed source completions, and ten cycles with timer/observer/subscription cleanup and no duplicate work. The collector, scheduler/cache, classifier, and provider architecture are unchanged.

Phase 5F-2 adds `test-pages/targeting-safety.html` and thirteen targeting integration regressions. Tests inspect fake-provider requests and actual surfaces, seed/TreeWalker/refresh agreement, safe labels, editable inheritance, attribute-only transitions, mixed ancestors, node reuse, and late completion. The browser checks fifteen specified positive surfaces, an exact allowlist of automatic request/surface text, and surface rectangles against protected fields at multiple scroll positions. Identical trusted OFF/ON search, select, quantity, editable-note and cart journeys preserve source markup, values, focus, and expected event counts. A generated screenshot is written to `dist/targeting-safety.png` for visual QA; it is not source documentation.

Phase 5F-3 adds `test-pages/adaptive-rendering.html`, twelve rendering unit regressions and a browser oracle that requires seven complete, visible Korean translations: linked multiline product title, body, return condition, navigation, cart action, compact label and nested delivery condition. It checks actual surface text, glyph-line rectangles, overflow, source/text/ancestor bounds, button contrast, protected-value intersections and single closed host. Five unsafe cases remain original: tiny label, expanded compact translation, partial nested clip, gradient and overlapping transaction value. Real wheel input checks nested clipping/restoration. Identical OFF/ON coordinate-pointer and keyboard journeys assert focus, input selection, option/checkbox state, click/event counts, form payload and zero source mutations. `dist/adaptive-rendering.png` is supplementary generated evidence. Existing 5F-1/2 regressions remain part of the same browser run.

## Phase 4 production and public-site findings

The Responses API adapter now validates completed/non-empty output, retries one configurable 429/5xx response with abort-aware backoff, and never returns or logs raw provider errors. Provider identity is excluded from production application responses. Interpretation request/success/failure and average/p50/p95 latency are separate from translation metrics.

`CONTEXT_READER_API_ORIGIN` adds exactly one HTTPS backend origin to the generated manifest and CSP; validation rejects broad HTTPS permission. Runtime storage supplies only the public `/translate` and `/interpret` URLs on that origin. The source manifest remains localhost-only. The container runs as the unprivileged `node` user and includes a health check. HTTPS deployment and real provider calls were not exercised during Phase 4; both were subsequently verified in Phase 5D on Railway/OpenAI.

Read-only Edge 151 QA covered Wikipedia's Machine translation article, Adobe Creative Cloud plans, and React Quick Start. Every site retained one extension host through scroll and OFF/ON. Edge did not expose the Translator API, so provider mode was `unavailable` and no site reached viewport-ready. Wikipedia first measured 9/66/5 reading/UI/auxiliary and exposed navigation domination; after navigation candidate bounds it measured 64/12/4. Adobe measured 61/18/1 and one cache hit; its first limited-demo surface was 197.9 ms. React measured 56/23/1, one cache hit, and a 57.8 ms first limited-demo reading surface. These are fallback timings, not general translation or real-provider latency.

UI surfaces under 48×16 px are suppressed rather than painting unreadable ellipsis over controls; full output remains cached. Scheduler-driven presentation is coalesced to one animation frame. Discovery seeds the viewport, bounds fallback scanning and expensive visibility checks, and prevents one semantic class from exhausting the region budget.

## Known limitations

- Phase 5D real MV3 remote translation and selection interpretation were verified on Dictionary.com; broader production-site coverage remains limited.
- Complex transforms, vertical text, overlapping source rectangles, iframes, and page-owned closed Shadow DOM remain unsupported or approximate.
- Bounded long translations can be clipped.
- Remote translation and interpretation require a configured, permitted backend endpoint; the verified Railway deployment was removed after testing and the service is currently offline.
- The tested Edge 151 public-site run predates the Phase 5A remote translation path and remains evidence only for browser-provider unavailability.
- Unavailable translation work is retried after OFF/ON and can produce many fast failures on large pages.
- There is no user-facing endpoint or production host-permission settings flow.
- Backend rate limiting is per-process and keyed to the immediate peer address; production-scale distributed abuse protection is deployment-owned.
- Han-only Japanese can be classified as Chinese.
- History API calls without DOM mutation are detected only by later `popstate`/hash events or content changes.
- Browser integration requires a locally installed Chrome or Edge executable; nonstandard locations must be supplied through `CONTEXT_READER_BROWSER`.

## Required deployment follow-up

HUMAN_REQUIRED for long-term public operation: restore an HTTPS deployment with server-side credentials and exact CORS origins for the distributed extension ID(s), implement distributed abuse protection and durable rate limiting, and revalidate the deployed service. Phase 5D deployment and live translation/selection browser E2E verification are complete; the service is currently offline following deployment removal.

## Status

MVP tasks `0001` through `0004`, Phase 5A task `0005`, Phase 5B task `0006`, and Phase 5C readiness plus Phase 5D Railway/OpenAI/MV3 E2E verification under task `0007` are complete. After the optional-context fix, `npm.cmd run verify` passed all 51 tests, `npm.cmd run test:browser` passed, and `git diff --check` passed. The live browser E2E rerun also passed. The Railway deployment was then removed; long-term public operation, including distributed abuse protection and durable rate limiting, remains incomplete. Phase 5C/5D evidence lives in `docs/tasks/0007-production-backend-readiness.md`.

On 2026-10-08, Phase 5F-1 technical verification passed: `npm.cmd run verify` (67 tests, type check, build, MV3 manifest validation), followed by `npm.cmd run test:browser` (Edge 154.0.4258.62, extension 0.4.0, local fake backend), and `git diff --check`. The browser test reproduced and fixed source focus loss from the original-view control. No unresolved reproduced 5F-1 blocker remains. This is not overall Phase 5F completion: dense-commerce semantic/geometry gates and Taobao/second-store manual acceptance remain unverified, with no new site-specific blocker inferred from fixture success. See active packet `docs/tasks/0008-mvp-ui-ux-hardening.md`. No live service, paid provider, deployment, Factory workflow, or Phase 5E control was changed.

On 2026-10-08, Phase 5F-2 technical verification passed: `npm.cmd run verify` (126 tests / 17 files, TypeScript, build, manifest), `npm.cmd run test:browser` (Edge 154.0.4258.62, local fake backend, including all 5F-1 regressions), and `git diff --check`. No unresolved reproduced targeting blocker remains in these fixtures. Manual Taobao/second-store acceptance, broader adaptive rendering/clipping gates, Phase 5E operating controls, and public release remain unverified or incomplete. This task does not establish overall Phase 5F acceptance or authorize deployment.

On 2026-10-08, Phase 5F-3 technical verification passed: `npm.cmd run verify` (138 tests / 18 files, TypeScript, build, manifest), then `npm.cmd run test:browser` (Edge 154.0.4258.62 / extension 0.4.0, fresh profile/default zoom, requested 900×700 window, loopback fake provider), and `git diff --check`. Before-change browser assertions reproduced text-envelope overflow, common UI ellipsis, nested clip escape and a surface covering `USD 299`. All seven mandatory complete translations and five safe-original cases now pass, with wheel clipping/restoration, source-mutation and trusted OFF/ON input/form assertions. No reproduced fixture rendering blocker remains. The pre-existing uncommitted 5F-2 work was preserved. No external API/credential, dependency reinstall, live site or deployment was used. Manual Taobao/second-store and broader dynamic/product acceptance remain open under the Human Boundary; this is not overall Phase 5F completion or a Phase 5E/public-release approval.
