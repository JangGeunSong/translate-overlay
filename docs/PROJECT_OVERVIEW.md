# Context Reader Overlay — project overview

## Product intent

Context Reader Overlay is a Chrome extension for reading foreign-language web pages without replacing the page. The website continues to own its DOM, layout, styles, interactions, and application state; the extension owns an isolated visual interpretation layer.

The governing product rule is: **Do not rewrite the web. Interpret the web.**

## Repository baseline

The workspace was empty at the start of MVP task `0001`. There was no prior manifest, framework, build system, content script, service worker, UI component, project documentation, or reusable provider. The initial architecture therefore uses a small vanilla TypeScript codebase rather than introducing a UI framework.

## Current architecture

- Chrome Manifest V3 extension.
- `src/background/`: action-click/per-tab state orchestration and the secure interpretation backend client.
- `src/content/analysis/`: read-only visible-region discovery, identity, reconciliation, translation cache keys, language hints, and bounded context assembly.
- `src/content/providers/`: structured provider contracts, Chrome built-in Translator adapter, service-worker remote interpretation adapter, and deterministic development fallback.
- `src/content/overlay/`: one closed Shadow DOM containing passive translated surfaces and narrowly interactive controls.
- `src/content/readerController.ts`: region lifecycle, bounded translation batches, observer scheduling, provider state, selection flow, and cleanup.
- `tests/`: deterministic unit/integration tests and an unpacked-extension browser regression.

Build output is generated in `dist/` with esbuild. Vitest and jsdom provide deterministic tests.

## MVP behavior

Clicking the extension action toggles the reader for the current tab. When enabled, the content script scans at most 40 currently visible or near-visible semantic blocks and translates missing linguistic inputs in batches of 12. It renders a fixed translation surface aligned to each source block. A compact toolbar switches all surfaces between translation and original view and reports translation capability state.

Selecting original page text exposes a **맥락 해석** action. The lightweight popover stays on the page and does not become a generic chat surface.

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

`LinguisticProvider` accepts structured translation batches and structured interpretation context. `ProviderChain` tries Chrome's built-in Translator API for translation, the service-worker remote provider for interpretation, and finally `DemoProvider`.

Chrome documents the Translator API as desktop-only and available from Chrome 138. The adapter evaluates `availability()` per language pair and reports `available`, `downloadable`, `downloading`, `ready`, `unavailable`, or `error`, including `downloadprogress`. Rejected translator creation is removed from the cache so a later attempt can retry. Provider modes are explicit: `browser-translator`, `production-remote`, `development-demo`, and `unavailable`.

The deterministic fallback has a deliberately tiny phrase set. The toolbar identifies it as a limited development mode; it is never presented silently as production translation.

## Context extraction and production interpretation

Context collection is deterministic and bounded before provider invocation:

- selected text: 300 characters;
- containing sentence: 600 characters;
- containing paragraph: 1,200 characters;
- one nearby paragraph per direction: 600 characters each;
- nearest heading and page title: 300 characters each;
- source and target language identifiers.

The collector rejects extension-owned selections and never sends page HTML. `RemoteInterpretationProvider` sends this structure to the service worker. The worker revalidates every bound and calls a configured backend with a versioned JSON request. HTTPS is mandatory outside localhost, `credentials` is `omit`, host permission is checked, and explanations are capped at 1,200 characters.

No private API key or production credential is accepted by this repository. The extension stores only a public endpoint. Provider secrets, model routing, authentication/abuse controls, and rate limiting belong on the secure backend. The repository grants localhost access for development; an exact production HTTPS origin must be added to the production manifest rather than granting broad host access.

No backend was deployed in task `0002`. Without configuration, contextual interpretation visibly falls through to the deterministic development provider.

## Overlay geometry and website integrity

The only page-tree addition is one `<div data-context-reader-root>` appended to `document.documentElement`; all presentation lives inside its closed Shadow DOM. The renderer never writes source `textContent`, HTML, styles, structure, or framework state. Reader OFF removes the host.

Passive translation surfaces use `pointer-events: none`. Only the toolbar, selection action, and explanation popover accept pointer input.

Surfaces never exceed the current source rectangle height. Text wraps in ordinary regions, compact rectangles use one-line ellipsis, long translation density causes bounded font reduction with a 10 px floor, and the fixed viewport layer clips overflow. This favors preventing severe overlap over showing every translated character. The original-view toggle remains available for clipped content.

## Verification

The deterministic suite covers filtering, language hints, logical identity, source invalidation, four-way reconciliation, translation reuse, visibility rejection, bounded context, extension-owned exclusion, Translator status transitions, secure backend request/response bounds, source-markup preservation, interaction, geometry bounds, cleanup, and duplicate prevention.

The unpacked-extension regression uses `test-pages/fixture.html` in an installed Chromium browser. It validates delayed article insertion; subscription plan and price replacement; CSS hide/show; node removal; 25 rapid text changes; History API plus SPA route replacement; provider-mode UI; source preservation; page-button interaction; scroll survival; full cleanup; current-state-only re-enable; and one active host.

## Known limitations

- Public production websites were not exercised in this environment; the three representative categories use deterministic fixture sections.
- Complex transforms, vertical text, overlapping source rectangles, iframes, and page-owned closed Shadow DOM remain unsupported or approximate.
- Bounded long translations can be clipped.
- General translation depends on Chrome 138+ desktop, supported language packs, model availability, and browser activation rules.
- The production interpretation backend is a client/security contract only until an endpoint is deployed and permitted.
- There is no user-facing endpoint or production host-permission settings flow.
- Han-only Japanese can be classified as Chinese.
- History API calls without DOM mutation are detected only by later `popstate`/hash events or content changes.

## Recommended next task

Deploy one secure interpretation backend implementing the versioned contract, configure its public HTTPS endpoint and exact host permission, and run an end-to-end selection interpretation test without introducing a bundle secret.

## Status

MVP task `0001` and stabilization task `0002` are complete. Detailed findings and verification evidence live in `docs/tasks/0002-dynamic-lifecycle-and-providers.md`.
