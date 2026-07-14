import { Version } from './version';

/**
 * Constants mirroring the IntelliJ plugin's Constants.kt. Keeping them in one
 * place makes it easy to adjust command strings and URLs without hunting
 * through the codebase.
 */

// XWidget XML namespace — gate for syntax highlighting, codelens, hover, go-to.
// Current namespace (xwidget.dev). The namespace moved here from the legacy
// appfluent.us URL; fragments in the wild still use either, so detection must
// accept both. XWIDGET_NAMESPACES is the full set to match against.
export const XWIDGET_NAMESPACE = 'https://xwidget.dev/fragments';
export const XWIDGET_NAMESPACE_LEGACY = 'http://www.appfluent.us/xwidget';
export const XWIDGET_NAMESPACES = [XWIDGET_NAMESPACE, XWIDGET_NAMESPACE_LEGACY];

// XWidget's config directory within the user's project (xwidget_builder >=
// 0.7.0). Config files and generated schemas live here; older projects keep
// them at the project root until the builder migrates them.
export const CONFIG_DIR = '.xwidget';

// Marker / resource files.
// Configuration file. Read on activation, watched for changes so config
// overrides take effect without reloading. NOT used for project detection —
// that's solely driven by xwidget_builder in pubspec.yaml dev_dependencies.
// Lives in CONFIG_DIR for builder >= 0.7.0 projects, at the project root
// before that — readXWidgetConfig checks both.
export const CONFIG_FILE = 'xwidget_config.yaml';
export const PUBSPEC_FILE = 'pubspec.yaml';
export const PUBSPEC_LOCK_FILE = 'pubspec.lock';
// Legacy (builder < 0.7.0) generated XSD at the project root. Referenced from
// .vscode/settings.json's xml.fileAssociations; its value doubles as the
// marker identifying our legacy entry there, so it must never change.
export const SCHEMA_FILE = 'xwidget_schema.g.xsd';
// Builder >= 0.7.0 artifacts, inside CONFIG_DIR. The catalog maps each
// XWidget namespace to its schema; registering it via xml.catalogs replaces
// the legacy fileAssociations mechanism. LemMinX resolves these
// workspace-relative paths against the workspace root, so they're written
// as-is into committed settings.
export const CATALOG_FILE = `${CONFIG_DIR}/schema_catalog.g.xml`;
export const FRAGMENTS_SCHEMA_FILE = `${CONFIG_DIR}/fragments_schema.g.xsd`;

// Dev-dependency name that signals an XWidget project even without the marker.
export const XWIDGET_BUILDER_DEP = 'xwidget_builder';

// Defaults for xwidget_config.yaml fragmentsPath / valuesPath.
export const DEFAULT_FRAGMENTS_PATH = 'resources/fragments';
export const DEFAULT_VALUES_PATH = 'resources/values';
export const DEFAULT_INFLATER_SOURCES = ['lib/xwidget/inflater_spec.dart'];
export const DEFAULT_ICON_SOURCES = ['lib/xwidget/icon_spec.dart'];

// Version gates.
export const LEGACY_LAST_VERSION = Version.parse('0.0.52');
export const HOT_RELOAD_SINCE_VERSION = Version.parse('0.4.2');

// Hot reload — per-file debounce window for file-change events before firing
// a VM service call. Same intent as the auto-gen watcher's debounce: absorb
// rapid successive saves (e.g. format-on-save followed by save) so we don't
// spam the running app. 200ms is short enough to feel instant, long enough
// to coalesce a typical burst.
export const HOT_RELOAD_DEBOUNCE_MS = 200;

// Dart VM service extension method names registered by xwidget >= 0.4.2.
// These accept `{fqn, content}` (fragments) or `{content}` (values) params
// and apply the update to the running Flutter app without a full hot reload.
export const EXT_UPDATE_FRAGMENT = 'ext.xwidget.updateFragment';
export const EXT_UPDATE_VALUES = 'ext.xwidget.updateValues';

// CLI commands — current (xwidget >= 0.1.0).
export const CMD_GENERATE_ALL = 'dart run xwidget_builder:generate';
export const CMD_GENERATE_INFLATERS = 'dart run xwidget_builder:generate --only inflaters';
export const CMD_GENERATE_ICONS = 'dart run xwidget_builder:generate --only icons';
export const CMD_GENERATE_CONTROLLERS = 'dart run xwidget_builder:generate --only controllers';
export const CMD_INIT_NEW_APP = 'dart run xwidget_builder:init --new-app';
export const CMD_INIT_EXISTING_APP = 'dart run xwidget_builder:init';
export const CMD_ADD_XWIDGET = 'flutter pub add xwidget';
export const CMD_ADD_XWIDGET_BUILDER = 'flutter pub add dev:xwidget_builder';

// CLI commands — legacy (xwidget <= 0.0.52).
export const LEGACY_CMD_GENERATE_ALL = 'dart run xwidget:generate';
export const LEGACY_CMD_GENERATE_INFLATERS = 'dart run xwidget:generate --only inflaters';
export const LEGACY_CMD_GENERATE_ICONS = 'dart run xwidget:generate --only icons';
export const LEGACY_CMD_GENERATE_CONTROLLERS = 'dart run xwidget:generate --only controllers';
export const LEGACY_CMD_INIT_NEW_APP = 'dart run xwidget:init --new-app';
export const LEGACY_CMD_INIT_EXISTING_APP = 'dart run xwidget:init';

// URLs.
export const URL_DOCUMENTATION = 'https://docs.xwidget.dev';
export const URL_ISSUES = 'https://github.com/appfluent/xwidget/issues';
// Deep links into the docs site for status-surface actions. Mirror the paths
// that users would land on from the docs sidebar.
export const URL_DOCS_UPGRADING = 'https://docs.xwidget.dev/getting_started/upgrading/';
export const URL_DOCS_QUICK_START = 'https://docs.xwidget.dev/getting_started/quick_start/';

// VSCode terminal tab name.
export const TERMINAL_NAME = 'XWidget';

// Marketplace ID of the Red Hat XML extension. We don't depend on it (it's a
// soft dependency) but we prompt the user to install it because XSD-driven
// completion is meaningfully better with it.
export const REDHAT_XML_EXTENSION_ID = 'redhat.vscode-xml';

// Marketplace ID of the Dart-Code extension. Used by the controller
// navigation feature, which calls Dart-Code's analysis-server-backed
// `vscode.executeWorkspaceSymbolProvider` to resolve `<Controller name="X"/>`
// references to Dart class definitions. Soft dependency — same prompt
// pattern as Red Hat XML.
export const DART_CODE_EXTENSION_ID = 'Dart-Code.dart-code';

// Workspace state key for per-workspace auto-generate toggle.
export const WORKSPACE_STATE_AUTO_GENERATE = 'flutter-xwidget.autoGenerate';

// Workspace state key tracking whether we've added our entry to
// .vscode/settings.json's xml.fileAssociations. Once true we never re-add,
// even if the user later removes our entry — respect their edit.
export const WORKSPACE_STATE_SCHEMA_REGISTERED = 'flutter-xwidget.schemaRegistered';

// Same contract as above but for the xml.catalogs entry (builder >= 0.7.0).
export const WORKSPACE_STATE_CATALOG_REGISTERED = 'flutter-xwidget.catalogRegistered';

// Workspace state key tracking whether the user clicked "Don't Ask Again"
// on the Red Hat XML install prompt for this workspace. Other dismissal
// paths (X button) do NOT set this flag, so the user gets re-prompted next
// reload — only an explicit opt-out silences the nag.
export const WORKSPACE_STATE_REDHAT_XML_PROMPT_DISMISSED = 'flutter-xwidget.redhatXmlPromptDismissed';

// Same as above but for the Dart-Code install prompt. Distinct flag so a
// user can opt out of one prompt without affecting the other.
export const WORKSPACE_STATE_DART_CODE_PROMPT_DISMISSED = 'flutter-xwidget.dartCodePromptDismissed';

// Context key used in menu `when` clauses.
export const CONTEXT_KEY_IS_PROJECT = 'flutter-xwidget.isProject';

/**
 * Returns true if the version of the user's xwidget package uses the legacy
 * `xwidget:*` CLI (rather than `xwidget_builder:*`). Matches the check in
 * the IntelliJ plugin's MenuActions.kt.
 */
export function isLegacyVersion(version: Version | undefined): boolean {
  if (version === undefined) return false;
  return version.compareTo(LEGACY_LAST_VERSION) <= 0;
}
