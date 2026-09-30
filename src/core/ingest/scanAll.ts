import { scanCatalogs, type CatalogScanOutput } from '../debuglog/catalogScanner';
import { scanDebugLogs, type DebugScanOutput } from '../debuglog/scanner';
import { scanChatSessions, type ScanInput, type ScanOutput } from './scanner';

export interface FullScanOutput extends ScanOutput {
  debug: DebugScanOutput;
  catalogs: CatalogScanOutput;
}

/** Chat sessions and debug logs in one pass, so the extension host still spawns a single worker. */
export function scanAll(input: ScanInput): FullScanOutput {
  return {
    ...scanChatSessions(input),
    debug: scanDebugLogs({ roots: input.roots, known: input.known, tombstones: input.tombstones }),
    catalogs: scanCatalogs({ roots: input.roots, known: input.known }),
  };
}
