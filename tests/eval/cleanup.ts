import { rm } from "node:fs/promises";

export interface CleanupOptions {
	keep: boolean;
	tempDir: string;
	scholarDir: string;
	projectId: string;
}

export async function cleanup(
	options: CleanupOptions,
	deps: {
		deleteProject: (id: string) => Promise<void>;
		rm?: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
	},
): Promise<void> {
	if (options.keep) {
		console.log("[cleanup] --keep flag set, skipping cleanup");
		return;
	}

	const remove = deps.rm ?? rm;

	await Promise.all([
		deps.deleteProject(options.projectId),
		remove(options.tempDir, { recursive: true, force: true }),
		remove(options.scholarDir, { recursive: true, force: true }),
	]);

	console.log("[cleanup] Done");
}
