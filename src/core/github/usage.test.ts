import { describe, expect, it } from 'vitest';
import { Database } from '../storage/database';
import { GithubApiError, GithubClient, type FetchLike } from './client';
import { creditsOf, syncGithubUsage } from './usage';
import { GithubUsageStore } from './usageStore';

describe('creditsOf', () => {
  it('reads credit-denominated quantities, preferring gross over net', () => {
    expect(creditsOf({ unitType: 'ai-credits', grossQuantity: 12, netQuantity: 4 })).toBe(12);
    expect(creditsOf({ unitType: 'credits', netQuantity: 3 })).toBe(3);
  });

  it('derives credits from dollars only for the documented 1-cent credit price', () => {
    expect(creditsOf({ unitType: 'requests', pricePerUnit: 0.01, grossAmount: 0.5 })).toBeCloseTo(50);
  });

  it('ignores items that are not credits and tolerates garbage', () => {
    expect(creditsOf({ unitType: 'minutes', grossQuantity: 9 })).toBe(0);
    expect(creditsOf({ unitType: 'credits', grossQuantity: 'lots' })).toBe(0);
    expect(creditsOf({})).toBe(0);
  });
});

function fakeGithub(handler: (url: string) => { status: number; body?: unknown }) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    const { status, body } = handler(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'S',
      json: () => Promise.resolve(body),
    });
  };
  return { urls, client: new GithubClient(fetchImpl, 'tok') };
}

const deps = (client: GithubClient) => {
  const store = new GithubUsageStore(new Database(':memory:'));
  return { store, args: { client, user: 'octo', store, today: '2026-09-03', days: 3, now: () => 555 } };
};

describe('syncGithubUsage', () => {
  it('fetches each day, sums credit items and stores them', async () => {
    const { urls, client } = fakeGithub((url) => ({
      status: 200,
      body: {
        usageItems: [
          { unitType: 'ai-credits', grossQuantity: url.includes('day=3') ? 5 : 1 },
          { unitType: 'minutes', grossQuantity: 100 },
        ],
      },
    }));
    const { store, args } = deps(client);
    expect(await syncGithubUsage(args)).toEqual({ synced: 3, unavailable: false, errors: [] });
    expect(store.list('2026-09-01', '2026-09-03')).toEqual([
      { day: '2026-09-01', credits: 1 },
      { day: '2026-09-02', credits: 1 },
      { day: '2026-09-03', credits: 5 },
    ]);
    expect(
      urls.every((url) =>
        url.startsWith('https://api.github.com/users/octo/settings/billing/ai_credit/usage?'),
      ),
    ).toBe(true);
    expect(urls).toContain(
      'https://api.github.com/users/octo/settings/billing/ai_credit/usage?year=2026&month=9&day=3',
    );
  });

  it('encodes the username so it cannot change the request path or host', async () => {
    const { urls, client } = fakeGithub(() => ({ status: 200, body: { usageItems: [] } }));
    const { args } = deps(client);
    await syncGithubUsage({ ...args, user: '../../orgs/x', days: 1 });
    expect(urls[0]).toContain('/users/..%2F..%2Forgs%2Fx/settings/');
    expect(new URL(urls[0] ?? '').host).toBe('api.github.com');
  });

  it('reports "unavailable" once when usage is billed elsewhere (403/404) and stops', async () => {
    const { urls, client } = fakeGithub(() => ({ status: 404 }));
    const { args } = deps(client);
    const outcome = await syncGithubUsage(args);
    expect(outcome).toMatchObject({ synced: 0, unavailable: true });
    expect(urls.length).toBeLessThanOrEqual(args.days);
  });

  it('keeps going after a transient failure and lists the failed day', async () => {
    const { client } = fakeGithub((url) =>
      url.includes('day=2')
        ? { status: 500 }
        : { status: 200, body: { usageItems: [{ unitType: 'credits', grossQuantity: 2 }] } },
    );
    const { store, args } = deps(client);
    const outcome = await syncGithubUsage(args);
    expect(outcome.synced).toBe(2);
    expect(outcome.errors).toEqual(['2026-09-02: GitHub API 500 S']);
    expect(store.list('2026-09-01', '2026-09-03').map((row) => row.day)).toEqual([
      '2026-09-01',
      '2026-09-03',
    ]);
  });

  it('tolerates a malformed response body', async () => {
    const { client } = fakeGithub(() => ({ status: 200, body: 'not an object' }));
    const { store, args } = deps(client);
    expect((await syncGithubUsage({ ...args, days: 1 })).synced).toBe(1);
    expect(store.list('2026-09-01', '2026-09-03')).toEqual([{ day: '2026-09-03', credits: 0 }]);
  });

  it('exposes the API error type for callers', () => {
    expect(new GithubApiError('x', 401).status).toBe(401);
  });
});
