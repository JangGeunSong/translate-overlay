// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TranslationCache, translationKeyForRegion } from "../src/content/analysis/translationCache";
import type { TextRegion } from "../src/content/types";

function region(id: string, text: string): TextRegion {
  const element = document.createElement("p");
  return { id, sourceKey: text, element, text, language: "en", rect: element.getBoundingClientRect() };
}

describe("translation cache", () => {
  it("reuses normalized linguistic content across logical regions", () => {
    const cache = new TranslationCache();
    const first = region("first", "Welcome reader");
    const second = region("second", "Welcome reader");
    const requestKey = translationKeyForRegion(first, "ko");
    cache.set({ regionId: first.id, requestKey, translatedText: "독자 여러분 환영합니다", provider: "test" });
    expect(cache.get(second, "ko")).toMatchObject({
      regionId: "second",
      requestKey,
      translatedText: "독자 여러분 환영합니다",
    });
    expect(cache.get(region("third", "Changed source"), "ko")).toBeUndefined();
  });
});
