import { describe, expect, it } from 'vitest';
import { createNonce, renderWebviewHtml } from './webviewHtml';

const html = renderWebviewHtml({
  cspSource: 'vscode-webview://abc',
  scriptUri: 'vscode-webview://abc/main.js',
  styleUri: 'vscode-webview://abc/main.css',
  nonce: 'N0NCE',
  view: 'sidebar',
  title: 'Copilot <Insights>',
});

describe('renderWebviewHtml', () => {
  it('uses a strict nonce-based CSP', () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-N0NCE'");
    expect(html).toContain('style-src vscode-webview://abc');
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
  });

  it('loads the bundle with the nonce and marks the view', () => {
    expect(html).toContain(
      '<script type="module" nonce="N0NCE" src="vscode-webview://abc/main.js"></script>',
    );
    expect(html).toContain('<div id="root" data-view="sidebar"></div>');
    expect(html).toContain('<title>Copilot &lt;Insights&gt;</title>');
  });

  it('creates unpredictable nonces', () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(createNonce());
  });
});
