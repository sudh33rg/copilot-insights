export type Intent =
  'debug' | 'bugfix' | 'refactor' | 'test' | 'docs' | 'config' | 'explain' | 'feature' | 'other';

// Ordered: the first rule that matches wins. Keyword rules, so the result is always `inferred`.
const RULES: readonly (readonly [Intent, RegExp])[] = [
  ['debug', /\b(debug|stack ?trace|exception|crash(?:es|ed|ing)?|not working|doesn'?t work|failing)\b/i],
  ['bugfix', /\b(fix(?:es|ed)?|bugs?|broken|regression)\b/i],
  ['refactor', /\b(refactor|clean ?up|rename|restructure|simplif(?:y|ied))\b/i],
  ['test', /\b(tests?|specs?|coverage|unit ?tests?)\b/i],
  ['docs', /\b(docs?|readme|documentation|document|changelog|comments?)\b/i],
  [
    'config',
    /\b(config(?:ure|uration)?|set ?up|install|dependenc(?:y|ies)|ci|pipeline|docker|eslint|prettier)\b/i,
  ],
  ['explain', /\b(explain|what (?:is|does)|how (?:does|do)|why|walk me through|understand)\b/i],
  ['feature', /\b(add|implement|create|build|support|introduce)\b/i],
];

export function classifyIntent(prompt: string): { intent: Intent; matched: string } {
  for (const [intent, pattern] of RULES) {
    const match = pattern.exec(prompt);
    if (match) return { intent, matched: match[0].toLowerCase() };
  }
  return { intent: 'other', matched: '' };
}
