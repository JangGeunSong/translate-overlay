import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoProvider } from "../src/content/providers/demoProvider";
import { ProviderChain } from "../src/content/providers/provider";
import { RemoteTranslationProvider } from "../src/content/providers/remoteTranslationProvider";
import { createRuntimeProviderChain } from "../src/content/providers/runtimeProviderChain";
import type { TranslationRequest } from "../src/content/types";

const request: TranslationRequest = {
  regionId: "region-1",
  requestKey: "request-1",
  text: "Welcome",
  sourceLanguage: "en",
  targetLanguage: "ko",
};

describe("remote translation fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses remote translation when the browser Translator API is absent", async () => {
    vi.stubGlobal("window", {});
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      provider: "production-remote",
      translations: [{ ...request, translatedText: "환영합니다", provider: "production-remote" }],
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const chain = createRuntimeProviderChain();

    const [result] = await chain.translate([request]);
    expect(result).toMatchObject({ requestKey: "request-1", translatedText: "환영합니다", provider: "production-remote" });
    expect(sendMessage).toHaveBeenCalledWith({ type: "TRANSLATE_REMOTE", requests: [request] });
  });

  it("contains a remote failure, uses an explicitly supplied demo fallback, and retries remote", async () => {
    vi.stubGlobal("window", {});
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "temporary outage" })
      .mockResolvedValueOnce({
        ok: true,
        provider: "production-remote",
        translations: [{ regionId: "region-1", requestKey: "request-1", translatedText: "원격 복구", provider: "production-remote" }],
      });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const chain = new ProviderChain([new RemoteTranslationProvider(), new DemoProvider()]);

    expect((await chain.translate([request]))[0]?.provider).toBe("deterministic-demo");
    expect((await chain.translate([request]))[0]).toMatchObject({ translatedText: "원격 복구", provider: "production-remote" });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not include deterministic demo translation by default", async () => {
    vi.stubGlobal("window", {});
    const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: "unavailable" });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const chain = createRuntimeProviderChain();

    expect(await chain.translate([request])).toEqual([]);
    expect(sendMessage).toHaveBeenCalledWith({ type: "TRANSLATE_REMOTE", requests: [request] });
  });

  it("emits the existing unavailable status when real translation providers fail", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: "unavailable" }) } });
    const chain = createRuntimeProviderChain();
    const statuses: string[] = [];
    chain.subscribeStatus((status) => statuses.push(`${status.capability}:${status.state}`));

    expect(await chain.translate([request])).toEqual([]);
    expect(statuses.at(-1)).toBe("translation:unavailable");
  });

  it("adds deterministic demo translation only when explicitly enabled", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: "unavailable" }) } });

    const [result] = await createRuntimeProviderChain(true).translate([request]);

    expect(result).toMatchObject({ requestKey: "request-1", provider: "deterministic-demo" });
  });
});
