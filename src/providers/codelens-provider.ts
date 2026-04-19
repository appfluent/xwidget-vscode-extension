import * as vscode from 'vscode';
import { isXWidgetFragment } from '../util/fragment-detection';
import { ReferenceMatch, scanReferences } from '../util/reference-scanner';
import { parseFragmentReference } from '../util/fragment-reference-parser';
import { resolveFragmentFromContext } from '../util/resolve-fragment-context';
import { resolveController } from '../util/controller-resolver';

/**
 * Command id for the click-handler invoked by both CodeLens entries and any
 * other UI that wants to navigate to a reference and report not-found via
 * the status bar.
 */
const OPEN_REFERENCE_COMMAND = 'flutter-xwidget.openReference';

/**
 * Adds clickable "↗ Open <target>" lenses above each `<fragment>` and
 * `<Controller>` opening tag in XWidget fragment files. Click handling
 * routes through the `flutter-xwidget.openReference` command, which
 * resolves the reference and either opens the target or shows a status bar
 * message saying it wasn't found.
 *
 * Refresh strategy: VSCode caches CodeLenses until either
 *   (a) the document changes, or
 *   (b) we fire `_onDidChangeCodeLenses`.
 *
 * (a) handles the common case of editing a fragment file. (b) is wired to
 * fire when files in the workspace are created/deleted, so adding a new
 * fragment file makes any "↗ Open <name>" lens that previously resolved
 * to nothing start working without requiring an editor reload.
 */
export class XWidgetCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Refresh CodeLenses when XML or Dart files appear/disappear in the
    // workspace — those are the file types that fragment / controller
    // references can resolve to. Avoid watching everything so we don't
    // refresh on unrelated churn.
    const xmlWatcher = vscode.workspace.createFileSystemWatcher('**/*.xml');
    xmlWatcher.onDidCreate(() => this._onDidChangeCodeLenses.fire());
    xmlWatcher.onDidDelete(() => this._onDidChangeCodeLenses.fire());
    this.disposables.push(xmlWatcher);

    const dartWatcher = vscode.workspace.createFileSystemWatcher('**/*.dart');
    dartWatcher.onDidCreate(() => this._onDidChangeCodeLenses.fire());
    dartWatcher.onDidDelete(() => this._onDidChangeCodeLenses.fire());
    this.disposables.push(dartWatcher);
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (!isXWidgetFragment(document)) return [];

    const refs = scanReferences(document);
    return refs.map((ref) => {
      const title =
        ref.kind === 'fragment'
          ? `$(arrow-up-right) Open ${shortenForLensTitle(ref.name)}`
          : `$(arrow-up-right) Open ${ref.name}`;
      return new vscode.CodeLens(ref.tagRange, {
        title,
        command: OPEN_REFERENCE_COMMAND,
        // Pass the URI string and value range so the click handler can
        // re-derive the reference without rescanning the document. Cheaper
        // and avoids races with the document changing between the lens
        // being computed and the click happening.
        arguments: [
          document.uri.toString(),
          ref.kind,
          ref.name,
          {
            startLine: ref.valueRange.start.line,
            startCharacter: ref.valueRange.start.character,
            endLine: ref.valueRange.end.line,
            endCharacter: ref.valueRange.end.character,
          },
        ],
      });
    });
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/**
 * Click handler for the CodeLens entries. Resolves the reference and either
 * opens the target file or shows a status bar message on miss. The same
 * command can be invoked from anywhere — keybindings, command palette,
 * other UI — so it's exported for registration in extension.ts.
 */
export function registerOpenReferenceCommand(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      OPEN_REFERENCE_COMMAND,
      async (
        _uri: string,
        kind: ReferenceMatch['kind'],
        name: string,
      ): Promise<void> => {
        if (kind === 'fragment') {
          const parsed = parseFragmentReference(name);
          const uris = await resolveFragmentFromContext(parsed);
          if (uris.length === 0) {
            showNotFound('Fragment', name);
            return;
          }
          if (uris.length === 1) {
            await vscode.window.showTextDocument(uris[0]);
            return;
          }
          // Multiple matches — let the user pick.
          await pickAndOpen(uris);
          return;
        }
        // controller
        const locations = await resolveController(name);
        if (locations.length === 0) {
          showNotFound('Controller', name);
          return;
        }
        if (locations.length === 1) {
          const loc = locations[0];
          await vscode.window.showTextDocument(loc.uri, { selection: loc.range });
          return;
        }
        await pickAndOpenLocations(locations);
      },
    ),
  );
}

/**
 * Auto-hiding status bar message on missing references. 5 seconds is short
 * enough not to clutter the status bar but long enough that the user notices
 * it after their click.
 */
function showNotFound(kindLabel: string, name: string): void {
  vscode.window.setStatusBarMessage(
    `$(warning) ${kindLabel} not found: ${name}`,
    5000,
  );
}

/**
 * QuickPick for choosing among multiple file URI matches. Returns to the
 * caller after the user picks (or escapes). Mirrors what VSCode's built-in
 * "Multiple definitions" picker does when DefinitionProvider returns
 * multiple results — but the codelens click path doesn't go through the
 * definition provider, so we present the picker ourselves here.
 */
async function pickAndOpen(uris: vscode.Uri[]): Promise<void> {
  const items = uris.map((uri) => ({
    label: vscode.workspace.asRelativePath(uri),
    uri,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Multiple matches — pick one to open',
  });
  if (picked) await vscode.window.showTextDocument(picked.uri);
}

/**
 * QuickPick for multiple Location matches (controllers). Includes the line
 * number in the label so users can distinguish symbols defined in the same
 * file (rare but possible).
 */
async function pickAndOpenLocations(locations: vscode.Location[]): Promise<void> {
  const items = locations.map((loc) => ({
    label: vscode.workspace.asRelativePath(loc.uri),
    description: `line ${loc.range.start.line + 1}`,
    location: loc,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Multiple matches — pick one to open',
  });
  if (picked) {
    await vscode.window.showTextDocument(picked.location.uri, {
      selection: picked.location.range,
    });
  }
}

/**
 * Trims very long fragment names (e.g. with lots of URL params) so the
 * CodeLens title doesn't sprawl across the editor. Controllers don't need
 * this — class names are always short.
 */
function shortenForLensTitle(name: string): string {
  // Drop URL params for the title; navigation still respects them.
  const queryIndex = name.indexOf('?');
  return queryIndex === -1 ? name : name.substring(0, queryIndex);
}
