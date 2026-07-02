/**
 * Workflow execution engine
 */

import { IWorkflow, IAgentContext } from '../../types';
import { AgentRegistry } from '../../agents';

export class WorkflowEngine {
  constructor(private agentRegistry: AgentRegistry) {}

  async executeWorkflow(workflow: IWorkflow): Promise<string[]> {
    const results: string[] = [];

    for (const step of workflow.steps) {
      const agent = this.agentRegistry.get(step.agentName);
      if (!agent) {
        throw new Error(`Agent '${step.agentName}' not found in registry`);
      }

      const result = await agent.execute(workflow.context);
      results.push(result);
    }

    return results;
  }
}
