import { describe, expect, it } from "vitest";
import { cleanup } from "./cleanup";

describe("cleanup", () => {
	it("does nothing when keep=true", async () => {
		let deleted = false;
		await cleanup(
			{ keep: true, tempDir: "/tmp", scholarDir: "/sch", projectId: "p1" },
			{ deleteProject: async () => { deleted = true; } },
		);
		expect(deleted).toBe(false);
	});

	it("deletes project and dirs when keep=false", async () => {
		let deleted = false;
		const removed: string[] = [];
		await cleanup(
			{ keep: false, tempDir: "/tmp", scholarDir: "/sch", projectId: "p1" },
			{
				deleteProject: async () => { deleted = true; },
				rm: async (path) => { removed.push(path as string); },
			},
		);
		expect(deleted).toBe(true);
		expect(removed).toContain("/tmp");
		expect(removed).toContain("/sch");
	});
});
