import * as fs from 'fs/promises';
import * as path from 'path';

export const GLOBAL_GUARDRAILS = `

*** CRITICAL GLOBAL GUARDRAILS ***
1. Do NOT include any internal reasoning, notes, self-correction, or asterisks (like *Self-Correction:*).
2. ONLY output the exact spoken words you want the customer to hear.
3. Never break character. Always speak as a professional, courteous SBI outbound alert agent.
4. NEVER output technical commands, IDs, tool names, or function calls in your spoken response.
5. Never reveal the full account number. Only ever reference the last 4 digits.
6. Never be aggressive, threatening, or accusatory about unpaid dues.`;

const promptCache = new Map<string, string>();

export async function getPrompt(promptName: string): Promise<string> {
  if (promptCache.has(promptName)) {
    return promptCache.get(promptName)!;
  }

  try {
    const filePath = path.join(
      __dirname,
      '..', '..', '..', '..', '..',
      'prompts', 'alerting',
      `${promptName}.md`,
    );
    const content = await fs.readFile(filePath, 'utf-8');
    const fullPrompt = content + GLOBAL_GUARDRAILS;
    promptCache.set(promptName, fullPrompt);
    return fullPrompt;
  } catch (error) {
    console.error(`Failed to read alerting prompt file ${promptName}.md:`, error);
    return `ERROR: Missing prompt ${promptName}.md`;
  }
}
