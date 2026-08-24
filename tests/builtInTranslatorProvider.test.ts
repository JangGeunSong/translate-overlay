// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuiltInTranslatorProvider } from "../src/content/providers/builtInTranslatorProvider";

describe("Chrome built-in Translator capability lifecycle", () => {
  afterEach(() => {
    delete window.Translator;
    vi.restoreAllMocks();
  });

  it("reports downloadable, download progress, and ready states", async () => {
    window.Translator = {
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: vi.fn().mockImplementation(async (options) => {
        const monitor = new EventTarget();
        options.monitor?.(monitor);
        monitor.dispatchEvent(Object.assign(new Event("downloadprogress"), { loaded: 0.5 }));
        return { translate: vi.fn().mockResolvedValue("번역 결과") };
      }),
    };
    const provider = new BuiltInTranslatorProvider();
    const states: string[] = [];
    provider.subscribeStatus((status) => states.push(`${status.state}:${status.progress ?? ""}`));
    const results = await provider.translate([{
      regionId: "region",
      requestKey: "request",
      text: "Source",
      sourceLanguage: "en",
      targetLanguage: "ko",
    }]);
    expect(results[0]).toMatchObject({ requestKey: "request", translatedText: "번역 결과" });
    expect(states).toEqual(["downloadable:", "downloading:50", "ready:"]);
  });

  it("reports unsupported language pairs", async () => {
    window.Translator = {
      availability: vi.fn().mockResolvedValue("unavailable"),
      create: vi.fn(),
    };
    const provider = new BuiltInTranslatorProvider();
    const states: string[] = [];
    provider.subscribeStatus((status) => states.push(status.state));
    await expect(provider.translate([{
      regionId: "region",
      requestKey: "request",
      text: "Source",
      sourceLanguage: "en",
      targetLanguage: "ko",
    }])).rejects.toThrow("unavailable");
    expect(states).toContain("unavailable");
  });
});
