import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { AlertingState } from '../state/alerting.state';
import { llmInstance } from '../../../llms/google.llm';
import * as Prompts from '../prompt/alerting.prompts';
import {
  getCustomerDueDetails,
  buildDueContext,
  formatDueAmount,
} from '../tool/alerting.tools';
import { z } from 'zod';
import { Logger } from '@nestjs/common';

const logger = new Logger('AlertingNodes');

export async function Semantic_Router_Node(state: AlertingState) {
  logger.log(`[Router] Analyzing input... Current Node: ${state.currentNode}`);

  const lastMsg = state.messages[state.messages.length - 1];
  if (!state.currentNode && lastMsg?.content === 'SYSTEM_START_CONVERSATION') {
    logger.log(`[Router] Initial trigger. Auto-routing to Greeting_Identity_Node.`);
    return { routeDestination: 'Greeting_Identity_Node' };
  }

  const routerLlm = llmInstance.withStructuredOutput(
    z.object({
      routeDestination: z.enum([
        'Greeting_Identity_Node',
        'Due_Notice_Node',
        'Payment_Guide_Node',
        'Apology_Closure_Node',
        'Human_Handoff_Node',
        'Silence_Recovery_Node',
        'Graceful_Closure_Node',
      ]),
    }),
    { name: 'route_user' },
  );

  const promptText = await Prompts.getPrompt('semantic_router');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nCurrent Funnel State: ${state.currentNode}` +
      `\nIdentity Confirmed: ${state.identityConfirmed}` +
      `\nAlready Paid: ${state.alreadyPaid}`,
    ),
    ...state.messages,
  ];

  const result = await routerLlm.invoke(messages);
  logger.log(`[Router] Routed to -> ${result.routeDestination}`);
  return { routeDestination: result.routeDestination };
}

export async function Greeting_Identity_Node(state: AlertingState) {
  // Fetch customer due details on first entry if not yet loaded
  let customerName = state.customerName;
  let dueType = state.dueType;
  let dueAmount = state.dueAmount;
  let dueDate = state.dueDate;
  let accountLastFour = state.accountLastFour;

  if (!customerName && state.customerId) {
    const record = getCustomerDueDetails(state.customerId);
    if (record) {
      customerName = record.customerName;
      dueType = record.dueType;
      dueAmount = record.dueAmount;
      dueDate = record.dueDate;
      accountLastFour = record.accountLastFour;
      logger.log(`[Greeting] Loaded customer record for ${state.customerId}: ${customerName}`);
    }
  }

  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      identityConfirmed: z
        .boolean()
        .nullable()
        .describe('True if customer confirmed they are the intended person. False if wrong person or denied. Null if no response yet.'),
      responseToUser: z.string().describe('The spoken greeting and identity verification question.'),
    }),
    { name: 'extract_identity' },
  );

  const promptText = await Prompts.getPrompt('greeting_identity');
  const messages = [
    new SystemMessage(
      promptText +
      `\n\nCustomer Name: ${customerName ?? 'Unknown'}` +
      `\nIdentity Confirmed So Far: ${state.identityConfirmed}`,
    ),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);
  logger.log(`[Greeting] Identity confirmed: ${result.identityConfirmed}`);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Greeting_Identity_Node',
  };

  // Persist fetched due details into state
  if (customerName) updates.customerName = customerName;
  if (dueType) updates.dueType = dueType;
  if (dueAmount !== null) updates.dueAmount = dueAmount;
  if (dueDate) updates.dueDate = dueDate;
  if (accountLastFour) updates.accountLastFour = accountLastFour;
  if (result.identityConfirmed !== null) updates.identityConfirmed = result.identityConfirmed;

  return updates;
}

export async function Due_Notice_Node(state: AlertingState) {
  const dueContext = state.customerName
    ? `Customer: ${state.customerName}` +
      `\nDue Type: ${state.dueType}` +
      `\nAmount Due: ${state.dueAmount !== null ? formatDueAmount(state.dueAmount) : 'unknown'}` +
      `\nDue Date: ${state.dueDate}` +
      `\nAccount ending: ${state.accountLastFour}`
    : 'Due details not available';

  const promptText = await Prompts.getPrompt('due_notice');
  const messages = [
    new SystemMessage(promptText + `\n\nDue Details:\n${dueContext}`),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Due_Notice_Node' };
}

export async function Payment_Guide_Node(state: AlertingState) {
  const dueContext = `Due Type: ${state.dueType ?? 'loan'}\nAmount: ${state.dueAmount !== null ? formatDueAmount(state.dueAmount) : 'the outstanding amount'}`;

  const promptText = await Prompts.getPrompt('payment_guide');
  const messages = [
    new SystemMessage(promptText + `\n\n${dueContext}`),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Payment_Guide_Node' };
}

export async function Apology_Closure_Node(state: AlertingState) {
  const promptText = await Prompts.getPrompt('apology_closure');
  const messages = [
    new SystemMessage(
      promptText + `\n\nCustomer Name: ${state.customerName ?? 'the customer'}`,
    ),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Apology_Closure_Node' };
}

export async function Sign_Off_Node(state: AlertingState) {
  const promptText = await Prompts.getPrompt('sign_off');
  const messages = [
    new SystemMessage(
      promptText + `\n\nCustomer Name: ${state.customerName ?? 'the customer'}`,
    ),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Sign_Off_Node' };
}

export async function Human_Handoff_Node(state: AlertingState) {
  const promptText = await Prompts.getPrompt('human_handoff');
  const messages = [
    new SystemMessage(promptText),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}

export async function Silence_Recovery_Node(_state: AlertingState) {
  const promptText = await Prompts.getPrompt('silence');
  return { messages: [new AIMessage(promptText)] };
}

export async function Graceful_Closure_Node(state: AlertingState) {
  const promptText = await Prompts.getPrompt('graceful_closure');
  const messages = [
    new SystemMessage(
      promptText + `\n\nCustomer Name: ${state.customerName ?? 'the customer'}`,
    ),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response] };
}
