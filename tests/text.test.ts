// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  createRegionId,
  detectSourceLanguage,
  isLikelyReadableText,
  normalizeText,
} from "../src/content/analysis/text";

describe("text analysis", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("normalizes and filters readable text", () => {
    expect(normalizeText("  Hello\n world  ")).toBe("Hello world");
    expect(isLikelyReadableText("Hello world")).toBe(true);
    expect(isLikelyReadableText("---")).toBe(false);
  });

  it.each([
    ["An English sentence", "en"],
    ["これは日本語です", "ja"],
    ["这是中文句子", "zh"],
    ["12345", "unknown"],
  ] as const)("detects %s as %s", (text, language) => {
    expect(detectSourceLanguage(text)).toBe(language);
  });

  it("creates stable, path-sensitive region identities", () => {
    document.body.innerHTML = "<main><p>Hello world</p><p>Hello world</p></main>";
    const [first, second] = [...document.querySelectorAll("p")];
    expect(createRegionId(first!, "Hello world")).toBe(createRegionId(first!, "Hello world"));
    expect(createRegionId(first!, "Hello world")).not.toBe(createRegionId(second!, "Hello world"));
    expect(createRegionId(first!, "Changed")).not.toBe(createRegionId(first!, "Hello world"));
  });
});
