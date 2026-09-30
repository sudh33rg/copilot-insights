import * as vscode from 'vscode';
import { countPatchLines } from '../../core/git/numstat';
import type { GitCommit, GitPort, GitRepo } from '../../core/git/types';

// Minimal typings of the parts of vscode.git's API v1 that we use.
interface ApiRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { commit?: string };
    workingTreeChanges: { uri: vscode.Uri }[];
    indexChanges: { uri: vscode.Uri }[];
  };
  diffWithHEAD(path: string): Promise<string>;
  log(options: {
    maxEntries?: number;
    since?: Date;
  }): Promise<{ hash: string; commitDate?: Date; authorDate?: Date; parents: string[] }[]>;
  diffBetween(ref1: string, ref2: string): Promise<{ uri: vscode.Uri }[]>;
  show(ref: string, path: string): Promise<string>;
}
interface GitApi {
  repositories: ApiRepository[];
}
interface GitExtension {
  getAPI(version: 1): GitApi;
}

const MAX_FILES = 200;
const MAX_COMMITS = 50;

export class VscodeGit implements GitPort {
  async repos(): Promise<GitRepo[]> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (extension === undefined) return [];
    const exports = extension.isActive ? extension.exports : await extension.activate();
    const api = exports.getAPI(1);
    return api.repositories.slice(0, 5).map((repository) => adapt(repository));
  }
}

function adapt(repository: ApiRepository): GitRepo {
  return {
    root: repository.rootUri.fsPath,
    head: () => Promise.resolve(repository.state.HEAD?.commit ?? null),
    workingTreeNumstat: async () => {
      const changed = [...repository.state.workingTreeChanges, ...repository.state.indexChanges];
      const paths = [...new Set(changed.map((change) => change.uri.fsPath))].slice(0, MAX_FILES);
      const result = [];
      for (const path of paths) {
        try {
          result.push({ path, ...countPatchLines(await repository.diffWithHEAD(path)) });
        } catch {
          // Untracked or unreadable file: skip rather than guess.
        }
      }
      return result;
    },
    commitsSince: async (sinceMs) => {
      const commits = await repository.log({ maxEntries: MAX_COMMITS, since: new Date(sinceMs) });
      const out: GitCommit[] = [];
      for (const commit of commits) {
        const parent = commit.parents[0];
        if (parent === undefined) continue;
        const changes = await repository.diffBetween(parent, commit.hash);
        out.push({
          hash: commit.hash,
          committedAt: (commit.commitDate ?? commit.authorDate ?? new Date(0)).getTime(),
          files: changes.map((change) => change.uri.fsPath),
        });
      }
      return out;
    },
    fileAtCommit: async (hash, path) => {
      try {
        return await repository.show(hash, path);
      } catch {
        return null;
      }
    },
  };
}
