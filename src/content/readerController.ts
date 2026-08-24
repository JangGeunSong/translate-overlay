import { collectInterpretationContext } from "./analysis/contextCollector";
import { PageAnalyzer } from "./analysis/pageAnalyzer";
import { OverlayRenderer } from "./overlay/overlayRenderer";
import type { LinguisticProvider } from "./providers/provider";
import type { InterpretationContext, TextRegion, TranslationRequest, TranslationResult } from "./types";

const TARGET_LANGUAGE = "ko";
const TRANSLATION_BATCH_SIZE = 12;

export class ReaderController {
  private enabled = false;
  private renderer?: OverlayRenderer;
  private observer?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private regions: TextRegion[] = [];
  private readonly translations = new Map<string, TranslationResult>();
  private readonly pendingTranslations = new Set<string>();
  private scanTimer?: number;
  private positionFrame?: number;

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

  private start(): void {
    this.renderer = new OverlayRenderer(() => undefined);
    this.scan();
    this.observer = new MutationObserver(() => this.scheduleScan(250));
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.resizeObserver = new ResizeObserver(() => this.schedulePosition());
    this.resizeObserver.observe(document.documentElement);
    addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    addEventListener("resize", this.onResize, { passive: true });
    addEventListener("popstate", this.onNavigation);
    addEventListener("hashchange", this.onNavigation);
    document.addEventListener("mouseup", this.onMouseUp);
  }

  private stop(): void {
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    removeEventListener("scroll", this.onScroll, { capture: true });
    removeEventListener("resize", this.onResize);
    removeEventListener("popstate", this.onNavigation);
    removeEventListener("hashchange", this.onNavigation);
    document.removeEventListener("mouseup", this.onMouseUp);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
    this.renderer?.dispose();
    this.renderer = undefined;
    this.regions = [];
    this.translations.clear();
    this.pendingTranslations.clear();
  }

  private readonly onScroll = (): void => {
    this.schedulePosition();
    this.scheduleScan(180);
  };

  private readonly onResize = (): void => {
    this.schedulePosition();
    this.scheduleScan(180);
  };

  private readonly onNavigation = (): void => this.scheduleScan(50);

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

  private scheduleScan(delay: number): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      this.scan();
    }, delay);
  }

  private scan(): void {
    if (!this.enabled || !this.renderer) return;
    this.regions = this.analyzer.analyze({ maxRegions: 40 });
    this.renderer.reconcile(this.regions, this.translations);
    const untranslated = this.regions.filter(
      (region) => !this.translations.has(region.id) && !this.pendingTranslations.has(region.id),
    );
    for (let index = 0; index < untranslated.length; index += TRANSLATION_BATCH_SIZE) {
      void this.translateBatch(untranslated.slice(index, index + TRANSLATION_BATCH_SIZE));
    }
  }

  private async translateBatch(regions: TextRegion[]): Promise<void> {
    for (const region of regions) this.pendingTranslations.add(region.id);
    const requests: TranslationRequest[] = regions.map((region) => ({
      regionId: region.id,
      text: region.text,
      sourceLanguage: region.language,
      targetLanguage: TARGET_LANGUAGE,
    }));
    try {
      const results = await this.provider.translate(requests);
      if (!this.enabled) return;
      for (const result of results) this.translations.set(result.regionId, result);
      this.renderer?.reconcile(this.regions, this.translations);
    } finally {
      for (const region of regions) this.pendingTranslations.delete(region.id);
    }
  }

  private async interpret(context: InterpretationContext): Promise<void> {
    if (!this.renderer) return;
    this.renderer.showExplanation(context, "선택한 표현과 주변 문맥을 확인하고 있습니다.", true);
    try {
      const result = await this.provider.interpret(context);
      if (this.enabled) this.renderer?.showExplanation(context, result.explanation);
    } catch {
      if (this.enabled) this.renderer?.showExplanation(context, "현재 해석 제공자를 사용할 수 없습니다.");
    }
  }
}
