import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "../../../tools";
import { createWorkerAgent } from "../../../worker-agent";

vi.mock("@mariozechner/pi-agent-core", () => ({
	Agent: vi.fn().mockImplementation(() => ({
		state: { tools: [] as never[], systemPrompt: "" },
		subscribe: vi.fn(),
		prompt: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock("../../../model-factory", () => ({
	createModel: vi.fn().mockReturnValue({ provider: "openrouter", id: "test-model" }),
}));

vi.mock("../../../context", () => ({
	loadSkillsByContent: vi.fn().mockResolvedValue(""),
}));

describe("tool registration", () => {
	it("includes fetch_url and web_search when webAccessEnabled is true", () => {
		const tools = createAgentTools({
			projectId: "test",
			projectName: "Test",
			folderPath: null,
			homePath: "/tmp",
			webAccessEnabled: true,
		});
		const names = tools.map((t) => t.name);
		expect(names).toContain("fetch_url");
		expect(names).toContain("web_search");
	});

	it("excludes fetch_url and web_search when webAccessEnabled is false", () => {
		const tools = createAgentTools({
			projectId: "test",
			projectName: "Test",
			folderPath: null,
			homePath: "/tmp",
			webAccessEnabled: false,
		});
		const names = tools.map((t) => t.name);
		expect(names).not.toContain("fetch_url");
		expect(names).not.toContain("web_search");
	});

	it("includes fetch_url and web_search when webAccessEnabled is undefined", () => {
		const tools = createAgentTools({
			projectId: "test",
			projectName: "Test",
			folderPath: null,
			homePath: "/tmp",
		});
		const names = tools.map((t) => t.name);
		expect(names).toContain("fetch_url");
		expect(names).toContain("web_search");
	});
});

describe("researcher preset", () => {
	it("includes fetch_url and web_search tools", async () => {
		const { agent } = await createWorkerAgent({
			toolNames: [
				"read_file",
				"write_file",
				"list_dir",
				"safe_bash",
				"fetch_url",
				"web_search",
			],
			systemPromptAddition: "You are a researcher.",
			projectId: "proj-1",
			projectName: "Test",
			folderPath: null,
			homePath: "/tmp/home",
			provider: { type: "openrouter", apiKey: "test", model: "test-model" },
			webAccessEnabled: true,
		});
		const names = agent.state.tools.map((t: { name: string }) => t.name);
		expect(names).toContain("fetch_url");
		expect(names).toContain("web_search");
	});
});
