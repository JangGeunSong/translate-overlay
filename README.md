# Context Reader Overlay

An MVP Chrome extension that places a Korean reading layer over English, Japanese, and Chinese page text while leaving the source page intact.

## Develop

```sh
npm install
npm run verify
```

Load `dist/` as an unpacked extension from `chrome://extensions` with Developer mode enabled. Open an HTTP(S) page and click the extension action to toggle the reader. Select source-page text and choose **맥락 해석** for the lightweight contextual explanation.

Chrome's built-in Translator API is used when the browser exposes it and the required language model is available. Otherwise the extension uses a deliberately limited deterministic provider that proves the presentation and context architecture; it is not a production-quality general translator.

The toolbar identifies whether browser translation is ready, a model is being prepared, the development fallback is active, or translation is unavailable.

## Production interpretation boundary

Context interpretation first calls a service-worker-owned backend client. No provider credential is accepted or bundled. For local backend development, configure the public endpoint from the extension service-worker console:

```js
await chrome.storage.local.set({
  interpretationProvider: { endpoint: "http://localhost:8787/interpret" }
});
```

Production endpoints must use HTTPS and require an exact host permission in the production manifest. The backend owns provider credentials, authentication/abuse controls, and model selection. If no backend is configured or reachable, the UI identifies and uses the deterministic development interpretation fallback.

Set `localStorage.contextReaderDebug = "1"` on a test page to log reconciliation counters in development.

See [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md), the completed [initial MVP packet](docs/tasks/0001-mvp-reading-layer.md), and the active [dynamic lifecycle packet](docs/tasks/0002-dynamic-lifecycle-and-providers.md).
