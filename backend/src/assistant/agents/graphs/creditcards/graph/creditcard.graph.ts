import { StateGraph } from '@langchain/langgraph';
import { CreditCardStateAnnotation, CreditCardState } from '../state/creditcard.state';
import * as Nodes from '../node/creditcard.nodes';

function routeFromRouter(state: CreditCardState) {
  return state.routeDestination as any;
}

function checkQualification(state: CreditCardState) {
  if (state.annualIncome !== null) {
    if (state.annualIncome >= 30000) {
      return 'Identity_Collection_Node';
    } else {
      return 'Graceful_Rejection_Node';
    }
  }
  return '__end__';
}

function checkIdentity(state: CreditCardState) {
  if (state.fullName && state.address && state.last4SSN) {
    return 'API_Execution_Node';
  }
  return '__end__';
}

function checkAPIResult(state: CreditCardState) {
  if (state.preApprovalStatus === 'approved') {
    return 'Closing_Node';
  } else {
    return 'Graceful_Rejection_Node';
  }
}

const workflow = new StateGraph(CreditCardStateAnnotation)
  .addNode('Semantic_Router_Node', Nodes.Semantic_Router_Node)
  .addNode('Greeting_Pitch_Node', Nodes.Greeting_Pitch_Node)
  .addNode('Qualification_Node', Nodes.Qualification_Node)
  .addNode('Identity_Collection_Node', Nodes.Identity_Collection_Node)
  .addNode('API_Execution_Node', Nodes.API_Execution_Node)
  .addNode('Closing_Node', Nodes.Closing_Node)
  .addNode('FAQ_RAG_Node', Nodes.FAQ_RAG_Node)
  .addNode('Human_Handoff_Node', Nodes.Human_Handoff_Node)
  .addNode('Silence_Recovery_Node', Nodes.Silence_Recovery_Node)
  .addNode('Graceful_Rejection_Node', Nodes.Graceful_Rejection_Node)

  // Start always passes through the Semantic Router
  .addEdge('__start__', 'Semantic_Router_Node')

  // Router decides where to go
  .addConditionalEdges('Semantic_Router_Node', routeFromRouter)

  // Funnel Nodes (End implies waiting for user input, looping back to Start->Router on next turn)
  .addEdge('Greeting_Pitch_Node', '__end__')
  
  .addConditionalEdges('Qualification_Node', checkQualification)
  
  .addConditionalEdges('Identity_Collection_Node', checkIdentity)
  
  .addConditionalEdges('API_Execution_Node', checkAPIResult)
  
  .addEdge('Closing_Node', '__end__')

  // Escape Hatches
  .addEdge('FAQ_RAG_Node', '__end__')
  .addEdge('Human_Handoff_Node', '__end__')
  .addEdge('Silence_Recovery_Node', '__end__')
  .addEdge('Graceful_Rejection_Node', '__end__');

export const creditCardsGraph = workflow.compile();
