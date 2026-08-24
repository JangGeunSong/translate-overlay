export type SourceLanguage = "en" | "ja" | "zh" | "unknown";

export interface TextRegion {
  id: string;
  sourceKey: string;
  element: HTMLElement;
  text: string;
  language: SourceLanguage;
  rect: DOMRect;
}

export interface TranslationRequest {
  regionId: string;
  requestKey: string;
  text: string;
  sourceLanguage: SourceLanguage;
  targetLanguage: string;
}

export interface TranslationResult {
  regionId: string;
  requestKey: string;
  translatedText: string;
  provider: string;
}

export interface InterpretationContext {
  selectedText: string;
  sentence: string;
  paragraph: string;
  previousParagraph?: string;
  nextParagraph?: string;
  nearestHeading?: string;
  pageTitle: string;
  sourceLanguage: SourceLanguage;
  targetLanguage: string;
}

export interface InterpretationResult {
  explanation: string;
  provider: string;
}

export type ProviderMode =
  | "browser-translator"
  | "production-remote"
  | "development-demo"
  | "unavailable";

export type ProviderCapability = "translation" | "interpretation";

export type ProviderState =
  | "checking"
  | "available"
  | "downloadable"
  | "downloading"
  | "ready"
  | "fallback"
  | "unavailable"
  | "error";

export interface ProviderStatus {
  capability: ProviderCapability;
  mode: ProviderMode;
  state: ProviderState;
  message: string;
  progress?: number;
}
