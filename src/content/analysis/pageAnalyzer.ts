import type { TextRegion } from "../types";
import {
  READABLE_BLOCK_SELECTOR,
  createRegionId,
  detectSourceLanguage,
  isElementVisible,
  isExcludedElement,
  isLikelyReadableText,
  normalizeText,
} from "./text";

export interface AnalysisOptions {
  maxRegions?: number;
}

export class PageAnalyzer {
  analyze(options: AnalysisOptions = {}): TextRegion[] {
    const maxRegions = options.maxRegions ?? 40;
    const blocks = new Map<HTMLElement, string[]>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
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
      if (isExcludedElement(block)) continue;
      const texts = blocks.get(block) ?? [];
      texts.push(node.nodeValue ?? "");
      blocks.set(block, texts);
    }

    const regions: TextRegion[] = [];
    for (const [element, textParts] of blocks) {
      if (regions.length >= maxRegions) break;
      const text = normalizeText(textParts.join(" "));
      if (!isLikelyReadableText(text) || !isElementVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      regions.push({
        id: createRegionId(element, text),
        element,
        text,
        language: detectSourceLanguage(text),
        rect,
      });
    }
    return regions;
  }
}
