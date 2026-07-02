import * as vscode from 'vscode';

/**
 * WelcomePanel — Shown on first activation to onboard the user.
 * Explains Angel's two modes (Conversational + SDLC), guides API key setup,
 * and links to keyboard shortcuts.
 */
export class WelcomePanel {
  public static currentPanel: WelcomePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposed = false;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._context = context;

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'setApiKey':
          await vscode.commands.executeCommand('angel.clearApiKeys');
          break;
        case 'dismiss':
          await context.globalState.update('angel.onboarded', true);
          this._panel.dispose();
          break;
      }
    });

    this._panel.onDidDispose(() => {
      this._disposed = true;
      WelcomePanel.currentPanel = undefined;
    });
  }

  /**
   * Show the Welcome panel (only once per install).
   */
  public static show(context: vscode.ExtensionContext): void {
    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'angel.welcome',
      'Welcome to Angel',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    WelcomePanel.currentPanel = new WelcomePanel(panel, context);
  }

  private _getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Angel</title>
  <style>
    :root {
      --background: var(--vscode-editor-background, #1e1e1e);
      --foreground: var(--vscode-editor-foreground, #cccccc);
      --card: var(--vscode-editorWidget-background, #252526);
      --border: var(--vscode-widget-border, #454545);
      --gradient-brand: linear-gradient(135deg, #00E5FF, #2979FF, #AA00FF);
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: var(--vscode-font-family, "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      background: var(--background);
      color: var(--foreground);
      padding: 60px 40px;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    .hero {
      text-align: center;
      margin-bottom: 64px;
    }
    
    .hero h1 {
      font-size: 2.5rem;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--foreground);
    }
    
    .hero p {
      color: var(--vscode-descriptionForeground, #999999);
      font-size: 1.1rem;
      max-width: 600px;
      margin: 0 auto;
    }

    .modes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 48px;
      max-width: 800px;
      width: 100%;
    }
    
    .mode-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 24px;
    }
    
    .mode-card .icon { 
      font-size: 2rem; 
      margin-bottom: 16px; 
      display: inline-block;
    }
    
    .mode-card h3 { 
      color: var(--foreground);
      margin-bottom: 12px; 
      font-size: 1.2rem; 
      font-weight: 600;
    }
    
    .mode-card p { 
      color: var(--vscode-descriptionForeground, #999999); 
      font-size: 0.95rem; 
    }

    .shortcuts {
      max-width: 800px;
      width: 100%;
      margin-bottom: 56px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 24px;
    }
    
    .shortcuts h3 { 
      color: var(--foreground);
      margin-bottom: 20px; 
      font-size: 1rem;
      font-weight: 600;
    }
    
    .shortcut-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    
    .shortcut-row:last-child { border-bottom: none; }
    
    .shortcut-row span { 
      color: var(--foreground); 
      font-size: 0.95rem; 
    }
    
    kbd {
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 8px;
      font-family: var(--vscode-editor-font-family, 'SF Mono', Consolas, monospace);
      font-size: 0.85rem;
      color: var(--foreground);
    }

    .actions {
      text-align: center;
      display: flex;
      gap: 16px;
      justify-content: center;
      width: 100%;
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 24px;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    
    .btn-primary {
      background: var(--gradient-brand);
      color: #ffffff;
    }
    
    .btn-primary:hover {
      opacity: 0.9;
    }
    
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }
    
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Welcome to Angel</h1>
    <p>The high-performance SDLC automation engine. Multi-agent debate, spatial design, and zero-to-deployed velocity.</p>
  </div>

  <div class="modes">
    <div class="mode-card">
      <div class="icon">💬</div>
      <h3>Conversational</h3>
      <p>Instant precision with workspace-aware intelligence. Real-time reviews, context-deep debugging, and seamless iteration.</p>
    </div>
    <div class="mode-card">
      <div class="icon">🏗️</div>
      <h3>SDLC Pipeline</h3>
      <p>Automated architectural rigor. From requirements to deployment with an 8-agent swarm and security-first auditing.</p>
    </div>
  </div>

  <div class="shortcuts">
    <h3>Command Terminals</h3>
    <div class="shortcut-row">
      <span>Open Angel Input</span>
      <div><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>;</kbd></div>
    </div>
    <div class="shortcut-row">
      <span>Start Voice Studio</span>
      <div><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd></div>
    </div>
    <div class="shortcut-row">
      <span>Launch Pipeline</span>
      <div><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd></div>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-secondary" onclick="postMsg('setApiKey')">Configure API</button>
    <button class="btn btn-primary" onclick="postMsg('dismiss')">Initialize v1.0</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function postMsg(type) { vscode.postMessage({ type }); }
  </script>
</body>
</html>`;
  }
}
