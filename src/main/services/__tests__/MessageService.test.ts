import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../../shared/types";
import type { IMessageRepository } from "../../repositories/IMessageRepository";
import { MessageService } from "../MessageService";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    projectId: "proj-1",
    role: "user",
    content: "Hello",
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IMessageRepository> = {}): IMessageRepository {
  return {
    create: vi.fn().mockResolvedValue(makeMessage()),
    listByProject: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("MessageService", () => {
  let repo: IMessageRepository;
  let service: MessageService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new MessageService(repo);
  });

  describe("addMessage", () => {
    it("delegates to repo.create and returns the message", async () => {
      const data = { projectId: "proj-1", role: "user" as const, content: "Hi" };
      const created = makeMessage(data);
      vi.mocked(repo.create).mockResolvedValue(created);

      const result = await service.addMessage(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });
  });

  describe("getHistory", () => {
    it("returns messages from repo.listByProject", async () => {
      const msgs = [makeMessage({ id: "a" }), makeMessage({ id: "b" })];
      vi.mocked(repo.listByProject).mockResolvedValue(msgs);

      const result = await service.getHistory("proj-1");

      expect(repo.listByProject).toHaveBeenCalledWith("proj-1");
      expect(result).toEqual(msgs);
    });
  });

  describe("getRecentContext", () => {
    it("delegates to repo.getRecent with projectId and n", async () => {
      const msgs = [makeMessage()];
      vi.mocked(repo.getRecent).mockResolvedValue(msgs);

      const result = await service.getRecentContext("proj-1", 5);

      expect(repo.getRecent).toHaveBeenCalledWith("proj-1", 5);
      expect(result).toEqual(msgs);
    });
  });
});
