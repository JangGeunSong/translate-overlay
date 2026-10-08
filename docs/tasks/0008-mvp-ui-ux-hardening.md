# Task 0008 — Phase 5F MVP UI/UX Hardening

Status: Phase 5F-1/2/3 implemented; bounded Phase 5F-3 technical verification PASS on 2026-10-08. Overall Phase 5F release/manual acceptance remains open.

## Current bounded task: Phase 5F-3 — Adaptive rendering

- Preflight found the completed 5F-2 changes already uncommitted in the worktree. They were preserved; this task changes only renderer/layout helpers, rendering tests/fixture, browser oracle and product documentation. No dependencies, Factory settings, provider/protocol, classifier, controller, deployment or Phase 5E changes were added for 5F-3.
- Before-change browser reproduction used the original renderer with the new local fixture. All seven measured core surfaces violated at least one text-bound/overflow/no-ellipsis assertion. For example the padded body surface was 640×121 while the text envelope was approximately 555×74; navigation had scrollHeight 29 versus clientHeight 27 and used ellipsis. A nested partial surface extended to x=653 outside its inner ancestor's right edge near x=438. A separate surface intersected the exact `USD 299` protected rectangle. Gradient content also received the common translucent Canvas background. These are observed local browser failures, not claims about a live store. The final fixture also requires a linked UI-classified title to wrap onto multiple lines.
- Implementation: `overlay/surfaceLayout.ts` provides read-only text envelopes, source/viewport/ancestor clip checks, solid-background inference, sibling overlap and bounded hit-test guards. The renderer preserves fractional text bounds instead of covering full element padding/borders. Headings/body wrap; compact UI has no ellipsis. A maximum 20% font reduction (12 px floor unless the original is smaller) tries five sizes and requires complete glyph-line and scroll-extent fit. Unfittable translations remain original. Heading detection is local rendering metadata; semantic/provider/scheduler contracts stay unchanged. Original-view return remeasures layout.
- Positive browser gate: all seven predefined title/body/navigation/action/condition/compact/nested translations must be visible and complete, with no duplicate visible surface or clipped glyph line. Checks include inherited white-on-dark button contrast, text/source/ancestor containment and protected-price/quantity/SKU/input nonintersection. Five explicit safe-original cases cover tiny UI, an overlong compact translation, partial nested clip, gradient and overlapping price. Native wheel input suppresses/restores nested delivery text as its clip changes.
- Behavior oracle: identical OFF/ON coordinate pointer and keyboard journeys require navigation=1, action=2, input=3, change=2, submit=1, untrusted=0. Expected state is query `tea`, option `Red`, checkbox selected, query focus/selection `[0,3]`, and the matching form payload. Source markup and MutationObserver records remain unchanged. Existing transaction request exclusions, editable safety, stale-surface removal, fallback/failure recovery, interpretation and ten pending ON/OFF cycles remain in the full suite.
- Final verification: `npm.cmd run verify` PASS (138 tests / 18 files, TypeScript, build, MV3 manifest), followed by `npm.cmd run test:browser` PASS on Edge 154.0.4258.62 / extension 0.4.0, fresh profile/default zoom, requested 900×700 window and local fake backend. All seven rendering positives, five safe-original cases, wheel clipping/restoration and OFF/ON behavior assertions passed alongside 5F-1/2 regressions. `git diff --check` PASS. Supplementary `dist/adaptive-rendering.png` was inspected; generated output is not source documentation. PowerShell uses the `.cmd` npm launcher; no dependency reinstall, external API, credential or live site was needed.
- Safe-original limits: complex transforms/nonrectangular clips/paint containment/effects, unresolved backgrounds, text outside its source or ancestor clips, overlap and translations exceeding the bounded fit budget. Sibling checks and sampled hit testing are intentionally not a complete arbitrary occlusion/layout engine. Animated/pseudo-element/out-of-flow geometry, broad dynamic continuity and font/zoom variations still require site validation. This policy is not permission to omit required journey translations: all seven fixture core cases are mandatory.
- Manual gate: Taobao and the second store, article/community and broader SPA/documentation journeys were not run. Human-prepared accounts/environment and product acceptance remain required by the approved Human Boundary. Technical fixture PASS does not complete Phase 5F, authorize deployment or hand off completed operating controls to Phase 5E.

## Completed bounded task: Phase 5F-2 — Transaction and editable-content targeting safety

- Preflight: clean worktree at `089e885` (completed 5F-1). Reviewed repository instructions, overview, active packet, text/analyzer/classifier/renderer/controller paths and existing tests. No Factory, Phase 5E, deployment, dependency, provider or approval workflow changes.
- Reproduction: the new targeting integration fixture failed before implementation. The fake provider received `Price USD 129`, `SKU AB12`, `数量 2`, `Order number AB123`, `Price: 129 EUR`, and private/inherited/plain/custom/mixed editable drafts. Seed/TreeWalker output also differed (`Quantity 2` versus `Quantity`, and `SKU ZX12` versus `SKU`). This is deterministic local evidence, not a live shopping-site failure claim.
- Implementation: a fresh memoized eligibility reader is shared by seed, TreeWalker and refresh. Standalone currency/amount, quantity/unit, explicit identifier and recognizable composite data rows are excluded. Currency symbols/codes/words, ordinary/nonbreaking/narrow whitespace and full-width variants are covered. Numeric prose and product titles remain eligible. Existing native input exclusions remain; inherited/empty/true/plaintext-only editing and ARIA textbox/searchbox/combobox/spinbutton regions are excluded, with valid false islands and nested re-enabled editing tested.
- Mixed content: no whole-parent request or surface is allowed over protected descendants. Independent label elements remain eligible; nested label markup uses the safe enclosing label once. Inseparable mixed blocks remain original. Renderer, semantic classes, scheduler/cache and provider protocol are unchanged; no token replacement or general layout engine was added.
- Dynamics: observer attributes add only `contenteditable` and `role`. Mutation callbacks remove affected unsafe/changed surfaces and queued work before existing debounced rediscovery. New safety decisions are computed on refresh; price/quantity/identifier reuse, mixed insertion, inherited editing, attribute-only protection, restoration, and late provider completion are covered.
- Deterministic verification: `npm.cmd run verify` PASS, 126 tests across 17 files, including thirteen targeting integration tests plus transaction/positive-text tables and inline word-spacing coverage. TypeScript, build and MV3 manifest validation PASS. Existing native/remote fallback, context interpretation and sixteen 5F-1 lifecycle tests remain intact.
- Browser verification: `npm.cmd run test:browser` PASS on Edge 154.0.4258.62 / extension 0.4.0, fresh profile/default zoom, requested 900×700 window, native Translator disabled and loopback fake backend. Fifteen specified titles/descriptions/labels/actions have surfaces. Exact request/surface allowlists reject protected data; rectangle intersection checks at several scroll positions reject covering protected values/inputs/descendants. Source markup stays unchanged on activation. The identical OFF/ON journey expects search input 8, color change 1, quantity input 1, editable-note input 4, cart action 1, untrusted events 0; final state is `books`, `Red`, quantity `3`, note `gift`, price `USD 149`, cart `Quantity: 3`, focus on cart. Coordinate pointer/keyboard events drive actions, including one site-owned update that changes text, editing attributes, role and mixed descendants. OFF preserves user state. Existing failure/recovery, interpretation/close and ten pending ON/OFF cycles also pass. Visual QA screenshot is generated at `dist/targeting-safety.png`; generated output is not source documentation.
- `git diff --check` PASS. The `.cmd` npm launcher avoids the PowerShell npm.ps1 execution policy; no dependency reinstall or external credential/API was required.
- Policy limits: recognition is intentionally bounded, not every international currency/unit/identifier notation. Unknown custom editors without semantic/editable markup and arbitrary echoes of user input are not reliably inferable. Prose containing separate numeric descendants can conservatively remain original; ordinary numeric prose and all specified core labels remain translated. General clipping/overlapping layout and product-title typography are not claimed fixed.
- Remaining release gate: no unresolved reproduced 5F-2 targeting blocker in these fixtures. Taobao and a structurally different store's manual journeys were not run; broader rendering/clipping and product acceptance remain open. These are unverified gates, not newly inferred site failures or automatic follow-up implementation tasks. Manual product acceptance requires the human-prepared environment and judgment already specified below. Technical task PASS does not complete Phase 5F, Phase 5E or public release.

## Goal and baseline

복잡한 외국어 사이트에서도 overlay를 켠 채 검색 → 목록 탐색 → 상세 확인 → 옵션 선택 → 장바구니 → 주문 정보 확인 → 결제 직전까지 행동을 지속할 수 있는 MVP 수준에 도달한다. 실제 결제는 수행하지 않는다. 모든 사이트/100% coverage는 목표가 아니다.

Phase 1–5D의 기존 구현을 유지한다. AGENTS.md와 현재 source가 authoritative source다. Chrome MV3, source content DOM read-only, 단일 data-context-reader-root와 closed Shadow DOM, semantic classifier, viewport scheduler, cache, native/remote fallback, context interpretation을 재설계하지 않는다.

Phase 5E 운영 보호장치와 배포 준비는 별도 미완료 과제다. 과거 live E2E PASS는 현재 서비스 가동이나 5E 구현 완료를 의미하지 않는다.

## Phase scope and release criteria

우선순위: non-interference/reversibility → semantic targeting → adaptive rendering → dynamic continuity → release blocker에 필요한 visual polish.

원본 DOM/style/attribute와 framework state를 바꾸거나 source를 감싸거나 숨기지 않는다. passive overlay는 click-through이며 event forwarding을 도입하지 않는다. 가격·통화·수량·식별자·입력값은 정확하고 가려지지 않아야 한다. OFF는 extension 영향만 제거하며 현재 사용자 상태를 되돌리지 않는다.

핵심 상품 제목/옵션/action/조건은 번역 상태에서 읽고 구분 가능해야 한다. 안전한 텍스트 영역과 ancestor clip 안에서 표시하며 불확실한 영역은 원문으로 남긴다. 대부분의 핵심 번역을 숨겨 합격시키지 않는다. 이전 source/activation/selection의 UI는 남지 않아야 한다. 실패 중에도 원본 이용과 기존 해석 기능을 유지한다.

Taobao는 대표 stress test이며 전용 selector/patch를 만들지 않는다. OCR, 이미지 번역, 새 provider, 계정·결제 기능, 추가 제품 기능, 대규모 architecture, Factory/approval 변경은 제외한다. 해결되지 않은 release blocker만 후속 bounded task로 만든다. 비핵심 미관 차이는 출시 지연 사유가 아니다.

## Initial task: Phase 5F-1 — Non-interference and lifecycle baseline

1. 일반 fixture에서 좌표 기반 포인터와 keyboard로 링크/버튼, 검색 입력, checkbox, select, form validation/fixture 내부 submit을 검증한다. DOM .click()과 직접 값 할당만으로 PASS 처리하지 않는다.
2. markup 외에 value/checked/selected/focus/selection, 기대 이벤트 횟수와 사이트 상태를 비교한다. 동일한 OFF/ON 행동의 결과를 비교하며 사이트 자체 mutation은 허용한다.
3. interpretation의 activation generation과 request/selection identity를 검증하여 이전 회차/선택의 응답과 finally가 현재 UI·진단을 오염시키지 않게 한다.
4. selection callback을 추적/무효화하고 OFF, 선택 변경, source 제거/교체 뒤 오래된 action이 나타나지 않게 한다. 닫힌 explanation은 늦은 응답으로 재등장하지 않는다.
5. A/B 역순 응답, pending translation/interpretation 중 OFF→ON, source 교체/제거, 실패를 deterministic하게 재현한다. 기존 translation generation 보호는 유지한다.
6. 확인된 control pointer/focus 간섭만 최소 수정한다. 10회 ON/OFF 및 pending 종료 후 host/surface/popover 잔여와 중복 listener/observer/timer 작업이 없음을 검증한다. bounded tab cache는 허용한다.
7. docs/PROJECT_OVERVIEW.md와 이 packet에 실제 변경·검증·남은 blocker를 기록한다.

우선 파일: readerController.ts, overlay/overlayRenderer.ts, 관련 tests, scripts/browser-smoke.mjs, test-pages/. contextCollector.ts는 선택 유효성 결함 재현 시 최소 수정한다.

이 첫 task에서는 전면 targeting/adaptive rendering, scheduler/cache/provider 변경, 5E backend, live 배포/유료 검증을 수행하지 않는다.

## Initial task acceptance

- 실제 입력 결과와 이벤트 횟수가 OFF/ON에서 일치하고 source/사용자 상태가 보존된다.
- 현재 유효한 interpretation 요청만 표시되며 이전 응답/timer가 UI나 진단을 오염시키지 않는다.
- close/OFF 뒤 pending 응답으로 UI가 재등장하지 않는다.
- 10회 lifecycle과 pending 종료 후 OFF host 0개, ON 최대 1개, 잔여 presentation/중복 등록이 없다.
- native/remote fallback, failure/recovery, translation generation, context interpretation 회귀가 없다.
- `npm run verify && npm run test:browser`와 `git diff --check`가 실제 통과한다. 기본 검증은 외부 API/credential 없는 fake provider를 사용한다. browser 미실행은 PASS가 아니다.

## Remaining phase verification

후속 task는 위반 acceptance, 재현 fixture, 사용자 행동 영향, 최소 수정 범위, 검증 oracle이 있는 미해결 blocker만 처리한다. 거래 데이터/편집 영역 및 positive targeting, viewport seed/TreeWalker 일치, dense card/compact UI/선택 표시, ancestor clipping/nested scroll, DOM 재사용/SPA/옵션 변경을 일반 fixture로 검증한다.

Manual: Taobao와 다른 해외 쇼핑몰 1곳에서 검색 입력·제출 → 목록 scroll/필터/정렬 → 상세 조건 → 옵션/수량 → 장바구니 추가/변경/삭제 → 주문 정보 → 결제 실행 전 중단. 핵심 문구·거래 값·선택 상태·실제 행동을 확인한다. 중간 OFF/ON, 뒤로/앞으로, 문맥 해석을 포함한다. article/community 및 SPA/documentation도 회귀 확인한다.

브라우저/extension 버전, viewport/zoom, provider mode, 단계와 실패를 기록한다. 개인정보는 기록하지 않는다. 로그인/지역 제한으로 못 간 단계는 미검증이다. 실제 입력·계정 환경은 사람이 준비하며 주문 확정/결제를 자동화하지 않는다. live/유료 호출·배포는 별도 승인이 필요하다.

## Completion and handoff

첫 task PASS, 전체 repository PASS, manual acceptance, 운영 준비, 공개 승인을 분리한다. manual 판단/실행 승인만 남으면 HUMAN_REQUIRED로 완료한 기술 작업과 필요한 행동을 보고한다. UI/UX gate 충족 후 비핵심 polish를 중단하고 5E 운영 보호장치/배포 준비로 인계한다. 자동 phase 전환이나 5E 실행은 하지 않는다.

## Evidence log

- 2026-10-08: 실행 문서 준비. 제품 코드 변경 및 테스트/Factory/live journey 실행 없음.
- 2026-10-08 implementation: `readerController.ts`에 activation generation, request identity, source endpoint node/offset + bounded context identity를 추가했다. selectionchange와 source mutation에서 이전 action/popover를 무효화하며 늦은 success/failure/finally는 현재 UI/진단을 갱신하지 않는다. action timer를 추적/취소하고 활성화 이전 selection을 baseline으로 삼아 queued selectionchange가 이전 action을 재생성하지 않게 했다. close는 pending 요청을 무효화한다. 이미 전송한 provider 작업 자체는 취소하지 않으며 완료 결과를 무시한다.
- Renderer: selection action/close/original-view button의 mouse-down 기본 focus 이동만 차단한다. 실제 pointer로 입력값 `books`를 선택한 뒤 original-view toggle을 누르면 focus가 source input에서 벗어나는 실패를 browser assertion으로 재현했고 수정 후 PASS했다. passive event forwarding/source DOM 변경은 없다. `contextCollector.ts`, translation scheduler/cache, classifier/provider와 Factory/5E는 변경하지 않았다.
- Fixture/browser oracle: OFF와 ON에서 동일한 좌표 pointer + keyboard 행동을 실행한다. 기대 이벤트는 link 1, button 2, input 8, search change 1, checkbox change 1, select change 1, invalid 1, submit 1, untrusted 0이다. 최종 `books`, checked=true, price option, source input focus/selection `[0,5]`, fixture 내부 제출 payload와 site state를 확인했다. source markup과 MutationObserver 기록도 양쪽이 동일해 fixture 자신의 state mutation과 extension 변경을 구분한다. DOM `.click()`이나 값 직접 할당은 browser 행동 검증에 사용하지 않는다.
- Lifecycle evidence: 16개 controller test가 A/B 역순 success/failure, 동일 문자열의 다른 offset, OFF→ON, close, source edit/replacement/removal, callback 취소, 실패/회복을 검증한다. 기존 translation generation 보호를 사용하여 old activation 실패와 현재 source의 역순 완료를 검증한다. 10회 pending ON/OFF 후 timer 0, observer/subscription 해제, 중복 요청/재조정 없음과 host cleanup을 검증한다. 실제 MV3 browser에서도 pointer drag 선택/해석/close와 pending translation/interpretation을 포함한 10회 ON/OFF를 실행해 OFF host 0, ON host 1, 늦은 완료 후 surface/action/popover 재등장 없음, OFF 중 추가 backend 작업 없음을 확인했다.
- Authoritative verification: `npm.cmd run verify` → `npm.cmd run test:browser` PASS (67 tests / 16 files, TypeScript, build, MV3 manifest). `git diff --check` PASS. PowerShell의 npm.ps1 실행 정책 때문에 동일 npm script의 `.cmd` launcher를 사용했다. 의존성 변경/재설치 없음.
- Browser evidence: Edge 154.0.4258.62, extension 0.4.0, fresh profile/default zoom, requested window 900×700, browser Translator disabled, production-remote adapter → loopback deterministic mock. 기존 native/remote fallback unit tests, backend failure/recovery 및 local interpretation E2E도 PASS. 외부 API/credential/배포/유료 호출 없음.
- Manual acceptance: Taobao 및 두 번째 해외 쇼핑몰 journey 미실행. fixture PASS를 live journey/product acceptance로 간주하지 않는다.
- Remaining release gate: 재현된 5F-1 미해결 blocker는 없다. dense commerce의 거래/편집 데이터 targeting, 핵심 문구 가독성, ancestor clipping/nested scroll은 이 bounded task에서 개선하거나 합격 판정하지 않았다. 후속 구현은 실제 재현·위반 acceptance·행동 영향·최소 범위·oracle이 확인된 release blocker에만 한정한다. 전체 5F 완료/5E 인계 판단에는 승인된 manual journey와 사람의 제품 수용성 판단이 필요하며, 자동 후속 task나 비핵심 polish를 추가하지 않는다.


## Phase 5F-3 real-site essential-text regression fix

Medium manual diagnostics reported browser-translator results for 19 regions but 18 hidden surfaces: heading source-overflow, navigation overlapping-neighbour, button translation-overflow, and short Write/Sign in labels hidden without a reason. Footer outside the viewport is not a release defect.

The fix uses source content space (including link padding within its original hit target) and visible glyph ink instead of requiring all ink inside the element line-height. Horizontal ink outside the element must remain inside its containing block. Ancestor clipping, uncertain backgrounds, complex geometry, mixed controls, real neighbouring text/replaced elements and hit-test occlusion still guard the candidate. Empty overlapping container rectangles alone no longer reject text. Optional extra fitting space falls back to original ink bounds if unsafe.

Short UI is no longer suppressed solely by width <48px or height <16px. Full-translation fitting decides visibility. Compact controls below 48px may reduce by at most 25%, with a 10px floor; other text retains the 12px/80% policy. All hidden paths now record a reason, including offscreen/empty, source-hidden, original-view and disconnected. These normal lifecycle reasons are distinguished from safety rejection.

Completed retains its linguistic-result count. displayed/viewportDisplayed count actually visible surfaces, and viewportReady uses visible READING/UI coverage rather than cached reading output. Toolbar and host diagnostics separate results from presentation and refresh on reposition/original-view changes. First-reading timing also requires display.

Generic editorial header coverage adds large short-line-height text, overlapping empty wrappers, padded links, narrow short labels and a longer button translation. The browser oracle requires all seven editorial translations simultaneously visible, plus the seven existing core translations. It retains five intentional original cases (partial clip, gradient, unreadable tiny badge, protected-value occlusion, excessive expansion), actual pointer/keyboard/form state and source/closed-host/OFF checks.

Targeted unit/type checks passed. A Chrome rendering-only run using the actual production controller/renderer with a deterministic provider passed fourteen required translations, protected geometry, clipping and identical trusted OFF/ON interactions. scripts/rendering-regression.mjs makes this check repeatable after build; it does not establish MV3/provider E2E. Edge exited before its debug endpoint and Chrome did not load the unpacked extension worker in this environment. Full authoritative verification is recorded separately below; no Factory or 5F-4 logic is changed by this fix. Medium live recheck remains required and fixture success is not labelled live PASS.


### Final regression verification results

- Targeted surface/invariant tests: 19 PASS; targeted surface/lifecycle tests: 36 PASS.
- Final full TypeScript/unit validation: 146 tests / 18 files PASS. The single full verify invocation then hit a log-file lock because its log was mistakenly placed in dist, which build removes. The already-passing full tests were not repeated. Remaining build and manifest checks were completed successfully after moving logs outside dist.
- Repeatable rendering-only command: node scripts/rendering-regression.mjs, Chrome 154, PASS. Actual production controller/renderer, deterministic provider, fourteen required translations, seven editorial title/navigation/button translations simultaneously visible, protected geometry, retained safety exclusions and trusted OFF/ON pointer/keyboard/form/source state. No billable calls.
- Existing authoritative MV3 browser suite: FAIL before assertions, Edge exited with code 0 before opening DevTools. A separate Chrome MV3 attempt did not load the unpacked extension worker. This is an environment blocker, not an MV3 PASS and not proof of a product regression. No broad startup workaround or 5F-4 repair was added.
- git diff --check PASS. Existing committed targeting/adaptive/dynamic work was retained; Factory, provider chain and transaction classifier were not modified.
- Intentional hidden cases remain: outside viewport, original-view/disconnected/hidden source, actual overlapping price or control content, partial clipping, uncertain/complex background/geometry, unreadable tiny decorative badge and translations too long for safe bounds. If one of these affects essential text on a live site it remains an acceptance blocker, not an automatic waiver.
- No essential-text hiding remains in the generic regression fixture. Medium live recheck has not been performed; reload the built extension before checking the same title/menu/button and displayed diagnostics. Do not mark overall Phase 5F or beta release complete from these results.
