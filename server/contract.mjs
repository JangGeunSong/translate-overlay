export const CONTRACT_VERSION = 1;
export const MAX_REQUEST_BYTES = 16_384;
export const MAX_EXPLANATION_LENGTH = 1_200;

const limits = {
  selectedText: 300,
  sentence: 600,
  paragraph: 1_200,
  previousParagraph: 600,
  nextParagraph: 600,
  nearestHeading: 300,
  pageTitle: 300,
  sourceLanguage: 35,
  targetLanguage: 35,
};

export function validateInterpretationEnvelope(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Request body must be an object." };
  if (payload.version !== CONTRACT_VERSION) return { ok: false, error: "Unsupported interpretation contract version." };
  if (payload.operation !== "interpret") return { ok: false, error: "Unsupported operation." };
  const context = payload.context;
  if (!context || typeof context !== "object") return { ok: false, error: "Context is required." };
  for (const [field, maximum] of Object.entries(limits)) {
    const value = context[field];
    const optional = field === "previousParagraph" || field === "nextParagraph" || field === "nearestHeading";
    if (optional && value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
      return { ok: false, error: `Invalid context field: ${field}.` };
    }
  }
  if (payload.response?.language !== context.targetLanguage) {
    return { ok: false, error: "Response language must match the target language." };
  }
  return { ok: true, context };
}

export function normalizeExplanation(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Provider returned an empty explanation.");
  return value.trim().slice(0, MAX_EXPLANATION_LENGTH);
}
