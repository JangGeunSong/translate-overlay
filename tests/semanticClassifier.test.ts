import { describe, expect, it } from "vitest";
import { classifySemanticFeatures, getTranslationPriority } from "../src/content/analysis/semanticClassifier";

const base = { tagName: "div", textLength: 80, interactive: false, inArticle: false, inMain: false,
  inNavigation: false, inAside: false, inFooter: false, auxiliaryHint: false,
  linkDensity: 0, width: 400, height: 50 };

describe("semantic content classification", () => {
  it("classifies reading, controls, and secondary content deterministically", () => {
    expect(classifySemanticFeatures({ ...base, tagName: "p", inMain: true })).toBe("READING");
    expect(classifySemanticFeatures({ ...base, tagName: "button", interactive: true, textLength: 12 })).toBe("UI");
    expect(classifySemanticFeatures({ ...base, inAside: true })).toBe("AUXILIARY");
    expect(classifySemanticFeatures({ ...base, tagName: "h1", textLength: 10 })).toBe("READING");
  });

  it("prioritizes viewport reading content before UI, near, and far work", () => {
    expect(getTranslationPriority("READING", "VIEWPORT")).toBeLessThan(getTranslationPriority("UI", "VIEWPORT"));
    expect(getTranslationPriority("UI", "VIEWPORT")).toBeLessThan(getTranslationPriority("READING", "NEAR"));
    expect(getTranslationPriority("READING", "NEAR")).toBeLessThan(getTranslationPriority("READING", "FAR"));
  });
});
