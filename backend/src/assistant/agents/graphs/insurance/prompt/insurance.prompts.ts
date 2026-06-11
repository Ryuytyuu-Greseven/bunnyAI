import * as fs from 'fs/promises';
import * as path from 'path';

export const GLOBAL_GUARDRAILS = `

*** CRITICAL GLOBAL GUARDRAILS ***
1. Do NOT include any internal reasoning, notes, self-correction, or asterisks (like *Self-Correction:*).
2. ONLY output the exact spoken words you want the customer to hear.
3. Never break character. Always speak as a professional, empathetic insurance phone agent.
4. NEVER output technical commands, tool names, IDs, or function calls in your spoken response. You are talking to a human over the phone.
5. Never repeat sensitive personal data (email, health details) back verbatim unless confirming with the customer.`;

const promptCache = new Map<string, string>();

export async function getPrompt(promptName: string): Promise<string> {
  if (promptCache.has(promptName)) {
    return promptCache.get(promptName)!;
  }

  try {
    const filePath = path.join(
      __dirname,
      '..', '..', '..', '..', '..',
      'prompts', 'insurance',
      `${promptName}.md`,
    );
    const content = await fs.readFile(filePath, 'utf-8');
    const fullPrompt = content + GLOBAL_GUARDRAILS;
    promptCache.set(promptName, fullPrompt);
    return fullPrompt;
  } catch (error) {
    console.error(`Failed to read insurance prompt file ${promptName}.md:`, error);
    return `ERROR: Missing prompt ${promptName}.md`;
  }
}
