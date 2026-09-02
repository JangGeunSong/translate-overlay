import { createServer } from "node:http";
import { createInterpretationHandler } from "./app.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponsesProvider.mjs";

if (process.env.RUN_REAL_PROVIDER_TEST !== "1") {
  console.error("Set RUN_REAL_PROVIDER_TEST=1 to opt in to the billable real-provider smoke test.");
  process.exitCode = 2;
} else if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY must be supplied to the server process.");
  process.exitCode = 2;
} else {
  const provider = createOpenAIResponsesProvider();
  const server = createServer(createInterpretationHandler({ provider, allowedOrigins: [] }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startedAt = performance.now();
  try {
    const [interpretationResponse, translationResponse] = await Promise.all([
      fetch(`${baseUrl}/interpret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        version: 1,
        operation: "interpret",
        context: {
          selectedText: "shelved",
          sentence: "The proposal was eventually shelved due to mounting regulatory pressure.",
          paragraph: "The proposal was eventually shelved due to mounting regulatory pressure.",
          previousParagraph: "The committee had considered the proposal for several months.",
          nextParagraph: "A revised proposal may be submitted later.",
          nearestHeading: "Regulatory review",
          pageTitle: "Policy update",
          sourceLanguage: "en",
          targetLanguage: "ko",
        },
        response: { language: "ko", maximumCharacters: 1_200 },
      }) }),
      fetch(`${baseUrl}/translate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        version: 1,
        operation: "translate",
        requests: [{ requestKey: "real-provider-smoke", text: "The proposal was eventually shelved.", sourceLanguage: "en", targetLanguage: "ko" }],
        response: { maximumCharactersPerTranslation: 8_000 },
      }) }),
    ]);
    if (!interpretationResponse.ok || !translationResponse.ok) {
      throw new Error(`Real-provider backend smoke failed (${interpretationResponse.status}/${translationResponse.status}).`);
    }
    const interpretation = await interpretationResponse.json();
    const translation = await translationResponse.json();
    console.log(JSON.stringify({
      provider: provider.name,
      latencyMs: performance.now() - startedAt,
      explanationCharacters: interpretation.explanation.length,
      translationCharacters: translation.translations[0].translatedText.length,
    }));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
