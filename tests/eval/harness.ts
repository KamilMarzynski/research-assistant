import { parseArgs } from "node:util";
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
		timeoutMs: Number.parseInt(values.timeout as string, 10),
	};

	console.log("Options:", options);
	// TODO: call runner (will be implemented in Task 9)
}

if (import.meta.main) {
	main(process.argv.slice(2));
}
