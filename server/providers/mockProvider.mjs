export function createMockInterpretationProvider({ delayMs = 15 } = {}) {
  return {
    name: "local-e2e-mock",
    async interpret(context, { signal } = {}) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      if (/shelved/iu.test(context.selectedText) || /shelved/iu.test(context.sentence)) {
        return "여기서 shelved는 선반에 올려놓는다는 뜻이 아니라, 규제 압력 때문에 제안 추진을 보류했다는 문맥적 의미입니다.";
      }
      return `선택한 “${context.selectedText}”는 현재 문장과 문단 안에서 이해해야 하는 표현입니다.`;
    },
  };
}
