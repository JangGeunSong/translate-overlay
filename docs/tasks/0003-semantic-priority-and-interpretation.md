# Task 0003 — Semantic priority and interpretation E2E

## Objective

Preserve Phase 2 reconciliation while prioritizing primary reading content, making translation latency observable, and completing a secure contextual-interpretation loop without placing credentials in the extension.

## Baseline and findings

Work started on `master` at `8e6f7fe`, with a clean worktree and extension version 0.2.0. The controller submitted cache misses in DOM-order batches. Cache and in-flight reuse were sound, but there was no global concurrency bound, semantic class, viewport reprioritization, region lifecycle state, or time-to-readable metric. Pending/demo text could resemble real translation.

## Implemented contracts

- `READING`, `UI`, and `AUXILIARY` use deterministic DOM/ARIA/structure/density/geometry inputs.
- Priorities are viewport reading (0), viewport secondary (1), near reading (2), near secondary (3), far reading (4), and far secondary (5).
- `TranslationScheduler` has concurrency 3, key-based queue/in-flight reuse, queued-job reprioritization, desired-set cancellation, and generation-based stale-event rejection.
- The tab-lifetime cache remains authoritative before scheduling; cached output requires no provider work.
- Region lifecycle is `queued`, `translating`, `translated`, `fallback`, `failed`, or `cached` for diagnostics.
- Pending content creates no translation-like surface. Viewport readiness is at least 80% of current viewport `READING` regions.

The final installed-browser fixture measured 3.5 ms for `timeToFirstTranslation`, 3.5 ms for `timeToFirstReadingContent`, and 3.5 ms for `timeToViewportReady` with the deterministic local provider. These are fixture measurements, not production-network latency.

## Interpretation backend and security

`server/` implements `POST /interpret` and `GET /health`. It validates body/version/field bounds, caps explanations at 1,200 characters, handles provider timeout, normalizes errors, sends `no-store` and `nosniff`, restricts CORS, and includes a process-local rate limit.

The production adapter calls the OpenAI Responses API. `OPENAI_API_KEY`, model selection, and allowed extension origins exist only in backend environment variables. The extension omits cookies, permits HTTP only for localhost, and retains exact localhost development host permissions. The mock provider is rejected under `NODE_ENV=production`.

No external endpoint was deployed because this environment has no cloud account or API secret. The browser regression starts a local backend and proves selection → bounded collector → service worker → backend → provider → Korean popover. The captured request contained only structured context fields.

## Verification and representative fixtures

- Strict TypeScript, unit tests, production build, and manifest validation run through `npm run verify`.
- Backend contract/provider/HTTP tests run through `npm run test:backend`.
- Unpacked Edge covers article classification and delayed insertion; subscription controls, dynamic prices, and interactions; auxiliary metadata/sidebar/footer; SPA replacement; stale disposal; OFF/ON; metrics; and local selection interpretation.
- Source snapshot and single-host checks preserve the non-mutation invariant; passive surfaces retain `pointer-events: none`.

Public-site manual QA was not performed. Deterministic fixtures cover the three requested site shapes without volatile dependencies or site-specific workarounds.

## Known limitations and remaining work

- Heuristics can misclassify unconventional component markup.
- Fixed rectangles can still clip dense translations; full values remain retained.
- The queue does not predict reading direction beyond viewport bands.
- Chrome Translator download latency remains platform/browser dependent.
- Production needs HTTPS deployment, gateway authentication, durable abuse controls, privacy-reviewed logging, monitoring, and a server-side provider key.

## Next task

Deploy the existing backend behind a stable HTTPS origin, configure exact manifest/CORS origins and the server-side key, then rerun selection E2E and record real provider latency.
