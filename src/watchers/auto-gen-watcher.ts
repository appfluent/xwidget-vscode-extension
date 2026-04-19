import * as vscode from 'vscode';
import * as path from 'node:path';
import { XWidgetService } from '../services/xwidget-service';
import { XWidgetTerminal } from '../util/terminal';
import {
  buildGenerateIcons,
  buildGenerateInflaters,
} from '../commands/generate-commands';

/**
 * Auto-regeneration of inflaters and icons when their spec source files
 * change. Mirrors the IntelliJ plugin's XWidgetService.toggleAutoGenerate
 * behaviour but with the simpler "regenerate on any change" model — no
 * AST diffing. dart run xwidget_builder is idempotent, so an unnecessary
 * regen on a whitespace-only save is harmless.
 *
 * Controllers are NOT auto-watched, matching the IntelliJ plugin (which has
 * no controllers loop in toggleAutoGenerate). Users invoke Generate
 * Controllers manually.
 */
export class AutoGenWatcher implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;
  /** One disposable per absolute source path currently being watched. */
  private readonly watchers = new Map<string, vscode.Disposable>();
  /** Pending debounce timers per absolute source path. */
  private readonly debouncers = new Map<string, NodeJS.Timeout>();
  private readonly subscriptions: vscode.Disposable[] = [];

  /**
   * Coalesce window for save events. Some editors (and VSCode itself on
   * write-temp-then-rename saves) fire multiple file events for one user
   * action; debouncing lets them settle into a single regen.
   */
  private static readonly DEBOUNCE_MS = 200;

  constructor(
    private readonly service: XWidgetService,
    private readonly terminal: XWidgetTerminal,
    output: vscode.OutputChannel,
  ) {
    this.output = output;

    // React to anything that affects which files we should be watching:
    // toggle flips, config source-path changes, project state changes.
    this.subscriptions.push(service.onDidChange(() => this.sync()));

    // Initial setup — covers the case where the toggle was already ON when
    // the workspace was opened (workspace state persists across reloads).
    this.sync();
  }

  dispose(): void {
    this.stopAll();
    for (const sub of this.subscriptions) sub.dispose();
    this.subscriptions.length = 0;
  }

  /**
   * Brings the active watcher set into agreement with the current desired
   * state (toggle ON + project + config). Adds watchers for newly-relevant
   * paths, removes them for paths no longer relevant, leaves untouched
   * paths alone.
   */
  private sync(): void {
    const desired = this.computeDesiredWatches();

    // Stop watchers we no longer want.
    for (const path of [...this.watchers.keys()]) {
      if (!desired.has(path)) {
        this.stop(path);
      }
    }

    // Start watchers we now want.
    for (const [absPath, kind] of desired) {
      if (!this.watchers.has(absPath)) {
        this.start(absPath, kind);
      }
    }
  }

  /**
   * Returns the absolute source paths to watch and what each one regenerates,
   * given current toggle, project, and config state. Empty when auto-gen is
   * off, no project is detected, or config is unavailable.
   */
  private computeDesiredWatches(): Map<string, WatchKind> {
    const result = new Map<string, WatchKind>();
    if (!this.service.autoGenerateEnabled) return result;
    if (!this.service.isProject) return result;
    const root = this.service.workspaceRoot;
    const config = this.service.config;
    if (!root || !config) return result;

    for (const source of config.inflaters.sources) {
      result.set(absolutize(root, source), 'inflaters');
    }
    for (const source of config.icons.sources) {
      result.set(absolutize(root, source), 'icons');
    }
    return result;
  }

  private start(absPath: string, kind: WatchKind): void {
    // VSCode's createFileSystemWatcher accepts a RelativePattern that
    // resolves to absolute paths. We watch one specific file (not a glob)
    // so onDidChange fires exactly when the user saves that file.
    const root = this.service.workspaceRoot;
    if (!root) return; // shouldn't happen — sync() guards for this
    const relative = path.relative(root, absPath);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, relative),
    );
    watcher.onDidChange(() => this.scheduleRegen(absPath, kind));
    watcher.onDidCreate(() => this.scheduleRegen(absPath, kind));
    // No onDidDelete — regenerating after a delete would either fail (no
    // spec file to read) or generate empty output. Wait until the file
    // returns.

    this.watchers.set(absPath, watcher);
    this.output.appendLine(`[auto-gen] watching ${kind}: ${relative}`);
  }

  private stop(absPath: string): void {
    const watcher = this.watchers.get(absPath);
    if (watcher) {
      watcher.dispose();
      this.watchers.delete(absPath);
      this.output.appendLine(`[auto-gen] stopped watching: ${absPath}`);
    }
    const timer = this.debouncers.get(absPath);
    if (timer) {
      clearTimeout(timer);
      this.debouncers.delete(absPath);
    }
  }

  private stopAll(): void {
    for (const path of [...this.watchers.keys()]) this.stop(path);
  }

  /**
   * Coalesces rapid-fire file events for the same path into a single regen.
   * Each call resets the timer; the regen runs DEBOUNCE_MS after the last
   * event for this path.
   */
  private scheduleRegen(absPath: string, kind: WatchKind): void {
    const existing = this.debouncers.get(absPath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debouncers.delete(absPath);
      this.runRegen(absPath, kind);
    }, AutoGenWatcher.DEBOUNCE_MS);
    this.debouncers.set(absPath, timer);
  }

  private runRegen(absPath: string, kind: WatchKind): void {
    const root = this.service.workspaceRoot;
    const relative = root ? path.relative(root, absPath) : absPath;
    const version = this.service.xwidgetVersion;
    const cmd =
      kind === 'inflaters'
        ? buildGenerateInflaters(version)
        : buildGenerateIcons(version);
    this.output.appendLine(
      `[auto-gen] ${relative} changed → regenerating ${kind}`,
    );
    // Terminal.run always preserves editor focus — background-friendly.
    this.terminal.run(cmd);
  }
}

type WatchKind = 'inflaters' | 'icons';

/**
 * Resolves a path that may be relative to the workspace root into an
 * absolute path. Already-absolute paths are returned unchanged.
 */
function absolutize(root: string, source: string): string {
  return path.isAbsolute(source) ? source : path.join(root, source);
}
