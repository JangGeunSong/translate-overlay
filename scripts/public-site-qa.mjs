import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const configuredSites = [
  { type: "article/documentation", url: "https://en.wikipedia.org/wiki/Machine_translation" },
  { type: "ecommerce/subscription", url: "https://www.adobe.com/creativecloud/plans.html" },
  { type: "spa/dynamic", url: "https://react.dev/learn" },
];
const sites = process.env.QA_SITE_TYPE
  ? configuredSites.filter((site) => site.type === process.env.QA_SITE_TYPE)
  : configuredSites;
const candidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function chromePath() { for (const path of candidates) { try { await stat(path); return path; } catch {} } throw new Error("Chromium browser not found."); }

class Cdp {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.socket = new WebSocket(url);
    this.ready = new Promise((resolveReady, reject) => { this.socket.addEventListener("open", resolveReady, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); });
  }
  async send(method, params = {}) { await this.ready; const id = ++this.id; const result = new Promise((resolveResult, reject) => this.pending.set(id, { resolve: resolveResult, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    const timeout = new Promise((_resolve, reject) => setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000));
    return Promise.race([result, timeout]); }
  close() { this.socket.close(); }
}
async function evaluate(client, expression) { const value = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text); return value.result.value; }
async function json(url, predicate, attempts = 120) { for (let index = 0; index < attempts; index += 1) { try { const value = await fetch(url).then((response) => response.json());
  const match = predicate(value); if (match) return match; } catch {} await delay(100); } throw new Error(`Timed out: ${url}`); }
async function worker(targetsUrl) {
  for (let index = 0; index < 120; index += 1) {
    const targets = await fetch(targetsUrl).then((response) => response.json());
    const target = targets.find((item) => item.type === "service_worker" && item.url.includes("background.js"));
    if (target) { const client = new Cdp(target.webSocketDebuggerUrl); await client.ready; return client; }
    await delay(100);
  }
  throw new Error("Extension service worker was not available.");
}
async function shadowSnapshot(page) {
  return evaluate(page, `(() => {
    const host = document.querySelector("[data-context-reader-root]");
    if (!host) return { surfaces: 0, semantic: {}, progress: {}, provider: {} };
    const surfaces = JSON.parse(host.dataset.surfaceDiagnostics || "{}");
    return { surfaces: surfaces.total || 0, semantic: surfaces, progress: JSON.parse(host.dataset.translationProgress || "{}"),
      provider: { mode: host.dataset.providerMode, state: host.dataset.providerState } };
  })()`);
}

const profile = await mkdtemp(resolve(tmpdir(), "context-reader-public-qa-"));
const port = 9444;
const child = spawn(await chromePath(), ["--no-first-run", "--disable-default-apps", "--disable-gpu", "--window-position=-32000,-32000", "--window-size=1100,800",
  "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`, sites[0].url], { stdio: "ignore" });
let browser;
try {
  const version = await json(`http://127.0.0.1:${port}/json/version`, (value) => value.webSocketDebuggerUrl);
  browser = new Cdp(version); await browser.ready;
  const targetsUrl = `http://127.0.0.1:${port}/json/list`;
  const pageTarget = await json(targetsUrl, (targets) => targets.find((target) => target.type === "page"));
  const page = new Cdp(pageTarget.webSocketDebuggerUrl); await page.ready; await page.send("Page.enable"); await page.send("DOM.enable");
  const serviceWorker = await worker(targetsUrl);
  const results = [];
  for (const site of sites) {
    console.error(`[public-qa] navigating ${site.type}`);
    await page.send("Page.navigate", { url: site.url });
    await delay(6_000);
    const loadedUrl = await evaluate(page, "location.href");
    console.error(`[public-qa] loaded ${loadedUrl}`);
    const tabId = await evaluate(serviceWorker, `chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === ${JSON.stringify(loadedUrl)})?.id)`);
    if (!tabId) { results.push({ ...site, loadedUrl, error: "Extension could not resolve the tab." }); continue; }
    const toggle = (enabled) => evaluate(serviceWorker, `chrome.tabs.sendMessage(${tabId}, {type:"SET_READER_ENABLED", enabled:${enabled}})`);
    try {
      await toggle(true); await delay(6_000);
      console.error(`[public-qa] reader active ${site.type}`);
      const initial = await shadowSnapshot(page);
      const documentInfo = await evaluate(page, `({title:document.title, lang:document.documentElement.lang, roots:document.querySelectorAll("[data-context-reader-root]").length,
        height:document.documentElement.scrollHeight, buttons:document.querySelectorAll("button").length, links:document.querySelectorAll("a[href]").length})`);
      await evaluate(page, "scrollTo(0, Math.max(0, document.documentElement.scrollHeight * .65))"); await delay(1_500);
      const scrolled = await shadowSnapshot(page);
      await evaluate(page, "scrollTo(0, 0)"); await delay(1_000);
      await toggle(false); await delay(300); await toggle(true); await delay(2_000);
      const reenabled = await shadowSnapshot(page);
      const finalRoots = await evaluate(page, `document.querySelectorAll("[data-context-reader-root]").length`);
      results.push({ ...site, loadedUrl, documentInfo, initial, scrolled, reenabled, finalRoots });
      console.error(`[public-qa] recorded ${site.type}`);
      await toggle(false);
    } catch (error) { results.push({ ...site, loadedUrl, error: error.message }); }
  }
  console.log(JSON.stringify({ browser: await evaluate(page, "navigator.userAgent"), results }, null, 2));
  page.close(); serviceWorker.close();
} finally {
  if (browser) { try { await browser.send("Browser.close"); } catch {} browser.close(); } else child.kill();
  await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(3_000)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
