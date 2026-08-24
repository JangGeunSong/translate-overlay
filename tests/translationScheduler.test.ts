import { describe, expect, it, vi } from "vitest";
import { TranslationScheduler, type TranslationJob } from "../src/content/translation/translationScheduler";

const job = (key: string, priority: number): TranslationJob => ({ key, priority,
  request: { regionId: key, requestKey: key, text: key, sourceLanguage: "en", targetLanguage: "ko" } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TranslationScheduler", () => {
  it("starts the highest-priority jobs first with bounded concurrency", async () => {
    const resolvers = new Map<string, () => void>(); const started: string[] = [];
    const scheduler = new TranslationScheduler({ concurrency: 1, onEvent: (event) => {
      if (event.type === "started") started.push(event.job.key);
    }, execute: (request) => new Promise((resolve) => resolvers.set(request.regionId, () => resolve({
      regionId: request.regionId, requestKey: request.requestKey, translatedText: request.text, provider: "fake" }))) });
    scheduler.sync([job("far", 4), job("ui", 1), job("reading", 0), job("near", 2)]); await tick();
    expect(started).toEqual(["reading"]);
    for (const key of ["reading", "ui", "near", "far"]) { resolvers.get(key)!(); await tick(); }
    expect(started).toEqual(["reading", "ui", "near", "far"]);
  });

  it("reuses in-flight work and rejects events after clear", async () => {
    let finish!: () => void; const completed = vi.fn();
    const scheduler = new TranslationScheduler({ concurrency: 1, onEvent: (event) => {
      if (event.type === "completed") completed(event.job.key);
    }, execute: (request) => new Promise((resolve) => { finish = () => resolve({
      regionId: request.regionId, requestKey: request.requestKey, translatedText: request.text, provider: "fake" }); }) });
    scheduler.sync([job("active", 0), job("later", 5)]); await tick();
    expect(scheduler.sync([job("active", 0), job("later", 1)]).inFlightReused).toBe(1);
    scheduler.clear(); finish(); await tick();
    expect(completed).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toEqual({ queued: 0, active: 0 });
  });
});
