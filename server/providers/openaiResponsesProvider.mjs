const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const interpretationInstructions = `Explain the selected foreign-language expression to a reader in the requested target language.
Give only the minimum context needed to continue reading: its meaning here, an idiomatic or domain-specific sense, a meaningful literal-versus-contextual difference, or an essential implicit assumption.
Do not retranslate the full passage, start a conversation, repeat the supplied context, or add unrelated background. Use at most four short sentences. Return plain text only.`;
const translationInstructions = `Translate the supplied text from sourceLanguage to targetLanguage.
Preserve meaning, tone, and formatting where practical. Return only the translated text.`;

function extractOutputText(payload) {
  if (!payload || typeof payload !== "object") throw new Error("OpenAI returned an invalid response object.");
  if (payload.error) throw new Error("OpenAI reported a response error.");
  if (payload.status && payload.status !== "completed") throw new Error(`OpenAI response was ${payload.status}.`);
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }
  throw new Error("OpenAI returned no output text.");
}

function retryDelay(response, attempt) {
  const header = response.headers?.get?.("retry-after");
  const seconds = header === null || header === undefined ? Number.NaN : Number(header);
  return Number.isFinite(seconds) ? Math.min(1_000, Math.max(0, seconds * 1_000)) : 150 * (attempt + 1);
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export function createOpenAIResponsesProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
  maxRetries = Number(process.env.OPENAI_MAX_RETRIES ?? 1),
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI linguistic provider.");
  async function requestText(requestInstructions, input, maxOutputTokens, signal) {
    const request = {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal,
      body: JSON.stringify({ model, instructions: requestInstructions, input: JSON.stringify(input), max_output_tokens: maxOutputTokens,
        store: false, text: { verbosity: "low" } }),
    };
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await fetchImpl(OPENAI_RESPONSES_URL, request);
      if (response.ok) return extractOutputText(await response.json());
      if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) {
        throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
      }
      await wait(retryDelay(response, attempt), signal);
    }
    throw new Error("OpenAI Responses API retry loop exhausted.");
  }
  return {
    name: `openai-responses:${model}`,
    async interpret(context, { signal } = {}) {
      return requestText(interpretationInstructions, context, 300, signal);
    },
    async translate(request, { signal } = {}) {
      return requestText(translationInstructions, request, 2_000, signal);
    },
  };
}
