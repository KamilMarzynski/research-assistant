// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "../../../../../shared/types";
import type { StreamSegment } from "../../../../contexts/StreamStateContext";
import MessageList from "../MessageList";

const noMessages: Message[] = [];

const someMessages: Message[] = [
  { id: "m1", projectId: "p1", role: "user", content: "Hi", createdAt: new Date() },
];

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

    const textA = screen.getByText("Let me search.");
    const pill = screen.getByText("Searching");
    const textB = screen.getByText("Found results.");
    expect(textA.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pill.compareDocumentPosition(textB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("renders committed message segments interleaved (text → tool → text)", () => {
    const msg: Message = {
      id: "m-1",
      projectId: "p-1",
      role: "assistant",
      content: "before after",
      createdAt: new Date(),
      segments: [
        { type: "text", content: "before" },
        {
          type: "activity",
          toolCallId: "tc-1",
          toolName: "read_file",
          description: "Read schema",
          status: "done",
        },
        { type: "text", content: "after" },
      ],
    };

    render(<MessageList messages={[msg]} streamingSegments={[]} />);

    // Two text bubbles
    expect(screen.getByText("before")).toBeTruthy();
    expect(screen.getByText("after")).toBeTruthy();

    // Tool pill between them — check order in DOM
    expect(screen.getByText("Read schema")).toBeTruthy();
    const textA = screen.getByText("before");
    const pill = screen.getByText("Read schema");
    const textB = screen.getByText("after");
    expect(textA.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pill.compareDocumentPosition(textB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("falls back to legacy render path when segments absent", () => {
    const msg: Message = {
      id: "m-2",
      projectId: "p-1",
      role: "assistant",
      content: "legacy content",
      createdAt: new Date(),
      toolCalls: [{ toolCallId: "tc-9", toolName: "old_tool", description: "old", status: "done" }],
    };

    render(<MessageList messages={[msg]} streamingSegments={[]} />);

    expect(screen.getByText("legacy content")).toBeTruthy();
    expect(screen.getByText("old")).toBeTruthy();
  });
});

describe("MessageList — jump-to-bottom button", () => {
  function getScrollContainer(container: HTMLElement) {
    // The scroll container is the first child of the rendered root with overflowY auto
    return container.firstElementChild as HTMLElement;
  }

  function simulateScrolledUp(el: HTMLElement) {
    // Fake scroll metrics: content taller than viewport, scrolled to top
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
    fireEvent.scroll(el);
  }

  function simulateScrolledToBottom(el: HTMLElement) {
    Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 600, writable: true, configurable: true });
    // 600 + 400 = 1000 >= 1000 - 50 → at bottom
    fireEvent.scroll(el);
  }

  it("jump button is hidden initially", () => {
    render(<MessageList messages={someMessages} streamingSegments={[]} processing={false} />);
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });

  it("jump button appears when user scrolls up during content", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    expect(screen.getByText("↓ Jump to bottom")).toBeTruthy();
  });

  it("jump button disappears when user scrolls back to bottom", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    expect(screen.getByText("↓ Jump to bottom")).toBeTruthy();
    simulateScrolledToBottom(scrollEl);
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });

  it("jump button click scrolls to bottom and hides button", () => {
    const { container } = render(
      <MessageList messages={someMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    fireEvent.click(screen.getByText("↓ Jump to bottom"));
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });

  it("jump button is not shown when there are no messages", () => {
    const { container } = render(
      <MessageList messages={noMessages} streamingSegments={[]} processing={false} />,
    );
    const scrollEl = getScrollContainer(container);
    simulateScrolledUp(scrollEl);
    expect(screen.queryByText("↓ Jump to bottom")).toBeNull();
  });
});
