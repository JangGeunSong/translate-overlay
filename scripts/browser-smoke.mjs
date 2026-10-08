import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createInterpretationHandler } from "../server/app.mjs";
import { createMockInterpretationProvider } from "../server/providers/mockProvider.mjs";

const chromeCandidates = [
  process.env.CONTEXT_READER_BROWSER,
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
    if (!path) continue;
    try {
      await stat(path);
      return path;
    } catch {}
  }
  throw new Error("Chrome executable not found.");
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function fetchJson(url, timeoutMs = 1_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitForJson(url, predicate, description, child, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Browser exited with code ${child.exitCode} while waiting for ${description}.`);
    try {
      const value = await fetchJson(url);
      const match = predicate(value);
      if (match) return match;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description} at ${url}. Last error: ${lastError instanceof Error ? lastError.message : "none"}`);
}

async function waitForDevToolsPort(profile, child, attempts = 100) {
  const activePortFile = resolve(profile, "DevToolsActivePort");
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Browser exited with code ${child.exitCode} before opening its DevTools endpoint.`);
    try {
      const [port] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/u);
      if (/^\d+$/u.test(port)) return Number(port);
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${activePortFile}. Last error: ${lastError instanceof Error ? lastError.message : "none"}`);
}

class CdpClient {
  constructor(url, label = "CDP target") {
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.label = label;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${label}.`)), 5_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolveReady(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`WebSocket error while connecting to ${label}.`)); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        for (const listener of this.eventListeners) listener(message);
        return;
      }
      const handler = this.pending.get(message.id);
      if (!handler) return;
      this.pending.delete(message.id);
      clearTimeout(handler.timer);
      message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const [id, handler] of this.pending) {
        clearTimeout(handler.timer);
        handler.reject(new Error(`${this.label} closed before CDP command ${id} completed.`));
      }
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} timed out running ${method}.`));
      }, 5_000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  onEvent(listener) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  close() { this.socket.close(); }
}

async function attachSession(browser, targetId, label) {
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: false });
  let nextId = 1;
  const pending = new Map();
  const unsubscribe = browser.onEvent((event) => {
    if (event.method !== "Target.receivedMessageFromTarget" || event.params.sessionId !== sessionId) return;
    const message = JSON.parse(event.params.message);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    clearTimeout(handler.timer);
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      const id = nextId++;
      const result = new Promise((resolveResult, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${label} timed out running ${method}.`));
        }, 5_000);
        pending.set(id, { resolve: resolveResult, reject, timer });
      });
      await browser.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      });
      return result;
    },
    close() {
      unsubscribe();
      for (const [id, handler] of pending) {
        clearTimeout(handler.timer);
        handler.reject(new Error(`${label} detached before CDP command ${id} completed.`));
      }
      pending.clear();
      void browser.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForExtensionWorker(browser, targetsUrl, child) {
  let lastError;
  let lastWorkerTargets = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Browser exited with code ${child.exitCode} while waiting for the extension service worker.`);
    let targets = [];
    try { targets = await fetchJson(targetsUrl); } catch (error) { lastError = error; }
    lastWorkerTargets = targets.filter((candidate) => candidate.type === "service_worker").map((candidate) => candidate.url);
    for (const target of targets.filter((candidate) =>
      candidate.type === "service_worker" && /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(candidate.url))) {
      let client;
      try {
        client = await attachSession(browser, target.id, "extension service worker");
        await client.send("Runtime.runIfWaitingForDebugger");
        const name = await evaluate(client, "chrome.runtime?.getManifest?.().name");
        if (name === "Context Reader Overlay") return client;
      } catch (error) { lastError = error; }
      client?.close();
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for the Context Reader Overlay service worker. Last error: ${lastError instanceof Error ? lastError.message : "no matching worker target"}. Last service worker URLs: ${JSON.stringify(lastWorkerTargets)}`);
}

async function waitForCondition(read, predicate, description, attempts = 40) {
  let lastValue;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await read();
      lastValue = value;
      if (predicate(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Last error: ${lastError instanceof Error ? lastError.message : "none"}`);
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
  const { model } = await page.send("DOM.getBoxModel", { nodeId: node.nodeId });
  await pointerClick(page, (model.border[0] + model.border[4]) / 2, (model.border[1] + model.border[5]) / 2);
}

async function pointerClick(page, x, y) {
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function clickSource(page, selector) {
  const point = await evaluate(page, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({block: "center"});
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await pointerClick(page, point.x, point.y);
}

async function key(page, key, code, windowsVirtualKeyCode, modifiers = 0) {
  const params = { key, code, windowsVirtualKeyCode, modifiers };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...params,
    ...(key === "Enter" ? { text: "\r" } : key.length === 1 && modifiers === 0 ? { text: key } : {}) });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function inputState(page) {
  return evaluate(page, `({
    value: document.querySelector("#search-input").value,
    checked: document.querySelector("#local-check").checked,
    selected: [...document.querySelector("#local-select").options].map(option => option.selected),
    focus: document.activeElement.id,
    selection: [document.querySelector("#search-input").selectionStart, document.querySelector("#search-input").selectionEnd],
    events: window.inputEvents, submission: window.localSubmission,
    mutations: window.sourceMutations,
    state: document.querySelector("#local-state").textContent,
    markup: document.querySelector("#source").outerHTML
  })`);
}

async function inputJourney(page) {
  await evaluate(page, `(() => {
    window.sourceMutations = [];
    window.inputObserver = new MutationObserver(records => {
      for (const record of records) window.sourceMutations.push({
        type: record.type, target: record.target.id || record.target.nodeName,
        attribute: record.attributeName, oldValue: record.oldValue,
        added: [...record.addedNodes].map(node => node.textContent),
        removed: [...record.removedNodes].map(node => node.textContent)
      });
    });
    window.inputObserver.observe(document.querySelector("#source"), {
      subtree: true, childList: true, attributes: true, characterData: true,
      attributeOldValue: true, characterDataOldValue: true
    });
  })()`);
  await clickSource(page, "#local-link");
  await clickSource(page, "#local-button");
  await key(page, "Enter", "Enter", 13);
  await clickSource(page, "#local-submit");
  const invalid = await inputState(page);
  if (invalid.events.invalid !== 1 || invalid.events.submit !== 0 || invalid.focus !== "search-input") {
    throw new Error(`Native validation/focus failed: ${JSON.stringify(invalid)}`);
  }
  for (const letter of "tea") await key(page, letter, `Key${letter.toUpperCase()}`, letter.toUpperCase().charCodeAt(0));
  await key(page, "Home", "Home", 36, 8);
  for (const letter of "books") await key(page, letter, `Key${letter.toUpperCase()}`, letter.toUpperCase().charCodeAt(0));
  await key(page, "ArrowLeft", "ArrowLeft", 37, 8);
  await key(page, "ArrowLeft", "ArrowLeft", 37, 8);
  const editing = await inputState(page);
  if (editing.value !== "books" || editing.focus !== "search-input" || JSON.stringify(editing.selection) !== "[3,5]") {
    throw new Error(`Keyboard editing/selection failed: ${JSON.stringify(editing)}`);
  }
  await clickSource(page, "#local-check");
  await key(page, "Tab", "Tab", 9);
  await key(page, "End", "End", 35);
  await key(page, "Tab", "Tab", 9);
  await key(page, "Enter", "Enter", 13);
  await clickSource(page, "#search-input");
  await key(page, "a", "KeyA", 65, 2);
  const result = await inputState(page);
  const expectedEvents = { link: 1, button: 2, input: 8, searchChange: 1, checkbox: 1, select: 1, invalid: 1, submit: 1, untrusted: 0 };
  if (JSON.stringify(result.events) !== JSON.stringify(expectedEvents) || result.value !== "books" ||
      !result.checked || JSON.stringify(result.selected) !== "[false,true]" ||
      result.focus !== "search-input" || JSON.stringify(result.selection) !== "[0,5]" ||
      JSON.stringify(result.submission) !== JSON.stringify({ search: "books", available: "on", sort: "price" }) ||
      result.state !== "Local search submitted: books") {
    throw new Error(`Real input journey failed: ${JSON.stringify(result)}`);
  }
  await evaluate(page, "window.inputObserver.disconnect()");
  return { invalid, editing, result };
}

async function selectWord(page, word) {
  // Read Range geometry only; selection itself comes from a real pointer drag.
  const points = await evaluate(page, `(() => {
    const element = [...document.querySelectorAll("#article p")].find(element => element.textContent.includes(${JSON.stringify(word)}));
    element.scrollIntoView({block: "center"});
    const node = element.firstChild;
    const start = node.textContent.indexOf(${JSON.stringify(word)});
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + ${word.length});
    const rect = range.getBoundingClientRect();
    return { x: rect.left, end: rect.right, y: rect.top + rect.height / 2 };
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: points.x, y: points.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.end, y: points.y, button: "left", buttons: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: points.end, y: points.y, button: "left", clickCount: 1 });
  await waitForCondition(() => evaluate(page, "getSelection().toString()"), text => text === word, "pointer text selection");
}

const fixture = await readFile("test-pages/fixture.html");
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fixture);
});
let recordedContext;
let rejectTranslations = true;
let translationFailures = 0;
let translationSuccesses = 0;
let interpretationRequests = 0;
let holdInterpretations = false;
let holdTranslations = false;
const pendingInterpretations = [];
const pendingTranslations = [];
function hold(queue) {
  const entry = { settled: false };
  queue.push(entry);
  return new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = () => reject(new Error("Deterministic stale request failure."));
  }).finally(() => { entry.settled = true; });
}
const testAllowedOrigins = [];
const mockProvider = createMockInterpretationProvider({ delayMs: 150 });
const interpretationServer = createServer(createInterpretationHandler({ allowedOrigins: testAllowedOrigins, provider: {
  ...mockProvider,
  async interpret(context, options) {
    interpretationRequests += 1;
    recordedContext = context;
    if (holdInterpretations) await hold(pendingInterpretations);
    return mockProvider.interpret(context, options);
  },
  async translate(request, options) {
    if (holdTranslations) await hold(pendingTranslations);
    if (rejectTranslations) {
      translationFailures += 1;
      throw new Error("Deterministic transient translation failure.");
    }
    const result = await mockProvider.translate(request, options);
    translationSuccesses += 1;
    return result;
  },
},
  // Keep intentional outage/recovery independent from the production-default
  // rate limit, which has its own backend coverage.
  rateLimitPerMinute: 200,
  logger: { error() {} },
}));
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
await new Promise((resolveListen) => interpretationServer.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const interpretationAddress = interpretationServer.address();
const pageUrl = `http://127.0.0.1:${address.port}/`;
const interpretationUrl = `http://127.0.0.1:${interpretationAddress.port}/interpret`;
const translationUrl = `http://127.0.0.1:${interpretationAddress.port}/translate`;
const profile = await mkdtemp(resolve(tmpdir(), "context-reader-smoke-"));
const chrome = await firstExisting(chromeCandidates);
const child = spawn(chrome, [
  "--no-first-run",
  "--disable-default-apps",
  "--disable-gpu",
  "--disable-gpu-sandbox",
  "--no-sandbox",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-blink-features=TranslationAPI",
  "--silent-debugger-extension-api",
  "--window-position=-32000,-32000",
  "--window-size=900,700",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  `--disable-extensions-except=${resolve("dist")}`,
  `--load-extension=${resolve("dist")}`,
  pageUrl,
], { stdio: ["ignore", "pipe", "pipe"] });
let browserOutput = "";
const recordBrowserOutput = (chunk) => { browserOutput = `${browserOutput}${chunk}`.slice(-4_000); };
child.stdout.on("data", recordBrowserOutput);
child.stderr.on("data", recordBrowserOutput);
const childExit = new Promise((resolveExit) => child.once("exit", resolveExit));
let browser;

try {
  const debugPort = await waitForDevToolsPort(profile, child);
  const browserSocket = await waitForJson(
    `http://127.0.0.1:${debugPort}/json/version`,
    (version) => version.webSocketDebuggerUrl,
    "browser DevTools endpoint",
    child,
  );
  browser = new CdpClient(browserSocket, "browser");
  await browser.ready;
  const targetsUrl = `http://127.0.0.1:${debugPort}/json/list`;
  const pageTarget = await waitForJson(
    targetsUrl,
    (targets) => targets.find((target) => target.type === "page" && target.url === pageUrl),
    "fixture page target",
    child,
  );
  const page = new CdpClient(pageTarget.webSocketDebuggerUrl, "fixture page");
  const worker = await waitForExtensionWorker(browser, targetsUrl, child);
  testAllowedOrigins.push(await evaluate(worker, "location.origin"));
  await page.ready;
  await page.send("DOM.enable");

  const manifest = await evaluate(worker, "chrome.runtime.getManifest()");
  const endpointPermission = `${new URL(translationUrl).origin}/*`;
  const permissions = manifest.host_permissions ?? [];
  const extensionCsp = manifest.content_security_policy?.extension_pages ?? "";
  const endpointPermitted = await evaluate(worker, `chrome.permissions.contains({ origins: [${JSON.stringify(endpointPermission)}] })`);
  if (manifest.manifest_version !== 3 || !endpointPermitted ||
      permissions.some((permission) => permission === "<all_urls>" || permission === "https://*/*") ||
      !extensionCsp.includes("connect-src http://localhost:* http://127.0.0.1:*")) {
    throw new Error(`MV3 remote access policy was not minimal and complete: ${JSON.stringify({ permissions, extensionCsp })}`);
  }

  const frameTree = await page.send("Page.getFrameTree");
  const isolatedWorld = await page.send("Page.createIsolatedWorld", {
    frameId: frameTree.frameTree.frame.id,
    worldName: "context-reader-native-api-check",
  });
  const translatorAvailability = await page.send("Runtime.evaluate", {
    expression: `globalThis.Translator
      ? globalThis.Translator.availability({ sourceLanguage: "en", targetLanguage: "ko" }).catch(() => "error")
      : Promise.resolve("absent")`,
    contextId: isolatedWorld.executionContextId,
    awaitPromise: true,
    returnByValue: true,
  });
  if (!["absent", "unavailable"].includes(translatorAvailability.result.value)) {
    throw new Error(`Browser Translator API must be unusable for en-to-ko fallback testing; received ${translatorAvailability.result.value}.`);
  }

  const tabId = await evaluate(worker, `chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === ${JSON.stringify(pageUrl)})?.id)`);
  if (!tabId) throw new Error("Fixture tab was not visible to the extension service worker.");
  const setReader = (enabled) => evaluate(worker, `chrome.tabs.sendMessage(${tabId}, {type:"SET_READER_ENABLED", enabled:${enabled}})`);
  await evaluate(worker, `chrome.storage.local.set({
    interpretationProvider: { endpoint: ${JSON.stringify(interpretationUrl)} },
    translationProvider: { endpoint: ${JSON.stringify(translationUrl)} }
  })`);
  // The first tab can commit before an unpacked extension has completed startup,
  // especially on a fresh Edge profile. Reload only after the worker and its test
  // configuration are ready so content-script injection is deterministic.
  await page.send("Page.enable");
  await page.send("Page.reload", { ignoreCache: true });
  await waitForCondition(
    () => evaluate(page, `document.querySelector("#delayed-article")?.textContent ?? ""`),
    (text) => text.includes("Delayed article content"),
    "fixture delayed article insertion",
  );
  const offInput = await inputJourney(page);
  await page.send("Page.reload", { ignoreCache: true });
  await waitForCondition(
    () => evaluate(page, `document.querySelector("#delayed-article")?.textContent ?? ""`),
    (text) => text.includes("Delayed article content"),
    "fresh fixture for identical ON input journey",
  );
  await evaluate(page, `window.sourceBeforeReader = document.querySelector("#source").outerHTML`);
  await waitForCondition(
    () => setReader(true).then(() => true).catch(() => false),
    (connected) => connected,
    "content script message receiver",
  );
  await waitForCondition(
    () => getProviderStatus(page),
    (status) => status?.mode === "unavailable" && status?.state === "unavailable",
    "contained remote translation failure",
    100,
  );

  const enabledState = await evaluate(page, `({
    roots: document.querySelectorAll("[data-context-reader-root]").length,
    sourceUntouched: document.querySelector("#source").outerHTML === window.sourceBeforeReader
  })`);
  if (enabledState.roots !== 1 || !enabledState.sourceUntouched || translationFailures < 1) {
    throw new Error(`Remote failure containment invariant failed: ${JSON.stringify({ ...enabledState, translationFailures })}`);
  }
  await clickSource(page, "#interaction-check");
  const failureInteraction = await evaluate(page, `document.body.dataset.buttonWorked`);
  if (failureInteraction !== "true") throw new Error("Underlying page interaction failed while the remote backend was unavailable.");

  rejectTranslations = false;
  await setReader(false);
  await waitForCondition(
    () => evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`),
    (roots) => roots === 0,
    "failure-phase overlay cleanup",
  );
  await setReader(true);
  await waitForCondition(
    async () => ({
      status: await getProviderStatus(page),
      translationFailures,
      translationSuccesses,
      progress: await getProgress(page),
    }),
    (diagnostics) => diagnostics.status?.mode === "production-remote" && diagnostics.status?.state === "ready",
    "remote translation recovery",
    100,
  );
  if (translationSuccesses < 1) throw new Error("The recovered request did not reach the deterministic translation backend.");
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.length > 0,
    "first recovered remote translation surface",
  );

  const flattened = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  const translatedSurface = flattened.nodes.find((node) => {
    const attributes = node.attributes ?? [];
    return attributes.some((value, index) => index % 2 === 1 && value.includes("translation-surface"));
  });
  if (!translatedSurface) throw new Error("No translated surface was rendered inside the isolated root.");
  const translatedText = flattened.nodes.find((node) => node.parentId === translatedSurface.nodeId && node.nodeName === "#text")?.nodeValue;
  if (!translatedText?.startsWith("[ko] ")) throw new Error(`Remote translated surface was not deterministic: ${translatedText}`);
  const providerStatus = await waitForCondition(
    () => getProviderStatus(page),
    (status) => status?.state === "ready" || status?.state === "fallback" || status?.state === "unavailable",
    "visible translation provider capability state",
  );
  if (providerStatus.mode !== "production-remote" || providerStatus.state !== "ready") {
    throw new Error(`Unexpected translation provider mode: ${JSON.stringify(providerStatus)}`);
  }
  if (!await evaluate(page, `document.querySelector("#source").outerHTML === window.sourceBeforeReader`)) {
    throw new Error("Source markup changed while rendering recovered remote translations.");
  }

  const onInput = await inputJourney(page);
  if (JSON.stringify(onInput) !== JSON.stringify(offInput)) {
    throw new Error(`OFF/ON site state, markup, focus, selection or event counts differ: ${JSON.stringify({ offInput, onInput })}`);
  }
  await clickShadowClass(page, "toggle");
  if (JSON.stringify(await inputState(page)) !== JSON.stringify(onInput.result)) throw new Error("Original-view control changed source focus/selection or state.");
  await clickShadowClass(page, "toggle");
  if (JSON.stringify(await inputState(page)) !== JSON.stringify(onInput.result)) throw new Error("Translation-view control changed source focus/selection or state.");
  await setReader(false);
  if (JSON.stringify(await inputState(page)) !== JSON.stringify(onInput.result)) throw new Error("OFF changed user input state.");
  await setReader(true);
  if (JSON.stringify(await inputState(page)) !== JSON.stringify(onInput.result)) throw new Error("ON changed user input state.");
  await evaluate(page, `document.querySelector("#article").scrollIntoView({block:"start"})`);

  const initialSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("Article documentation guide") && sources.includes("Plan A costs $90 per month.") && sources.includes("Delayed article content is now available."),
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

  await clickSource(page, "#change-plan");
  const replacedSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("Plan B costs $120 per month."),
    "Plan B replacement surface",
  );
  if (replacedSources.includes("Plan A costs $90 per month.")) throw new Error("Stale Plan A overlay remained after replacement.");
  const uniqueExpectedSources = replacedSources.filter((source) => source !== "Related reading links");
  if (new Set(uniqueExpectedSources).size !== uniqueExpectedSources.length) throw new Error("Duplicate overlays appeared after replacement.");

  await clickSource(page, "#toggle-conditional");
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => !sources.includes("This option is currently visible."),
    "hidden region disposal",
  );
  await clickSource(page, "#toggle-conditional");
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("This option is currently visible."),
    "hidden region restoration",
  );

  await clickSource(page, "#remove-offer");
  await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => !sources.includes("This temporary offer can be removed."),
    "removed region disposal",
  );

  await clickSource(page, "#rapid-mutations");
  const rapidSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("Rapid final state."),
    "rapid mutation convergence",
  );
  if (rapidSources.some((source) => source.includes("Rapid intermediate")) || rapidSources.includes("Rapid initial state.")) {
    throw new Error("Rapid mutations left stale surfaces.");
  }

  await clickSource(page, "#navigate-spa");
  const spaSources = await waitForCondition(
    () => getSurfaceSources(page),
    (sources) => sources.includes("SPA details route") && sources.includes("Current client-side route is details."),
    "SPA route replacement",
  );
  if (spaSources.includes("SPA home route") || spaSources.includes("Current client-side route is home.")) {
    throw new Error("SPA navigation left stale route overlays.");
  }

  await clickSource(page, "#interaction-check");
  const interactionWorked = await evaluate(page, `document.body.dataset.buttonWorked`);
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

  await selectWord(page, "shelved");
  await delay(50);
  const selectionFocus = await evaluate(page, "document.activeElement.tagName");
  await clickShadowClass(page, "selection-action");
  if (await evaluate(page, "getSelection().toString()") !== "shelved" ||
      await evaluate(page, "document.activeElement.tagName") !== selectionFocus) {
    throw new Error("Interpretation action changed source selection/focus.");
  }
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

  // Close a pending explanation using a real pointer, then finish the response.
  holdInterpretations = true;
  await selectWord(page, "proposal");
  await delay(50);
  await clickShadowClass(page, "selection-action");
  await waitForCondition(() => pendingInterpretations.length, count => count === 1, "held interpretation before close");
  await clickShadowClass(page, "close");
  const metricsBeforeCloseResponse = await evaluate(page, `document.querySelector("[data-context-reader-root]").dataset.interpretationDiagnostics`);
  pendingInterpretations[0].resolve();
  await delay(300);
  const closedTree = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
  if (closedTree.nodes.some(node => (node.attributes ?? []).includes("explanation")) ||
      await evaluate(page, `document.querySelector("[data-context-reader-root]").dataset.interpretationDiagnostics`) !== metricsBeforeCloseResponse ||
      await evaluate(page, "getSelection().toString()") !== "proposal") {
    throw new Error("Closed explanation reappeared, changed diagnostics or lost the source selection.");
  }

  holdTranslations = true;
  for (let cycle = 0; cycle < 10; cycle++) {
    await setReader(true);
    if (await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`) !== 1) throw new Error(`Duplicate host in cycle ${cycle}.`);
    const previousTranslations = pendingTranslations.length;
    await clickSource(page, "#local-button"); // site-owned, unique text mutation
    await waitForCondition(() => pendingTranslations.length, count => count > previousTranslations, `pending translation in cycle ${cycle}`);
    const previousInterpretations = pendingInterpretations.length;
    await selectWord(page, cycle % 2 ? "proposal" : "shelved");
    await delay(50);
    await clickShadowClass(page, "selection-action");
    await waitForCondition(() => pendingInterpretations.length, count => count === previousInterpretations + 1, `one interpretation in cycle ${cycle}`);
    await setReader(false);
    pendingInterpretations.at(-1)[cycle % 2 ? "reject" : "resolve"]();
    for (const pending of pendingTranslations.filter(entry => !entry.settled)) pending.resolve();
    await delay(350);
    const offTree = await page.send("DOM.getFlattenedDocument", { depth: -1, pierce: true });
    if (await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`) !== 0 ||
        offTree.nodes.some(node => (node.attributes ?? []).some(value => /^(translation-surface|selection-action|explanation)( |$)/u.test(value)))) {
      throw new Error(`Pending work recreated presentation after OFF in cycle ${cycle}.`);
    }
  }
  holdTranslations = false;
  holdInterpretations = false;
  const requestCounts = [translationSuccesses + translationFailures, interpretationRequests];
  await clickSource(page, "#local-button");
  await selectWord(page, "shelved");
  await delay(600);
  if (JSON.stringify(requestCounts) !== JSON.stringify([translationSuccesses + translationFailures, interpretationRequests]) ||
      await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`) !== 0) {
    throw new Error("Reader OFF retained work registrations.");
  }

  page.close();
  worker.close();
  const browserVersion = await browser.send("Browser.getVersion");
  console.log(`Browser regression passed: identical trusted OFF/ON inputs and source mutations, MV3 failure/recovery, pointer selection/close, and ten pending ON/OFF cycles. Metrics: ${JSON.stringify({ browser: browserVersion.product, extension: manifest.version, translation: progress, interpretation: interpretationMetrics, backend: { translationFailures, translationSuccesses } })}`);
} catch (error) {
  const details = browserOutput.trim() ? `\nBrowser output:\n${browserOutput.trim()}` : "";
  throw new Error(`Browser integration failed: ${error instanceof Error ? error.message : String(error)}${details}`, { cause: error });
} finally {
  if (browser) {
    try { await browser.send("Browser.close"); } catch {}
    browser.close();
  } else {
    child.kill();
  }
  const exited = await Promise.race([childExit.then(() => true), delay(3_000).then(() => false)]);
  if (!exited && child.exitCode === null) child.kill();
  server.closeAllConnections();
  interpretationServer.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveClose) => interpretationServer.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
