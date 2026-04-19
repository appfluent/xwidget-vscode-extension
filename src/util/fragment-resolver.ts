import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  FragmentReference,
  fragmentReferenceCandidates,
} from './fragment-reference-parser';

/**
 * Resolves a parsed fragment reference to zero or more file URIs, restricted
 * to the project's configured fragments directory.
 *
 * Algorithm:
 *   1. Build candidate relative paths from the reference (e.g. `profile.xml`
 *      and `profile/index.xml`).
 *   2. For each candidate, check whether `<workspaceRoot>/<fragmentsPath>/<candidate>`
 *      exists via `fs.access`.
 *   3. Return URIs for the ones that exist.
 *
 * Rooted search — uses `<workspaceRoot>/<fragmentsPath>/<candidate>` rather
 * than project-wide suffix matching. Motivation: project-wide search produces
 * false positives from test fixtures and archived copies, and the rooted
 * behavior matches what `xml.fileAssociations` is scoped to. The tradeoff is
 * that fragments stored outside `fragmentsPath` (e.g. in `test/`) no longer
 * resolve. That's considered acceptable for v0.1 and can be revisited if real
 * use cases emerge.
 *
 * Returns an empty array if no matches are found, if the workspace root or
 * fragmentsPath is unknown, or if the candidate paths resolve outside
 * `fragmentsPath` (defensive check against `../` escapes). Callers surface
 * not-found in their own way (silent for definition/codelens, status bar
 * on click, "Fragment not found" in hover).
 */
export async function resolveFragment(
  reference: FragmentReference,
  workspaceRoot: string | undefined,
  fragmentsPath: string | undefined,
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  if (!workspaceRoot || !fragmentsPath) return [];

  const candidates = fragmentReferenceCandidates(reference);
  const fragmentsAbsPath = path.resolve(workspaceRoot, fragmentsPath);

  const matches: vscode.Uri[] = [];
  for (const candidate of candidates) {
    if (token?.isCancellationRequested) break;

    // Defensive: reject candidates that escape fragmentsPath via `..` or
    // absolute paths. The XWidget runtime doesn't support these either, so
    // resolving them in the editor would be misleading.
    const candidateAbsPath = path.resolve(fragmentsAbsPath, candidate);
    if (!isInsidePath(candidateAbsPath, fragmentsAbsPath)) {
      continue;
    }

    try {
      await fs.access(candidateAbsPath);
      matches.push(vscode.Uri.file(candidateAbsPath));
    } catch {
      // File doesn't exist — try the next candidate.
    }
  }

  return matches;
}

/**
 * Returns true if `candidate` is inside `root` (or equal to it). Uses
 * `path.relative` which produces a leading `..` segment when the candidate
 * escapes the root. Platform-aware — works correctly on Windows.
 */
function isInsidePath(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
