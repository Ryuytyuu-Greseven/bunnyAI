import { StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from '../state/state';
import { agentNode, actionNode } from '../nodes/nodes';
import { AIMessage } from '@langchain/core/messages';

// Route logic based on whether a tool call is present in the AIMessage
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

export const agentGraph = workflow.compile();

export * from './sales/graph/sales.graph';
export * from './insurance.graph';
export * from './customer-support.graph';
export * from './customer-success.graph';
export * from './implementation.graph';
export * from './alerting.graph';
export * from './hiring.graph';
export * from './creditcards/graph/creditcard.graph';
