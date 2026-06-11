import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { SalesState } from '../state/sales.state';
import { llmInstance } from '../../../llms/google.llm';
import * as Prompts from '../prompt/sales.prompts';
import { z } from 'zod';
import { listPropertiesByBudget, formatPrice } from '../tool/sales.tools';
import { Logger } from '@nestjs/common';

const logger = new Logger('SalesNodes');

export async function Semantic_Router_Node(state: SalesState) {
  logger.log(`[Router] Current Node: ${state.currentNode}`);

  const lastMsg = state.messages[state.messages.length - 1];
  if (!state.currentNode && lastMsg?.content === 'SYSTEM_START_CONVERSATION') {
    return { routeDestination: 'Greeting_Pitch_Node' };
  }

  const routerLlm = llmInstance.withStructuredOutput(
    z.object({
      routeDestination: z.enum([
        'Greeting_Pitch_Node',
        'Budget_Discovery_Node',
        'Property_Listing_Node',
        'Property_Detail_Node',
        'Objection_Handling_Node',
        'Human_Handoff_Node',
        'Graceful_Rejection_Node',
        'Silence_Recovery_Node',
      ]),
    }),
    { name: 'route_sales_user' }
  );

  const promptText = await Prompts.getPrompt('semantic_router');

  // Give the router context about available properties so it can route "tell me about property 2" correctly
  const propertiesContext = state.properties.length > 0
    ? `\nAvailable Properties: ${state.properties.map((p, i) => `${i + 1}. ${p.name} (${formatPrice(p.price)})`).join(' | ')}`
    : '';

  const messages = [
    new SystemMessage(
      promptText +
      `\n\nCurrent Funnel Stage: ${state.currentNode || 'Start'}` +
      `\nBudget known: ${state.budgetMin !== null || state.budgetMax !== null ? 'Yes' : 'No'}` +
      propertiesContext,
    ),
    ...state.messages,
  ];

  const result = await routerLlm.invoke(messages);
  logger.log(`[Router] → ${result.routeDestination}`);
  return { routeDestination: result.routeDestination };
}

export async function Greeting_Pitch_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('greeting');
  const identity = state.systemInstruction
    ? `\nAgent/Company Identity: ${state.systemInstruction}`
    : '';

  const messages = [
    new SystemMessage(promptText + identity),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Greeting_Pitch_Node' };
}

export async function Budget_Discovery_Node(state: SalesState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      budgetMin: z.number().nullable().describe('Minimum budget in INR. Null if not stated.'),
      budgetMax: z.number().nullable().describe('Maximum budget in INR. Null if not stated.'),
      customerName: z.string().nullable().describe("Customer's first name if mentioned. Null otherwise."),
      responseToUser: z.string().describe('Conversational response — acknowledge the budget or ask for it.'),
    }),
    { name: 'extract_budget' }
  );

  const promptText = await Prompts.getPrompt('budget_discovery');
  const currentBudget =
    state.budgetMin !== null || state.budgetMax !== null
      ? `\nBudget captured so far — Min: ${state.budgetMin ? formatPrice(state.budgetMin) : 'not stated'}, Max: ${state.budgetMax ? formatPrice(state.budgetMax) : 'not stated'}`
      : '';

  const messages = [
    new SystemMessage(promptText + currentBudget),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);

  const updates: Partial<SalesState> & { messages: AIMessage[] } = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Budget_Discovery_Node',
  };

  if (result.budgetMin !== null) updates.budgetMin = result.budgetMin;
  if (result.budgetMax !== null) updates.budgetMax = result.budgetMax;
  if (result.customerName) updates.customerName = result.customerName;

  return updates;
}

export async function Property_Listing_Node(state: SalesState) {
  const min = state.budgetMin ?? 0;
  const max = state.budgetMax ?? 999_999_999;
  const properties = listPropertiesByBudget(min, max);

  if (properties.length === 0) {
    // No properties in range — offer to widen search
    const response = await llmInstance.invoke([
      new SystemMessage(
        `You are a property sales voice agent. The customer's budget is ${formatPrice(min)} to ${formatPrice(max)}, ` +
        `but we currently have no listings in that exact range. ` +
        `Politely let them know and ask if they would consider a slightly wider budget or a different area. Keep it to 2 sentences.`,
      ),
      ...state.messages,
    ]);
    return { messages: [response], properties: [], currentNode: 'Property_Listing_Node' };
  }

  const promptText = await Prompts.getPrompt('property_listing');
  const propertyList = properties
    .map((p, i) => `Property ${i + 1}: ${p.name} — ${p.type}, ${p.location}, ${formatPrice(p.price)}. ${p.shortPitch}`)
    .join('\n');

  const messages = [
    new SystemMessage(
      promptText +
      `\n\nProperties to present:\n${propertyList}` +
      `\n\nCustomer budget: ${formatPrice(min)} to ${formatPrice(max)}`,
    ),
    ...state.messages,
  ];

  const response = await llmInstance.invoke(messages);
  return {
    messages: [response],
    properties,
    currentPropertyIndex: 0,
    currentNode: 'Property_Listing_Node',
  };
}

export async function Property_Detail_Node(state: SalesState) {
  const extractorLlm = llmInstance.withStructuredOutput(
    z.object({
      requestedIndex: z
        .number()
        .nullable()
        .describe('0-based index of the property the customer is asking about. Null if unclear — keep current.'),
      purchaseIntent: z
        .boolean()
        .describe('True if the customer expressed a desire to buy, book a visit, or proceed with purchase.'),
      responseToUser: z
        .string()
        .describe('Detailed conversational description of the requested property.'),
    }),
    { name: 'extract_property_detail' }
  );

  const properties = state.properties;
  const currentIdx = state.currentPropertyIndex ?? 0;

  const propertyListContext = properties
    .map((p, i) => `[${i + 1}] ${p.name} — ${p.type}, ${formatPrice(p.price)}, ${p.location}`)
    .join('\n');

  const focusProp = properties[currentIdx];
  const focusContext = focusProp
    ? `\n\nCurrently discussing: Property ${currentIdx + 1} — ${focusProp.name}` +
      `\nFull description: ${focusProp.fullDescription}` +
      `\nHighlights: ${focusProp.highlights.join(', ')}` +
      `\nPrice: ${formatPrice(focusProp.price)} | ${focusProp.bedrooms} bed, ${focusProp.bathrooms} bath | ${focusProp.sqft} sqft | ${focusProp.location}`
    : '';

  const promptText = await Prompts.getPrompt('property_detail');

  const messages = [
    new SystemMessage(
      promptText +
      `\n\nAll available properties:\n${propertyListContext}` +
      focusContext,
    ),
    ...state.messages,
  ];

  const result = await extractorLlm.invoke(messages);

  const updates: any = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Property_Detail_Node',
  };

  if (result.requestedIndex !== null && result.requestedIndex >= 0 && result.requestedIndex < properties.length) {
    updates.currentPropertyIndex = result.requestedIndex;
  }

  if (result.purchaseIntent && focusProp) {
    updates.purchaseIntentPropertyId = focusProp.id;
  }

  return updates;
}

export async function Objection_Handling_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('objection_handling');
  const focusProp = state.properties[state.currentPropertyIndex ?? 0];
  const context = focusProp
    ? `\nCurrently discussing: ${focusProp.name} at ${formatPrice(focusProp.price)}, ${focusProp.location}`
    : '';

  const messages = [
    new SystemMessage(promptText + context),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Objection_Handling_Node' };
}

export async function Human_Handoff_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('human_handoff');

  const selectedProp = state.purchaseIntentPropertyId
    ? state.properties.find(p => p.id === state.purchaseIntentPropertyId)
    : state.properties[state.currentPropertyIndex ?? 0];

  const context = selectedProp
    ? `\nProperty the customer wants to proceed with: ${selectedProp.name}, ${formatPrice(selectedProp.price)}, ${selectedProp.location}`
    : '';

  const messages = [
    new SystemMessage(promptText + context),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Human_Handoff_Node' };
}

export async function Graceful_Rejection_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('graceful_rejection');
  const nameContext = state.customerName ? `\nCustomer name: ${state.customerName}` : '';

  const messages = [
    new SystemMessage(promptText + nameContext),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Graceful_Rejection_Node' };
}

export async function Silence_Recovery_Node(state: SalesState) {
  const promptText = await Prompts.getPrompt('silence');
  return { messages: [new AIMessage(promptText)] };
}
