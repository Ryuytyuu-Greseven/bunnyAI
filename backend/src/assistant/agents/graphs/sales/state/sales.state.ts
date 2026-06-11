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

export const SalesStateAnnotation = Annotation.Root({
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

  // Sales specific funnel state
  currentNode: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Pitch_Node',
  }),
  routeDestination: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Pitch_Node',
  }),

  companyName: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  industry: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  painPoints: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  budget: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  meetingScheduled: Annotation<boolean | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
});

export type SalesState = typeof SalesStateAnnotation.State;
