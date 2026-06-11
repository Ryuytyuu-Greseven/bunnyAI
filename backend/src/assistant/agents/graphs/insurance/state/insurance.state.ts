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

export const InsuranceStateAnnotation = Annotation.Root({
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

  // Funnel routing state
  currentNode: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Consent_Node',
  }),
  routeDestination: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => 'Greeting_Consent_Node',
  }),

  // Consent gates
  customerConsent: Annotation<boolean | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  handoffConsent: Annotation<boolean | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  planSatisfied: Annotation<boolean | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),

  // Customer profile
  customerName: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  customerAge: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  customerEmail: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  customerEmployer: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  healthProblems: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  previousHospitalization: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  expectedCoverAmount: Annotation<number | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),

  // Policy selection
  sumInsuredRange: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  availablePolicies: Annotation<any[] | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  selectedPolicyId: Annotation<string | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
  selectedPolicyDetails: Annotation<any | null>({
    reducer: (left, right) => right !== undefined ? right : left,
    default: () => null,
  }),
});

export type InsuranceState = typeof InsuranceStateAnnotation.State;
