// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageAnalyzer } from "../src/content/analysis/pageAnalyzer";

describe("PageAnalyzer", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main><h1>Welcome to the example</h1><p id="visible">This is a readable website paragraph.</p></main>
      <script>Hidden script words</script><div hidden>Hidden English content</div>
      <div data-context-reader-root>Extension-owned English translation</div>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 10, top: 10, left: 10, right: 410, bottom: 70, width: 400, height: 60,
      toJSON: () => ({}),
    } as DOMRect);
  });

  it("discovers bounded page blocks and excludes owned or irrelevant DOM", () => {
    const regions = new PageAnalyzer().analyze({ maxRegions: 10 });
    expect(regions.map((region) => region.text)).toContain("This is a readable website paragraph.");
    expect(regions.every((region) => !region.text.includes("script"))).toBe(true);
    expect(regions.every((region) => !region.text.includes("Extension-owned"))).toBe(true);
    expect(regions.length).toBeLessThanOrEqual(10);
  });

  it("keeps logical identity for a live element while invalidating changed source text", () => {
    const analyzer = new PageAnalyzer();
    const element = document.querySelector("#visible")!;
    const before = analyzer.analyze().find((region) => region.element === element)!;
    element.parentElement!.insertBefore(document.createElement("p"), element);
    const afterMove = analyzer.analyze().find((region) => region.element === element)!;
    expect(afterMove.id).toBe(before.id);
    expect(afterMove.sourceKey).toBe(before.sourceKey);
    element.textContent = "This readable website paragraph changed.";
    const afterText = analyzer.analyze().find((region) => region.element === element)!;
    expect(afterText.id).toBe(before.id);
    expect(afterText.sourceKey).not.toBe(before.sourceKey);
  });

  it("prevents viewport controls from exhausting the bounded semantic budget", () => {
    document.body.innerHTML = `<main>${Array.from({ length: 12 }, (_, index) => `<button>Menu option ${index}</button>`).join("")}${
      Array.from({ length: 8 }, (_, index) => `<p>Substantive documentation paragraph number ${index} with enough readable context.</p>`).join("")}</main>`;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.tagName === "BUTTON" ? 20 : innerHeight + 40;
      return { x: 10, y: top, top, left: 10, right: 410, bottom: top + 50, width: 400, height: 50,
        toJSON: () => ({}) } as DOMRect;
    });
    const regions = new PageAnalyzer().analyze({ maxRegions: 10 });
    expect(regions.filter((region) => region.semanticClass === "UI")).toHaveLength(3);
    expect(regions.filter((region) => region.semanticClass === "READING")).toHaveLength(7);
  });
});
