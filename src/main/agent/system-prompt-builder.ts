export interface SystemPromptContext {
  basePrompt: string;
  memorySummary?: string;
  systemContext?: string;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  return [ctx.basePrompt, ctx.memorySummary, ctx.systemContext].filter(Boolean).join("\n\n");
}
