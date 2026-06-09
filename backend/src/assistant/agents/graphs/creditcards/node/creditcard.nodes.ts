import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { CreditCardState } from '../state/creditcard.state';
import { llmInstance } from '../../../llms/google.llm';
import * as Prompts from '../prompt/creditcard.prompts';
import { z } from 'zod';

export async function Semantic_Router_Node(state: CreditCardState) {
  console.log(`[Router] Analyzing user input... Current Node: ${state.currentNode}`);
  const routerLlm = llmInstance.withStructuredOutput(
    z.object({
      routeDestination: z.enum([
        'Greeting_Pitch_Node',
        'Qualification_Node',
        'Identity_Collection_Node',
        'FAQ_RAG_Node',
        'Human_Handoff_Node',
        'Silence_Recovery_Node'
      ]),
    }),
    { name: 'route_user' }
  );

  const promptText = await Prompts.getPrompt('semantic_router');
  const messages = [
    new SystemMessage(promptText + `\n\nCurrent Funnel State: ${state.currentNode}`),
    ...state.messages,
  ];

  const result = await routerLlm.invoke(messages);
  console.log(`[Router] Routed to -> ${result.routeDestination}`);
  return { routeDestination: result.routeDestination };
}

export async function Greeting_Pitch_Node(state: CreditCardState) {
  const promptText = await Prompts.getPrompt('greeting');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Greeting_Pitch_Node' };
}

export async function Qualification_Node(state: CreditCardState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      annualIncome: z.number().nullable().describe("The user's stated annual income in dollars. Null if not yet provided."),
      responseToUser: z.string().describe("The conversational response to say back to the user.")
    }),
    { name: 'extract_qualification' }
  );

  const promptText = await Prompts.getPrompt('qualification');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Qualification_Node'
  };

  if (result.annualIncome) {
    updates.annualIncome = result.annualIncome;
  }

  return updates;
}

export async function Identity_Collection_Node(state: CreditCardState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      fullName: z.string().nullable().describe("User's full name"),
      address: z.string().nullable().describe("User's home address"),
      last4SSN: z.string().nullable().describe("Last 4 digits of SSN"),
      responseToUser: z.string().describe("The conversational response asking for missing info, or acknowledging receipt.")
    }),
    { name: 'extract_identity' }
  );

  const promptText = await Prompts.getPrompt('identity');
  const messages = [
    new SystemMessage(promptText + `\nCurrently collected:\nName: ${state.fullName || 'Missing'}\nAddress: ${state.address || 'Missing'}\nSSN: ${state.last4SSN || 'Missing'}`),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Identity_Collection_Node'
  };

  if (result.fullName) updates.fullName = result.fullName;
  if (result.address) updates.address = result.address;
  if (result.last4SSN) updates.last4SSN = result.last4SSN;

  return updates;
}

export async function API_Execution_Node(state: CreditCardState) {
  console.log(`[API_Execution_Node] Mocking banking API for ${state.fullName}...`);
  // Pure backend node, no LLM call.
  // We mock a 100% approval for testing, or check income logic
  const approved = true;
  const creditLimit = approved ? 5000 : 0;

  return {
    preApprovalStatus: approved ? 'approved' : 'rejected',
    creditLimit,
  };
}

export async function Closing_Node(state: CreditCardState) {
  const promptText = await Prompts.getPrompt('closing');
  const messages = [
    new SystemMessage(promptText + `\nFinal Credit Limit: $${state.creditLimit}`),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Closing_Node' };
}

export async function FAQ_RAG_Node(state: CreditCardState) {
  const promptText = await Prompts.getPrompt('faq_rag');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] }; // Leave currentNode alone so it can route back
}

export async function Human_Handoff_Node(state: CreditCardState) {
  // Simulate SIP REFER handoff
  const promptText = await Prompts.getPrompt('human_handoff');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}

export async function Silence_Recovery_Node(state: CreditCardState) {
  const promptText = await Prompts.getPrompt('silence');
  return { messages: [new AIMessage(promptText)] };
}

export async function Graceful_Rejection_Node(state: CreditCardState) {
  const promptText = await Prompts.getPrompt('graceful_rejection');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}
