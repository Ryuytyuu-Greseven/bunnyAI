import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { agentGraph } from './graphs/graph';
import { SharedAiService } from '../services/shared-ai.service';
import { UserConfig } from '../types/assistant.types';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(private readonly sharedAiService: SharedAiService) { }

  /**
   * Invokes the compiled LangGraph and streams the final message response chunk-by-chunk.
   * By yielding chunks with a .text property, it acts as a drop-in replacement for Gemini's responseStream.
   */
  public async *runAgent(
    query: string,
    config: UserConfig,
  ): AsyncGenerator<{ text: string }> {
    this.logger.log(`Invoking agent LangGraph graph for query: "${query}"`);

    try {
      const result = await agentGraph.stream(
        {
          messages: [new HumanMessage(query)],
          userQuery: query,
          systemInstruction: config.systemInstruction,
          business: config.business || '',
          sessionId: '',
          customerId: '',
          customerPhNo: '',
        },
        {
          configurable: {
            sharedAiService: this.sharedAiService,
            userConfig: config,
          },
        },
      );

      for await (const chunk of result) {
        if (chunk.agent?.messages[0]) {
          const token = chunk.agent.messages[0];
          if (token !== undefined && token !== null) {
            yield token;
          }
        }
      }

      this.logger.log(`LangGraph execution complete.`);
    } catch (err) {
      this.logger.error('Error executing LangGraph agent:', err);
      yield { text: `[en]: I encountered an error running the LangGraph agent: ${err.message || err}` };
    }
  }
}

