import type { SourceLanguage } from "../types";

const EXCLUDED_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "textarea",
  "input",
  "select",
  "option",
  "[aria-hidden='true']",
  "[hidden]",
  "[data-context-reader-root]",
].join(",");

export const READABLE_BLOCK_SELECTOR =
  "p, li, blockquote, figcaption, dd, dt, h1, h2, h3, h4, h5, h6, article, section, main";

export function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function detectSourceLanguage(text: string): SourceLanguage {
  const normalized = normalizeText(text);
  if (!normalized) return "unknown";
  const japanese = (normalized.match(/[\u3040-\u30ff]/gu) ?? []).length;
  const han = (normalized.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const latin = (normalized.match(/[A-Za-z]/gu) ?? []).length;

  if (japanese > 0) return "ja";
  if (han > 0) return "zh";
  if (latin >= Math.max(3, normalized.length * 0.25)) return "en";
  return "unknown";
}

export function isExcludedElement(element: Element): boolean {
  return Boolean(element.closest(EXCLUDED_SELECTOR));
}

export function isLikelyReadableText(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < 2 || normalized.length > 1_500) return false;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return false;
  return detectSourceLanguage(normalized) !== "unknown";
}

export function isElementVisible(element: Element): boolean {
  const html = element as HTMLElement;
  const style = getComputedStyle(html);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = html.getBoundingClientRect();
  return (
    rect.width > 1 &&
    rect.height > 1 &&
    rect.bottom >= -100 &&
    rect.top <= window.innerHeight + 100 &&
    rect.right >= 0 &&
    rect.left <= window.innerWidth
  );
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function elementPath(element: Element): string {
  const segments: string[] = [];
  let cursor: Element | null = element;
  while (cursor && cursor !== document.documentElement) {
    let index = 1;
    let sibling = cursor.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === cursor.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    segments.push(`${cursor.tagName.toLowerCase()}:${index}`);
    cursor = cursor.parentElement;
  }
  return segments.reverse().join("/");
}

export function createRegionId(element: Element, text: string): string {
  return `region-${hashString(`${elementPath(element)}|${normalizeText(text)}`)}`;
}
