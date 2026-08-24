import type { SemanticClass, ViewportBand } from "../types";

export interface SemanticFeatures {
  tagName: string;
  role?: string;
  textLength: number;
  interactive: boolean;
  inArticle: boolean;
  inMain: boolean;
  inNavigation: boolean;
  inAside: boolean;
  inFooter: boolean;
  auxiliaryHint: boolean;
  linkDensity: number;
  width: number;
  height: number;
}

const UI_TAGS = new Set(["button", "label", "select", "option", "summary"]);
const UI_ROLES = new Set(["button", "menu", "menuitem", "navigation", "tab", "switch", "option", "combobox"]);
const READING_TAGS = new Set(["article", "p", "blockquote", "figcaption", "dd", "dt"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function classifySemanticFeatures(features: SemanticFeatures): SemanticClass {
  const tag = features.tagName.toLowerCase();
  const role = features.role?.toLowerCase();
  if (features.interactive || UI_TAGS.has(tag) || (role && UI_ROLES.has(role)) || features.inNavigation) {
    return "UI";
  }
  if (
    features.inFooter ||
    features.inAside ||
    features.auxiliaryHint ||
    (features.linkDensity >= 0.65 && features.textLength < 280)
  ) {
    return "AUXILIARY";
  }
  if (HEADING_TAGS.has(tag) || features.inArticle) return "READING";
  if (READING_TAGS.has(tag) && (features.inMain || features.textLength >= 36)) return "READING";
  if (features.inMain && features.textLength >= 60 && features.width >= 180 && features.height >= 20) {
    return "READING";
  }
  return "AUXILIARY";
}

export function extractSemanticFeatures(element: HTMLElement, text: string, rect: DOMRect): SemanticFeatures {
  const linkedTextLength = [...element.querySelectorAll("a")]
    .reduce((total, link) => total + (link.textContent?.trim().length ?? 0), 0) +
    (element.matches("a") ? text.length : 0);
  const semanticHint = [element.id, element.className, element.getAttribute("aria-label") ?? ""]
    .join(" ")
    .toLowerCase();
  return {
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? undefined,
    textLength: text.length,
    interactive: Boolean(element.closest("a, button, input, select, textarea, [role='button'], [role='tab'], [role='menuitem']")),
    inArticle: Boolean(element.closest("article, [role='article']")),
    inMain: Boolean(element.closest("main, [role='main']")),
    inNavigation: Boolean(element.closest("nav, [role='navigation'], [role='menu'], [role='tablist']")),
    inAside: Boolean(element.closest("aside, [role='complementary']")),
    inFooter: Boolean(element.closest("footer, [role='contentinfo']")),
    auxiliaryHint: /(?:author|byline|meta|timestamp|date|related|ranking|sidebar|footnote|legal|caption|breadcrumb)/u.test(semanticHint) ||
      Boolean(element.closest("time, address")),
    linkDensity: Math.min(1, linkedTextLength / Math.max(1, text.length)),
    width: rect.width,
    height: rect.height,
  };
}

export function getViewportBand(rect: DOMRect, viewportHeight = window.innerHeight): ViewportBand {
  if (rect.bottom >= 0 && rect.top <= viewportHeight) return "VIEWPORT";
  if (rect.bottom >= -viewportHeight && rect.top <= viewportHeight * 2) return "NEAR";
  return "FAR";
}

export function getTranslationPriority(semanticClass: SemanticClass, viewportBand: ViewportBand): number {
  if (viewportBand === "VIEWPORT") return semanticClass === "READING" ? 0 : 1;
  if (viewportBand === "NEAR") return semanticClass === "READING" ? 2 : 3;
  return semanticClass === "READING" ? 4 : 5;
}
