import { describe, expect, it } from 'vitest';
import { API_VERSION, GithubApiError, GithubClient, type FetchLike } from './client';

function recorder(status = 200, body: unknown = { ok: true }) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    requests.push({ url, headers: init.headers });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Status',
      json: () => Promise.resolve(body),
    });
  };
  return { requests, fetchImpl };
}

describe('GithubClient', () => {
  it('sends the token and API version only to api.github.com', async () => {
    const { requests, fetchImpl } = recorder();
    await new GithubClient(fetchImpl, 'tok').getJson(
      '/users/octo/settings/billing/ai_credit/usage?year=2026',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://api.github.com/users/octo/settings/billing/ai_credit/usage?year=2026',
    );
    expect(requests[0]?.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'X-GitHub-Api-Version': API_VERSION,
      Accept: 'application/vnd.github+json',
    });
  });

  it.each([
    'https://evil.example/x',
    '//evil.example/x',
    'http://api.github.com/x',
    'users/octo',
    '/\\evil.example',
  ])('refuses to send the token to %s', async (target) => {
    const { requests, fetchImpl } = recorder();
    await expect(new GithubClient(fetchImpl, 'tok').getJson(target)).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  it('reports failures by status only, without echoing the response body', async () => {
    const { fetchImpl } = recorder(403, { message: 'secret-detail' });
    const error = await new GithubClient(fetchImpl, 'tok')
      .getJson('/user')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GithubApiError);
    expect((error as GithubApiError).status).toBe(403);
    expect((error as GithubApiError).message).not.toContain('secret-detail');
    expect((error as GithubApiError).message).not.toContain('tok');
  });
});
