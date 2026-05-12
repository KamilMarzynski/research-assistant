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
  createTraceId: vi.fn(() => "trace-123"),
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

  describe("getTraceId", () => {
    it("returns null when disabled", async () => {
      const service = new ObservabilityService(createMockSettings(false));
      const result = await service.getTraceId("p1", "Project 1");
      expect(result).toBeNull();
    });

    it("returns null when env vars missing", async () => {
      const service = new ObservabilityService(createMockSettings(true));
      const result = await service.getTraceId("p1", "Project 1");
      expect(result).toBeNull();
    });

    it("caches trace ID per project", async () => {
      process.env.LANGFUSE_PUBLIC_KEY = "pk";
      process.env.LANGFUSE_SECRET_KEY = "sk";
      const service = new ObservabilityService(createMockSettings(true));

      const traceId1 = await service.getTraceId("p1", "Project 1");
      const traceId2 = await service.getTraceId("p1", "Project 1");
      const traceId3 = await service.getTraceId("p2", "Project 2");

      expect(traceId1).toBe("trace-123");
      expect(traceId2).toBe(traceId1);
      expect(traceId3).toBe("trace-123");

      const { createTraceId } = await import("@langfuse/tracing");
      expect(createTraceId).toHaveBeenCalledTimes(2);
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
  });
});
