# Context Reader Overlay — project overview

## Product intent

Context Reader Overlay is a Chrome extension for reading foreign-language web pages without replacing the page. The website continues to own its DOM, layout, styles, interactions, and application state; the extension owns an isolated visual interpretation layer.

The governing product rule is: **Do not rewrite the web. Interpret the web.**

## Repository baseline

The workspace was empty at the start of MVP task `0001`. There was no prior manifest, framework, build system, content script, service worker, UI component, project documentation, or reusable provider. The initial architecture therefore uses a small vanilla TypeScript codebase rather than introducing a UI framework.

## Current architecture

- Chrome Manifest V3 extension.
- `src/background/`: action-click and per-tab reader state orchestration.
- `src/content/analysis/`: read-only visible-region discovery, stable identities, language hints, and bounded context assembly.
- `src/content/providers/`: translation and contextual interpretation contracts, Chrome built-in Translator adapter, and deterministic development fallback.
- `src/content/overlay/`: one Shadow DOM host containing passive translated surfaces and narrowly interactive extension controls.
- `src/content/readerController.ts`: reader lifecycle, bounded translation batches, observer scheduling, selection flow, and cleanup.
- `tests/`: deterministic tests plus a DOM invariant integration test.

Build output is generated in `dist/` with esbuild. Vitest and jsdom provide deterministic tests.

## MVP behavior

Clicking the extension action toggles the reader for the current tab. When enabled, the content script scans at most 40 currently visible or near-visible semantic blocks and translates missing regions in batches of 12. It renders a fixed translation surface aligned to each source block. A compact toolbar switches all translated surfaces between translation and original view.

Selecting original page text exposes a **맥락 해석** action. The resulting lightweight popover stays on the page and does not become a general chat surface.

## Page analysis and region identity

`TreeWalker` reads text nodes and groups them by a nearest paragraph/list/heading-like block. Script, style, template, form-entry, hidden, SVG/canvas, and extension-owned nodes are excluded. Geometry and computed typography are read from each source element. English, Japanese, and Chinese are recognized with a small deterministic Unicode heuristic. A stable ID hashes the element's structural path and normalized text, so an unchanged region reuses its translation while changed text gets a new identity.

Discovery is deliberately viewport-bound and capped. It is not a whole-document extraction engine.

## Translation and interpretation boundary

`LinguisticProvider` accepts structured translation batches and structured interpretation context. `ProviderChain` currently tries Chrome's desktop built-in `Translator` API and falls back to `DemoProvider`. The built-in adapter is the general translation path when the API and language pack are available. The fallback is intentionally small and deterministic: it makes the overlay usable on known demo phrases and preserves testability, but it is not a production translator.

Interpretation uses the deterministic fallback in this MVP because the built-in Translator API performs translation rather than contextual explanation. A production LLM provider can implement the same contract without changing analysis or rendering. A future remote provider should run through the service worker or a controlled backend; secrets must never be placed in a content script.

Chrome documents the Translator API as desktop-only and available from Chrome 138. Language packs may need a download and model creation can require user activation. Failure or unavailability falls through to the deterministic provider.

## Context extraction

Context collection is deterministic and bounded before provider invocation:

- selected text: 300 characters;
- containing sentence: 600 characters;
- containing paragraph: 1,200 characters;
- up to one nearby paragraph in each direction: 600 characters each;
- nearest preceding heading and page title: 300 characters each;
- source and target language identifiers.

The collector rejects selections within extension-owned UI. It never sends the entire page or asks a model to discover page structure.

## Lifecycle

The MV3 service worker stores per-tab ON/OFF state in `chrome.storage.session`, updates the action badge, and messages the content script. The content controller owns enable/disable setup and cleanup. Scroll and resize produce animation-frame geometry updates plus debounced visible-region scans. DOM mutations are batched at 250 ms; hash and popstate navigation schedule rescans. `MutationObserver` and `ResizeObserver` are disconnected and all listeners, timers, caches, surfaces, popovers, and the host are removed on disable.

## Non-mutation invariant

Page analysis may read text nodes, ancestors, visibility, semantic neighbors, and geometry. It must never write to a source node, wrap source text, replace HTML, change page CSS, or attach extension controls inside source content. The only page-tree addition is a single extension host appended to `document.documentElement`; all extension presentation lives inside its Shadow DOM. Removing the reader removes that host.

Passive translation surfaces use `pointer-events: none`. Only the compact toolbar, selection action, and explanation popover accept pointer input. This keeps underlying links, buttons, forms, and application behavior available.

The renderer writes `textContent`, styles, and controls only on elements it created inside its closed Shadow DOM. The sole source-document change is appending `<div data-context-reader-root>` to `document.documentElement`; that node is removed in full on reader OFF. Tests snapshot a source subtree before enable, after rendering, and after cleanup.

## Known limitations

- Block rectangles are an approximation; complex inline layouts, transforms, vertical text, sticky content, overlapping elements, and very long Korean translations can align or clip poorly.
- The deterministic fallback has a tiny phrase set. General translation depends on Chrome 138+ desktop, supported language packs, model availability, and browser activation rules.
- Contextual explanation is an architecture-validating deterministic provider, not yet a general LLM-backed interpreter.
- Cross-origin iframes, page-owned closed Shadow DOM, canvas, images, PDFs, and text inside form controls are not analyzed.
- Han-only Japanese can be classified as Chinese by the MVP heuristic.
- The observer follows ordinary SPA mutations, `popstate`, and hash changes but does not patch the History API or cover every body-replacement/navigation pattern.
- Visual QA has used the controlled fixture, not a compatibility matrix of production websites.

## Verification

The deterministic suite covers text filtering, language hints, region identity, bounded context assembly, extension-owned exclusion, request/result identity, known contextual interpretation, source-markup preservation, page-control behavior, cleanup, and duplicate prevention.

An automated unpacked-extension smoke test runs against `test-pages/fixture.html` in an installed Chromium browser. It verifies reader enable, translated text inside the closed Shadow DOM, exact source markup preservation, an underlying button click, scroll survival, full disable cleanup, and a single host after re-enable.

## Recommended next task

Connect a production contextual interpretation provider behind `LinguisticProvider` and add explicit built-in Translator availability/download UI. Then validate geometry and interaction on a small, named compatibility set (one article, one ecommerce page, and one SPA) before broadening extraction rules.

## Status

MVP task `0001` is complete. Detailed verification evidence and remaining work live in `docs/tasks/0001-mvp-reading-layer.md`.
