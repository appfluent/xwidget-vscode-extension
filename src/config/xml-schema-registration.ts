import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  CATALOG_FILE,
  REDHAT_XML_EXTENSION_ID,
  SCHEMA_FILE,
  WORKSPACE_STATE_CATALOG_REGISTERED,
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
 * so Red Hat XML only parses files in that tree rather than every XML file
 * in the workspace.
 *
 * Uses `**.xml` rather than `**\/*.xml` — the recursive-plus-slash form
 * breaks Red Hat XML's relative systemId resolution when the XSD lives
 * outside the matched tree.
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
  return `${normalized}/**.xml`;
}

/**
 * Registers the builder-generated XML catalog (`.xwidget/schema_catalog.g.xml`,
 * xwidget_builder >= 0.7.0) with the Red Hat XML extension via `xml.catalogs`
 * in `.vscode/settings.json`. The catalog maps every XWidget namespace
 * (fragments, routes, values) to its schema, replacing the legacy
 * `xml.fileAssociations` mechanism — so on first registration our legacy
 * fileAssociations entry is also removed (builder 0.7.0 deletes the root
 * schema it points at; leaving it would put missing-schema warnings on every
 * fragment).
 *
 * Returns true when the workspace is in catalog mode (the catalog file
 * exists) — the caller must then skip the legacy registration flow. Returns
 * false for pre-0.7.0 projects so the caller can fall back to
 * `registerXmlSchema`.
 *
 * Same contracts as the legacy flow: a workspace-state flag makes this a
 * one-time write (users who remove our entry aren't fought), existing
 * settings entries are preserved verbatim, and the path is written
 * workspace-relative — LemMinX resolves it against the workspace root.
 *
 * Downgrade detection: if we registered the catalog but the file is gone,
 * the project left catalog mode (builder downgrade, or `.xwidget/` deleted).
 * Our catalog entry is removed and both era flags are cleared so the legacy
 * flow can re-register on the same refresh. This is distinct from user
 * opt-out, where the catalog file still exists and only our settings entry
 * was removed — that is respected and never undone.
 */
export async function registerXmlCatalog(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const catalogAbs = path.join(workspaceRoot, CATALOG_FILE);
  if (!(await fileExists(catalogAbs))) {
    if (context.workspaceState.get<boolean>(WORKSPACE_STATE_CATALOG_REGISTERED, false)) {
      // We registered the catalog, but the file is gone — downgrade. Undo.
      try {
        const config = vscode.workspace.getConfiguration('xml');
        const catalogs: string[] = (
          config.inspect<string[]>('catalogs')?.workspaceValue ?? []
        ).filter((entry) => entry !== CATALOG_FILE);
        await config.update(
          'catalogs',
          catalogs.length > 0 ? catalogs : undefined,
          vscode.ConfigurationTarget.Workspace,
        );
        await context.workspaceState.update(WORKSPACE_STATE_CATALOG_REGISTERED, false);
        await context.workspaceState.update(WORKSPACE_STATE_SCHEMA_REGISTERED, false);
        output.appendLine(
          `[schema-registration] ${CATALOG_FILE} no longer exists (builder ` +
            'downgrade?) — removed our xml.catalogs entry. Legacy schema ' +
            'registration will re-run when the root schema is generated.',
        );
      } catch (err) {
        // Flags intentionally left set so the undo retries on the next
        // refresh rather than leaving a half-unwound registration.
        output.appendLine(
          `[schema-registration] failed to remove stale xml.catalogs entry: ${String(err)}`,
        );
      }
    }
    return false;
  }

  // Already registered (or user opted out by removing our entry) — catalog
  // mode stands, but settings.json isn't touched again.
  if (context.workspaceState.get<boolean>(WORKSPACE_STATE_CATALOG_REGISTERED, false)) {
    return true;
  }

  try {
    const config = vscode.workspace.getConfiguration('xml');

    // One-time migration: drop our legacy fileAssociations entry (matched by
    // systemId, so user-authored entries are untouched).
    const associations: XmlFileAssociation[] = (
      config.inspect<XmlFileAssociation[]>('fileAssociations')?.workspaceValue ?? []
    ).slice();
    const withoutOurs = associations.filter(
      (entry) => !entry || entry.systemId !== SCHEMA_FILE,
    );
    if (withoutOurs.length !== associations.length) {
      await config.update(
        'fileAssociations',
        withoutOurs.length > 0 ? withoutOurs : undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      output.appendLine(
        `[schema-registration] removed legacy xml.fileAssociations entry for ` +
          `${SCHEMA_FILE} (superseded by the schema catalog).`,
      );
    }

    const catalogs: string[] = (
      config.inspect<string[]>('catalogs')?.workspaceValue ?? []
    ).slice();
    if (!catalogs.includes(CATALOG_FILE)) {
      catalogs.push(CATALOG_FILE);
      await config.update('catalogs', catalogs, vscode.ConfigurationTarget.Workspace);
      output.appendLine(
        `Registered ${CATALOG_FILE} with the Red Hat XML extension via ` +
          `.vscode/settings.json (xml.catalogs). Fragments, routes, and values ` +
          'documents now have completion and validation (provided the ' +
          'redhat.vscode-xml extension is installed).',
      );
    }
    await context.workspaceState.update(WORKSPACE_STATE_CATALOG_REGISTERED, true);
  } catch (err) {
    // Non-fatal: validation just won't work until the user adds the entry by
    // hand. Flag stays unset so the next refresh retries.
    output.appendLine(
      `[schema-registration] failed to update .vscode/settings.json: ${String(err)}. ` +
        `You can add "${CATALOG_FILE}" manually under "xml.catalogs".`,
    );
  }
  return true;
}

/**
 * Idempotently registers `xwidget_schema.g.xsd` with the Red Hat XML extension
 * by adding an entry to `xml.fileAssociations` in `.vscode/settings.json`.
 * Legacy flow for xwidget_builder < 0.7.0 projects — newer projects ship a
 * schema catalog and are handled by `registerXmlCatalog` instead.
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
