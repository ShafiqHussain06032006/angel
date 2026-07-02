import * as vscode from 'vscode';
import * as path from 'path';
import { JsDocGeneratorService } from '../services/documentation/JsDocGeneratorService';
import { ChangelogService } from '../services/documentation/ChangelogService';
import { LLMService } from '../services/llm';

/**
 * Register all Phase 11 documentation commands:
 * - angel.generateJsDocs        — generate JSDoc for the BMAD agents directory
 * - angel.generateJsDocsFile    — generate JSDoc for the currently active file
 * - angel.generateChangelog     — generate CHANGELOG.md from git history
 *
 * @param context - VSCode extension context for subscription management
 * @param llmService - Shared LLM service instance
 * @param logger - Angel logger instance
 */
export function registerDocumentationCommands(
  context: vscode.ExtensionContext,
  llmService: LLMService,
  logger: any
): void {
  const jsDocService = new JsDocGeneratorService(llmService, logger);
  const changelogService = new ChangelogService(logger);

  // ─── angel.generateJsDocs ────────────────────────────────────────────────
  // Generates JSDoc for all undocumented exported symbols in src/agents/BMAD/
  const generateJsDocsCmd = vscode.commands.registerCommand('angel.generateJsDocs', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Angel: No workspace folder open.');
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const targetDir = path.join(workspaceRoot, 'src', 'agents', 'BMAD');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Angel: Generating JSDoc for BMAD agents...',
        cancellable: false,
      },
      async () => {
        try {
          const results = await jsDocService.generateForDirectory(targetDir);
          const totalDocumented = results.reduce((sum, r) => sum + r.functionsDocumented, 0);
          const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
          const filesChanged = results.filter(r => r.functionsDocumented > 0).length;

          vscode.window.showInformationMessage(
            `Angel: JSDoc generation complete. ${totalDocumented} export(s) documented across ${filesChanged} file(s). ${totalSkipped} already had docs.`
          );
          logger.info(`[DocumentationCommands] JSDoc: ${totalDocumented} documented, ${totalSkipped} skipped`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Angel: JSDoc generation failed — ${err.message}`);
          logger.error(`[DocumentationCommands] JSDoc generation error: ${err.message}`);
        }
      }
    );
  });

  // ─── angel.generateJsDocsFile ─────────────────────────────────────────────
  // Generates JSDoc for undocumented exports in the currently open .ts file
  const generateJsDocsFileCmd = vscode.commands.registerCommand('angel.generateJsDocsFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Angel: No active editor. Open a TypeScript file first.');
      return;
    }
    const filePath = editor.document.fileName;
    if (!filePath.endsWith('.ts')) {
      vscode.window.showWarningMessage('Angel: JSDoc generation is only supported for TypeScript (.ts) files.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Angel: Generating JSDoc for ${path.basename(filePath)}...`,
        cancellable: false,
      },
      async () => {
        try {
          const result = await jsDocService.generateForFile(filePath);
          if (result.functionsDocumented > 0) {
            // Reload document to show updated content
            await vscode.commands.executeCommand('workbench.action.revertFile');
            vscode.window.showInformationMessage(
              `Angel: JSDoc generation complete. ${result.functionsDocumented} export(s) documented, ${result.skipped} already had docs.`
            );
          } else {
            vscode.window.showInformationMessage(
              `Angel: All ${result.skipped} export(s) in ${path.basename(filePath)} already have JSDoc — nothing to do.`
            );
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Angel: JSDoc generation failed — ${err.message}`);
          logger.error(`[DocumentationCommands] JSDoc file generation error: ${err.message}`);
        }
      }
    );
  });

  // ─── angel.generateChangelog ──────────────────────────────────────────────
  // Parses git history using Conventional Commits and writes CHANGELOG.md
  const generateChangelogCmd = vscode.commands.registerCommand('angel.generateChangelog', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Angel: No workspace folder open.');
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const choice = await vscode.window.showQuickPick(
      ['Generate / Update CHANGELOG.md from git history', 'Cancel'],
      { placeHolder: 'Angel: Changelog Generator' }
    );
    if (!choice || choice === 'Cancel') { return; }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Angel: Generating CHANGELOG.md...',
        cancellable: false,
      },
      async () => {
        try {
          const outputPath = await changelogService.generate(workspaceRoot);
          const uri = vscode.Uri.file(outputPath);
          await vscode.window.showTextDocument(uri);
          vscode.window.showInformationMessage('Angel: CHANGELOG.md generated successfully.');
          logger.info(`[DocumentationCommands] CHANGELOG.md written to ${outputPath}`);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Angel: Changelog generation failed — ${err.message}`);
          logger.error(`[DocumentationCommands] Changelog generation error: ${err.message}`);
        }
      }
    );
  });

  context.subscriptions.push(generateJsDocsCmd, generateJsDocsFileCmd, generateChangelogCmd);
  logger.info('[DocumentationCommands] Documentation commands registered (generateJsDocs, generateJsDocsFile, generateChangelog)');
}
