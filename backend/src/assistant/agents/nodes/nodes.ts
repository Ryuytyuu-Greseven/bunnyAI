import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { AgentState } from '../state/state';
import { getHrPolicyTool, getUserLeaveBalanceTool } from '../tools/hr-tool';
import { createAgent } from 'langchain';
import { llmInstance } from '../llms/google.llm';
import { Logger } from '@nestjs/common';
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const client = new MultiServerMCPClient({
  mcpServers:
  {
    'weather-server': {
      transport: 'sse',
      url: "http://localhost:8000/mcp",
      automaticSSEFallback: false,
    }
  }
})

const logger = new Logger();
export async function agentNode(state: AgentState, config?: RunnableConfig) {
  console.log('[Agent Node] Executing agent logic...');
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  const query = state.userQuery || (lastMessage ? String(lastMessage.content) : '');
  const term = query.toLowerCase();

  const hasToolRun = messages.some((m: BaseMessage) => m instanceof ToolMessage);

  // Generate real agent response (using tool result context if tool has run)
  console.log('[Agent Node] Decision: Generating real LLM response...');

  // const sharedAiService = config?.configurable?.sharedAiService;
  const userConfig = config?.configurable?.userConfig;

  let promptQuery = query;
  const toolMsg = messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
  const toolContent = toolMsg?.content || '';
  promptQuery = `User Query: ${query}\n\nTool/Knowledge Source Output:\n${toolContent}\n\nPlease draft the final response to the user incorporating this tool result context according to the system rules (same language, language bracket prefix, etc.).`;

  try {
    const tools = await client.getTools();
    const agent = createAgent({
      model: llmInstance,
      systemPrompt: state.systemInstruction || userConfig?.systemInstruction || '',
      tools: [getHrPolicyTool, getUserLeaveBalanceTool, ...tools],
    });

    const responseStream = await agent.stream({ messages: [{ role: 'human', content: promptQuery }] });

    let fullResponse = '';
    for await (const chunk of responseStream) {
      // console.log('Response stream', chunk);

      if (chunk.model_request && chunk.model_request.messages) {
        const message = chunk.model_request.messages[0];
        // Check if the message contains streamable text content
        if (message && message.content) {
          fullResponse += message.content;
        }
      }
    }

    // logger.log(`Full response: "${fullResponse}"`);
    return {
      // messages: responseStream.messages,
      messages: [
        new AIMessage({
          content: fullResponse.trim(),
        }),
      ],
    };
  } catch (err) {
    console.error('[Agent Node] Error calling Gemini in LangGraph node:', err);
    return {
      messages: [
        new AIMessage({
          content: `[en]: I'm sorry, I encountered an issue processing your request: ${err.message || err}`,
        }),
      ],
    };
  }
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
