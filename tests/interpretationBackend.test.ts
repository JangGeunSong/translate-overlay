import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestRemoteInterpretation } from "../src/background/interpretationBackend";
import type { InterpretationContext } from "../src/content/types";

const context: InterpretationContext = {
  selectedText: "shelved",
  sentence: "The proposal was shelved.",
  paragraph: "The proposal was shelved.",
  pageTitle: "News",
  sourceLanguage: "en",
  targetLanguage: "ko",
};

describe("production interpretation backend boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when no endpoint is configured", async () => {
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
    expect(await requestRemoteInterpretation(context)).toEqual({
      ok: false,
      error: "No production interpretation endpoint is configured.",
    });
  });

  it("sends only structured bounded context and caps the response", async () => {
    const get = vi.fn().mockResolvedValue({ interpretationProvider: { endpoint: "https://reader.example.test/interpret" } });
    const contains = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("chrome", { storage: { local: { get } }, permissions: { contains } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ explanation: "설명".repeat(1_000) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestRemoteInterpretation(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.explanation.length).toBe(1_200);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({
      version: 1,
      operation: "interpret",
      context,
      response: { language: "ko", maximumCharacters: 1_200 },
    });
    expect(fetchMock.mock.calls[0]![1].credentials).toBe("omit");
    expect(contains).toHaveBeenCalledWith({ origins: ["https://reader.example.test/*"] });
  });
});
