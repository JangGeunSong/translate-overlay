import type { InterpretationContext, TextRegion, TranslationResult } from "../types";

const ROOT_ATTRIBUTE = "data-context-reader-root";

interface SurfaceEntry {
  region: TextRegion;
  element: HTMLDivElement;
}

export class OverlayRenderer {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly surfaceLayer: HTMLDivElement;
  private readonly controlLayer: HTMLDivElement;
  private readonly surfaces = new Map<string, SurfaceEntry>();
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
    this.controlLayer.append(this.createToolbar(onToggleOriginal));
    document.documentElement.append(this.host);
  }

  private styles(): string {
    return `
      :host { all: initial; }
      .surface-layer, .control-layer { position: fixed; inset: 0; pointer-events: none; }
      .translation-surface {
        position: absolute; box-sizing: border-box; overflow: hidden; padding: 1px 2px;
        background: color-mix(in srgb, Canvas 96%, transparent); color: CanvasText;
        white-space: normal; overflow-wrap: anywhere; border-radius: 2px;
        pointer-events: none; contain: layout paint style;
      }
      .toolbar {
        position: fixed; top: 12px; right: 12px; display: flex; align-items: center; gap: 8px;
        max-width: min(360px, calc(100vw - 24px)); padding: 7px 9px; border: 1px solid #d7dbe2;
        border-radius: 999px; background: #fff; color: #17202a; box-shadow: 0 3px 16px #0002;
        font: 12px/1.2 system-ui, sans-serif; pointer-events: auto;
      }
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
    const toggle = document.createElement("button");
    toggle.className = "toggle";
    toggle.textContent = "원문 보기";
    toggle.addEventListener("click", () => {
      this.showingOriginal = !this.showingOriginal;
      this.surfaceLayer.hidden = this.showingOriginal;
      toggle.textContent = this.showingOriginal ? "번역 보기" : "원문 보기";
      onToggleOriginal(this.showingOriginal);
    });
    toolbar.append(label, toggle);
    return toolbar;
  }

  reconcile(regions: TextRegion[], translations: ReadonlyMap<string, TranslationResult>): void {
    const liveIds = new Set(regions.map((region) => region.id));
    for (const [id, entry] of this.surfaces) {
      if (!liveIds.has(id) || !entry.region.element.isConnected) {
        entry.element.remove();
        this.surfaces.delete(id);
      }
    }
    for (const region of regions) {
      let entry = this.surfaces.get(region.id);
      if (!entry) {
        const element = document.createElement("div");
        element.className = "translation-surface";
        element.dataset.regionId = region.id;
        this.surfaceLayer.append(element);
        entry = { region, element };
        this.surfaces.set(region.id, entry);
      }
      entry.region = region;
      const result = translations.get(region.id);
      entry.element.textContent = result?.translatedText ?? "해석 중…";
      entry.element.title = result ? `${result.provider} · 원문은 상단 버튼으로 확인` : "번역 준비 중";
      this.position(entry);
    }
  }

  reposition(): void {
    for (const entry of this.surfaces.values()) this.position(entry);
  }

  private position(entry: SurfaceEntry): void {
    const rect = entry.region.element.getBoundingClientRect();
    const style = getComputedStyle(entry.region.element);
    const visible = rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth;
    entry.element.hidden = !visible;
    if (!visible) return;
    Object.assign(entry.element.style, {
      transform: `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`,
      width: `${Math.max(1, Math.round(rect.width))}px`,
      minHeight: `${Math.max(1, Math.round(rect.height))}px`,
      maxHeight: `${Math.max(24, Math.round(rect.height * 1.8))}px`,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
    });
  }

  showSelectionAction(rect: DOMRect, onRequest: () => void): void {
    this.clearSelectionUi();
    const button = document.createElement("button");
    button.className = "selection-action";
    button.textContent = "맥락 해석";
    button.style.left = `${Math.min(Math.max(8, rect.left), innerWidth - 100)}px`;
    button.style.top = `${Math.min(innerHeight - 44, rect.bottom + 6)}px`;
    button.addEventListener("click", onRequest, { once: true });
    this.controlLayer.append(button);
    this.selectionAction = button;
  }

  showExplanation(context: InterpretationContext, text: string, loading = false): void {
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
    close.addEventListener("click", () => popover.remove());
    header.append(title, close);
    const body = document.createElement("p");
    body.textContent = text;
    const contextLine = document.createElement("div");
    contextLine.className = "context";
    contextLine.textContent = `선택: ${context.selectedText}`;
    popover.append(header, body, contextLine);
    this.controlLayer.append(popover);
    this.explanation = popover;
  }

  clearSelectionUi(): void {
    this.selectionAction?.remove();
    this.selectionAction = undefined;
  }

  dispose(): void {
    this.surfaces.clear();
    this.host.remove();
  }
}

export const overlayRootSelector = `[${ROOT_ATTRIBUTE}]`;
