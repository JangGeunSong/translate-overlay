import { createServer } from "node:http";
import { createInterpretationHandler } from "./app.mjs";
import { createMockInterpretationProvider } from "./providers/mockProvider.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponsesProvider.mjs";

const port = Number(process.env.PORT || 8787);
const providerMode = process.env.INTERPRETATION_PROVIDER || "openai";
if (providerMode === "mock" && process.env.NODE_ENV === "production") {
  throw new Error("The mock interpretation provider cannot run in production mode.");
}
const provider = providerMode === "mock"
  ? createMockInterpretationProvider()
  : createOpenAIResponsesProvider();
const allowedOrigins = (process.env.ALLOWED_EXTENSION_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const handler = createInterpretationHandler({
  provider,
  allowedOrigins,
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 30),
  exposeProviderDiagnostics: process.env.EXPOSE_PROVIDER_DIAGNOSTICS === "1" && process.env.NODE_ENV !== "production",
});
const server = createServer(handler);
server.listen(port, "0.0.0.0", () => {
  console.log(`Interpretation backend listening on port ${port} with ${provider.name}.`);
});
