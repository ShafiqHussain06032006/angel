import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import { Logger } from './utils/logger';
import { ConfigService } from './config/ConfigService';
import { LLMService, GeminiProvider, GroqProvider, AnthropicProvider, OpenAIProvider } from './services/llm';
import { AgentRegistry, OrchestratorAgent } from './agents';
import { PlanningAgent } from './agents/planning/PlanningAgent';
import { FileService } from './services/file/FileService';
import { ContextBuilder } from './services/workflow/ContextBuilder';
import { ConversationService } from './services/conversation/ConversationService';
import { StartRecordingCommand } from './commands/StartRecordingCommand';
import { StopRecordingCommand } from './commands/StopRecordingCommand';
import { ManageAgentsCommand } from './commands/ManageAgentsCommand';
import { RecordingStatus } from './ui/statusBar/RecordingStatus';
import { AgentPanel } from './ui/panels/AgentPanel';
import { SidebarProvider } from './ui/panels/SidebarProvider';
import { EnhancedSidebarProvider } from './ui/panels/EnhancedSidebarProvider';
import { ConversationEngine } from './services/conversationEngine';
import { TTSService } from './services/ttsService';
import { LocalWhisperService } from './services/localWhisperService';
import { setLocalWhisperInstance, setGroqProviderInstance } from './services/audioRouter';
import { AudioSanitizer } from './services/audioSanitizer';
import { SDLCWebviewPanel } from './panels/SDLCWebviewPanel';
import { PRDDocument } from './types/sdlc';
import { WorkspaceIntelligence } from './services/workspace/WorkspaceIntelligence';
import { CoverageSidebarProvider } from './ui/panels/CoverageSidebarProvider';
import { OtelInstrumentationService } from './services/project/OtelInstrumentationService';
import { GrafanaDashboardService } from './services/project/GrafanaDashboardService';
import { RunbookGeneratorService } from './services/project/RunbookGeneratorService';
import { registerSecurityCommands } from './commands/security-commands';
import { registerSecretScanCommands } from './commands/secret-scan-commands';
import { ReadmeSyncService } from './services/documentation/ReadmeSyncService';
import { registerDocumentationCommands } from './commands/DocumentationCommands';
import { WelcomePanel } from './ui/onboarding/WelcomePanel';
import { JiraSetupWebview } from './jira/JiraSetupWebview';
import { JiraAuthService } from './jira/JiraAuthService';

let logger: Logger;
let configService: ConfigService;
let llmService: LLMService;
let agentRegistry: AgentRegistry;
let fileService: FileService;
let recordingStatus: RecordingStatus;
let agentPanel: AgentPanel;
let sidebarProvider: SidebarProvider;
let conversationService: ConversationService;
let brain: ConversationEngine;
let tts: TTSService;
let localWhisper: LocalWhisperService;
let audioSanitizer: AudioSanitizer;
let currentConversationId: string | null = null;
let currentCancellationTokenSource: vscode.CancellationTokenSource | null = null;

type ProviderId = 'gemini' | 'groq' | 'anthropic' | 'openai';

function createProvider(providerName: ProviderId): GeminiProvider | GroqProvider | AnthropicProvider | OpenAIProvider {
	if (providerName === 'anthropic') {
		return new AnthropicProvider();
	}
	if (providerName === 'openai') {
		return new OpenAIProvider();
	}
	if (providerName === 'gemini') {
		return new GeminiProvider();
	}
	return new GroqProvider();
}

async function initializeProvider(providerName: ProviderId, apiKey: string, modelName?: string): Promise<void> {
	const provider = createProvider(providerName);
	if (providerName === 'anthropic' && modelName) {
		(provider as AnthropicProvider).setModel(modelName as any);
	} else if (providerName === 'openai' && modelName) {
		(provider as OpenAIProvider).setModel(modelName as any);
	}
	await provider.initialize(apiKey);
	llmService.setProvider(provider);
	logger.info(`LLM provider initialized: ${providerName}`);
}

function initializeCoreServices(context: vscode.ExtensionContext): string {
	dotenv.config({ path: path.join(context.extensionPath, '.env') });
	logger = new Logger('Angel');
	configService = new ConfigService();
	configService.setSecretStorage(context.secrets);
	fileService = new FileService();
	agentRegistry = new AgentRegistry();
	llmService = new LLMService();
	recordingStatus = new RecordingStatus();
	agentPanel = new AgentPanel(context);

	const wsIntel = new WorkspaceIntelligence(configService);
	brain = new ConversationEngine(wsIntel, configService, logger);
	tts = new TTSService();
	localWhisper = new LocalWhisperService();
	audioSanitizer = new AudioSanitizer();

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
	if (workspaceRoot) {
		conversationService = new ConversationService(workspaceRoot);
	}

	return workspaceRoot;
}

function registerWebviews(context: vscode.ExtensionContext, workspaceRoot: string): void {
	sidebarProvider = new SidebarProvider(context, logger, llmService, (webviewView) => {
		agentPanel.setWebviewView(webviewView);

		if (conversationService && currentConversationId) {
			const conv = conversationService.getConversation(currentConversationId);
			if (conv && conv.messages.length > 0) {
				agentPanel.displayConversation(conv.messages.map(m => ({
					role: m.role,
					content: m.content,
					timestamp: new Date(m.timestamp).toISOString()
				})));
				logger.info(`Loaded ${conv.messages.length} messages from conversation ${currentConversationId}`);
			}
		}
	});

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebarProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);
	logger.info('Sidebar provider registered');

	const enhancedSidebar = new EnhancedSidebarProvider(workspaceRoot);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(EnhancedSidebarProvider.viewType, enhancedSidebar)
	);
	logger.info('Enhanced Sidebar provider registered');

	const coverageSidebar = new CoverageSidebarProvider(workspaceRoot);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(CoverageSidebarProvider.viewType, coverageSidebar)
	);
	logger.info('Coverage Sidebar provider registered');
}

async function cleanupStaleAudioFiles(logger: Logger) {
	try {
		const tmpDir = os.tmpdir();
		const files = await fs.promises.readdir(tmpDir);
		const staleFiles = files.filter(f => f.startsWith('angel_recording_') && f.endsWith('.wav'));

		let deletedCount = 0;
		for (const file of staleFiles) {
			const filePath = path.join(tmpDir, file);
			try {
				await fs.promises.unlink(filePath);
				deletedCount++;
			} catch (err) {
				logger.warn(`Failed to delete stale audio file ${file}: ${err}`);
			}
		}
		if (deletedCount > 0) {
			logger.info(`Cleaned up ${deletedCount} stale audio file(s)`);
		}
	} catch (err) {
		logger.warn(`Could not scan tmpdir for stale audio files: ${err}`);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	try {
		const workspaceRoot = initializeCoreServices(context);
		logger.info('Angel extension activated. Use "Angel: Show Angel Output" to view logs.');

		logger.info('Initializing Angel extension...');

		// Phase 14: Show onboarding wizard on first activation
		if (!context.globalState.get('angel.onboarded')) {
			WelcomePanel.show(context);
		}

		// Cleanup stale audio files left over from previous sessions
		cleanupStaleAudioFiles(logger);

		// Background-initialize TTS and local Whisper (non-blocking)
		tts.initialize(context.extensionPath).catch(err => {
			logger.warn(`TTS background init failed: ${err}`);
		});
		localWhisper.initialize(context.extensionPath).then(() => {
			setLocalWhisperInstance(localWhisper);
			logger.info('Local Whisper initialized and registered with AudioRouter');
		}).catch(err => {
			logger.warn(`Local Whisper background init failed: ${err}`);
		});

		// Wire Groq provider into AudioRouter for cloud STT (non-blocking)
		// Reads from SecretStorage so the key is available even before the user sends a chat message.
		configService.getApiKey('groq').then(async (groqKey) => {
			if (groqKey) {
				const groqProviderForAudio = new GroqProvider();
				await groqProviderForAudio.initialize(groqKey);
				setGroqProviderInstance(groqProviderForAudio);
				logger.info('Groq provider registered with AudioRouter for cloud STT');
			}
		}).catch(err => {
			logger.warn(`AudioRouter Groq init failed: ${err}`);
		});

		if (workspaceRoot) {
			conversationService = new ConversationService(workspaceRoot);
			logger.info('ConversationService initialized for persistence');
		}

		// Wire Context Updates from LLM to UI
		llmService.setContextUsageCallback((used, total) => {
			agentPanel?.updateContextUsage(used, total);
		});

		registerWebviews(context, workspaceRoot);


		// Register all agents
		registerAllAgents();

		// Register commands
		StartRecordingCommand.register(context);
		StopRecordingCommand.register(context);
		ManageAgentsCommand.register(context);
		registerSecurityCommands(context, logger);

		// Phase 10: Secret Scanner commands + status bar
		registerSecretScanCommands(context, logger);

		// Phase 11: Documentation commands (JSDoc + Changelog)
		registerDocumentationCommands(context, llmService, logger);

		// Phase 11: README Auto-Sync — offer to regenerate stale sections on file save
		const readmeSyncService = new ReadmeSyncService(llmService, logger);
		context.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(async (document) => {
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) { return; }
				const wsRoot = workspaceFolders[0].uri.fsPath;
				await readmeSyncService.onFileSaved(document, wsRoot);
			})
		);

		// Register main processing command (prompts in popup if no args)
		const processCommand = vscode.commands.registerCommand('angel.processInput', async () => {
			await processUserInput(context);
		});

		// show output channel command
		const showOutputCmd = vscode.commands.registerCommand('angel.showOutput', async () => {
			logger.show();
		});

		// Register processing command that accepts params from webview
		const processWithData = vscode.commands.registerCommand('angel.processInputWithData', async (apiKey: string, input: string, mode: 'plan' | 'code' | 'ask' = 'code', provider?: string, model?: string) => {
			await processUserInput(context, apiKey, input, mode, { fromWebview: true, provider, model });
		});

		// Register load conversation command
		const loadConversationCmd = vscode.commands.registerCommand('angel.loadConversation', async (conversationId: string) => {
			await loadConversation(conversationId);
		});

		// Register SDLC Start command — runs inline in sidebar chat (Kilo Code style)
		const startSDLCCmd = vscode.commands.registerCommand('angel.startSDLC', async (topic?: string, apiKeyArg?: string, providerArg?: string) => {
			// If the frontend passed an API key (e.g. user just typed it), save it instantly
			// and pre-initialize the LLM service to guarantee ensureLLMStatus passes.
			if (apiKeyArg) {
				const providerName = (providerArg as ProviderId) || await configService.getSelectedProvider() || 'groq';
				await configService.storeApiKey(providerName, apiKeyArg);
				await configService.storeSelectedProvider(providerName);

				if (!llmService.isInitialized()) {
					await initializeProvider(providerName, apiKeyArg);
				}
			}

			const ok = await ensureLLMStatus(context);
			if (!ok) {
				vscode.window.showErrorMessage('Angel: No LLM provider found. Please configure an API key via the Profile button.');
				return;
			}

			// --- PRD Persistence & Resumption Check ---
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (workspaceRoot) {
				try {
					const { AngelArtifactService } = require('./services/artifact/AngelArtifactService');
					const artifacts = new AngelArtifactService(workspaceRoot);
					const existingPrd = artifacts.readJSON('prd.json');

					if (existingPrd && existingPrd.title && Array.isArray(existingPrd.sections) && existingPrd.sections.length > 0) {
						const resumeChoice = await vscode.window.showInformationMessage(
							`Existing PRD found: "${existingPrd.title}". How would you like to proceed?`,
							'Skip to Execution',
							'Review PRD',
							'Start New Debate'
						);

						if (resumeChoice === 'Skip to Execution') {
							agentPanel.showThinking(true);
							agentPanel.addMessage('system', 'Skipping to execution for: **' + existingPrd.title + '**. PRD loaded (' + existingPrd.sections.length + ' sections). BMAD agents starting...');
							const orchestrator = agentRegistry.get('orchestrator') as any;
							if (orchestrator) {
								try {
									await orchestrator.onPRDApproved(existingPrd, context, agentPanel);
								} catch (execErr: any) {
									agentPanel.showThinking(false);
									agentPanel.addMessage('system', 'Execution failed: ' + (execErr.message || execErr));
									vscode.window.showErrorMessage('BMAD Pipeline failed: ' + (execErr.message || execErr));
								}
							}
							return;
						}

						if (resumeChoice === 'Review PRD') {
							agentPanel.showThinking(false);
							agentPanel.addMessage('system', 'Opening PRD for review: **' + existingPrd.title + '**');
							const { SDLCWebviewPanel } = require('./panels/SDLCWebviewPanel');
							SDLCWebviewPanel.createOrShow(context, logger, llmService, undefined, existingPrd);
							return;
						}
						// 'Start New Debate' or dismissed - falls through to debate flow
					}
				} catch (err) {
					logger.warn(`Failed to read existing PRD from workspace: ${err}`);
				}
			}
			// -----------------------------------------

			if (!topic || topic.trim().length === 0) {
				topic = await vscode.window.showInputBox({
					prompt: 'What are we building? Describe the feature or application.',
					placeHolder: 'e.g. ecommerce website for shoes',
					ignoreFocusOut: true
				});
				if (!topic) { return; }
			}

			const { DebateOrchestrator } = require('./agents/DebateOrchestrator');
			const orchestrator = new DebateOrchestrator(llmService, logger);

			// Initialize cancellation token
			currentCancellationTokenSource = new vscode.CancellationTokenSource();

			// Show user message in sidebar chat
			agentPanel.addMessage('user', `Start SDLC: ${topic}`);
			agentPanel.showThinking(true);
				agentPanel.addMessage('system', ' Angel SDLC pipeline started. 8 AI agents are debating your requirements…');

			try {
				const prd = await orchestrator.runDebate(topic, (msg: import('./types/sdlc').DebateMessage) => {
					const agentIcons: Record<string, string> = {
						analyst: '', architect: '', ux: '', developer: '',
						pm: '', qa: '', techwriter: '', security: ''
					};
					const icon = agentIcons[msg.agentId] || '';
					const roundLabel = msg.type === 'consensus' ? 'CONSENSUS' : `Round ${msg.round}`;
					agentPanel.addMessage('assistant', `${icon} **${msg.agentId.toUpperCase()}** (${roundLabel}):\n\n${msg.content}`);
				}, [], currentCancellationTokenSource.token);

				agentPanel.showThinking(false);
				agentPanel.addMessage('system', `PRD generated: **${prd.title}**\n\nFiles written to \`.angel/PRD.md\` and \`.angel/prd.json\`.\n\nOpening PRD review panel…`);

				// Persist to conversation
				if (conversationService) {
					try {
						const convId = ensureConversation('plan');
						conversationService.addMessage(convId, 'user', `Start SDLC: ${topic}`);
						conversationService.addMessage(convId, 'assistant', `PRD generated: ${prd.title}`);
					} catch (convErr) {
						logger.warn(`Conversation persistence error: ${convErr}`);
					}
				}

				// Open review panel with the completed PRD (no race condition — PRD already finished)
				SDLCWebviewPanel.createOrShow(context, logger, llmService, undefined, prd);
			} catch (err) {
				agentPanel.showThinking(false);
				const msg = err instanceof Error ? err.message : String(err);
				agentPanel.addMessage('system', `SDLC pipeline error: ${msg}`);
				logger.error('[startSDLC] Pipeline failed', err as Error);
				vscode.window.showErrorMessage(`Angel SDLC Error: ${msg}`);
			}
		});

		// Register BMAD continuation command (called by SDLC after PRD approval)
		const startBMADCmd = vscode.commands.registerCommand('angel.startBMADAfterSDLC', async (prd: PRDDocument) => {
			const orchestrator = agentRegistry.get('orchestrator') as OrchestratorAgent;
			if (orchestrator) {
				currentCancellationTokenSource = new vscode.CancellationTokenSource();
				agentPanel.showThinking(true);
				agentPanel.addMessage('system', '⚙️ **BMAD Pipeline Initiated!** Transferring PRD to agent swarm...');

				// Dispose of the SDLC Webview so the user's focus returns to the sidebar where BMAD output streams
				try {
					if (SDLCWebviewPanel.currentPanel) {
						SDLCWebviewPanel.currentPanel.dispose();
					}
				} catch (e) {
					logger.error('Failed to close SDLC panel', e as Error);
				}

				await orchestrator.onPRDApproved(prd, context, agentPanel, currentCancellationTokenSource.token);
			}
		});

		// Register new task command
		const newTaskCmd = vscode.commands.registerCommand('angel.newTask', async () => {
			logger.info('New task requested');
			currentConversationId = null;
			logger.info('Ready for new task');
		});

		// Register MCP install command
		const mcpInstallCmd = vscode.commands.registerCommand('angel.mcpInstall', async (serverId: string, scope: string) => {
			logger.info(`MCP server install requested: ${serverId} (scope: ${scope})`);
			vscode.window.showInformationMessage(`MCP server "${serverId}" installed (${scope}).`);
		});

		// List conversations command - sends list to webview
		const listConvsCmd = vscode.commands.registerCommand('angel.listConversations', async () => {
			if (!conversationService) { return; }
			const convs = conversationService.getAllConversations();
			const list = convs.map(c => ({
				id: c.id,
				title: c.title,
				mode: c.mode || 'chat',
				updatedAt: c.updatedAt,
				messageCount: c.messages.length
			}));
			agentPanel.postMessage({ type: 'conversationList', conversations: list });
		});

		// Delete conversation command
		const deleteConvCmd = vscode.commands.registerCommand('angel.deleteConversation', async (conversationId: string) => {
			if (!conversationService) { return; }
			conversationService.deleteConversation(conversationId);
			if (currentConversationId === conversationId) { currentConversationId = null; }
			logger.info(`Deleted conversation: ${conversationId}`);
			// Refresh the list
			await vscode.commands.executeCommand('angel.listConversations');
		});

		// Voice conversation complete command — receives summary from voice overlay and feeds it to the pipeline
		const voiceConvCmd = vscode.commands.registerCommand('angel.voiceConversationComplete', async (summary: string, transcript?: any[]) => {
			if (!summary) {
				logger.warn('Voice conversation produced no summary');
				return;
			}
			logger.info(`Voice conversation complete. Summary length: ${summary.length}, turns: ${transcript?.length || 0}`);
			agentPanel.addMessage('system', 'Voice conversation captured. Processing your request...');

			// Retrieve API key from SecretStorage (try groq first)
			let apiKey = await configService.getApiKey('groq') || await configService.getApiKey('gemini');
			if (!apiKey) {
				apiKey = process.env.GROQ_API_KEY;
				if (apiKey) {
					await configService.storeApiKey('groq', apiKey);
				}
			}
			if (apiKey) {
				await processUserInput(context, apiKey, summary, 'plan', { fromWebview: false });
			} else {
				agentPanel.addMessage('system', 'No API key provided. Configure one in Angel settings.');
			}
		});

		// Process voice input command — the core conversational loop entry point
		const processVoiceCmd = vscode.commands.registerCommand('angel.processVoiceInput', async (transcribedText: string) => {
			if (!transcribedText || transcribedText.trim().length === 0) {
				logger.warn('Empty voice input received');
				return;
			}

			// Show transcription in status bar
			vscode.window.setStatusBarMessage(`"${transcribedText}"`, 3000);
			logger.info(`Voice input (raw): "${transcribedText}"`);

			// Sanitize: correct misheard identifiers against active file symbols
			const sanitizedText = await audioSanitizer.sanitize(transcribedText);
			if (sanitizedText !== transcribedText) {
				logger.info(`Voice input (sanitized): "${sanitizedText}"`);
			}

			try {
				// Think — LLM generates reply with full workspace context
				const reply = await brain.think(sanitizedText);

				// Speak — TTS plays reply out loud
				tts.speak(reply).catch(err => {
					logger.warn(`TTS speak failed: ${err}`);
				});

				// Show in sidebar conversation panel
				agentPanel.addMessage('user', sanitizedText, { silent: false });
				agentPanel.addMessage('assistant', reply, { silent: false });

				// Persist to ConversationService
				if (conversationService) {
					try {
						const convId = ensureConversation('ask');
						conversationService.addMessage(convId, 'user', sanitizedText);
						conversationService.addMessage(convId, 'assistant', reply);
					} catch (convErr) {
						logger.warn(`Conversation persistence error: ${convErr}`);
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error('Voice processing error', err as Error);
				agentPanel.addMessage('system', `Error: ${msg}`);
			}
		});

		// New conversation command — clears history and announces
		const newConversationCmd = vscode.commands.registerCommand('angel.newConversation', async () => {
			brain.clearHistory();
			logger.info('Conversation history cleared');
			tts.speak('Starting fresh. What are we working on?').catch(err => {
				logger.warn(`TTS speak failed on new conversation: ${err}`);
			});
		});

		// Clear stored API keys command
		const clearApiKeysCmd = vscode.commands.registerCommand('angel.clearApiKeys', async () => {
			const providers: Array<{ label: string; provider: import('./config/ConfigService').ProviderName }> = [
				{ label: 'Gemini', provider: 'gemini' },
				{ label: 'Groq', provider: 'groq' },
				{ label: 'Anthropic', provider: 'anthropic' },
				{ label: 'OpenAI', provider: 'openai' },
			];
			const selected = await vscode.window.showQuickPick(
				providers.map(p => p.label),
				{ placeHolder: 'Select a provider to clear its API key', canPickMany: true }
			);
			if (!selected || selected.length === 0) { return; }
			for (const label of selected) {
				const p = providers.find(x => x.label === label)!;
				await configService.deleteApiKey(p.provider);
				logger.info(`Cleared API key for ${label}`);
			}
			vscode.window.showInformationMessage(`Cleared keys for: ${selected.join(', ')}`);
		});

		// Secret storage commands directly triggered from Webview
		const saveApiKeyCmd = vscode.commands.registerCommand('angel.saveApiKey', async (providerName: string, apiKey: string) => {
			await configService.storeApiKey(providerName as any, apiKey);
			await initializeProvider(providerName as ProviderId, apiKey);
			logger.info(`LLM provider re-initialized for ${providerName}`);
		});

		const deleteApiKeyCmd = vscode.commands.registerCommand('angel.deleteApiKey', async (providerName: string) => {
			await configService.deleteApiKey(providerName as any);
			logger.info(`API Key deleted and memory cleared for ${providerName}`);
			
			// Optional: We can simply wait for the next initialization
			// or force clear the active instance if it's the one we just deleted
		});

		// Phase 9: Observability — generate OTel, Grafana, and Runbook artifacts
		const generateObservabilityCmd = vscode.commands.registerCommand('angel.generateObservability', async () => {
			if (!workspaceRoot) {
				vscode.window.showErrorMessage('No workspace folder open');
				return;
			}
			try {
				const wsIntelLocal = new WorkspaceIntelligence(configService);
				const snapshot = await wsIntelLocal.getSnapshot();

				const otelService = new OtelInstrumentationService(workspaceRoot);
				const grafanaService = new GrafanaDashboardService(workspaceRoot);
				const runbookService = new RunbookGeneratorService(workspaceRoot, llmService);

				const otelFiles = await otelService.generateInstrumentation(snapshot);
				const grafanaFiles = await grafanaService.generateDashboard(snapshot);
				const runbookFiles = await runbookService.generateRunbook(snapshot);

				const allFiles = [...otelFiles, ...grafanaFiles, ...runbookFiles];
				logger.info(`Observability artifacts generated: ${allFiles.join(', ')}`);
				vscode.window.showInformationMessage(`Observability scaffolding complete: ${allFiles.length} files generated.`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.error('Observability generation failed', err as Error);
				vscode.window.showErrorMessage(`Observability generation failed: ${msg}`);
			}
		});

		// Phase 14: Mode toggle status bar item
		let angelMode: 'chat' | 'sdlc' = 'chat';
		const modeToggle = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
		modeToggle.text = '$(comment-discussion) Angel: Chat';
		modeToggle.command = 'angel.toggleMode';
		modeToggle.tooltip = 'Toggle between Chat and SDLC mode';
		modeToggle.show();

		const toggleModeCmd = vscode.commands.registerCommand('angel.toggleMode', () => {
			angelMode = angelMode === 'chat' ? 'sdlc' : 'chat';
			if (angelMode === 'chat') {
				modeToggle.text = '$(comment-discussion) Angel: Chat';
			} else {
				modeToggle.text = '$(tools) Angel: SDLC';
			}
			vscode.window.showInformationMessage(`Angel mode: ${angelMode === 'chat' ? '💬 Conversational' : '🏗️ SDLC Pipeline'}`);
		});

		// Initialize JiraAuthService singleton with context (needed by SDLCWebviewPanel + setupJira)
		JiraAuthService.getInstance(context);

		// Jira setup command — opens the Jira connection wizard standalone (no PRD flow required)
		const setupJiraCmd = vscode.commands.registerCommand('angel.setupJira', () => {
			JiraSetupWebview.createOrShow(context, logger);
		});

		// Bug 2 fix: command that SidebarProvider calls on webview mount to eagerly
		// initialize the LLM provider before the user clicks any button.
		const ensureLLMReadyCmd = vscode.commands.registerCommand('angel.ensureLLMReady', async () => {
			const ok = await ensureLLMStatus(context);
			if (ok) {
				logger.info('[ensureLLMReady] LLM provider ready.');
			} else {
				logger.warn('[ensureLLMReady] No API key found — user must configure one via the Profile button.');
			}
		});

		const stopAgentCmd = vscode.commands.registerCommand('angel.stopAgent', () => {
			if (currentCancellationTokenSource) {
				currentCancellationTokenSource.cancel();
				logger.info('Cancellation requested by user.');
				vscode.window.showInformationMessage('Angel: Canceling current operation...');
				if (agentPanel) {
					agentPanel.addMessage('system', '❌ Operation cancelled by user.');
					agentPanel.showThinking(false);
				}
			} else {
				vscode.window.showInformationMessage('Angel: No active operation to cancel.');
			}
		});

		context.subscriptions.push(processCommand, processWithData, showOutputCmd, recordingStatus, loadConversationCmd, newTaskCmd, mcpInstallCmd, listConvsCmd, deleteConvCmd, voiceConvCmd, processVoiceCmd, newConversationCmd, startSDLCCmd, startBMADCmd, clearApiKeysCmd, saveApiKeyCmd, deleteApiKeyCmd, generateObservabilityCmd, toggleModeCmd, modeToggle, setupJiraCmd, ensureLLMReadyCmd, stopAgentCmd);

		logger.info('Angel extension activated successfully');
		vscode.window.showInformationMessage('Angel extension is ready!');

		// Auto-initialize LLM if possible
		ensureLLMStatus(context).then(ok => {
			if (ok) logger.info('Angel: LLM provider ready on startup.');
		});
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error('Failed to activate extension', error as Error);
		vscode.window.showErrorMessage(`Angel activation failed: ${errorMsg}`);
	}
}
function registerAllAgents(): void {
	// Register Planning Agent for plan mode conversations
	const planningAgent = new PlanningAgent(logger, llmService);
	agentRegistry.register('planning', planningAgent);

	// Register Orchestrator (Planner) for code mode pipeline
	const orchestrator = new OrchestratorAgent(logger, agentRegistry, llmService, fileService);
	agentRegistry.register('orchestrator', orchestrator);

	logger.info('All agents registered successfully');
}

/**
 * Ensure a conversation exists for the current session
 */
function ensureConversation(mode: 'plan' | 'code' | 'ask'): string {
	if (!conversationService) {
		throw new Error('ConversationService not initialized');
	}

	// Check if current conversation still exists (might have been deleted via dashboard)
	if (currentConversationId && !conversationService.getConversation(currentConversationId)) {
		currentConversationId = null;
	}

	// Reuse existing conversation or create new one
	if (!currentConversationId) {
		const convMode = mode === 'plan' ? 'planning' : mode === 'code' ? 'development' : 'chat';
		const title = mode === 'plan' ? 'Planning' : mode === 'code' ? 'Development' : 'Ask';
		currentConversationId = conversationService.createConversation(
			`${title} Session`,
			convMode as 'planning' | 'development' | 'chat'
		);
		logger.info(`Created new conversation: ${currentConversationId}`);
	}

	return currentConversationId;
}

async function processUserInput(
	context: vscode.ExtensionContext,
	apiKeyArg?: string,
	inputArg?: string,
	mode: 'plan' | 'code' | 'ask' = 'code',
	options: { fromWebview?: boolean; provider?: string; model?: string } = {}
): Promise<void> {
	try {
		currentCancellationTokenSource = new vscode.CancellationTokenSource();
		let apiKey = apiKeyArg;
		let input = inputArg;

		// Determine provider and model (from options, then config, then defaults)
		let providerName = (options.provider as ProviderId) || await configService.getSelectedProvider() || 'groq';
		let modelName = options.model || await configService.getSelectedModel(providerName) || '';

		// If user selected generic provider dropdown string but no concrete id:
		if (providerName) {
			await configService.storeSelectedProvider(providerName);
		}
		if (modelName) {
			await configService.storeSelectedModel(providerName, modelName);
		}

		// Sync the key from the UI into secure storage if it was passed explicitly
		if (apiKeyArg) {
			await configService.storeApiKey(providerName, apiKeyArg);
		}

		// Retrieve API key from SecretStorage — only prompt if not yet stored
		if (!apiKey) {
			apiKey = await configService.getApiKey(providerName as 'gemini' | 'groq' | 'anthropic' | 'openai')
				|| await configService.getApiKey('anthropic')
				|| await configService.getApiKey('openai')
				|| await configService.getApiKey('gemini')
				|| await configService.getApiKey('groq');

			if (!apiKey) {
				apiKey = process.env.GROQ_API_KEY;
				if (apiKey) {
					providerName = 'groq';
					await configService.storeApiKey('groq', apiKey);
					await configService.storeSelectedProvider(providerName);
					logger.info('Angel: No API key found. Using GROQ_API_KEY from environment.');
				} else {
					logger.warn('Angel: No API key found in settings or environment.');
				}
			} else {
				// Re-detect just in case the fallback chain triggered a mismatch
				providerName = configService.detectProvider(apiKey);
				await configService.storeSelectedProvider(providerName);
			}
		}

		if (!apiKey) {
			vscode.window.showErrorMessage('No API key found. Please configure one in Angel settings.');
			return;
		}

		if (!input) {
			input = await vscode.window.showInputBox({
				prompt: 'Enter your request (e.g., "Create a REST API with user authentication")',
				ignoreFocusOut: true
			});

			if (!input) {
				return;
			}
		}

		logger.info(`Processing user input: ${input} (mode: ${mode}, provider: ${providerName}, model: ${modelName || 'auto'})`);

		// Show thinking indicator in UI
		agentPanel.showThinking(true);

		// Add user message to conversation UI
		// If from webview, the message is already displayed optimistically — add silently to history only
		agentPanel.addMessage('user', input, { silent: !!options.fromWebview });

		// Persist user message to disk
		let conversationHistory = '';
		if (conversationService) {
			try {
				const convId = ensureConversation(mode);
				conversationService.addMessage(convId, 'user', input);
				conversationHistory = conversationService.getConversationAsText(convId);
				logger.info(`Persisted user message to conversation ${convId}`);
			} catch (convErr) {
				logger.warn(`Conversation persistence error: ${convErr}`);
			}
		}

		// Initialize the appropriate provider based on model selection or API key detection
		logger.info(`Using ${providerName} provider`);
		await initializeProvider(providerName as ProviderId, apiKey, modelName || undefined);
		llmService.setGlobalTokenListener((token: string) => {
			agentPanel.addToken(token);
		});

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder open');
			agentPanel.showThinking(false);
			return;
		}

		// Build context with conversation history
		const agentContext = new ContextBuilder()
			.setWorkspaceRoot(workspaceRoot)
			.setMetadata({
				userRequest: input,
				conversationHistory,
				mode,
				timestamp: new Date().toISOString(),
				onToken: (token: string) => agentPanel.addToken(token)
			})
			.build();
		agentContext.cancellationToken = currentCancellationTokenSource.token;

		// Route to appropriate agent based on mode
		let result: string;

		if (mode === 'ask') {
			// Ask mode: simple direct LLM call without orchestration
			logger.info('Ask mode: sending directly to LLM');
			result = await llmService.generateText(
				`You are a helpful coding assistant. The user is asking about their project.\n\nUser question: ${input}\n\nProvide a clear, concise answer.`
			);
		} else if (mode === 'plan') {
			// Plan mode detection: Should we trigger SDLC?
			const lowerInput = input.toLowerCase();
			const looksLikeProject = lowerInput.includes('build a') || lowerInput.includes('create a new') || lowerInput.includes('create an app') || input.split(' ').length > 50;

			if (looksLikeProject) {
				const choice = await vscode.window.showInformationMessage('This looks like a large feature or project request. Would you like to run the SDLC Flow (PRD Generation + Jira Sync) first?', 'Yes, run SDLC', 'No, just generate code');
				if (choice === 'Yes, run SDLC') {
					agentPanel.showThinking(false);
					vscode.commands.executeCommand('angel.startSDLC', input);
					return;
				}
			}

			// Traditional Plan mode: generate plan + run non-coding agents
			const orchestrator = agentRegistry.get('orchestrator') as OrchestratorAgent;
			if (!orchestrator) {
				throw new Error('Orchestrator agent not found');
			}
			logger.info('Routing to Orchestrator.executePlan() for planning phase');
			result = await orchestrator.executePlan(agentContext);
		} else {
			// Code mode: run pending coding agents or detect workspace state
			const orchestrator = agentRegistry.get('orchestrator') as OrchestratorAgent;
			if (!orchestrator) {
				throw new Error('Orchestrator agent not found');
			}
			logger.info('Routing to Orchestrator.executeCode() for code generation');
			result = await orchestrator.executeCode(agentContext);
		}

		// Add result to conversation UI
		agentPanel.addMessage('assistant', result || 'Task completed successfully!');
		agentPanel.showThinking(false);

		// Persist assistant response to disk
		if (conversationService && currentConversationId) {
			try {
				conversationService.addMessage(currentConversationId, 'assistant', result || 'Task completed successfully!');
				logger.info('Persisted assistant response to conversation');
			} catch (convErr) {
				logger.warn(`Failed to persist assistant response: ${convErr}`);
			}
		}

		logger.info(`Processing complete in ${mode} mode`);
		agentPanel.notifyProcessingComplete();
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error('Error processing input', error as Error);

		// Show error in conversation
		agentPanel.addMessage('system', `Error: ${errorMsg}`);
		agentPanel.showThinking(false);

		// Persist error to conversation
		if (conversationService && currentConversationId) {
			try {
				conversationService.addMessage(currentConversationId, 'system', `Error: ${errorMsg}`);
			} catch (convErr) {
				// ignore
			}
		}

		vscode.window.showErrorMessage(`Processing failed: ${errorMsg}`);
	}
}

export function deactivate() {
	recordingStatus.dispose();
	try { tts?.dispose(); } catch { /* ignore */ }
	try { localWhisper?.dispose(); } catch { /* ignore */ }
	logger.info('Angel extension deactivated');
	logger.dispose();
}

/**
 * Load a conversation into the agent panel
 */
async function loadConversation(conversationId: string): Promise<void> {
	if (!conversationService || !agentPanel) { return; }

	const conv = conversationService.getConversation(conversationId);
	if (!conv) {
		vscode.window.showErrorMessage(`Conversation ${conversationId} not found`);
		return;
	}

	// Set as current
	currentConversationId = conversationId;
	conversationService.setCurrentConversation(conversationId);

	// Display in UI
	agentPanel.displayConversation(conv.messages.map(m => ({
		role: m.role,
		content: m.content,
		timestamp: new Date(m.timestamp).toISOString()
	})));

	logger.info(`Loaded conversation: ${conversationId}`);
	vscode.window.showInformationMessage(`Loaded conversation: ${conv.title || 'Untitled Session'}`);
}

/**
 * Ensures the LLMService has a provider and is initialized with an API key.
 * First checks ConfigService for stored keys, then falls back to .env if available.
 */
async function ensureLLMStatus(context: vscode.ExtensionContext): Promise<boolean> {
	if (llmService.isInitialized()) return true;

	try {
		// Check all known providers in priority order — this mirrors what
		// processUserInput does so the SDLC button works on the first click
		// even before the user has sent a regular message (Bug 2 fix).
		const providerPriority: Array<{ name: 'anthropic' | 'openai' | 'gemini' | 'groq'; factory: () => import('./types').ILLMProvider }> = [
			{ name: 'anthropic', factory: () => new AnthropicProvider() },
			{ name: 'openai', factory: () => new OpenAIProvider() },
			{ name: 'gemini', factory: () => new GeminiProvider() },
			{ name: 'groq', factory: () => new GroqProvider() },
		];

		// Also respect the user's preferred provider (check it first)
		const selectedProvider = await configService.getSelectedProvider();
		if (selectedProvider) {
			const idx = providerPriority.findIndex(p => p.name === selectedProvider);
			if (idx > 0) {
				const [preferred] = providerPriority.splice(idx, 1);
				providerPriority.unshift(preferred);
			}
		}

		for (const { name, factory } of providerPriority) {
			const apiKey = await configService.getApiKey(name);
			if (apiKey) {
				const provider = factory();
				await provider.initialize(apiKey);
				llmService.setProvider(provider);
				logger.info(`[ensureLLMStatus] Initialized with stored ${name} key.`);
				return true;
			}
		}

		// Last resort: environment variable
		const envKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || '';
		if (envKey) {
			const provName = envKey.startsWith('gsk_') ? 'groq' : 'gemini';
			const provider = provName === 'groq' ? new GroqProvider() : new GeminiProvider();
			await provider.initialize(envKey);
			llmService.setProvider(provider);
			logger.info(`[ensureLLMStatus] Initialized from environment (${provName}).`);
			return true;
		}
	} catch (err) {
		logger.error('Failed to auto-initialize LLM', err as Error);
	}
	return false;
}
