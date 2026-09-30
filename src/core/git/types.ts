export interface FileNumstat {
  path: string;
  added: number;
  removed: number;
} // absolute path
export interface GitCommit {
  hash: string;
  committedAt: number;
  files: string[];
} // absolute paths
export interface GitRepo {
  readonly root: string;
  head(): Promise<string | null>;
  workingTreeNumstat(): Promise<FileNumstat[]>;
  commitsSince(sinceMs: number): Promise<GitCommit[]>;
  fileAtCommit(hash: string, path: string): Promise<string | null>;
}
export interface GitPort {
  repos(): Promise<GitRepo[]>;
}
