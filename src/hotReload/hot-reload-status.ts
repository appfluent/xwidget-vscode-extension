import * as vscode from 'vscode';

/**
 * Status bar item for visual feedback during hot reload operations.
 *
 * Design:
 *  - Hidden entirely when no reload is in progress or recent.
 *  - During a call: `$(sync~spin) XWidget: reloading...`. Stays until the
 *    call completes, errors, or another call supersedes it.
 *  - On success: `$(check) XWidget: reloaded <file>`. Auto-clears after 3s.
 *  - On error: `$(error) XWidget: reload failed`. Stays until cleared; clicking
 *    opens the XWidget output channel. Auto-clears after 10s as a fallback
 *    in case the user doesn't engage.
 *
 * Multiple concurrent debug sessions share one status bar — it shows the
 * most recent activity across all of them. Matches the "parity with IntelliJ,
 * most recent wins" decision.
 */
export class HotReloadStatus implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private clearTimer: NodeJS.Timeout | undefined;

  constructor(private readonly output: vscode.OutputChannel) {
    // Priority 50 puts us left of the auto-generate toggle (priority 100)
    // so both can coexist without visual clash when both are active.
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    // Clicking the status bar opens the output channel — useful when the
    // user sees "reload failed" and wants to see what went wrong.
    this.item.command = 'flutter-xwidget.showOutput';
    this.item.hide();
  }

  showReloading(fileLabel: string): void {
    this.clearPendingAutoClear();
    this.item.text = `$(sync~spin) XWidget: reloading ${fileLabel}`;
    this.item.tooltip = `Hot reloading ${fileLabel} via Dart VM service`;
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  showSuccess(fileLabel: string): void {
    this.clearPendingAutoClear();
    this.item.text = `$(check) XWidget: reloaded ${fileLabel}`;
    this.item.tooltip = `Last hot reload succeeded: ${fileLabel}`;
    this.item.backgroundColor = undefined;
    this.item.show();
    this.clearTimer = setTimeout(() => this.hide(), 3000);
  }

  showError(fileLabel: string, message: string): void {
    this.clearPendingAutoClear();
    this.item.text = `$(error) XWidget: reload failed`;
    this.item.tooltip = `${fileLabel}: ${message}\n\nClick to open Output panel for details.`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.show();
    // Log the full error to output so clicking the status bar reveals it.
    this.output.appendLine(`[hot-reload] FAIL ${fileLabel}: ${message}`);
    // Auto-clear after 10s so stale errors don't linger forever.
    this.clearTimer = setTimeout(() => this.hide(), 10000);
  }

  hide(): void {
    this.clearPendingAutoClear();
    this.item.hide();
  }

  dispose(): void {
    this.clearPendingAutoClear();
    this.item.dispose();
  }

  private clearPendingAutoClear(): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = undefined;
    }
  }
}

/**
 * Registers the command used as the status bar item's click handler.
 * Exported separately so extension.ts owns the registration lifecycle.
 */
export function registerShowOutputCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('flutter-xwidget.showOutput', () => {
      output.show(true);
    }),
  );
}
