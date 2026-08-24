import type { InterpretationContext } from "../content/types";
import type { InterpretationProviderResponse } from "../shared/messages";

interface InterpretationProviderConfig {
  endpoint?: string;
}

const CONFIG_KEY = "interpretationProvider";
const MAX_EXPLANATION_LENGTH = 1_200;

function validateEndpoint(value: string): URL {
  const url = new URL(value);
  const localDevelopment = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("Interpretation endpoint must use HTTPS, except for localhost development.");
  }
  return url;
}

function isBoundedContext(context: InterpretationContext): boolean {
  return context.selectedText.length <= 300 &&
    context.sentence.length <= 600 &&
    context.paragraph.length <= 1_200 &&
    (context.previousParagraph?.length ?? 0) <= 600 &&
    (context.nextParagraph?.length ?? 0) <= 600 &&
    (context.nearestHeading?.length ?? 0) <= 300 &&
    context.pageTitle.length <= 300;
}

export async function requestRemoteInterpretation(
  context: InterpretationContext,
): Promise<InterpretationProviderResponse> {
  if (!isBoundedContext(context)) return { ok: false, error: "Interpretation context exceeded client bounds." };
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY] as InterpretationProviderConfig | undefined;
  if (!config?.endpoint) return { ok: false, error: "No production interpretation endpoint is configured." };

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
        operation: "interpret",
        context,
        response: { language: context.targetLanguage, maximumCharacters: MAX_EXPLANATION_LENGTH },
      }),
    });
    if (!response.ok) return { ok: false, error: `Interpretation backend returned HTTP ${response.status}.` };
    const payload = await response.json() as { explanation?: unknown };
    if (typeof payload.explanation !== "string" || !payload.explanation.trim()) {
      return { ok: false, error: "Interpretation backend returned an invalid response." };
    }
    return {
      ok: true,
      explanation: payload.explanation.trim().slice(0, MAX_EXPLANATION_LENGTH),
      provider: "production-remote",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Interpretation request failed." };
  }
}
