import type { TextRegion } from "../types";
import {
  READABLE_BLOCK_SELECTOR,
  createRegionId,
  createSourceKey,
  detectSourceLanguage,
  isElementRendered,
  isExcludedElement,
  isLikelyReadableText,
  normalizeText,
} from "./text";
import {
  classifySemanticFeatures,
  extractSemanticFeatures,
  getTranslationPriority,
  getViewportBand,
} from "./semanticClassifier";

export interface AnalysisOptions {
  maxRegions?: number;
  roots?: ParentNode[];
}

const VIEWPORT_BLOCK_SELECTOR = "button, a, label, summary, [role='button'], [role='tab'], [role='menuitem'], p, li, blockquote, figcaption, dd, dt, h1, h2, h3, h4, h5, h6";

export class PageAnalyzer {
  private readonly regionIds = new WeakMap<HTMLElement, string>();

  private getRegionId(element: HTMLElement): string {
    const existing = this.regionIds.get(element);
    if (existing) return existing;
    const id = createRegionId(element);
    this.regionIds.set(element, id);
    return id;
  }

  analyze(options: AnalysisOptions = {}): TextRegion[] {
    const maxRegions = options.maxRegions ?? 40;
    const blocks = new Map<HTMLElement, string[]>();
    const seededBlocks = new Set<HTMLElement>();
    let boundedUiBlocks = 0;
    const roots = this.compactRoots(options.roots ?? [document.body]);
    if (roots.includes(document.body) && typeof document.elementFromPoint === "function") {
      const xSamples = [innerWidth * 0.2, innerWidth * 0.5, innerWidth * 0.8];
      const step = Math.max(80, innerHeight / 10);
      for (let y = 8; y < innerHeight; y += step) {
        for (const x of xSamples) {
          const hit = document.elementFromPoint(x, y);
          const block = hit?.closest(VIEWPORT_BLOCK_SELECTOR) as HTMLElement | null;
          if (!block || isExcludedElement(block)) continue;
          const text = normalizeText(block.innerText || block.textContent || "");
          if (isLikelyReadableText(text)) {
            blocks.set(block, [text]);
            seededBlocks.add(block);
          }
        }
      }
    }
    for (const root of roots) {
      let scannedTextNodes = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || isExcludedElement(parent) || !isLikelyReadableText(node.nodeValue ?? "")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (walker.nextNode()) {
        scannedTextNodes += 1;
        const node = walker.currentNode as Text;
        const parent = node.parentElement;
        if (!parent) continue;
        const block = (parent.closest(READABLE_BLOCK_SELECTOR) ?? parent) as HTMLElement;
        if (isExcludedElement(block) || !this.belongsToRoots(block, roots)) continue;
        if (seededBlocks.has(block)) continue;
        if (!blocks.has(block) && (
          block.matches("a, button, label, summary, [role='button'], [role='tab'], [role='menuitem']") ||
          Boolean(block.closest("nav, [role='navigation'], [role='menu'], [role='tablist']"))
        )) {
          if (boundedUiBlocks >= maxRegions * 2) continue;
          boundedUiBlocks += 1;
        }
        const texts = blocks.get(block) ?? [];
        texts.push(node.nodeValue ?? "");
        blocks.set(block, texts);
        if (blocks.size >= maxRegions * 30 || scannedTextNodes >= maxRegions * 100) break;
      }
    }

    const candidates: TextRegion[] = [];
    for (const [element, textParts] of blocks) {
      const text = normalizeText(textParts.join(" "));
      if (!isLikelyReadableText(text) || !element.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const language = detectSourceLanguage(text);
      const semanticClass = classifySemanticFeatures(extractSemanticFeatures(element, text, rect));
      const viewportBand = getViewportBand(rect);
      candidates.push({
        id: this.getRegionId(element),
        sourceKey: createSourceKey(text, language),
        element,
        text,
        language,
        semanticClass,
        viewportBand,
        translationPriority: getTranslationPriority(semanticClass, viewportBand),
        rect,
      });
    }
    const sorted = candidates.sort((left, right) => left.translationPriority - right.translationPriority ||
        Math.abs(left.rect.top) - Math.abs(right.rect.top))
      .slice(0, maxRegions * 2)
      .filter((region) => isElementRendered(region.element));
    const limits = { READING: maxRegions, UI: Math.ceil(maxRegions * 0.3), AUXILIARY: Math.ceil(maxRegions * 0.25) };
    const selected: TextRegion[] = [];
    const deferred: TextRegion[] = [];
    const counts = { READING: 0, UI: 0, AUXILIARY: 0 };
    for (const region of sorted) {
      if (counts[region.semanticClass] < limits[region.semanticClass]) {
        selected.push(region);
        counts[region.semanticClass] += 1;
      } else deferred.push(region);
      if (selected.length === maxRegions) return selected;
    }
    return [...selected, ...deferred].slice(0, maxRegions);
  }

  refresh(region: TextRegion): TextRegion | null {
    if (!region.element.isConnected || !isElementRendered(region.element)) return null;
    const analyzed = this.analyze({ roots: [region.element], maxRegions: 2 });
    return analyzed.find((candidate) => candidate.element === region.element) ?? null;
  }

  private compactRoots(roots: ParentNode[]): ParentNode[] {
    const connected = roots.filter((root) => root === document || !(root instanceof Node) || root.isConnected);
    return connected.filter((root, index) => !connected.some((candidate, candidateIndex) => {
      if (index === candidateIndex || !(candidate instanceof Node) || !(root instanceof Node)) return false;
      return candidate.contains(root);
    }));
  }

  private belongsToRoots(element: Element, roots: ParentNode[]): boolean {
    return roots.some((root) => root === element || (root instanceof Node && root.contains(element)));
  }
}
