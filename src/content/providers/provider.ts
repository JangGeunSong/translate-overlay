import type {
  InterpretationContext,
  InterpretationResult,
  ProviderMode,
  ProviderStatus,
  TranslationRequest,
  TranslationResult,
} from "../types";

export interface LinguisticProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  translate(requests: TranslationRequest[]): Promise<TranslationResult[]>;
  interpret(context: InterpretationContext): Promise<InterpretationResult>;
  subscribeStatus?(listener: (status: ProviderStatus) => void): () => void;
}

export class ProviderStatusEmitter {
  private readonly listeners = new Set<(status: ProviderStatus) => void>();

  subscribe(listener: (status: ProviderStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(status: ProviderStatus): void {
    for (const listener of this.listeners) listener(status);
  }
}

export class ProviderChain implements LinguisticProvider {
  readonly name = "provider-chain";
  readonly mode = "unavailable" as const;
  private readonly statuses = new ProviderStatusEmitter();
  private readonly unsubscribers: Array<() => void>;

  constructor(private readonly providers: LinguisticProvider[]) {
    this.unsubscribers = providers.flatMap((provider) => provider.subscribeStatus
      ? [provider.subscribeStatus((status) => this.statuses.emit(status))]
      : []);
  }

  subscribeStatus(listener: (status: ProviderStatus) => void): () => void {
    return this.statuses.subscribe(listener);
  }

  async translate(requests: TranslationRequest[]): Promise<TranslationResult[]> {
    for (const provider of this.providers) {
      try {
        const results = await provider.translate(requests);
        if (results.length > 0) return results;
      } catch (error) {
        console.debug(`[Context Reader] ${provider.name} translation unavailable`, error);
      }
    }
    this.statuses.emit({
      capability: "translation",
      mode: "unavailable",
      state: "unavailable",
      message: "번역 기능을 사용할 수 없음",
    });
    return [];
  }

  async interpret(context: InterpretationContext): Promise<InterpretationResult> {
    for (const provider of this.providers) {
      try {
        return await provider.interpret(context);
      } catch (error) {
        console.debug(`[Context Reader] ${provider.name} interpretation unavailable`, error);
      }
    }
    throw new Error("No interpretation provider is available.");
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }
}
