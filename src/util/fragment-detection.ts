import * as vscode from 'vscode';
import { XWIDGET_NAMESPACE } from './constants';

/**
 * Returns true if the document is an XWidget fragment — XML containing the
 * xmlns declaration `http://www.appfluent.us/xwidget`.
 *
 * Results are cached per URI to avoid re-scanning on every hover, codelens
 * refresh, etc. The cache is invalidated when a document changes or closes.
 * Callers should treat this as a cheap (near-constant-time) check after the
 * first call for a given document.
 *
 * Only the first ~2KB of the document is scanned; the xmlns always appears on
 * the root element so scanning further is wasteful.
 */
const cache = new Map<string, boolean>();
const SCAN_LIMIT = 2048;
const NAMESPACE_PATTERN = new RegExp(
  `xmlns\\s*=\\s*["']${escapeRegExp(XWIDGET_NAMESPACE)}["']`,
);

export function isXWidgetFragment(document: vscode.TextDocument): boolean {
  if (document.languageId !== 'xml') return false;

  const key = document.uri.toString();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const head = document.getText(
    new vscode.Range(
      document.positionAt(0),
      document.positionAt(Math.min(SCAN_LIMIT, document.getText().length)),
    ),
  );
  const result = NAMESPACE_PATTERN.test(head);
  cache.set(key, result);
  return result;
}

/**
 * Wires cache invalidation to the VSCode document lifecycle. Called once at
 * activation.
 */
export function registerFragmentDetection(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      cache.delete(e.document.uri.toString());
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      cache.delete(doc.uri.toString());
    }),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
