// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  createRegionId,
  createSourceKey,
  createTranslationRequestKey,
  detectSourceLanguage,
  isLikelyReadableText,
  normalizeText,
  isExcludedElement,
} from "../src/content/analysis/text";

describe("text analysis", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("normalizes and filters readable text", () => {
    expect(normalizeText("  Hello\n world  ")).toBe("Hello world");
    expect(isLikelyReadableText("Hello world")).toBe(true);
    expect(isLikelyReadableText("---")).toBe(false);
  });

  it.each([
    ["An English sentence", "en"],
    ["これは日本語です", "ja"],
    ["这是中文句子", "zh"],
    ["12345", "unknown"],
  ] as const)("detects %s as %s", (text, language) => {
    expect(detectSourceLanguage(text)).toBe(language);
  });

  it("creates stable, path-sensitive region identities", () => {
    document.body.innerHTML = "<main><p>Hello world</p><p>Hello world</p></main>";
    const [first, second] = [...document.querySelectorAll("p")];
    expect(createRegionId(first!)).toBe(createRegionId(first!));
    expect(createRegionId(first!)).not.toBe(createRegionId(second!));
    expect(createSourceKey("Changed", "en")).not.toBe(createSourceKey("Hello world", "en"));
    expect(createTranslationRequestKey("Hello world", "en", "ko"))
      .toBe(createTranslationRequestKey("  Hello   world ", "en", "ko"));
  });

  it.each(["USD 129", "usd129.00", "129 USD", "US $ 1,299.99", "€ 129,50", "129,50 EUR",
    "CHF 1’299.00", "￥１２９", "129 元", "129円", "129 dollars", "KRW\u00a0129,000",
    "EUR\u202f1 299,50", "2 pcs", "2件", "数量 2", "Quantity: 2", "Qty=2 units",
    "価格：129円", "Price: USD 129", "Total: $258", "SKU AB12", "SKU：AB-12",
    "Order number AB123", "Order No. AB/123", "订单号 12345", "注文番号 AB123", "12345",
    "Price: USD 129 Quantity: 2", "SKU AB12 | Quantity 2", "USD 129 · 2 pcs"])(
    "protects transaction value %s", text => expect(isLikelyReadableText(text)).toBe(false),
  );

  it.each(["Travel camera 2026 with 2 lenses", "Use 2 batteries for up to 12 hours.",
    "Plan A costs $90 per month.", "Add to cart", "Select blue", "Size", "Red", "数量", "SKU",
    "Order number", "Price", "Ships within 2 days", "2 pack travel adapters"])(
    "keeps meaningful text %s", text => expect(isLikelyReadableText(text)).toBe(true),
  );

  it("respects inherited editing, invalid values, false islands and explicit nested editing", () => {
    document.body.innerHTML = `<div contenteditable="TRUE"><span id="inherited" contenteditable="invalid">draft</span>
      <div contenteditable="false"><b id="help">Help</b><i id="nested" contenteditable="plaintext-only">draft</i></div></div>
      <div role="searchbox"><span id="custom">draft</span></div>`;
    expect(isExcludedElement(document.querySelector("#inherited")!)).toBe(true);
    expect(isExcludedElement(document.querySelector("#help")!)).toBe(false);
    expect(isExcludedElement(document.querySelector("#nested")!)).toBe(true);
    expect(isExcludedElement(document.querySelector("#custom")!)).toBe(true);
  });
});
