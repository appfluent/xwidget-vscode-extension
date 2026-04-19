import * as vscode from 'vscode';
import * as path from 'node:path';
import { HotReloadSession } from './hot-reload-session';
import { HotReloadStatus } from './hot-reload-status';
import { XWidgetService } from '../services/xwidget-service';
import { HOT_RELOAD_SINCE_VERSION } from '../util/constants';

/**
 * Top-level coordinator for hot reload across all active Dart debug sessions.
 *
 * Wiring:
 *   - Listens for Dart-Code's custom `dart.debuggerUris` debug event, which
 *     carries the VM service URI we need. (Dart-Code doesn't expose a public
 *     API — custom events are the documented extension point.)
 *   - When the event fires for a Dart debug session AND the project uses
 *     xwidget >= 0.4.2, a new `HotReloadSession` is created and connected.
 *   - When a debug session ends, its session is disposed.
 *
 * Multiple concurrent sessions: keyed by VSCode's `session.id` so each gets
 * its own watcher pair and VM service connection. The status bar shows
 * whichever session most recently fired a reload.
 */
export class HotReloadManager implements vscode.Disposable {
  private readonly sessions = new Map<string, HotReloadSession>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly status: HotReloadStatus;

  constructor(
    private readonly service: XWidgetService,
    private readonly output: vscode.OutputChannel,
  ) {
    this.status = new HotReloadStatus(output);
    this.disposables.push(this.status);

    this.disposables.push(
      // The URI-available event. Dart-Code emits this once the VM service
      // has connected, which may be 1-3 seconds after the debug session
      // "starts" from VSCode's perspective. We wait for THIS, not for
      // onDidStartDebugSession, because the URI isn't known at that point.
      vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
        void this.handleCustomEvent(e);
      }),
      // Terminate is straightforward — dispose the session if we have one.
      vscode.debug.onDidTerminateDebugSession((s) => this.handleTerminate(s)),
    );
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private async handleCustomEvent(
    e: vscode.DebugSessionCustomEvent,
  ): Promise<void> {
    if (e.event !== 'dart.debuggerUris') return;
    if (e.session.type !== 'dart') return;
    // Avoid double-starting if Dart-Code emits the event twice (e.g. across
    // hot restarts — unclear whether they re-emit, belt and suspenders).
    if (this.sessions.has(e.session.id)) return;

    // Version gate: hot reload service extensions live in xwidget >= 0.4.2.
    // Below that the Flutter app won't have ext.xwidget.updateFragment
    // registered, so calls would just error.
    const version = this.service.xwidgetVersion;
    if (!version || version.compareTo(HOT_RELOAD_SINCE_VERSION) < 0) {
      this.output.appendLine(
        `[hot-reload] xwidget ${version?.toString() ?? 'not detected'} does not ` +
          `support hot reload (requires >= ${HOT_RELOAD_SINCE_VERSION.toString()})`,
      );
      return;
    }

    // Need a workspace root to resolve fragmentsPath / valuesPath.
    const workspaceRoot = this.service.workspaceRoot;
    if (!workspaceRoot) {
      this.output.appendLine(
        '[hot-reload] no workspace root — skipping session',
      );
      return;
    }

    // clientVmServiceUri is preferred when available — it's the URI mapped
    // through vscode.env.asExternalUri for remote/container workflows. Fall
    // back to vmServiceUri which is the raw URI as seen inside the container.
    const body = e.body as
      | { vmServiceUri?: string; clientVmServiceUri?: string }
      | undefined;
    const vmServiceUri = body?.clientVmServiceUri ?? body?.vmServiceUri;
    if (!vmServiceUri) {
      this.output.appendLine(
        '[hot-reload] dart.debuggerUris event had no vmServiceUri — skipping',
      );
      return;
    }

    const config = this.service.config;
    if (!config) {
      this.output.appendLine('[hot-reload] no config — skipping session');
      return;
    }

    const session = new HotReloadSession(
      {
        sessionId: e.session.id,
        vmServiceUri,
        fragmentsAbsPath: path.resolve(workspaceRoot, config.fragmentsPath),
        valuesAbsPath: path.resolve(workspaceRoot, config.valuesPath),
      },
      this.status,
      this.output,
    );
    this.sessions.set(e.session.id, session);
    try {
      await session.start();
      this.output.appendLine(
        `[hot-reload] watching ${config.fragmentsPath} and ${config.valuesPath} ` +
          `for session ${e.session.id}`,
      );
    } catch (err) {
      this.output.appendLine(
        `[hot-reload] failed to start session ${e.session.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      session.dispose();
      this.sessions.delete(e.session.id);
    }
  }

  private handleTerminate(session: vscode.DebugSession): void {
    const hrs = this.sessions.get(session.id);
    if (!hrs) return;
    hrs.dispose();
    this.sessions.delete(session.id);
    // Hide the status bar if this was the only session. If others remain,
    // leave whatever they last displayed alone.
    if (this.sessions.size === 0) {
      this.status.hide();
    }
  }
}
