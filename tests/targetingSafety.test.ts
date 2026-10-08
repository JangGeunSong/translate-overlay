// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageAnalyzer } from "../src/content/analysis/pageAnalyzer";
import { ReaderController } from "../src/content/readerController";
import type { TranslationResult } from "../src/content/types";

const fixture = `
  <main>
    <h1>Travel camera 2026 with 2 lenses</h1>
    <p>Use 2 batteries for up to 12 hours.</p>
    <button>Add to cart</button><button>Select blue</button>
    <p id="mixed"><span id="label">Price</span> <span>USD 129</span></p>
    <p>SKU AB12</p><p>数量 2</p><p>Order number AB123</p>
    <p><span>Quantity</span> <span>2</span></p>
    <p><span>SKU</span> <span>ZX12</span></p>
    <p><span>Order number</span> <span>ALPHACODE</span></p>
    <p>Price: <b>129 EUR</b></p>
    <p>Price: USD 129 Quantity: 2</p>
    <p><span>Search products</span><input value="private search" /></p>
    <p><span>Choose size</span><select><option>Private option</option></select></p>
    <p><span>Notes</span><textarea>Private textarea</textarea></p>
    <div contenteditable="true"><p>Private draft</p><div><b>Inherited draft</b></div>
      <p contenteditable="false">Read only help</p></div>
    <p contenteditable="plaintext-only">Plain draft</p>
    <p role="textbox">Custom draft</p>
    <p><span>Shipping note</span><span contenteditable="">Mixed draft</span></p>
    <p id="reused">Current delivery information</p>
  </main>`;
const positives = ["Travel camera 2026 with 2 lenses", "Use 2 batteries for up to 12 hours.",
  "Add to cart", "Select blue", "Price", "Quantity", "SKU", "Order number", "Search products", "Choose size", "Notes", "Shipping note", "Read only help"];
const forbidden = /USD|129|AB12|AB123|ZX12|ALPHACODE|数量|draft|private/i;

describe("transaction and editable targeting", () => {
  let controller: ReaderController | undefined;
  let shadow: ShadowRoot;
  let requests: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = fixture;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, top: 20, left: 10, right: 410, bottom: 60, width: 400, height: 40,
      toJSON: () => ({}),
    } as DOMRect);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const attach = HTMLElement.prototype.attachShadow;
    vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (this: HTMLElement, init) {
      shadow = attach.call(this, init); return shadow;
    });
    requests = [];
  });
  afterEach(() => {
    controller?.setEnabled(false);
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  });
  function start() {
    controller = new ReaderController(new PageAnalyzer(), {
      name: "fake", mode: "unavailable",
      async translate(batch) {
        requests.push(...batch.map(request => request.text));
        return batch.map(request => ({ ...request, translatedText: `KO ${request.text}`, provider: "fake" }));
      },
      async interpret() { return { explanation: "unused", provider: "fake" }; },
    });
    controller.setEnabled(true);
  }
  const surfaces = () => [...shadow.querySelectorAll<HTMLElement>(".translation-surface")].map(el => el.dataset.sourceText!);

  it("never requests protected content or creates its surfaces, while keeping independent labels", async () => {
    const before = document.body.innerHTML;
    start();
    await vi.advanceTimersByTimeAsync(200);
    expect(requests.filter(text => forbidden.test(text))).toEqual([]);
    expect(surfaces().filter(text => forbidden.test(text))).toEqual([]);
    expect(requests.sort()).toEqual([...positives, "Current delivery information"].sort());
    expect(surfaces().sort()).toEqual([...positives, "Current delivery information"].sort());
    expect(document.body.innerHTML).toBe(before);
  });

  it("uses the same protection in viewport seeds, TreeWalker and targeted refresh", () => {
    const analyzer = new PageAnalyzer();
    const walked = analyzer.analyze({ maxRegions: 80 });
    const hits = [...document.querySelectorAll("p, h1, button")];
    let hit = 0;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hits[hit++ % hits.length] });
    const seeded = analyzer.analyze({ maxRegions: 80 });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    expect(seeded.map(r => r.text).sort()).toEqual(walked.map(r => r.text).sort());
    expect(seeded.map(r => r.text).filter(text => forbidden.test(text))).toEqual([]);
    expect(seeded.map(r => r.text)).toEqual(expect.arrayContaining(positives));
    for (const region of seeded) expect(analyzer.refresh(region)?.text).toBe(region.text);
    expect(seeded.some(r => r.element.id === "mixed")).toBe(false);
  });

  it.each(["USD 299", "数量 3", "Order number NEW123"])("removes reused surfaces before debounced discovery for %s", async value => {
    start();
    await vi.advanceTimersByTimeAsync(200);
    const reused = document.getElementById("reused")!;
    expect(surfaces()).toContain(reused.textContent);
    reused.textContent = value;
    await vi.advanceTimersByTimeAsync(1);
    expect(surfaces()).not.toContain("Current delivery information");
    await vi.advanceTimersByTimeAsync(200);
    expect(requests).not.toContain(value);
    expect(surfaces()).not.toContain(value);
    reused.textContent = "Updated delivery information";
    await vi.advanceTimersByTimeAsync(200);
    expect(surfaces()).toContain("Updated delivery information");
  });

  it.each([["contenteditable", "true"], ["contenteditable", "plaintext-only"], ["role", "textbox"],
    ["role", "searchbox"], ["role", "combobox"], ["role", "spinbutton"]])(
    "rechecks attribute-only %s=%s changes and restores eligibility", async (attribute, value) => {
      start();
      await vi.advanceTimersByTimeAsync(200);
      const reused = document.getElementById("reused")!;
      reused.setAttribute(attribute!, value!);
      await vi.advanceTimersByTimeAsync(1);
      expect(surfaces()).not.toContain("Current delivery information");
      reused.textContent = "New private draft";
      await vi.advanceTimersByTimeAsync(200);
      expect(requests).not.toContain("New private draft");
      reused.textContent = "New read only help";
      reused.removeAttribute(attribute!);
      await vi.advanceTimersByTimeAsync(200);
      expect(surfaces()).toContain("New read only help");
    },
  );

  it("drops a mixed ancestor surface and refreshes only its independent label", async () => {
    start();
    await vi.advanceTimersByTimeAsync(200);
    const reused = document.getElementById("reused")!;
    reused.innerHTML = '<span>Delivery <b>fee</b></span><span>USD 15</span><span contenteditable="">Private notes</span>';
    await vi.advanceTimersByTimeAsync(1);
    expect(surfaces()).not.toContain("Current delivery information");
    await vi.advanceTimersByTimeAsync(200);
    expect(surfaces()).toContain("Delivery fee");
    expect(surfaces()).not.toContain("fee");
    expect(requests.filter(text => /USD 15|Private notes/.test(text))).toEqual([]);
    reused.setAttribute("contenteditable", "true");
    await vi.advanceTimersByTimeAsync(200);
    expect(surfaces()).not.toContain("Delivery fee");
    reused.firstElementChild!.setAttribute("contenteditable", "false");
    await vi.advanceTimersByTimeAsync(200);
    expect(surfaces()).toContain("Delivery fee");
  });

  it("does not resurrect a protected region when its earlier request finishes", async () => {
    document.body.innerHTML = '<p id="pending">Previously readable information</p>';
    let finish!: () => void;
    controller = new ReaderController(new PageAnalyzer(), {
      name: "pending", mode: "unavailable",
      translate: batch => new Promise<TranslationResult[]>(resolve => {
        requests.push(...batch.map(request => request.text));
        finish = () => resolve(batch.map(request => ({ ...request, translatedText: "Old response", provider: "fake" })));
      }),
      async interpret() { return { explanation: "unused", provider: "fake" }; },
    });
    controller.setEnabled(true);
    await vi.advanceTimersByTimeAsync(1);
    document.getElementById("pending")!.setAttribute("contenteditable", "true");
    await vi.advanceTimersByTimeAsync(1);
    finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(surfaces()).toEqual([]);
    expect(requests).toEqual(["Previously readable information"]);
  });
});
