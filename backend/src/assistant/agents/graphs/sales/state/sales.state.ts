import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { Property } from '../tool/sales.tools';

function reduceMessages(
  left: BaseMessage[] = [],
  right: BaseMessage[] | BaseMessage,
): BaseMessage[] {
  if (Array.isArray(right)) return left.concat(right);
  return left.concat([right]);
}

export const SalesStateAnnotation = Annotation.Root({
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
    default: () => 'Greeting_Pitch_Node',
  }),

  // Customer context
  customerName: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),

  // Budget discovery
  budgetMin: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  budgetMax: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),

  // Properties fetched from tool after budget is known
  properties: Annotation<Property[]>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => [],
  }),

  // 0-based index into properties[] — which property is currently being discussed
  currentPropertyIndex: Annotation<number>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => 0,
  }),

  // Set when customer expresses purchase intent
  purchaseIntentPropertyId: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
});

export type SalesState = typeof SalesStateAnnotation.State;
