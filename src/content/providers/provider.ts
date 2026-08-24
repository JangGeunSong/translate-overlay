import type {
  InterpretationContext,
  InterpretationResult,
  TranslationRequest,
  TranslationResult,
} from "../types";

export interface LinguisticProvider {
  readonly name: string;
  translate(requests: TranslationRequest[]): Promise<TranslationResult[]>;
  interpret(context: InterpretationContext): Promise<InterpretationResult>;
}

export class ProviderChain implements LinguisticProvider {
  readonly name = "provider-chain";

  constructor(private readonly providers: LinguisticProvider[]) {}

  async translate(requests: TranslationRequest[]): Promise<TranslationResult[]> {
    for (const provider of this.providers) {
      try {
        return await provider.translate(requests);
      } catch (error) {
        console.debug(`[Context Reader] ${provider.name} translation unavailable`, error);
      }
    }
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
}
