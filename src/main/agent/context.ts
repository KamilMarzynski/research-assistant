import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getScholarHome } from "../paths";
import { createDefaultSkillRouter } from "./SkillRouter";

export async function loadSkillIndexXml(projectName: string | undefined): Promise<string> {
	const projectFolderPath = projectName
		? join(getScholarHome(), "projects", toSlug(projectName))
		: undefined;
	const router = createDefaultSkillRouter(projectFolderPath);
	await router.buildIndex();
	return router.toXml();
}

export function toSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export async function loadSkillsByContent(
	skillNames: string[],
	projectName: string | undefined,
): Promise<string> {
	if (skillNames.length === 0) return "";

	const projectFolderPath = projectName
		? join(getScholarHome(), "projects", toSlug(projectName))
		: undefined;
	const router = createDefaultSkillRouter(projectFolderPath);
	await router.buildIndex();
	const parts: string[] = [];
	for (const name of skillNames) {
		try {
			const content = await router.loadSkillWithExtras(name);
			parts.push(content);
		} catch (err) {
			console.error(`[context] failed to load skill "${name}":`, err);
		}
	}
	return parts.join("\n\n---\n\n");
}

export async function buildSystemContext(
	projectName: string,
	skillIndexXml?: string,
): Promise<string> {
	const scholarHome = getScholarHome();
	const slug = toSlug(projectName);
	const parts: string[] = [];

	// 1. config.md
	try {
		const config = await readFile(join(scholarHome, "config.md"), "utf-8");
		if (config.trim()) {
			parts.push("<!-- User working style (config.md) -->", config.trim());
		}
	} catch {
		// not present yet
	}

	// 2. skills
	const skillIndex = skillIndexXml ?? (await loadSkillIndexXml(projectName));
	if (skillIndex) parts.push(skillIndex);

	// 3. GOAL.md
	let goalFile: string | undefined;
	try {
		goalFile = await readFile(
			join(scholarHome, "projects", slug, "GOAL.md"),
			"utf-8",
		);
	} catch {
		// not yet discovered
	}

	// 4. FILES.md
	let filesFile: string | undefined;
	try {
		filesFile = await readFile(
			join(scholarHome, "projects", slug, "FILES.md"),
			"utf-8",
		);
	} catch {
		// not yet discovered
	}

	if (goalFile?.trim()) {
		parts.push("<!-- Project goal (GOAL.md) -->", goalFile.trim());
	}
	if (filesFile?.trim()) {
		parts.push("<!-- Project files (FILES.md) -->", filesFile.trim());
	}

	if (!goalFile?.trim() || !filesFile?.trim()) {
		const goalPath = `~/.scholar/projects/${slug}/GOAL.md`;
		const filesPath = `~/.scholar/projects/${slug}/FILES.md`;
		parts.push(
			"This project has no GOAL.md or FILES.md yet. If the user already described their project in their first message, use the `write_file` tool to create both files directly.",
			"If they have not yet described it, ask them one question at a time:",
			"1. What is this project about? (write answer to GOAL.md)",
			"2. How are files organized? (write answer to FILES.md)",
			"3. Where should research outputs go? (add to FILES.md)",
			"4. Any naming conventions or folder structures? (add to FILES.md)",
			`After gathering answers, write the GOAL.md file to ${goalPath} and the FILES.md file to ${filesPath} using the write_file tool.`,
		);
	}

	// 5. App-level MEMORY.md
	try {
		const appMemory = await readFile(
			join(scholarHome, "app-memory", "MEMORY.md"),
			"utf-8",
		);
		if (appMemory.trim()) {
			parts.push("<!-- App-level memory (MEMORY.md) -->", appMemory.trim());
		}
	} catch {
		// not present yet
	}

	// 6. Project-level MEMORY.md
	let projectMemory: string | undefined;
	try {
		projectMemory = await readFile(
			join(scholarHome, "projects", slug, "MEMORY.md"),
			"utf-8",
		);
	} catch {
		// not yet discovered
	}
	if (projectMemory?.trim()) {
		parts.push("<!-- Project memory (MEMORY.md) -->", projectMemory.trim());
	}

	return parts.join("\n\n");
}
