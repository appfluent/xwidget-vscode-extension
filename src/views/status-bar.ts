import * as vscode from 'vscode';
import { XWidgetService } from '../services/xwidget-service';

/**
 * Status bar indicator for the auto-generate toggle. Visible only when the
 * workspace is an XWidget project. Clicking toggles state via the same
 * command backing the tree view and command palette.
 */
export function registerStatusBar(
  context: vscode.ExtensionContext,
  service: XWidgetService,
): void {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = 'flutter-xwidget.toggleAutoGenerate';
  context.subscriptions.push(item);

  const refresh = (): void => {
    if (!service.isProject) {
      item.hide();
      return;
    }
    const enabled = service.autoGenerateEnabled;
    item.text = enabled
      ? '$(zap) XWidget: Auto-Gen ON'
      : '$(circle-slash) XWidget: Auto-Gen OFF';
    item.tooltip = enabled
      ? 'Auto-generate is on — click to disable'
      : 'Auto-generate is off — click to enable';
    item.show();
  };

  refresh();
  context.subscriptions.push(service.onDidChange(refresh));
}
