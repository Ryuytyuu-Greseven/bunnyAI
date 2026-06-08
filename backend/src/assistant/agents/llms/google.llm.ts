import { ChatVertexAI } from "@langchain/google-vertexai";
import { config } from 'dotenv'

config();

// generates or retrieves the cached llm instance
const generateInstance = () => {
  return new ChatVertexAI({
    apiKey:
      process.env.GEMINI_API_KEY,
    // modelName: 'gemini-3.5-flash',
    modelName: 'gemini-3.1-flash-lite',
    // location: 'us-central1',
    temperature: 0.1,
    thinkingLevel: 'LOW',
    cache: true,
    disableStreaming: false,
    reasoningLevel: 'low',
    streaming: true,
    vertexai: true,
  });
}

export const llmInstance: ChatVertexAI = generateInstance();
console.log('LLM Instance Created');




