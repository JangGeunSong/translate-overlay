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
    const completed = controller.getDiagnostics().translationCompleted;
    // Finish the superseded and removed sources after the replacement.
    completeTranslations();
    await vi.advanceTimersByTimeAsync(50);
    const surfaces = [...shadow.querySelectorAll<HTMLElement>(".translation-surface")];
    expect(surfaces.map((surface) => surface.dataset.sourceText)).toEqual(["Replacement source paragraph for translation."]);
    expect(controller.getDiagnostics().translationCompleted).toBe(completed);
  });

  it("discovers nested scroll roots without requiring window scroll or a document scan", async () => {
    const analyze = vi.spyOn(PageAnalyzer.prototype, "analyze");
    const main = document.querySelector("main")!;
    for (let i = 0; i < 8; i++) {
      main.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(80);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(analyze.mock.calls.some(([options]) => options?.roots?.includes(main))).toBe(true);
    expect(analyze.mock.calls.every(([options]) => options?.roots !== undefined)).toBe(true);
    expect(controller.getDiagnostics().reconciliations).toBeLessThanOrEqual(3);
  });

  it("observes bounded semantic attributes but ignores unrelated metadata", async () => {
    const a = document.getElementById("a")!;
    a.setAttribute("aria-expanded", "true");
    await vi.advanceTimersByTimeAsync(150);
    expect(controller.getDiagnostics().mutationBatches).toBe(1);
    a.setAttribute("data-analytics", "changed");
    await vi.advanceTimersByTimeAsync(150);
    expect(controller.getDiagnostics().mutationBatches).toBe(1);
  });

  it("ignores stale translation failures and latency after the current source succeeds", async () => {
    await flush();
    const old = [...translations];
    document.getElementById("a")!.textContent = "Current source details for the camera.";
    document.getElementById("b")!.remove();
    await vi.advanceTimersByTimeAsync(150);
    const current = translations.at(-1)!;
    current.pending.resolve(current.requests.map(request => ({regionId: request.regionId,
      requestKey: request.requestKey, translatedText: "Current", provider: "fake"})));
    await vi.advanceTimersByTimeAsync(50);
    const before = controller.getDiagnostics();
    old.forEach(({pending}) => pending.reject(new Error("Superseded source")));
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.getDiagnostics()).toEqual(before);
    expect(shadow.querySelector(".translation-surface")?.textContent).toBe("Current");
  });

  it("leaves no UI or duplicate work after ten pending ON/OFF cycles", async () => {
    controller.setEnabled(false);
    const addWindow = vi.spyOn(window, "addEventListener");
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const addDocument = vi.spyOn(document, "addEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    const mutationObservers = new Set<MutationObserver>();
    const NativeObserver = window.MutationObserver;
    vi.stubGlobal("MutationObserver", class extends NativeObserver {
      observe(target: Node, options?: MutationObserverInit) { mutationObservers.add(this); super.observe(target, options); }
      disconnect() { mutationObservers.delete(this); super.disconnect(); }
    });
    const retired: ShadowRoot[] = [];
    for (let index = 0; index < 10; index++) {
      controller.setEnabled(true);
      expect(document.querySelectorAll("[data-context-reader-root]")).toHaveLength(1);
      await request(index % 2 ? "b" : "a");
      document.getElementById("a")!.textContent = `Alpha source in dynamic cycle ${index}.`;
      document.querySelector("main")!.setAttribute("aria-expanded", String(index % 2 === 0));
      document.querySelector("main")!.dispatchEvent(new Event("scroll"));
      await flush(); // leave mutation/scroll reconciliation scheduled at shutdown
      select(index % 2 ? "a" : "b"); // queued action at shutdown
      retired.push(shadow);
      controller.setEnabled(false);
      expect(document.querySelectorAll("[data-context-reader-root]")).toHaveLength(0);
      expect(observers.size).toBe(0);
      expect(subscriptions).toBe(0);
      expect(mutationObservers.size).toBe(0);
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
    for (const [added, removed, names] of [
      [addWindow, removeWindow, ["scroll", "resize", "popstate", "hashchange"]],
      [addDocument, removeDocument, ["mouseup", "selectionchange"]],
    ] as const) for (const name of names) {
      const registrations = added.mock.calls.filter(([type]) => type === name);
      const removals = removed.mock.calls.filter(([type]) => type === name);
      expect(registrations).toHaveLength(10);
      expect(removals).toHaveLength(10);
      expect(registrations.map(([, listener]) => listener)).toEqual(removals.map(([, listener]) => listener));
    }
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
