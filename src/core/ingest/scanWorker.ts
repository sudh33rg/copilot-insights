import { parentPort, workerData } from 'node:worker_threads';
import { scanAll } from './scanAll';
import type { ScanInput } from './scanner';

const port = parentPort;
if (port === null) throw new Error('scanWorker must run inside a worker thread');

try {
  port.postMessage({ ok: true, value: scanAll(workerData as ScanInput) });
} catch (error) {
  port.postMessage({
    ok: false,
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
}
