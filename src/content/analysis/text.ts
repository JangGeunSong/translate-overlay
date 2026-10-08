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
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='spinbutton']",
  "[aria-hidden='true']",
  "[hidden]",
  "[data-context-reader-root]",
].join(",");

export const READABLE_BLOCK_SELECTOR =
  "button, a, label, summary, [role='button'], [role='tab'], [role='menuitem'], p, li, blockquote, figcaption, dd, dt, h1, h2, h3, h4, h5, h6, article, section, main";

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
  if (element.closest(EXCLUDED_SELECTOR)) return true;
  // The nearest valid enumerated value wins. Invalid values inherit, and a
  // false island is readable even inside an editable ancestor.
  for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement) {
    const value = cursor.getAttribute("contenteditable")?.toLowerCase();
    if (value === "false") return false;
    if (value === "" || value === "true" || value === "plaintext-only") return true;
  }
  return false;
}

const AMOUNT = String.raw`[+-]?\d(?:[\d\s.,'’]*\d)?`;
const CURRENCY = String.raw`(?:\p{Sc}|US\s*\$|CA\s*\$|AU\s*\$|HK\s*\$|USD|EUR|GBP|JPY|CNY|RMB|KRW|CAD|AUD|HKD|TWD|INR|CHF|元|円|日元|人民币|원|dollars?|euros?|yen|yuan|won)`;
const UNIT = String.raw`(?:pcs?\.?|pieces?|items?|units?|packs?|kg|mg|g|ml|l|cm|mm|m|个|件|份|包|箱|台|套|本|枚|点|個|개)`;
const MONEY = new RegExp(String.raw`^(?:${CURRENCY}\s*${AMOUNT}|${AMOUNT}\s*${CURRENCY})(?:\s*(?:/|per)\s*(?:${UNIT}|month|year))?$`, "iu");
const QUANTITY = new RegExp(String.raw`^${AMOUNT}(?:\s*${UNIT})?$`, "iu");
const DATA_LABEL = /^(?:price|total|subtotal|quantity|qty|数量|数目|価格|价钱|价格|合计|小计|수량|가격)\s*[:：=]?\s*/iu;
const IDENTIFIER = /^(?:sku|order\s*(?:number|no\.?|id|#)|订单号|订单编号|注文番号|品番|商品编号)\s*[:：=#]?\s*([\p{L}\p{N}][\p{L}\p{N}._/-]*)$/iu;
const LABEL_ONLY = /^(?:price|total|subtotal|quantity|qty|sku|order\s*(?:number|no\.?|id|#)|数量|数目|価格|价钱|价格|合计|小计|수량|가격|订单号|订单编号|注文番号|品番|商品编号)\s*[:：=#]?$/iu;

export function isTransactionText(text: string): boolean {
  const value = normalizeText(text.normalize("NFKC"));
  if (!value) return false;
  const fields = value.split(/\s*[|;·]\s*|\s+(?=(?:price|total|subtotal|quantity|qty|sku|order\s+(?:number|id))\b\s*[:=]?\s)/iu);
  if (fields.length > 1 && fields.every(field => isTransactionText(field))) return true;
  if (MONEY.test(value) || QUANTITY.test(value) || IDENTIFIER.test(value)) return true;
  const label = value.match(DATA_LABEL);
  return Boolean(label && (MONEY.test(value.slice(label[0].length)) || QUANTITY.test(value.slice(label[0].length))));
}

// A fresh reader per analysis: no safety decision survives a source mutation.
// Never filter a descendant out and then paint its ancestor's full rectangle.
export function createTranslationTextReader(): (element: Element) => string | null {
  const cache = new WeakMap<Element, { text: string | null; safe: boolean }>();
  const read = (element: Element): { text: string | null; safe: boolean } => {
    const cached = cache.get(element);
    if (cached) return cached;
    let text: string | null = "";
    let safe = !isExcludedElement(element);
    if (!safe) text = null;
    else for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue ?? "";
      else if (child instanceof Element) {
        const result = read(child);
        safe &&= result.safe;
        if (result.text === null) { text = null; break; }
        text += result.text;
      }
      if (text.length > 1_500) { text = null; safe = false; break; }
    }
    if (text !== null) {
      safe &&= !isTransactionText(text);
    }
    const result = { text, safe };
    cache.set(element, result);
    return result;
  };
  return (element) => {
    const result = read(element);
    if (!result.safe || result.text === null) return null;
    const text = normalizeText(result.text);
    // A split SKU/order value may be letters only. Keep its separate label,
    // but do not promote the value when its data block was rejected.
    if (!LABEL_ONLY.test(text) && /^[\p{L}\p{N}._/$€£¥-]+$/u.test(text)) {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const parentText = read(parent).text;
        if (parentText !== null && isTransactionText(parentText)) return null;
        if (parent.matches(READABLE_BLOCK_SELECTOR)) break;
      }
    }
    return text;
  };
}

export function isLikelyReadableText(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < 2 || normalized.length > 1_500) return false;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return false;
  if (isTransactionText(normalized)) return false;
  return detectSourceLanguage(normalized) !== "unknown";
}

export function isElementRendered(element: Element): boolean {
  const html = element as HTMLElement;
  if (!html.isConnected || isExcludedElement(html)) return false;
  if (typeof html.checkVisibility === "function" && !html.checkVisibility({
    checkOpacity: true,
    checkVisibilityCSS: true,
  })) {
    return false;
  }
  const style = getComputedStyle(html);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = html.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

export function isElementVisible(element: Element): boolean {
  if (!isElementRendered(element)) return false;
  const rect = element.getBoundingClientRect();
  return rect.bottom >= -100 && rect.top <= window.innerHeight + 100 && rect.right >= 0 && rect.left <= window.innerWidth;
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

export function createRegionId(element: Element): string {
  return `region-${hashString(elementPath(element))}`;
}

export function createSourceKey(text: string, language: SourceLanguage): string {
  return hashString(`${language}|${normalizeText(text)}`);
}

export function createTranslationRequestKey(
  text: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: string,
): string {
  return hashString(`${sourceLanguage}|${targetLanguage}|${normalizeText(text)}`);
}
