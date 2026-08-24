import type { InterpretationContext } from "../content/types";

export type ReaderMessage =
  | { type: "SET_READER_ENABLED"; enabled: boolean }
  | { type: "GET_READER_STATE" }
  | { type: "INTERPRET_CONTEXT"; context: InterpretationContext };

export interface ReaderStateResponse {
  enabled: boolean;
}

export type InterpretationProviderResponse =
  | { ok: true; explanation: string; provider: "production-remote" }
  | { ok: false; error: string };
