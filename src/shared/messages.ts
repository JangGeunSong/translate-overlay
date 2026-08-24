export type ReaderMessage =
  | { type: "SET_READER_ENABLED"; enabled: boolean }
  | { type: "GET_READER_STATE" };

export interface ReaderStateResponse {
  enabled: boolean;
}
