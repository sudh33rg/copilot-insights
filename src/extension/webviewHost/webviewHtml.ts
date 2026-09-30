import { randomBytes } from 'node:crypto';

export type WebviewKind = 'dashboard' | 'sidebar';

export interface WebviewHtmlOptions {
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  nonce: string;
  view: WebviewKind;
  title: string;
}

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const csp = [
    "default-src 'none'",
    `img-src ${options.cspSource} data:`,
    `style-src ${options.cspSource}`,
    `font-src ${options.cspSource}`,
    `script-src 'nonce-${options.nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${escapeHtml(options.styleUri)}">
<title>${escapeHtml(options.title)}</title>
</head>
<body>
<div id="root" data-view="${options.view}"></div>
<script type="module" nonce="${options.nonce}" src="${escapeHtml(options.scriptUri)}"></script>
</body>
</html>`;
}

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
