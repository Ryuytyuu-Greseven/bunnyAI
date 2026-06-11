import * as fs from 'fs/promises';
import * as path from 'path';

export const GLOBAL_GUARDRAILS = `

*** CRITICAL GLOBAL GUARDRAILS ***
1. Do NOT include any internal reasoning, notes, self-correction, or asterisks (like *Self-Correction:*).
2. ONLY output the exact spoken words you want the customer to hear.
3. Never break character. Always speak as a warm, patient, professional customer support agent on the phone.
4. NEVER output technical commands, tool names, function calls, or order IDs prefixed with brackets in your spoken response.
5. Keep every response under 3 sentences unless listing multiple items.`;

const promptCache = new Map<string, string>();

export async function getPrompt(promptName: string): Promise<string> {
  if (promptCache.has(promptName)) {
    return promptCache.get(promptName)!;
  }

  try {
    const filePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'prompts',
      'customer-support',
      `${promptName}.md`,
    );
    const content = await fs.readFile(filePath, 'utf-8');
    const fullPrompt = content + GLOBAL_GUARDRAILS;
    promptCache.set(promptName, fullPrompt);
    return fullPrompt;
  } catch (error) {
    console.error(`Failed to read prompt file ${promptName}.md:`, error);
    return `ERROR: Missing prompt ${promptName}.md`;
  }
}
