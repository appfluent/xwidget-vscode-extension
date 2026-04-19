import * as vscode from 'vscode';
import { XWidgetService } from '../services/xwidget-service';
import {
  StatusCheck,
  StatusItem,
  countProblems,
  runStatusChecks,
  themeIconFor,
} from '../status/status-check';

/**
 * Single node in the XWidget Activity Bar tree. Either a clickable action
 * (runs a command) or a section header (visually groups related actions,
 * substitutes for menu separators which VSCode trees don't support).
 *
 * The `status-item` kind is new in Pass 4.6 — it's the same shape as `action`
 * but carries severity styling (icon + theme color).
 */
class TreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly kind: 'action' | 'header' | 'toggle' | 'status-item',
    options: {
      commandId?: string;
      commandArgs?: readonly unknown[];
      iconId?: string;
      iconPath?: vscode.ThemeIcon;
      tooltip?: string;
      description?: string;
      contextValue?: string;
    } = {},
  ) {
    super(
      label,
      kind === 'header'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.tooltip = options.tooltip;
    this.description = options.description;
    this.contextValue = options.contextValue;
    if (options.iconPath) {
      this.iconPath = options.iconPath;
    } else if (options.iconId) {
      this.iconPath = new vscode.ThemeIcon(options.iconId);
    }
    if (options.commandId) {
      this.command = {
        command: options.commandId,
        title: label,
        arguments: options.commandArgs ? [...options.commandArgs] : undefined,
      };
    }
  }
}

/**
 * Tree view data provider for the XWidget Activity Bar view. Renders three
 * sections when the workspace is an XWidget project:
 *
 *   - Status (Pass 4.6, only shown when there are items to surface)
 *   - Generate (same as Pass 2a)
 *   - Help (same as Pass 2a)
 *
 * In non-XWidget workspaces getChildren returns an empty array so VSCode
 * falls back to the viewsWelcome content defined in package.json.
 *
 * Status items are produced by the checks registered in `src/status/checks.ts`.
 * Results are cached between refreshes and invalidated when the service fires
 * onDidChange (project detection, config, version, etc.) or when the relevant
 * external state changes (Red Hat XML / Dart-Code installed, schema file
 * generated, xml.fileAssociations edited).
 */
export class XWidgetTreeProvider
  implements vscode.TreeDataProvider<TreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _onDidChangeBadge = new vscode.EventEmitter<number>();
  /** Fires whenever the badge count may have changed. Consumed by activation. */
  readonly onDidChangeBadge = this._onDidChangeBadge.event;

  private readonly disposables: vscode.Disposable[] = [];
  private statusItems: StatusItem[] = [];

  constructor(
    private readonly service: XWidgetService,
    private readonly checks: readonly StatusCheck[],
  ) {
    // Refresh when project state changes (service fires this on detection,
    // config reload, version change, etc.).
    this.disposables.push(service.onDidChange(() => void this.refresh()));

    // Refresh when extensions are installed / uninstalled — this is how the
    // Red Hat XML and Dart-Code checks notice.
    this.disposables.push(
      vscode.extensions.onDidChange(() => void this.refresh()),
    );

    // Refresh when xml.fileAssociations is edited by the user (or by us). The
    // schema-registration check reads this directly.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xml.fileAssociations')) {
          void this.refresh();
        }
      }),
    );

    // Initial population. Swallow the returned promise — constructor can't
    // await, and any errors are logged by runStatusChecks.
    void this.refresh();
  }

  /** Re-run all status checks and fire a tree refresh + badge event. */
  async refresh(): Promise<void> {
    if (this.service.isProject) {
      this.statusItems = await runStatusChecks(this.checks);
    } else {
      this.statusItems = [];
    }
    this._onDidChangeTreeData.fire(undefined);
    this._onDidChangeBadge.fire(countProblems(this.statusItems));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this._onDidChangeTreeData.dispose();
    this._onDidChangeBadge.dispose();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (element === undefined) {
      if (!this.service.isProject) return [];
      const roots: TreeItem[] = [];
      // Status header only when there's something to show. Keeps the tree
      // clean in the all-green case.
      if (this.statusItems.length > 0) {
        roots.push(
          new TreeItem('Status', 'header', {
            description: describeCounts(this.statusItems),
          }),
        );
      }
      roots.push(new TreeItem('Generate', 'header'));
      roots.push(new TreeItem('Help', 'header'));
      return roots;
    }

    switch (element.label) {
      case 'Status':
        return this.statusItems.map(
          (item) =>
            new TreeItem(item.label, 'status-item', {
              iconPath: themeIconFor(item.severity),
              tooltip: item.tooltip,
              commandId: item.command.command,
              commandArgs: item.command.arguments,
              contextValue: `xwidget.status.${item.severity}`,
            }),
        );

      case 'Generate': {
        const enabled = this.service.autoGenerateEnabled;
        return [
          new TreeItem('Generate All', 'action', {
            commandId: 'flutter-xwidget.generateAll',
            iconId: 'run-all',
            tooltip: 'Regenerate inflaters, icons, and controllers',
          }),
          new TreeItem('Generate Inflaters', 'action', {
            commandId: 'flutter-xwidget.generateInflaters',
            iconId: 'symbol-class',
          }),
          new TreeItem('Generate Icons', 'action', {
            commandId: 'flutter-xwidget.generateIcons',
            iconId: 'symbol-misc',
          }),
          new TreeItem('Generate Controllers', 'action', {
            commandId: 'flutter-xwidget.generateControllers',
            iconId: 'symbol-interface',
          }),
          new TreeItem(
            enabled ? 'Auto-Generate: ON' : 'Auto-Generate: OFF',
            'toggle',
            {
              commandId: 'flutter-xwidget.toggleAutoGenerate',
              iconId: enabled ? 'check' : 'circle-slash',
              tooltip:
                'Automatically regenerate inflaters and icons when spec files change',
            },
          ),
        ];
      }

      case 'Help':
        return [
          new TreeItem('Documentation', 'action', {
            commandId: 'flutter-xwidget.openDocs',
            iconId: 'book',
          }),
          new TreeItem('View Issues', 'action', {
            commandId: 'flutter-xwidget.openIssues',
            iconId: 'bug',
          }),
        ];

      default:
        return [];
    }
  }
}

/**
 * Builds the short "n issues" description string displayed next to the
 * Status header. Returns plural or singular appropriately.
 */
function describeCounts(items: readonly StatusItem[]): string {
  const errors = items.filter((i) => i.severity === 'error').length;
  const warnings = items.filter((i) => i.severity === 'warning').length;
  const infos = items.filter((i) => i.severity === 'info').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0)
    parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (infos > 0) parts.push(`${infos} info`);
  return parts.join(', ');
}
