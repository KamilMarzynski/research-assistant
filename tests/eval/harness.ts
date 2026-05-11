import { parseArgs } from "node:util";
import { runEval } from "./runner";
import type { EvalOptions } from "./types";

export async function main(argv: string[]): Promise<void> {
	const { values } = parseArgs({
		args: argv,
		options: {
			fixture: { type: "string", short: "f" },
			judge: { type: "string", short: "j", default: "gemma4:9b-cloud" },
			keep: { type: "boolean", short: "k", default: false },
			timeout: { type: "string", short: "t", default: "300000" },
		},
	});

	if (!values.fixture) {
		console.error(
			"Usage: bun run test:eval --fixture <name> [--judge model] [--keep] [--timeout ms]",
		);
		process.exit(1);
	}

	const options: EvalOptions = {
		fixture: values.fixture as string,
		judgeModel: values.judge as string,
		keep: values.keep as boolean,
		timeoutMs: parseInt(values.timeout as string, 10),
	};

	const result = await runEval(options);

	console.log("\n=== Eval Result ===");
	console.log(`Completed: ${result.completed}`);
	console.log(`Duration: ${result.durationMs}ms`);
	console.log(`Tier 1: ${result.tier1Pass}/${result.tier1Total}`);
	console.log(`Tier 2: ${result.tier2Pass}/${result.tier2Total}`);
	console.log(`Tier 3: ${result.tier3Score}/5 — ${result.tier3Reasoning}`);

	process.exit(result.completed && result.tier1Pass === result.tier1Total && result.tier2Pass === result.tier2Total ? 0 : 1);
}

if (import.meta.main) {
	main(process.argv.slice(2));
}
