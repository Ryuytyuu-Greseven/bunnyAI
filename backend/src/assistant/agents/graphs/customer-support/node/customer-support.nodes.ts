import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { CustomerSupportState } from '../state/customer-support.state';
import { llmInstance } from '../../../llms/google.llm';
import * as Prompts from '../prompt/customer-support.prompts';
import { z } from 'zod';
import {
  getOrderById,
  searchOrdersByCustomerName,
  searchProducts,
  formatOrderStatus,
  formatCurrency,
  Order,
  Product,
} from '../tool/customer-support.tools';
import { Logger } from '@nestjs/common';

const logger = new Logger('CustomerSupportNodes');

// ─── Semantic Router ──────────────────────────────────────────────────────────

export async function Semantic_Router_Node(state: CustomerSupportState) {
  logger.log(`[Router] Current Node: ${state.currentNode}`);

  const lastMsg = state.messages[state.messages.length - 1];
  if (!state.currentNode && lastMsg?.content === 'SYSTEM_START_CONVERSATION') {
    return { routeDestination: 'Greeting_Node' };
  }

  const routerLlm = llmInstance.withStructuredOutput(
    z.object({
      routeDestination: z.enum([
        'Greeting_Node',
        'Order_Inquiry_Node',
        'Product_Inquiry_Node',
        'FAQ_RAG_Node',
        'Human_Handoff_Node',
        'Graceful_Close_Node',
        'Silence_Recovery_Node',
      ]),
    }),
    { name: 'route_customer_support' },
  );

  const promptText = await Prompts.getPrompt('semantic_router');

  const contextSummary =
    `\n\nCurrent Funnel Stage: ${state.currentNode || 'Start'}` +
    `\nIssue Type: ${state.issueType || 'unknown'}` +
    `\nOrder on file: ${state.orderDetails ? state.orderDetails.orderId : 'none'}` +
    `\nProduct on file: ${state.productDetails ? state.productDetails.name : 'none'}`;

  const messages = [
    new SystemMessage(promptText + contextSummary),
    ...state.messages,
  ];

  const result = await routerLlm.invoke(messages);
  logger.log(`[Router] → ${result.routeDestination}`);
  return { routeDestination: result.routeDestination };
}

// ─── Greeting ─────────────────────────────────────────────────────────────────

export async function Greeting_Node(state: CustomerSupportState) {
  const promptText = await Prompts.getPrompt('greeting');
  const identity = state.systemInstruction
    ? `\nCompany/Agent Identity: ${state.systemInstruction}`
    : '';

  const messages = [
    new SystemMessage(promptText + identity),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Greeting_Node' };
}

// ─── Order Inquiry ────────────────────────────────────────────────────────────

export async function Order_Inquiry_Node(state: CustomerSupportState) {
  const promptText = await Prompts.getPrompt('order_inquiry');

  // Attempt to retrieve order — reuse existing if already fetched
  let orderDetails: Order | null = state.orderDetails;
  let orderId: string | null = state.orderId;

  if (!orderDetails) {
    // Extract order ID or customer name from the conversation
    const idExtractor = llmInstance.withStructuredOutput(
      z.object({
        orderId: z
          .string()
          .nullable()
          .describe('Order ID in the form ORD-XXXXX. Null if not mentioned.'),
        customerName: z
          .string()
          .nullable()
          .describe("Customer's full name if mentioned. Null otherwise."),
      }),
      { name: 'extract_order_identifiers' },
    );

    const extracted = await idExtractor.invoke([
      new SystemMessage(
        'Extract the order ID (like ORD-78421) and the customer name from the conversation. Return null for each if not found.',
      ),
      ...state.messages,
    ]);

    if (extracted.orderId) {
      orderId = extracted.orderId;
      orderDetails = getOrderById(extracted.orderId) ?? null;
    }

    // Fall back to name-based search if ID lookup failed
    if (!orderDetails && extracted.customerName) {
      const found = searchOrdersByCustomerName(extracted.customerName);
      if (found.length > 0) {
        orderDetails = found[0];
        orderId = found[0].orderId;
      }
    }
  }

  // Build context block for the response LLM
  const orderContext = orderDetails
    ? `\n\nOrder Retrieved:
- Order ID: ${orderDetails.orderId}
- Customer: ${orderDetails.customerName}
- Status: ${formatOrderStatus(orderDetails)}
- Items: ${orderDetails.items.map((i) => `${i.productName} x${i.quantity} (${formatCurrency(i.price)})`).join('; ')}
- Order Total: ${formatCurrency(orderDetails.totalAmount)}
- Placed: ${orderDetails.placedDate}
- Estimated Delivery: ${orderDetails.estimatedDelivery}
- Shipping to: ${orderDetails.shippingAddress}`
    : '\n\nNo order found yet — ask the customer for their order ID or registered name.';

  const responseLlm = llmInstance.withStructuredOutput(
    z.object({
      wantsHumanAgent: z
        .boolean()
        .describe('True only if customer explicitly asked to speak to a live human agent.'),
      responseToUser: z
        .string()
        .describe('Friendly, empathetic spoken response about the order.'),
    }),
    { name: 'order_response' },
  );

  const result = await responseLlm.invoke([
    new SystemMessage(promptText + orderContext),
    ...state.messages,
  ]);

  logger.log(
    `[Order Inquiry] Order: ${orderId ?? 'unknown'} | WantsAgent: ${result.wantsHumanAgent}`,
  );

  const updates: Partial<CustomerSupportState> & { messages: AIMessage[] } = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Order_Inquiry_Node',
    issueType: 'order',
    wantsHumanAgent: result.wantsHumanAgent,
  };

  if (orderId) updates.orderId = orderId;
  if (orderDetails) updates.orderDetails = orderDetails;

  return updates;
}

// ─── Product Inquiry ──────────────────────────────────────────────────────────

export async function Product_Inquiry_Node(state: CustomerSupportState) {
  const promptText = await Prompts.getPrompt('product_inquiry');

  // Reuse existing product details or search fresh
  let productDetails: Product | null = state.productDetails;
  let productQuery: string | null = state.productQuery;

  if (!productDetails) {
    const queryExtractor = llmInstance.withStructuredOutput(
      z.object({
        productQuery: z
          .string()
          .nullable()
          .describe('The product name or category the customer is asking about. Null if unclear.'),
      }),
      { name: 'extract_product_query' },
    );

    const extracted = await queryExtractor.invoke([
      new SystemMessage(
        'Extract the product name or category the customer is asking about. Null if not identifiable.',
      ),
      ...state.messages,
    ]);

    if (extracted.productQuery) {
      productQuery = extracted.productQuery;
      const results = searchProducts(extracted.productQuery);
      if (results.length > 0) {
        productDetails = results[0];
      }
    }
  }

  const productContext = productDetails
    ? `\n\nProduct Retrieved:
- Name: ${productDetails.name}
- Category: ${productDetails.category}
- Price: ${formatCurrency(productDetails.price)}
- Availability: ${productDetails.inStock ? `In stock (${productDetails.stockCount} units)` : 'Currently out of stock'}
- Description: ${productDetails.description}
- Key Specs: ${Object.entries(productDetails.specs)
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}
- Warranty: ${productDetails.warranty}
- Return Policy: ${productDetails.returnPolicy}
- Rating: ${productDetails.rating}/5 (${productDetails.reviewCount} reviews)`
    : '\n\nNo matching product found yet — ask the customer to clarify the product name.';

  const responseLlm = llmInstance.withStructuredOutput(
    z.object({
      wantsHumanAgent: z
        .boolean()
        .describe('True only if customer explicitly asked to speak to a live human agent.'),
      responseToUser: z
        .string()
        .describe('Helpful spoken response about the product.'),
    }),
    { name: 'product_response' },
  );

  const result = await responseLlm.invoke([
    new SystemMessage(promptText + productContext),
    ...state.messages,
  ]);

  logger.log(
    `[Product Inquiry] Product: ${productDetails?.name ?? 'unknown'} | WantsAgent: ${result.wantsHumanAgent}`,
  );

  const updates: Partial<CustomerSupportState> & { messages: AIMessage[] } = {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'Product_Inquiry_Node',
    issueType: 'product',
    wantsHumanAgent: result.wantsHumanAgent,
  };

  if (productQuery) updates.productQuery = productQuery;
  if (productDetails) updates.productDetails = productDetails;

  return updates;
}

// ─── FAQ / RAG ────────────────────────────────────────────────────────────────

export async function FAQ_RAG_Node(state: CustomerSupportState) {
  const promptText = await Prompts.getPrompt('faq_rag');
  const identity = state.systemInstruction
    ? `\nCompany Identity: ${state.systemInstruction}`
    : '';

  const responseLlm = llmInstance.withStructuredOutput(
    z.object({
      wantsHumanAgent: z
        .boolean()
        .describe('True only if customer explicitly asked to speak to a live human agent.'),
      responseToUser: z
        .string()
        .describe('Concise, accurate spoken answer to the customer question.'),
    }),
    { name: 'faq_response' },
  );

  const result = await responseLlm.invoke([
    new SystemMessage(promptText + identity),
    ...state.messages,
  ]);

  logger.log(`[FAQ RAG] WantsAgent: ${result.wantsHumanAgent}`);

  return {
    messages: [new AIMessage(result.responseToUser)],
    currentNode: 'FAQ_RAG_Node',
    issueType: state.issueType ?? 'general',
    wantsHumanAgent: result.wantsHumanAgent,
  };
}

// ─── Human Handoff ────────────────────────────────────────────────────────────

export async function Human_Handoff_Node(state: CustomerSupportState) {
  const promptText = await Prompts.getPrompt('human_handoff');

  const context =
    (state.orderDetails
      ? `\nCustomer's order: ${state.orderDetails.orderId} — ${formatOrderStatus(state.orderDetails)}`
      : '') +
    (state.productDetails ? `\nProduct in question: ${state.productDetails.name}` : '') +
    (state.issueDescription ? `\nIssue summary: ${state.issueDescription}` : '');

  const messages = [
    new SystemMessage(promptText + context),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return { messages: [response], currentNode: 'Human_Handoff_Node' };
}

// ─── Graceful Close ───────────────────────────────────────────────────────────

export async function Graceful_Close_Node(state: CustomerSupportState) {
  const promptText = await Prompts.getPrompt('graceful_close');
  const nameContext = state.customerName
    ? `\nCustomer name: ${state.customerName}`
    : '';

  const messages = [
    new SystemMessage(promptText + nameContext),
    ...state.messages,
  ];
  const response = await llmInstance.invoke(messages);
  return {
    messages: [response],
    currentNode: 'Graceful_Close_Node',
    issueResolved: true,
  };
}

// ─── Silence Recovery ─────────────────────────────────────────────────────────

export async function Silence_Recovery_Node(_state: CustomerSupportState) {
  return {
    messages: [
      new AIMessage(
        "I'm still here — are you able to hear me? Please go ahead whenever you're ready.",
      ),
    ],
  };
}
