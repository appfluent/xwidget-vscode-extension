import * as vscode from 'vscode';

/**
 * A discovered reference to either a fragment or a controller in a document.
 * Returned by `scanReferences`, consumed by all three providers (definition,
 * codelens, hover).
 */
export interface ReferenceMatch {
  /** Which tag the reference is on. Drives resolution and presentation. */
  readonly kind: 'fragment' | 'controller';
  /** The unparsed attribute value, e.g. `profile/password?id=3` or `MyController`. */
  readonly name: string;
  /** Range of just the attribute value (inside the quotes). For Cmd-click targeting. */
  readonly valueRange: vscode.Range;
  /** Range of the entire opening tag. For CodeLens placement (above the line). */
  readonly tagRange: vscode.Range;
}

/**
 * Regex for `<fragment name="...">` and `<Controller name="...">` opening
 * tags. Crosses newlines because attributes are routinely written one per
 * line. The `[^>]*?` body cannot escape the opening tag (because we exclude
 * `>`), so we cannot accidentally match into other tags or content.
 *
 * The value capture uses alternation rather than a backreference so that an
 * attribute value can legally contain the OTHER quote character. For
 * example, `<fragment name="profile?id='3'"/>` is valid XML — the single
 * quotes inside don't terminate the double-quoted value. Using
 * `(["'])([^"']*)\3` would incorrectly fail to match this case because the
 * negation excludes both quote characters.
 *
 * Capture groups:
 *   1. Tag name: `fragment` or `Controller`
 *   2. Value when double-quoted (or undefined)
 *   3. Value when single-quoted (or undefined)
 *
 * The `g` flag is mandatory — we iterate all matches per document. The `s`
 * flag is not strictly required since `[^>]` already crosses lines, but
 * kept for clarity.
 */
const REFERENCE_PATTERN =
  /<(fragment|Controller)\b[^>]*?\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/gs;

/**
 * Scans the document for all fragment and controller references. Single
 * pass, O(N) over the document text. Cheap enough to call on every provider
 * invocation without caching.
 *
 * Caller is responsible for gating on `isXWidgetFragment(document)` first —
 * this scanner doesn't validate the namespace, it just finds matches that
 * fit the pattern.
 */
export function scanReferences(document: vscode.TextDocument): ReferenceMatch[] {
  const text = document.getText();
  const results: ReferenceMatch[] = [];

  // Reset lastIndex defensively — the regex object is module-scoped and the
  // `g` flag persists state between calls.
  REFERENCE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    // Group 2 = value when double-quoted, group 3 = value when single-quoted.
    // Exactly one will be defined per match.
    const value = match[2] ?? match[3] ?? '';
    const tagStart = match.index;
    // Value sits between the matching pair of quote characters. We compute
    // its offset from the end of the full match: the value occupies the
    // characters immediately before the closing quote, so its start is
    // `tagEnd - 1 - value.length` (where `-1` accounts for the closing quote).
    const tagEnd = tagStart + fullMatch.length;
    const valueEnd = tagEnd - 1; // closing quote is the last char of the match
    const valueStart = valueEnd - value.length;

    results.push({
      kind: tagName === 'fragment' ? 'fragment' : 'controller',
      name: value,
      valueRange: new vscode.Range(
        document.positionAt(valueStart),
        document.positionAt(valueEnd),
      ),
      tagRange: new vscode.Range(
        document.positionAt(tagStart),
        document.positionAt(tagEnd),
      ),
    });
  }

  return results;
}

/**
 * Finds the reference (if any) whose attribute-value range contains the
 * given position. Used by definition and hover providers to map a cursor
 * position to a navigation target.
 */
export function findReferenceAt(
  document: vscode.TextDocument,
  position: vscode.Position,
): ReferenceMatch | undefined {
  const refs = scanReferences(document);
  return refs.find((ref) => ref.valueRange.contains(position));
}
