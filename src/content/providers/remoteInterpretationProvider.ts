import type { InterpretationContext, InterpretationResult, ProviderStatus, TranslationRequest, TranslationResult } from "../types";
import type { InterpretationProviderResponse, ReaderMessage } from "../../shared/messages";
import { ProviderStatusEmitter, type LinguisticProvider } from "./provider";

export class RemoteInterpretationProvider implements LinguisticProvider {
  readonly name = "production-remote";
  readonly mode = "production-remote" as const;
  private readonly statuses = new ProviderStatusEmitter();
  subscribeStatus(listener: (status: ProviderStatus) => void): () => void { return this.statuses.subscribe(listener); }
  async translate(_requests: TranslationRequest[]): Promise<TranslationResult[]> {
    throw new Error("The production remote provider is interpretation-only in this task.");
  }
  async interpret(context: InterpretationContext): Promise<InterpretationResult> {
    this.statuses.emit({ capability: "interpretation", mode: this.mode, state: "checking", message: "제품 문맥 해석 연결 확인 중" });
    const response = await chrome.runtime.sendMessage({ type: "INTERPRET_CONTEXT", context } satisfies ReaderMessage) as InterpretationProviderResponse;
    if (!response?.ok) {
      this.statuses.emit({ capability: "interpretation", mode: this.mode, state: "unavailable", message: "제품 문맥 해석을 사용할 수 없음" });
      throw new Error(response?.error ?? "The production interpretation provider is unavailable.");
    }
    this.statuses.emit({ capability: "interpretation", mode: this.mode, state: "ready", message: "제품 문맥 해석 준비됨" });
    return { explanation: response.explanation, provider: response.provider };
  }
}
