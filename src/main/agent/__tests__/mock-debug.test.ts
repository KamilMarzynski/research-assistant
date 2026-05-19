import { describe, expect, it, vi } from "vitest";

vi.mock("../providers/ModelMetadataService", () => ({
  modelMetadataService: {
    getModelMetadata: () => Promise.resolve({ id: "test", provider: "openai", source: "pi-ai" }),
  },
}));

const { modelMetadataService } = await import("../providers/ModelMetadataService");

describe("mock debug", () => {
  it("works", async () => {
    const result = await modelMetadataService.getModelMetadata({ type: "openai", apiKey: "sk", model: "gpt-4o" });
    expect(result.id).toBe("test");
  });
});
