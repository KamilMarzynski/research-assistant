// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActivityPill from "../ActivityPill";

describe("ActivityPill", () => {
  it("renders description text", () => {
    render(
      <ActivityPill
        toolCallId="tc-1"
        toolName="web_search"
        description="Searching for papers"
        status="running"
      />,
    );
    expect(screen.getByText("Searching for papers")).toBeTruthy();
  });

  it("renders running state with data-testid", () => {
    const { container } = render(
      <ActivityPill
        toolCallId="tc-2"
        toolName="read_file"
        description="Reading config"
        status="running"
      />,
    );
    expect(container.querySelector("[data-testid='activity-running']")).toBeTruthy();
  });

  it("renders done state", () => {
    const { container } = render(
      <ActivityPill
        toolCallId="tc-3"
        toolName="write_file"
        description="Writing output"
        status="done"
      />,
    );
    expect(container.querySelector("[data-testid='activity-done']")).toBeTruthy();
  });

  it("renders error state", () => {
    const { container } = render(
      <ActivityPill
        toolCallId="tc-4"
        toolName="safe_bash"
        description="Running command"
        status="error"
      />,
    );
    expect(container.querySelector("[data-testid='activity-error']")).toBeTruthy();
  });

  it("truncates long descriptions", () => {
    const long = "A".repeat(200);
    const { container } = render(
      <ActivityPill toolCallId="tc-5" toolName="x" description={long} status="done" />,
    );
    const textEl = container.querySelector("[data-testid='activity-description']");
    expect(textEl).toBeTruthy();
  });
});
