# Task 0007 — Phase 5C production backend readiness

## Scope and result

This task closes the repository-side production boundary without choosing a hosting vendor, creating infrastructure, deploying, or adding credentials. The provider chain, scheduler, classifier, cache, overlay, and source-DOM read-only architecture are unchanged.

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

## Phase 5D selection context regression fix

The reported Railway/OpenAI MV3 selection request failed with HTTP 400 (`Invalid context field: previousParagraph.`). The collector now converts optional previous/next paragraph and nearest-heading values to `undefined` when normalization and bounding leave an empty string, so JSON omits them. Backend validation remains unchanged. Regression tests cover whitespace-only siblings, direct and nested headings, JSON omission, and the existing populated context case.

Validation: `npm.cmd run verify` passed (15 test files, 51 tests, TypeScript, build, and manifest validation); `npm.cmd run test:browser` passed MV3 remote failure/recovery and local interpretation E2E. The `.cmd` entry point was used because PowerShell blocks `npm.ps1`. Live Railway/OpenAI E2E was not rerun for this fix.

## HUMAN_REQUIRED

- Choose a hosting vendor and stable HTTPS domain.
- Provision TLS-capable infrastructure and supply the production OpenAI credential through its secret environment.
- Determine the stable distributed extension ID or IDs and place those exact origins in backend CORS.
- Select and configure deployment-level distributed rate limiting/abuse controls appropriate to expected traffic.
- Run the opt-in real-provider smoke and post-deployment browser E2E; neither was run without a credential and deployed origin.
