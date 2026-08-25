# Task 0004 — Production E2E readiness and public-site QA

## Baseline

Work started on clean `main` at `43300c4`, extension version 0.3.0. Phase 3 already separated analysis, scheduling, rendering, providers, service-worker transport, and the Node backend. Phase 4 preserved those boundaries and the source-DOM read-only invariant.

## Provider and backend hardening

The OpenAI adapter remains a server-side `POST /v1/responses` integration. It uses environment-selected `OPENAI_MODEL`, `store: false`, low verbosity, a 300-token ceiling, and a concise reading-oriented prompt. Phase 4 added strict response-object/status/error checks, nested output extraction, one configurable retry for 429/5xx, abort-aware bounded delay, and normalized failures. Provider bodies and raw errors are neither logged nor returned.

The application response remains version 1 and contains only the bounded explanation by default. Provider diagnostics require `EXPOSE_PROVIDER_DIAGNOSTICS=1` and are disabled in production. Tests cover auth placement, request shape, malformed/empty/incomplete output, 4xx, transient 5xx, timeout, response capping, and raw-error suppression.

Interpretation diagnostics now separate request/success/failure counts and average/p50/p95 latency from translation metrics. Installed local E2E validates them after the popover result.

The final installed fixture recorded one successful local-backend interpretation at 173 ms. Translation fixture readiness was 3.5 ms with 12 cache hits. These are deterministic local measurements, not real-provider latency.

## Deployment contract

- `OPENAI_API_KEY` exists only in the backend environment.
- `OPENAI_MODEL` and `OPENAI_MAX_RETRIES` are configurable.
- `ALLOWED_EXTENSION_ORIGINS` is an exact comma-separated CORS allowlist.
- `CONTEXT_READER_API_ORIGIN` is an exact HTTPS origin used only at extension build time.
- The source manifest keeps localhost permissions. Production builds add only the configured origin; broad HTTPS permission is rejected.
- The container runs as `node`, exposes port 8787, and has a health check.
- `RUN_REAL_PROVIDER_TEST=1 npm run test:provider:real` is the only billable smoke path.

No deployment or actual OpenAI request was performed because this environment exposed no deployment credential, stable endpoint, or API key. Docker 29.6.2 was present, but Docker Desktop's Linux daemon was not running. Remaining manual work is to deploy on a container-capable target, set the backend environment, build with its exact HTTPS origin, configure the installed extension ID in CORS, and run the opt-in and browser smoke tests.

## Public-site QA

The read-only harness ran the unpacked extension in Edge 151 with background throttling disabled. It did not click purchase/login controls or submit data.

### Article — Wikipedia Machine translation

- English; 14,721 px; 20 buttons; 1,181 links.
- The first run measured 9 reading, 66 UI, and 5 auxiliary regions, exposing navigation domination.
- After bounding navigation candidates and adding semantic quotas, the actual-site rerun measured 64/12/4 initially and 55/4/14 after scroll.
- Two limited-demo reading surfaces appeared at 79.3 ms; general translation and viewport-ready remained unavailable.
- Scroll and OFF/ON retained one host; re-enable reused two demo results.

### Ecommerce — Adobe Creative Cloud plans

- English; 5,797 px; 8 buttons; 92 links.
- Initial regions: 61 reading, 18 UI, 1 auxiliary.
- The limited demo provider produced one UI surface initially and three mixed surfaces after scroll; viewport-ready remained false.
- First demo surface: 197.9 ms. First demo reading surface after scroll: 6,268.1 ms.
- OFF/ON reused one cached demo result and retained one host.

### SPA/documentation — React Quick Start

- English; 15,671 px; 41 buttons; 126 links.
- Initial regions: 56 reading, 23 UI, 1 auxiliary.
- One demo reading surface appeared at 57.8 ms; two existed after scroll.
- OFF/ON produced one cache hit and retained one host. Viewport-ready remained false.

Edge 151 reported translation mode `unavailable`; English, Japanese, and Chinese language-pack initialization could not be measured. Values above are deterministic fallback timings, not general translation quality or provider latency. Public-site selection interpretation was not run without a real HTTPS endpoint.

## Readability and performance refinements

- UI surfaces under 48×16 px are suppressed instead of showing unreadable ellipsis over a control. Full translation data remains cached.
- Scheduler event rendering is coalesced to one animation frame.
- Discovery seeds viewport hit-tested blocks, bounds fallback text walking and expensive visibility checks, and reserves the region budget by semantic class.
- Development diagnostics are exposed only on the extension-owned host; no source content is changed.

## Assessment and next task

The lifecycle, isolation, classifier, scheduler, backend contract, and local interpretation loop are credible. The tested artifact is not ready for a general public MVP release because the tested browser offered no general translation provider and no production interpretation endpoint exists.

The next task is to deploy the backend to one stable HTTPS origin with a real server-side OpenAI key and run the existing browser selection E2E against it. Only after that should broader UI polish continue.
