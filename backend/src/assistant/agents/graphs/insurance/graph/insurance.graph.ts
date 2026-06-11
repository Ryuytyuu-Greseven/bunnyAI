import { StateGraph, MemorySaver } from '@langchain/langgraph';
import { InsuranceStateAnnotation, InsuranceState } from '../state/insurance.state';
import * as Nodes from '../node/insurance.nodes';

function routeFromRouter(state: InsuranceState) {
  return state.routeDestination as any;
}

function checkConsent(state: InsuranceState) {
  if (state.customerConsent === true) return 'Policy_Listing_Node';
  if (state.customerConsent === false) return 'Graceful_Rejection_Node';
  return '__end__';
}

function checkPolicySelection(state: InsuranceState) {
  if (state.selectedPolicyId) return 'Plan_Presentation_Node';
  return '__end__';
}

function checkPlanSatisfaction(state: InsuranceState) {
  if (state.planSatisfied === true) return 'Handoff_Consent_Node';
  return '__end__';
}

function checkHandoffConsent(state: InsuranceState) {
  if (state.handoffConsent === true) return 'Human_Handoff_Node';
  if (state.handoffConsent === false) return 'Graceful_Rejection_Node';
  return '__end__';
}

const workflow = new StateGraph(InsuranceStateAnnotation)
  .addNode('Semantic_Router_Node', Nodes.Semantic_Router_Node)
  .addNode('Greeting_Consent_Node', Nodes.Greeting_Consent_Node)
  .addNode('Policy_Listing_Node', Nodes.Policy_Listing_Node)
  .addNode('Plan_Presentation_Node', Nodes.Plan_Presentation_Node)
  .addNode('Handoff_Consent_Node', Nodes.Handoff_Consent_Node)
  .addNode('FAQ_RAG_Node', Nodes.FAQ_RAG_Node)
  .addNode('Human_Handoff_Node', Nodes.Human_Handoff_Node)
  .addNode('Silence_Recovery_Node', Nodes.Silence_Recovery_Node)
  .addNode('Graceful_Rejection_Node', Nodes.Graceful_Rejection_Node)

  // Every turn enters via the semantic router
  .addEdge('__start__', 'Semantic_Router_Node')
  .addConditionalEdges('Semantic_Router_Node', routeFromRouter)

  // Funnel progression with conditional gates
  .addConditionalEdges('Greeting_Consent_Node', checkConsent)
  .addConditionalEdges('Policy_Listing_Node', checkPolicySelection)
  .addConditionalEdges('Plan_Presentation_Node', checkPlanSatisfaction)
  .addConditionalEdges('Handoff_Consent_Node', checkHandoffConsent)

  // Escape hatches always end the turn
  .addEdge('FAQ_RAG_Node', '__end__')
  .addEdge('Human_Handoff_Node', '__end__')
  .addEdge('Silence_Recovery_Node', '__end__')
  .addEdge('Graceful_Rejection_Node', '__end__');

export const insuranceCheckpointer = new MemorySaver();
export const insuranceGraph = workflow.compile({ checkpointer: insuranceCheckpointer });
