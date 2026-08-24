const DEFAULT_MODEL = "gpt-5.6-luna";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const instructions = `You explain a selected foreign-language expression to a reader in their target language.
Be concise, context-specific, and reading-oriented. Explain the contextual or idiomatic meaning, any important literal-versus-contextual difference, and only the implicit background needed to understand the passage.
Do not start a conversation, give unrelated advice, or repeat all supplied context. Use at most five short sentences.`;

function extractOutputText(payload) {
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

export function createOpenAIResponsesProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI interpretation provider.");
  return {
    name: `openai-responses:${model}`,
    async interpret(context, { signal } = {}) {
      const response = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model,
          instructions,
          input: JSON.stringify(context),
          max_output_tokens: 300,
          store: false,
          text: { verbosity: "low" },
        }),
      });
      if (!response.ok) throw new Error(`OpenAI Responses API returned HTTP ${response.status}.`);
      return extractOutputText(await response.json());
    },
  };
}
