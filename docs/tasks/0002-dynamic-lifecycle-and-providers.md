# Task 0002 — Dynamic lifecycle and production provider boundary

Status: complete

## Goal

Make the reading layer converge on the current render state after dynamic UI changes, prevent redundant linguistic work, expose browser translation capability, and provide a secure client boundary for production contextual interpretation.

## Diagnosed root cause

The renderer already removed IDs absent from a completed analysis, so it was not strictly append-only. Stale presentation persisted when reconciliation did not receive an accurate or timely current state:

1. The source observer did not watch visibility-bearing attributes such as `class`, `style`, `hidden`, or `aria-hidden`.
2. A trailing-only debounce could be postponed indefinitely by continuous mutations.
3. Geometry-only reposition checked viewport bounds but not full connectivity/CSS visibility, allowing stale surfaces to remain during delayed analysis.
4. IDs combined structural path and source text. Text replacement therefore appeared only as remove/add, while sibling insertion could change the ID of an unchanged live element and cause unnecessary translation.
5. Translation reuse was indexed by region ID rather than an explicit linguistic input key.

## Reconciliation model

`reconcileRegions(previous, current)` deterministically classifies:

- `added`: no previous logical ID;
- `changed`: same logical ID with a different source key;
- `removed`: previous logical ID absent from current state;
- `unchanged`: same logical ID and source key.

The controller commits one authoritative current region set. The renderer removes absent or disconnected entries before creating/updating current surfaces. An asynchronous result is stored only by its request key and can render only if the current region requests that same key. Lifecycle generations prevent an old in-flight request from mutating a later OFF/ON generation.

## Identity and cache contracts

- Logical identity: live `HTMLElement` reference in a `WeakMap`, initialized from deterministic structural path.
- Source identity: normalized text plus source language.
- Translation identity: normalized text, source language, and target language.

The runtime cache is memory-only and scoped to the content-script/tab lifetime. It is not translation memory or user history. Equivalent linguistic content can be reused across logical regions and reader OFF/ON cycles; changed content cannot consume an old result.

## Visibility and mutation processing

Visibility requires a connected, non-extension-owned element, browser/CSS visibility, non-zero geometry, and viewport relevance. `checkVisibility()` is used when present, with a computed-style/geometry fallback.

Mutation records collect affected semantic roots. Child/text/visibility-attribute records are coalesced at 120 ms with a 500 ms maximum wait. A targeted pass drops active regions intersecting affected roots, reanalyzes those roots, and refreshes unaffected active regions. Shadow DOM presentation is outside the observed `body`, preventing recursive source discovery and observer loops.

Scroll uses geometry-only updates until a material viewport-distance threshold requires discovery. Resize schedules reposition plus analysis. `ResizeObserver` follows active source elements, and font loading triggers repositioning.

## Geometry safety

Surfaces are bounded to source rectangle height and viewport clipping. Compact rectangles use one-line ellipsis. Longer translation density causes limited font reduction with a 10 px floor. These are safety constraints, not a layout redesign; clipping remains preferable to covering neighboring content, and original view remains available.

## Provider lifecycle and security

The built-in Translator adapter implements `availability()` and reports `available`, `downloadable`, `downloading`, `ready`, `unavailable`, and `error`, including download progress. Rejected translator creation is retryable. The toolbar distinguishes browser translation, development fallback, and unavailable states.

`RemoteInterpretationProvider` sends only `InterpretationContext` to the service worker. The worker validates context bounds again and sends a versioned JSON request to a configured backend. HTTPS is mandatory outside localhost, credentials are omitted, responses are capped, and host permission is checked.

No API credential is stored in source, configuration, or build output. The extension stores only a public endpoint. The backend must own private provider credentials, authentication/abuse controls, rate limiting, and model selection. No backend was deployed as part of this task, so deterministic interpretation remains the visible fallback when configuration is absent.

## Representative validation

Public website automation was not used. A deterministic browser fixture models three categories without site-specific workarounds:

- Article/documentation: heading, long paragraph, delayed insertion, and scroll continuity.
- Ecommerce/subscription: plan and price replacement, conditional hide/show, offer removal, rapid changes, and button interaction.
- SPA: `history.pushState`, route subtree replacement, stale-route disposal, scrolling, and OFF/ON convergence.

## Verification log

- `npm run verify`: passed.
  - strict TypeScript check: passed;
  - Vitest: 10 files, 22 tests passed;
  - production esbuild bundle: passed;
  - manifest validation: Context Reader Overlay v0.2.0, MV3, passed.
- `npm run test:browser`: passed in the installed Chromium-based Edge with the unpacked extension.
- Browser assertions: delayed article insertion, plan/price replacement, hide/show restoration, removed-node disposal, rapid-mutation convergence, stale SPA route disposal, provider-mode visibility, original button interaction, scrolling, complete OFF cleanup, current-state-only re-enable, and exactly one active host.
- `git diff --check`: passed; output contained only the repository's existing Windows line-ending conversion notices.
- Static source-write audit: all content-script write sites are confined to `OverlayRenderer` and target its host or Shadow DOM descendants. No provider credential pattern was found outside generated/dependency directories.

## Known limitations

- Public production websites were not exercised in this environment.
- Complex transforms, vertical text, overlapping source rectangles, iframes, and page-owned closed Shadow DOM remain unsupported or approximate.
- Bounded long translations can be clipped.
- The production interpretation backend is a client/security contract only until an endpoint is deployed and explicitly permitted.
- There is no user-facing endpoint or host-permission settings flow.
- History API calls without a corresponding DOM mutation are detected only when `popstate`/hash events occur or later content changes.

## Next task

Deploy and configure one secure interpretation backend implementing the versioned contract, then run an end-to-end selection interpretation test against it.
