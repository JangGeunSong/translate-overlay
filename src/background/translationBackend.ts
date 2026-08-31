import type { TranslationRequest, TranslationResult } from "../content/types";
import type { TranslationProviderResponse } from "../shared/messages";

interface TranslationProviderConfig { endpoint?: string; }

const CONFIG_KEY = "translationProvider";
const MAX_BATCH_SIZE = 3;
const MAX_SOURCE_LENGTH = 4_000;
const MAX_TRANSLATION_LENGTH = 8_000;
const MAX_ID_LENGTH = 200;
const MAX_LANGUAGE_LENGTH = 35;

function validateEndpoint(value: string): URL {
  const url = new URL(value);
  const localDevelopment = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("Translation endpoint must use HTTPS, except for localhost development.");
  }
  return url;
}

function isBoundedRequest(request: TranslationRequest): boolean {
  return request.regionId.length > 0 && request.regionId.length <= MAX_ID_LENGTH &&
    request.requestKey.length > 0 && request.requestKey.length <= MAX_ID_LENGTH &&
    request.text.length > 0 && request.text.length <= MAX_SOURCE_LENGTH &&
    request.sourceLanguage.length > 0 && request.sourceLanguage.length <= MAX_LANGUAGE_LENGTH &&
    request.targetLanguage.length > 0 && request.targetLanguage.length <= MAX_LANGUAGE_LENGTH;
}

export async function requestRemoteTranslation(requests: TranslationRequest[]): Promise<TranslationProviderResponse> {
  if (requests.length === 0 || requests.length > MAX_BATCH_SIZE || requests.some((request) => !isBoundedRequest(request))) {
    return { ok: false, error: "Translation request exceeded client bounds." };
  }
  if (new Set(requests.map((request) => request.requestKey)).size !== requests.length) {
    return { ok: false, error: "Translation request keys must be unique." };
  }

  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY] as TranslationProviderConfig | undefined;
  if (!config?.endpoint) return { ok: false, error: "No production translation endpoint is configured." };

  try {
    const endpoint = validateEndpoint(config.endpoint);
    const permissionPattern = `${endpoint.origin}/*`;
    const permitted = await chrome.permissions.contains({ origins: [permissionPattern] });
    if (!permitted) return { ok: false, error: `Host permission is required for ${endpoint.origin}.` };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        version: 1,
        operation: "translate",
        requests: requests.map(({ requestKey, text, sourceLanguage, targetLanguage }) => ({ requestKey, text, sourceLanguage, targetLanguage })),
        response: { maximumCharactersPerTranslation: MAX_TRANSLATION_LENGTH },
      }),
    });
    if (!response.ok) return { ok: false, error: `Translation backend returned HTTP ${response.status}.` };

    const payload = await response.json() as {
      version?: unknown;
      translations?: unknown;
      maximumCharactersPerTranslation?: unknown;
    };
    if (payload.version !== 1 || payload.maximumCharactersPerTranslation !== MAX_TRANSLATION_LENGTH ||
        !Array.isArray(payload.translations) || payload.translations.length !== requests.length) {
      return { ok: false, error: "Translation backend returned an invalid response." };
    }
    const requestByKey = new Map(requests.map((request) => [request.requestKey, request]));
    const seen = new Set<string>();
    const translations: TranslationResult[] = [];
    for (const item of payload.translations) {
      if (!item || typeof item !== "object") return { ok: false, error: "Translation backend returned an invalid response." };
      const { requestKey, translatedText } = item as { requestKey?: unknown; translatedText?: unknown };
      if (typeof requestKey !== "string" || seen.has(requestKey) ||
          typeof translatedText !== "string" || !translatedText.trim() || translatedText.length > MAX_TRANSLATION_LENGTH) {
        return { ok: false, error: "Translation backend returned an invalid response." };
      }
      const request = requestByKey.get(requestKey);
      if (!request) return { ok: false, error: "Translation backend returned an invalid response." };
      seen.add(requestKey);
      translations.push({ regionId: request.regionId, requestKey, translatedText: translatedText.trim(), provider: "production-remote" });
    }
    return { ok: true, translations, provider: "production-remote" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Translation request failed." };
  }
}
