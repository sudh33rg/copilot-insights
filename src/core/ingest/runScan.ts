import { Worker } from 'node:worker_threads';
import { scanAll, type FullScanOutput } from './scanAll';
import type { ScanInput } from './scanner';

export interface RunScanOptions {
  /** Path to the bundled dist/scanWorker.js. When omitted the scan runs in-process (unit tests). */
  workerFile?: string;
  timeoutMs?: number;
}

type WorkerReply = { ok: true; value: FullScanOutput } | { ok: false; error: string };

export function runScan(input: ScanInput, options: RunScanOptions = {}): Promise<FullScanOutput> {
  const { workerFile, timeoutMs = 120_000 } = options;
  if (workerFile === undefined) {
    return new Promise((resolve) => {
      resolve(scanAll(input));
    });
  }
  return new Promise<FullScanOutput>((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: input });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`Session scan timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    worker.once('message', (reply: WorkerReply) => {
      clearTimeout(timer);
      void worker.terminate();
      if (reply.ok) resolve(reply.value);
      else reject(new Error(reply.error));
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Scan worker exited with code ${code}`));
    });
  });
}
