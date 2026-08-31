# Context Reader Overlay

An MVP Chrome extension that places a Korean reading layer over English, Japanese, and Chinese page text while leaving the source page intact.

## Develop

```sh
npm install
npm run verify
```

Load `dist/` as an unpacked extension from `chrome://extensions` with Developer mode enabled. Open an HTTP(S) page and click the extension action to toggle the reader. Select source-page text and choose **맥락 해석** for the lightweight contextual explanation.

Chrome's built-in Translator API is used when the browser exposes it and the required language model is available. Otherwise the extension tries a configured remote translation backend, then reports translation as unavailable if that real provider also fails. The deliberately limited deterministic provider is available only in an explicitly opted-in local development build.

The toolbar identifies whether browser translation is ready, a model is being prepared, the development fallback is active, or translation is unavailable. Phase 3 classifies `READING`, `UI`, and `AUXILIARY` regions and uses a three-worker viewport-priority scheduler. Pending work leaves the source visible instead of showing translation-like placeholders.

Phase 4 adds public-site QA diagnostics, a hardened Responses API adapter, deployment-time exact-origin configuration, and conservative suppression of UI overlays too small to read safely.

## Production linguistic backend boundary

Context interpretation first calls a service-worker-owned backend client. No provider credential is accepted or bundled. For local backend development, configure the public endpoint from the extension service-worker console:

```js
await chrome.storage.local.set({
  translationProvider: { endpoint: "http://localhost:8787/translate" },
  interpretationProvider: { endpoint: "http://localhost:8787/interpret" }
});
```

Production endpoints must use HTTPS and require an exact host permission in the production manifest. The backend owns provider credentials, authentication/abuse controls, and model selection. If no backend is configured or reachable, the UI identifies and uses the deterministic development interpretation fallback.

Build a production artifact with one exact backend origin:

```sh
CONTEXT_READER_API_ORIGIN=https://reader-api.example.com npm run build
```

The build rejects non-HTTPS origins with paths and never adds `https://*/*`. Real-provider smoke testing is billable and opt-in only: set `RUN_REAL_PROVIDER_TEST=1` and a server-side `OPENAI_API_KEY` before running `npm run test:provider:real`.

Deterministic demo translation is excluded by default. For local development only, opt in when building with `$env:CONTEXT_READER_DEMO="true"; npm run build`.

Set `localStorage.contextReaderDebug = "1"` on a test page to log reconciliation counters in development.

## Linguistic backend

Provide the variables documented in `.env.example`, keeping the real key out of Git, then run `npm run backend:start`. The backend implements `POST /translate`, `POST /interpret`, and `GET /health`. Its default production provider uses the OpenAI Responses API; `INTERPRETATION_PROVIDER=mock` supplies deterministic local translation and interpretation and is rejected when `NODE_ENV=production`.

Deploy behind HTTPS, set `ALLOWED_EXTENSION_ORIGINS` to the exact installed extension origin, and add only that backend HTTPS origin to the production manifest. This repository contains neither deployment credentials nor a deployed endpoint.

See [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md), the [Phase 4 packet](docs/tasks/0004-production-e2e-and-public-qa.md), and the [Phase 5A packet](docs/tasks/0005-remote-translation-provider.md).
