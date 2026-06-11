import { StateGraph, MemorySaver } from '@langchain/langgraph';
import { AlertingStateAnnotation, AlertingState } from '../state/alerting.state';
import * as Nodes from '../node/alerting.nodes';

function routeFromRouter(state: AlertingState) {
  return state.routeDestination as any;
}

function checkIdentity(state: AlertingState) {
  if (state.identityConfirmed === true) return 'Due_Notice_Node';
  if (state.identityConfirmed === false) return 'Graceful_Closure_Node';
  return '__end__';
}

function checkPaymentStatus(state: AlertingState) {
  if (state.alreadyPaid === true) return 'Apology_Closure_Node';
  if (state.alreadyPaid === false) return 'Payment_Guide_Node';
  return '__end__';
}

const workflow = new StateGraph(AlertingStateAnnotation)
  .addNode('Semantic_Router_Node', Nodes.Semantic_Router_Node)
  .addNode('Greeting_Identity_Node', Nodes.Greeting_Identity_Node)
  .addNode('Due_Notice_Node', Nodes.Due_Notice_Node)
  .addNode('Payment_Guide_Node', Nodes.Payment_Guide_Node)
  .addNode('Apology_Closure_Node', Nodes.Apology_Closure_Node)
  .addNode('Sign_Off_Node', Nodes.Sign_Off_Node)
  .addNode('Human_Handoff_Node', Nodes.Human_Handoff_Node)
  .addNode('Silence_Recovery_Node', Nodes.Silence_Recovery_Node)
  .addNode('Graceful_Closure_Node', Nodes.Graceful_Closure_Node)

  .addEdge('__start__', 'Semantic_Router_Node')
  .addConditionalEdges('Semantic_Router_Node', routeFromRouter)

  // Identity gate: confirmed → deliver notice, denied → close
  .addConditionalEdges('Greeting_Identity_Node', checkIdentity)

  // Due notice waits for customer to respond on the next turn
  .addEdge('Due_Notice_Node', '__end__')

  // Payment status check handled by router routing to these nodes directly
  // Payment_Guide and Apology both chain to Sign_Off in the same turn
  .addEdge('Payment_Guide_Node', 'Sign_Off_Node')
  .addEdge('Apology_Closure_Node', 'Sign_Off_Node')
  .addEdge('Sign_Off_Node', '__end__')

  // Escape hatches
  .addEdge('Human_Handoff_Node', '__end__')
  .addEdge('Silence_Recovery_Node', '__end__')
  .addEdge('Graceful_Closure_Node', '__end__');

export const alertingCheckpointer = new MemorySaver();
export const alertingGraph = workflow.compile({ checkpointer: alertingCheckpointer });
