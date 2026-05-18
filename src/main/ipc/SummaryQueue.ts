export class SummaryQueue {
  private readonly queues = new Map<string, string[]>();

  push(projectId: string, text: string): void {
    const q = this.queues.get(projectId) ?? [];
    q.push(text);
    this.queues.set(projectId, q);
  }

  pop(projectId: string): string | undefined {
    return this.queues.get(projectId)?.shift();
  }

  peek(projectId: string): string | undefined {
    return this.queues.get(projectId)?.[0];
  }

  hasItems(projectId: string): boolean {
    return (this.queues.get(projectId)?.length ?? 0) > 0;
  }
}
