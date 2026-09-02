import { createServer } from "node:http";
import { createInterpretationHandler } from "./app.mjs";
import { readServerConfig } from "./config.mjs";
import { createMockInterpretationProvider } from "./providers/mockProvider.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponsesProvider.mjs";

const config = readServerConfig();
const provider = config.providerMode === "mock"
  ? createMockInterpretationProvider()
  : createOpenAIResponsesProvider(config.openAI);
const handler = createInterpretationHandler({
  provider,
  allowedOrigins: config.allowedOrigins,
  timeoutMs: config.timeoutMs,
  rateLimitPerMinute: config.rateLimitPerMinute,
  exposeProviderDiagnostics: config.exposeProviderDiagnostics,
});
const server = createServer(handler);
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Linguistic backend listening on port ${config.port} with ${provider.name}.`);
});
