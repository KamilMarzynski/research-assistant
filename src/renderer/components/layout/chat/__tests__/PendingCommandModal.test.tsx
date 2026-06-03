// @vitest-environment happy-dom

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlockedCommandPayload } from "../../../../../shared/ipc-types";
import PendingCommandModal from "../PendingCommandModal";

function makeCommand(overrides: Partial<BlockedCommandPayload> = {}): BlockedCommandPayload {
  return {
    commandId: "cmd-1",
    command: "echo test",
    reason: "Test reason.",
    category: "unknown_binary",
    key: "test_key",
    projectId: "proj-1",
    intent: "testing",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function renderModal(cmdOverrides: Partial<BlockedCommandPayload> = {}) {
  return render(
    <PendingCommandModal
      command={makeCommand(cmdOverrides)}
      projectName="test-project"
      onApproveOnce={vi.fn()}
      onApproveSession={vi.fn()}
      onDeny={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("PendingCommandModal", () => {
  // ── Category chip classes ─────────────────────────────────────

  it("renders red chip for destructive category", () => {
    renderModal({ category: "destructive" });
    const chip = screen.getByText("destructive");
    expect(chip.className).toContain("chip--danger");
    expect(chip.className).not.toContain("chip--warn");
  });

  it("renders amber chip for privilege_escalation category", () => {
    renderModal({ category: "privilege_escalation" });
    const chip = screen.getByText("privilege escalation");
    expect(chip.className).toContain("chip--warn");
    expect(chip.className).not.toContain("chip--danger");
  });

  it("renders amber chip for exfiltration category", () => {
    renderModal({ category: "exfiltration" });
    const chip = screen.getByText("exfiltration");
    expect(chip.className).toContain("chip--warn");
    expect(chip.className).not.toContain("chip--danger");
  });

  it("renders amber chip for persistence category", () => {
    renderModal({ category: "persistence" });
    const chip = screen.getByText("persistence");
    expect(chip.className).toContain("chip--warn");
    expect(chip.className).not.toContain("chip--danger");
  });

  it("renders amber chip for unsafe_operator category", () => {
    renderModal({ category: "unsafe_operator" });
    const chip = screen.getByText("unsafe operator");
    expect(chip.className).toContain("chip--warn");
    expect(chip.className).not.toContain("chip--danger");
  });

  it("renders amber chip for unknown_binary category", () => {
    renderModal({ category: "unknown_binary" });
    const chip = screen.getByText("unknown binary");
    expect(chip.className).toContain("chip--warn");
    expect(chip.className).not.toContain("chip--danger");
  });

  // ── Content rendering ─────────────────────────────────────────

  it("shows the command text in a pre block", () => {
    renderModal({ command: "curl -X POST api.example.com" });
    expect(screen.getByText("curl -X POST api.example.com")).toBeInTheDocument();
  });

  it("shows the reason text", () => {
    renderModal({ reason: "Network outbound." });
    expect(screen.getByText("Network outbound.")).toBeInTheDocument();
  });

  it("shows the project name", () => {
    renderModal();
    expect(screen.getByText(/test-project/)).toBeInTheDocument();
  });

  it("shows the intent", () => {
    renderModal({ intent: "fetch data" });
    expect(screen.getByText(/fetch data/)).toBeInTheDocument();
  });

  it("shows the instructional prompt", () => {
    renderModal();
    expect(screen.getByText(/The agent tried to run this command/)).toBeInTheDocument();
  });

  // ── Chip text formatting ──────────────────────────────────────

  it("replaces underscores with spaces in category text", () => {
    renderModal({ category: "privilege_escalation" });
    expect(screen.getByText("privilege escalation")).toBeInTheDocument();
    expect(screen.queryByText("privilege_escalation")).toBeNull();
  });
});
