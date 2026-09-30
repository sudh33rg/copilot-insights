import { describe, expect, it } from 'vitest';
import { classifyTask } from './taskType';

const file = (path: string, action = 'edited') => ({ path, action });

describe('classifyTask', () => {
  it('lets the prompt intent win when it is not "other"', () => {
    expect(classifyTask({ intent: 'bugfix', changed: [file('/r/a.ts')], commandCount: 0 })).toMatchObject({
      type: 'bugfix',
      rule: 'prompt keyword: bugfix',
    });
  });

  it('prefers the prompt over what the files look like', () => {
    const changed = [file('/r/src/a.test.ts'), file('/r/src/b.spec.ts')];
    expect(classifyTask({ intent: 'docs', changed, commandCount: 0 }).type).toBe('docs');
  });

  it.each([
    ['test', ['/r/src/a.test.ts', '/r/test/fixtures/b.ts', '/r/pkg/__tests__/c.ts']],
    ['docs', ['/r/README.md', '/r/docs/guide.mdx', '/r/docs/img/x.png']],
    ['config', ['/r/package.json', '/r/.github/workflows/ci.yml', '/r/Dockerfile', '/r/tsconfig.build.json']],
  ] as const)(
    'classifies a session that only touched %s files when the prompt gives no cue',
    (type, paths) => {
      const result = classifyTask({ intent: 'other', changed: paths.map((p) => file(p)), commandCount: 0 });
      expect(result.type).toBe(type);
      expect(result.rule).toBe(`all changed files are ${type} files`);
    },
  );

  it('treats a missing intent like "other"', () => {
    expect(classifyTask({ intent: null, changed: [file('/r/README.md')], commandCount: 0 }).type).toBe(
      'docs',
    );
  });

  it('does not classify a mixed change set by its files', () => {
    const changed = [file('/r/src/a.test.ts'), file('/r/src/a.ts')];
    expect(classifyTask({ intent: 'other', changed, commandCount: 0 })).toMatchObject({
      type: 'other',
      rule: 'no deterministic signal',
    });
  });

  it('calls a session with no changes an explanation, or debugging if commands ran', () => {
    expect(classifyTask({ intent: 'other', changed: [], commandCount: 0 })).toMatchObject({
      type: 'explain',
      rule: 'no files changed and no terminal commands',
    });
    expect(classifyTask({ intent: 'other', changed: [], commandCount: 2 })).toMatchObject({
      type: 'debug',
      rule: 'no files changed but terminal commands ran',
    });
  });

  it('says which kind of evidence decided it', () => {
    expect(classifyTask({ intent: 'bugfix', changed: [], commandCount: 0 }).basis).toBe('prompt');
    expect(classifyTask({ intent: 'other', changed: [file('/r/README.md')], commandCount: 0 }).basis).toBe(
      'files',
    );
  });
});
