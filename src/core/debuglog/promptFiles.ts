import { isRecord } from '../json';

function fileContent(fileText: string): unknown {
  try {
    const parsed: unknown = JSON.parse(fileText);
    return isRecord(parsed) ? parsed.content : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Names and sizes of the tool definitions Copilot sent (`tools_N.json` is `{content: "<JSON array>"}`). The
 * descriptions and schemas are measured and dropped; only the name and the definition's character count remain.
 */
export function parseToolDefs(fileText: string): { name: string; chars: number }[] | null {
  const content = fileContent(fileText);
  if (typeof content !== 'string') return null;
  let tools: unknown;
  try {
    tools = JSON.parse(content);
  } catch {
    return null;
  }
  if (!Array.isArray(tools)) return null;
  return tools.flatMap((tool: unknown) => {
    if (!isRecord(tool)) return [];
    const nested = isRecord(tool.function) ? tool.function : null;
    const name =
      typeof tool.name === 'string' ? tool.name : typeof nested?.name === 'string' ? nested.name : null;
    return name === null || name === '' ? [] : [{ name, chars: JSON.stringify(tool).length }];
  });
}

/** Character size of a prompt file (`system_prompt_N.json` is `{content: "<text>"}`); never the text. */
export function parsePromptFileChars(fileText: string): number | null {
  const content = fileContent(fileText);
  return typeof content === 'string' ? content.length : null;
}
