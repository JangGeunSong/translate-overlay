# Task 0007 — Phase 5C production backend readiness and Phase 5D live E2E

## Scope and result

Phase 5C closed the repository-side production boundary without choosing a hosting vendor, creating infrastructure, deploying, or adding credentials. Phase 5D subsequently completed Railway public HTTPS deployment and real OpenAI/MV3 E2E verification. The deployment was removed after verification, so the service is currently offline. The provider chain, scheduler, classifier, cache, overlay, and source-DOM read-only architecture are unchanged.

The existing backend remains a portable Node.js HTTP process designed for HTTPS termination by a generic deployment platform. `server/Dockerfile` is the optional container contract: it runs unprivileged, binds the injected `PORT`, and probes `GET /health`.

## Startup and request safety

`server/config.mjs` now validates configuration before the listener starts. Production requires the OpenAI provider, a non-empty server-side `OPENAI_API_KEY`, and at least one exact `chrome-extension://<id>` CORS origin. Mock mode, unknown providers, malformed origins, and out-of-range port, timeout, retry, or rate-limit values fail fast. Provider diagnostics remain unavailable in production.

The existing `POST /translate` and `POST /interpret` routes retain bounded versioned envelopes, a 16 KiB body limit, bounded outputs, provider abort timeout, normalized errors, `no-store`, `nosniff`, exact-origin CORS, and process-local rate limiting. `GET /health` remains available for deployment probes. The local rate limiter is intentionally basic; multi-instance/durable abuse protection is deployment-owned.

## Extension and provider boundary

`CONTEXT_READER_API_ORIGIN=https://example.invalid npm run build` adds exactly one HTTPS origin to manifest host permissions and CSP. Runtime storage contains only the public `/translate` and `/interpret` URLs. Both clients run in the service worker, verify the matching origin permission, omit credentials, reject non-local HTTP, and use a 15-second client timeout. No provider credential is accepted by or bundled into the extension.

The existing billable smoke remains excluded from `verify` and is gated by both `RUN_REAL_PROVIDER_TEST=1` and `OPENAI_API_KEY`. It now sends bounded requests through both local backend HTTP routes, so the real Responses adapter's translation and interpretation compositions are covered when a human explicitly opts in. Unit tests use an injected fake fetch; deterministic browser tests use the local mock and require no network.

## Verification contract

Default, non-billable checks:

```sh
npm run verify
npm run test:browser
git diff --check
```

Explicit billable check:

```sh
RUN_REAL_PROVIDER_TEST=1 OPENAI_API_KEY=... npm run test:provider:real
```

After a real deployment, a human must check `/health`, build with the deployed exact origin, configure both endpoint URLs, and exercise remote translation plus selection interpretation in the unpacked extension while browser translation is unavailable. The existing DOM preservation, page interaction, one-host, and OFF cleanup assertions remain the required regression boundary.

## Phase 5D deployment, selection context fix, and live E2E

Railway public HTTPS deployment, `/health`, and exact Chrome extension origin CORS verification succeeded. Real `/translate` and `/interpret` requests through the Railway backend to OpenAI returned successful translations and interpretations. MV3 extension remote translation also worked on the real Dictionary.com page.

The initial Railway/OpenAI MV3 selection interpretation request failed with HTTP 400 (`Invalid context field: previousParagraph.`) because the collector supplied `previousParagraph: ""`. The collector now converts optional `previousParagraph`, `nextParagraph`, and `nearestHeading` values to `undefined` when normalization and bounding leave an empty string, so JSON omits them. Backend validation remains unchanged. Regression tests cover whitespace-only siblings, direct and nested headings, JSON omission, and the existing populated context case.

Validation after the fix: `npm.cmd run verify` passed (15 test files, 51 tests, TypeScript, build, and manifest validation); `npm.cmd run test:browser` passed MV3 remote failure/recovery and local interpretation E2E; `git diff --check` passed. The `.cmd` entry point was used because PowerShell blocks `npm.ps1`. The live Railway/OpenAI browser E2E was rerun after the fix and confirmed both translation and selection interpretation working on Dictionary.com.

After verification, the Railway deployment was removed using Remove. The service is currently offline; successful E2E verification does not imply an active public service or completed long-term operational protections.

## HUMAN_REQUIRED

- Restore an HTTPS deployment and server-side OpenAI credential before resuming public service.
- Maintain exact backend CORS origins for the stable distributed extension ID or IDs; the tested Chrome extension origin passed Phase 5D validation.
- Implement deployment-level distributed abuse protection and durable rate limiting appropriate to long-term public traffic; these remain incomplete.
- Revalidate health, CORS, and live translation/selection browser E2E when redeploying. Phase 5D live E2E is complete.
