# Context Reader Overlay

An MVP Chrome extension that places a Korean reading layer over English, Japanese, and Chinese page text while leaving the source page intact.

## Develop

```sh
npm install
npm run verify
```

Load `dist/` as an unpacked extension from `chrome://extensions` with Developer mode enabled. Open an HTTP(S) page and click the extension action to toggle the reader. Select source-page text and choose **맥락 해석** for the lightweight contextual explanation.

Chrome's built-in Translator API is used when the browser exposes it and the required language model is available. Otherwise the extension uses a deliberately limited deterministic provider that proves the presentation and context architecture; it is not a production-quality general translator.

See [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) and the active [MVP task packet](docs/tasks/0001-mvp-reading-layer.md).
