export type SourceLanguage = "en" | "ja" | "zh" | "unknown";

export interface TextRegion {
  id: string;
  element: HTMLElement;
  text: string;
  language: SourceLanguage;
  rect: DOMRect;
}

export interface TranslationRequest {
  regionId: string;
  text: string;
  sourceLanguage: SourceLanguage;
  targetLanguage: string;
}

export interface TranslationResult {
  regionId: string;
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
