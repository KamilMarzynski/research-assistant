// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "../../../../../shared/types";
import type { StreamSegment } from "../../../../contexts/StreamStateContext";
import MessageList from "../MessageList";

const noMessages: Message[] = [];

describe("MessageList — segments", () => {
  it("renders text segment content during streaming", () => {
    const segments: StreamSegment[] = [{ type: "text", content: "Hello world" }];
    render(<MessageList messages={noMessages} streamingSegments={segments} processing={false} />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders activity pill for running tool", () => {
    const segments: StreamSegment[] = [
      {
        type: "activity",
        toolCallId: "tc-1",
        toolName: "web_search",
        description: "Searching for papers",
        status: "running",
      },
    ];
    render(<MessageList messages={noMessages} streamingSegments={segments} processing={true} />);
    expect(screen.getByText("Searching for papers")).toBeTruthy();
  });

  it("renders both text and activity segments in order", () => {
    const segments: StreamSegment[] = [
      { type: "text", content: "Let me search." },
      {
        type: "activity",
        toolCallId: "tc-2",
        toolName: "web_search",
        description: "Searching",
        status: "done",
      },
      { type: "text", content: "Found results." },
    ];
    render(<MessageList messages={noMessages} streamingSegments={segments} processing={false} />);
    expect(screen.getByText("Let me search.")).toBeTruthy();
    expect(screen.getByText("Searching")).toBeTruthy();
    expect(screen.getByText("Found results.")).toBeTruthy();
  });

  it("shows thinking spinner when processing and no running tool", () => {
    render(<MessageList messages={noMessages} streamingSegments={[]} processing={true} />);
    expect(screen.getByText("Thinking...")).toBeTruthy();
  });

  it("does not show thinking spinner when a tool is running", () => {
    const segments: StreamSegment[] = [
      {
        type: "activity",
        toolCallId: "tc-3",
        toolName: "read_file",
        description: "Reading file",
        status: "running",
      },
    ];
    render(<MessageList messages={noMessages} streamingSegments={segments} processing={true} />);
    expect(screen.queryByText("Thinking...")).toBeNull();
  });

  it("renders historical messages unchanged", () => {
    const messages: Message[] = [
      {
        id: "m1",
        projectId: "p1",
        role: "user",
        content: "Hello there",
        createdAt: new Date(),
      },
    ];
    render(<MessageList messages={messages} streamingSegments={[]} processing={false} />);
    expect(screen.getByText("Hello there")).toBeTruthy();
  });
});
