/**
 * Abstract base class for all agents
 */

import { IAgent, IAgentContext } from '../../types';

export abstract class BaseAgent implements IAgent {
  abstract name: string;
  abstract description: string;

  constructor(protected logger: any) {}

  abstract execute(context: IAgentContext): Promise<string>;

  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.logger[level](`[${this.name}] ${message}`);
  }

  protected validateContext(context: IAgentContext): boolean {
    if (!context.workspaceRoot) {
      this.log('Missing workspaceRoot in context', 'error');
      return false;
    }
    return true;
  }
}
