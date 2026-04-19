import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  DART_CODE_EXTENSION_ID,
  HOT_RELOAD_SINCE_VERSION,
  REDHAT_XML_EXTENSION_ID,
  SCHEMA_FILE,
  URL_DOCS_QUICK_START,
  URL_DOCS_UPGRADING,
  WORKSPACE_STATE_SCHEMA_REGISTERED,
} from '../util/constants';
import { XWidgetService } from '../services/xwidget-service';
import { StatusCheck, StatusItem } from './status-check';

/**
 * Shape of an entry we write to `xml.fileAssociations`. Duplicated here
 * rather than imported from xml-schema-registration to avoid a cycle.
 */
interface XmlFileAssociation {
  pattern: string;
  systemId: string;
}

/**
 * Builds the status checks. Order of array is not meaningful — the tree
 * provider orders by severity via runStatusChecks.
 *
 * All checks early-out with `undefined` when the workspace isn't detected
 * as an XWidget project. The tree provider should already gate on
 * `service.isProject` before showing the Status section, but the checks
 * are defensive too.
 */
export function buildStatusChecks(
  service: XWidgetService,
  context: vscode.ExtensionContext,
): StatusCheck[] {
  return [
    () => checkSchemaFileGenerated(service),
    () => checkSchemaEntryRegistered(service, context),
    () => checkRedHatXmlInstalled(service),
    () => checkDartCodeInstalled(service),
    () => checkXwidgetInDependencies(service),
    () => checkXwidgetVersionForHotReload(service),
  ];
}

/**
 * Error: xwidget_schema.g.xsd hasn't been generated yet. Without it, Red Hat
 * XML has nothing to validate against and completion is useless even if the
 * extension is installed and the file association is registered.
 *
 * Click → run Generate All. First-time users stuck wondering why nothing
 * works end up here and get a single-click resolution.
 */
async function checkSchemaFileGenerated(
  service: XWidgetService,
): Promise<StatusItem | undefined> {
  if (!service.isProject || !service.workspaceRoot) return undefined;
  const schemaAbs = path.join(service.workspaceRoot, SCHEMA_FILE);
  try {
    await fs.access(schemaAbs);
    return undefined;
  } catch {
    return {
      id: 'schema-file:not-generated',
      severity: 'error',
      label: 'Schema not generated',
      tooltip:
        `${SCHEMA_FILE} doesn't exist yet. Until it's generated, XML completion and ` +
        'validation for fragments cannot work. Click to run code generation now.',
      command: {
        command: 'flutter-xwidget.generateAll',
        title: 'Generate All',
      },
    };
  }
}

/**
 * Warning: we previously registered our entry in xml.fileAssociations, but
 * it's no longer there. The user likely removed it by hand. This is a
 * legitimate choice (we never force re-add) — the tree view surfaces it
 * so users know the consequence when they later wonder why completion
 * stopped working.
 *
 * Click → `flutter-xwidget.restoreSchemaRegistration` which clears the
 * workspace-state flag and re-runs the registration flow.
 */
async function checkSchemaEntryRegistered(
  service: XWidgetService,
  context: vscode.ExtensionContext,
): Promise<StatusItem | undefined> {
  if (!service.isProject) return undefined;
  // Only a "problem" if we previously registered. A fresh project with no
  // entry yet is handled by `checkSchemaFileGenerated` (missing xsd) or by
  // registerXmlSchema automatically running once the xsd exists.
  if (
    !context.workspaceState.get<boolean>(WORKSPACE_STATE_SCHEMA_REGISTERED, false)
  ) {
    return undefined;
  }

  const config = vscode.workspace.getConfiguration('xml');
  const entries =
    config.inspect<XmlFileAssociation[]>('fileAssociations')?.workspaceValue ?? [];
  const ourEntry = entries.find(
    (entry) => entry && entry.systemId === SCHEMA_FILE,
  );
  if (ourEntry) return undefined;

  return {
    id: 'schema-registration:removed',
    severity: 'warning',
    label: 'Schema registration removed',
    tooltip:
      `Our entry for ${SCHEMA_FILE} is no longer in .vscode/settings.json's ` +
      'xml.fileAssociations. XML completion for fragments will not work until ' +
      'the entry is restored. Click to re-register the schema.',
    command: {
      command: 'flutter-xwidget.restoreSchemaRegistration',
      title: 'Restore schema registration',
    },
  };
}

/**
 * Warning: Red Hat XML isn't installed. Without it, the schema registration
 * does nothing — completion and validation are provided by that extension.
 *
 * Click → open the marketplace page. Mirror of what the install prompt
 * does, but always visible rather than transient.
 */
async function checkRedHatXmlInstalled(
  service: XWidgetService,
): Promise<StatusItem | undefined> {
  if (!service.isProject) return undefined;
  if (vscode.extensions.getExtension(REDHAT_XML_EXTENSION_ID)) return undefined;
  return {
    id: 'redhat-xml:not-installed',
    severity: 'warning',
    label: 'Red Hat XML extension missing',
    tooltip:
      'XML completion and hover documentation for fragments require the Red Hat ' +
      'XML extension. Click to open the marketplace page and install it.',
    command: {
      command: 'extension.open',
      title: 'Install Red Hat XML',
      arguments: [REDHAT_XML_EXTENSION_ID],
    },
  };
}

/**
 * Warning: Dart-Code isn't installed. Controller navigation (cmd-click to the
 * Dart class) and hot reload (VM service extensions) both require it.
 */
async function checkDartCodeInstalled(
  service: XWidgetService,
): Promise<StatusItem | undefined> {
  if (!service.isProject) return undefined;
  if (vscode.extensions.getExtension(DART_CODE_EXTENSION_ID)) return undefined;
  return {
    id: 'dart-code:not-installed',
    severity: 'warning',
    label: 'Dart extension missing',
    tooltip:
      'Controller navigation (Cmd-click on <Controller name="..."/>) and hot ' +
      'reload of fragments and values both require the Dart extension. Click ' +
      'to open the marketplace page and install it.',
    command: {
      command: 'extension.open',
      title: 'Install Dart',
      arguments: [DART_CODE_EXTENSION_ID],
    },
  };
}

/**
 * Warning: xwidget package version is below the hot-reload threshold. The
 * extension's hot-reload feature is registered but will remain inactive —
 * worth surfacing so the user knows what they're missing and can choose to
 * upgrade if they want it.
 *
 * If xwidget isn't in pubspec.lock at all (version undefined), we say nothing
 * — that's unusual enough to probably be a project in an in-between state
 * (fresh clone before pub get, etc.), and nagging about it would be noise.
 */
async function checkXwidgetVersionForHotReload(
  service: XWidgetService,
): Promise<StatusItem | undefined> {
  if (!service.isProject) return undefined;
  const version = service.xwidgetVersion;
  if (!version) return undefined;
  if (version.compareTo(HOT_RELOAD_SINCE_VERSION) >= 0) return undefined;
  return {
    id: 'xwidget-version:below-hot-reload',
    severity: 'warning',
    label: `xwidget ${version.toString()} — upgrade for hot reload`,
    tooltip:
      `Hot reload of fragments and values requires xwidget >= ${HOT_RELOAD_SINCE_VERSION.toString()}. ` +
      `Your project is on ${version.toString()}. Click to open the XWidget upgrade guide.`,
    command: {
      command: 'vscode.open',
      title: 'Open upgrade guide',
      arguments: [vscode.Uri.parse(URL_DOCS_UPGRADING)],
    },
  };
}

/**
 * Warning: `xwidget` is not in the project's runtime dependencies. Without
 * it, the XWidget runtime isn't present and fragments won't actually
 * render — regardless of what the extension provides in the editor.
 *
 * Detection: pubspec.lock doesn't list an xwidget package. The lock file
 * reflects the resolved dependency graph, so it's authoritative. If the
 * lockfile isn't readable yet (e.g. fresh clone before `pub get`), we skip
 * this check to avoid a false alarm.
 */
async function checkXwidgetInDependencies(
  service: XWidgetService,
): Promise<StatusItem | undefined> {
  if (!service.isProject) return undefined;
  // If there's no lockfile yet, we can't be sure — stay quiet rather than
  // nag a fresh clone that hasn't run `flutter pub get`.
  if (!service.pubspecLock) return undefined;
  if (service.xwidgetVersion !== undefined) return undefined;
  return {
    id: 'xwidget:not-in-dependencies',
    severity: 'warning',
    label: 'xwidget not in dependencies',
    tooltip:
      'The xwidget runtime package is not in your project dependencies. ' +
      'Fragments will not render at runtime until you add it. Click to open ' +
      'the XWidget quick-start guide for instructions.',
    command: {
      command: 'vscode.open',
      title: 'Open quick-start guide',
      arguments: [vscode.Uri.parse(URL_DOCS_QUICK_START)],
    },
  };
}
