/**
 * Configuration service for extension settings and secure API key storage.
 * API keys are stored in VSCode SecretStorage (encrypted OS keychain) — never in plaintext settings.
 */

import * as vscode from 'vscode';
import { IConfigService } from '../types';

export type ProviderName = 'gemini' | 'groq' | 'anthropic' | 'openai';

const SECRET_KEY_PREFIX = 'angel.apikey.';

function getModelKey(provider: ProviderName): string {
  return `angel_model_${provider}`;
}

function getApiKeyKey(provider: ProviderName): string {
  return `${SECRET_KEY_PREFIX}${provider}`;
}

export class ConfigService implements IConfigService {
  private readonly configKey = 'angel';
  private secrets: vscode.SecretStorage | null = null;

  /**
   * Wire in the extension context's SecretStorage.
   * Must be called during activation before any getApiKey/storeApiKey calls.
   */
  setSecretStorage(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  // ─── API Key (SecretStorage) ─────────────────────────────────────────────

  /**
   * Retrieve a stored API key from SecretStorage.
   * Returns undefined if no key has been stored yet.
   */
  async getApiKey(provider: ProviderName): Promise<string | undefined> {
    if (!this.secrets) { return undefined; }
    return this.secrets.get(getApiKeyKey(provider));
  }

  /**
   * Persist an API key to SecretStorage (encrypted OS keychain).
   */
  async storeApiKey(provider: ProviderName, key: string): Promise<void> {
    if (!this.secrets) {
      throw new Error('SecretStorage not initialized. Call setSecretStorage() first.');
    }
    await this.secrets.store(getApiKeyKey(provider), key);
  }

  /**
   * Remove a stored API key from SecretStorage.
   */
  async deleteApiKey(provider: ProviderName): Promise<void> {
    if (!this.secrets) { return; }
    await this.secrets.delete(`${SECRET_KEY_PREFIX}${provider}`);
  }

  /**
   * Detect which provider a key belongs to based on its prefix.
   */
  detectProvider(apiKey: string): ProviderName {
    if (apiKey.startsWith('AIza')) { return 'gemini'; }
    if (apiKey.startsWith('sk-ant')) { return 'anthropic'; }
    if (apiKey.startsWith('sk-')) { return 'openai'; }
    if (apiKey.startsWith('gsk_')) { return 'groq'; }
    // Default fallback — for newer Gemini or Groq keys without a known prefix,
    // the UI dropdown should have already set the provider explicitly.
    return 'groq';
  }

  /** Persist the user's selected provider identifier (e.g. 'anthropic', 'openai'). */
  async storeSelectedProvider(provider: ProviderName): Promise<void> {
    if (!this.secrets) { return; }
    await this.secrets.store('angel_selected_provider', provider);
  }

  /** Retrieve the persisted provider identifier, or undefined if not set. */
  async getSelectedProvider(): Promise<ProviderName | undefined> {
    if (!this.secrets) { return undefined; }
    return (await this.secrets.get('angel_selected_provider')) as ProviderName | undefined;
  }

  /** Persist the user's selected model name for a given provider. */
  async storeSelectedModel(provider: ProviderName, model: string): Promise<void> {
    if (!this.secrets) { return; }
    await this.secrets.store(getModelKey(provider), model);
  }

  /** Retrieve the persisted model name for a provider, or undefined if not set. */
  async getSelectedModel(provider: ProviderName): Promise<string | undefined> {
    if (!this.secrets) { return undefined; }
    return this.secrets.get(getModelKey(provider));
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  get<T>(key: string): T | undefined {
    const config = vscode.workspace.getConfiguration(this.configKey);
    return config.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configKey);
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }

  getAll(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration(this.configKey);
    return config;
  }
}
