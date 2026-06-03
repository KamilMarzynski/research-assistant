// @vitest-environment happy-dom

import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PendingCommandBanner from "../PendingCommandBanner";

function mockIpc() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const emit = (channel: string, payload: unknown) => {
    for (const listener of listeners.get(channel) ?? []) {
      listener(payload);
    }
  };

  window.electronAPI = {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
      const handlers = listeners.get(channel) ?? [];
      handlers.push(handler);
      listeners.set(channel, handlers);
      return () => {
        const nextHandlers = (listeners.get(channel) ?? []).filter((e) => e !== handler);
        if (nextHandlers.length === 0) listeners.delete(channel);
        else listeners.set(channel, nextHandlers);
      };
    }),
  } as unknown as Window["electronAPI"];

  return { emit };
}

function makePayload(
  overrides: Partial<{
    commandId: string;
    command: string;
    reason: string;
    category: string;
    key: string;
    projectId: string;
    intent: string;
    timestamp: string;
  }> = {},
) {
  return {
    commandId: overrides.commandId ?? `cmd-${Math.random().toString(36).slice(2)}`,
    command: overrides.command ?? "echo test",
    reason: overrides.reason ?? "Test reason.",
    category: overrides.category ?? "unknown_binary",
    key: overrides.key ?? "test_key",
    projectId: overrides.projectId ?? "proj-1",
    intent: overrides.intent ?? "testing",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

describe("PendingCommandBanner", () => {
  it("renders nothing when no blocked commands", () => {
    mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);
    expect(screen.queryByText(/Blocked command:/)).toBeNull();
  });

  // ── Category styling ──────────────────────────────────────────

  it("renders red (danger) banner for destructive category", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "destructive" }));
    });

    const chip = await screen.findByText("destructive");
    expect(chip.className).toContain("chip--danger");
  });

  it("renders red (danger) banner for privilege_escalation category", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "privilege_escalation" }));
    });

    const chip = await screen.findByText("privilege escalation");
    expect(chip.className).toContain("chip--danger");
  });

  it("renders amber (warn) banner for exfiltration category", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "exfiltration" }));
    });

    const chip = await screen.findByText("exfiltration");
    expect(chip.className).toContain("chip--warn");
  });

  it("renders amber (warn) banner for persistence category", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "persistence" }));
    });

    const chip = await screen.findByText("persistence");
    expect(chip.className).toContain("chip--warn");
  });

  it("renders amber (warn) banner for unsafe_operator category", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "unsafe_operator" }));
    });

    const chip = await screen.findByText("unsafe operator");
    expect(chip.className).toContain("chip--warn");
  });

  it("renders amber (warn) banner for unknown_binary category", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "unknown_binary" }));
    });

    const chip = await screen.findByText("unknown binary");
    expect(chip.className).toContain("chip--warn");
  });

  // ── Chip text formatting ──────────────────────────────────────

  it("replaces underscores with spaces in category chip text", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload({ category: "privilege_escalation" }));
    });

    expect(await screen.findByText("privilege escalation")).toBeInTheDocument();
    expect(screen.queryByText("privilege_escalation")).toBeNull();
  });

  // ── Command info rendering ────────────────────────────────────

  it("shows the blocked command and reason", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit(
        "BASH_BLOCKED",
        makePayload({
          command: "rm -rf /tmp/test",
          reason: "Recursive delete.",
        }),
      );
    });

    expect(await screen.findByText(/rm -rf \/tmp\/test/)).toBeInTheDocument();
    expect(screen.getByText(/Recursive delete/)).toBeInTheDocument();
  });

  it("shows the Review button", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit("BASH_BLOCKED", makePayload());
    });

    expect(await screen.findByText("Review")).toBeInTheDocument();
  });

  // ── Multiple items ────────────────────────────────────────────

  it("renders multiple banners for multiple blocked commands", async () => {
    const { emit } = mockIpc();
    render(<PendingCommandBanner activeProjectId="proj-1" projects={[]} />);

    act(() => {
      emit(
        "BASH_BLOCKED",
        makePayload({
          commandId: "cmd-1",
          command: "curl api.example.com",
          category: "exfiltration",
        }),
      );
      emit(
        "BASH_BLOCKED",
        makePayload({
          commandId: "cmd-2",
          command: "sudo rm -rf /",
          category: "privilege_escalation",
        }),
      );
    });

    expect(await screen.findByText(/curl api.example.com/)).toBeInTheDocument();
    expect(screen.getByText(/sudo rm -rf \//)).toBeInTheDocument();
    // One banner should be amber, the other red
    const chips = screen.getAllByText(/exfiltration|privilege escalation/);
    expect(chips).toHaveLength(2);
  });
});
