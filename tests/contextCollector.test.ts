// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { collectInterpretationContext } from "../src/content/analysis/contextCollector";

describe("context collection", () => {
  beforeEach(() => {
    document.title = "Regulation news";
    document.body.innerHTML = `
      <main>
        <h2>Policy update</h2>
        <p>Earlier discussions were optimistic.</p>
        <p id="target">The proposal was eventually shelved due to mounting regulatory pressure. Investors reacted cautiously.</p>
        <p>Officials will revisit the matter next year.</p>
      </main>`;
  });

  it("builds bounded structured context around a selection", () => {
    const text = document.querySelector("#target")!.firstChild!;
    const source = text.nodeValue!;
    const start = source.indexOf("shelved");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + "shelved".length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const context = collectInterpretationContext(selection)!;
    expect(context).toMatchObject({
      selectedText: "shelved",
      sentence: "The proposal was eventually shelved due to mounting regulatory pressure.",
      previousParagraph: "Earlier discussions were optimistic.",
      nextParagraph: "Officials will revisit the matter next year.",
      nearestHeading: "Policy update",
      pageTitle: "Regulation news",
      sourceLanguage: "en",
      targetLanguage: "ko",
    });
    expect(JSON.stringify(context).length).toBeLessThan(3_500);
  });

  it.each([
    ["previousParagraph", "#target", "previous"],
    ["nextParagraph", "#target + p", "next"],
    ["nearestHeading", "h2", "heading"],
    ["nearestHeading", "h2", "nested heading"],
  ] as const)("omits normalized-empty %s (%s, %s)", (field, selector, kind) => {
    const target = document.querySelector("#target")!;
    const emptyElement = kind === "previous"
      ? target.previousElementSibling!
      : document.querySelector(selector)!;
    emptyElement.textContent = " \n\t\u00a0 ";
    if (kind === "nested heading") {
      const wrapper = document.createElement("section");
      emptyElement.replaceWith(wrapper);
      wrapper.append(emptyElement);
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const context = collectInterpretationContext(selection)!;
    expect(context).not.toBeNull();
    expect(context[field]).toBeUndefined();
    expect(JSON.parse(JSON.stringify(context))).not.toHaveProperty(field);
  });

  it("never treats extension-owned selection as page context", () => {
    document.body.innerHTML = '<div data-context-reader-root><span id="owned">extension text</span></div>';
    const text = document.querySelector("#owned")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(collectInterpretationContext(selection)).toBeNull();
  });
});
