# Task 0006 — Phase 5B MV3 remote fallback browser verification

## Scope

This task verifies the existing remote translation boundary in a real unpacked Manifest V3 extension. It does not deploy a backend, add credentials, alter provider ordering, or change rendering and scheduling architecture.

## Diagnosis and correction

The previous browser run was not deterministic for two independent reasons:

1. Edge exposed `Translator.availability()` as `downloadable` even when launched with the Chromium base-feature switch. The regression now disables the Blink `TranslationAPI` runtime feature and independently checks from an isolated page world that the API is absent or unavailable before activating the reader.
2. On a fresh browser profile, the fixture tab could commit before the unpacked extension completed startup, so its content script was never injected. The harness now waits for and identifies the extension service worker, configures its endpoints, and reloads the fixture before messaging the content script.

All DevTools-port discovery, HTTP discovery, WebSocket connection, CDP commands, and state polling have explicit bounds. A timeout reports the named phase, last value or error, and recent browser process output. Polling also tolerates transient execution-context destruction during reload.

The failure phase can issue enough fast requests to overlap the recovery phase's requests. The deterministic test server therefore raises only its test-local request limit to 200 per minute; backend rate-limit behavior and the production default remain unchanged and covered by backend tests.

## Verified path

The suite builds and loads `dist/`, starts an ephemeral loopback page server and deterministic translation backend, and then verifies:

- Manifest V3 service-worker discovery and extension messaging;
- exact loopback host permission and CSP `connect-src`, with no broad HTTPS or all-URL grant;
- browser-native Translator API unavailability;
- remote calls reaching the deterministic backend;
- contained backend failures with one overlay host, unchanged source markup, and a working page button;
- recovery on a subsequent OFF/ON request cycle, deterministic `[ko]` output, and `production-remote` ready state;
- unchanged source markup after recovered rendering;
- existing dynamic lifecycle, semantic classification, interaction, geometry, cleanup, and closed-shadow traversal checks;
- deterministic local interpretation and exposed latency diagnostics.

## Commands and requirements

```sh
npm run test:browser
npm run verify
```

`npm run test:browser` builds the extension before launching it. A locally installed desktop Chrome or Edge is required. For a nonstandard installation, set `CONTEXT_READER_BROWSER` to the browser executable. The test uses only loopback ports, a temporary browser profile, and the repository mock provider; it requires no internet access, API secret, or production credential.

On Windows PowerShell environments that block the `npm.ps1` shim, the equivalent commands are `npm.cmd run test:browser` and `npm.cmd run verify`.

## Known limitations

- This is deterministic loopback verification, not evidence for a deployed HTTPS backend or paid provider.
- Browser policy installations may prevent unpacked extensions or remote debugging; the harness reports browser output but cannot override administrator policy.
- The test covers Chrome-family desktop browsers only, consistent with the Manifest V3 product scope.
