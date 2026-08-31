import type { InterpretationContext, TranslationRequest, TranslationResult } from "../content/types";

export type ReaderMessage =
  | { type: "SET_READER_ENABLED"; enabled: boolean }
  | { type: "GET_READER_STATE" }
  | { type: "TRANSLATE_REMOTE"; requests: TranslationRequest[] }
  | { type: "INTERPRET_CONTEXT"; context: InterpretationContext };

export interface ReaderStateResponse {
  enabled: boolean;
}

export type InterpretationProviderResponse =
  | { ok: true; explanation: string; provider: "production-remote" }
  | { ok: false; error: string };

export type TranslationProviderResponse =
  | { ok: true; translations: TranslationResult[]; provider: "production-remote" }
  | { ok: false; error: string };
