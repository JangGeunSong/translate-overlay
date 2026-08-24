import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInterpretationHandler } from "./app.mjs";
import { validateInterpretationEnvelope } from "./contract.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponsesProvider.mjs";

const context = { selectedText: "shelved", sentence: "The proposal was eventually shelved.", paragraph: "The proposal was eventually shelved.",
  previousParagraph: "Earlier context.", nextParagraph: "Later context.", nearestHeading: "Policy",
  pageTitle: "Fixture", sourceLanguage: "en", targetLanguage: "ko" };
const envelope = { version: 1, operation: "interpret", context, response: { language: "ko", maximumCharacters: 1200 } };
const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))));

describe("interpretation backend", () => {
  it("accepts only the bounded versioned context contract", () => {
    expect(validateInterpretationEnvelope(envelope).ok).toBe(true);
    expect(validateInterpretationEnvelope({ ...envelope, version: 2 }).ok).toBe(false);
    expect(validateInterpretationEnvelope({ ...envelope, context: { ...context, selectedText: "x".repeat(301) } }).ok).toBe(false);
  });

  it("keeps credentials server-side and uses the Responses API contract", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ output_text: "문맥 설명" }) }));
    const provider = createOpenAIResponsesProvider({ apiKey: "server-test-secret", model: "test-model", fetchImpl });
    expect(await provider.interpret(context)).toBe("문맥 설명");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers.authorization).toBe("Bearer server-test-secret");
    expect(JSON.parse(init.body)).toMatchObject({ model: "test-model", store: false, text: { verbosity: "low" } });
  });

  it("serves the full local HTTP contract and normalizes responses", async () => {
    const seen = [];
    const handler = createInterpretationHandler({ allowedOrigins: [], provider: {
      name: "fixture", interpret: async (value) => { seen.push(value); return "  짧은 문맥 설명  "; } } });
    const server = createServer(handler); servers.push(server);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/interpret`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 1, explanation: "짧은 문맥 설명", provider: "fixture" });
    expect(seen).toEqual([context]);
  });
});
