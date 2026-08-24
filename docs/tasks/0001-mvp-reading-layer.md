# Task 0001 — MVP reading layer

Status: complete

## Goal

Deliver a usable vertical slice: action-controlled reader state, visible English/Japanese/Chinese text discovery, Korean translation surfaces, original-text access, selected-text contextual interpretation, basic dynamic-page lifecycle, and invariant-focused tests.

## Constraints

- Never mutate original content for translation.
- Avoid full-page chat, settings, accounts, OCR, media handling, and unrelated platform work.
- Keep translation/interpretation providers replaceable.
- Bound discovery, context, and translation work.

## Implementation plan

1. Establish MV3 TypeScript build and repository documentation.
2. Implement deterministic page analysis and context collection.
3. Implement provider abstraction with built-in-browser and deterministic fallback providers.
4. Render and reposition translations in an isolated passive overlay.
5. Add ON/OFF lifecycle, dynamic rescans, and contextual selection UI.
6. Verify deterministic behavior and the DOM non-mutation contract.

## Verification log

- `npm run check`: passed (strict TypeScript, no emit).
- `npm test`: passed, 5 files / 13 tests.
- `npm run build`: passed; produced MV3 assets in `dist/`.
- `npm run test:browser`: passed in installed Chromium-based Edge using the unpacked `dist/` extension and local fixture.
- Browser assertions: one isolated host on enable, translated surface and text present inside closed Shadow DOM, source subtree unchanged, original button functional, host retained after scroll, zero host after disable, one host after re-enable.
- Static write audit: all `innerHTML`, `textContent`, style, and append operations in content code target the extension host or descendants created by `OverlayRenderer`; source-region elements are read only.

## Known limitations / remaining work

- General translation currently depends on Chrome's built-in Translator API; the deterministic fallback covers only demo phrases.
- Context interpretation proves the structured request and popover flow but needs a production linguistic provider for open-ended explanations.
- Complex geometry, iframes, page Shadow DOM, contenteditable/form text, and broad production-site compatibility remain unverified.
- There is no language/settings UI; Korean is a constant at orchestration level, while request/provider types remain target-language-neutral.
- Translation-model download and progress UX are not implemented.

## Delivered files

- MV3 manifest, esbuild/TypeScript/Vitest configuration, and unpacked-extension build.
- Background per-tab state orchestration.
- Page analyzer, language heuristic, stable identity, and context collector.
- Built-in and deterministic linguistic providers behind a shared contract.
- Closed-Shadow-DOM renderer and reader lifecycle controller.
- Unit/integration suite, local browser fixture, and automated browser smoke harness.

## Next task

Implement a production contextual interpretation provider plus built-in translation availability/download states, followed by focused geometry QA on three representative production page types.
