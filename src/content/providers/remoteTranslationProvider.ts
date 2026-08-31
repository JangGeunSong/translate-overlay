import type { InterpretationContext, InterpretationResult, ProviderStatus, TranslationRequest, TranslationResult } from "../types";
import type { ReaderMessage, TranslationProviderResponse } from "../../shared/messages";
import { ProviderStatusEmitter, type LinguisticProvider } from "./provider";

export class RemoteTranslationProvider implements LinguisticProvider {
  readonly name = "production-remote";
  readonly mode = "production-remote" as const;
  private readonly statuses = new ProviderStatusEmitter();

  subscribeStatus(listener: (status: ProviderStatus) => void): () => void {
    return this.statuses.subscribe(listener);
  }

  async translate(requests: TranslationRequest[]): Promise<TranslationResult[]> {
    this.emit("checking", "원격 번역 연결 확인 중");
    const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_REMOTE", requests } satisfies ReaderMessage) as TranslationProviderResponse;
    if (!response?.ok) {
      this.emit("unavailable", "원격 번역을 사용할 수 없음");
      throw new Error(response?.error ?? "The production translation provider is unavailable.");
    }
    this.emit("ready", "원격 번역 준비됨");
    return response.translations;
  }

  async interpret(_context: InterpretationContext): Promise<InterpretationResult> {
    throw new Error("The production remote translation provider is translation-only.");
  }

  private emit(state: ProviderStatus["state"], message: string): void {
    this.statuses.emit({ capability: "translation", mode: this.mode, state, message });
  }
}
