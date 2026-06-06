import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { AgentState } from '../state/state';
import { getHrPolicyTool, getUserLeaveBalanceTool } from '../tools/hr-tool';

export async function agentNode(state: AgentState, config?: RunnableConfig) {
  console.log('[Agent Node] Executing agent logic...');
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  const query = state.userQuery || (lastMessage ? String(lastMessage.content) : '');
  const term = query.toLowerCase();

  const hasToolRun = messages.some((m: BaseMessage) => m instanceof ToolMessage);

  // If user is asking about leave balance and we haven't run the tool yet
  if (
    (term.includes('balance') || term.includes('how many leaves') || (term.includes('leave') && (term.includes('left') || term.includes('remaining') || term.includes('have')))) &&
    !hasToolRun
  ) {
    console.log('[Agent Node] Decision: Invoking tool "getUserLeaveBalance"');
    return {
      messages: [
        new AIMessage({
          content: 'Let me check your leave balance.',
          tool_calls: [
            {
              name: 'getUserLeaveBalance',
              args: {},
              id: 'call_leave_balance_id',
              type: 'tool_call',
            },
          ],
        }),
      ],
    };
  }

  // If user is asking about HR policy topics and we haven't run the tool yet
  if (
    (term.includes('leave') || term.includes('payroll') || term.includes('pay') || term.includes('benefit') || term.includes('holiday') || term.includes('hr') || term.includes('policy')) &&
    !hasToolRun
  ) {
    console.log('[Agent Node] Decision: Invoking tool "getHrPolicy"');
    return {
      messages: [
        new AIMessage({
          content: 'Let me look up the HR policy guidelines.',
          tool_calls: [
            {
              name: 'getHrPolicy',
              args: { policyName: query },
              id: 'call_hr_policy_id',
              type: 'tool_call',
            },
          ],
        }),
      ],
    };
  }

  // Generate real agent response (using tool result context if tool has run)
  console.log('[Agent Node] Decision: Generating real LLM response...');
  
  const sharedAiService = config?.configurable?.sharedAiService;
  const userConfig = config?.configurable?.userConfig;

  if (!sharedAiService) {
    console.warn('[Agent Node] SharedAiService not found in config.configurable. Falling back to static response.');
    return {
      messages: [
        new AIMessage({
          content: `[en]: Hello, I am Lyre AI. I received your request: "${query}". (Service Offline)`,
        }),
      ],
    };
  }

  let promptQuery = query;
  if (hasToolRun) {
    const toolMsg = messages.find((m: BaseMessage) => m instanceof ToolMessage) as ToolMessage;
    const toolContent = toolMsg?.content || '';
    promptQuery = `User Query: ${query}\n\nTool/Knowledge Source Output:\n${toolContent}\n\nPlease draft the final response to the user incorporating this tool result context according to the system rules (same language, language bracket prefix, etc.).`;
  }

  try {
    const responseStream = await sharedAiService.generateResponseStream(
      promptQuery,
      {
        ...userConfig,
        systemInstruction: state.systemInstruction || userConfig?.systemInstruction || '',
      },
    );

    let fullResponse = '';
    for await (const chunk of responseStream) {
      fullResponse += chunk.text || '';
    }

    return {
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
