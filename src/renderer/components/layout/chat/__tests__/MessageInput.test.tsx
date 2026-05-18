// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MessageInput from "../MessageInput";

function ok<T>(data: T) {
  return Promise.resolve({ ok: true as const, data });
}

describe("MessageInput", () => {
  it("renders the approval-level selector and sends the update payload", async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === "GET_SETTINGS") {
        return ok({
          hasApiKey: true,
          activeProvider: "openrouter",
          defaultCloudProvider: "openrouter",
          providerCredentials: {
            openrouter: { apiKey: "sk-test", defaultModel: "anthropic/claude-sonnet-4-6" },
            openai: { apiKey: null, defaultModel: "gpt-4o" },
            anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
            ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
          },
          langfuseEnabled: false,
          webAccessEnabled: true,
          theme: "system",
        });
      }

      if (channel === "GET_PROVIDER_MODELS") {
        return ok({
          models: [{ id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
        });
      }

      if (channel === "SET_PROJECT_APPROVAL_LEVEL") {
        return ok(undefined);
      }

      return ok(undefined);
    });

    window.electronAPI = {
      invoke,
      send: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as Window["electronAPI"];

    render(
      <MessageInput
        onSend={vi.fn()}
        projectId="proj-1"
        projectModelOverride="openrouter:anthropic/claude-sonnet-4-6"
        projectApprovalLevel="default"
      />,
    );

    const approvalCombobox = await screen.findByRole("combobox", { name: "Approval level" });
    fireEvent.mouseDown(approvalCombobox);
    fireEvent.click(await screen.findByText("Bypass approvals"));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("SET_PROJECT_APPROVAL_LEVEL", {
        projectId: "proj-1",
        approvalLevel: "bypass_approvals",
      }),
    );
    expect(approvalCombobox.textContent).toContain("Bypass approvals");
  });
});
