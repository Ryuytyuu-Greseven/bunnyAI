import { StateGraph, MemorySaver } from '@langchain/langgraph';
import { SalesStateAnnotation, SalesState } from '../state/sales.state';
import * as Nodes from '../node/sales.nodes';

function routeFromRouter(state: SalesState) {
  return state.routeDestination as any;
}

// After Budget_Discovery_Node: if we captured a budget, immediately fetch and list properties
function checkBudgetDiscovery(state: SalesState) {
  if (state.budgetMin !== null || state.budgetMax !== null) {
    return 'Property_Listing_Node';
  }
  return '__end__'; // still missing budget — wait for next user turn
}

// After Property_Detail_Node: if customer expressed purchase intent, proceed to handoff
function checkPurchaseIntent(state: SalesState) {
  if (state.purchaseIntentPropertyId) {
    return 'Human_Handoff_Node';
  }
  return '__end__';
}

const workflow = new StateGraph(SalesStateAnnotation)
  .addNode('Semantic_Router_Node', Nodes.Semantic_Router_Node)
  .addNode('Greeting_Pitch_Node', Nodes.Greeting_Pitch_Node)
  .addNode('Budget_Discovery_Node', Nodes.Budget_Discovery_Node)
  .addNode('Property_Listing_Node', Nodes.Property_Listing_Node)
  .addNode('Property_Detail_Node', Nodes.Property_Detail_Node)
  .addNode('Objection_Handling_Node', Nodes.Objection_Handling_Node)
  .addNode('Human_Handoff_Node', Nodes.Human_Handoff_Node)
  .addNode('Graceful_Rejection_Node', Nodes.Graceful_Rejection_Node)
  .addNode('Silence_Recovery_Node', Nodes.Silence_Recovery_Node)

  // Every turn starts at the semantic router
  .addEdge('__start__', 'Semantic_Router_Node')

  // Router dispatches to the appropriate node
  .addConditionalEdges('Semantic_Router_Node', routeFromRouter)

  // Greeting: wait for customer response
  .addEdge('Greeting_Pitch_Node', '__end__')

  // Budget Discovery: if budget captured, chain directly into property listing
  .addConditionalEdges('Budget_Discovery_Node', checkBudgetDiscovery)

  // Property listing: present options, wait for customer to pick one
  .addEdge('Property_Listing_Node', '__end__')

  // Property detail: if purchase intent detected, chain to handoff
  .addConditionalEdges('Property_Detail_Node', checkPurchaseIntent)

  // Escape hatches
  .addEdge('Objection_Handling_Node', '__end__')
  .addEdge('Human_Handoff_Node', '__end__')
  .addEdge('Graceful_Rejection_Node', '__end__')
  .addEdge('Silence_Recovery_Node', '__end__');

export const salesCheckpointer = new MemorySaver();
export const salesGraph = workflow.compile({ checkpointer: salesCheckpointer });
