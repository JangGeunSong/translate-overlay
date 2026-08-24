import type { InterpretationContext, InterpretationResult, ProviderStatus, TranslationRequest, TranslationResult } from "../types";
import { ProviderStatusEmitter, type LinguisticProvider } from "./provider";

const PHRASES: Array<[RegExp, string]> = [
  [/The proposal was eventually shelved due to mounting regulatory pressure\.?/giu, "이 제안은 규제 압력이 커지면서 결국 보류되었습니다."],
  [/Welcome/giu, "환영합니다"], [/Learn more/giu, "자세히 알아보기"], [/Read more/giu, "더 읽기"],
  [/About us/giu, "회사 소개"], [/Contact/giu, "문의하기"], [/Sign in/giu, "로그인"],
  [/Hello/giu, "안녕하세요"], [/This is/giu, "이것은"], [/website/giu, "웹사이트"],
  [/Article documentation guide/giu, "문서 읽기 안내"],
  [/Delayed article content is now available\.?/giu, "지연된 문서 내용을 이제 읽을 수 있습니다."],
  [/Subscription plans/giu, "구독 요금제"],
  [/Plan A costs \$90 per month\.?/giu, "A 요금제는 월 90달러입니다."],
  [/Plan B costs \$120 per month\.?/giu, "B 요금제는 월 120달러입니다."],
  [/This option is currently visible\.?/giu, "이 옵션은 현재 표시되어 있습니다."],
  [/This temporary offer can be removed\.?/giu, "이 임시 혜택은 제거할 수 있습니다."],
  [/Rapid (?:initial|final) state\.?/giu, "빠른 변경의 현재 상태입니다."],
  [/SPA (?:home|details) route/giu, "SPA 현재 경로"],
  [/Current client-side route is (?:home|details)\.?/giu, "현재 클라이언트 경로입니다."],
  [/Author metadata/giu, "작성자 정보"], [/Related reading links/giu, "관련 읽을거리"],
  [/Choose Plan B/giu, "B 요금제 선택"], [/Navigate in application/giu, "앱에서 이동"],
];

function demoTranslate(text: string): string | undefined {
  let output = text; let replaced = false;
  for (const [pattern, korean] of PHRASES) {
    if (pattern.test(output)) { pattern.lastIndex = 0; output = output.replace(pattern, korean); replaced = true; }
    pattern.lastIndex = 0;
  }
  return replaced ? output : undefined;
}

export class DemoProvider implements LinguisticProvider {
  readonly name = "deterministic-demo";
  readonly mode = "development-demo" as const;
  private readonly statuses = new ProviderStatusEmitter();
  subscribeStatus(listener: (status: ProviderStatus) => void): () => void { return this.statuses.subscribe(listener); }
  async translate(requests: TranslationRequest[]): Promise<TranslationResult[]> {
    this.statuses.emit({ capability: "translation", mode: this.mode, state: "fallback", message: "개발용 제한 번역 사용 중" });
    return requests.flatMap((request) => {
      const translatedText = demoTranslate(request.text);
      return translatedText ? [{ regionId: request.regionId, requestKey: request.requestKey, translatedText, provider: this.name }] : [];
    });
  }
  async interpret(context: InterpretationContext): Promise<InterpretationResult> {
    this.statuses.emit({ capability: "interpretation", mode: this.mode, state: "fallback", message: "개발용 문맥 해석 사용 중" });
    const shelved = /shelved/i.test(context.selectedText) || /shelved/i.test(context.sentence);
    const explanation = shelved
      ? "여기서 shelved는 물건을 선반에 올린다는 뜻이 아니라, 계획이나 제안을 당분간 추진하지 않기로 했다는 뜻입니다. 규제 압력이 커진 것이 그 배경입니다."
      : `“${context.selectedText}”의 의미를 현재 문장과 문단의 맥락에서 확인하세요. 이 개발용 설명은 구조 검증을 위한 fallback입니다.`;
    return { explanation, provider: this.name };
  }
}
