// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayRenderer, overlayRootSelector } from "../src/content/overlay/overlayRenderer";

describe("non-destructive overlay invariant", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="source"><p><a href="#worked">Welcome reader</a></p><button>Continue</button></main>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, top: 20, left: 10, right: 310, bottom: 60, width: 300, height: 40,
      toJSON: () => ({}),
    } as DOMRect);
  });

  it("adds only its isolated host, leaves source markup intact, and cleans up", () => {
    const source = document.querySelector("#source") as HTMLElement;
    const paragraph = source.querySelector("p")!;
    const before = source.outerHTML;
    const renderer = new OverlayRenderer(() => undefined);
    renderer.reconcile(
      [{
        id: "r1", sourceKey: "source-1", element: paragraph, text: "Welcome reader", language: "en",
        semanticClass: "READING", viewportBand: "VIEWPORT", translationPriority: 0,
        rect: paragraph.getBoundingClientRect(),
      }],
      new Map([["r1", { regionId: "r1", requestKey: "request-1", translatedText: "독자 여러분 환영합니다", provider: "test" }]]),
    );

    expect(source.outerHTML).toBe(before);
    expect(document.querySelectorAll(overlayRootSelector)).toHaveLength(1);
    expect((document.querySelector(overlayRootSelector) as HTMLElement).style.pointerEvents).toBe("none");

    const handler = vi.fn();
    source.querySelector("button")!.addEventListener("click", handler);
    source.querySelector("button")!.click();
    expect(handler).toHaveBeenCalledOnce();

    renderer.dispose();
    expect(document.querySelectorAll(overlayRootSelector)).toHaveLength(0);
    expect(source.outerHTML).toBe(before);
  });

  it("does not duplicate surfaces when the same region is reconciled", () => {
    const paragraph = document.querySelector("p")!;
    const renderer = new OverlayRenderer(() => undefined);
    const region = { id: "stable", sourceKey: "stable-source", element: paragraph, text: "Welcome reader", language: "en" as const, semanticClass: "READING" as const, viewportBand: "VIEWPORT" as const, translationPriority: 0, rect: paragraph.getBoundingClientRect() };
    renderer.reconcile([region], new Map());
    renderer.reconcile([region], new Map());
    expect(document.querySelectorAll(overlayRootSelector)).toHaveLength(1);
    renderer.dispose();
  });

  it("bounds a long translation to the source rectangle", () => {
    const paragraph = document.querySelector("p")!;
    const renderer = new OverlayRenderer(() => undefined);
    const region = { id: "long", sourceKey: "long-source", element: paragraph, text: "Short source", language: "en" as const, semanticClass: "READING" as const, viewportBand: "VIEWPORT" as const, translationPriority: 0, rect: paragraph.getBoundingClientRect() };
    renderer.reconcile(
      [region],
      new Map([["long", {
        regionId: "long",
        requestKey: "long-request",
        translatedText: "매우 긴 번역문 ".repeat(60),
        provider: "test",
      }]]),
    );
    expect(renderer.getSurfaceDiagnostics()[0]).toMatchObject({
      height: "40px",
      maxHeight: "40px",
      hidden: false,
    });
    renderer.dispose();
  });

  it("preserves full UI translations but suppresses overlays too small to read safely", () => {
    const button = document.querySelector("button")!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, top: 20, left: 10, right: 50, bottom: 34, width: 40, height: 14,
      toJSON: () => ({}),
    } as DOMRect);
    const renderer = new OverlayRenderer(() => undefined);
    const translation = "계속 진행하기";
    renderer.reconcile([{
      id: "tiny-ui", sourceKey: "tiny-ui-source", element: button, text: "Go", language: "en",
      semanticClass: "UI", viewportBand: "VIEWPORT", translationPriority: 1, rect: button.getBoundingClientRect(),
    }], new Map([["tiny-ui", {
      regionId: "tiny-ui", requestKey: "tiny-ui-request", translatedText: translation, provider: "test",
    }]]));
    expect(renderer.getSurfaceDiagnostics()[0]).toMatchObject({ hidden: true, suppressed: true, semanticClass: "UI" });
    renderer.dispose();
  });
});
