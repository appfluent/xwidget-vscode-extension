import * as vscode from 'vscode';

/**
 * Generic "install this extension if you haven't already" prompt. Used for
 * soft-dependency notifications (Red Hat XML for completion, Dart-Code for
 * controller navigation). Centralised so the two prompts behave identically
 * and any future tweaks to the policy live in one place.
 *
 * Behavior:
 *  - No-op if the extension is already installed (self-cleaning).
 *  - No-op if the user previously clicked "Don't Ask Again" in this workspace.
 *  - Otherwise shows a non-modal info toast with two buttons: Install /
 *    Don't Ask Again. The X corner dismiss does NOT set the dismissed flag —
 *    gives the user another chance on the next workspace reload.
 *  - Info (not warning) level: these prompts are recommendations for optional
 *    integrations, not indicators that something is wrong. Matches the
 *    community norm for missing-dependency prompts in VSCode extensions.
 *  - Install: opens the marketplace details page for the extension. We
 *    deliberately don't set the dismissed flag here either — if the user
 *    bails before installing, we want to remind them next reload.
 *
 * Callers should fire-and-forget (`void promptForExtensionIfNeeded(...)`)
 * rather than `await` — the promise only resolves when the user clicks a
 * button, so awaiting it would gate any subsequent work on user interaction.
 */
export async function promptForExtensionIfNeeded(
  context: vscode.ExtensionContext,
  options: ExtensionPromptOptions,
): Promise<void> {
  // Already installed — self-cleaning, no flag needed.
  if (vscode.extensions.getExtension(options.extensionId)) {
    return;
  }

  // User explicitly opted out for this workspace.
  if (
    context.workspaceState.get<boolean>(options.dismissedStateKey, false)
  ) {
    return;
  }

  const INSTALL = 'Install';
  const DONT_SHOW = "Don't Ask Again";

  const choice = await vscode.window.showInformationMessage(
    options.message,
    INSTALL,
    DONT_SHOW,
  );

  if (choice === INSTALL) {
    await vscode.commands.executeCommand('extension.open', options.extensionId);
  } else if (choice === DONT_SHOW) {
    await context.workspaceState.update(options.dismissedStateKey, true);
  }
  // X dismiss returns undefined: no flag set, prompt again next reload.
}

export interface ExtensionPromptOptions {
  /** Marketplace ID, e.g. `redhat.vscode-xml` or `Dart-Code.dart-code`. */
  readonly extensionId: string;
  /** Workspace-state key used to remember "Don't Ask Again" choices. */
  readonly dismissedStateKey: string;
  /** Toast body. Should phrase as a question ending in "Install?". */
  readonly message: string;
}
