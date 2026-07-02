import * as vscode from 'vscode';
import { SecretScannerService, ScanResult } from '../services/project/SecretScannerService';
import { Logger } from '../utils/logger';

export function registerSecretScanCommands(
    context: vscode.ExtensionContext,
    logger: Logger
): vscode.StatusBarItem {
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        95
    );
    context.subscriptions.push(statusBarItem);

    const updateStatusBar = (workspaceRoot: string) => {
        const scanner = new SecretScannerService(workspaceRoot, logger);
        if (scanner.isHookInstalled()) {
            statusBarItem.text = '$(shield) Angel Scanner Active';
            statusBarItem.tooltip = 'Angel secret scanner is active. Click to scan now.';
            statusBarItem.backgroundColor = undefined;
        } else {
            statusBarItem.text = '$(shield) Scanner Off';
            statusBarItem.tooltip = 'Angel secret scanner not installed. Click to install.';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        statusBarItem.command = 'angel.scanForSecrets';
        statusBarItem.show();
    };

    // ── angel.scanForSecrets ────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('angel.scanForSecrets', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('Angel: No workspace open');
                return;
            }

            const scanner = new SecretScannerService(workspaceRoot, logger);
            const outputChannel = vscode.window.createOutputChannel('Angel Security');
            outputChannel.clear();
            outputChannel.appendLine('═══════════════════════════════════════════════════');
            outputChannel.appendLine(' Angel — Secret Scanner');
            outputChannel.appendLine('═══════════════════════════════════════════════════');
            outputChannel.appendLine('Scanning workspace for credential leaks...');
            outputChannel.show();

            const result: ScanResult = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Angel: Scanning for secrets...', cancellable: false },
                async () => scanner.scan()
            );

            outputChannel.appendLine('');
            outputChannel.appendLine(`Scanned: ${result.scannedFiles} files in ${result.durationMs}ms`);
            outputChannel.appendLine(`Found:   ${result.findings.length} potential secret(s)`);
            outputChannel.appendLine('');

            if (result.findings.length === 0) {
                outputChannel.appendLine('✓ No secrets detected. Repository looks clean.');
                vscode.window.showInformationMessage('Angel: No secrets detected ✓');
            } else {
                // Group by severity
                const critical = result.findings.filter(f => f.severity === 'critical');
                const high = result.findings.filter(f => f.severity === 'high');
                const medium = result.findings.filter(f => f.severity === 'medium');

                if (critical.length > 0) {
                    outputChannel.appendLine(`CRITICAL (${critical.length}):`);
                    critical.forEach(f => {
                        outputChannel.appendLine(`  ✗ ${f.file}:${f.line} — ${f.patternName} [${f.snippet}]`);
                        if (f.falsePositiveHint) {
                            outputChannel.appendLine(`    Note: ${f.falsePositiveHint}`);
                        }
                    });
                    outputChannel.appendLine('');
                }
                if (high.length > 0) {
                    outputChannel.appendLine(`HIGH (${high.length}):`);
                    high.forEach(f => {
                        outputChannel.appendLine(`  ⚠ ${f.file}:${f.line} — ${f.patternName} [${f.snippet}]`);
                    });
                    outputChannel.appendLine('');
                }
                if (medium.length > 0) {
                    outputChannel.appendLine(`MEDIUM (${medium.length}):`);
                    medium.forEach(f => {
                        outputChannel.appendLine(`  ~ ${f.file}:${f.line} — ${f.patternName} [${f.snippet}]`);
                    });
                    outputChannel.appendLine('');
                }

                outputChannel.appendLine('Fix: Replace secrets with environment variables or VSCode SecretStorage.');

                vscode.window.showWarningMessage(
                    `Angel: ${result.findings.length} secret(s) found — see Angel Security output`,
                    'View Results'
                ).then(action => {
                    if (action === 'View Results') { outputChannel.show(); }
                });
            }

            updateStatusBar(workspaceRoot);
        })
    );

    // ── angel.installSecretScanner ──────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('angel.installSecretScanner', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('Angel: No workspace open');
                return;
            }

            const scanner = new SecretScannerService(workspaceRoot, logger);
            const success = scanner.installPreCommitHook();

            if (success) {
                updateStatusBar(workspaceRoot);
                vscode.window.showInformationMessage(
                    'Angel: Pre-commit secret scanner installed ✓ — all future commits will be scanned automatically'
                );
                logger.info('[SecretScanCommands] Pre-commit hook installed');
            } else {
                vscode.window.showErrorMessage(
                    'Angel: Could not install hook — this workspace may not be a git repository'
                );
            }
        })
    );

    // ── angel.uninstallSecretScanner ────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('angel.uninstallSecretScanner', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('Angel: No workspace open');
                return;
            }

            const scanner = new SecretScannerService(workspaceRoot, logger);
            const success = scanner.uninstallPreCommitHook();

            if (success) {
                updateStatusBar(workspaceRoot);
                vscode.window.showInformationMessage('Angel: Secret scanner hook removed.');
                logger.info('[SecretScanCommands] Pre-commit hook removed');
            } else {
                vscode.window.showWarningMessage(
                    'Angel: Hook was not managed by Angel or was not found.'
                );
            }
        })
    );

    // Initialize status bar on activation
    const initialRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (initialRoot) { updateStatusBar(initialRoot); }

    return statusBarItem;
}
