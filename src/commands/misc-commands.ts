import * as vscode from 'vscode';
import { URL_DOCUMENTATION, URL_ISSUES, WORKSPACE_STATE_SCHEMA_REGISTERED } from '../util/constants';
import { XWidgetService } from '../services/xwidget-service';
import { registerXmlSchema } from '../config/xml-schema-registration';

/**
 * Registers the non-generation commands: documentation, issues, the
 * auto-generate toggle, and the status-surface restore command. Kept
 * separate from generate-commands.ts to keep each module focused.
 */
export function registerMiscCommands(
  context: vscode.ExtensionContext,
  service: XWidgetService,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('flutter-xwidget.openDocs', () => {
      vscode.env.openExternal(vscode.Uri.parse(URL_DOCUMENTATION));
    }),
    vscode.commands.registerCommand('flutter-xwidget.openIssues', () => {
      vscode.env.openExternal(vscode.Uri.parse(URL_ISSUES));
    }),
    vscode.commands.registerCommand('flutter-xwidget.toggleAutoGenerate', async () => {
      await service.setAutoGenerateEnabled(!service.autoGenerateEnabled);
    }),
    // Pass 4.6 — click target for the "Schema registration removed" status
    // item. Clears the "already registered" workspace flag so registerXmlSchema
    // will re-add our entry on the next call, then invokes it directly.
    //
    // Pass 4.6.1: modal confirmation before writing to settings.json. Users
    // clicking a tree row expect to be asked first, not have a config file
    // silently modified under them.
    vscode.commands.registerCommand(
      'flutter-xwidget.restoreSchemaRegistration',
      async () => {
        if (!service.workspaceRoot || !service.config) {
          vscode.window.showWarningMessage(
            'XWidget: no workspace or config detected — cannot restore schema registration.',
          );
          return;
        }
        const RESTORE = 'Restore';
        const choice = await vscode.window.showInformationMessage(
          'Restore the XWidget schema entry in .vscode/settings.json?',
          { modal: true },
          RESTORE,
        );
        if (choice !== RESTORE) return;
        await context.workspaceState.update(
          WORKSPACE_STATE_SCHEMA_REGISTERED,
          false,
        );
        await registerXmlSchema(
          service.workspaceRoot,
          service.config.fragmentsPath,
          context,
          output,
        );
      },
    ),
  );
}
