import { describe, expect, it } from "vitest";
import { DemoProvider } from "../src/content/providers/demoProvider";

describe("deterministic demo provider", () => {
  it("preserves request identities and returns Korean demo text", async () => {
    const provider = new DemoProvider();
    const [result] = await provider.translate([
      { regionId: "r1", text: "Welcome to this website", sourceLanguage: "en", targetLanguage: "ko" },
    ]);
    expect(result).toMatchObject({ regionId: "r1", provider: "deterministic-demo" });
    expect(result!.translatedText).toContain("환영합니다");
  });

  it("uses supplied sentence context for a known interpretation", async () => {
    const result = await new DemoProvider().interpret({
      selectedText: "shelved",
      sentence: "The proposal was shelved due to pressure.",
      paragraph: "The proposal was shelved due to pressure.",
      pageTitle: "News",
      sourceLanguage: "en",
      targetLanguage: "ko",
    });
    expect(result.explanation).toContain("당분간 추진하지 않기로");
  });
});
