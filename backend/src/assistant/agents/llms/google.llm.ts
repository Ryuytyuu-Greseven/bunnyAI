import { ChatVertexAI } from "@langchain/google-vertexai";
import { config } from 'dotenv'

config();

// generates or retrieves the cached llm instance
const generateInstance = () => {
  return new ChatVertexAI({
    apiKey:
      process.env.GEMINI_API_KEY,
    modelName: 'gemini-3.5-flash',
    // location: 'us-central1',
    temperature: 0
  });
}

export const llmInstance: ChatVertexAI = generateInstance();
console.log('LLM Instance Created');




