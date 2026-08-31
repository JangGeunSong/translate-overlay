import { collectInterpretationContext } from "./analysis/contextCollector";
import { PageAnalyzer } from "./analysis/pageAnalyzer";
import { isRegionAffected, reconcileRegions } from "./analysis/reconciliation";
import { getTranslationPriority, getViewportBand } from "./analysis/semanticClassifier";
import { TranslationCache, translationKeyForRegion } from "./analysis/translationCache";
import { READABLE_BLOCK_SELECTOR } from "./analysis/text";
import { OverlayRenderer } from "./overlay/overlayRenderer";
import type { LinguisticProvider } from "./providers/provider";
import { TranslationScheduler, type SchedulerEvent, type TranslationJob } from "./translation/translationScheduler";
import type {
  InterpretationContext,
  ProviderStatus,
  TextRegion,
  TranslationLifecycleState,
  TranslationProgress,
  TranslationRequest,
  TranslationResult,
} from "./types";

const TARGET_LANGUAGE = "ko";
const MAX_ACTIVE_REGIONS = 80;
const TRANSLATION_CONCURRENCY = 3;
const MUTATION_DEBOUNCE_MS = 120;
const MUTATION_MAX_WAIT_MS = 500;
const VIEWPORT_READY_RATIO = 0.8;

export interface ReaderDiagnostics {
  reconciliations: number;
  mutationBatches: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  discoveredRegions: number;
  readingRegions: number;
  uiRegions: number;
  auxiliaryRegions: number;
  overlayCreations: number;
  overlayDisposals: number;
  translationRequests: number;
  translationQueued: number;
  translationStarted: number;
  translationCompleted: number;
  translationFailed: number;
  translationCacheHits: number;
  translationCacheMisses: number;
  inFlightReused: number;
  activeTranslationRequests: number;
  queueDepth: number;
  averageTranslationLatencyMs: number | null;
  p50TranslationLatencyMs: number | null;
  p95TranslationLatencyMs: number | null;
  interpretationRequestCount: number;
  interpretationSuccessCount: number;
  interpretationFailureCount: number;
  averageInterpretationLatencyMs: number | null;
  p50InterpretationLatencyMs: number | null;
  p95InterpretationLatencyMs: number | null;
  timeToFirstTranslationMs: number | null;
  timeToFirstReadingContentMs: number | null;
  timeToViewportReadyMs: number | null;
  lastReconciliationMs: number;
}

const emptyDiagnostics = (): ReaderDiagnostics => ({
  reconciliations: 0,
  mutationBatches: 0,
  added: 0,
  changed: 0,
  removed: 0,
  unchanged: 0,
  discoveredRegions: 0,
  readingRegions: 0,
  uiRegions: 0,
  auxiliaryRegions: 0,
  overlayCreations: 0,
  overlayDisposals: 0,
  translationRequests: 0,
  translationQueued: 0,
  translationStarted: 0,
  translationCompleted: 0,
  translationFailed: 0,
  translationCacheHits: 0,
  translationCacheMisses: 0,
  inFlightReused: 0,
  activeTranslationRequests: 0,
  queueDepth: 0,
  averageTranslationLatencyMs: null,
  p50TranslationLatencyMs: null,
  p95TranslationLatencyMs: null,
  interpretationRequestCount: 0,
  interpretationSuccessCount: 0,
  interpretationFailureCount: 0,
  averageInterpretationLatencyMs: null,
  p50InterpretationLatencyMs: null,
  p95InterpretationLatencyMs: null,
  timeToFirstTranslationMs: null,
  timeToFirstReadingContentMs: null,
  timeToViewportReadyMs: null,
  lastReconciliationMs: 0,
});

export class ReaderController {
  private enabled = false;
  private renderer?: OverlayRenderer;
  private observer?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private regions: TextRegion[] = [];
  private readonly translationCache = new TranslationCache();
  private readonly affectedRoots = new Set<ParentNode>();
  private readonly observedElements = new Set<HTMLElement>();
  private readonly lifecycleStates = new Map<string, TranslationLifecycleState>();
  private readonly failedKeys = new Set<string>();
  private readonly observedCacheKeys = new Set<string>();
  private readonly observedMissKeys = new Set<string>();
  private readonly interpretationLatencySamples: number[] = [];
  private readonly latencySamples: number[] = [];
  private readonly scheduler: TranslationScheduler;
  private diagnostics = emptyDiagnostics();
  private scanTimer?: number;
  private mutationTimer?: number;
  private firstMutationAt?: number;
  private positionFrame?: number;
  private presentationFrame?: number;
  private lastAnalyzedScrollY = 0;
  private readerStartedAt = 0;
  private unsubscribeStatus?: () => void;
  private activeTranslationMode?: ProviderStatus["mode"];

  constructor(
    private readonly analyzer: PageAnalyzer,
    private readonly provider: LinguisticProvider,
  ) {
    this.scheduler = new TranslationScheduler({
      concurrency: TRANSLATION_CONCURRENCY,
      execute: async (request) => {
        const results = await this.provider.translate([request]);
        const result = results.find((candidate) => candidate.requestKey === request.requestKey);
        if (!result) throw new Error(`No translation result for ${request.requestKey}.`);
        return result;
      },
      onEvent: (event) => this.onSchedulerEvent(event),
    });
  }

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
    this.resetActivationDiagnostics();
    this.activeTranslationMode = undefined;
    this.readerStartedAt = performance.now();
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

  private resetActivationDiagnostics(): void {
    this.diagnostics = emptyDiagnostics();
    this.lifecycleStates.clear();
    this.failedKeys.clear();
    this.observedCacheKeys.clear();
    this.observedMissKeys.clear();
    this.latencySamples.length = 0;
    this.interpretationLatencySamples.length = 0;
  }

  private stop(): void {
    this.scheduler.clear();
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
    if (this.presentationFrame) cancelAnimationFrame(this.presentationFrame);
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = undefined;
    this.renderer?.dispose();
    this.renderer = undefined;
    this.regions = [];
    this.affectedRoots.clear();
    this.firstMutationAt = undefined;
    this.positionFrame = undefined;
    this.presentationFrame = undefined;
  }

  private readonly onProviderStatus = (status: ProviderStatus): void => {
    if (
      status.capability === "translation" &&
      this.activeTranslationMode === "development-demo" &&
      status.mode === "browser-translator" &&
      (status.state === "error" || status.state === "unavailable")
    ) return;
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
      if (record.type === "attributes") this.addAffectedRoot(record.target);
      else if (record.type === "characterData") this.addAffectedRoot(record.target.parentNode);
      else {
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
    this.affectedRoots.add(containsReadableBlocks ? element : (element.closest(READABLE_BLOCK_SELECTOR) ?? element));
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
      this.refreshTranslationPriorities();
    });
  }

  private refreshTranslationPriorities(): void {
    let changed = false;
    this.regions = this.regions.map((region) => {
      const rect = region.element.getBoundingClientRect();
      const viewportBand = getViewportBand(rect);
      const translationPriority = getTranslationPriority(region.semanticClass, viewportBand);
      if (viewportBand !== region.viewportBand || translationPriority !== region.translationPriority) changed = true;
      return { ...region, rect, viewportBand, translationPriority };
    });
    if (changed) this.syncTranslationWork();
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
    this.commitRegions([...currentById.values()]
      .sort((left, right) => left.translationPriority - right.translationPriority)
      .slice(0, MAX_ACTIVE_REGIONS));
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
    this.diagnostics.discoveredRegions = currentRegions.length;
    this.diagnostics.readingRegions = currentRegions.filter((region) => region.semanticClass === "READING").length;
    this.diagnostics.uiRegions = currentRegions.filter((region) => region.semanticClass === "UI").length;
    this.diagnostics.auxiliaryRegions = currentRegions.filter((region) => region.semanticClass === "AUXILIARY").length;

    const rendererStats = this.renderer.reconcile(this.regions, this.currentTranslations());
    this.diagnostics.overlayCreations += rendererStats.created;
    this.diagnostics.overlayDisposals += rendererStats.disposed;
    this.syncResizeTargets();
    this.syncTranslationWork();
    this.diagnostics.lastReconciliationMs = performance.now() - startedAt;
    this.debugLog();
  }

  private syncTranslationWork(): void {
    if (!this.enabled) return;
    const jobs: TranslationJob[] = [];
    for (const region of this.regions) {
      const requestKey = translationKeyForRegion(region, TARGET_LANGUAGE);
      const cached = this.translationCache.get(region, TARGET_LANGUAGE);
      if (cached) {
        this.lifecycleStates.set(requestKey, cached.provider === "deterministic-demo" ? "fallback" : "cached");
        if (!this.observedCacheKeys.has(requestKey) && !this.observedMissKeys.has(requestKey)) {
          this.observedCacheKeys.add(requestKey);
          this.diagnostics.translationCacheHits += 1;
        }
        continue;
      }
      if (!this.observedMissKeys.has(requestKey)) {
        this.observedMissKeys.add(requestKey);
        this.diagnostics.translationCacheMisses += 1;
      }
      if (this.failedKeys.has(requestKey)) continue;
      if (this.lifecycleStates.get(requestKey) !== "translating") this.lifecycleStates.set(requestKey, "queued");
      jobs.push({
        key: requestKey,
        priority: region.translationPriority,
        request: this.createTranslationRequest(region, requestKey),
      });
    }
    const syncStats = this.scheduler.sync(jobs);
    this.diagnostics.translationQueued += syncStats.queued;
    this.diagnostics.inFlightReused += syncStats.inFlightReused + syncStats.duplicateKeys;
    this.updateSchedulerSnapshot();
    this.updatePresentation();
  }

  private createTranslationRequest(region: TextRegion, requestKey: string): TranslationRequest {
    return {
      regionId: region.id,
      requestKey,
      text: region.text,
      sourceLanguage: region.language,
      targetLanguage: TARGET_LANGUAGE,
    };
  }

  private onSchedulerEvent(event: SchedulerEvent): void {
    if (!this.enabled) return;
    if (event.type === "started") {
      this.lifecycleStates.set(event.job.key, "translating");
      this.diagnostics.translationStarted += 1;
      this.diagnostics.translationRequests += 1;
    } else if (event.type === "completed") {
      this.translationCache.set(event.result);
      const fallback = event.result.provider === "deterministic-demo";
      this.lifecycleStates.set(event.job.key, fallback ? "fallback" : "translated");
      this.diagnostics.translationCompleted += 1;
      this.recordLatency(event.latencyMs);
      this.setActiveProvider(event.result.provider);
    } else {
      this.lifecycleStates.set(event.job.key, "failed");
      this.failedKeys.add(event.job.key);
      this.diagnostics.translationFailed += 1;
      this.recordLatency(event.latencyMs);
    }
    this.updateSchedulerSnapshot();
    this.schedulePresentation();
    this.debugLog();
  }

  private schedulePresentation(): void {
    if (this.presentationFrame !== undefined) return;
    this.presentationFrame = requestAnimationFrame(() => {
      this.presentationFrame = undefined;
      if (this.enabled) this.updatePresentation();
    });
  }

  private setActiveProvider(provider: string): void {
    if (provider === "deterministic-demo") {
      this.activeTranslationMode = "development-demo";
      this.onProviderStatus({
        capability: "translation",
        mode: "development-demo",
        state: "fallback",
        message: "개발용 번역 사용 중 (제한됨)",
      });
    } else if (provider === "production-remote") {
      this.activeTranslationMode = "production-remote";
      this.onProviderStatus({
        capability: "translation",
        mode: "production-remote",
        state: "ready",
        message: "원격 번역 준비됨",
      });
    } else if (provider === "chrome-built-in-translator") {
      this.activeTranslationMode = "browser-translator";
      this.onProviderStatus({
        capability: "translation",
        mode: "browser-translator",
        state: "ready",
        message: "브라우저 번역 준비됨",
      });
    }
  }

  private currentTranslations(): Map<string, TranslationResult> {
    const translations = new Map<string, TranslationResult>();
    for (const region of this.regions) {
      const cached = this.translationCache.get(region, TARGET_LANGUAGE);
      if (cached) translations.set(region.id, cached);
    }
    return translations;
  }

  private updatePresentation(): void {
    if (!this.renderer) return;
    const translations = this.currentTranslations();
    const stats = this.renderer.reconcile(this.regions, translations);
    this.diagnostics.overlayCreations += stats.created;
    this.diagnostics.overlayDisposals += stats.disposed;
    const progress = this.calculateProgress(translations);
    this.markReadinessMetrics(progress, translations);
    this.renderer.setTranslationProgress({
      ...progress,
      timeToFirstTranslationMs: this.diagnostics.timeToFirstTranslationMs ?? undefined,
      timeToFirstReadingContentMs: this.diagnostics.timeToFirstReadingContentMs ?? undefined,
      timeToViewportReadyMs: this.diagnostics.timeToViewportReadyMs ?? undefined,
      translationRequests: this.diagnostics.translationRequests,
      cacheHits: this.diagnostics.translationCacheHits,
      averageTranslationLatencyMs: this.diagnostics.averageTranslationLatencyMs ?? undefined,
      readingRegions: this.diagnostics.readingRegions,
      uiRegions: this.diagnostics.uiRegions,
      auxiliaryRegions: this.diagnostics.auxiliaryRegions,
    });
  }

  private calculateProgress(translations: ReadonlyMap<string, TranslationResult>): TranslationProgress {
    let queued = 0;
    let translating = 0;
    let failed = 0;
    let viewportReadingTotal = 0;
    let viewportReadingReady = 0;
    for (const region of this.regions) {
      const key = translationKeyForRegion(region, TARGET_LANGUAGE);
      const state = this.lifecycleStates.get(key);
      if (state === "queued") queued += 1;
      if (state === "translating") translating += 1;
      if (state === "failed") failed += 1;
      if (region.viewportBand === "VIEWPORT" && region.semanticClass === "READING") {
        viewportReadingTotal += 1;
        if (translations.has(region.id)) viewportReadingReady += 1;
      }
    }
    const viewportReady = viewportReadingTotal > 0 &&
      viewportReadingReady / viewportReadingTotal >= VIEWPORT_READY_RATIO;
    return {
      total: this.regions.length,
      completed: translations.size,
      queued,
      translating,
      failed,
      viewportReadingTotal,
      viewportReadingReady,
      viewportReady,
    };
  }

  private markReadinessMetrics(
    progress: TranslationProgress,
    translations: ReadonlyMap<string, TranslationResult>,
  ): void {
    const elapsed = performance.now() - this.readerStartedAt;
    if (this.diagnostics.timeToFirstTranslationMs === null && translations.size > 0) {
      this.diagnostics.timeToFirstTranslationMs = elapsed;
    }
    if (
      this.diagnostics.timeToFirstReadingContentMs === null &&
      this.regions.some((region) => region.semanticClass === "READING" && translations.has(region.id))
    ) {
      this.diagnostics.timeToFirstReadingContentMs = elapsed;
    }
    if (this.diagnostics.timeToViewportReadyMs === null && progress.viewportReady) {
      this.diagnostics.timeToViewportReadyMs = elapsed;
    }
  }

  private recordLatency(latencyMs: number): void {
    this.latencySamples.push(latencyMs);
    const sorted = [...this.latencySamples].sort((left, right) => left - right);
    this.diagnostics.averageTranslationLatencyMs = sorted.reduce((total, value) => total + value, 0) / sorted.length;
    this.diagnostics.p50TranslationLatencyMs = this.percentile(sorted, 0.5);
    this.diagnostics.p95TranslationLatencyMs = this.percentile(sorted, 0.95);
  }

  private percentile(sorted: number[], quantile: number): number {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
  }

  private updateSchedulerSnapshot(): void {
    const snapshot = this.scheduler.snapshot();
    this.diagnostics.queueDepth = snapshot.queued;
    this.diagnostics.activeTranslationRequests = snapshot.active;
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

  private async interpret(context: InterpretationContext): Promise<void> {
    if (!this.renderer) return;
    const startedAt = performance.now();
    this.diagnostics.interpretationRequestCount += 1;
    this.renderer.showExplanation(context, "선택한 표현과 주변 문맥을 확인하고 있습니다.", true);
    try {
      const result = await this.provider.interpret(context);
      this.diagnostics.interpretationSuccessCount += 1;
      if (this.enabled) this.renderer?.showExplanation(context, result.explanation, false, result.provider);
    } catch {
      this.diagnostics.interpretationFailureCount += 1;
      if (this.enabled) this.renderer?.showExplanation(context, "문맥 해석에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      this.recordInterpretationLatency(performance.now() - startedAt);
      this.renderer?.setInterpretationDiagnostics({
        requests: this.diagnostics.interpretationRequestCount,
        successes: this.diagnostics.interpretationSuccessCount,
        failures: this.diagnostics.interpretationFailureCount,
        averageLatencyMs: this.diagnostics.averageInterpretationLatencyMs,
        p50LatencyMs: this.diagnostics.p50InterpretationLatencyMs,
        p95LatencyMs: this.diagnostics.p95InterpretationLatencyMs,
      });
      this.debugLog();
    }
  }

  private recordInterpretationLatency(latencyMs: number): void {
    this.interpretationLatencySamples.push(latencyMs);
    const sorted = [...this.interpretationLatencySamples].sort((left, right) => left - right);
    this.diagnostics.averageInterpretationLatencyMs = sorted.reduce((total, value) => total + value, 0) / sorted.length;
    this.diagnostics.p50InterpretationLatencyMs = this.percentile(sorted, 0.5);
    this.diagnostics.p95InterpretationLatencyMs = this.percentile(sorted, 0.95);
  }

  private debugLog(): void {
    try {
      if (localStorage.getItem("contextReaderDebug") === "1") {
        console.debug("[Context Reader] diagnostics", this.getDiagnostics());
      }
    } catch {}
  }
}
