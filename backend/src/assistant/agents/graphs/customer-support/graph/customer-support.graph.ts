import { StateGraph, MemorySaver } from '@langchain/langgraph';
import { CustomerSupportStateAnnotation, CustomerSupportState } from '../state/customer-support.state';
import * as Nodes from '../node/customer-support.nodes';

function routeFromRouter(state: CustomerSupportState) {
  return state.routeDestination as any;
}

// After Order/Product/FAQ nodes: chain to handoff if customer asked for a live agent
function checkHumanRequest(state: CustomerSupportState) {
  if (state.wantsHumanAgent) {
    return 'Human_Handoff_Node';
  }
  return '__end__';
}

const workflow = new StateGraph(CustomerSupportStateAnnotation)
  .addNode('Semantic_Router_Node', Nodes.Semantic_Router_Node)
  .addNode('Greeting_Node', Nodes.Greeting_Node)
  .addNode('Order_Inquiry_Node', Nodes.Order_Inquiry_Node)
  .addNode('Product_Inquiry_Node', Nodes.Product_Inquiry_Node)
  .addNode('FAQ_RAG_Node', Nodes.FAQ_RAG_Node)
  .addNode('Human_Handoff_Node', Nodes.Human_Handoff_Node)
  .addNode('Graceful_Close_Node', Nodes.Graceful_Close_Node)
  .addNode('Silence_Recovery_Node', Nodes.Silence_Recovery_Node)

  // Every turn enters the semantic router
  .addEdge('__start__', 'Semantic_Router_Node')

  // Router dispatches to the appropriate node
  .addConditionalEdges('Semantic_Router_Node', routeFromRouter)

  // Initial greeting — wait for customer to state their issue
  .addEdge('Greeting_Node', '__end__')

  // Issue nodes: chain to handoff if customer asked for a live agent mid-conversation
  .addConditionalEdges('Order_Inquiry_Node', checkHumanRequest)
  .addConditionalEdges('Product_Inquiry_Node', checkHumanRequest)
  .addConditionalEdges('FAQ_RAG_Node', checkHumanRequest)

  // Terminal nodes
  .addEdge('Human_Handoff_Node', '__end__')
  .addEdge('Graceful_Close_Node', '__end__')
  .addEdge('Silence_Recovery_Node', '__end__');

export const customerSupportCheckpointer = new MemorySaver();
export const customerSupportGraph = workflow.compile({
  checkpointer: customerSupportCheckpointer,
});
