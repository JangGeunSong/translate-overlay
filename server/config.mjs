const DEFAULT_MODEL = "gpt-5.6-luna";

function parseInteger(value, name, fallback, { minimum, maximum }) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseAllowedOrigins(value) {
  const origins = (value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  for (const origin of origins) {
    if (!/^chrome-extension:\/\/[a-p]{32}$/u.test(origin)) {
      throw new Error("ALLOWED_EXTENSION_ORIGINS must contain exact chrome-extension:// origins.");
    }
  }
  return [...new Set(origins)];
}

export function readServerConfig(environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const providerMode = environment.INTERPRETATION_PROVIDER || "openai";
  if (providerMode !== "openai" && providerMode !== "mock") {
    throw new Error("INTERPRETATION_PROVIDER must be either openai or mock.");
  }
  if (production && providerMode === "mock") {
    throw new Error("The mock linguistic provider cannot run in production mode.");
  }

  const allowedOrigins = parseAllowedOrigins(environment.ALLOWED_EXTENSION_ORIGINS);
  if (production && allowedOrigins.length === 0) {
    throw new Error("ALLOWED_EXTENSION_ORIGINS is required in production.");
  }

  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (providerMode === "openai" && !apiKey) {
    throw new Error("OPENAI_API_KEY is required for the OpenAI linguistic provider.");
  }
  const model = environment.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  return {
    port: parseInteger(environment.PORT, "PORT", 8787, { minimum: 1, maximum: 65_535 }),
    providerMode,
    allowedOrigins,
    timeoutMs: parseInteger(environment.PROVIDER_TIMEOUT_MS, "PROVIDER_TIMEOUT_MS", 12_000, { minimum: 100, maximum: 60_000 }),
    rateLimitPerMinute: parseInteger(environment.RATE_LIMIT_PER_MINUTE, "RATE_LIMIT_PER_MINUTE", 30, { minimum: 1, maximum: 10_000 }),
    exposeProviderDiagnostics: environment.EXPOSE_PROVIDER_DIAGNOSTICS === "1" && !production,
    openAI: {
      apiKey,
      model,
      maxRetries: parseInteger(environment.OPENAI_MAX_RETRIES, "OPENAI_MAX_RETRIES", 1, { minimum: 0, maximum: 5 }),
    },
  };
}
