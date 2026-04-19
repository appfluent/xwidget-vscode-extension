import * as vscode from 'vscode';
import { isXWidgetFragment } from '../util/fragment-detection';
import { findReferenceAt } from '../util/reference-scanner';
import { parseFragmentReference } from '../util/fragment-reference-parser';
import { resolveFragmentFromContext } from '../util/resolve-fragment-context';
import { resolveController } from '../util/controller-resolver';

/**
 * Implements Cmd-click / Ctrl-click navigation from `<fragment name="..."/>`
 * and `<Controller name="..."/>` attribute values.
 *
 * The provider is gated on the document being an XWidget fragment (i.e. its
 * root declares the XWidget xmlns). Non-XWidget XML is unaffected.
 *
 * Multiple matches: VSCode's built-in "Multiple definitions" picker handles
 * this automatically when we return more than one Location — no extra UI
 * code needed.
 *
 * Not-found: the provider just returns an empty array. We surface a status
 * bar message from the same code path used by the codelens command, so the
 * user sees feedback without a modal popup. The status bar message is
 * triggered when the user actually clicks (not on hover), so we register a
 * separate command for that — see `flutter-xwidget.openReference` in the
 * codelens provider.
 */
export class XWidgetDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
    if (!isXWidgetFragment(document)) return undefined;

    const ref = findReferenceAt(document, position);
    if (!ref) return undefined;

    if (ref.kind === 'fragment') {
      const parsed = parseFragmentReference(ref.name);
      const uris = await resolveFragmentFromContext(parsed, token);
      if (token.isCancellationRequested) return undefined;
      // Locations point to the start of the file — VSCode opens it focused
      // at the top.
      return uris.map(
        (uri) => new vscode.Location(uri, new vscode.Position(0, 0)),
      );
    }

    // controller
    const locations = await resolveController(ref.name, token);
    if (token.isCancellationRequested) return undefined;
    return locations;
  }
}
