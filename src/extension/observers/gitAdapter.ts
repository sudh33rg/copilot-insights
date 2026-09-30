import * as vscode from 'vscode';
import { countPatchLines, countTextLines } from '../../core/git/numstat';
import type { GitCommit, GitPort, GitRepo } from '../../core/git/types';
import { readWorkspaceFile } from './readFile';

// Minimal typings of the parts of vscode.git's API v1 that we use.
interface ApiRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { commit?: string };
    workingTreeChanges: { uri: vscode.Uri; status: number }[];
    indexChanges: { uri: vscode.Uri }[];
    /** Files git does not track yet; absent on very old API versions. */
    untrackedChanges?: { uri: vscode.Uri }[];
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
/** `Status.UNTRACKED` in the vscode.git API. */
const GIT_STATUS_UNTRACKED = 7;
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
      const { state } = repository;
      // New files are not in `diffWithHEAD`; every line of a new text file counts as an added line. Git reports
      // them either in workingTreeChanges (status UNTRACKED) or, with git.untrackedChanges=separate, here.
      const untracked = new Set([
        ...(state.untrackedChanges ?? []).map((change) => change.uri.fsPath),
        ...state.workingTreeChanges
          .filter((change) => change.status === GIT_STATUS_UNTRACKED)
          .map((change) => change.uri.fsPath),
      ]);
      const changed = [...state.workingTreeChanges, ...state.indexChanges, ...(state.untrackedChanges ?? [])];
      const paths = [...new Set(changed.map((change) => change.uri.fsPath))].slice(0, MAX_FILES);
      const result = [];
      for (const path of paths) {
        try {
          if (untracked.has(path)) {
            const lines = countTextLines((await readWorkspaceFile(path)) ?? '');
            if (lines !== null) result.push({ path, added: lines, removed: 0 });
          } else {
            result.push({ path, ...countPatchLines(await repository.diffWithHEAD(path)) });
          }
        } catch {
          // Unreadable or too large: skip rather than guess.
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
