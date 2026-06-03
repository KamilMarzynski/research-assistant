import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, SettingsService } from "../SettingsService";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString("utf-8")),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

vi.mock("@langfuse/tracing", () => ({
  startObservation: vi.fn((_name, _attrs, _options) => ({
    update: vi.fn(),
    end: vi.fn(),
    id: "span-123",
    traceId: "trace-123",
  })),
  startActiveObservation: vi.fn((_name, fn, _options) => {
    const span = {
      update: vi.fn(),
      end: vi.fn(),
      id: "span-123",
      traceId: "trace-123",
    };
    return fn(span);
  }),
  setLangfuseTracerProvider: vi.fn(),
}));

vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: vi.fn(),
}));

function MockNodeTracerProvider() {
  return { register: vi.fn() };
}

vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: vi.fn().mockImplementation(MockNodeTracerProvider),
}));

// Import after mocks are registered
const mod = await import("../ObservabilityService");
const ObservabilityService = mod.ObservabilityService as typeof mod.ObservabilityService;

function createMockSettings(enabled: boolean): SettingsService {
  return {
    getSettings: vi.fn(async () => ({ langfuseEnabled: enabled }) as unknown as AppSettings),
  } as unknown as SettingsService;
}

describe("ObservabilityService", () => {
  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    vi.clearAllMocks();
  });

  describe("isEnabled", () => {
    it("returns false when settings disabled", async () => {
      const service = new ObservabilityService(createMockSettings(false));
      expect(await service.isEnabled()).toBe(false);
    });

    it("returns true when settings enabled", async () => {
      const service = new ObservabilityService(createMockSettings(true));
      expect(await service.isEnabled()).toBe(true);
    });
  });

  describe("observe", () => {
    it("runs fn even when disabled", async () => {
      const service = new ObservabilityService(createMockSettings(false));
      const fn = vi.fn(async (_span) => "result");
      const result = await service.observe("test", fn);
      expect(result).toBe("result");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("runs fn even when env vars missing", async () => {
      const service = new ObservabilityService(createMockSettings(true));
      const fn = vi.fn(async (_span) => "result");
      const result = await service.observe("test", fn);
      expect(result).toBe("result");
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe("startObservation", () => {
    it("returns null when disabled", async () => {
      const service = new ObservabilityService(createMockSettings(false));
      const result = await service.startObservation("test");
      expect(result).toBeNull();
    });

    it("returns null when env vars missing", async () => {
      const service = new ObservabilityService(createMockSettings(true));
      const result = await service.startObservation("test");
      expect(result).toBeNull();
    });

    it("forwards generation attrs (model, usageDetails, costDetails, modelParameters) at top level", async () => {
      process.env.LANGFUSE_PUBLIC_KEY = "pk";
      process.env.LANGFUSE_SECRET_KEY = "sk";
      const tracing = await import("@langfuse/tracing");
      const startObsMock = tracing.startObservation as unknown as ReturnType<typeof vi.fn>;
      startObsMock.mockClear();

      const service = new ObservabilityService(createMockSettings(true));
      const span = await service.startObservation("llm-generation", {
        asType: "generation",
        input: { prompt: "hi" },
        metadata: { provider: "openrouter" },
        model: "gpt-4",
        modelParameters: { temperature: 0.5 },
        usageDetails: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        costDetails: { input: 0.01, output: 0.02, total: 0.03 },
      });

      expect(span).not.toBeNull();
      expect(startObsMock).toHaveBeenCalledWith(
        "llm-generation",
        expect.objectContaining({
          input: { prompt: "hi" },
          metadata: { provider: "openrouter" },
          model: "gpt-4",
          modelParameters: { temperature: 0.5 },
          usageDetails: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          costDetails: { input: 0.01, output: 0.02, total: 0.03 },
        }),
        expect.objectContaining({ asType: "generation" }),
      );
    });

    it("update wrapper forwards payload to underlying span", async () => {
      process.env.LANGFUSE_PUBLIC_KEY = "pk";
      process.env.LANGFUSE_SECRET_KEY = "sk";
      const tracing = await import("@langfuse/tracing");
      const underlyingUpdate = vi.fn();
      (tracing.startObservation as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        update: underlyingUpdate,
        end: vi.fn(),
        id: "span-xyz",
        traceId: "trace-xyz",
      });

      const service = new ObservabilityService(createMockSettings(true));
      const span = await service.startObservation("test");
      span?.update({ output: "result", usageDetails: { totalTokens: 5 } });

      expect(underlyingUpdate).toHaveBeenCalledWith({
        output: "result",
        usageDetails: { totalTokens: 5 },
      });
      expect(span?.traceId).toBe("trace-xyz");
      expect(span?.spanId).toBe("span-xyz");
    });
  });
});
