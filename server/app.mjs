import {
  MAX_EXPLANATION_LENGTH,
  MAX_REQUEST_BYTES,
  MAX_TRANSLATION_LENGTH,
  normalizeExplanation,
  normalizeTranslation,
  validateInterpretationEnvelope,
  validateTranslationEnvelope,
} from "./contract.mjs";

function json(response, status, body, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createInterpretationHandler({
  provider,
  allowedOrigins = [],
  timeoutMs = 12_000,
  rateLimitPerMinute = 30,
  exposeProviderDiagnostics = false,
  logger = console,
  now = () => Date.now(),
}) {
  const requestsByAddress = new Map();
  return async function handle(request, response) {
    const origin = request.headers.origin;
    const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : undefined;
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return json(response, 403, { error: "Origin is not allowed." });
      response.writeHead(204, {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin",
      });
      return response.end();
    }
    if (request.method === "GET" && request.url === "/health") {
      return json(response, 200, { ok: true, provider: provider.name });
    }
    const operation = request.url === "/interpret" ? "interpret" : request.url === "/translate" ? "translate" : undefined;
    if (request.method !== "POST" || !operation) {
      return json(response, 404, { error: "Not found." }, allowedOrigin);
    }
    if (origin && !allowedOrigin) return json(response, 403, { error: "Origin is not allowed." });

    const address = request.socket.remoteAddress ?? "unknown";
    const minute = Math.floor(now() / 60_000);
    const rate = requestsByAddress.get(address);
    if (!rate || rate.minute !== minute) requestsByAddress.set(address, { minute, count: 1 });
    else if (++rate.count > rateLimitPerMinute) return json(response, 429, { error: "Rate limit exceeded." }, allowedOrigin);

    try {
      const validation = operation === "interpret"
        ? validateInterpretationEnvelope(await readJson(request))
        : validateTranslationEnvelope(await readJson(request));
      if (!validation.ok) return json(response, 400, { error: validation.error }, allowedOrigin);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("Provider timeout.")), timeoutMs);
      try {
        if (operation === "interpret") {
          const explanation = normalizeExplanation(await provider.interpret(validation.context, { signal: controller.signal }));
          return json(response, 200, {
            version: 1,
            explanation,
            ...(exposeProviderDiagnostics ? { provider: provider.name } : {}),
            maximumCharacters: MAX_EXPLANATION_LENGTH,
          }, allowedOrigin);
        }
        const translations = await Promise.all(validation.requests.map(async (translationRequest) => ({
          requestKey: translationRequest.requestKey,
          translatedText: normalizeTranslation(await provider.translate(translationRequest, { signal: controller.signal })),
        })));
        return json(response, 200, {
          version: 1,
          translations,
          ...(exposeProviderDiagnostics ? { provider: provider.name } : {}),
          maximumCharactersPerTranslation: MAX_TRANSLATION_LENGTH,
        }, allowedOrigin);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (error instanceof SyntaxError) return json(response, 400, { error: "Invalid JSON." }, allowedOrigin);
      if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
        return json(response, 413, { error: "Request body is too large." }, allowedOrigin);
      }
      logger.error(`${operation === "interpret" ? "Interpretation" : "Translation"} provider request failed.`);
      return json(response, 502, { error: `${operation === "interpret" ? "Interpretation" : "Translation"} provider failed.` }, allowedOrigin);
    }
  };
}
