// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageAnalyzer } from "../src/content/analysis/pageAnalyzer";
import { ReaderController } from "../src/content/readerController";
import type { InterpretationResult, TranslationRequest, TranslationResult } from "../src/content/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("reader selection and activation lifecycle", () => {
  let controller: ReaderController;
  let shadow: ShadowRoot;
  let interpretations: ReturnType<typeof deferred<InterpretationResult>>[];
  let translations: { pending: ReturnType<typeof deferred<TranslationResult[]>>; requests: TranslationRequest[] }[];
  let subscriptions: number;
  let observers: Set<object>;
  const rect = { x: 10, y: 20, top: 20, left: 10, right: 310, bottom: 60, width: 300, height: 40, toJSON: () => ({}) } as DOMRect;
  const flush = () => vi.advanceTimersByTimeAsync(1);
  function select(id = "a", start = 0, end = 5) {
    const range = document.createRange();
    range.setStart(document.getElementById(id)!.firstChild!, start);
    range.setEnd(document.getElementById(id)!.firstChild!, end);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }
  async function request(id = "a") {
    document.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    select(id);
    await flush();
    (shadow.querySelector(".selection-action") as HTMLButtonElement).click();
    return interpretations.at(-1)!;
  }
  function completeTranslations() {
    for (const { pending, requests } of translations) pending.resolve(requests.map((request) => ({
      regionId: request.regionId, requestKey: request.requestKey, translatedText: `translated ${request.text}`, provider: "fake",
    })));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><p id="a">Alpha source paragraph with readable context.</p><p id="b">Bravo source paragraph with different context.</p></main>';
    document.getSelection()?.removeAllRanges();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => rect });
    const attach = HTMLElement.prototype.attachShadow;
    vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (this: HTMLElement, init) {
      shadow = attach.call(this, init);
      return shadow;
    });
    observers = new Set();
    vi.stubGlobal("ResizeObserver", class {
      constructor() { observers.add(this); }
      observe() {} unobserve() {} disconnect() { observers.delete(this); }
    });
    interpretations = [];
    translations = [];
    subscriptions = 0;
    controller = new ReaderController(new PageAnalyzer(), {
      name: "deferred", mode: "unavailable",
      translate: (requests) => {
        const pending = deferred<TranslationResult[]>();
        translations.push({ pending, requests });
        return pending.promise;
      },
      interpret: () => {
        const pending = deferred<InterpretationResult>();
        interpretations.push(pending);
        return pending.promise;
      },
      subscribeStatus: () => { subscriptions++; return () => { subscriptions--; }; },
    });
    controller.setEnabled(true);
  });

  afterEach(() => {
    controller.setEnabled(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([false, true])("ignores late A success/failure (%s), including finally, after B completes", async (failA) => {
    const a = await request("a");
    const b = await request("b");
    b.resolve({ explanation: "Current B", provider: "fake" });
    await flush();
    const metrics = controller.getDiagnostics();
    const html = shadow.innerHTML;
    if (failA) a.reject(new Error("Old A"));
    else a.resolve({ explanation: "Old A", provider: "fake" });
    await flush();
    expect(shadow.innerHTML).toBe(html);
    expect(shadow.querySelector(".explanation")?.textContent).toContain("Current B");
    expect(controller.getDiagnostics()).toEqual(metrics);
    expect(metrics).toMatchObject({ interpretationRequestCount: 2, interpretationSuccessCount: 1, interpretationFailureCount: 0 });
  });

  it.each(["close", "collapse", "replace", "remove", "edit", "offset"])("invalidates pending interpretation on %s", async (action) => {
    const pending = await request();
    if (action === "close") (shadow.querySelector(".close") as HTMLButtonElement).click();
    if (action === "collapse") { document.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event("selectionchange")); }
    if (action === "replace") document.getElementById("a")!.outerHTML = '<p id="a">Alpha source paragraph with readable context.</p>';
    if (action === "remove") document.getElementById("a")!.remove();
    if (action === "edit") document.getElementById("a")!.firstChild!.textContent += " New context.";
    if (action === "offset") select("a", 6, 12);
    await flush();
    pending.resolve({ explanation: "Stale explanation", provider: "fake" });
    await flush();
    expect(shadow.querySelector(".explanation")).toBeNull();
    expect(controller.getDiagnostics()).toMatchObject({ interpretationSuccessCount: 0, interpretationFailureCount: 0, averageInterpretationLatencyMs: null });
  });

  it("tracks action timers across selection changes and OFF/ON", async () => {
    select("a");
    select("b");
    await flush();
    expect(shadow.querySelectorAll(".selection-action")).toHaveLength(1);
    (shadow.querySelector(".selection-action") as HTMLButtonElement).click();
    expect(shadow.querySelector(".context")?.textContent).toContain("Bravo");
    select("a");
    controller.setEnabled(false);
    controller.setEnabled(true);
    await flush();
    expect(shadow.querySelector(".selection-action")).toBeNull();
    expect(shadow.querySelector(".explanation")).toBeNull();
    expect(interpretations).toHaveLength(1);
  });

  it.each(["remove", "replace", "collapse"])("does not create a scheduled action after source/selection %s", async (action) => {
    select();
    if (action === "remove") document.getElementById("a")!.remove();
    if (action === "replace") document.getElementById("a")!.outerHTML = '<p id="a">Alpha source paragraph with readable context.</p>';
    if (action === "collapse") document.getSelection()!.removeAllRanges();
    await flush();
    expect(shadow.querySelector(".selection-action")).toBeNull();
    expect(interpretations).toHaveLength(0);
  });

  it("distinguishes identical selected text at different source offsets", async () => {
    document.getElementById("a")!.textContent = "Alpha Alpha words in the same sentence.";
    const a = await request();
    select("a", 6, 11);
    await flush();
    (shadow.querySelector(".selection-action") as HTMLButtonElement).click();
    const b = interpretations.at(-1)!;
    b.resolve({ explanation: "Second occurrence", provider: "fake" });
    await flush();
    a.resolve({ explanation: "First occurrence", provider: "fake" });
    await flush();
    expect(shadow.querySelector(".explanation")?.textContent).toContain("Second occurrence");
    expect(controller.getDiagnostics().interpretationSuccessCount).toBe(1);
  });

  it("ignores old activation responses while current requests fail then recover", async () => {
    const old = await request();
    controller.setEnabled(false);
    controller.setEnabled(true);
    const current = await request("b");
    const metrics = controller.getDiagnostics();
    old.reject(new Error("old activation"));
    await flush();
    expect(controller.getDiagnostics()).toEqual(metrics);
    current.reject(new Error("current failure"));
    await flush();
    expect(shadow.querySelector(".explanation")?.textContent).toContain("실패");
    const recovered = await request("a");
    recovered.resolve({ explanation: "Recovered", provider: "fake" });
    await flush();
    expect(shadow.querySelector(".explanation")?.textContent).toContain("Recovered");
    expect(controller.getDiagnostics()).toMatchObject({ interpretationRequestCount: 2, interpretationFailureCount: 1, interpretationSuccessCount: 1 });
  });

  it("uses existing translation generation protection and current source identity", async () => {
    await flush();
    const old = [...translations];
    controller.setEnabled(false);
    controller.setEnabled(true);
    await flush();
    for (const { pending } of old) pending.reject(new Error("old translation"));
    await flush();
    expect(controller.getDiagnostics().translationFailed).toBe(0);
    document.getElementById("a")!.textContent = "Replacement source paragraph for translation.";
    document.getElementById("b")!.remove();
    await vi.advanceTimersByTimeAsync(150);
    const replacement = translations.find(({ requests }) => requests[0]?.text.startsWith("Replacement"))!;
    replacement.pending.resolve(replacement.requests.map((request) => ({
      regionId: request.regionId, requestKey: request.requestKey, translatedText: "Current replacement", provider: "fake",
    })));
    await vi.advanceTimersByTimeAsync(50);
    expect(shadow.querySelector(".translation-surface")?.textContent).toBe("Current replacement");
    // Finish the superseded and removed sources after the replacement.
    completeTranslations();
    await vi.advanceTimersByTimeAsync(50);
    const surfaces = [...shadow.querySelectorAll<HTMLElement>(".translation-surface")];
    expect(surfaces.map((surface) => surface.dataset.sourceText)).toEqual(["Replacement source paragraph for translation."]);
  });

  it("leaves no UI or duplicate work after ten pending ON/OFF cycles", async () => {
    const retired: ShadowRoot[] = [];
    for (let index = 0; index < 10; index++) {
      controller.setEnabled(true);
      expect(document.querySelectorAll("[data-context-reader-root]")).toHaveLength(1);
      await request(index % 2 ? "b" : "a");
      select(index % 2 ? "a" : "b"); // queued action at shutdown
      retired.push(shadow);
      controller.setEnabled(false);
      expect(document.querySelectorAll("[data-context-reader-root]")).toHaveLength(0);
      expect(observers.size).toBe(0);
      expect(subscriptions).toBe(0);
    }
    const html = retired.map((root) => root.innerHTML);
    const metrics = controller.getDiagnostics();
    interpretations.forEach((pending, index) => index % 2
      ? pending.reject(new Error("late failure")) : pending.resolve({ explanation: "late", provider: "fake" }));
    completeTranslations();
    document.getElementById("a")!.textContent += " Mutation while OFF.";
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(retired.map((root) => root.innerHTML)).toEqual(html);
    expect(document.querySelectorAll("[data-context-reader-root]")).toHaveLength(0);
    expect(controller.getDiagnostics()).toEqual(metrics);
    expect(vi.getTimerCount()).toBe(0);
    controller.setEnabled(true);
    await request("b");
    expect(interpretations).toHaveLength(11);
    expect(subscriptions).toBe(1);
    expect(observers.size).toBe(1);
    expect(controller.getDiagnostics().reconciliations).toBe(1);
    document.getElementById("a")!.textContent += " Active mutation.";
    await vi.advanceTimersByTimeAsync(150);
    expect(controller.getDiagnostics().mutationBatches).toBe(1);
  });
});
