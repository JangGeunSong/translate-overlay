import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInterpretationHandler } from "./app.mjs";
import { readServerConfig } from "./config.mjs";
import { validateInterpretationEnvelope, validateTranslationEnvelope } from "./contract.mjs";
import { createMockInterpretationProvider } from "./providers/mockProvider.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponsesProvider.mjs";

const context = { selectedText: "shelved", sentence: "The proposal was eventually shelved.", paragraph: "The proposal was eventually shelved.",
  previousParagraph: "Earlier context.", nextParagraph: "Later context.", nearestHeading: "Policy",
  pageTitle: "Fixture", sourceLanguage: "en", targetLanguage: "ko" };
const envelope = { version: 1, operation: "interpret", context, response: { language: "ko", maximumCharacters: 1200 } };
const translationEnvelope = { version: 1, operation: "translate", requests: [
  { requestKey: "request-1", text: "Hello world", sourceLanguage: "en", targetLanguage: "ko" },
], response: { maximumCharactersPerTranslation: 8000 } };
const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))));

describe("production server configuration", () => {
  const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;

  it("accepts a complete production configuration and disables provider diagnostics", () => {
    expect(readServerConfig({
      NODE_ENV: "production",
      INTERPRETATION_PROVIDER: "openai",
      OPENAI_API_KEY: "server-only-key",
      ALLOWED_EXTENSION_ORIGINS: `${extensionOrigin},${extensionOrigin}`,
      PORT: "8080",
      PROVIDER_TIMEOUT_MS: "15000",
      RATE_LIMIT_PER_MINUTE: "60",
      OPENAI_MAX_RETRIES: "2",
      EXPOSE_PROVIDER_DIAGNOSTICS: "1",
    })).toMatchObject({
      port: 8080,
      providerMode: "openai",
      allowedOrigins: [extensionOrigin],
      timeoutMs: 15_000,
      rateLimitPerMinute: 60,
      exposeProviderDiagnostics: false,
      openAI: { apiKey: "server-only-key", maxRetries: 2 },
    });
  });

  it("rejects unsafe or ambiguous startup configuration", () => {
    const production = { NODE_ENV: "production", OPENAI_API_KEY: "key", ALLOWED_EXTENSION_ORIGINS: extensionOrigin };
    expect(() => readServerConfig({ ...production, INTERPRETATION_PROVIDER: "mock" })).toThrow(/mock/u);
    expect(() => readServerConfig({ ...production, INTERPRETATION_PROVIDER: "unknown" })).toThrow(/INTERPRETATION_PROVIDER/u);
    expect(() => readServerConfig({ ...production, ALLOWED_EXTENSION_ORIGINS: "" })).toThrow(/ALLOWED_EXTENSION_ORIGINS/u);
    expect(() => readServerConfig({ ...production, ALLOWED_EXTENSION_ORIGINS: "https://reader.example.test" })).toThrow(/chrome-extension/u);
    expect(() => readServerConfig({ ...production, OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/u);
    expect(() => readServerConfig({ ...production, RATE_LIMIT_PER_MINUTE: "0" })).toThrow(/RATE_LIMIT_PER_MINUTE/u);
    expect(() => readServerConfig({ ...production, PROVIDER_TIMEOUT_MS: "NaN" })).toThrow(/PROVIDER_TIMEOUT_MS/u);
  });
});

describe("interpretation backend", () => {
  it("accepts only the bounded versioned context contract", () => {
    expect(validateInterpretationEnvelope(envelope).ok).toBe(true);
    expect(validateInterpretationEnvelope({ ...envelope, version: 2 }).ok).toBe(false);
    expect(validateInterpretationEnvelope({ ...envelope, context: { ...context, selectedText: "x".repeat(301) } }).ok).toBe(false);
  });

  it("keeps credentials server-side and uses the Responses API contract", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ output_text: "문맥 설명" }) }));
    const provider = createOpenAIResponsesProvider({ apiKey: "server-test-secret", model: "test-model", fetchImpl });
    expect(await provider.interpret(context)).toBe("문맥 설명");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.authorization).toBe("Bearer server-test-secret");
    expect(JSON.parse(init.body)).toMatchObject({ model: "test-model", store: false, text: { verbosity: "low" } });
  });

  it("serves the full local HTTP contract and normalizes responses", async () => {
    const seen = [];
    const handler = createInterpretationHandler({ allowedOrigins: [], exposeProviderDiagnostics: true, provider: {
      name: "fixture", interpret: async (value) => { seen.push(value); return "  짧은 문맥 설명  "; } } });
    const server = createServer(handler); servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/interpret`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 1, explanation: "짧은 문맥 설명", provider: "fixture" });
    expect(seen).toEqual([context]);
  });

  it("exposes health and applies exact-origin CORS and rate limiting", async () => {
    const allowedOrigin = `chrome-extension://${"b".repeat(32)}`;
    const handler = createInterpretationHandler({
      allowedOrigins: [allowedOrigin],
      rateLimitPerMinute: 1,
      provider: { name: "fixture", interpret: async () => "explanation" },
    });
    const server = createServer(handler); servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, provider: "fixture" });

    const denied = await fetch(`${baseUrl}/interpret`, {
      method: "OPTIONS", headers: { origin: "chrome-extension://cccccccccccccccccccccccccccccccc" },
    });
    expect(denied.status).toBe(403);

    const post = () => fetch(`${baseUrl}/interpret`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: allowedOrigin },
      body: JSON.stringify(envelope),
    });
    const allowed = await post();
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect((await post()).status).toBe(429);
  });

  it("extracts nested output and rejects malformed, failed, incomplete, or empty provider responses", async () => {
    const successful = createOpenAIResponsesProvider({ apiKey: "test", maxRetries: 0, fetchImpl: vi.fn(async () => ({
      ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: "중첩 출력" }] }] }),
    })) });
    expect(await successful.interpret(context)).toBe("중첩 출력");
    for (const payload of [null, {}, { error: { code: "bad" } }, { status: "incomplete", output_text: "partial" }, { status: "completed", output_text: " " }]) {
      const provider = createOpenAIResponsesProvider({ apiKey: "test", maxRetries: 0, fetchImpl: vi.fn(async () => ({
        ok: true, json: async () => payload,
      })) });
      await expect(provider.interpret(context)).rejects.toThrow();
    }
  });

  it("retries one transient 5xx but does not retry a 4xx", async () => {
    const transientFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => "0" } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ output_text: "복구됨" }) });
    const transient = createOpenAIResponsesProvider({ apiKey: "test", maxRetries: 1, fetchImpl: transientFetch });
    expect(await transient.interpret(context)).toBe("복구됨");
    expect(transientFetch).toHaveBeenCalledTimes(2);

    const clientFetch = vi.fn(async () => ({ ok: false, status: 400, headers: { get: () => null } }));
    const clientError = createOpenAIResponsesProvider({ apiKey: "test", maxRetries: 1, fetchImpl: clientFetch });
    await expect(clientError.interpret(context)).rejects.toThrow("HTTP 400");
    expect(clientFetch).toHaveBeenCalledOnce();
  });

  it("normalizes provider timeout and caps overlong output without exposing raw errors", async () => {
    const handler = createInterpretationHandler({ allowedOrigins: [], timeoutMs: 10, provider: {
      name: "slow-secret-provider", interpret: (_value, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("raw provider credential detail")), { once: true });
      }),
    } });
    const server = createServer(handler); servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/interpret`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Interpretation provider failed." });

    const cappedHandler = createInterpretationHandler({ allowedOrigins: [], provider: {
      name: "capped", interpret: async () => "가".repeat(2_000),
    } });
    const cappedServer = createServer(cappedHandler); servers.push(cappedServer);
    await new Promise((resolve) => cappedServer.listen(0, "127.0.0.1", resolve));
    const cappedResponse = await fetch(`http://127.0.0.1:${cappedServer.address().port}/interpret`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope),
    });
    expect((await cappedResponse.json()).explanation).toHaveLength(1_200);
  });
});

describe("translation backend", () => {
  it("validates the bounded identity-preserving translation contract", () => {
    expect(validateTranslationEnvelope(translationEnvelope).ok).toBe(true);
    expect(validateTranslationEnvelope({ ...translationEnvelope, version: 2 }).ok).toBe(false);
    expect(validateTranslationEnvelope({ ...translationEnvelope, requests: [
      translationEnvelope.requests[0], translationEnvelope.requests[0],
    ] }).ok).toBe(false);
    expect(validateTranslationEnvelope({ ...translationEnvelope, requests: [{
      ...translationEnvelope.requests[0], text: "x".repeat(4_001),
    }] }).ok).toBe(false);
  });

  it("serves deterministic local translation success, failure, and recovery", async () => {
    let fail = false;
    const mock = createMockInterpretationProvider({ delayMs: 0 });
    const provider = {
      ...mock,
      async translate(request, options) {
        if (fail) throw new Error("temporary fixture failure");
        return mock.translate(request, options);
      },
    };
    const handler = createInterpretationHandler({ allowedOrigins: [], provider, logger: { error: vi.fn() } });
    const server = createServer(handler); servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/translate`;
    const post = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(translationEnvelope) });

    const success = await post();
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({
      version: 1,
      translations: [{ requestKey: "request-1", translatedText: "[ko] Hello world" }],
      maximumCharactersPerTranslation: 8_000,
    });
    fail = true;
    const failure = await post();
    expect(failure.status).toBe(502);
    expect(await failure.json()).toEqual({ error: "Translation provider failed." });
    fail = false;
    expect((await post()).status).toBe(200);
  });
});
