import * as vscode from 'vscode';
import { XWidgetService } from './services/xwidget-service';
import { XWidgetTerminal } from './util/terminal';
import { registerFragmentDetection } from './util/fragment-detection';
import { registerGenerateCommands } from './commands/generate-commands';
import { registerMiscCommands } from './commands/misc-commands';
import { XWidgetTreeProvider } from './views/xwidget-tree';
import { registerStatusBar } from './views/status-bar';
import { AutoGenWatcher } from './watchers/auto-gen-watcher';
import { XWidgetDefinitionProvider } from './providers/definition-provider';
import {
  XWidgetCodeLensProvider,
  registerOpenReferenceCommand,
} from './providers/codelens-provider';
import { XWidgetHoverProvider } from './providers/hover-provider';
import { HotReloadManager } from './hotReload/hot-reload-manager';
import { registerShowOutputCommand } from './hotReload/hot-reload-status';
import { setXWidgetService } from './util/resolve-fragment-context';
import { buildStatusChecks } from './status/checks';

/**
 * Extension entry point. Keeps activation lean — heavy lifting lives in the
 * service and command modules.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('XWidget');
  context.subscriptions.push(output);
  output.appendLine('XWidget extension activating...');

  // Fragment-detection cache listeners need to be installed regardless of
  // whether the workspace is an XWidget project, since the user may open a
  // fragment file from outside the current workspace.
  registerFragmentDetection(context);

  const service = new XWidgetService(context, output);
  context.subscriptions.push(service);
  await service.activate();
  // Make service accessible to the fragment resolver wrapper. Providers can
  // then resolve fragment references using the current workspace's config
  // without each needing a direct handle to the service.
  setXWidgetService(service);

  const terminal = new XWidgetTerminal(context);
  context.subscriptions.push(terminal);

  registerGenerateCommands(context, service, terminal);
  registerMiscCommands(context, service, output);

  // Activity Bar tree view. Visibility is gated in package.json via the
  // `when: flutter-xwidget.isFlutterProject` clause on the view contribution
  // — non-Flutter workspaces don't see it at all.
  //
  // The tree shows a Status section with warnings/errors from
  // the registered checks, plus a numeric badge on the Activity Bar icon so
  // issues are discoverable even when the tree is collapsed.
  const statusChecks = buildStatusChecks(service, context);
  const treeProvider = new XWidgetTreeProvider(service, statusChecks);
  context.subscriptions.push(treeProvider);
  const treeView = vscode.window.createTreeView('flutter-xwidget.menu', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    treeProvider.onDidChangeBadge((count) => {
      treeView.badge =
        count > 0
          ? {
              value: count,
              tooltip: `${count} XWidget issue${count === 1 ? '' : 's'}`,
            }
          : undefined;
    }),
  );

  registerStatusBar(context, service);

  // Auto-generation file watchers — react to changes in spec source files
  // when the toggle is on. Listens for service.onDidChange to start/stop
  // watchers when the toggle, project state, or config paths change.
  const autoGen = new AutoGenWatcher(service, terminal, output);
  context.subscriptions.push(autoGen);

  // Navigation providers for <fragment> and <Controller> references.
  // All three providers gate internally on isXWidgetFragment(document), so
  // registering against `language: xml` is safe — non-XWidget XML files in
  // the workspace are unaffected.
  const xmlSelector: vscode.DocumentSelector = { language: 'xml' };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      xmlSelector,
      new XWidgetDefinitionProvider(),
    ),
  );
  const codeLensProvider = new XWidgetCodeLensProvider();
  context.subscriptions.push(
    codeLensProvider,
    vscode.languages.registerCodeLensProvider(xmlSelector, codeLensProvider),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      xmlSelector,
      new XWidgetHoverProvider(),
    ),
  );
  registerOpenReferenceCommand(context);

  // Hot reload via Dart VM service extensions. Gates internally on
  // session type (`dart`) and xwidget version (>= 0.4.2). No-op until a
  // Dart-Code debug session actually fires the `dart.debuggerUris` event.
  registerShowOutputCommand(context, output);
  const hotReloadManager = new HotReloadManager(service, output);
  context.subscriptions.push(hotReloadManager);

  output.appendLine(`XWidget project detected: ${service.isProject}`);
  output.appendLine('XWidget extension activated.');
}

export function deactivate(): void {
  // All disposables are registered with the extension context, so VSCode
  // handles cleanup automatically.
}
