// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isElementVisible } from "../src/content/analysis/text";

describe("visibility lifecycle", () => {
  beforeEach(() => {
    document.body.innerHTML = '<p id="source">Visible readable content</p>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 10, top: 10, left: 10, right: 310, bottom: 50, width: 300, height: 40,
      toJSON: () => ({}),
    } as DOMRect);
  });

  it("rejects hidden, extension-owned, and disconnected elements", () => {
    const source = document.querySelector("#source")!;
    expect(isElementVisible(source)).toBe(true);
    source.setAttribute("hidden", "");
    expect(isElementVisible(source)).toBe(false);
    source.removeAttribute("hidden");
    source.setAttribute("data-context-reader-root", "");
    expect(isElementVisible(source)).toBe(false);
    source.removeAttribute("data-context-reader-root");
    source.remove();
    expect(isElementVisible(source)).toBe(false);
  });
});
