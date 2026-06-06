import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

function reduceMessages(left: BaseMessage[] = [], right: BaseMessage[] | BaseMessage): BaseMessage[] {
  if (Array.isArray(right)) {
    return left.concat(right);
  }
  return left.concat([right]);
}

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceMessages,
    default: () => [],
  }),
  userQuery: Annotation<string>(),
  systemInstruction: Annotation<string>(),
});

export type AgentState = typeof AgentStateAnnotation.State;
