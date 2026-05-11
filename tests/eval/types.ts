export interface EvalOptions {
	fixture: string; // fixture name, e.g. "solid-state-batteries"
	judgeModel?: string; // e.g. "gemma4:9b-cloud"
	keep?: boolean; // skip cleanup
	timeoutMs?: number; // default 300000 (5 min)
}

export interface RunId {
	timestamp: string;
	fixture: string;
	id: string; // e.g. "2026-05-11T14-30-00-ssb"
}

export interface EvalResult {
	runId: string;
	completed: boolean;
	durationMs: number;
	artifactCount: number;
	tier1Pass: number;
	tier1Total: number;
	tier2Pass: number;
	tier2Total: number;
	tier3Score: number; // 1-5
	tier3Reasoning: string;
}

export interface FixturePaths {
	fixtureDir: string;
	localProjectDir: string;
	scholarDir: string;
}
