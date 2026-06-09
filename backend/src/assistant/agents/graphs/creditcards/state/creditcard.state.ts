import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

function reduceMessages(
  left: BaseMessage[] = [],
  right: BaseMessage[] | BaseMessage,
): BaseMessage[] {
  if (Array.isArray(right)) {
    return left.concat(right);
  }
  return left.concat([right]);
}

export const CreditCardStateAnnotation = Annotation.Root({
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

  // Credit Card specific funnel state
  currentNode: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Pitch_Node',
  }),
  routeDestination: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Pitch_Node',
  }),

  annualIncome: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  fullName: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  address: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  last4SSN: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  preApprovalStatus: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  creditLimit: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
});

export type CreditCardState = typeof CreditCardStateAnnotation.State;
