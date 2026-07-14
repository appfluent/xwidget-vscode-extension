import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  CATALOG_FILE,
  CONFIG_FILE,
  PUBSPEC_FILE,
  PUBSPEC_LOCK_FILE,
  SCHEMA_FILE,
  WORKSPACE_STATE_AUTO_GENERATE,
  XWIDGET_BUILDER_DEP,
  DEFAULT_FRAGMENTS_PATH,
  DEFAULT_VALUES_PATH,
} from '../util/constants';
import { readXWidgetConfig, XWidgetConfig, XWidgetConfigError } from '../config/xwidget-config';
import { PubspecLock, readPubspecLock } from '../config/pubspec-lock';
import { registerXmlCatalog, registerXmlSchema, updateXmlSchemaPattern, promptForRedHatXmlIfNeeded } from '../config/xml-schema-registration';
import { promptForDartCodeIfNeeded } from './dart-code-prompt';
import { Version } from '../util/version';

/**
 * Central state and coordination for the XWidget extension. Mirrors the
 * IntelliJ plugin's XWidgetService.kt.
 *
 * Responsibilities:
 *  - Detect whether the workspace is an XWidget project.
 *  - Load and watch xwidget_config.yaml and pubspec.lock.
 *  - Expose versions, config, and the per-workspace auto-generate toggle.
 *  - Fire change events so UI listeners (status bar, tree view) can refresh.
 *  - Provide file watchers for spec sources so auto-generation actually
 *    triggers regeneration commands.
 */
export class XWidgetService implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;
  private readonly state: vscode.Memento;
  private readonly context: vscode.ExtensionContext;

  private _workspaceRoot: string | undefined;
  private _isProject = false;
  private _isFlutterProject = false;
  private _config: XWidgetConfig | undefined;
  private _pubspecLock: PubspecLock | undefined;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires when project status, config, or lockfile changes. UI listens. */
  readonly onDidChange = this._onDidChange.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
    this.output = output;
    this.state = context.workspaceState;
    this.context = context;
  }

  /**
   * One-time setup: initial detection + installing the file watchers for
   * xwidget_config.yaml, pubspec.yaml, and pubspec.lock.
   */
  async activate(): Promise<void> {
    await this.refresh();

    const configWatcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE}`);
    configWatcher.onDidCreate(() => this.refresh());
    configWatcher.onDidChange(() => this.refresh());
    configWatcher.onDidDelete(() => this.refresh());
    this.disposables.push(configWatcher);

    const pubspecWatcher = vscode.workspace.createFileSystemWatcher(`**/${PUBSPEC_FILE}`);
    pubspecWatcher.onDidCreate(() => this.refresh());
    pubspecWatcher.onDidChange(() => this.refresh());
    pubspecWatcher.onDidDelete(() => this.refresh());
    this.disposables.push(pubspecWatcher);

    const lockWatcher = vscode.workspace.createFileSystemWatcher(`**/${PUBSPEC_LOCK_FILE}`);
    lockWatcher.onDidCreate(() => this.refresh());
    lockWatcher.onDidChange(() => this.refresh());
    lockWatcher.onDidDelete(() => this.refresh());
    this.disposables.push(lockWatcher);

    // Watch for the generated XSD appearing — we use that as the trigger to
    // wire up Red Hat XML's file association. Only need create events; once
    // registered, our state flag prevents re-registration regardless of
    // subsequent regenerations or deletions.
    const schemaWatcher = vscode.workspace.createFileSystemWatcher(`**/${SCHEMA_FILE}`);
    schemaWatcher.onDidCreate(() => this.refresh());
    this.disposables.push(schemaWatcher);

    // Same trigger for the schema catalog (builder >= 0.7.0). Its creation —
    // first generate after an upgrade — is the moment the workspace switches
    // from the legacy fileAssociations flow to xml.catalogs. Deletion is the
    // reverse switch (builder downgrade), handled by the downgrade detection
    // in registerXmlCatalog.
    const catalogWatcher = vscode.workspace.createFileSystemWatcher(`**/${CATALOG_FILE}`);
    catalogWatcher.onDidCreate(() => this.refresh());
    catalogWatcher.onDidDelete(() => this.refresh());
    this.disposables.push(catalogWatcher);

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
    );
  }

  // --- accessors -----------------------------------------------------------

  get isProject(): boolean {
    return this._isProject;
  }

  get isFlutterProject(): boolean {
    return this._isFlutterProject;
  }

  get workspaceRoot(): string | undefined {
    return this._workspaceRoot;
  }

  get config(): XWidgetConfig | undefined {
    return this._config;
  }

  get pubspecLock(): PubspecLock | undefined {
    return this._pubspecLock;
  }

  get xwidgetVersion(): Version | undefined {
    return this._pubspecLock?.getPackageVersion('xwidget');
  }

  get xwidgetBuilderVersion(): Version | undefined {
    return this._pubspecLock?.getPackageVersion('xwidget_builder');
  }

  get autoGenerateEnabled(): boolean {
    return this.state.get<boolean>(WORKSPACE_STATE_AUTO_GENERATE, false);
  }

  async setAutoGenerateEnabled(enabled: boolean): Promise<void> {
    await this.state.update(WORKSPACE_STATE_AUTO_GENERATE, enabled);
    this.output.appendLine(`Auto-generate ${enabled ? 'enabled' : 'disabled'}.`);
    this._onDidChange.fire();
    // XWidgetWatcherService observes this event and starts/stops
    // spec-file watchers accordingly.
  }

  // --- internal ------------------------------------------------------------

  /**
   * Re-runs project detection and reloads config + lockfile. Fires
   * onDidChange when anything of interest has changed.
   */
  private async refresh(): Promise<void> {
    const previous = {
      isProject: this._isProject,
      isFlutterProject: this._isFlutterProject,
      configPaths: configPathsOf(this._config),
      fragmentsPath: this._config?.fragmentsPath,
      xwidgetVersion: this.xwidgetVersion?.toString(),
    };

    const detected = await this.detect();
    this._workspaceRoot = detected.root;
    this._isProject = detected.isXWidget;
    this._isFlutterProject = detected.isFlutter;

    if (this._workspaceRoot !== undefined) {
      try {
        this._config = await readXWidgetConfig(this._workspaceRoot);
      } catch (err) {
        this._config = undefined;
        const message = err instanceof XWidgetConfigError ? err.message : String(err);
        this.output.appendLine(`[config] ${message}`);
        vscode.window.showWarningMessage(`XWidget: ${message}`);
      }
      this._pubspecLock = await readPubspecLock(this._workspaceRoot);
      if (this._isProject && this._config) {
        this.logConfigSummary();
        // Wire up Red Hat XML completion via .vscode/settings.json. Idempotent
        // and silent unless it actually had work to do; safe to call on every
        // refresh. Catalog mode (builder >= 0.7.0, detected by the catalog
        // file existing) registers xml.catalogs and retires our legacy
        // fileAssociations entry; otherwise the legacy flow runs, with its
        // pattern scoped to the configured fragmentsPath.
        const catalogMode = await registerXmlCatalog(
          this._workspaceRoot,
          this.context,
          this.output,
        );
        if (!catalogMode) {
          await registerXmlSchema(
            this._workspaceRoot,
            this._config.fragmentsPath,
            this.context,
            this.output,
          );
          // Keep settings.json in sync with xwidget_config.yaml. If the user
          // changed fragmentsPath since last refresh, rewrite just the pattern
          // of our entry. No-op on the common case (unchanged) and when the
          // user has removed our entry. Catalog mode doesn't need this —
          // namespace resolution is location-independent.
          if (
            previous.fragmentsPath !== undefined &&
            previous.fragmentsPath !== this._config.fragmentsPath
          ) {
            await updateXmlSchemaPattern(
              this._config.fragmentsPath,
              this.context,
              this.output,
            );
          }
        }
        // Fire the install prompts only when this workspace newly became an
        // XWidget project — either on first activation (service starts with
        // _isProject = false and detection flips it to true) or when the
        // user adds xwidget_builder mid-session. Refreshes triggered by
        // saves of pubspec.yaml / pubspec.lock / xwidget_config.yaml do NOT
        // re-fire the prompts, so users aren't nagged on every save.
        //
        // Fire-and-forget: showInformationMessage's promise does NOT resolve
        // when the toast auto-dismisses to the notification bell — it only
        // resolves on explicit user interaction (button click or X). Awaiting
        // it would leave the rest of refresh() (and therefore the setContext
        // calls that light up the UI) hanging until the user dug the
        // notification out of the bell. Fire it off in parallel; activation
        // completes immediately regardless of whether the user engages with
        // the prompt.
        const becameProject = !previous.isProject;
        if (becameProject) {
          void promptForRedHatXmlIfNeeded(this.context);
          // Same fire-and-forget pattern for Dart-Code, used by the
          // controller navigation and hot reload features. Most Flutter devs
          // already have it installed so this is silent for them; for the
          // rest, same info-toast UX as the Red Hat XML prompt.
          void promptForDartCodeIfNeeded(this.context);
        }
      }
    } else {
      this._config = undefined;
      this._pubspecLock = undefined;
    }

    await vscode.commands.executeCommand(
      'setContext',
      'flutter-xwidget.isProject',
      this._isProject,
    );
    await vscode.commands.executeCommand(
      'setContext',
      'flutter-xwidget.isFlutterProject',
      this._isFlutterProject,
    );

    const changed =
      previous.isProject !== this._isProject ||
      previous.isFlutterProject !== this._isFlutterProject ||
      !arraysEqual(previous.configPaths, configPathsOf(this._config)) ||
      previous.xwidgetVersion !== this.xwidgetVersion?.toString();
    if (changed) {
      this._onDidChange.fire();
    }
  }

  /**
   * Walks workspace folders once and returns the first root that looks like
   * an XWidget project (preferred) or a Flutter project (fallback), along
   * with flags indicating which. "XWidget" means xwidget_builder is declared
   * under dev_dependencies in pubspec.yaml — xwidget_config.yaml is NOT a
   * signal on its own (it's just configuration; a stale one in a project
   * that has since removed xwidget_builder shouldn't keep us in XWidget
   * mode). "Flutter" means a pubspec.yaml with a top-level `flutter:` key
   * — just having pubspec.yaml isn't enough (would match non-Flutter Dart
   * packages).
   */
  private async detect(): Promise<DetectResult> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return { root: undefined, isXWidget: false, isFlutter: false };
    }

    let flutterRoot: string | undefined;

    for (const folder of folders) {
      const root = folder.uri.fsPath;

      const pubspecPath = path.join(root, PUBSPEC_FILE);
      if (!(await fileExists(pubspecPath))) continue;

      let content: string;
      try {
        content = await fs.readFile(pubspecPath, 'utf8');
      } catch (err) {
        this.output.appendLine(`[detect] error reading ${pubspecPath}: ${String(err)}`);
        continue;
      }

      if (hasDevDependency(content, XWIDGET_BUILDER_DEP)) {
        return { root, isXWidget: true, isFlutter: true };
      }

      // Remember the first Flutter root we find, but keep looking — a later
      // folder might be the XWidget one.
      if (flutterRoot === undefined && hasTopLevelKey(content, 'flutter')) {
        flutterRoot = root;
      }
    }

    if (flutterRoot !== undefined) {
      return { root: flutterRoot, isXWidget: false, isFlutter: true };
    }
    return { root: undefined, isXWidget: false, isFlutter: false };
  }

  /**
   * User-facing note when the config is using defaults. Surfaces the
   * "configuration hint" (#3 from the v0.1 discoverability plan): users who
   * check the Output panel learn about the config knobs without a popup.
   */
  private logConfigSummary(): void {
    if (!this._config) return;
    const usingDefaults =
      this._config.fragmentsPath === DEFAULT_FRAGMENTS_PATH &&
      this._config.valuesPath === DEFAULT_VALUES_PATH;
    this.output.appendLine(
      `Fragments path: ${this._config.fragmentsPath}  |  Values path: ${this._config.valuesPath}` +
        (usingDefaults
          ? '  (defaults — customise in xwidget_config.yaml to override)'
          : ''),
    );
    const v = this.xwidgetVersion;
    if (v) this.output.appendLine(`xwidget version: ${v.toString()}`);
    const bv = this.xwidgetBuilderVersion;
    if (bv) this.output.appendLine(`xwidget_builder version: ${bv.toString()}`);
  }

  dispose(): void {
    this._onDidChange.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

/**
 * Extracts the paths whose changes should trigger a UI refresh — used to
 * collapse notifications when the user edits unrelated fields of the config.
 */
function configPathsOf(config: XWidgetConfig | undefined): string[] {
  if (!config) return [];
  return [
    config.fragmentsPath,
    config.valuesPath,
    ...config.inflaters.sources,
    ...config.icons.sources,
    ...config.controllers.sources,
  ];
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minimal line-based check for a named entry under dev_dependencies. Matches
 * the detection logic previously inline in extension.ts.
 */
function hasDevDependency(pubspecContent: string, depName: string): boolean {
  const lines = pubspecContent.split(/\r?\n/);
  const topLevelKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*\s*:/;
  let inDevDeps = false;
  for (const line of lines) {
    if (topLevelKeyPattern.test(line)) {
      inDevDeps = line.trimStart().startsWith('dev_dependencies:');
      continue;
    }
    if (inDevDeps && line.trim().startsWith(`${depName}:`)) return true;
  }
  return false;
}

/**
 * Checks whether the pubspec content declares the given top-level key. Used
 * to distinguish Flutter projects (have a `flutter:` section) from plain
 * Dart packages (don't). Commented-out lines are ignored.
 */
function hasTopLevelKey(pubspecContent: string, key: string): boolean {
  const lines = pubspecContent.split(/\r?\n/);
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) continue;
    // Only top-level keys start at column 0.
    if (line.length === trimmed.length && pattern.test(line)) return true;
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Result of a single detection pass over the workspace folders. */
interface DetectResult {
  root: string | undefined;
  isXWidget: boolean;
  isFlutter: boolean;
}
