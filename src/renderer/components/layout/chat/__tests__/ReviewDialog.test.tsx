// @vitest-environment happy-dom

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReviewDialog from "../ReviewDialog";

function renderDialog(overrides: Partial<Parameters<typeof ReviewDialog>[0]> = {}) {
  const onDeny = vi.fn();
  const onApproveOnce = vi.fn();
  const onClose = vi.fn();

  render(
    <ReviewDialog
      title="Test Dialog"
      onApproveOnce={onApproveOnce}
      onDeny={onDeny}
      onClose={onClose}
      dataTestid="test-dialog"
      {...overrides}
    >
      <div>content</div>
    </ReviewDialog>,
  );

  return { onDeny, onApproveOnce, onClose };
}

describe("ReviewDialog", () => {
  it("renders Approve Once, Deny buttons and Redirect button", () => {
    renderDialog();
    expect(screen.getByTestId("approve-once-btn")).toBeInTheDocument();
    expect(screen.getByTestId("deny-btn")).toBeInTheDocument();
    expect(screen.getByTestId("redirect-btn")).toBeInTheDocument();
  });

  it("Redirect button is disabled when textarea is empty", () => {
    renderDialog();
    expect(screen.getByTestId("redirect-btn")).toBeDisabled();
  });

  it("Redirect button enables when textarea has text", () => {
    renderDialog();
    const textarea = screen.getByPlaceholderText("Tell agent what to do instead…");
    fireEvent.change(textarea, { target: { value: "use read_file" } });
    expect(screen.getByTestId("redirect-btn")).not.toBeDisabled();
  });

  it("clicking Redirect calls onDeny with trimmed feedback text", () => {
    const { onDeny } = renderDialog();
    const textarea = screen.getByPlaceholderText("Tell agent what to do instead…");
    fireEvent.change(textarea, { target: { value: "  use read_file  " } });
    fireEvent.click(screen.getByTestId("redirect-btn"));
    expect(onDeny).toHaveBeenCalledWith("use read_file");
  });

  it("clicking Deny calls onDeny with no argument", () => {
    const { onDeny } = renderDialog();
    fireEvent.click(screen.getByTestId("deny-btn"));
    expect(onDeny).toHaveBeenCalledWith(undefined);
  });

  it("Redirect stays disabled when textarea contains only whitespace", () => {
    renderDialog();
    const textarea = screen.getByPlaceholderText("Tell agent what to do instead…");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(screen.getByTestId("redirect-btn")).toBeDisabled();
  });

  it("renders Approve Session button when onApproveSession provided", () => {
    renderDialog({ onApproveSession: vi.fn() });
    expect(screen.getByTestId("approve-session-btn")).toBeInTheDocument();
  });
});
