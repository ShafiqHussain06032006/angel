/**
 * Start recording command implementation
 */

import * as vscode from 'vscode';

export class StartRecordingCommand {
  static readonly id = 'angel.startRecording';

  static register(context: vscode.ExtensionContext): void {
    vscode.commands.registerCommand(this.id, async () => {
      // TODO: Implement start recording logic
      vscode.window.showInformationMessage('Recording started');
    });
  }
}
