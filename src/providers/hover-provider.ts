import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { isXWidgetFragment } from '../util/fragment-detection';
import { findReferenceAt } from '../util/reference-scanner';
import { parseFragmentReference } from '../util/fragment-reference-parser';
import { resolveFragmentFromContext } from '../util/resolve-fragment-context';
import { resolveController } from '../util/controller-resolver';

/**
 * Number of lines of the target file shown as a preview in the hover popup.
 * Enough to see the root element + a child or two for fragments, or the
 * class declaration + a method or two for controllers.
 */
const PREVIEW_LINES = 5;

/**
 * Hover provider for `<fragment name="..."/>` and `<Controller name="..."/>`.
 * Shows the resolved file path and a short preview, helping the user verify
 * what the navigation target is without actually navigating.
 *
 * On miss, shows a "not found" message instead of returning empty — the
 * tooltip is genuinely useful diagnostic info ("oh, I misspelled it").
 */
export class XWidgetHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (!isXWidgetFragment(document)) return undefined;

    const ref = findReferenceAt(document, position);
    if (!ref) return undefined;

    if (ref.kind === 'fragment') {
      const parsed = parseFragmentReference(ref.name);
      const uris = await resolveFragmentFromContext(parsed, token);
      if (token.isCancellationRequested) return undefined;
      return buildHover('Fragment', ref.name, uris, ref.valueRange, 'xml');
    }

    // controller
    const locations = await resolveController(ref.name, token);
    if (token.isCancellationRequested) return undefined;
    const uris = locations.map((loc) => loc.uri);
    return buildHover('Controller', ref.name, uris, ref.valueRange, 'dart');
  }
}

/**
 * Builds the markdown hover content. Shared between fragment and controller
 * hovers — the only differences are the kind label and the preview language
 * for syntax-highlighted code blocks.
 */
async function buildHover(
  kindLabel: string,
  name: string,
  uris: vscode.Uri[],
  range: vscode.Range,
  previewLanguage: string,
): Promise<vscode.Hover | undefined> {
  if (uris.length === 0) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${kindLabel} not found**: \`${escapeMarkdown(name)}\``);
    return new vscode.Hover(md, range);
  }

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  if (uris.length === 1) {
    const uri = uris[0];
    md.appendMarkdown(
      `**${kindLabel}**: \`${escapeMarkdown(name)}\`\n\n` +
        `${vscode.workspace.asRelativePath(uri)}\n\n`,
    );
    const preview = await loadPreview(uri);
    if (preview !== undefined) {
      md.appendCodeblock(preview, previewLanguage);
    }
  } else {
    // Multiple matches — just list them, no preview. A preview would have
    // to pick one of the matches arbitrarily, which is misleading.
    md.appendMarkdown(
      `**${kindLabel}**: \`${escapeMarkdown(name)}\` *(${uris.length} matches)*\n\n`,
    );
    for (const uri of uris) {
      md.appendMarkdown(`- ${vscode.workspace.asRelativePath(uri)}\n`);
    }
  }

  return new vscode.Hover(md, range);
}

/**
 * Loads up to PREVIEW_LINES of the target file. Returns undefined if the
 * file can't be read — hover then just shows the path without a preview,
 * which is still useful.
 */
async function loadPreview(uri: vscode.Uri): Promise<string | undefined> {
  try {
    // Only handle file: scheme — we resolve to local files only.
    if (uri.scheme !== 'file') return undefined;
    const content = await fs.readFile(uri.fsPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const truncated = lines.length > PREVIEW_LINES;
    const preview = lines.slice(0, PREVIEW_LINES).join('\n');
    return truncated ? `${preview}\n…` : preview;
  } catch {
    return undefined;
  }
}

/**
 * Escapes the small set of markdown characters that could otherwise be
 * interpreted in inline code spans. Backticks are the dangerous one — a
 * fragment name containing a backtick would break the code span.
 */
function escapeMarkdown(s: string): string {
  return s.replace(/`/g, '\\`');
}
