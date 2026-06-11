import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { Order, Product } from '../tool/customer-support.tools';

function reduceMessages(
  left: BaseMessage[] = [],
  right: BaseMessage[] | BaseMessage,
): BaseMessage[] {
  if (Array.isArray(right)) return left.concat(right);
  return left.concat([right]);
}

export const CustomerSupportStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceMessages,
    default: () => [],
  }),
  userQuery: Annotation<string>(),
  systemInstruction: Annotation<string>(),
  business: Annotation<string>(),
  sessionId: Annotation<string>(),
  customerId: Annotation<string>(),
  customerPhNo: Annotation<string>(),
  extractedJson: Annotation<object>(),

  // Funnel tracking
  currentNode: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => '',
  }),
  routeDestination: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Node',
  }),

  // Customer context
  customerName: Annotation<string | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  // Issue context
  issueType: Annotation<'order' | 'product' | 'general' | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),
  issueDescription: Annotation<string | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  // Order context
  orderId: Annotation<string | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),
  orderDetails: Annotation<Order | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  // Product context
  productQuery: Annotation<string | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),
  productDetails: Annotation<Product | null>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => null,
  }),

  // Resolution flags
  issueResolved: Annotation<boolean>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => false,
  }),
  wantsHumanAgent: Annotation<boolean>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => false,
  }),
});

export type CustomerSupportState = typeof CustomerSupportStateAnnotation.State;
