import { describe, expect, it } from 'vitest';
import { isRpcMethod, rpcSchemas, webviewToHost } from './protocol';

describe('protocol', () => {
  it('accepts well-formed RPC requests and the ready signal', () => {
    expect(webviewToHost.safeParse({ kind: 'rpc', id: 1, method: 'ping', params: {} }).success).toBe(true);
    expect(webviewToHost.safeParse({ kind: 'ready' }).success).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(webviewToHost.safeParse({ kind: 'rpc', id: -1, method: 'ping' }).success).toBe(false);
    expect(webviewToHost.safeParse('ping').success).toBe(false);
    expect(webviewToHost.safeParse({ kind: 'other' }).success).toBe(false);
  });

  it('recognises only declared methods', () => {
    expect(isRpcMethod('ping')).toBe(true);
    expect(isRpcMethod('toString')).toBe(false);
    expect(isRpcMethod('__proto__')).toBe(false);
  });

  it('declares the Phase 2 methods and validates their params', () => {
    for (const method of ['listSessions', 'getSession', 'getOverview', 'openDashboard']) {
      expect(isRpcMethod(method)).toBe(true);
    }
    expect(rpcSchemas.listSessions.params.safeParse({ offset: 0, limit: 50 }).success).toBe(true);
    expect(rpcSchemas.listSessions.params.safeParse({ offset: 0, limit: 5000 }).success).toBe(false);
    expect(rpcSchemas.getSession.params.safeParse({ id: '' }).success).toBe(false);
  });

  it('validates clearData scopes and rejects unknown kinds or malformed days', () => {
    const params = rpcSchemas.clearData.params;
    expect(params.safeParse({ scope: { kind: 'everything' } }).success).toBe(true);
    expect(params.safeParse({ scope: { kind: 'session', id: 'abc' } }).success).toBe(true);
    expect(params.safeParse({ scope: { kind: 'beforeDay', day: '2026-9-1' } }).success).toBe(false);
    expect(params.safeParse({ scope: { kind: 'dropTables' } }).success).toBe(false);
  });
});
