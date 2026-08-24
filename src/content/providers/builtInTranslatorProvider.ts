import type { InterpretationContext, InterpretationResult, ProviderStatus, TranslationRequest, TranslationResult } from "../types";
import { ProviderStatusEmitter, type LinguisticProvider } from "./provider";

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}

interface TranslatorFactory {
  availability?(options: { sourceLanguage: string; targetLanguage: string }): Promise<
    "available" | "downloadable" | "downloading" | "unavailable"
  >;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: EventTarget) => void;
  }): Promise<BrowserTranslator>;
}

declare global {
  interface Window {
    Translator?: TranslatorFactory;
  }
}

export class BuiltInTranslatorProvider implements LinguisticProvider {
  readonly name = "chrome-built-in-translator";
  readonly mode = "browser-translator" as const;
  private readonly translators = new Map<string, Promise<BrowserTranslator>>();
  private readonly statuses = new ProviderStatusEmitter();

  subscribeStatus(listener: (status: ProviderStatus) => void): () => void {
    return this.statuses.subscribe(listener);
  }

  private async getTranslator(sourceLanguage: string, targetLanguage: string): Promise<BrowserTranslator> {
    if (!window.Translator || sourceLanguage === "unknown") {
      this.emit("unavailable", "브라우저 번역을 사용할 수 없음");
      throw new Error("Chrome built-in Translator API is unavailable.");
    }
    const key = `${sourceLanguage}:${targetLanguage}`;
    let translator = this.translators.get(key);
    if (!translator) {
      const availability = await window.Translator.availability?.({ sourceLanguage, targetLanguage }) ?? "available";
      if (availability === "unavailable") {
        this.emit("unavailable", "이 언어 조합은 브라우저 번역을 지원하지 않음");
        throw new Error(`Translator language pair is unavailable: ${key}`);
      }
      if (availability === "available") this.emit("available", "브라우저 번역 사용 가능");
      if (availability === "downloadable") this.emit("downloadable", "번역 언어 모델 준비 필요");
      if (availability === "downloading") this.emit("downloading", "번역 언어 모델 준비 중");
      const factory = window.Translator;
      translator = factory.create({
        sourceLanguage,
        targetLanguage,
        monitor: (monitor) => monitor.addEventListener("downloadprogress", (event) => {
          const loaded = "loaded" in event ? Number(event.loaded) : 0;
          this.emit("downloading", "번역 언어 모델 다운로드 중", Math.round(loaded * 100));
        }),
      }).then((created) => {
        this.emit("ready", "브라우저 번역 준비됨");
        return created;
      }).catch((error) => {
        this.translators.delete(key);
        this.emit("error", "브라우저 번역 준비 실패");
        throw error;
      });
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
          requestKey: request.requestKey,
          translatedText: await translator.translate(request.text),
          provider: this.name,
        };
      }),
    );
  }

  async interpret(_context: InterpretationContext): Promise<InterpretationResult> {
    throw new Error("The Translator API does not provide contextual interpretation.");
  }

  private emit(state: ProviderStatus["state"], message: string, progress?: number): void {
    this.statuses.emit({
      capability: "translation",
      mode: this.mode,
      state,
      message,
      progress,
    });
  }
}
