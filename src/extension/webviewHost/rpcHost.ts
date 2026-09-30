import {
  isRpcMethod,
  rpcSchemas,
  webviewToHost,
  type HostEvent,
  type HostToWebview,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
} from '../../shared/protocol';

export type RpcHandlers = {
  [M in RpcMethod]: (params: RpcParams<M>) => RpcResult<M> | Promise<RpcResult<M>>;
};

/** The subset of vscode.Webview the RPC host needs; keeps this file testable without VS Code. */
export interface WebviewLike {
  postMessage(message: HostToWebview): PromiseLike<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
}

export class RpcHost {
  private readonly subscription: { dispose(): void };

  constructor(
    private readonly webview: WebviewLike,
    private readonly handlers: RpcHandlers,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    this.subscription = webview.onDidReceiveMessage((message) => {
      void this.handle(message);
    });
  }

  emit(event: HostEvent): void {
    void this.webview.postMessage({ kind: 'event', event });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private async handle(raw: unknown): Promise<void> {
    const message = webviewToHost.safeParse(raw);
    if (!message.success || message.data.kind !== 'rpc') return;
    const { id, method, params } = message.data;
    if (!isRpcMethod(method)) {
      await this.reply({ kind: 'rpc-result', id, ok: false, error: `Unknown method: ${method}` });
      return;
    }
    const parsed = rpcSchemas[method].params.safeParse(params);
    if (!parsed.success) {
      await this.reply({ kind: 'rpc-result', id, ok: false, error: `Invalid params for ${method}` });
      return;
    }
    try {
      // Params were validated against this method's schema above, so the widening cast is safe.
      const handler = this.handlers[method] as (validated: unknown) => unknown;
      const result = await handler(parsed.data);
      await this.reply({ kind: 'rpc-result', id, ok: true, result });
    } catch (error) {
      this.onError(error);
      await this.reply({
        kind: 'rpc-result',
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reply(message: HostToWebview): Promise<void> {
    await this.webview.postMessage(message);
  }
}
