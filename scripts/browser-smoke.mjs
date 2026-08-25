import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterpretationHandler } from "../server/app.mjs";
import { createMockInterpretationProvider } from "../server/providers/mockProvider.mjs";

const chromeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await stat(path);
      return path;
    } catch {}
  }
  throw new Error("Chrome executable not found.");
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForJson(url, predicate, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await fetch(url).then((response) => response.json());
      const match = predicate(value);
      if (match) return match;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolveReady, reject) => {
      this.socket.addEventListener("open", resolveReady, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const handler = this.pending.get(message.id);
      if (!handler) return;
      this.pending.delete(message.id);
      message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolveResult, reject) => this.pending.set(id, { resolve: resolveResult, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForExtensionWorker(targetsUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await fetch(targetsUrl).then((response) => response.json());
    for (const target of targets.filter((candidate) => candidate.type === "service_worker")) {
      const client = new CdpClient(target.webSocketDebuggerUrl);
      try {
        await client.ready;
        const name = await evaluate(client, "chrome.runtime?.getManifest?.().name");
        if (name === "Context Reader Overlay") return client;
      } catch {}
      client.close();
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Context Reader Overlay service worker.");
}

async function waitForCondition(read, predicate, description, attempts = 40) {
  let lastValue;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    lastValue = value;
    if (predicate(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

async function getSurfaceSources(page) {
  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  return flattened.nodes.flatMap((node) => {
    const attributes = node.attributes ?? [];
    const classIndex = attributes.indexOf("class");
    if (classIndex < 0 || !attributes[classIndex + 1]?.includes("translation-surface")) return [];
    const sourceIndex = attributes.indexOf("data-source-text");
    return sourceIndex < 0 ? [] : [attributes[sourceIndex + 1]];
  });
}

async function getProviderStatus(page) {
  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  const node = flattened.nodes.find((candidate) => {
    const attributes = candidate.attributes ?? [];
    const classIndex = attributes.indexOf("class");
    return classIndex >= 0 && attributes[classIndex + 1]?.includes("provider-status");
  });
  if (!node) return undefined;
  const attributes = node.attributes ?? [];
  const modeIndex = attributes.indexOf("data-mode");
  const stateIndex = attributes.indexOf("data-state");
  return {
    mode: modeIndex < 0 ? undefined : attributes[modeIndex + 1],
    state: stateIndex < 0 ? undefined : attributes[stateIndex + 1],
  };
}

async function getSurfaceSemantics(page) {
  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  return flattened.nodes.flatMap((node) => {
    const attributes = node.attributes ?? [];
    const classIndex = attributes.indexOf("class");
    if (classIndex < 0 || !attributes[classIndex + 1]?.includes("translation-surface")) return [];
    const sourceIndex = attributes.indexOf("data-source-text");
    const semanticIndex = attributes.indexOf("data-semantic-class");
    return sourceIndex < 0 || semanticIndex < 0 ? [] : [{ source: attributes[sourceIndex + 1], semanticClass: attributes[semanticIndex + 1] }];
  });
}

async function getProgress(page) {
  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  const node = flattened.nodes.find((candidate) => {
    const attributes = candidate.attributes ?? []; const index = attributes.indexOf("class");
    return index >= 0 && attributes[index + 1]?.includes("translation-progress");
  });
  if (!node) return undefined;
  const attributes = Object.fromEntries(Array.from({ length: (node.attributes ?? []).length / 2 }, (_, index) =>
    [node.attributes[index * 2], node.attributes[index * 2 + 1]]));
  return attributes;
}

async function clickShadowClass(page, className) {
  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  const node = flattened.nodes.find((candidate) => {
    const attributes = candidate.attributes ?? []; const index = attributes.indexOf("class");
    return index >= 0 && attributes[index + 1]?.includes(className);
  });
  if (!node) throw new Error(`Shadow control not found: ${className}`);
  const resolved = await page.send("DOM.resolveNode", { nodeId: node.nodeId });
  await page.send("Runtime.callFunctionOn", { objectId: resolved.object.objectId, functionDeclaration: "function(){ this.click(); }" });
}

const fixture = await readFile("test-pages/fixture.html");
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixture);
});
let recordedContext;
const testAllowedOrigins = [];
const interpretationServer = createServer(createInterpretationHandler({ allowedOrigins: testAllowedOrigins, provider: {
  ...createMockInterpretationProvider({ delayMs: 150 }),
  async interpret(context, options) {
    recordedContext = context;
    return createMockInterpretationProvider({ delayMs: 150 }).interpret(context, options);
  },
} }));
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
await new Promise((resolveListen) => interpretationServer.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const interpretationAddress = interpretationServer.address();
const pageUrl = `http://127.0.0.1:${address.port}/`;
const interpretationUrl = `http://127.0.0.1:${interpretationAddress.port}/interpret`;
const profile = await mkdtemp(resolve(tmpdir(), "context-reader-smoke-"));
const chrome = await firstExisting(chromeCandidates);
const debugPort = 9333;
const child = spawn(chrome, [
  "--no-first-run",
  "--disable-default-apps",
  "--disable-gpu",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--window-position=-32000,-32000",
  "--window-size=900,700",
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${debugPort}`,
  `--disable-extensions-except=${resolve("dist")}`,
  `--load-extension=${resolve("dist")}`,
  pageUrl,
], { stdio: "ignore" });
let browser;

try {
  const browserSocket = await waitForJson(
    `http://127.0.0.1:${debugPort}/json/version`,
    (version) => version.webSocketDebuggerUrl,
  );
  browser = new CdpClient(browserSocket);
  await browser.ready;
  const targetsUrl = `http://127.0.0.1:${debugPort}/json/list`;
  const pageTarget = await waitForJson(targetsUrl, (targets) => targets.find((target) => target.type === "page" && target.url === pageUrl));
  const page = new CdpClient(pageTarget.webSocketDebuggerUrl);
  const worker = await waitForExtensionWorker(targetsUrl);
  testAllowedOrigins.push(await evaluate(worker, "location.origin"));
  await page.ready;

  const tabId = await evaluate(worker, `chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === ${JSON.stringify(pageUrl)})?.id)`);
  if (!tabId) throw new Error("Fixture tab was not visible to the extension service worker.");
  const setReader = (enabled) => evaluate(worker, `chrome.tabs.sendMessage(${tabId}, {type:"SET_READER_ENABLED", enabled:${enabled}})`);
  await evaluate(worker, `chrome.storage.local.set({ interpretationProvider: { endpoint: ${JSON.stringify(interpretationUrl)} } })`);
  await waitForCondition(
    () => evaluate(page, `document.querySelector("#delayed-article").textContent`),
    (text) => text.includes("Delayed article content"),
    "fixture delayed article insertion",
  );
  await evaluate(page, `window.sourceBeforeReader = document.querySelector("#source").outerHTML`);
  await waitForCondition(
    () => setReader(true).then(() => true).catch(() => false),
    (connected) => connected,
    "content script message receiver",
  );
  await delay(500);

  const enabledState = await evaluate(page, `({
    roots: document.querySelectorAll("[data-context-reader-root]").length,
    sourceUntouched: document.querySelector("#source").outerHTML === window.sourceBeforeReader
  })`);
  if (enabledState.roots !== 1 || !enabledState.sourceUntouched) throw new Error(`Enable invariant failed: ${JSON.stringify(enabledState)}`);
  await page.send("DOM.enable");
  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  const translatedSurface = flattened.nodes.find((node) => {
    const attributes = node.attributes ?? [];
    return attributes.some((value, index) => index % 2 === 1 && value.includes("translation-surface"));
  });
  if (!translatedSurface) throw new Error("No translated surface was rendered inside the isolated root.");
  const translatedText = flattened.nodes.find((node) => node.parentId === translatedSurface.nodeId && node.nodeName === "#text")?.nodeValue;
  if (!translatedText) throw new Error("Translated surface did not contain presentation text.");
  const providerStatus = await waitForCondition(
    () => getProviderStatus(page),
    (status) => status?.state === "ready" || status?.state === "fallback" || status?.state === "unavailable",
    "visible translation provider capability state",
  );
  if (!["browser-translator", "development-demo", "unavailable"].includes(providerStatus.mode)) {
    throw new Error(`Unexpected translation provider mode: ${JSON.stringify(providerStatus)}`);
  }

  const initialSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("Plan A costs $90 per month.") && sources.includes("Delayed article content is now available."),
    "initial article and subscription surfaces",
  );
  if (!initialSources.includes("Article documentation guide")) throw new Error("Article heading was not represented.");
  const semantics = await getSurfaceSemantics(page);
  const semanticOf = (source) => semantics.find((entry) => entry.source === source)?.semanticClass;
  if (semanticOf("Article documentation guide") !== "READING") throw new Error(`Article title classification failed: ${JSON.stringify(semantics)}`);
  if (semanticOf("Choose Plan B") !== "UI") throw new Error("Plan selector classification failed.");
  if (semanticOf("Author metadata") !== "AUXILIARY" || semanticOf("Related reading links") !== "AUXILIARY") {
    throw new Error(`Auxiliary classification failed: ${JSON.stringify(semantics)}`);
  }

  await evaluate(page, `document.querySelector("#change-plan").click()`);
  const replacedSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("Plan B costs $120 per month."),
    "Plan B replacement surface",
  );
  if (replacedSources.includes("Plan A costs $90 per month.")) throw new Error("Stale Plan A overlay remained after replacement.");
  const uniqueExpectedSources = replacedSources.filter((source) => source !== "Related reading links");
  if (new Set(uniqueExpectedSources).size !== uniqueExpectedSources.length) throw new Error("Duplicate overlays appeared after replacement.");

  await evaluate(page, `document.querySelector("#toggle-conditional").click()`);
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => !sources.includes("This option is currently visible."),
    "hidden region disposal",
  );
  await evaluate(page, `document.querySelector("#toggle-conditional").click()`);
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("This option is currently visible."),
    "hidden region restoration",
  );

  await evaluate(page, `document.querySelector("#remove-offer").click()`);
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => !sources.includes("This temporary offer can be removed."),
    "removed region disposal",
  );

  await evaluate(page, `document.querySelector("#rapid-mutations").click()`);
  const rapidSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("Rapid final state."),
    "rapid mutation convergence",
  );
  if (rapidSources.some((source) => source.includes("Rapid intermediate")) || rapidSources.includes("Rapid initial state.")) {
    throw new Error("Rapid mutations left stale surfaces.");
  }

  await evaluate(page, `document.querySelector("#spa-view").scrollIntoView({block:"center"}); document.querySelector("#navigate-spa").click()`);
  const spaSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("SPA details route") && sources.includes("Current client-side route is details."),
    "SPA route replacement",
  );
  if (spaSources.includes("SPA home route") || spaSources.includes("Current client-side route is home.")) {
    throw new Error("SPA navigation left stale route overlays.");
  }

  const interactionWorked = await evaluate(page, `document.querySelector("#interaction-check").click(); document.body.dataset.buttonWorked`);
  if (interactionWorked !== "true") throw new Error("Underlying page button did not work.");
  await evaluate(page, "scrollTo(0, document.body.scrollHeight)");
  await delay(300);
  if (await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`) !== 1) {
    throw new Error("Overlay host was lost after scrolling.");
  }

  await evaluate(page, `document.querySelector("#spa-view").scrollIntoView({block:"center"})`);
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("SPA details route"),
    "current SPA route before reader lifecycle test",
  );

  await setReader(false);
  await delay(100);
  if (await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`) !== 0) {
    throw new Error("Reader OFF did not remove extension presentation.");
  }
  await setReader(true);
  await delay(300);
  if (await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`) !== 1) {
    throw new Error("Re-enable duplicated or failed to create the overlay host.");
  }
  const reenabledSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("SPA details route"),
    "current SPA content after re-enable",
  );
  if (reenabledSources.some((source) => source.includes("Plan A") || source.includes("Rapid intermediate") || source.includes("SPA home"))) {
    throw new Error("Re-enable resurrected stale overlays.");
  }

  await evaluate(page, `(() => {
    const node = [...document.querySelectorAll("#article p")].find((element) => element.textContent.includes("shelved")).firstChild;
    const start = node.textContent.indexOf("shelved");
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 7);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  })()`);
  await delay(50);
  await clickShadowClass(page, "selection-action");
  await waitForCondition(async () => {
    const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
    return flattened.nodes.map((node) => node.nodeValue ?? "").join(" ");
  }, (text) => text.includes("제안 추진을 보류"), "selection interpretation popover");
  if (!recordedContext || recordedContext.selectedText !== "shelved" || Object.keys(recordedContext).some((key) => /html|cookie|storage/i.test(key))) {
    throw new Error(`Interpretation context was not bounded: ${JSON.stringify(recordedContext)}`);
  }
  const interpretationMetrics = await evaluate(page, `JSON.parse(document.querySelector("[data-context-reader-root]").dataset.interpretationDiagnostics)`);
  if (interpretationMetrics.requests !== 1 || interpretationMetrics.successes !== 1 || interpretationMetrics.failures !== 0 || interpretationMetrics.averageLatencyMs < 100) {
    throw new Error(`Interpretation metrics were invalid: ${JSON.stringify(interpretationMetrics)}`);
  }
  const progress = await getProgress(page);
  if (!progress?.["data-time-to-first-translation"] || !progress?.["data-time-to-viewport-ready"]) {
    throw new Error(`Translation latency metrics were not exposed: ${JSON.stringify(progress)}`);
  }

  page.close();
  worker.close();
  console.log(`Browser regression passed with local interpretation E2E. Metrics: ${JSON.stringify({ translation: progress, interpretation: interpretationMetrics })}`);
} finally {
  if (browser) {
    try { await browser.send("Browser.close"); } catch {}
    browser.close();
  } else {
    child.kill();
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(3_000),
  ]);
  await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveClose) => interpretationServer.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
