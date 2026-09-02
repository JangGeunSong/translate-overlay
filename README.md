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

## Extension endpoint boundary

Context interpretation first calls a service-worker-owned backend client. No provider credential is accepted or bundled. For local backend development, configure the public endpoint from the extension service-worker console:

```js
await chrome.storage.local.set({
  translationProvider: { endpoint: "http://localhost:8787/translate" },
  interpretationProvider: { endpoint: "http://localhost:8787/interpret" }
});
```

Production endpoints must be the two paths on one exact HTTPS backend origin. The backend owns provider credentials and model selection; the extension stores only these public URLs:

```js
await chrome.storage.local.set({
  translationProvider: { endpoint: "https://reader-api.example.com/translate" },
  interpretationProvider: { endpoint: "https://reader-api.example.com/interpret" }
});
```

The calls remain service-worker mediated, omit credentials, and require an exact host permission. No OpenAI key or other provider credential belongs in extension storage, source, manifest, or `dist/`.

Build a production artifact with one exact backend origin:

```sh
CONTEXT_READER_API_ORIGIN=https://reader-api.example.com npm run build
```

The build adds only `https://reader-api.example.com/*` to `host_permissions` and only the origin to extension-page `connect-src`. It rejects HTTP, paths, and broad `https://*/*` access. `CONTEXT_READER_API_ORIGIN` is public build configuration, not a secret. The source manifest retains only loopback backend permissions for deterministic development.

Deterministic demo translation is excluded by default. For local development only, opt in when building with `$env:CONTEXT_READER_DEMO="true"; npm run build`.

Set `localStorage.contextReaderDebug = "1"` on a test page to log reconciliation counters in development.

## Browser integration verification

Run the deterministic unpacked-extension regression with:

```sh
npm run test:browser
```

The command builds `dist/`, starts local fixture and linguistic-backend servers on loopback ports, launches Chrome or Edge with a temporary profile, and verifies the MV3 service-worker remote path while the browser Translator API is disabled. It covers remote failure containment, OFF/ON recovery, exact localhost host permission/CSP access, closed-shadow overlay behavior, source-markup preservation, and source-page interaction.

Chrome or Edge must be installed in a standard location. Set `CONTEXT_READER_BROWSER` to an executable path when it is elsewhere. Every CDP connection, command, and state wait is bounded; failures include the last observed value and recent browser output. No network service or API credential is used.

## Linguistic backend deployment contract

The backend is a vendor-neutral Node.js HTTP process intended to run behind a deployment target's HTTPS/TLS termination. It binds `0.0.0.0:$PORT`, implements `POST /translate`, `POST /interpret`, and unauthenticated `GET /health`, and includes a vendor-neutral container artifact at `server/Dockerfile`. The deployment target must support Node.js 20 or newer (the container uses Node.js 24), outbound HTTPS to the provider, environment secrets, and an HTTPS public origin.

Required production environment:

| Variable | Contract |
| --- | --- |
| `NODE_ENV` | Must be `production`; this makes mock mode invalid and disables provider diagnostics. |
| `INTERPRETATION_PROVIDER` | `openai` in production. The historical name selects the shared translation/interpretation provider. |
| `OPENAI_API_KEY` | Required server-side secret. Never include it in extension configuration. |
| `ALLOWED_EXTENSION_ORIGINS` | One or more comma-separated exact `chrome-extension://<32-character-id>` origins; required in production. |
| `PORT` | Optional integer `1..65535`; defaults to `8787`. |
| `OPENAI_MODEL` | Optional model; defaults to `gpt-5.6-luna`. |
| `OPENAI_MAX_RETRIES` | Optional integer `0..5`; defaults to `1`. |
| `PROVIDER_TIMEOUT_MS` | Optional integer `100..60000`; defaults to `12000`. |
| `RATE_LIMIT_PER_MINUTE` | Optional integer `1..10000`; defaults to `30` per process and immediate peer address. |
| `EXPOSE_PROVIDER_DIAGNOSTICS` | Development-only opt-in; ignored in production. |

Startup fails before listening for an unknown provider, missing production CORS origin, missing OpenAI key, malformed exact extension origin, mock production mode, or invalid numeric bound. Provider timeouts and failures are returned as normalized `502` responses without raw provider details. Responses are `no-store`; request bodies and outputs are bounded. The built-in limiter is process-local and is not a substitute for deployment-level distributed abuse protection.

For deterministic local backend work, set `INTERPRETATION_PROVIDER=mock` without `NODE_ENV=production`, then run `npm run backend:start`. `npm run verify` and `npm run test:browser` remain offline/deterministic and never invoke OpenAI.

Real-provider verification is deliberately billable and opt-in. It exercises both backend HTTP routes through the Responses provider:

```sh
RUN_REAL_PROVIDER_TEST=1 OPENAI_API_KEY=... npm run test:provider:real
```

After deployment, verify `/health`, build and validate `dist/` with the exact HTTPS origin, configure the two endpoint paths, and rerun translation plus selection interpretation in the unpacked extension with browser-native Translator unavailable. Confirm source markup and page controls remain unchanged/functional and OFF removes the single overlay host.

HUMAN_REQUIRED: choose the hosting vendor and stable HTTPS domain, provision TLS/infrastructure and the real server-side key, determine the stable distributed extension ID(s) for CORS, configure deployment-level abuse controls, and execute the post-deployment E2E. This repository does not make those decisions, create infrastructure, deploy, or store credentials.

See [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md), the [Phase 5A packet](docs/tasks/0005-remote-translation-provider.md), the [Phase 5B browser verification packet](docs/tasks/0006-mv3-remote-browser-verification.md), and the [Phase 5C readiness packet](docs/tasks/0007-production-backend-readiness.md).
