import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { SalesState } from '../state/sales.state';
import { llmInstance } from '../../../llms/google.llm';
import * as Prompts from '../prompt/sales.prompts';
import { z } from 'zod';

import { Logger } from '@nestjs/common';

const logger = new Logger('SalesNodes');

export async function Semantic_Router_Node(state: SalesState) {
  logger.log(`[Router] Analyzing user input... Current Node: ${state.currentNode}`);

  // Fast-path: If this is the initial system trigger to start the conversation, bypass the LLM entirely
  const lastMsg = state.messages[state.messages.length - 1];
  if (!state.currentNode && lastMsg && lastMsg.content === 'SYSTEM_START_CONVERSATION') {
    logger.log(`[Router] Initial connection detected. Auto-routing to Greeting_Pitch_Node.`);
    return { routeDestination: 'Greeting_Pitch_Node' };
  }

  const routerLlm = llmInstance.withStructuredOutput(
    z.object({
      routeDestination: z.enum([
        'Greeting_Pitch_Node',
        'Discovery_Node',
        'Presentation_Node',
        'Objection_Handling_Node',
        'Closing_Node',
        'FAQ_RAG_Node',
        'Human_Handoff_Node',
        'Silence_Recovery_Node',
        'Graceful_Rejection_Node'
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
  logger.log(`[Router] Routed to -> ${result.routeDestination}`);
  return { routeDestination: result.routeDestination };
}

export async function Greeting_Pitch_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('greeting');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Greeting_Pitch_Node' };
}

export async function Discovery_Node(state: SalesState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      companyName: z.string().nullable().describe("The user's company name. Null if not yet provided."),
      industry: z.string().nullable().describe("The user's industry. Null if not yet provided."),
      painPoints: z.string().nullable().describe("The user's core pain points. Null if not yet provided."),
      responseToUser: z.string().describe("The conversational response asking the next discovery question.")
    }),
    { name: 'extract_discovery' }
  );

  const promptText = await Prompts.getPrompt('discovery');
  const messages = [
    new SystemMessage(promptText + `\nCurrently collected:\nCompany: ${state.companyName || 'Missing'}\nIndustry: ${state.industry || 'Missing'}\nPain Points: ${state.painPoints || 'Missing'}`),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Discovery_Node'
  };

  if (result.companyName) updates.companyName = result.companyName;
  if (result.industry) updates.industry = result.industry;
  if (result.painPoints) updates.painPoints = result.painPoints;

  return updates;
}

export async function Presentation_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('presentation');
  const messages = [
    new SystemMessage(promptText + `\nTailor the pitch to Industry: ${state.industry || 'Unknown'}, Pain Points: ${state.painPoints || 'General'}`),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Presentation_Node' };
}

export async function Objection_Handling_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('objection_handling');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Objection_Handling_Node' };
}

export async function Closing_Node(state: SalesState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      meetingScheduled: z.boolean().nullable().describe("True if the user agreed to schedule a meeting."),
      responseToUser: z.string().describe("The conversational response attempting to close the meeting.")
    }),
    { name: 'extract_closing' }
  );

  const promptText = await Prompts.getPrompt('closing');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Closing_Node'
  };

  if (result.meetingScheduled !== null) {
    updates.meetingScheduled = result.meetingScheduled;
  }

  return updates;
}

export async function FAQ_RAG_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('faq_rag');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] }; // Leave currentNode alone so it can route back
}

export async function Human_Handoff_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('human_handoff');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}

export async function Silence_Recovery_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('silence');
  return { messages: [new AIMessage(promptText)] };
}

export async function Graceful_Rejection_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('graceful_rejection');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}
