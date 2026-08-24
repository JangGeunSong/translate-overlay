import type { TranslationRequest, TranslationResult } from "../types";

export interface TranslationJob {
  key: string;
  priority: number;
  request: TranslationRequest;
}

export type SchedulerEvent =
  | { type: "started"; job: TranslationJob }
  | { type: "completed"; job: TranslationJob; result: TranslationResult; latencyMs: number }
  | { type: "failed"; job: TranslationJob; error: unknown; latencyMs: number };

export interface SchedulerSnapshot {
  queued: number;
  active: number;
}

export interface SchedulerSyncStats {
  queued: number;
  inFlightReused: number;
  duplicateKeys: number;
}

export interface TranslationSchedulerOptions {
  concurrency: number;
  execute: (request: TranslationRequest) => Promise<TranslationResult>;
  onEvent: (event: SchedulerEvent) => void;
  now?: () => number;
}

export class TranslationScheduler {
  private readonly queue = new Map<string, TranslationJob>();
  private readonly inFlight = new Map<string, TranslationJob>();
  private drainScheduled = false;
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: TranslationSchedulerOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("Translation scheduler concurrency must be a positive integer.");
    }
    this.now = options.now ?? (() => performance.now());
  }

  sync(jobs: readonly TranslationJob[]): SchedulerSyncStats {
    const desired = new Map<string, TranslationJob>();
    let duplicateKeys = 0;
    for (const job of jobs) {
      const existing = desired.get(job.key);
      if (existing) duplicateKeys += 1;
      if (!existing || job.priority < existing.priority) desired.set(job.key, job);
    }

    for (const key of this.queue.keys()) {
      if (!desired.has(key)) this.queue.delete(key);
    }

    let queued = 0;
    let inFlightReused = 0;
    for (const job of desired.values()) {
      if (this.inFlight.has(job.key)) {
        inFlightReused += 1;
        continue;
      }
      const existing = this.queue.get(job.key);
      if (!existing || existing.priority !== job.priority || existing.request.regionId !== job.request.regionId) {
        this.queue.set(job.key, job);
      }
      if (!existing) queued += 1;
    }
    this.scheduleDrain();
    return { queued, inFlightReused, duplicateKeys };
  }

  snapshot(): SchedulerSnapshot {
    return { queued: this.queue.size, active: this.inFlight.size };
  }

  clear(): void {
    this.generation += 1;
    this.queue.clear();
    this.inFlight.clear();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  private drain(): void {
    while (this.inFlight.size < this.options.concurrency && this.queue.size > 0) {
      const job = [...this.queue.values()].sort((left, right) => left.priority - right.priority)[0]!;
      this.queue.delete(job.key);
      this.inFlight.set(job.key, job);
      const generation = this.generation;
      const startedAt = this.now();
      this.options.onEvent({ type: "started", job });
      void this.options.execute(job.request).then((result) => {
        if (generation === this.generation) {
          this.options.onEvent({ type: "completed", job, result, latencyMs: this.now() - startedAt });
        }
      }).catch((error) => {
        if (generation === this.generation) {
          this.options.onEvent({ type: "failed", job, error, latencyMs: this.now() - startedAt });
        }
      }).finally(() => {
        if (this.inFlight.get(job.key) === job) this.inFlight.delete(job.key);
        this.drain();
      });
    }
  }
}
