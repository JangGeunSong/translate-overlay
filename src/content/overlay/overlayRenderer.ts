import type {
  InterpretationContext,
  ProviderStatus,
  TextRegion,
  TranslationProgress,
  TranslationResult,
} from "../types";
import { containsBox, measureSurface } from "./surfaceLayout";

const ROOT_ATTRIBUTE = "data-context-reader-root";

interface SurfaceEntry {
  region: TextRegion;
  element: HTMLDivElement;
  renderedKey?: string;
}

export interface OverlayReconcileStats {
  created: number;
  disposed: number;
  reused: number;
}

export interface SurfaceDiagnostic {
  id: string;
  sourceKey: string;
  hidden: boolean;
  height: string;
  maxHeight: string;
  fontSize: string;
  compact: boolean;
  suppressed: boolean;
  semanticClass: TextRegion["semanticClass"];
}

export class OverlayRenderer {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly surfaceLayer: HTMLDivElement;
  private readonly controlLayer: HTMLDivElement;
  private readonly surfaces = new Map<string, SurfaceEntry>();
  private readonly statusLabel: HTMLSpanElement;
  private readonly progressLabel: HTMLSpanElement;
  private showingOriginal = false;
  private selectionAction?: HTMLButtonElement;
  private explanation?: HTMLDivElement;

  constructor(onToggleOriginal: (showingOriginal: boolean) => void) {
    this.host = document.createElement("div");
    this.host.setAttribute(ROOT_ATTRIBUTE, "");
    this.host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;";
    this.shadow = this.host.attachShadow({ mode: "closed" });
    this.shadow.innerHTML = `<style>${this.styles()}</style>`;
    this.surfaceLayer = document.createElement("div");
    this.surfaceLayer.className = "surface-layer";
    this.controlLayer = document.createElement("div");
    this.controlLayer.className = "control-layer";
    this.shadow.append(this.surfaceLayer, this.controlLayer);
    const toolbar = this.createToolbar(onToggleOriginal);
    this.statusLabel = toolbar.querySelector(".provider-status") as HTMLSpanElement;
    this.progressLabel = toolbar.querySelector(".translation-progress") as HTMLSpanElement;
    this.controlLayer.append(toolbar);
    document.documentElement.append(this.host);
  }

  private styles(): string {
    return `
      :host { all: initial; }
      .surface-layer, .control-layer { position: fixed; inset: 0; pointer-events: none; }
      .surface-layer { overflow: hidden; }
      .translation-surface {
        position: absolute; box-sizing: border-box; overflow: hidden; padding: 0;
        white-space: normal; overflow-wrap: anywhere; word-break: normal;
        pointer-events: none; contain: layout paint style;
      }
      .translation-surface.compact { white-space: nowrap; }
      .translation-surface.demo { outline: 1px dotted color-mix(in srgb, CanvasText 28%, transparent); }
      .toolbar {
        position: fixed; top: 12px; right: 12px; display: flex; align-items: center; gap: 8px;
        max-width: min(360px, calc(100vw - 24px)); padding: 7px 9px; border: 1px solid #d7dbe2;
        border-radius: 999px; background: #fff; color: #17202a; box-shadow: 0 3px 16px #0002;
        font: 12px/1.2 system-ui, sans-serif; pointer-events: auto;
      }
      .provider-status { color: #657080; }
      .translation-progress { color: #2457d6; font-variant-numeric: tabular-nums; }
      button { border: 0; border-radius: 999px; padding: 6px 9px; cursor: pointer; font: inherit; }
      .toggle { background: #eaf0ff; color: #173b78; }
      .selection-action {
        position: fixed; background: #2457d6; color: #fff; box-shadow: 0 3px 14px #0003;
        pointer-events: auto; z-index: 2;
      }
      .explanation {
        position: fixed; box-sizing: border-box; width: min(380px, calc(100vw - 24px)); max-height: min(320px, 60vh);
        overflow: auto; padding: 14px; border: 1px solid #d7dbe2; border-radius: 12px;
        background: #fff; color: #17202a; box-shadow: 0 7px 28px #0003;
        font: 14px/1.55 system-ui, sans-serif; pointer-events: auto; z-index: 3;
      }
      .explanation header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; font-weight: 700; }
      .explanation p { margin: 0; white-space: pre-wrap; }
      .explanation .context { margin-top: 10px; color: #657080; font-size: 12px; }
      .close { padding: 2px 7px; background: #eef0f3; color: #333; }
      @media (prefers-color-scheme: dark) {
        .toolbar, .explanation { background: #20242a; color: #f4f6f8; border-color: #414852; }
        .toggle { background: #324b78; color: #fff; }
        .close { background: #3a4048; color: #fff; }
      }
    `;
  }

  private createToolbar(onToggleOriginal: (showingOriginal: boolean) => void): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    const label = document.createElement("span");
    label.textContent = "읽기 레이어 켜짐";
    const providerStatus = document.createElement("span");
    providerStatus.className = "provider-status";
    providerStatus.textContent = "번역 기능 확인 중";
    const progress = document.createElement("span");
    progress.className = "translation-progress";
    progress.textContent = "원문 표시 중";
    const toggle = document.createElement("button");
    toggle.className = "toggle";
    toggle.textContent = "원문 보기";
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      this.showingOriginal = !this.showingOriginal;
      this.surfaceLayer.hidden = this.showingOriginal;
      if (!this.showingOriginal) this.reposition();
      toggle.textContent = this.showingOriginal ? "번역 보기" : "원문 보기";
      onToggleOriginal(this.showingOriginal);
    });
    toolbar.append(label, providerStatus, progress, toggle);
    return toolbar;
  }

  setProviderStatus(status: ProviderStatus): void {
    if (status.capability !== "translation") return;
    this.statusLabel.textContent = status.message;
    this.statusLabel.dataset.mode = status.mode;
    this.statusLabel.dataset.state = status.state;
    this.statusLabel.title = status.progress === undefined ? status.message : `${status.message} ${status.progress}%`;
    this.host.dataset.providerMode = status.mode;
    this.host.dataset.providerState = status.state;
  }

  setTranslationProgress(progress: TranslationProgress): void {
    if (progress.failed > 0 && progress.queued + progress.translating === 0) {
      this.progressLabel.textContent = `일부 번역 실패 · ${progress.completed}/${progress.total}`;
    } else if (progress.queued + progress.translating > 0) {
      this.progressLabel.textContent = `번역 중 · ${progress.completed}/${progress.total}`;
    } else if (progress.viewportReady) {
      this.progressLabel.textContent = `현재 화면 준비됨 · ${progress.completed}/${progress.total}`;
    } else {
      this.progressLabel.textContent = `원문 표시 중 · ${progress.completed}/${progress.total}`;
    }
    this.progressLabel.dataset.completed = String(progress.completed);
    this.progressLabel.dataset.total = String(progress.total);
    this.progressLabel.dataset.viewportReady = String(progress.viewportReady);
    this.progressLabel.dataset.timeToFirstTranslation = String(progress.timeToFirstTranslationMs ?? "");
    this.progressLabel.dataset.timeToFirstReading = String(progress.timeToFirstReadingContentMs ?? "");
    this.progressLabel.dataset.timeToViewportReady = String(progress.timeToViewportReadyMs ?? "");
    this.progressLabel.dataset.translationRequests = String(progress.translationRequests ?? 0);
    this.progressLabel.dataset.cacheHits = String(progress.cacheHits ?? 0);
    this.progressLabel.dataset.averageTranslationLatency = String(progress.averageTranslationLatencyMs ?? "");
    this.host.dataset.translationProgress = JSON.stringify(progress);
  }

  setInterpretationDiagnostics(diagnostics: {
    requests: number;
    successes: number;
    failures: number;
    averageLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
  }): void {
    this.host.dataset.interpretationDiagnostics = JSON.stringify(diagnostics);
  }

  reconcile(regions: TextRegion[], translations: ReadonlyMap<string, TranslationResult>): OverlayReconcileStats {
    const stats: OverlayReconcileStats = { created: 0, disposed: 0, reused: 0 };
    const liveIds = new Set(regions.map((region) => region.id));
    for (const [id, entry] of this.surfaces) {
      if (!liveIds.has(id) || !entry.region.element.isConnected) {
        entry.element.remove();
        this.surfaces.delete(id);
        stats.disposed += 1;
      }
    }
    for (const region of regions) {
      const result = translations.get(region.id);
      let entry = this.surfaces.get(region.id);
      if (!result) {
        if (entry) {
          entry.element.remove();
          this.surfaces.delete(region.id);
          stats.disposed += 1;
        }
        continue;
      }
      if (!entry) {
        const element = document.createElement("div");
        element.className = "translation-surface";
        element.dataset.regionId = region.id;
        this.surfaceLayer.append(element);
        entry = { region, element };
        this.surfaces.set(region.id, entry);
        stats.created += 1;
      } else {
        stats.reused += 1;
      }
      entry.region = region;
      const renderedKey = result.requestKey;
      if (entry.renderedKey !== renderedKey) {
        entry.element.textContent = result.translatedText;
        entry.element.dataset.fullTranslation = result.translatedText;
        entry.renderedKey = renderedKey;
      }
      entry.element.dataset.sourceKey = region.sourceKey;
      entry.element.dataset.sourceText = region.text;
      entry.element.dataset.semanticClass = region.semanticClass;
      entry.element.classList.toggle("semantic-reading", region.semanticClass === "READING");
      entry.element.classList.toggle("semantic-ui", region.semanticClass === "UI");
      entry.element.classList.toggle("semantic-auxiliary", region.semanticClass === "AUXILIARY");
      entry.element.classList.toggle("demo", result.provider === "deterministic-demo");
      entry.element.title = result.translatedText;
      this.position(entry);
    }
    const active = [...this.surfaces.values()];
    this.host.dataset.surfaceDiagnostics = JSON.stringify({
      total: active.length,
      reading: active.filter((entry) => entry.region.semanticClass === "READING").length,
      ui: active.filter((entry) => entry.region.semanticClass === "UI").length,
      auxiliary: active.filter((entry) => entry.region.semanticClass === "AUXILIARY").length,
      suppressed: active.filter((entry) => entry.element.dataset.suppressed === "true").length,
    });
    return stats;
  }

  reposition(): void {
    for (const entry of this.surfaces.values()) this.position(entry);
  }

  private position(entry: SurfaceEntry): void {
    if (this.showingOriginal || !entry.region.element.isConnected) {
      entry.element.hidden = true;
      return;
    }
    const rect = entry.region.element.getBoundingClientRect();
    const style = getComputedStyle(entry.region.element);
    const cssVisible = style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    const browserVisible = typeof entry.region.element.checkVisibility !== "function" || entry.region.element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    });
    const visible = cssVisible && browserVisible && rect.width > 1 && rect.height > 1 &&
      rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth;
    const suppressTinyUi = entry.region.semanticClass === "UI" && (rect.width < 48 || rect.height < 16);
    entry.element.dataset.suppressed = String(suppressTinyUi);
    entry.element.hidden = !visible || suppressTinyUi;
    if (!visible || suppressTinyUi) return;
    const measurement = measureSurface(entry.region.element);
    if ("reason" in measurement) {
      entry.element.hidden = true;
      entry.element.dataset.suppressed = "true";
      entry.element.dataset.suppressionReason = measurement.reason;
      return;
    }
    const { box, background } = measurement;
    const sourceFontSize = Number.parseFloat(style.fontSize) || 16;
    const heading = entry.region.element.matches("h1, h2, h3, h4, h5, h6") ||
      Boolean(entry.region.element.closest("h1, h2, h3, h4, h5, h6"));
    const compact = !heading && entry.region.semanticClass === "UI" && box.height < sourceFontSize * 1.8;
    entry.element.dataset.renderingPolicy = heading ? "title" : compact ? "compact" : "wrapped";
    entry.element.classList.toggle("compact", compact);
    Object.assign(entry.element.style, {
      transform: `translate(${box.left}px, ${box.top}px)`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      maxHeight: `${box.height}px`,
      backgroundColor: background,
      color: style.color,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing,
      direction: style.direction,
      textAlign: style.textAlign,
    });
    // Fit the entire translation with a bounded reduction. Hidden overflow or a title
    // attribute is not readable completion; if no size fits, keep the original.
    const minimum = Math.min(sourceFontSize, Math.max(12, sourceFontSize * 0.8));
    let fits = false;
    const range = document.createRange();
    for (let step = 0; step <= 4; step++) {
      const size = sourceFontSize - (sourceFontSize - minimum) * step / 4;
      entry.element.style.fontSize = `${size}px`;
      entry.element.style.lineHeight = `${Math.min(box.height, size * 1.25)}px`;
      range.selectNodeContents(entry.element);
      const lines = [...range.getClientRects()];
      fits = lines.length > 0 && entry.element.scrollWidth <= entry.element.clientWidth && entry.element.scrollHeight <= entry.element.clientHeight &&
        lines.every(line => containsBox(box, line));
      if (fits) break;
    }
    entry.element.hidden = !fits;
    entry.element.dataset.suppressed = String(!fits);
    entry.element.dataset.suppressionReason = fits ? "" : "translation-overflow";
  }

  showSelectionAction(rect: DOMRect, onRequest: () => void): void {
    this.clearSelectionUi();
    const button = document.createElement("button");
    button.className = "selection-action";
    button.textContent = "맥락 해석";
    button.style.left = `${Math.min(Math.max(8, rect.left), innerWidth - 100)}px`;
    button.style.top = `${Math.min(innerHeight - 44, rect.bottom + 6)}px`;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", onRequest, { once: true });
    this.controlLayer.append(button);
    this.selectionAction = button;
  }

  showExplanation(context: InterpretationContext, text: string, loading = false, provider?: string, onClose?: () => void): void {
    this.selectionAction?.remove();
    this.explanation?.remove();
    const popover = document.createElement("div");
    popover.className = "explanation";
    popover.style.right = "12px";
    popover.style.top = "58px";
    const header = document.createElement("header");
    const title = document.createElement("span");
    title.textContent = loading ? "맥락을 해석하는 중…" : "맥락 해석";
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "닫기";
    close.addEventListener("mousedown", (event) => event.preventDefault());
    close.addEventListener("click", () => {
      this.clearExplanation();
      onClose?.();
    });
    header.append(title, close);
    const body = document.createElement("p");
    body.textContent = text;
    const contextLine = document.createElement("div");
    contextLine.className = "context";
    contextLine.textContent = `선택: ${context.selectedText}${provider ? ` · ${provider}` : ""}`;
    popover.append(header, body, contextLine);
    this.controlLayer.append(popover);
    this.explanation = popover;
  }

  clearSelectionUi(): void {
    this.selectionAction?.remove();
    this.selectionAction = undefined;
  }

  clearExplanation(): void {
    this.explanation?.remove();
    this.explanation = undefined;
  }

  getSurfaceDiagnostics(): SurfaceDiagnostic[] {
    return [...this.surfaces.entries()].map(([id, entry]) => ({
      id,
      sourceKey: entry.region.sourceKey,
      hidden: entry.element.hidden,
      height: entry.element.style.height,
      maxHeight: entry.element.style.maxHeight,
      fontSize: entry.element.style.fontSize,
      compact: entry.element.classList.contains("compact"),
      suppressed: entry.element.dataset.suppressed === "true",
      semanticClass: entry.region.semanticClass,
    }));
  }

  dispose(): void {
    this.surfaces.clear();
    this.host.remove();
  }
}

export const overlayRootSelector = `[${ROOT_ATTRIBUTE}]`;
