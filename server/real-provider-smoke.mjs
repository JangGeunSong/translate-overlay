import { createOpenAIResponsesProvider } from "./providers/openaiResponsesProvider.mjs";

if (process.env.RUN_REAL_PROVIDER_TEST !== "1") {
  console.error("Set RUN_REAL_PROVIDER_TEST=1 to opt in to the billable real-provider smoke test.");
  process.exitCode = 2;
} else if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY must be supplied to the server process.");
  process.exitCode = 2;
} else {
  const provider = createOpenAIResponsesProvider();
  const startedAt = performance.now();
  const explanation = await provider.interpret({
    selectedText: "shelved",
    sentence: "The proposal was eventually shelved due to mounting regulatory pressure.",
    paragraph: "The proposal was eventually shelved due to mounting regulatory pressure.",
    previousParagraph: "The committee had considered the proposal for several months.",
    nextParagraph: "A revised proposal may be submitted later.",
    nearestHeading: "Regulatory review",
    pageTitle: "Policy update",
    sourceLanguage: "en",
    targetLanguage: "ko",
  });
  console.log(JSON.stringify({ provider: provider.name, latencyMs: performance.now() - startedAt, explanationCharacters: explanation.length }));
}
