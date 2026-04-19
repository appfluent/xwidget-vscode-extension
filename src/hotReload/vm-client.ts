import WebSocket from 'ws';

/**
 * Minimal JSON-RPC 2.0 client over WebSocket for the Dart VM service.
 *
 * The Dart VM service exposes a rich API (hundreds of RPCs) but for hot
 * reload we only need two: `getVM` to find the running isolate, and
 * `callServiceExtension` to invoke `ext.xwidget.updateFragment` /
 * `ext.xwidget.updateValues`. Pulling in a whole VM service library would
 * be overkill — a few hundred bytes of JSON-RPC plumbing covers the need.
 *
 * URI format: Dart-Code provides URIs as `http://HOST:PORT/TOKEN=/` in the
 * `dart.debuggerUris` custom debug event. The actual WebSocket endpoint is
 * `ws://HOST:PORT/TOKEN=/ws` — same path with `http`→`ws` and `/ws` appended.
 * `toWebSocketUri` handles the transformation.
 */
export class VmClient {
  private socket: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private closeReason: string | undefined;

  /**
   * Connects to the VM service WebSocket. Resolves when the socket is open
   * and ready to send requests. Rejects if the connection fails.
   */
  async connect(serviceUri: string): Promise<void> {
    const wsUri = toWebSocketUri(serviceUri);
    this.socket = new WebSocket(wsUri);

    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('VmClient: socket not initialized'));
        return;
      }
      const socket = this.socket;

      const onOpen = () => {
        socket.off('error', onOpenError);
        socket.on('message', (data) => this.handleMessage(data));
        socket.on('close', (_code, reason) => this.handleClose(reason.toString()));
        socket.on('error', (err) => this.handleError(err));
        resolve();
      };
      const onOpenError = (err: Error) => {
        socket.off('open', onOpen);
        reject(err);
      };

      socket.once('open', onOpen);
      socket.once('error', onOpenError);
    });
  }

  /**
   * Sends a JSON-RPC request and resolves with the `result` field of the
   * response. Rejects if the server returns an error or the connection
   * closes before the response arrives.
   */
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(
        `VmClient: cannot send '${method}' — socket not open (${this.closeReason ?? 'not connected'})`,
      );
    }
    const id = String(this.nextId++);
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.send(JSON.stringify(request), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * Closes the WebSocket. Safe to call multiple times or on an already-closed
   * client. Rejects all pending requests so callers don't hang.
   */
  dispose(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // WebSocket already in a terminal state — ignore.
      }
      this.socket = undefined;
    }
    const err = new Error('VmClient: disposed');
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  get isConnected(): boolean {
    return this.socket !== undefined && this.socket.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: WebSocket.Data): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return; // Non-JSON frames ignored.
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const msg = parsed as { id?: string; result?: unknown; error?: { message?: string; code?: number } };
    if (!msg.id) return; // Event/notification — we don't subscribe to any.
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(
        new Error(`VmClient: ${msg.error.message ?? 'unknown error'} (code ${msg.error.code ?? '?'})`),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleClose(reason: string): void {
    this.closeReason = reason || 'connection closed';
    const err = new Error(`VmClient: connection closed (${this.closeReason})`);
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
    this.socket = undefined;
  }

  private handleError(err: Error): void {
    // Runtime errors on an open socket. Individual pending requests will be
    // rejected via the subsequent close event; we just record the cause.
    this.closeReason = err.message;
  }
}

/**
 * Converts a Dart VM service HTTP URI (as delivered by Dart-Code's
 * `dart.debuggerUris` event) into the WebSocket endpoint URI.
 *
 * Examples:
 *   http://127.0.0.1:8181/afZySiNbDPg=/   →  ws://127.0.0.1:8181/afZySiNbDPg=/ws
 *   https://example.dev/TOKEN=/           →  wss://example.dev/TOKEN=/ws
 *   ws://already/a/ws                     →  ws://already/a/ws (no-op)
 *
 * Exported for unit testing.
 */
export function toWebSocketUri(serviceUri: string): string {
  let uri = serviceUri;
  if (uri.startsWith('https://')) {
    uri = `wss://${uri.substring('https://'.length)}`;
  } else if (uri.startsWith('http://')) {
    uri = `ws://${uri.substring('http://'.length)}`;
  }
  // Already a ws:// URI — only append /ws if it doesn't already end with /ws
  // (or /ws/ which we normalize to /ws). The VM service endpoint always
  // lives at the /ws path under the root token directory.
  if (uri.endsWith('/ws') || uri.endsWith('/ws/')) {
    return uri.endsWith('/') ? uri.slice(0, -1) : uri;
  }
  if (uri.endsWith('/')) {
    return `${uri}ws`;
  }
  return `${uri}/ws`;
}

/**
 * Minimal shape of the VM info returned by `getVM`. Only the fields we use
 * are typed; the real response has many more.
 */
export interface VmInfo {
  isolates: Array<{ id: string; name?: string }>;
}
