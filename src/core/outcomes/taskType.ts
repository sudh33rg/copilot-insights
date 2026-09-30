import type { Intent } from '../analysis/intent';

export type TaskType =
  'bugfix' | 'feature' | 'refactor' | 'test' | 'docs' | 'explain' | 'debug' | 'config' | 'other';

const TEST_PATH = /(^|[\\/])(tests?|__tests__)[\\/]|\.(test|spec)\.[a-z]+$/i;
const DOCS_PATH = /\.(md|mdx|rst)$|(^|[\\/])docs[\\/]/i;
const CONFIG_PATH =
  /\.(json|ya?ml|toml|lock|ini)$|(^|[\\/])Dockerfile$|(^|[\\/])\.github[\\/]|(^|[\\/])\.eslintrc[^\\/]*$|(^|[\\/])tsconfig[^\\/]*$/i;

export const isTestPath = (path: string): boolean => TEST_PATH.test(path);

export interface TaskClassification {
  type: TaskType;
  /** The rule that decided, shown as the provenance source. */
  rule: string;
  /** `prompt` = keyword match on the user's words (inferred); `files` = what was changed (derived). */
  basis: 'prompt' | 'files';
}

/**
 * Deterministic task taxonomy. The prompt's keyword intent wins; otherwise the kind of files changed decides;
 * an edit with no other cue stays `other` because guessing "feature" vs "refactor" would be invention.
 */
export function classifyTask(input: {
  intent: Intent | null;
  changed: readonly { path: string; action: string }[];
  commandCount: number;
}): TaskClassification {
  if (input.intent !== null && input.intent !== 'other') {
    return { type: input.intent, rule: `prompt keyword: ${input.intent}`, basis: 'prompt' };
  }
  const paths = input.changed.map((file) => file.path);
  if (paths.length === 0) {
    return input.commandCount === 0
      ? { type: 'explain', rule: 'no files changed and no terminal commands', basis: 'files' }
      : { type: 'debug', rule: 'no files changed but terminal commands ran', basis: 'files' };
  }
  const only = (pattern: RegExp) => paths.every((path) => pattern.test(path));
  if (only(TEST_PATH)) return { type: 'test', rule: 'all changed files are test files', basis: 'files' };
  if (only(DOCS_PATH)) return { type: 'docs', rule: 'all changed files are docs files', basis: 'files' };
  if (only(CONFIG_PATH))
    return { type: 'config', rule: 'all changed files are config files', basis: 'files' };
  return { type: 'other', rule: 'no deterministic signal', basis: 'files' };
}
