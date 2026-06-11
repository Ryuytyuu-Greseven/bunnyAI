import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

function reduceMessages(
  left: BaseMessage[] = [],
  right: BaseMessage[] | BaseMessage,
): BaseMessage[] {
  if (Array.isArray(right)) return left.concat(right);
  return left.concat([right]);
}

export const AlertingStateAnnotation = Annotation.Root({
  // Base state
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

  // Funnel routing
  currentNode: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Identity_Node',
  }),
  routeDestination: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Identity_Node',
  }),

  // Customer due details (pre-populated from webhook / fetched via tool)
  customerName: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  dueType: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  dueAmount: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  dueDate: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  accountLastFour: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),

  // Call flow gates
  identityConfirmed: Annotation<boolean | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  alreadyPaid: Annotation<boolean | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
});

export type AlertingState = typeof AlertingStateAnnotation.State;
