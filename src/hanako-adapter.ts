import type {
  AgentCallOptions,
  AgentCallResult,
  CouncilAgentExecutor
} from "./types.js";

export interface HanakoWorkflowHostApi {
  agent<T>(prompt: string, options: {
    label?: string;
    model?: string;
    agentType?: string;
    access?: "read" | "write";
    schema?: Record<string, unknown>;
  }): Promise<T>;
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<T | null>>;
}

/**
 * Thin adapter over HanaAgent's existing workflow host API.
 * Token accounting remains owned by HanaAgent's UsageLedger/workflow budget.
 */
export function createHanakoCouncilExecutor(host: HanakoWorkflowHostApi): CouncilAgentExecutor {
  return {
    async call<T>(prompt: string, options: AgentCallOptions): Promise<AgentCallResult<T>> {
      const value = await host.agent<T>(prompt, {
        label: options.label,
        ...(options.model ? { model: options.model } : {}),
        ...(options.agentType ? { agentType: options.agentType } : {}),
        access: options.access,
        schema: options.schema
      });
      return { value };
    },
    parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<T | null>> {
      return host.parallel(tasks);
    }
  };
}
