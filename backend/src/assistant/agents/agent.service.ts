import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { agentGraph } from './graphs/graph';
import { SharedAiService } from '../services/shared-ai.service';
import { UserConfig } from '../types/assistant.types';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(private readonly sharedAiService: SharedAiService) {}

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
      const result = await agentGraph.invoke(
        {
          messages: [new HumanMessage(query)],
          userQuery: query,
          systemInstruction: config.systemInstruction,
        },
        {
          configurable: {
            sharedAiService: this.sharedAiService,
            userConfig: config,
          },
        },
      );

      const messages = result.messages || [];
      const finalMsg = messages[messages.length - 1];
      const responseText = finalMsg ? String(finalMsg.content) : '';

      this.logger.log(`LangGraph execution complete. Final response: "${responseText}"`);

      // Stream the response back word-by-word to simulate real-time LLM streaming
      const words = responseText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const isLast = i === words.length - 1;
        yield { text: words[i] + (isLast ? '' : ' ') };
        // Small delay to mimic real-time text delivery
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    } catch (err) {
      this.logger.error('Error executing LangGraph agent:', err);
      yield { text: `[en]: I encountered an error running the LangGraph agent: ${err.message || err}` };
    }
  }
}

