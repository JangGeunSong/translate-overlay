import type { InterpretationContext, InterpretationResult, TranslationRequest, TranslationResult } from "../types";
import type { LinguisticProvider } from "./provider";

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}

interface TranslatorFactory {
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}

declare global {
  interface Window {
    Translator?: TranslatorFactory;
  }
}

export class BuiltInTranslatorProvider implements LinguisticProvider {
  readonly name = "chrome-built-in-translator";
  private readonly translators = new Map<string, Promise<BrowserTranslator>>();

  private getTranslator(sourceLanguage: string, targetLanguage: string): Promise<BrowserTranslator> {
    if (!window.Translator || sourceLanguage === "unknown") {
      throw new Error("Chrome built-in Translator API is unavailable.");
    }
    const key = `${sourceLanguage}:${targetLanguage}`;
    let translator = this.translators.get(key);
    if (!translator) {
      translator = window.Translator.create({ sourceLanguage, targetLanguage });
      this.translators.set(key, translator);
    }
    return translator;
  }

  async translate(requests: TranslationRequest[]): Promise<TranslationResult[]> {
    if (!window.Translator) throw new Error("Chrome built-in Translator API is unavailable.");
    return Promise.all(
      requests.map(async (request) => {
        const translator = await this.getTranslator(request.sourceLanguage, request.targetLanguage);
        return {
          regionId: request.regionId,
          translatedText: await translator.translate(request.text),
          provider: this.name,
        };
      }),
    );
  }

  async interpret(_context: InterpretationContext): Promise<InterpretationResult> {
    throw new Error("The Translator API does not provide contextual interpretation.");
  }
}
