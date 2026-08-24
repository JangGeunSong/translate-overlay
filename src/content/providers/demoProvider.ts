import type { InterpretationContext, InterpretationResult, ProviderStatus, TranslationRequest, TranslationResult } from "../types";
import { ProviderStatusEmitter, type LinguisticProvider } from "./provider";

const PHRASES: Array<[RegExp, string]> = [
  [/The proposal was eventually shelved due to mounting regulatory pressure\.?/giu, "이 제안은 규제 압력이 커지면서 결국 보류되었습니다."],
  [/Welcome/giu, "환영합니다"],
  [/Learn more/giu, "자세히 알아보기"],
  [/Read more/giu, "더 읽기"],
  [/About us/giu, "회사 소개"],
  [/Contact/giu, "문의하기"],
  [/Sign in/giu, "로그인"],
  [/Hello/giu, "안녕하세요"],
  [/This is/giu, "이것은"],
  [/website/giu, "웹사이트"],
  [/こんにちは/gu, "안녕하세요"],
  [/ようこそ/gu, "환영합니다"],
  [/続きを読む/gu, "더 읽기"],
  [/这是/gu, "이것은"],
  [/欢迎/gu, "환영합니다"],
  [/了解更多/gu, "자세히 알아보기"],
];

function demoTranslate(text: string): string {
  let output = text;
  let replaced = false;
  for (const [pattern, korean] of PHRASES) {
    if (pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, korean);
      replaced = true;
    }
    pattern.lastIndex = 0;
  }
  return replaced ? output : `번역 미리보기: ${text}`;
}

export class DemoProvider implements LinguisticProvider {
  readonly name = "deterministic-demo";
  readonly mode = "development-demo" as const;
  private readonly statuses = new ProviderStatusEmitter();

  subscribeStatus(listener: (status: ProviderStatus) => void): () => void {
    return this.statuses.subscribe(listener);
  }

  async translate(requests: TranslationRequest[]): Promise<TranslationResult[]> {
    this.statuses.emit({
      capability: "translation",
      mode: this.mode,
      state: "fallback",
      message: "개발용 번역 사용 중 (제한됨)",
    });
    return requests.map((request) => ({
      regionId: request.regionId,
      requestKey: request.requestKey,
      translatedText: demoTranslate(request.text),
      provider: this.name,
    }));
  }

  async interpret(context: InterpretationContext): Promise<InterpretationResult> {
    this.statuses.emit({
      capability: "interpretation",
      mode: this.mode,
      state: "fallback",
      message: "개발용 문맥 해석 사용 중 (제한됨)",
    });
    const selected = context.selectedText;
    const shelved = /shelved/i.test(selected) || /shelved/i.test(context.sentence);
    const explanation = shelved
      ? "여기서 ‘shelved’는 물건을 선반에 올린다는 뜻이 아니라, 계획이나 제안을 당분간 추진하지 않기로 했다는 의미입니다. 규제 압력이 커진 것이 그 배경입니다."
      : `‘${selected}’의 의미를 문장과 문단 맥락에서 확인하세요. 이 표현은 “${context.sentence}” 안에서 사용되었으며, 주변 주제는 “${context.nearestHeading ?? context.pageTitle}”입니다. 현재 MVP의 오프라인 설명은 구조 검증용이며, 실제 의미 판단에는 해석 제공자 연결이 필요합니다.`;
    return { explanation, provider: this.name };
  }
}
