import * as vscode from 'vscode';
import {
  DART_CODE_EXTENSION_ID,
  WORKSPACE_STATE_DART_CODE_PROMPT_DISMISSED,
} from '../util/constants';
import { promptForExtensionIfNeeded } from '../util/extension-prompts';

/**
 * Prompts the user to install the Dart-Code extension if it isn't already
 * installed. Called from `XWidgetService.refresh()` for XWidget projects.
 *
 * Why a prompt rather than `extensionDependencies`:
 *  - Dart-Code is needed only for controller navigation (`<Controller name="X"/>`
 *    Cmd-click and CodeLens). Fragment navigation, EL highlighting, code
 *    generation, and hot reload all work without it.
 *  - Most Flutter developers already have Dart-Code installed since it's the
 *    de-facto Flutter dev environment, so the prompt should be silent for
 *    them (the early-return when the extension is detected handles this).
 *  - For users who don't have it, a polite prompt lets them opt in.
 *
 * Behavior is delegated to the shared `promptForExtensionIfNeeded` helper —
 * see that function for the nag policy.
 */
export async function promptForDartCodeIfNeeded(
  context: vscode.ExtensionContext,
): Promise<void> {
  return promptForExtensionIfNeeded(context, {
    extensionId: DART_CODE_EXTENSION_ID,
    dismissedStateKey: WORKSPACE_STATE_DART_CODE_PROMPT_DISMISSED,
    message:
      'XWidget extension requires the Dart extension to enable Cmd-click ' +
      'and CodeLens navigation from Controller tags to their Dart class ' +
      'definitions. Install?',
  });
}
