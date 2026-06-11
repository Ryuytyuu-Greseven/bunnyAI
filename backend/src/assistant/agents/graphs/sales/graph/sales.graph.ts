import { StateGraph, MemorySaver } from '@langchain/langgraph';
import { SalesStateAnnotation, SalesState } from '../state/sales.state';
import * as Nodes from '../node/sales.nodes';

function routeFromRouter(state: SalesState) {
  return state.routeDestination as any;
}

function checkDiscovery(state: SalesState) {
  if (state.companyName && state.industry && state.painPoints) {
    return 'Presentation_Node';
  }
  return '__end__';
}

function checkClosing(state: SalesState) {
  if (state.meetingScheduled !== null) {
    if (state.meetingScheduled) {
      return '__end__'; // Deal won/Meeting scheduled!
    } else {
      return 'Graceful_Rejection_Node'; // Deal lost
    }
  }
  return '__end__';
}

const workflow = new StateGraph(SalesStateAnnotation)
  .addNode('Semantic_Router_Node', Nodes.Semantic_Router_Node)
  .addNode('Greeting_Pitch_Node', Nodes.Greeting_Pitch_Node)
  .addNode('Discovery_Node', Nodes.Discovery_Node)
  .addNode('Presentation_Node', Nodes.Presentation_Node)
  .addNode('Objection_Handling_Node', Nodes.Objection_Handling_Node)
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
  
  .addConditionalEdges('Discovery_Node', checkDiscovery)
  
  .addEdge('Presentation_Node', '__end__')
  
  .addEdge('Objection_Handling_Node', '__end__')
  
  .addConditionalEdges('Closing_Node', checkClosing)

  // Escape Hatches
  .addEdge('FAQ_RAG_Node', '__end__')
  .addEdge('Human_Handoff_Node', '__end__')
  .addEdge('Silence_Recovery_Node', '__end__')
  .addEdge('Graceful_Rejection_Node', '__end__');

export const salesCheckpointer = new MemorySaver();
export const salesGraph = workflow.compile({ checkpointer: salesCheckpointer });
