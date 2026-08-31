import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestRemoteTranslation } from "../src/background/translationBackend";
import type { TranslationRequest } from "../src/content/types";

const requests: TranslationRequest[] = [{
  regionId: "region-1",
  requestKey: "request-1",
  text: "Hello world",
  sourceLanguage: "en",
  targetLanguage: "ko",
}];

describe("production translation backend boundary", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fails closed when no endpoint is configured", async () => {
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
    expect(await requestRemoteTranslation(requests)).toEqual({
      ok: false,
      error: "No production translation endpoint is configured.",
    });
  });

  it("sends the bounded versioned contract and restores local region identity", async () => {
    const get = vi.fn().mockResolvedValue({ translationProvider: { endpoint: "https://reader.example.test/translate" } });
    const contains = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("chrome", { storage: { local: { get } }, permissions: { contains } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        version: 1,
        translations: [{ requestKey: "request-1", translatedText: "안녕하세요" }],
        maximumCharactersPerTranslation: 8_000,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await requestRemoteTranslation(requests)).toEqual({
      ok: true,
      provider: "production-remote",
      translations: [{ regionId: "region-1", requestKey: "request-1", translatedText: "안녕하세요", provider: "production-remote" }],
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      version: 1,
      operation: "translate",
      requests: [{ requestKey: "request-1", text: "Hello world", sourceLanguage: "en", targetLanguage: "ko" }],
      response: { maximumCharactersPerTranslation: 8_000 },
    });
    expect(fetchMock.mock.calls[0]![1].credentials).toBe("omit");
    expect(contains).toHaveBeenCalledWith({ origins: ["https://reader.example.test/*"] });
  });

  it("normalizes HTTP and malformed-response failures", async () => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: vi.fn().mockResolvedValue({ translationProvider: { endpoint: "http://localhost:8787/translate" } }) } },
      permissions: { contains: vi.fn().mockResolvedValue(true) },
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({
        version: 1,
        translations: [{ requestKey: "wrong", translatedText: "잘못됨" }],
        maximumCharactersPerTranslation: 8_000,
      }) }));

    expect(await requestRemoteTranslation(requests)).toEqual({ ok: false, error: "Translation backend returned HTTP 503." });
    expect(await requestRemoteTranslation(requests)).toEqual({ ok: false, error: "Translation backend returned an invalid response." });
  });
});
