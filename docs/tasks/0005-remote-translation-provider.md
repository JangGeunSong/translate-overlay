# Task 0005 — Phase 5A remote translation provider

## Baseline and scope

Phase 4 retained the shared `LinguisticProvider` contract but general translation still depended on Chrome's built-in Translator API. Phase 5A preserves the browser provider, scheduler, rendering, cache, and source-DOM read-only invariant while adding a remote fallback. Production deployment, keys in the extension, endpoint UI, and scheduler redesign remain out of scope.

## Provider path

The translation chain is now:

1. `BuiltInTranslatorProvider`;
2. `RemoteTranslationProvider` through the extension service worker;
3. the existing unavailable result when neither real provider succeeds.

Remote errors are thrown only at the provider boundary and are contained by `ProviderChain`. There is no sticky circuit state: the next translation call retries remote, which permits recovery after a transient failure. Provider-specific behavior does not enter analysis, scheduling, caching, or rendering. `DemoProvider` is retained for deterministic development and tests, but `createRuntimeProviderChain` excludes it by default. A local development build must explicitly set `CONTEXT_READER_DEMO=true` to append it to the shared runtime chain.

## Version 1 translation contract

The service worker reads the public endpoint from `chrome.storage.local.translationProvider.endpoint`. Non-local HTTP is rejected; exact host permission is required; cookies are omitted; timeout is 15 seconds.

`POST /translate` accepts:

```json
{
  "version": 1,
  "operation": "translate",
  "requests": [{
    "requestKey": "stable-linguistic-key",
    "text": "Hello world",
    "sourceLanguage": "en",
    "targetLanguage": "ko"
  }],
  "response": { "maximumCharactersPerTranslation": 8000 }
}
```

Batches contain one to three requests. Source text is capped at 4,000 characters, request keys at 200, and language identifiers at 35. Keys must be unique. Success returns version 1, the fixed output bound, and exactly one `{ requestKey, translatedText }` entry for every input. Output is non-empty and capped at 8,000 characters. `regionId` stays inside the extension and is restored by the service worker after validating response identities.

## Backend and deterministic validation

The existing Node backend now routes `POST /translate` through the same body-size, CORS, rate-limit, timeout, no-store, and normalized-error boundary used by interpretation. The server-side OpenAI adapter supports both linguistic operations; credentials remain server-only. The local mock produces deterministic `[targetLanguage] source text` output and remains forbidden under production mode.

Tests cover client request shaping, identity restoration, missing configuration, HTTP failure, malformed output, built-in-unavailable remote fallback, provider failure containment, next-call recovery, default exclusion and explicit opt-in of deterministic demo translation, authoritative unavailable status with demo mode disabled, backend contract limits, and local HTTP success/failure/recovery. Existing DOM invariant tests remain unchanged because the new path returns ordinary `TranslationResult` values to the established renderer.

## Known limitations

- No public backend was deployed or called in this task.
- Endpoint configuration remains service-worker-console based and requires manifest host permission.
- Translation requests are independent backend calls under the current scheduler; cross-region linguistic batching is not introduced.
- Quality, cost, provider quotas, durable rate limiting, and production observability require deployment-specific validation.
