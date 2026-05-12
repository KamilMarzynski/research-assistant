import { inject, injectable } from "tsyringe";
import { SettingsService } from "./SettingsService";

export interface ObservationSpan {
  update(payload: Record<string, unknown>): void;
  end(): void;
}

export interface ObserveOptions {
  asType?: "span" | "generation" | "tool" | "agent";
  parentSpanContext?: { traceId: string; spanId: string };
  input?: unknown;
  metadata?: Record<string, unknown>;
}

@injectable()
export class ObservabilityService {
  private traceCache = new Map<string, string>();
  private failed = false;
  private enabled = false;
  private initAttempted = false;

  constructor(@inject(SettingsService) private readonly settingsService: SettingsService) {}

  async isEnabled(): Promise<boolean> {
    if (this.initAttempted) return this.enabled && !this.failed;

    const settings = await this.settingsService.getSettings();
    this.enabled = settings.langfuseEnabled;
    this.initAttempted = true;
    return this.enabled && !this.failed;
  }

  async getTraceId(projectId: string, _projectName: string): Promise<string | null> {
    if (!(await this.isEnabled())) return null;

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) return null;

    const cached = this.traceCache.get(projectId);
    if (cached) return cached;

    try {
      // Dynamic import to avoid loading SDK when disabled
      const { createTraceId } = await import("@langfuse/tracing");
      const traceId = await createTraceId();
      this.traceCache.set(projectId, traceId);
      return traceId;
    } catch (err) {
      this.markFailed(err);
      return null;
    }
  }

  async observe<T>(
    name: string,
    fn: (span: ObservationSpan) => Promise<T>,
    options?: ObserveOptions,
  ): Promise<T> {
    if (!(await this.isEnabled())) {
      return fn({ update: () => {}, end: () => {} });
    }

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) {
      return fn({ update: () => {}, end: () => {} });
    }

    try {
      const { startActiveObservation } = await import("@langfuse/tracing");

      const typedStartActiveObservation = startActiveObservation as unknown as <R>(
        n: string,
        f: (span: { update: (p: Record<string, unknown>) => void; end: () => void }) => Promise<R>,
        o?: Record<string, unknown>,
      ) => Promise<R>;

      const timeoutMs = 5000;
      const result = await Promise.race([
        typedStartActiveObservation(
          name,
          async (span) => {
            const wrapper: ObservationSpan = {
              update: (payload) => span.update(payload),
              end: () => span.end(),
            };
            return fn(wrapper);
          },
          {
            asType: options?.asType ?? "span",
            parentSpanContext: options?.parentSpanContext
              ? {
                  traceId: options.parentSpanContext.traceId,
                  spanId: options.parentSpanContext.spanId,
                  traceFlags: 1,
                }
              : undefined,
          },
        ),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error("observability timeout")), timeoutMs),
        ),
      ]);
      return result;
    } catch (err) {
      if (String(err).includes("observability timeout")) {
        this.markFailed(err);
      }
      return fn({ update: () => {}, end: () => {} });
    }
  }

  async startObservation(name: string, options?: ObserveOptions): Promise<ObservationSpan | null> {
    if (!(await this.isEnabled())) return null;

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) return null;

    try {
      const { startObservation } = await import("@langfuse/tracing");

      const typedStartObservation = startObservation as unknown as (
        n: string,
        a?: Record<string, unknown>,
        o?: Record<string, unknown>,
      ) => {
        update: (p: Record<string, unknown>) => void;
        end: () => void;
        id: string;
        traceId: string;
      };

      const metadata: Record<string, unknown> = {};
      if (options?.input !== undefined) metadata.input = options.input;
      if (options?.metadata !== undefined) metadata.metadata = options.metadata;

      const span = typedStartObservation(name, metadata, {
        asType: options?.asType ?? "span",
        parentSpanContext: options?.parentSpanContext
          ? {
              traceId: options.parentSpanContext.traceId,
              spanId: options.parentSpanContext.spanId,
              traceFlags: 1,
            }
          : undefined,
      });
      return {
        update: (payload) => span.update(payload),
        end: () => span.end(),
      };
    } catch (err) {
      this.markFailed(err);
      return null;
    }
  }

  private markFailed(err: unknown): void {
    if (!this.failed) {
      this.failed = true;
      console.warn("[Observability] Tracing disabled due to error:", err);
    }
  }
}
