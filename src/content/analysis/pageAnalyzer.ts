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
    const roots = this.compactRoots(options.roots ?? [document.body]);
    for (const root of roots) {
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
        const node = walker.currentNode as Text;
        const parent = node.parentElement;
        if (!parent) continue;
        const block = (parent.closest(READABLE_BLOCK_SELECTOR) ?? parent) as HTMLElement;
        if (isExcludedElement(block) || !this.belongsToRoots(block, roots)) continue;
        const texts = blocks.get(block) ?? [];
        texts.push(node.nodeValue ?? "");
        blocks.set(block, texts);
      }
    }

    const regions: TextRegion[] = [];
    for (const [element, textParts] of blocks) {
      const text = normalizeText(textParts.join(" "));
      if (!isLikelyReadableText(text) || !isElementRendered(element)) continue;
      const rect = element.getBoundingClientRect();
      const language = detectSourceLanguage(text);
      const semanticClass = classifySemanticFeatures(extractSemanticFeatures(element, text, rect));
      const viewportBand = getViewportBand(rect);
      regions.push({
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
    return regions
      .sort((left, right) => left.translationPriority - right.translationPriority ||
        Math.abs(left.rect.top) - Math.abs(right.rect.top))
      .slice(0, maxRegions);
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
