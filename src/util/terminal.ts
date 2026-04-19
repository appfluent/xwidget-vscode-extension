import * as vscode from 'vscode';
import { TERMINAL_NAME } from './constants';

/**
 * Provides a single reusable terminal tab named "XWidget". Multiple command
 * invocations share the same terminal so users don't accumulate terminal tabs
 * when running generation commands repeatedly — mirrors IntelliJ's
 * CommandUtils.runCommandInTerminal behaviour.
 */
export class XWidgetTerminal implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;

  constructor(context: vscode.ExtensionContext) {
    // If the user closes our terminal manually, drop the handle so we create a
    // fresh one next time.
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal((closed) => {
        if (closed === this.terminal) {
          this.terminal = undefined;
        }
      }),
    );
  }

  /**
   * Runs a shell command in the XWidget terminal tab, creating the terminal
   * if it doesn't exist yet. Always shows the terminal because VSCode does
   * not start the underlying shell process until a terminal is shown at
   * least once — calling sendText on an unshown terminal silently drops
   * the command. We pass preserveFocus=true so background invocations
   * (auto-generation) don't steal focus from the editor.
   */
  run(command: string): void {
    if (this.terminal === undefined) {
      this.terminal = vscode.window.createTerminal({ name: TERMINAL_NAME });
    }
    this.terminal.show(true /* preserveFocus */);
    this.terminal.sendText(command, true /* addNewLine */);
  }

  dispose(): void {
    this.terminal?.dispose();
    this.terminal = undefined;
  }
}
