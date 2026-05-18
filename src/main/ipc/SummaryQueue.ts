export class SummaryQueue {
  private readonly queues = new Map<string, string[]>();

  push(projectId: string, text: string): void {
    let queue = this.queues.get(projectId);
    if (!queue) {
      queue = [];
      this.queues.set(projectId, queue);
    }
    queue.push(text);
  }

  pop(projectId: string): string | undefined {
    const queue = this.queues.get(projectId);
    if (!queue) return undefined;
    const text = queue.shift();
    if (queue.length === 0) {
      this.queues.delete(projectId);
    }
    return text;
  }

  peek(projectId: string): string | undefined {
    return this.queues.get(projectId)?.[0];
  }

  hasItems(projectId: string): boolean {
    return (this.queues.get(projectId)?.length ?? 0) > 0;
  }
}
