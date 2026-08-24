import { createTranslationRequestKey } from "./text";
import type { TextRegion, TranslationResult } from "../types";

export function translationKeyForRegion(region: TextRegion, targetLanguage: string): string {
  return createTranslationRequestKey(region.text, region.language, targetLanguage);
}

export interface CachedTranslation {
  translatedText: string;
  provider: string;
}

export class TranslationCache {
  private readonly entries = new Map<string, CachedTranslation>();

  get(region: TextRegion, targetLanguage: string): TranslationResult | undefined {
    const requestKey = translationKeyForRegion(region, targetLanguage);
    const cached = this.entries.get(requestKey);
    return cached ? { regionId: region.id, requestKey, ...cached } : undefined;
  }

  set(result: TranslationResult): void {
    this.entries.set(result.requestKey, {
      translatedText: result.translatedText,
      provider: result.provider,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}
