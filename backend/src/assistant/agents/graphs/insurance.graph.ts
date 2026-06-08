import { StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from '../state/state';
import { insuranceAgentNode as agentNode, actionNode } from '../nodes/nodes';
import { AIMessage } from '@langchain/core/messages';

function shouldContinue(state: AgentState): 'action' | '__end__' {
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'action';
  }
  return '__end__';
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode('agent', agentNode)
  .addNode('action', actionNode)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue, {
    action: 'action',
    __end__: '__end__',
  })
  .addEdge('action', 'agent');

export const insuranceGraph = workflow.compile();
