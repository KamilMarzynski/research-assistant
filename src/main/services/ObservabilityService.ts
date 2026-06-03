import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { inject, injectable } from "tsyringe";
import { SettingsService } from "./SettingsService";

export interface ObservationSpan {
  update(payload: Record<string, unknown>): void;
  end(): void;
  traceId: string;
  spanId: string;
}

export interface ObserveOptions {
  asType?: "span" | "generation" | "tool" | "agent";
  parentSpanContext?: { traceId: string; spanId: string };
  input?: unknown;
  metadata?: Record<string, unknown>;
  traceId?: string;
  sessionId?: string;
  model?: string;
  modelParameters?: Record<string, string | number>;
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
}

@injectable()
export class ObservabilityService {
  private failed = false;
  private enabled = false;
  private initAttempted = false;
  private providerInitPromise: Promise<void> | null = null;

  constructor(@inject(SettingsService) private readonly settingsService: SettingsService) {}

  async isEnabled(): Promise<boolean> {
    if (this.initAttempted) return this.enabled && !this.failed;

    const settings = await this.settingsService.getSettings();
    this.enabled = settings.langfuseEnabled;
    this.initAttempted = true;
    return this.enabled && !this.failed;
  }

  private async ensureProvider(): Promise<boolean> {
    if (this.failed) return false;
    if (!(await this.isEnabled())) return false;

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) return false;

    if (this.providerInitPromise) {
      await this.providerInitPromise;
      return !this.failed;
    }

    this.providerInitPromise = (async () => {
      try {
        const { LangfuseSpanProcessor } = await import("@langfuse/otel");
        const { setLangfuseTracerProvider } = await import("@langfuse/tracing");

        const baseUrl =
          process.env.LANGFUSE_HOST ??
          process.env.LANGFUSE_BASE_URL ??
          "https://cloud.langfuse.com";

        const processor = new LangfuseSpanProcessor({
          publicKey,
          secretKey,
          baseUrl: baseUrl.replace(/\/$/, ""),
        });
        const provider = new NodeTracerProvider({
          spanProcessors: [processor],
        } as ConstructorParameters<typeof NodeTracerProvider>[0]);
        provider.register();

        setLangfuseTracerProvider(provider);
      } catch (err) {
        this.markFailed(err);
      }
    })();

    await this.providerInitPromise;
    return !this.failed;
  }

  async observe<T>(
    name: string,
    fn: (span: ObservationSpan) => Promise<T>,
    options?: ObserveOptions,
  ): Promise<T> {
    if (!(await this.ensureProvider())) {
      return fn({ update: () => {}, end: () => {}, traceId: "", spanId: "" });
    }

    try {
      const { startActiveObservation } = await import("@langfuse/tracing");

      const typedStartActiveObservation = startActiveObservation as unknown as <R>(
        n: string,
        f: (span: {
          update: (p: Record<string, unknown>) => void;
          end: () => void;
          traceId: string;
          id: string;
        }) => Promise<R>,
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
              traceId: span.traceId,
              spanId: span.id,
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
            traceId: options?.traceId,
            sessionId: options?.sessionId,
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
      return fn({ update: () => {}, end: () => {}, traceId: "", spanId: "" });
    }
  }

  async startObservation(name: string, options?: ObserveOptions): Promise<ObservationSpan | null> {
    if (!(await this.ensureProvider())) return null;

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

      const attributes: Record<string, unknown> = {};
      if (options?.input !== undefined) attributes.input = options.input;
      if (options?.metadata !== undefined) attributes.metadata = options.metadata;
      if (options?.model !== undefined) attributes.model = options.model;
      if (options?.modelParameters !== undefined)
        attributes.modelParameters = options.modelParameters;
      if (options?.usageDetails !== undefined) attributes.usageDetails = options.usageDetails;
      if (options?.costDetails !== undefined) attributes.costDetails = options.costDetails;

      const span = typedStartObservation(name, attributes, {
        asType: options?.asType ?? "span",
        parentSpanContext: options?.parentSpanContext
          ? {
              traceId: options.parentSpanContext.traceId,
              spanId: options.parentSpanContext.spanId,
              traceFlags: 1,
            }
          : undefined,
        traceId: options?.traceId,
        sessionId: options?.sessionId,
      });
      return {
        update: (payload) => span.update(payload),
        end: () => span.end(),
        traceId: span.traceId,
        spanId: span.id,
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
