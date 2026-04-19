import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  REDHAT_XML_EXTENSION_ID,
  SCHEMA_FILE,
  WORKSPACE_STATE_REDHAT_XML_PROMPT_DISMISSED,
  WORKSPACE_STATE_SCHEMA_REGISTERED,
} from '../util/constants';
import { promptForExtensionIfNeeded } from '../util/extension-prompts';

/**
 * Shape of an entry in `xml.fileAssociations`, as consumed by the Red Hat XML
 * extension (redhat.vscode-xml). The extension also accepts a few other fields
 * but we only ever write these two.
 */
interface XmlFileAssociation {
  pattern: string;
  systemId: string;
}

/**
 * Builds the glob pattern that we write into `xml.fileAssociations`.
 * Scoped to the user's configured `fragmentsPath` (default: `resources/fragments`)
 * so Red Hat XML only parses files in that tree. Pass 3a.5 used a broad
 * `**\/*.xml` pattern and relied on the schema's `targetNamespace` to filter
 * at validation time, but that loaded the LSP with parsing every XML file
 * in the workspace. Pass 4.5 narrows to `fragmentsPath` to avoid that cost
 * and to make the scope intelligible at a glance.
 *
 * The pattern uses forward slashes regardless of OS — Red Hat XML's
 * minimatch engine requires that.
 */
function buildPattern(fragmentsPath: string): string {
  // Normalize any backslashes the user may have typed on Windows, and strip
  // trailing slashes for consistency. Leading `./` is tolerated but removed.
  const normalized = fragmentsPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  return `${normalized}/**/*.xml`;
}

/**
 * Idempotently registers `xwidget_schema.g.xsd` with the Red Hat XML extension
 * by adding an entry to `xml.fileAssociations` in `.vscode/settings.json`.
 *
 * Called from `XWidgetService.refresh()` when the workspace is detected as an
 * XWidget project. Mirrors the IntelliJ-side experience where the user
 * registers the schema once in IDE settings — but does it automatically.
 *
 * Behavior:
 *  - Idempotent across activations: a workspace-state flag prevents re-adding
 *    the entry on every startup, so if the user later edits or removes our
 *    entry by hand, we respect that and never fight them.
 *  - No-op if the schema file isn't present yet. Avoids noisy "schema not
 *    found" warnings from Red Hat XML before the user has run
 *    `dart run xwidget_builder:generate` for the first time. The service
 *    re-invokes us when the schema file appears, so registration completes
 *    automatically as soon as it does.
 *  - Only touches our entry. Existing `xml.fileAssociations` entries are
 *    preserved verbatim.
 *  - When `fragmentsPath` changes (detected by the service), use
 *    `updateXmlSchemaPattern` instead to mutate the existing entry's pattern
 *    in place.
 */
export async function registerXmlSchema(
  workspaceRoot: string,
  fragmentsPath: string,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  // Already registered (or user opted out by removing our entry). Either way
  // we don't touch settings.json again.
  if (context.workspaceState.get<boolean>(WORKSPACE_STATE_SCHEMA_REGISTERED, false)) {
    return;
  }

  // Wait until the user has actually generated the schema before pointing
  // Red Hat XML at it. Otherwise the LSP server logs spurious warnings about
  // the missing file every time the workspace opens.
  const schemaPath = path.join(workspaceRoot, SCHEMA_FILE);
  if (!(await fileExists(schemaPath))) {
    return;
  }

  const pattern = buildPattern(fragmentsPath);

  try {
    const config = vscode.workspace.getConfiguration('xml');
    const inspected = config.inspect<XmlFileAssociation[]>('fileAssociations');
    // Only consider the workspace-scoped value here. We don't want to copy
    // the user's global `xml.fileAssociations` entries down into the
    // workspace settings file as a side effect.
    const current: XmlFileAssociation[] = (inspected?.workspaceValue ?? []).slice();

    // Identify our entry by systemId (schema filename). If the user has an
    // entry with our systemId but a different pattern, treat it as ours and
    // leave it — respect their edit.
    const ourEntry = current.find((entry) => entry && entry.systemId === SCHEMA_FILE);
    if (ourEntry) {
      await context.workspaceState.update(WORKSPACE_STATE_SCHEMA_REGISTERED, true);
      return;
    }

    current.push({ pattern, systemId: SCHEMA_FILE });
    await config.update(
      'fileAssociations',
      current,
      vscode.ConfigurationTarget.Workspace,
    );
    await context.workspaceState.update(WORKSPACE_STATE_SCHEMA_REGISTERED, true);
    output.appendLine(
      `Registered ${SCHEMA_FILE} with the Red Hat XML extension via .vscode/settings.json ` +
        `(pattern: ${pattern}). XWidget fragments will now have completion, ` +
        'validation, and hover docs (provided the redhat.vscode-xml extension is installed).',
    );
  } catch (err) {
    // Non-fatal: completion just won't work until the user adds the entry by
    // hand. We log so they have a breadcrumb in the Output panel.
    output.appendLine(
      `[schema-registration] failed to update .vscode/settings.json: ${String(err)}. ` +
        `You can add the following entry manually under "xml.fileAssociations": ` +
        `{ "pattern": "${pattern}", "systemId": "${SCHEMA_FILE}" }`,
    );
  }
}

/**
 * Updates the `pattern` field of our existing `xml.fileAssociations` entry
 * when `fragmentsPath` changes in `xwidget_config.yaml`. Called from
 * `XWidgetService.refresh()` when config reload detects a change.
 *
 * Behavior:
 *  - If we never registered (user removed our entry, or we haven't run yet
 *    because the schema file doesn't exist): no-op. Respect the user's
 *    decision to opt out, and don't recreate entries.
 *  - If our entry exists and the pattern already matches the new path: no-op.
 *  - Otherwise rewrite just the `pattern` field of our entry. Other entries
 *    are preserved verbatim.
 *
 * This keeps `.vscode/settings.json` in sync with `xwidget_config.yaml`
 * without requiring the user to edit both files.
 */
export async function updateXmlSchemaPattern(
  fragmentsPath: string,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  // If we never registered, we shouldn't suddenly start now just because
  // config changed — that would surprise a user who opted out.
  if (!context.workspaceState.get<boolean>(WORKSPACE_STATE_SCHEMA_REGISTERED, false)) {
    return;
  }

  const newPattern = buildPattern(fragmentsPath);

  try {
    const config = vscode.workspace.getConfiguration('xml');
    const inspected = config.inspect<XmlFileAssociation[]>('fileAssociations');
    const current: XmlFileAssociation[] = (inspected?.workspaceValue ?? []).slice();

    const ourIndex = current.findIndex(
      (entry) => entry && entry.systemId === SCHEMA_FILE,
    );
    if (ourIndex === -1) {
      // User removed our entry. Respect that; never re-add.
      return;
    }

    if (current[ourIndex].pattern === newPattern) {
      // Already in sync — nothing to do.
      return;
    }

    const oldPattern = current[ourIndex].pattern;
    current[ourIndex] = { ...current[ourIndex], pattern: newPattern };
    await config.update(
      'fileAssociations',
      current,
      vscode.ConfigurationTarget.Workspace,
    );
    output.appendLine(
      `[schema-registration] updated xml.fileAssociations pattern: ` +
        `'${oldPattern}' -> '${newPattern}' (fragmentsPath changed in xwidget_config.yaml)`,
    );
  } catch (err) {
    output.appendLine(
      `[schema-registration] failed to update xml.fileAssociations pattern: ${String(err)}. ` +
        `You can edit .vscode/settings.json to change the pattern to "${newPattern}".`,
    );
  }
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
 * Prompts the user to install the Red Hat XML extension if it isn't already
 * installed. Called from `XWidgetService.refresh()` after schema registration.
 *
 * Why a prompt rather than `extensionDependencies`:
 *  - `extensionDependencies` hard-blocks our extension from activating until
 *    Red Hat XML is installed. That's too aggressive — none of our other
 *    features (EL highlighting, navigation, hot reload, code generation)
 *    need it. Only XSD-driven completion does.
 *  - A prompt lets the user keep using everything else and opt in to the
 *    completion feature when they're ready.
 *
 * Behavior is delegated to the shared `promptForExtensionIfNeeded` helper —
 * see that function for the nag policy.
 */
export async function promptForRedHatXmlIfNeeded(
  context: vscode.ExtensionContext,
): Promise<void> {
  return promptForExtensionIfNeeded(context, {
    extensionId: REDHAT_XML_EXTENSION_ID,
    dismissedStateKey: WORKSPACE_STATE_REDHAT_XML_PROMPT_DISMISSED,
    message:
      'XWidget extension requires the Red Hat XML extension to provide ' +
      'code completion and contextual documentation in fragments. Install?',
  });
}
