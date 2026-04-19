import * as vscode from 'vscode';

/**
 * Severity of a status item. Determines ordering in the tree (errors first)
 * and icon color.
 *
 *  - `error`   — something is actively broken (e.g. schema file missing)
 *  - `warning` — something important is missing that degrades functionality
 *                (e.g. Red Hat XML not installed → no completion)
 *  - `info`    — helpful state worth knowing but not a problem (e.g. custom
 *                fragmentsPath different from default)
 *
 * Pass 4.6 only emits warnings; the severity levels are defined up front so
 * future checks can distinguish.
 */
export type StatusSeverity = 'error' | 'warning' | 'info';

/**
 * Rendered status item that appears as a row in the tree's Status section.
 * Produced by a StatusCheck and consumed by the tree provider.
 */
export interface StatusItem {
  /**
   * Stable id used for sort stability when multiple checks produce items of
   * the same severity. Format is `check-name:variant` where variant describes
   * the specific condition (e.g. `redhat-xml:not-installed`).
   */
  readonly id: string;
  readonly severity: StatusSeverity;
  /** Short label shown inline in the tree. One line, no newlines. */
  readonly label: string;
  /** Longer tooltip shown on hover. May include multiple lines. */
  readonly tooltip: string;
  /**
   * Command to run when the user clicks the item. Typically opens a
   * marketplace page, runs an extension command, or opens docs.
   */
  readonly command: {
    readonly command: string;
    readonly title: string;
    readonly arguments?: readonly unknown[];
  };
}

/**
 * A predicate that examines current state and either produces a status item
 * (if there's something to surface) or returns undefined (everything fine).
 *
 * Kept as an async function rather than a class: most checks are quick
 * synchronous lookups, but a couple need to hit the filesystem (schema file
 * existence), so async is the lowest-common-denominator signature.
 */
export type StatusCheck = () => Promise<StatusItem | undefined>;

/**
 * Runs all provided checks in parallel and returns the produced items in
 * severity order (error → warning → info), with stable ordering within the
 * same severity. Falsy check results are filtered out.
 */
export async function runStatusChecks(
  checks: readonly StatusCheck[],
): Promise<StatusItem[]> {
  const settled = await Promise.all(
    checks.map(async (check) => {
      try {
        return await check();
      } catch {
        // A failing check shouldn't break the whole tree. Swallow and move on.
        return undefined;
      }
    }),
  );
  const items = settled.filter((item): item is StatusItem => item !== undefined);
  return sortBySeverity(items);
}

function sortBySeverity(items: StatusItem[]): StatusItem[] {
  const severityRank: Record<StatusSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  return items.slice().sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Counts errors + warnings among a list of items. Used by the tree provider
 * to set the Activity Bar badge so users notice problems even when the tree
 * is collapsed or hidden.
 */
export function countProblems(items: readonly StatusItem[]): number {
  return items.filter(
    (item) => item.severity === 'error' || item.severity === 'warning',
  ).length;
}

/**
 * Maps a severity to a VSCode ThemeIcon. Colors come from the workbench theme
 * rather than being hard-coded.
 */
export function themeIconFor(severity: StatusSeverity): vscode.ThemeIcon {
  switch (severity) {
    case 'error':
      return new vscode.ThemeIcon(
        'error',
        new vscode.ThemeColor('problemsErrorIcon.foreground'),
      );
    case 'warning':
      return new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('problemsWarningIcon.foreground'),
      );
    case 'info':
      return new vscode.ThemeIcon(
        'info',
        new vscode.ThemeColor('problemsInfoIcon.foreground'),
      );
  }
}
