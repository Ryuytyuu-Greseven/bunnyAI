import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { AgentState } from '../state/state';
import { getHrPolicyTool, getUserLeaveBalanceTool } from '../tools/hr-tool';
import { createAgent } from 'langchain';
import { llmInstance } from '../llms/google.llm';
import { Logger } from '@nestjs/common';
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import * as fs from 'fs/promises';
import * as path from 'path';

// TODO-1: Lets use the MCP later
// const client = new MultiServerMCPClient({
//   mcpServers:
//   {
//     'weather-server': {
//       transport: 'sse',
//       url: "http://localhost:8000/mcp",
//       automaticSSEFallback: false,
//     }
//   }
// })

const logger = new Logger();
const promptCache = new Map<string, string>();

async function loadBusinessPrompt(business: string): Promise<string> {
  const normalized = business.trim().toLowerCase();
  if (promptCache.has(normalized)) {
    return promptCache.get(normalized)!;
  }

  let promptFilename = 'customer_success.agent.md';
  if (normalized === 'sales') {
    promptFilename = 'sales.agent.md';
  } else if (normalized === 'insurance') {
    promptFilename = 'insurance.agent.md';
  } else if (normalized === 'customer support') {
    promptFilename = 'customer_support.agent.md';
  } else if (normalized === 'customer success') {
    promptFilename = 'customer_success.agent.md';
  } else if (normalized === 'implementation') {
    promptFilename = 'implementation.agent.md';
  } else if (normalized === 'alerting') {
    promptFilename = 'alerting.agent.md';
  } else if (normalized === 'hiring') {
    promptFilename = 'hiring_screening.agent.md';
  }

  try {
    const promptsDir = path.join(__dirname, '..', 'prompts');
    const promptFilePath = path.join(promptsDir, promptFilename);
    const content = await fs.readFile(promptFilePath, 'utf-8');
    promptCache.set(normalized, content);
    return content;
  } catch (e) {
    console.error(`Failed to read prompt file ${promptFilename}:`, e);
    return '';
  }
}

async function runBusinessAgentNode(business: string, state: AgentState, config?: RunnableConfig) {
  logger.log(`[Agent Node - ${business}] Executing agent logic...`);
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  const query = state.userQuery || (lastMessage ? String(lastMessage.content) : '');
  const term = query.toLowerCase();

  const hasToolRun = messages.some((m: BaseMessage) => m instanceof ToolMessage);

  // const sharedAiService = config?.configurable?.sharedAiService;
  const userConfig = config?.configurable?.userConfig;

  let promptQuery = query;
  const toolMsg = messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
  const toolContent = toolMsg?.content || '';
  promptQuery = `User Query: ${query}\n\nTool/Knowledge Source Output:\n${toolContent}\n\nPlease draft the final response to the user incorporating this tool result context according to the system rules (same language, language bracket prefix, etc.).`;

  try {
    // TODO-1: Lets focus later
    // logger.log('Requesting MCP Tools');
    // const tools = await client.getTools();
    // logger.log('Loaded MCP Tools');

    logger.log('Loading Business Prompt');
    const businessPromptContent = await loadBusinessPrompt(business);
    logger.log('Loaded Business Prompt');

    const businessInstruction = `You are representing the ${business} department. Your answers and tone should reflect this context.`;
    const systemPrompt = `${businessInstruction}\n\n${businessPromptContent}`;

    const agent = createAgent({
      model: llmInstance,
      systemPrompt: systemPrompt,
      tools: [getHrPolicyTool, getUserLeaveBalanceTool],
    });

    const responseStream = await agent.stream({ messages: [{ role: 'human', content: promptQuery }] });
    // const responseStream2 = await agent.stream({ messages: [{ role: 'human', content: promptQuery }] }, { streamMode: ['messages'] });

    let fullResponse = '';
    for await (const chunk of responseStream) {
      logger.log('Stream Started');
      if (chunk.model_request && chunk.model_request.messages) {
        const message = chunk.model_request.messages[0];
        if (message && message.content) {
          fullResponse += message.content;
        }
      }
    }
    // let fullResponse2 = '';

    // for await (const [chunkmessageChunk, metadata] of responseStream) {
    //   logger.log('Stream Started 2');
    //   if (metadata[0].content) {
    //     const message = metadata[0].content;
    //     fullResponse += message;
    //     yield message;
    //   }
    // }
    // console.log("fullResponse2", fullResponse);

    return {
      messages: [
        new AIMessage({
          content: fullResponse.trim(),
        }),
      ],
    };
  } catch (err) {
    console.error(`[Agent Node - ${business}] Error calling Gemini in LangGraph node:`, err);
    return {
      messages: [
        new AIMessage({
          content: `[en]: I'm sorry, I encountered an issue processing your request: ${err.message || err}`,
        }),
      ],
    };
  }
}

export async function agentNode(state: AgentState, config?: RunnableConfig) {
  const business = state.business || config?.configurable?.userConfig?.business || 'Customer Success';
  return runBusinessAgentNode(business, state, config);
}

export async function salesAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Sales', state, config);
}

export async function insuranceAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Insurance', state, config);
}

export async function customerSupportAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Customer Support', state, config);
}

export async function customerSuccessAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Customer Success', state, config);
}

export async function implementationAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Implementation', state, config);
}

export async function alertingAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Alerting', state, config);
}

export async function hiringAgentNode(state: AgentState, config?: RunnableConfig) {
  return runBusinessAgentNode('Hiring', state, config);
}

export async function actionNode(state: AgentState) {
  console.log('[Action Node] Executing tool calls...');
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1] as AIMessage;
  const toolCalls = lastMessage?.tool_calls || [];

  const toolUpdates: BaseMessage[] = [];
  for (const call of toolCalls) {
    if (call.name === 'getHrPolicy') {
      const result = await getHrPolicyTool.invoke(call.args as any);
      toolUpdates.push(
        new ToolMessage({
          content: String(result),
          tool_call_id: call.id || '',
          name: call.name,
        }),
      );
    } else if (call.name === 'getUserLeaveBalance') {
      const result = await getUserLeaveBalanceTool.invoke(call.args as any);
      const resultStr = typeof result === 'object' ? JSON.stringify(result) : String(result);
      toolUpdates.push(
        new ToolMessage({
          content: resultStr,
          tool_call_id: call.id || '',
          name: call.name,
        }),
      );
    }
  }

  return {
    messages: toolUpdates,
  };
}
