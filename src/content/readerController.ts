import { collectInterpretationContext } from "./analysis/contextCollector";
import { PageAnalyzer } from "./analysis/pageAnalyzer";
import { isRegionAffected, reconcileRegions } from "./analysis/reconciliation";
import { TranslationCache, translationKeyForRegion } from "./analysis/translationCache";
import { READABLE_BLOCK_SELECTOR } from "./analysis/text";
import { OverlayRenderer } from "./overlay/overlayRenderer";
import type { LinguisticProvider } from "./providers/provider";
import type {
  InterpretationContext,
  ProviderStatus,
  TextRegion,
  TranslationRequest,
  TranslationResult,
} from "./types";

const TARGET_LANGUAGE = "ko";
const MAX_ACTIVE_REGIONS = 40;
const TRANSLATION_BATCH_SIZE = 12;
const MUTATION_DEBOUNCE_MS = 120;
const MUTATION_MAX_WAIT_MS = 500;

export interface ReaderDiagnostics {
  reconciliations: number;
  mutationBatches: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  overlayCreations: number;
  overlayDisposals: number;
  translationRequests: number;
  translationCacheHits: number;
  lastReconciliationMs: number;
}

const emptyDiagnostics = (): ReaderDiagnostics => ({
  reconciliations: 0,
  mutationBatches: 0,
  added: 0,
  changed: 0,
  removed: 0,
  unchanged: 0,
  overlayCreations: 0,
  overlayDisposals: 0,
  translationRequests: 0,
  translationCacheHits: 0,
  lastReconciliationMs: 0,
});

export class ReaderController {
  private enabled = false;
  private renderer?: OverlayRenderer;
  private observer?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private regions: TextRegion[] = [];
  private readonly translationCache = new TranslationCache();
  private readonly pendingTranslations = new Set<string>();
  private readonly affectedRoots = new Set<ParentNode>();
  private readonly observedElements = new Set<HTMLElement>();
  private readonly diagnostics = emptyDiagnostics();
  private scanTimer?: number;
  private mutationTimer?: number;
  private firstMutationAt?: number;
  private positionFrame?: number;
  private lastAnalyzedScrollY = 0;
  private lifecycleGeneration = 0;
  private unsubscribeStatus?: () => void;
  private activeTranslationMode?: ProviderStatus["mode"];

  constructor(
    private readonly analyzer: PageAnalyzer,
    private readonly provider: LinguisticProvider,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.start();
    else this.stop();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getDiagnostics(): Readonly<ReaderDiagnostics> {
    return { ...this.diagnostics };
  }

  private start(): void {
    this.lifecycleGeneration += 1;
    this.activeTranslationMode = undefined;
    this.renderer = new OverlayRenderer(() => undefined);
    this.renderer.setProviderStatus({
      capability: "translation",
      mode: "unavailable",
      state: "checking",
      message: "번역 기능 확인 중",
    });
    this.unsubscribeStatus = this.provider.subscribeStatus?.((status) => this.onProviderStatus(status));
    this.lastAnalyzedScrollY = scrollY;
    this.fullReconcile();
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
    });
    this.resizeObserver = new ResizeObserver(() => this.schedulePosition());
    this.resizeObserver.observe(document.documentElement);
    this.syncResizeTargets();
    addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    addEventListener("resize", this.onResize, { passive: true });
    addEventListener("popstate", this.onNavigation);
    addEventListener("hashchange", this.onNavigation);
    document.fonts?.addEventListener("loadingdone", this.onLayoutShift);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  private stop(): void {
    this.lifecycleGeneration += 1;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.observedElements.clear();
    removeEventListener("scroll", this.onScroll, { capture: true });
    removeEventListener("resize", this.onResize);
    removeEventListener("popstate", this.onNavigation);
    removeEventListener("hashchange", this.onNavigation);
    document.fonts?.removeEventListener("loadingdone", this.onLayoutShift);
    document.removeEventListener("mouseup", this.onMouseUp);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.regions = [];
    this.pendingTranslations.clear();
    this.affectedRoots.clear();
    this.firstMutationAt = undefined;
  }

  private readonly onProviderStatus = (status: ProviderStatus): void => {
    if (
      status.capability === "translation" &&
      this.activeTranslationMode === "development-demo" &&
      status.mode === "browser-translator" &&
      (status.state === "error" || status.state === "unavailable")
    ) {
      return;
    }
    this.renderer?.setProviderStatus(status);
  };

  private readonly onScroll = (): void => {
    this.schedulePosition();
    if (Math.abs(scrollY - this.lastAnalyzedScrollY) >= Math.max(240, innerHeight * 0.6)) {
      this.scheduleFullReconcile(180);
    }
  };

  private readonly onResize = (): void => {
    this.schedulePosition();
    this.scheduleFullReconcile(180);
  };

  private readonly onLayoutShift = (): void => this.schedulePosition();
  private readonly onNavigation = (): void => this.scheduleFullReconcile(50);

  private readonly onMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest("[data-context-reader-root]")) continue;
      if (record.type === "attributes") {
        this.addAffectedRoot(record.target);
      } else if (record.type === "characterData") {
        this.addAffectedRoot(record.target.parentNode);
      } else {
        this.addAffectedRoot(record.target);
        for (const node of record.addedNodes) this.addAffectedRoot(node);
      }
    }
    if (this.affectedRoots.size === 0) return;
    const now = performance.now();
    this.firstMutationAt ??= now;
    const remaining = Math.max(0, MUTATION_MAX_WAIT_MS - (now - this.firstMutationAt));
    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    this.mutationTimer = window.setTimeout(this.flushMutations, Math.min(MUTATION_DEBOUNCE_MS, remaining));
  };

  private addAffectedRoot(node: Node | null): void {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element || element.closest("[data-context-reader-root]")) return;
    const containsReadableBlocks = element.matches(READABLE_BLOCK_SELECTOR) || Boolean(element.querySelector(READABLE_BLOCK_SELECTOR));
    this.affectedRoots.add(containsReadableBlocks
      ? element
      : (element.closest(READABLE_BLOCK_SELECTOR) ?? element));
  }

  private readonly flushMutations = (): void => {
    this.mutationTimer = undefined;
    this.firstMutationAt = undefined;
    if (!this.enabled || this.affectedRoots.size === 0) return;
    const roots = [...this.affectedRoots];
    this.affectedRoots.clear();
    this.diagnostics.mutationBatches += 1;
    this.targetedReconcile(roots);
  };

  private readonly onMouseUp = (): void => {
    if (!this.enabled || !this.renderer) return;
    window.setTimeout(() => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        this.renderer?.clearSelectionUi();
        return;
      }
      const context = collectInterpretationContext(selection, TARGET_LANGUAGE);
      if (!context) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      this.renderer?.showSelectionAction(rect, () => void this.interpret(context));
    }, 0);
  };

  private schedulePosition(): void {
    if (this.positionFrame) return;
    this.positionFrame = requestAnimationFrame(() => {
      this.positionFrame = undefined;
      this.renderer?.reposition();
    });
  }

  private scheduleFullReconcile(delay: number): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      this.fullReconcile();
    }, delay);
  }

  private fullReconcile(): void {
    if (!this.enabled) return;
    this.lastAnalyzedScrollY = scrollY;
    this.commitRegions(this.analyzer.analyze({ maxRegions: MAX_ACTIVE_REGIONS }));
  }

  private targetedReconcile(roots: ParentNode[]): void {
    const unaffected = this.regions
      .filter((region) => !isRegionAffected(region, roots))
      .map((region) => this.analyzer.refresh(region))
      .filter((region): region is TextRegion => region !== null);
    const affected = this.analyzer.analyze({ roots, maxRegions: MAX_ACTIVE_REGIONS });
    const currentById = new Map<string, TextRegion>();
    for (const region of [...unaffected, ...affected]) currentById.set(region.id, region);
    this.commitRegions([...currentById.values()].slice(0, MAX_ACTIVE_REGIONS));
  }

  private commitRegions(currentRegions: TextRegion[]): void {
    if (!this.enabled || !this.renderer) return;
    const startedAt = performance.now();
    const reconciliation = reconcileRegions(this.regions, currentRegions);
    this.regions = currentRegions;
    this.diagnostics.reconciliations += 1;
    this.diagnostics.added += reconciliation.added.length;
    this.diagnostics.changed += reconciliation.changed.length;
    this.diagnostics.removed += reconciliation.removed.length;
    this.diagnostics.unchanged += reconciliation.unchanged.length;

    const translations = this.currentTranslations();
    const rendererStats = this.renderer.reconcile(this.regions, translations);
    this.diagnostics.overlayCreations += rendererStats.created;
    this.diagnostics.overlayDisposals += rendererStats.disposed;
    this.syncResizeTargets();

    const requestsByKey = new Map<string, TextRegion>();
    for (const region of this.regions) {
      const requestKey = translationKeyForRegion(region, TARGET_LANGUAGE);
      if (translations.has(region.id)) {
        this.diagnostics.translationCacheHits += 1;
      } else if (!this.pendingTranslations.has(requestKey)) {
        requestsByKey.set(requestKey, region);
      }
    }
    const untranslated = [...requestsByKey.values()];
    for (let index = 0; index < untranslated.length; index += TRANSLATION_BATCH_SIZE) {
      void this.translateBatch(untranslated.slice(index, index + TRANSLATION_BATCH_SIZE));
    }
    this.diagnostics.lastReconciliationMs = performance.now() - startedAt;
    this.debugLog();
  }

  private currentTranslations(): Map<string, TranslationResult> {
    const translations = new Map<string, TranslationResult>();
    for (const region of this.regions) {
      const cached = this.translationCache.get(region, TARGET_LANGUAGE);
      if (cached) translations.set(region.id, cached);
    }
    return translations;
  }

  private syncResizeTargets(): void {
    if (!this.resizeObserver) return;
    const current = new Set(this.regions.map((region) => region.element));
    for (const element of this.observedElements) {
      if (!current.has(element)) {
        this.resizeObserver.unobserve(element);
        this.observedElements.delete(element);
      }
    }
    for (const element of current) {
      if (!this.observedElements.has(element)) {
        this.resizeObserver.observe(element);
        this.observedElements.add(element);
      }
    }
  }

  private async translateBatch(regions: TextRegion[]): Promise<void> {
    const generation = this.lifecycleGeneration;
    const requests: TranslationRequest[] = regions.map((region) => ({
      regionId: region.id,
      requestKey: translationKeyForRegion(region, TARGET_LANGUAGE),
      text: region.text,
      sourceLanguage: region.language,
      targetLanguage: TARGET_LANGUAGE,
    }));
    for (const request of requests) this.pendingTranslations.add(request.requestKey);
    this.diagnostics.translationRequests += requests.length;
    try {
      const results = await this.provider.translate(requests);
      if (!this.enabled || generation !== this.lifecycleGeneration) return;
      for (const result of results) this.translationCache.set(result);
      const activeProvider = results[0]?.provider;
      if (activeProvider === "deterministic-demo") {
        this.activeTranslationMode = "development-demo";
        this.onProviderStatus({
          capability: "translation",
          mode: "development-demo",
          state: "fallback",
          message: "개발용 번역 사용 중 (제한됨)",
        });
      } else if (activeProvider === "chrome-built-in-translator") {
        this.activeTranslationMode = "browser-translator";
        this.onProviderStatus({
          capability: "translation",
          mode: "browser-translator",
          state: "ready",
          message: "브라우저 번역 준비됨",
        });
      }
      this.renderer?.reconcile(this.regions, this.currentTranslations());
    } finally {
      for (const request of requests) this.pendingTranslations.delete(request.requestKey);
    }
  }

  private async interpret(context: InterpretationContext): Promise<void> {
    if (!this.renderer) return;
    this.renderer.showExplanation(context, "선택한 표현과 주변 문맥을 확인하고 있습니다.", true);
    try {
      const result = await this.provider.interpret(context);
      if (this.enabled) this.renderer?.showExplanation(context, result.explanation, false, result.provider);
    } catch {
      if (this.enabled) this.renderer?.showExplanation(context, "현재 해석 제공자를 사용할 수 없습니다.");
    }
  }

  private debugLog(): void {
    try {
      if (localStorage.getItem("contextReaderDebug") === "1") {
        console.debug("[Context Reader] reconciliation", this.getDiagnostics());
      }
    } catch {}
  }
}
