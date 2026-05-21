import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../event-bus";
import { SessionManager } from "../session-manager";

// ── Electron mock ──────────────────────────────────────────────────────────
// Capture handlers registered via ipcMain.handle so tests can invoke them
const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
    ),
  },
}));

// ── AgentSession mock ──────────────────────────────────────────────────────
const mockSessionSend = vi.fn().mockResolvedValue(undefined);
const mockSessionAbort = vi.fn();

vi.mock("../../agent/session", () => ({
  // biome-ignore lint/complexity/useArrowFunction: vitest requires regular function for constructable mocks
  AgentSession: vi.fn(function () {
    return { send: mockSessionSend, abort: mockSessionAbort };
  }),
}));

// ── Context + model-provider mocks ────────────────────────────────────────
vi.mock("../../agent/context", () => ({
  buildSystemContext: vi.fn().mockResolvedValue("mocked-system-context"),
}));

vi.mock("../../agent/model-provider", () => ({
  resolveProvider: vi
    .fn()
    .mockReturnValue({ type: "openrouter", apiKey: "sk-test", model: "test-model" }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────
/** Minimal AppSettings with an API key present. */
function makeSettings(overrides: { apiKey?: string | null } = {}) {
  const apiKey = overrides.apiKey !== undefined ? overrides.apiKey : "sk-test";
  return {
    activeProvider: "openrouter" as const,
    defaultCloudProvider: "openrouter" as const,
    providerCredentials: {
      openrouter: { apiKey, defaultModel: "anthropic/claude-sonnet-4-6" },
      openai: { apiKey: null, defaultModel: "gpt-4o" },
      anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
      ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
    },
    langfuseEnabled: false,
    webAccessEnabled: true,
    theme: "system" as const,
  };
}

/** Minimal Project row. */
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    slug: "test-project-abc123",
    folderPath: null,
    projectPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    modelOverride: null,
    maxRecentMessages: 20,
    ...overrides,
  };
}

/** Build the full deps object with all mocked services. */
function makeDeps() {
  const sessionManager = new SessionManager();

  const settingsService = {
    getSettings: vi.fn().mockResolvedValue(makeSettings()),
  };

  const eventBus = new EventBus();

  const homeService = {
    getHomePath: vi.fn().mockReturnValue("/mock-home"),
  };

  const projectService = {
    getProject: vi.fn().mockResolvedValue(makeProject()),
  };

  const messageService = {
    getHistory: vi.fn().mockResolvedValue([]),
    saveMessage: vi.fn().mockResolvedValue(undefined),
  };

  const memoryManager = {
    buildContext: vi.fn().mockResolvedValue({ entries: [] }),
    save: vi.fn().mockResolvedValue(undefined),
  };

  const researchService = {};
  const outputNotificationService = { recordWrite: vi.fn().mockResolvedValue(undefined) };
  const memoryFileService = {};
  const allowlistService = {};
  const observabilityService = {};

  return {
    sessionManager,
    settingsService,
    eventBus,
    homeService,
    researchService,
    memoryManager,
    messageService,
    projectService,
    outputNotificationService,
    memoryFileService,
    allowlistService,
    observabilityService,
  } as never;
}

/** Fake BrowserWindow — only webContents.send is exercised. */
function makeWin() {
  const sent: Array<[string, unknown]> = [];
  const win = {
    webContents: {
      send: vi.fn((channel: string, payload: unknown) => {
        sent.push([channel, payload]);
      }),
    },
    _sent: sent,
  };
  return win as never;
}

/** Invoke the captured SEND_MESSAGE handler. */
async function invokeSendMessage(payload: unknown) {
  const handler = ipcHandlers.get("SEND_MESSAGE");
  if (!handler) throw new Error("SEND_MESSAGE handler not registered");
  return handler({} /* fake IPC event */, payload);
}

/** Invoke the captured ABORT_MESSAGE handler. */
async function invokeAbortMessage(payload: unknown) {
  const handler = ipcHandlers.get("ABORT_MESSAGE");
  if (!handler) throw new Error("ABORT_MESSAGE handler not registered");
  return handler({} /* fake IPC event */, payload);
}

// ── Register handler once before all tests ─────────────────────────────────
// Import is deferred so that vi.mock hoisting has had time to replace deps.
let deps: ReturnType<typeof makeDeps>;
let win: ReturnType<typeof makeWin>;

beforeEach(async () => {
  ipcHandlers.clear();
  mockSessionSend.mockClear().mockResolvedValue(undefined);
  mockSessionAbort.mockClear();

  deps = makeDeps();
  win = makeWin();

  // Re-import so each test starts with a fresh set of registered handlers
  const { registerChatHandler } = await import("../chat-handlers");
  registerChatHandler(win, deps);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("registerChatHandler — SEND_MESSAGE", () => {
  it("happy path: calls session.send with the message content", async () => {
    const result = await invokeSendMessage({ projectId: "proj-1", content: "hello" });

    expect(result).toMatchObject({ ok: true, data: { messageId: expect.any(String) } });
    expect(mockSessionSend).toHaveBeenCalledWith("hello");
  });

  it("creates a new session when none exists for projectId", async () => {
    const { AgentSession } = await import("../../agent/session");
    const constructorSpy = vi.mocked(AgentSession);
    constructorSpy.mockClear();

    await invokeSendMessage({ projectId: "proj-new", content: "first message" });

    expect(constructorSpy).toHaveBeenCalledOnce();
  });

  it("reuses existing session on second message to same projectId", async () => {
    const { AgentSession } = await import("../../agent/session");
    const constructorSpy = vi.mocked(AgentSession);
    constructorSpy.mockClear();

    await invokeSendMessage({ projectId: "proj-1", content: "msg 1" });
    await invokeSendMessage({ projectId: "proj-1", content: "msg 2" });

    // Session constructed only once despite two messages
    expect(constructorSpy).toHaveBeenCalledOnce();
    expect(mockSessionSend).toHaveBeenCalledTimes(2);
    expect(mockSessionSend).toHaveBeenCalledWith("msg 1");
    expect(mockSessionSend).toHaveBeenCalledWith("msg 2");
  });

  it("different projectIds get separate sessions", async () => {
    const { AgentSession } = await import("../../agent/session");
    const constructorSpy = vi.mocked(AgentSession);
    constructorSpy.mockClear();

    await invokeSendMessage({ projectId: "proj-a", content: "msg a" });
    await invokeSendMessage({ projectId: "proj-b", content: "msg b" });

    expect(constructorSpy).toHaveBeenCalledTimes(2);
  });

  it("emits MESSAGE_CHUNK + MESSAGE_DONE via webContents.send on no API key", async () => {
    // Make resolveProvider return a non-ollama provider with no apiKey
    const { resolveProvider } = await import("../../agent/model-provider");
    vi.mocked(resolveProvider).mockReturnValueOnce({ type: "openrouter", apiKey: "", model: "m" });

    await invokeSendMessage({ projectId: "proj-nokey", content: "hi" });

    const calls = (win as { _sent: Array<[string, unknown]> })._sent;
    const types = calls.map(([, ev]) => (ev as { type: string }).type);
    expect(types).toContain("MESSAGE_CHUNK");
    expect(types).toContain("MESSAGE_DONE");
    // Should NOT have called session.send
    expect(mockSessionSend).not.toHaveBeenCalled();
  });

  it("returns ok:false with error message for invalid payload", async () => {
    const result = await invokeSendMessage({ notAValidKey: true });

    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
  });
});

describe("registerChatHandler — ABORT_MESSAGE", () => {
  it("calls session.abort() for an existing session", async () => {
    // Pre-populate session by sending a message first
    await invokeSendMessage({ projectId: "proj-1", content: "setup" });
    mockSessionAbort.mockClear();

    const result = await invokeAbortMessage({ projectId: "proj-1" });

    expect(result).toMatchObject({ ok: true });
    expect(mockSessionAbort).toHaveBeenCalledOnce();
  });

  it("does not throw when no session exists for projectId", async () => {
    const result = await invokeAbortMessage({ projectId: "proj-unknown" });

    // Should resolve cleanly, not throw
    expect(result).toMatchObject({ ok: true });
    expect(mockSessionAbort).not.toHaveBeenCalled();
  });

  it("returns ok:false for invalid abort payload", async () => {
    const result = await invokeAbortMessage({ notProjectId: "x" });

    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
  });
});
