import * as fs from 'fs/promises';
import * as path from 'path';

export const GLOBAL_GUARDRAILS = `

*** CRITICAL GLOBAL GUARDRAILS ***
1. Do NOT include any internal reasoning, notes, self-correction, or asterisks (like *Self-Correction:*).
2. ONLY output the exact spoken words you want the user to hear.
3. Never break character. Always speak as a professional, conversational phone agent.
4. NEVER output technical commands, tool names, or function calls (like 'log_income' or 'hang_up') in your spoken response. You are talking to a human over the phone.`;

// In-memory Heap Cache for Prompts
const promptCache = new Map<string, string>();

/**
 * Reads a markdown prompt from disk (or cache), appends the global guardrails, and caches the result.
 */
export async function getPrompt(promptName: string): Promise<string> {
  if (promptCache.has(promptName)) {
    return promptCache.get(promptName)!;
  }

  try {
    const filePath = path.join(__dirname, '..', '..', '..', '..', '..', 'prompts', 'sales', `${promptName}.md`);
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Append Guardrails exactly once before caching
    const fullPrompt = content + GLOBAL_GUARDRAILS;
    
    promptCache.set(promptName, fullPrompt);
    return fullPrompt;
  } catch (error) {
    console.error(`Failed to read prompt file ${promptName}.md:`, error);
    return `ERROR: Missing prompt ${promptName}.md`;
  }
}
