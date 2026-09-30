export const GITHUB_API = 'https://api.github.com';
/** Verified against https://docs.github.com/en/rest/billing/usage on 2026-09-30. */
export const API_VERSION = '2026-03-10';

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }>;

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

/** The only place the GitHub token is attached to a request, and only for https://api.github.com. */
export class GithubClient {
  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly token: string,
  ) {}

  async getJson(path: string): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new Error('GitHub API paths must be absolute and relative to api.github.com');
    }
    const url = new URL(path, GITHUB_API);
    if (url.origin !== GITHUB_API) throw new Error('Refusing to send credentials to another host');
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'copilot-insights-vscode',
      },
    });
    if (!response.ok) {
      throw new GithubApiError(
        `GitHub API ${String(response.status)} ${response.statusText}`.trim(),
        response.status,
      );
    }
    return response.json();
  }
}
