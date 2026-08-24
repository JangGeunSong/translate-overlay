import type { InterpretationContext } from "../types";
import { detectSourceLanguage, normalizeText } from "./text";

const PARAGRAPH_SELECTOR = "p, li, blockquote, dd, dt, figcaption";
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const MAX_SELECTED = 300;
const MAX_SENTENCE = 600;
const MAX_PARAGRAPH = 1_200;
const MAX_NEIGHBOR = 600;

function bound(value: string, limit: number): string {
  const normalized = normalizeText(value);
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function sentenceContaining(text: string, selectedText: string): string {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/gu) ?? [text];
  return sentences.find((sentence) => sentence.includes(selectedText)) ?? selectedText;
}

function siblingParagraph(element: Element, direction: "previous" | "next"): string | undefined {
  let cursor: Element | null = element;
  for (let index = 0; index < 3 && cursor; index += 1) {
    cursor = direction === "previous" ? cursor.previousElementSibling : cursor.nextElementSibling;
    if (cursor?.matches(PARAGRAPH_SELECTOR)) return bound(cursor.textContent ?? "", MAX_NEIGHBOR);
  }
  return undefined;
}

function nearestHeading(element: Element): string | undefined {
  let cursor: Element | null = element;
  while (cursor) {
    let sibling = cursor.previousElementSibling;
    while (sibling) {
      if (sibling.matches(HEADING_SELECTOR)) return bound(sibling.textContent ?? "", 300);
      const nested = sibling.querySelector(HEADING_SELECTOR);
      if (nested) return bound(nested.textContent ?? "", 300);
      sibling = sibling.previousElementSibling;
    }
    cursor = cursor.parentElement;
  }
  return undefined;
}

export function collectInterpretationContext(
  selection: Selection,
  targetLanguage = "ko",
): InterpretationContext | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const selectedText = bound(selection.toString(), MAX_SELECTED);
  if (!selectedText) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const element = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement) as
    | Element
    | null;
  if (!element || element.closest("[data-context-reader-root]")) return null;
  const paragraphElement = element.closest(PARAGRAPH_SELECTOR) ?? element;
  const paragraph = bound(paragraphElement.textContent ?? selectedText, MAX_PARAGRAPH);

  return {
    selectedText,
    sentence: bound(sentenceContaining(paragraph, selectedText), MAX_SENTENCE),
    paragraph,
    previousParagraph: siblingParagraph(paragraphElement, "previous"),
    nextParagraph: siblingParagraph(paragraphElement, "next"),
    nearestHeading: nearestHeading(paragraphElement),
    pageTitle: bound(document.title, 300),
    sourceLanguage: detectSourceLanguage(selectedText),
    targetLanguage,
  };
}
