export interface SystemPromptContext {
  basePrompt: string;
  firstRunPrompt?: string;
  memorySummary?: string;
  systemContext?: string;
  isFirstRun?: boolean;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const base = ctx.isFirstRun && ctx.firstRunPrompt ? ctx.firstRunPrompt : ctx.basePrompt;
  return [base, ctx.memorySummary, ctx.systemContext].filter(Boolean).join("\n\n");
}
