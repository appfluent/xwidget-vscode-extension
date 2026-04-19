import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { VmClient, VmInfo } from './vm-client';
import { HotReloadStatus } from './hot-reload-status';
import {
  EXT_UPDATE_FRAGMENT,
  EXT_UPDATE_VALUES,
  HOT_RELOAD_DEBOUNCE_MS,
} from '../util/constants';

/**
 * Handles hot reload for one Dart debug session.
 *
 * Lifecycle:
 *   1. `start()` — connects the VmClient and installs the two watchers.
 *   2. While alive, file changes in `fragmentsPath` / `valuesPath` debounce
 *      into VM service calls that push the new content to the running app.
 *   3. `dispose()` — closes the WebSocket, removes watchers, cancels pending
 *      debounce timers. Called when the debug session ends.
 *
 * Watch paths are snapshotted from `xwidget_config.yaml` at session start.
 * NOTE: If the user changes `fragmentsPath` or `valuesPath` mid-session, the
 * session will keep watching the original paths until the debug session ends
 * and a new one starts. Matches the IntelliJ plugin's behavior. Stopping and
 * restarting the debugger picks up the new config.
 */
export class HotReloadSession implements vscode.Disposable {
  private readonly vmClient = new VmClient();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private disposed = false;

  constructor(
    private readonly options: HotReloadSessionOptions,
    private readonly status: HotReloadStatus,
    private readonly output: vscode.OutputChannel,
  ) {}

  /**
   * Connects the VM client and installs the two file watchers. Throws if the
   * connection fails — caller (the manager) logs and skips the session.
   */
  async start(): Promise<void> {
    await this.vmClient.connect(this.options.vmServiceUri);
    this.output.appendLine(
      `[hot-reload] connected for session ${this.options.sessionId}`,
    );

    this.installWatcher(
      this.options.fragmentsAbsPath,
      (uri) => this.onFragmentChange(uri),
    );
    this.installWatcher(
      this.options.valuesAbsPath,
      (uri) => this.onValuesChange(uri),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.vmClient.dispose();
    this.output.appendLine(
      `[hot-reload] disposed session ${this.options.sessionId}`,
    );
  }

  /**
   * Wires up a FileSystemWatcher for `.xml` files under `absDir`. The watcher
   * fires on create + change (we treat both as "reload this file") and
   * ignores delete (nothing to push to the running app).
   */
  private installWatcher(
    absDir: string,
    handler: (uri: vscode.Uri) => void,
  ): void {
    // RelativePattern scopes the watcher to a specific directory tree,
    // avoiding churn from unrelated file activity elsewhere in the workspace.
    const pattern = new vscode.RelativePattern(absDir, '**/*.xml');
    const watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
      /* ignoreCreateEvents */ false,
      /* ignoreChangeEvents */ false,
      /* ignoreDeleteEvents */ true,
    );
    watcher.onDidCreate(handler);
    watcher.onDidChange(handler);
    this.disposables.push(watcher);
  }

  private onFragmentChange(uri: vscode.Uri): void {
    this.debounce(uri.fsPath, async () => {
      // `fqn` is the relative path from fragmentsPath to the changed file,
      // using forward slashes. Mirrors XWidgetService.kt's fqn computation.
      const rel = path
        .relative(this.options.fragmentsAbsPath, uri.fsPath)
        .split(path.sep)
        .join('/');
      const label = rel || path.basename(uri.fsPath);
      this.status.showReloading(label);
      try {
        const content = await fs.readFile(uri.fsPath, 'utf8');
        await this.invokeExtension(EXT_UPDATE_FRAGMENT, { fqn: rel, content });
        this.status.showSuccess(label);
        this.output.appendLine(`[hot-reload] OK fragment: ${rel}`);
      } catch (err) {
        this.status.showError(label, err instanceof Error ? err.message : String(err));
      }
    });
  }

  private onValuesChange(uri: vscode.Uri): void {
    this.debounce(uri.fsPath, async () => {
      const label = path.basename(uri.fsPath);
      this.status.showReloading(label);
      try {
        const content = await fs.readFile(uri.fsPath, 'utf8');
        await this.invokeExtension(EXT_UPDATE_VALUES, { content });
        this.status.showSuccess(label);
        this.output.appendLine(`[hot-reload] OK values: ${label}`);
      } catch (err) {
        this.status.showError(label, err instanceof Error ? err.message : String(err));
      }
    });
  }

  /**
   * Resolves the first isolate's id and issues `callServiceExtension`. The
   * VM service requires an isolateId for service extension calls even
   * though `ext.xwidget.*` is registered globally — the extension just
   * dispatches to that isolate.
   *
   * We re-fetch the VM every call rather than caching the isolate id: Flutter
   * isolates can change identity across hot restarts, and the cost of `getVM`
   * is negligible (a few ms over an already-open WebSocket).
   */
  private async invokeExtension(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (!this.vmClient.isConnected) {
      throw new Error('VM service not connected');
    }
    const vm = (await this.vmClient.call('getVM')) as VmInfo;
    if (!vm.isolates || vm.isolates.length === 0) {
      throw new Error('no running isolates');
    }
    const isolateId = vm.isolates[0].id;
    await this.vmClient.call(method, { isolateId, ...params });
  }

  /**
   * Debounces per-file-path. Multiple rapid saves of the same file coalesce
   * into one VM service call; saves of different files fire independently.
   */
  private debounce(key: string, action: () => Promise<void>): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      if (this.disposed) return;
      void action();
    }, HOT_RELOAD_DEBOUNCE_MS);
    this.debounceTimers.set(key, timer);
  }
}

export interface HotReloadSessionOptions {
  /** VSCode debug session id — used for logging / disambiguating sessions. */
  readonly sessionId: string;
  /** WebSocket URI of the Dart VM service (already in http:// form). */
  readonly vmServiceUri: string;
  /** Absolute path to the fragments directory (from xwidget_config.yaml). */
  readonly fragmentsAbsPath: string;
  /** Absolute path to the values directory (from xwidget_config.yaml). */
  readonly valuesAbsPath: string;
}
